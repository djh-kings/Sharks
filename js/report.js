// report.js
// Runs the multi-step report form on report.html.
//
// How it works:
// - Every step is a <section data-step="..."> in report.html. Only one is shown at a time.
// - stepsByMode lists which steps appear, in order. An "absence" report
//   ("I looked but saw no sharks") skips the photo, species, and count steps.
// - Each step has a validator. Next only moves on if it returns no errors.
// - After every step the whole form is saved as a draft in IndexedDB, so nothing
//   is lost if the phone locks or the app closes.
//
// To add a question: add the input to report.html, then (if it matters) read it
// in buildReport() below and add it to the Darwin Core export in exportDwc.js.

import { formatDateTime, formatCoords, toIsoWithOffset, toLocalInputValue, escapeHtml, numberInWords } from "./format.js";
import { saveReport, saveDraft, loadDraft, clearDraft, getSetting, setSetting, newId } from "./store.js";
import { getCurrentPosition, precisionOptions, uncertaintyMetres, validateCoords, isInUkIrelandWaters } from "./geo.js";
import { readPhotoMetadata, preparePhoto } from "./photos.js";
import { loadSpeciesData, renderSpeciesPicker, renderSpeciesDetail, findSpecies, notSureId } from "./speciesPicker.js";
import { updatePendingCount } from "./app.js";

const stepsByMode = {
  sighting: ["observer", "photo", "where", "when", "what", "count", "detail", "effort", "review"],
  absence: ["observer", "where", "when", "effort", "review"],
};

const maxPhotos = 3;

// Values that are not simple form fields live here.
const state = {
  mode: "sighting",
  stepIndex: 0,
  photos: [], // { blob, width, height, takenAt }
  photoLocation: null, // { latitude, longitude } from the first photo that had GPS
  gpsAccuracyMetres: null,
  locationSource: null, // "gps" | "photo" | "map" | "manual"
  eventDateEditedByUser: false,
  speciesData: null,
};

const form = document.getElementById("reportForm");
const errorSummary = document.getElementById("errorSummary");
let map = null;
let marker = null;

// ---------------------------------------------------------------------------
// Reading and writing form fields
// ---------------------------------------------------------------------------

// Returns every named field as a plain object. Groups of checkboxes with the
// same name (eg behaviour) become arrays; a single checkbox becomes true/false.
function collectFields() {
  const fields = {};
  for (const element of form.elements) {
    if (!element.name || element.type === "file") {
      continue;
    }
    if (element.type === "radio") {
      if (element.checked) fields[element.name] = element.value;
      else if (!(element.name in fields)) fields[element.name] = "";
    } else if (element.type === "checkbox") {
      const group = form.querySelectorAll(`input[type="checkbox"][name="${element.name}"]`);
      if (group.length > 1) {
        fields[element.name] ??= [];
        if (element.checked) fields[element.name].push(element.value);
      } else {
        fields[element.name] = element.checked;
      }
    } else {
      fields[element.name] = element.value.trim();
    }
  }
  return fields;
}

