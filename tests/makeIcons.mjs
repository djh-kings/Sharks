// Renders the SVG app icons to the PNG sizes that phones need for "Add to home screen".
// Run with: npm run icons
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const jobs = [
  { svg: "icons/icon.svg", png: "icons/icon-192.png", size: 192 },
  { svg: "icons/icon.svg", png: "icons/icon-512.png", size: 512 },
  { svg: "icons/icon-maskable.svg", png: "icons/icon-512-maskable.png", size: 512 },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const job of jobs) {
  const svg = await readFile(job.svg, "utf8");
  await page.setViewportSize({ width: job.size, height: job.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${job.size}" height="${job.size}" style="display:block">` +
      `</body></html>`
  );
  await page.screenshot({ path: job.png, omitBackground: true });
  console.log("Wrote", job.png);
}
await browser.close();
