// End-to-end test: drives the real site in Chromium, as a user on a phone would.
// Run with: npm test   (it starts its own local web server)
//
// Checks:
//  1. A full sighting report, with a photo carrying EXIF GPS and date
//  2. The photo's location and time are used to pre-fill the form
//  3. The stored photo has had its EXIF metadata removed
//  4. An unfinished report can be resumed after reloading
//  5. With the network OFF, the app still loads and an absence report saves
//  6. The Darwin Core CSV export has the right columns and one row per report

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const port = 8123;
const baseUrl = `http://localhost:${port}`;
const outputDir = "tests/output";

// ---- A tiny EXIF writer, so the test photo carries a real GPS position and date ----

function buildExif({ latitude, longitude, dateTimeOriginal }) {
  const tiff = Buffer.alloc(178);
  tiff.write("II", 0, "ascii"); // little-endian
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 offset

  const writeEntry = (offset, tag, type, count, value) => {
    tiff.writeUInt16LE(tag, offset);
    tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4);
    if (typeof value === "string") tiff.write(value, offset + 8, "ascii");
    else tiff.writeUInt32LE(value, offset + 8);
  };
  const writeDms = (offset, decimal) => {
    const abs = Math.abs(decimal);
    const degrees = Math.floor(abs);
    const minutes = Math.floor((abs - degrees) * 60);
    const seconds = Math.round(((abs - degrees) * 60 - minutes) * 60 * 100);
    [[degrees, 1], [minutes, 1], [seconds, 100]].forEach(([num, den], i) => {
      tiff.writeUInt32LE(num, offset + i * 8);
      tiff.writeUInt32LE(den, offset + i * 8 + 4);
    });
  };

  // IFD0: pointers to the Exif IFD (0x8769) and GPS IFD (0x8825)
  tiff.writeUInt16LE(2, 8);
  writeEntry(10, 0x8769, 4, 1, 38);
  writeEntry(22, 0x8825, 4, 1, 76);
  // Exif IFD: DateTimeOriginal
  tiff.writeUInt16LE(1, 38);
  writeEntry(40, 0x9003, 2, 20, 56);
  tiff.write(dateTimeOriginal + "\0", 56, "ascii");
  // GPS IFD
  tiff.writeUInt16LE(4, 76);
  writeEntry(78, 0x0001, 2, 2, latitude >= 0 ? "N\0" : "S\0");
  writeEntry(90, 0x0002, 5, 3, 130);
  writeEntry(102, 0x0003, 2, 2, longitude >= 0 ? "E\0" : "W\0");
  writeEntry(114, 0x0004, 5, 3, 154);
  writeDms(130, latitude);
  writeDms(154, longitude);

  const header = Buffer.from("Exif\0\0", "binary");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(2 + header.length + tiff.length);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, header, tiff]);
}

function insertExif(jpeg, exif) {
  // Put the APP1 (EXIF) segment straight after the JPEG start marker (FFD8).
  return Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
}

// ---- Helpers ----

function startServer() {
  const server = spawn("python3", ["-m", "http.server", String(port)], { stdio: "ignore" });
  return new Promise((resolve) => setTimeout(() => resolve(server), 800));
}

async function next(page) {
  await page.click("#nextButton");
}

async function expectStep(page, text) {
  await page.waitForFunction((t) => document.getElementById("progressText").textContent.includes(t), text);
}

// ---- The test ----

await mkdir(outputDir, { recursive: true });
const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  geolocation: { latitude: 50.3, longitude: -4.1, accuracy: 15 },
  permissions: ["geolocation"],
  acceptDownloads: true,
});
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  // Map tiles cannot load in the test environment; ignore those failures only.
  if (message.type() === "error" && !/Failed to load resource/.test(message.text())) {
    pageErrors.push(message.text());
  }
});

let passed = 0;
const check = (description, condition) => {
  assert.ok(condition, description);
  passed += 1;
  console.log("  ok -", description);
};

