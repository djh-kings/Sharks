// sightings.js
// The "My reports" page: a map and list of the reports saved on this device,
// plus the Darwin Core CSV export.
//
// Each report has a number. The same number is shown on its map marker, so
// the map and the list can be matched up without relying on colour.

import { listReports, deleteReport } from "./store.js";
import { formatDateTime, formatPosition, escapeHtml, numberInWords } from "./format.js";
import { loadSpeciesData, describeSpeciesChoice } from "./speciesPicker.js";
import { precisionOptions } from "./geo.js";
import { reportToDwc, toCsv, downloadCsv } from "./exportDwc.js";
import { updatePendingCount } from "./app.js";
import { icon } from "./icons.js";

let speciesData = null;
let map = null;
let markerLayer = null;

function reportTitle(report) {
  if (report.recordType === "absence") {
    const minutes = report.effort?.durationMinutes;
    return minutes ? `No sharks seen in ${minutes} minutes` : "No sharks seen";
  }
  const { speciesId, speciesGroup } = report.identification || {};
  const count = report.count?.individualCount;
  return describeSpeciesChoice(speciesData, speciesId, speciesGroup) + (count > 1 ? ` (${count})` : "");
}

function statusBadge(report) {
  return report.syncStatus === "pending"
    ? `<span class="badge badgeWaiting">${icon("clock")}Waiting to upload</span>`
    : `<span class="badge badgeDone">${icon("check")}Uploaded</span>`;
}

// Colours come from the CSS tokens, so the map matches the light or dark theme.
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawMap(reports) {
  if (!window.L || !navigator.onLine) {
    return;
  }
  if (!map) {
    map = window.L.map("reportsMap").setView([54.5, -4.0], 5);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    markerLayer = window.L.featureGroup().addTo(map);
  }
  markerLayer.clearLayers();
  const colour = token("--text");
  reports.forEach((report, index) => {
    const { latitude, longitude, uncertaintyMetres } = report.location;
    // Circles show the uncertainty honestly: a big circle means "somewhere in here".
    window.L.circle([latitude, longitude], { radius: uncertaintyMetres || 30, color: colour, weight: 2 }).addTo(markerLayer);
    const numberIcon = window.L.divIcon({
      className: "",
      html: `<span class="reportNumber" style="border: 3px solid ${token("--surface")}">${index + 1}</span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    window.L.marker([latitude, longitude], { icon: numberIcon, title: `Report ${index + 1}: ${reportTitle(report)}` })
      .bindPopup(`<strong>${escapeHtml(reportTitle(report))}</strong><br>${escapeHtml(formatDateTime(new Date(report.eventDate)))}`)
      .addTo(markerLayer);
  });
  if (reports.length > 0) {
    map.fitBounds(markerLayer.getBounds(), { maxZoom: 11, padding: [30, 30] });
  }
  setTimeout(() => map.invalidateSize(), 0);
}

function drawList(reports) {
  const list = document.getElementById("reportsList");
  if (reports.length === 0) {
    list.innerHTML = '<p>You have not made any reports on this device yet. <a href="report.html">Make one now</a>.</p>';
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "reportList";
  reports.forEach((report, index) => {
    const li = document.createElement("li");
    li.className = "reportCard reportItem";
    const { latitude, longitude, precision, locality } = report.location;
    const place = [locality, formatPosition(latitude, longitude)].filter(Boolean).join(". ");
    const accuracy = precisionOptions[precision]?.label || `Within about ${report.location.uncertaintyMetres}m`;
    li.innerHTML = `
      <span class="reportNumber" aria-hidden="true">${index + 1}</span>
      <div class="reportBody">
        <h2><span class="visuallyHidden">Report ${index + 1}: </span>${escapeHtml(reportTitle(report))}</h2>
        <p>${escapeHtml(place)}</p>
        <p class="when">${escapeHtml(formatDateTime(new Date(report.eventDate)))}. ${escapeHtml(accuracy)}.</p>
        <p>${statusBadge(report)}</p>
      </div>`;
    const body = li.querySelector(".reportBody");
    if (report.photos?.length) {
      const thumbs = document.createElement("div");
      thumbs.className = "photoList";
      for (const photo of report.photos) {
        const figure = document.createElement("figure");
        figure.className = "photoItem";
        const img = document.createElement("img");
        img.src = URL.createObjectURL(photo.blob);
        img.alt = `Photo from report ${index + 1}: ${reportTitle(report)}`;
        figure.append(img);
        thumbs.append(figure);
      }
      body.append(thumbs);
    }
    const row = document.createElement("div");
    row.className = "buttonRow";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button buttonSecondary";
    remove.innerHTML = `Delete<span class="visuallyHidden"> report ${index + 1}</span>`;
    remove.addEventListener("click", async () => {
      if (window.confirm("Delete this report from this device? This cannot be undone.")) {
        await deleteReport(report.id);
        await refresh();
      }
    });
    row.append(remove);
    body.append(row);
    ul.append(li);
  });
  list.innerHTML = "";
  list.append(ul);
}

async function exportCsv() {
  const status = document.getElementById("exportStatus");
  const reports = await listReports();
  if (reports.length === 0) {
    status.textContent = "There are no reports to download.";
    return;
  }
  const rows = reports.map((report) => reportToDwc(report, speciesData));
  const today = new Date().toISOString().slice(0, 10);
  downloadCsv(`shark-sightings-${today}.csv`, toCsv(rows));
  status.textContent = `Downloaded ${numberInWords(reports.length)} ${reports.length === 1 ? "report" : "reports"}.`;
}

async function refresh() {
  const reports = await listReports();
  drawList(reports);
  drawMap(reports);
  await updatePendingCount();
}

async function init() {
  speciesData = await loadSpeciesData();
  document.getElementById("exportButton").addEventListener("click", exportCsv);
  const layout = document.getElementById("reportsLayout");
  for (const radio of document.querySelectorAll('input[name="reportsView"]')) {
    radio.addEventListener("change", () => {
      layout.dataset.view = radio.value;
      map?.invalidateSize();
    });
  }
  if (!navigator.onLine) {
    document.getElementById("reportsMap").outerHTML =
      `<div class="notice">${icon("noSignal")}<p>The map cannot load without a signal. Your reports are listed below.</p></div>`;
  }
  await refresh();
}

init();