function restoreFields(fields) {
  for (const element of form.elements) {
    if (!element.name || !(element.name in fields) || element.type === "file") {
      continue;
    }
    const value = fields[element.name];
    if (element.type === "radio") {
      element.checked = element.value === value;
    } else if (element.type === "checkbox") {
      element.checked = Array.isArray(value) ? value.includes(element.value) : Boolean(value);
    } else {
      element.value = value;
    }
  }
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ---------------------------------------------------------------------------
// Showing and hiding things that depend on other answers
// ---------------------------------------------------------------------------

// Any element with data-show-when="fieldName=value1,value2" is shown only when
// that field has one of those values.
function updateConditionalFields() {
  const fields = collectFields();
  for (const element of form.querySelectorAll("[data-show-when]")) {
    const [name, valueList] = element.dataset.showWhen.split("=");
    element.hidden = !valueList.split(",").includes(fields[name]);
  }

  const anonymous = fields.anonymous;
  for (const id of ["observerName", "observerEmail"]) {
    document.getElementById(id).disabled = anonymous;
  }

  const confidenceField = document.getElementById("confidenceField");
  confidenceField.hidden = !fields.speciesId || fields.speciesId === notSureId;
}

// ---------------------------------------------------------------------------
// Validation: one function per step, each returning a list of messages
// ---------------------------------------------------------------------------

const validators = {
  observer(fields) {
    const errors = [];
    if (!fields.role) errors.push({ field: "role", message: "Choose which best describes you." });
    if (fields.role === "fisher" && !fields.fisherType) {
      errors.push({ field: "fisherType", message: "Choose the kind of fishing." });
    }
    if (!fields.experience) errors.push({ field: "experience", message: "Choose how much you know about sharks." });
    if (!fields.anonymous && fields.observerEmail && !/^\S+@\S+\.\S+$/.test(fields.observerEmail)) {
      errors.push({ field: "observerEmail", message: "The email address does not look right." });
    }
    return errors;
  },

  photo() {
    return [];
  },

  where(fields) {
    const errors = [];
    if (fields.latitude === "" || fields.longitude === "") {
      errors.push({
        field: "latitude",
        message: "Give a location: use your current position, tap the map, or type the coordinates.",
      });
    } else {
      for (const message of validateCoords(Number(fields.latitude), Number(fields.longitude))) {
        errors.push({ field: "latitude", message });
      }
    }
    if (!fields.precision) errors.push({ field: "precision", message: "Say how accurate the location is." });
    return errors;
  },

  when(fields) {
    const errors = [];
    if (!fields.eventDate) {
      errors.push({ field: "eventDate", message: "Give the date and time of the sighting." });
      return errors;
    }
    const date = new Date(fields.eventDate);
    const fiveMinutesAhead = Date.now() + 5 * 60 * 1000;
    if (Number.isNaN(date.getTime())) {
      errors.push({ field: "eventDate", message: "The date and time are not valid." });
    } else if (date.getTime() > fiveMinutesAhead) {
      errors.push({ field: "eventDate", message: "The date and time cannot be in the future." });
    }
    return errors;
  },

  what(fields) {
    const errors = [];
    if (!fields.speciesId) {
      errors.push({ field: "speciesId", message: 'Choose a species, or "Not sure".' });
    } else if (fields.speciesId !== notSureId && !fields.confidence) {
      errors.push({ field: "confidence", message: "Say how sure you are of the species." });
    }
    return errors;
  },

  count(fields) {
    const errors = [];
    const count = Number(fields.individualCount);
    if (!Number.isInteger(count) || count < 1) {
      errors.push({ field: "individualCount", message: "The number of sharks must be a whole number, one or more." });
    }
    if (!fields.encounterType) errors.push({ field: "encounterType", message: "Choose how you encountered it." });
    return errors;
  },

  detail(fields) {
    const errors = [];
    if (fields.depthMetres !== "" && numberOrNull(fields.depthMetres) === null) {
      errors.push({ field: "depthMetres", message: "Depth must be a number." });
    }
    if (fields.waterTempCelsius !== "") {
      const temperature = numberOrNull(fields.waterTempCelsius);
      if (temperature === null || temperature < -2 || temperature > 35) {
        errors.push({ field: "waterTempCelsius", message: "Water temperature should be between -2 and 35 degrees." });
      }
    }
    return errors;
  },

  effort(fields) {
    const errors = [];
    const duration = numberOrNull(fields.durationMinutes);
    // For an absence record, the time spent looking is the whole point.
    if (state.mode === "absence" && duration === null) {
      errors.push({
        field: "durationMinutes",
        message: "Say how long you were looking. Without this, a \"no sharks\" record cannot be used.",
      });
    }
    if (fields.durationMinutes !== "" && (duration === null || duration < 1)) {
      errors.push({ field: "durationMinutes", message: "Time spent looking must be at least one minute." });
    }
    const minDepth = numberOrNull(fields.minDepthMetres);
    const maxDepth = numberOrNull(fields.maxDepthMetres);
    if (minDepth !== null && maxDepth !== null && minDepth > maxDepth) {
      errors.push({ field: "maxDepthMetres", message: "The deepest depth must be more than the shallowest." });
    }
    return errors;
  },

  review() {
    return [];
  },
};

function showErrors(errors) {
  for (const element of form.querySelectorAll(".fieldError")) {
    element.classList.remove("fieldError");
  }
  if (errors.length === 0) {
    errorSummary.hidden = true;
    errorSummary.innerHTML = "";
    return;
  }
  const items = errors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join("");
  errorSummary.innerHTML = `<strong>Please check the following:</strong><ul>${items}</ul>`;
  errorSummary.hidden = false;
  for (const error of errors) {
    for (const element of form.querySelectorAll(`[name="${error.field}"]`)) {
      (element.closest(".choice, .speciesCard") || element).classList.add("fieldError");
    }
  }
  errorSummary.focus();
}

// ---------------------------------------------------------------------------
// Moving between steps
// ---------------------------------------------------------------------------

function currentSteps() {
  return stepsByMode[state.mode];
}

function showStep(index, { focus = true } = {}) {
  const steps = currentSteps();
  state.stepIndex = Math.max(0, Math.min(index, steps.length - 1));
  const stepName = steps[state.stepIndex];

  for (const section of form.querySelectorAll(".step")) {
    section.hidden = section.dataset.step !== stepName;
  }
  const section = form.querySelector(`[data-step="${stepName}"]`);

  document.getElementById("progressText").textContent =
    `Step ${numberInWords(state.stepIndex + 1)} of ${numberInWords(steps.length)}: ${section.dataset.title}`;
  document.getElementById("progressFill").style.width = `${((state.stepIndex + 1) / steps.length) * 100}%`;

  const isLast = state.stepIndex === steps.length - 1;
  document.getElementById("backButton").hidden = state.stepIndex === 0;
  document.getElementById("nextButton").hidden = isLast;
  document.getElementById("submitButton").hidden = !isLast;
  showErrors([]);

  stepEnterHooks[stepName]?.();
  if (focus) {
    section.querySelector("h2").focus();
    window.scrollTo(0, 0);
  }
}

const stepEnterHooks = {
  where() {
    initMap();
    document.getElementById("mapOfflineNote").hidden = navigator.onLine;
    document.getElementById("photoLocationButton").hidden = !state.photoLocation;
  },
  when() {
    const input = document.getElementById("eventDate");
    input.max = toLocalInputValue(new Date());
    if (!input.value) {
      input.value = toLocalInputValue(new Date());
    }
    updateEventDateHint();
  },
  review() {
    renderReview();
  },
};

async function goNext() {
  const fields = collectFields();
  const stepName = currentSteps()[state.stepIndex];
  const errors = validators[stepName](fields);
  if (errors.length > 0) {
    showErrors(errors);
    return;
  }
  showStep(state.stepIndex + 1);
  await persistDraft();
}

async function goBack() {
  showStep(state.stepIndex - 1);
  await persistDraft();
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

async function persistDraft() {
  try {
    await saveDraft({
      mode: state.mode,
      stepIndex: state.stepIndex,
      fields: collectFields(),
      photos: state.photos,
      photoLocation: state.photoLocation,
      gpsAccuracyMetres: state.gpsAccuracyMetres,
      locationSource: state.locationSource,
      eventDateEditedByUser: state.eventDateEditedByUser,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    // A failed draft save should never stop the user reporting.
    console.warn("Could not save draft:", error);
  }
}

function applyDraft(draft) {
  state.mode = draft.mode;
  state.photos = draft.photos || [];
  state.photoLocation = draft.photoLocation || null;
  state.gpsAccuracyMetres = draft.gpsAccuracyMetres ?? null;
  state.locationSource = draft.locationSource || null;
  state.eventDateEditedByUser = Boolean(draft.eventDateEditedByUser);
  restoreFields(draft.fields || {});
  if (draft.fields?.speciesId) {
    renderSpeciesDetail(document.getElementById("speciesDetail"), state.speciesData, draft.fields.speciesId);
  }
  renderPhotoList();
  applyModeText();
  updateConditionalFields();
  showStep(draft.stepIndex || 0);
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

async function handlePhotoInput(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = ""; // so choosing the same file again still triggers "change"
  const status = document.getElementById("photoStatus");
  const room = maxPhotos - state.photos.length;
  if (room <= 0) {
    status.textContent = `You can add up to ${numberInWords(maxPhotos)} photos. Remove one first.`;
    return;
  }
  if (files.length > room) {
    status.textContent = `Only the first ${numberInWords(room)} will be added.`;
  }

  const messages = [];
  for (const file of files.slice(0, room)) {
    status.textContent = `Preparing ${file.name}...`;
    try {
      const metadata = await readPhotoMetadata(file);
      const prepared = await preparePhoto(file);
      state.photos.push({ ...prepared, takenAt: metadata.takenAt ? metadata.takenAt.toISOString() : null });

      if (metadata.latitude !== null && !state.photoLocation) {
        state.photoLocation = { latitude: metadata.latitude, longitude: metadata.longitude };
        if (!document.getElementById("latitude").value) {
          setLocation(metadata.latitude, metadata.longitude, "photo");
          messages.push("The location has been filled in from your photo. Please check it.");
        }
      }
      if (metadata.takenAt && !state.eventDateEditedByUser) {
        document.getElementById("eventDate").value = toLocalInputValue(metadata.takenAt);
        messages.push("The date and time have been filled in from your photo.");
      }
    } catch (error) {
      messages.push(error.message);
    }
  }
  status.textContent = messages.join(" ");
  renderPhotoList();
  await persistDraft();
}

function renderPhotoList() {
  const list = document.getElementById("photoList");
  // Release old preview URLs so they do not use up memory.
  for (const img of list.querySelectorAll("img")) {
    URL.revokeObjectURL(img.src);
  }
  list.innerHTML = "";
  state.photos.forEach((photo, index) => {
    const figure = document.createElement("figure");
    figure.className = "photoItem";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(photo.blob);
    img.alt = `Photo ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button buttonSecondary";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      state.photos.splice(index, 1);
      renderPhotoList();
      await persistDraft();
    });
    figure.append(img, remove);
    list.append(figure);
  });
}

// ---------------------------------------------------------------------------
// Location and map
// ---------------------------------------------------------------------------

function renderPrecisionChoices() {
  const container = document.getElementById("precisionChoices");
  container.innerHTML = Object.entries(precisionOptions)
    .map(
      ([value, option]) =>
        `<label class="choice"><input type="radio" name="precision" value="${value}"><span class="choiceText">${escapeHtml(option.label)}</span></label>`
    )
    .join("");
}

function initMap() {
  if (map) {
    map.invalidateSize(); // Leaflet needs this after its container becomes visible
    return;
  }
  if (!window.L) {
    return;
  }
  const lat = numberOrNull(document.getElementById("latitude").value);
  const lon = numberOrNull(document.getElementById("longitude").value);
  const hasPoint = lat !== null && lon !== null;

  map = window.L.map("locationMap").setView(hasPoint ? [lat, lon] : [54.5, -4.0], hasPoint ? 11 : 5);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  if (hasPoint) {
    placeMarker(lat, lon);
  }
  map.on("click", (event) => setLocation(event.latlng.lat, event.latlng.lng, "map"));
  setTimeout(() => map.invalidateSize(), 0);
}

function placeMarker(latitude, longitude) {
  if (!map) {
    return;
  }
  if (!marker) {
    marker = window.L.marker([latitude, longitude], { draggable: true, keyboard: true }).addTo(map);
    marker.on("dragend", () => {
      const position = marker.getLatLng();
      setLocation(position.lat, position.lng, "map", { moveMap: false });
    });
  } else {
    marker.setLatLng([latitude, longitude]);
  }
}

function setLocation(latitude, longitude, source, { moveMap = true } = {}) {
  document.getElementById("latitude").value = latitude.toFixed(5);
  document.getElementById("longitude").value = longitude.toFixed(5);
  state.locationSource = source;
  if (source !== "gps") {
    // The GPS accuracy no longer describes this point.
    state.gpsAccuracyMetres = null;
  }
  placeMarker(latitude, longitude);
  if (map && moveMap) {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 11));
  }
  document.getElementById("boundsWarning").hidden = isInUkIrelandWaters(latitude, longitude);
}

async function useGps() {
  const status = document.getElementById("gpsStatus");
  const button = document.getElementById("gpsButton");
  status.textContent = "Finding your position. At sea this can take up to 30 seconds...";
  button.disabled = true;
  try {
    const position = await getCurrentPosition();
    setLocation(position.latitude, position.longitude, "gps");
    state.gpsAccuracyMetres = position.accuracyMetres;
    status.textContent = `Position found, accurate to about ${position.accuracyMetres}m. Move the pin if the shark was somewhere else.`;
    await persistDraft();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function handleCoordinateTyping() {
  const lat = numberOrNull(document.getElementById("latitude").value);
  const lon = numberOrNull(document.getElementById("longitude").value);
  if (lat !== null && lon !== null && validateCoords(lat, lon).length === 0) {
    state.locationSource = "manual";
    state.gpsAccuracyMetres = null;
    placeMarker(lat, lon);
    map?.setView([lat, lon], Math.max(map.getZoom(), 11));
    document.getElementById("boundsWarning").hidden = isInUkIrelandWaters(lat, lon);
  }
}

// ---------------------------------------------------------------------------
// Date and time
// ---------------------------------------------------------------------------

function updateEventDateHint() {
  const value = document.getElementById("eventDate").value;
  const hint = document.getElementById("eventDateHint");
  const date = value ? new Date(value) : null;
  hint.textContent = date && !Number.isNaN(date.getTime()) ? formatDateTime(date) : "";
}

// ---------------------------------------------------------------------------
// Building the final report
// ---------------------------------------------------------------------------

function buildReport(fields) {
  const isSighting = state.mode === "sighting";
  const anonymous = Boolean(fields.anonymous);
  const encounterNeedsGear = ["caughtReleased", "bycatch"].includes(fields.encounterType);

  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
    recordType: state.mode, // "sighting" or "absence"
    observer: {
      role: fields.role,
      fisherType: fields.role === "fisher" ? fields.fisherType : null,
      experience: fields.experience,
      anonymous,
      name: anonymous ? null : fields.observerName || null,
      email: anonymous ? null : fields.observerEmail || null,
    },
    photos: isSighting ? state.photos : [],
    location: {
      latitude: Number(fields.latitude),
      longitude: Number(fields.longitude),
      precision: fields.precision,
      uncertaintyMetres: uncertaintyMetres(fields.precision, state.gpsAccuracyMetres),
      gpsAccuracyMetres: state.gpsAccuracyMetres,
      source: state.locationSource || "manual",
    },
    eventDate: toIsoWithOffset(new Date(fields.eventDate)),
    identification: isSighting
      ? {
          speciesId: fields.speciesId,
          confidence: fields.speciesId === notSureId ? null : fields.confidence,
        }
      : null,
    count: isSighting
      ? {
          individualCount: Number(fields.individualCount),
          isEstimate: Boolean(fields.countIsEstimate),
          encounterType: fields.encounterType,
          gearType: encounterNeedsGear ? fields.gearType || null : null,
        }
      : null,
    detail: isSighting
      ? {
          lengthBand: fields.lengthBand || null,
          sex: fields.sex || null,
          behaviour: fields.behaviour || [],
          depthMetres: numberOrNull(fields.depthMetres),
          waterTempCelsius: numberOrNull(fields.waterTempCelsius),
          tagsSeen: fields.tagsSeen || null,
          notes: fields.notes || null,
        }
      : null,
    effort: {
      durationMinutes: numberOrNull(fields.durationMinutes),
      minDepthMetres: numberOrNull(fields.minDepthMetres),
      maxDepthMetres: numberOrNull(fields.maxDepthMetres),
    },
  };
}

// Human-readable labels for the review screen, taken from the form itself so
// the wording is only written once (in report.html).
function labelFor(name, value) {
  const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) {
    const text = input.closest("label").querySelector(".choiceText");
    return text ? text.firstChild.textContent.trim() : value;
  }
  const option = form.querySelector(`select[name="${name}"] option[value="${value}"]`);
  return option ? option.textContent : value;
}

function renderReview() {
  const fields = collectFields();
  const rows = [];
  const add = (label, value) => {
    if (value !== null && value !== undefined && value !== "") rows.push([label, value]);
  };

  add("Type", state.mode === "absence" ? "No sharks seen" : "Sighting");
  add("You are", labelFor("role", fields.role) + (fields.fisherType ? ` (${labelFor("fisherType", fields.fisherType)})` : ""));
  add("Experience", labelFor("experience", fields.experience));
  add("Reported by", fields.anonymous ? "Anonymous" : fields.observerName || "Not given");

  if (fields.latitude) {
    add("Location", formatCoords(Number(fields.latitude), Number(fields.longitude)));
    add("Accuracy", precisionOptions[fields.precision]?.label);
  }
  if (fields.eventDate) add("When", formatDateTime(new Date(fields.eventDate)));

  if (state.mode === "sighting") {
    add("Photos", state.photos.length ? numberInWords(state.photos.length) : "None");
    const species = findSpecies(state.speciesData, fields.speciesId);
    add("Species", species ? species.commonName : "Not sure");
    if (species) add("How sure", labelFor("confidence", fields.confidence));
    add("Number", fields.individualCount + (fields.countIsEstimate ? " (estimate)" : ""));
    add("Encounter", labelFor("encounterType", fields.encounterType));
    if (fields.gearType && !form.querySelector('[data-show-when^="encounterType"]').hidden) {
      add("Fishing method", labelFor("gearType", fields.gearType));
    }
    if (fields.lengthBand) add("Length", labelFor("lengthBand", fields.lengthBand));
    if (fields.sex) add("Sex", labelFor("sex", fields.sex));
    if (fields.behaviour?.length) add("Behaviour", fields.behaviour.map((b) => labelFor("behaviour", b)).join(", "));
    if (fields.depthMetres) add("Depth", `${fields.depthMetres}m`);
    if (fields.waterTempCelsius) add("Water temperature", `${fields.waterTempCelsius}°C`);
    add("Tag", fields.tagsSeen);
    add("Notes", fields.notes);
  }
  if (fields.durationMinutes) add("Time looking", `${fields.durationMinutes} minutes`);
  if (fields.minDepthMetres || fields.maxDepthMetres) {
    add("Depth range", `${fields.minDepthMetres || "?"}m to ${fields.maxDepthMetres || "?"}m`);
  }

  const list = rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
  document.getElementById("reviewSummary").innerHTML = `<dl class="summaryList">${list}</dl>`;
}

async function handleSubmit(event) {
  event.preventDefault();
  const fields = collectFields();

  // Re-check every step in case something was changed after it was passed.
  for (const [index, stepName] of currentSteps().entries()) {
    const errors = validators[stepName](fields);
    if (errors.length > 0) {
      showStep(index);
      showErrors(errors);
      return;
    }
  }

  const report = buildReport(fields);
  const submitButton = document.getElementById("submitButton");
  submitButton.disabled = true;
  try {
    await saveReport(report);
    await setSetting("observer", {
      role: fields.role,
      fisherType: fields.fisherType,
      experience: fields.experience,
      anonymous: fields.anonymous,
      observerName: fields.anonymous ? "" : fields.observerName,
      observerEmail: fields.anonymous ? "" : fields.observerEmail,
    });
    await clearDraft();
  } catch (error) {
    submitButton.disabled = false;
    showErrors([{ field: "", message: `The report could not be saved: ${error.message}` }]);
    return;
  }

  form.hidden = true;
  document.getElementById("donePanel").hidden = false;
  document.getElementById("doneHeading").focus();
  await updatePendingCount();
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

function applyModeText() {
  const isAbsence = state.mode === "absence";
  document.getElementById("pageTitle").textContent = isAbsence ? "I looked, but saw no sharks" : "Report a shark sighting";
  const effortHeading = form.querySelector('[data-step="effort"] h2');
  effortHeading.textContent = isAbsence ? effortHeading.dataset.headingAbsence : effortHeading.dataset.headingSighting;
}

async function startFresh() {
  const remembered = await getSetting("observer");
  if (remembered) {
    restoreFields(remembered);
  }
  applyModeText();
  updateConditionalFields();
  showStep(0, { focus: false });
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  state.mode = params.get("mode") === "absence" ? "absence" : "sighting";

  renderPrecisionChoices();
  try {
    state.speciesData = await loadSpeciesData();
    renderSpeciesPicker(document.getElementById("speciesPicker"), state.speciesData, null, (speciesId) => {
      renderSpeciesDetail(document.getElementById("speciesDetail"), state.speciesData, speciesId);
      updateConditionalFields();
    });
  } catch (error) {
    document.getElementById("speciesPicker").innerHTML = `<p class="errorSummary">${escapeHtml(error.message)}</p>`;
  }

  form.addEventListener("change", updateConditionalFields);
  form.addEventListener("submit", handleSubmit);
  document.getElementById("nextButton").addEventListener("click", goNext);
  document.getElementById("backButton").addEventListener("click", goBack);
  document.getElementById("photoInput").addEventListener("change", handlePhotoInput);
  document.getElementById("gpsButton").addEventListener("click", useGps);
  document.getElementById("photoLocationButton").addEventListener("click", () => {
    setLocation(state.photoLocation.latitude, state.photoLocation.longitude, "photo");
  });
  document.getElementById("latitude").addEventListener("change", handleCoordinateTyping);
  document.getElementById("longitude").addEventListener("change", handleCoordinateTyping);
  document.getElementById("eventDate").addEventListener("input", () => {
    state.eventDateEditedByUser = true;
    updateEventDateHint();
  });

  const draft = await loadDraft();
  if (draft) {
    const resumePanel = document.getElementById("resumePanel");
    document.getElementById("resumeText").textContent =
      `Started ${formatDateTime(new Date(draft.savedAt))}. Would you like to continue it?`;
    resumePanel.hidden = false;
    document.getElementById("resumeButton").addEventListener("click", () => {
      resumePanel.hidden = true;
      form.hidden = false;
      applyDraft(draft);
    });
    document.getElementById("discardButton").addEventListener("click", async () => {
      await clearDraft();
      resumePanel.hidden = true;
      form.hidden = false;
      await startFresh();
    });
  } else {
    form.hidden = false;
    await startFresh();
  }
}

init();