try {
  // Make a plain JPEG in the browser, then add EXIF in Node.
  await page.goto(`${baseUrl}/index.html`);
  const jpegBase64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1b6f8f";
    ctx.fillRect(0, 0, 2400, 1800);
    ctx.fillStyle = "#cccccc";
    ctx.fillRect(600, 800, 1200, 200);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  });
  const photo = insertExif(
    Buffer.from(jpegBase64, "base64"),
    buildExif({ latitude: 50.35, longitude: -4.15, dateTimeOriginal: "2026:07:20 09:00:00" })
  );

  console.log("Home page");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  check("service worker controls the page", await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  await page.screenshot({ path: `${outputDir}/01-home.png`, fullPage: true });

  console.log("Sighting report");
  await page.goto(`${baseUrl}/report.html`);
  await expectStep(page, "Step one of nine: About you");
  check("Back and Save hidden on the first step", (await page.isHidden("#backButton")) && (await page.isHidden("#submitButton")));

  await next(page);
  check("validation blocks an empty first step", await page.isVisible("#errorSummary"));

  await page.check('input[name="role"][value="diver"]');
  await page.check('input[name="experience"][value="some"]');
  await page.fill("#observerName", "Test Diver");
  await page.screenshot({ path: `${outputDir}/02-about-you.png`, fullPage: true });
  await next(page);
  await expectStep(page, "Photos");

  // Resume test: reload mid-report and continue.
  await page.reload();
  check("resume panel appears after reload", await page.isVisible("#resumePanel"));
  await page.click("#resumeButton");
  await expectStep(page, "Photos");
  check("resumed on the photo step with name kept", (await page.inputValue("#observerName")) === "Test Diver");

  await page.setInputFiles("#photoInput", { name: "shark.jpg", mimeType: "image/jpeg", buffer: photo });
  await page.waitForSelector("#photoList img");
  const photoStatus = await page.textContent("#photoStatus");
  check("photo location used to pre-fill", photoStatus.includes("location has been filled in"));
  check("photo time used to pre-fill", photoStatus.includes("date and time have been filled in"));
  await page.screenshot({ path: `${outputDir}/03-photo.png`, fullPage: true });
  await next(page);

  await expectStep(page, "Where");
  check("latitude came from the photo", (await page.inputValue("#latitude")) === "50.35000");
  check("longitude came from the photo", (await page.inputValue("#longitude")) === "-4.15000");
  await page.click("#gpsButton");
  await page.waitForFunction(() => document.getElementById("latitude").value === "50.30000");
  check("GPS button fills the device position", true);
  check("GPS accuracy is reported", (await page.textContent("#gpsStatus")).includes("15m"));
  await page.check('input[name="precision"][value="withinOneKm"]');
  await page.screenshot({ path: `${outputDir}/04-where.png`, fullPage: true });
  await next(page);

  await expectStep(page, "When");
  check("date and time came from the photo", (await page.inputValue("#eventDate")) === "2026-07-20T09:00");
  check("date shown in house style", (await page.textContent("#eventDateHint")) === "Monday 20th July 2026 at 9.00am");
  await next(page);

  await expectStep(page, "What");
  await next(page);
  check("species is required", await page.isVisible("#errorSummary"));
  await page.click('label.speciesCard:has(input[value="smallSpottedCatshark"])');
  check("key features shown for chosen species", (await page.textContent("#speciesDetail")).includes("nostrils"));
  await next(page);
  check("confidence is required for a named species", (await page.textContent("#errorSummary")).includes("how sure"));
  await page.check('input[name="confidence"][value="fairlySure"]');
  await page.screenshot({ path: `${outputDir}/05-what.png`, fullPage: true });
  await next(page);

  await expectStep(page, "How many");
  await page.fill("#individualCount", "2");
  await page.check('input[name="encounterType"][value="seenUnderwater"]');
  check("fishing method hidden when not caught", await page.isHidden("#gearType"));
  await next(page);

  await expectStep(page, "More detail");
  await page.check('input[name="lengthBand"][value="under1m"]');
  await page.check('input[name="behaviour"][value="restingOnSeabed"]');
  await page.fill("#depthMetres", "12");
  await next(page);

  await expectStep(page, "Your dive or trip");
  await page.fill("#durationMinutes", "45");
  await next(page);

  await expectStep(page, "Check and save");
  const review = await page.textContent("#reviewSummary");
  check("review shows the species", review.includes("Small-spotted catshark"));
  check("review shows the date in house style", review.includes("Monday 20th July 2026 at 9.00am"));
  await page.screenshot({ path: `${outputDir}/06-review.png`, fullPage: true });
  await page.click("#submitButton");
  await page.waitForSelector("#donePanel:not([hidden])");
  check("pending count shown in words", (await page.textContent("#donePanel [data-pending-count]")) === "one");

  // Look inside IndexedDB.
  const stored = await page.evaluate(async () => {
    const { listReports } = await import("./js/store.js");
    const reports = await listReports();
    const bytes = new Uint8Array(await reports[0].photos[0].blob.arrayBuffer());
    const text = Array.from(bytes.subarray(0, 4096), (b) => String.fromCharCode(b)).join("");
    return {
      count: reports.length,
      report: { ...reports[0], photos: undefined },
      photoHasExif: text.includes("Exif"),
      photoWidth: reports[0].photos[0].width,
    };
  });
  check("one report saved", stored.count === 1);
  check("report is pending upload", stored.report.syncStatus === "pending");
  check("uncertainty is 1000m for 'within 1km'", stored.report.location.uncertaintyMetres === 1000);
  check("stored photo has no EXIF", stored.photoHasExif === false);
  check("stored photo resized to 1600px", stored.photoWidth === 1600);
  check("event date has a UTC offset", /[+-]\d\d:\d\d$/.test(stored.report.eventDate));

  console.log("Offline absence report");
  await context.setOffline(true);
  await page.goto(`${baseUrl}/report.html?mode=absence`);
  check("report page loads offline", (await page.textContent("h1")) === "I looked, but saw no sharks");
  check("offline banner shown", await page.isVisible("#offlineBanner"));
  await expectStep(page, "Step one of five");
  check("role remembered from last report", await page.isChecked('input[name="role"][value="diver"]'));
  await next(page);
  await expectStep(page, "Where");
  check("offline map note shown", await page.isVisible("#mapOfflineNote"));
  await page.fill("#latitude", "50.2");
  await page.fill("#longitude", "-4.3");
  await page.check('input[name="precision"][value="generalSite"]');
  await page.screenshot({ path: `${outputDir}/07-offline-where.png`, fullPage: true });
  await next(page);
  await expectStep(page, "When");
  await next(page);
  await expectStep(page, "Your dive or trip");
  await next(page);
  check("absence record requires time spent looking", (await page.textContent("#errorSummary")).includes("how long"));
  await page.fill("#durationMinutes", "60");
  await next(page);
  await page.click("#submitButton");
  await page.waitForSelector("#donePanel:not([hidden])");
  check("absence report saved offline", (await page.textContent("#donePanel [data-pending-count]")) === "two");

  console.log("Reports page and export");
  await page.goto(`${baseUrl}/sightings.html`);
  await page.waitForSelector(".reportCard");
  check("both reports listed", (await page.locator(".reportCard").count()) === 2);
  await page.screenshot({ path: `${outputDir}/08-reports.png`, fullPage: true });

  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportButton")]);
  const csv = await readFile(await download.path(), "utf8");
  const lines = csv.trim().split("\r\n");
  const headers = lines[0].split(",");
  check("CSV has a header and two rows", lines.length === 3);
  for (const term of ["occurrenceID", "eventDate", "decimalLatitude", "decimalLongitude",
    "coordinateUncertaintyInMeters", "scientificName", "occurrenceStatus", "samplingEffort"]) {
    check(`CSV has Darwin Core column ${term}`, headers.includes(term));
  }
  check("CSV contains the catshark by scientific name", csv.includes("Scyliorhinus canicula"));
  check("CSV contains an absence record", csv.includes(",absent,"));

  console.log("Species guide");
  await page.goto(`${baseUrl}/species.html`);
  await page.waitForSelector(".guideSpecies");
  check("draft warning shown on guide", await page.isVisible("#draftNotice"));

  check("no JavaScript errors", pageErrors.length === 0 || (console.log(pageErrors), false));
  console.log(`\nAll ${passed} checks passed. Screenshots in ${outputDir}/`);
} catch (error) {
  console.error("\nFAILED:", error.message);
  if (pageErrors.length) console.error("Page errors:", pageErrors);
  await page.screenshot({ path: `${outputDir}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
