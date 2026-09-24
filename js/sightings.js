// sightings.js
// The "My reports" page: a map and list of the reports saved on this device,
// plus the Darwin Core CSV export.

import { listReports, deleteReport } from "./store.js";
import { formatDateTime, formatCoords, escapeHtml, numberInWords } from "./format.js";
import { loadSpeciesData, findSpecies, notSureId } from "./speciesPicker.js";
import { reportToDwc, toCsv, downloadCsv } from "./exportDwc.js";
import { updatePendingCount } from "./app.js";

let speciesData = null;
let map = null;
let markerLayer = null;

function reportTitle(report) {
  if (report.recordType === "absence") {
    return "No sharks seen";
  }
  const speciesId = report.identification?.speciesId;
  if (speciesId === notSureId) {
    return "Shark (species not sure)";
  }
  return findSpecies(speciesData, speciesId)?.commonName || "Shark";
}

function drawMap(reports) {
  if (!window.L) {
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
  for (const report of reports) {
    const { latitude, longitude, uncertaintyMetres } = report.location;
    // Circles show the uncertainty honestly: a big circle means "somewhere in here".
    window.L.circle([latitude, longitude], {
      radius: uncertaintyMetres || 30,
      color: report.recordType === "absence" ? "#888888" : "#0b4f6c",
    }).addTo(markerLayer);
    window.L.circleMarker([latitude, longitude], {
      radius: 7,
      color: report.recordType === "absence" ? "#888888" : "#0b4f6c",
      fillOpacity: 0.9,
    })
      .bindPopup(`<strong>${escapeHtml(reportTitle(report))}</strong><br>${escapeHtml(formatDateTime(new Date(report.eventDate)))}`)
      .addTo(markerLayer);
  }
  if (reports.length > 0) {
    map.fitBounds(markerLayer.getBounds(), { maxZoom: 11, padding: [20, 20] });
  }
}

function drawList(reports) {
  const list = document.getElementById("reportsList");
  if (reports.length === 0) {
    list.innerHTML = '<p>You have not made any reports on this device yet. <a href="report.html">Make one now</a>.</p>';
    return;
  }
  list.innerHTML = "";
  for (const report of reports) {
    const card = document.createElement("article");
    card.className = "card reportCard";
    const count = report.count?.individualCount;
    const status = report.syncStatus === "pending" ? "Waiting to upload" : "Uploaded";
    card.innerHTML = `
      <h3>${escapeHtml(reportTitle(report))}${count > 1 ? ` (${count})` : ""}</h3>
      <p><span class="statusTag">${status}</span></p>
      <dl class="summaryList">
        <dt>When</dt><dd>${escapeHtml(formatDateTime(new Date(report.eventDate)))}</dd>
        <dt>Where</dt><dd>${escapeHtml(formatCoords(report.location.latitude, report.location.longitude))} (within about ${report.location.uncertaintyMetres}m)</dd>
        <dt>Photos</dt><dd>${report.photos?.length ? numberInWords(report.photos.length) : "None"}</dd>
      </dl>`;
    const thumbs = document.createElement("div");
    thumbs.className = "photoList";
    for (const photo of report.photos || []) {
      const figure = document.createElement("figure");
      figure.className = "photoItem";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(photo.blob);
      img.alt = `Photo from report: ${reportTitle(report)}`;
      figure.append(img);
      thumbs.append(figure);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button buttonSecondary";
    remove.textContent = "Delete this report";
    remove.addEventListener("click", async () => {
      if (window.confirm("Delete this report from this device? This cannot be undone.")) {
        await deleteReport(report.id);
        await refresh();
      }
    });
    card.append(thumbs, remove);
    list.append(card);
  }
}

async function exportCsv() {
  const status = document.getElementById("exportStatus");
  const reports = await listReports();
  if (reports.length === 0) {
    status.textContent = "There are no reports to export.";
    return;
  }
  const rows = reports.map((report) => reportToDwc(report, speciesData));
  const today = new Date().toISOString().slice(0, 10);
  downloadCsv(`shark-sightings-${today}.csv`, toCsv(rows));
  status.textContent = `Exported ${numberInWords(reports.length)} ${reports.length === 1 ? "report" : "reports"}.`;
}

async function refresh() {
  const reports = await listReports();
  drawMap(reports);
  drawList(reports);
  await updatePendingCount();
}

async function init() {
  speciesData = await loadSpeciesData();
  document.getElementById("exportButton").addEventListener("click", exportCsv);
  await refresh();
}

init();
