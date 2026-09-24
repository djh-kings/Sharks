// exportDwc.js
// Turns reports into Darwin Core, the standard format for biodiversity records.
// Charities, NBN Atlas, and GBIF can all import a Darwin Core CSV, so exporting
// in this format means our data can be combined with everyone else's.
//
// Term definitions: https://dwc.tdwg.org/terms/
// Anything without a standard term goes into dynamicProperties as JSON.

import { findSpecies, notSureId } from "./speciesPicker.js";

// When the observer is not sure of the species, we record it at the highest
// level we are confident of: "a shark". Selachimorpha is the superorder
// containing all sharks. (The biology department should confirm this choice.)
const unknownShark = { scientificName: "Selachimorpha", taxonRank: "superorder", vernacularName: "shark" };

// Column order in the CSV.
export const dwcColumns = [
  "occurrenceID",
  "basisOfRecord",
  "occurrenceStatus",
  "eventDate",
  "decimalLatitude",
  "decimalLongitude",
  "geodeticDatum",
  "coordinateUncertaintyInMeters",
  "scientificName",
  "taxonRank",
  "vernacularName",
  "kingdom",
  "individualCount",
  "sex",
  "identificationVerificationStatus",
  "identificationRemarks",
  "minimumDepthInMeters",
  "maximumDepthInMeters",
  "samplingEffort",
  "recordedBy",
  "occurrenceRemarks",
  "associatedMedia",
  "dynamicProperties",
];

export function reportToDwc(report, speciesData) {
  const isAbsence = report.recordType === "absence";
  const species = isAbsence ? null : findSpecies(speciesData, report.identification?.speciesId);
  const taxon = species
    ? { scientificName: species.scientificName, taxonRank: "species", vernacularName: species.commonName }
    : unknownShark;

  const detail = report.detail || {};
  const effort = report.effort || {};
  const observer = report.observer || {};

  // Depth: prefer the sighting depth, otherwise the range of the dive or trip.
  const minDepth = detail.depthMetres ?? effort.minDepthMetres ?? "";
  const maxDepth = detail.depthMetres ?? effort.maxDepthMetres ?? "";

  const identificationRemarks = isAbsence
    ? ""
    : report.identification?.speciesId === notSureId
      ? "Observer not sure of species"
      : `Observer confidence: ${report.identification?.confidence || "not given"}; observer experience: ${observer.experience || "not given"}`;

  const remarks = [];
  if (detail.behaviour?.length) remarks.push(`Behaviour: ${detail.behaviour.join(", ")}`);
  if (detail.tagsSeen) remarks.push(`Tag seen: ${detail.tagsSeen}`);
  if (detail.notes) remarks.push(detail.notes);

  return {
    occurrenceID: report.id,
    basisOfRecord: "HumanObservation",
    occurrenceStatus: isAbsence ? "absent" : "present",
    eventDate: report.eventDate,
    decimalLatitude: report.location.latitude,
    decimalLongitude: report.location.longitude,
    geodeticDatum: "WGS84",
    coordinateUncertaintyInMeters: report.location.uncertaintyMetres,
    scientificName: taxon.scientificName,
    taxonRank: taxon.taxonRank,
    vernacularName: taxon.vernacularName,
    kingdom: "Animalia",
    individualCount: isAbsence ? 0 : report.count?.individualCount,
    sex: detail.sex && detail.sex !== "unknown" ? detail.sex : "",
    // Every public report starts unverified. An expert changes this later.
    identificationVerificationStatus: "unverified",
    identificationRemarks,
    minimumDepthInMeters: minDepth,
    maximumDepthInMeters: maxDepth,
    samplingEffort: effort.durationMinutes ? `${effort.durationMinutes} minutes` : "",
    recordedBy: observer.anonymous || !observer.name ? "Anonymous" : observer.name,
    occurrenceRemarks: remarks.join(". "),
    // Photos are only on this device for now. The backend will add real URLs.
    associatedMedia: report.photos?.length ? `${report.photos.length} photo(s) held on reporting device` : "",
    dynamicProperties: JSON.stringify({
      observerRole: observer.role,
      fisherType: observer.fisherType || undefined,
      observerExperience: observer.experience,
      encounterType: report.count?.encounterType,
      countIsEstimate: report.count?.isEstimate || undefined,
      gearType: report.count?.gearType || undefined,
      lengthBand: detail.lengthBand || undefined,
      waterTemperatureCelsius: detail.waterTempCelsius ?? undefined,
      locationPrecision: report.location.precision,
      locationSource: report.location.source,
    }),
  };
}

// CSV rules: wrap a value in quotes if it contains a comma, quote, or newline,
// and double any quotes inside it.
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows) {
  const lines = [dwcColumns.join(",")];
  for (const row of rows) {
    lines.push(dwcColumns.map((column) => csvCell(row[column])).join(","));
  }
  return lines.join("\r\n");
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
