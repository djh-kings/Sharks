// report.js
// Runs the step-by-step report form on report.html.
//
// How it works:
// - Every step is a <section data-step="..."> in report.html. Only one is shown at a time.
// - Steps are grouped into named STAGES for the progress bar (stagesByMode).
//   A sighting has five stages: Photo, Where, What, Extras (optional), Check.
//   A "no sharks" report has three: Where, Your trip, Check.
// - "About you" is asked before the first report only. After that the answers
//   are remembered on the phone, and shown (with a Change button) on the
//   check screen.
// - Each step has a validator. Next only moves on if it returns no errors.
// - After every step the whole form is saved as a draft in IndexedDB, so nothing
//   is lost if the phone locks or the app closes.
//
// To add a question: add the input to report.html, then (if it matters) read it
// in buildReport() below and add it to the Darwin Core export in exportDwc.js.

import {
  formatDateTime,
  formatTime,
  formatPosition,
  toIsoWithOffset,
  toLocalInputValue,
  escapeHtml,
  numberInWords,
} from "./format.js";
import { saveReport, saveDraft, loadDraft, clearDraft, getSetting, setSetting, newId } from "./store.js";
import {
  getCurrentPosition,
  precisionOptions,
  uncertaintyMetres,
  validateCoords,
  isInUkIrelandWaters,
  parseTypedCoordinate,
  splitCoordinate,
} from "./geo.js";
import { readPhotoMetadata, preparePhoto } from "./photos.js";
import {
  loadSpeciesData,
  renderSpeciesPicker,
  parseSpeciesChoice,
  describeSpeciesChoice,
} from "./speciesPicker.js";
import { updatePendingCount } from "./app.js";
import { icon } from "./icons.js";

const stagesByMode = {
  sighting: [
    { name: "Photo", steps: ["photo"] },
    { name: "Where", steps: ["where"] },
    { name: "What", steps: ["what", "count"] },
    { name: "Extras", steps: ["extras"], optional: true },
    { name: "Check", steps: ["review"] },
  ],
  absence: [
    { name: "Where", steps: ["where"] },
    { name: "Your trip", steps: ["extras"] },
    { name: "Check", steps: ["review"] },
  ],
};

const maxPhotos = 3;

// Values that are not simple form fields live here.
const state = {
  mode: "sighting",
  includeObserver: false, // true before the first report, or after "Change" on the check screen
  stepIndex: 0,
  returnToReview: false, // true after "Change" on the check screen
  photos: [], // { blob, width, height, takenAt }
  photoLocation: null, // { latitude, longitude } from the first photo that had GPS
  gpsAccuracyMetres: null,
  gpsTime: null,
  locationSource: null, // "gps" | "photo" | "map" | "manual"
  eventDateSource: null, // "now" | "photo" | "user"
  speciesData: null,
  picker: null,
};

const form = document.getElementById("reportForm");
const errorSummary = document.getElementById("errorSummary");
const byId = (id) => document.getElementById(id);
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
    byId(id).disabled = anonymous;
  }

  const choice = parseSpeciesChoice(state.speciesData || { species: [] }, fields.speciesId);
  byId("confidenceField").hidden = !fields.speciesId || choice.isNotSure;
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
    const typed = readTypedPosition();
    if (typed.errors.length > 0) {
      for (const message of typed.errors) errors.push({ field: "typedPosition", message });
    } else if (fields.latitude === "" || fields.longitude === "") {
      errors.push({
        field: "latitude",
        message: "Give a position: use your current position, tap the map, or type it in.",
      });
    } else {
      for (const message of validateCoords(Number(fields.latitude), Number(fields.longitude))) {
        errors.push({ field: "latitude", message });
      }
    }
    if (!fields.precision) errors.push({ field: "precision", message: "Say how close the position is to the shark." });

    if (!fields.eventDate) {
      errors.push({ field: "eventDate", message: "Give the date and time." });
    } else {
      const date = new Date(fields.eventDate);
      const fiveMinutesAhead = Date.now() + 5 * 60 * 1000;
      if (Number.isNaN(date.getTime())) {
        errors.push({ field: "eventDate", message: "The date and time are not valid." });
      } else if (date.getTime() > fiveMinutesAhead) {
        errors.push({ field: "eventDate", message: "The date and time cannot be in the future." });
      }
    }
    return errors;
  },

  what(fields) {
    const errors = [];
    if (!fields.speciesId) {
      errors.push({ field: "speciesId", message: 'Choose a species, or "Not sure".' });
    } else if (!parseSpeciesChoice(state.speciesData, fields.speciesId).isNotSure && !fields.confidence) {
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

  extras(fields) {
    const errors = [];
    const duration = numberOrNull(fields.durationMinutes);
    // For a "no sharks" record, the time spent looking is the whole point.
    if (state.mode === "absence" && duration === null) {
      errors.push({
        field: "durationMinutes",
        message: 'Say how long you were looking. Without this, a "no sharks" record cannot be used.',
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
    if (state.mode === "sighting") {
      if (fields.depthMetres !== "" && numberOrNull(fields.depthMetres) === null) {
        errors.push({ field: "depthMetres", message: "Depth must be a number." });
      }
      if (fields.waterTempCelsius !== "") {
        const temperature = numberOrNull(fields.waterTempCelsius);
        if (temperature === null || temperature < -2 || temperature > 35) {
          errors.push({ field: "waterTempCelsius", message: "Water temperature should be between -2 and 35 degrees." });
        }
      }
    }
    return errors;
  },

  review() {
    return [];
  },
};

// Fields that are not a single named input: where to show the red border.
const errorTargets = {
  typedPosition: () => [...form.querySelectorAll("#typePosition input[type='text']")],
  latitude: () => [byId("gpsButton")],
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
  errorSummary.innerHTML = `<strong>There is a problem. Please check the following:</strong><ul>${items}</ul>`;
  errorSummary.hidden = false;
  for (const error of errors) {
    const targets = errorTargets[error.field]?.() || form.querySelectorAll(`[name="${error.field}"]`);
    for (const element of targets) {
      (element.closest(".choice, .speciesCard, .notSureCard, .segment") || element).classList.add("fieldError");
      // Open any folded section, so the problem can be seen.
      element.closest("details")?.setAttribute("open", "");
    }
    if (error.field === "eventDate") {
      setWhenEditing(true);
    }
  }
  errorSummary.focus();
}

// Once the user changes an answer, its red border goes. The summary at the
// top stays until they press Next, so they can still read what was wrong.
function clearFieldError(event) {
  const target = event.target;
  const elements = target.name ? form.querySelectorAll(`[name="${target.name}"]`) : [target];
  for (const element of elements) {
    (element.closest(".choice, .speciesCard, .notSureCard, .segment") || element).classList.remove("fieldError");
  }
  // Every speciesId radio is one answer, wherever it sits in the picker.
  if (target.name === "speciesId" || target.closest?.("#typePosition")) {
    const scope = target.name === "speciesId" ? byId("speciesPicker") : byId("typePosition");
    for (const element of scope.querySelectorAll(".fieldError")) element.classList.remove("fieldError");
  }
}

// ---------------------------------------------------------------------------
// Moving between steps
// ---------------------------------------------------------------------------

function currentSteps() {
  const steps = stagesByMode[state.mode].flatMap((stage) => stage.steps);
  return state.includeObserver ? ["observer", ...steps] : steps;
}

function renderProgress(stepName) {
  const stages = stagesByMode[state.mode];
  const currentIndex = stages.findIndex((stage) => stage.steps.includes(stepName));
  byId("progressText").textContent =
    currentIndex === -1
      ? "Before you start"
      : `Stage ${numberInWords(currentIndex + 1)} of ${numberInWords(stages.length)}: ${stages[currentIndex].name}`;
  byId("stageList").innerHTML = stages
    .map((stage, index) => {
      const classes = [];
      if (currentIndex !== -1 && index < currentIndex) classes.push("stageDone");
      if (stage.optional) classes.push("stageOptional");
      const current = index === currentIndex ? ' aria-current="step"' : "";
      const done = classes.includes("stageDone") ? '<span class="visuallyHidden"> (done)</span>' : "";
      const optional = stage.optional ? '<span class="visuallyHidden"> (optional)</span>' : "";
      return `<li class="${classes.join(" ")}"${current}><span class="stageName">${stage.name}</span>${done}${optional}</li>`;
    })
    .join("");
}

function showStep(index, { focus = true } = {}) {
  const steps = currentSteps();
  state.stepIndex = Math.max(0, Math.min(index, steps.length - 1));
  const stepName = steps[state.stepIndex];

  for (const section of form.querySelectorAll(".step")) {
    section.hidden = section.dataset.step !== stepName;
  }
  const section = form.querySelector(`[data-step="${stepName}"]`);
  renderProgress(stepName);

  const isLast = stepName === "review";
  byId("backButton").hidden = state.stepIndex === 0;
  byId("nextButton").hidden = isLast;
  byId("nextButton").textContent = state.returnToReview ? "Back to check" : "Next";
  byId("submitButton").hidden = !isLast;
  showErrors([]);

  stepEnterHooks[stepName]?.();
  if (focus) {
    section.querySelector("h2").focus();
    window.scrollTo(0, 0);
  }
}

function showStepByName(stepName) {
  showStep(currentSteps().indexOf(stepName));
}

const stepEnterHooks = {
  where() {
    const online = navigator.onLine;
    byId("mapOfflineNote").hidden = online;
    byId("locationMap").hidden = !online;
    if (!online) {
      byId("typePosition").open = true;
    }
    if (online) {
      initMap();
    }
    byId("photoLocationButton").hidden = !state.photoLocation;

    const input = byId("eventDate");
    input.max = toLocalInputValue(new Date());
    if (!input.value) {
      input.value = toLocalInputValue(new Date());
      state.eventDateSource = "now";
    }
    updateWhen();
    updatePositionCard();
  },
  extras() {
    applyModeText();
  },
  review() {
    renderReview();
  },
};

// Validates the current step and returns true if it passed.
function checkCurrentStep() {
  const stepName = currentSteps()[state.stepIndex];
  const errors = validators[stepName](collectFields());
  if (errors.length > 0) {
    showErrors(errors);
    return false;
  }
  return true;
}

async function goNext() {
  if (!checkCurrentStep()) {
    return;
  }
  if (state.returnToReview) {
    state.returnToReview = false;
    showStepByName("review");
  } else {
    showStep(state.stepIndex + 1);
  }
  await persistDraft();
}

async function goBack() {
  state.returnToReview = false;
  showStep(state.stepIndex - 1);
  await persistDraft();
}

async function skipToReview() {
  if (!checkCurrentStep()) {
    return;
  }
  state.returnToReview = false;
  showStepByName("review");
  await persistDraft();
}

// A "Change" button on the check screen.
function changeStep(stepName) {
  if (stepName === "observer") {
    state.includeObserver = true;
  }
  state.returnToReview = true;
  showStepByName(stepName);
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

async function persistDraft() {
  try {
    await saveDraft({
      mode: state.mode,
      includeObserver: state.includeObserver,
      stepName: currentSteps()[state.stepIndex],
      fields: collectFields(),
      photos: state.photos,
      photoLocation: state.photoLocation,
      gpsAccuracyMetres: state.gpsAccuracyMetres,
      gpsTime: state.gpsTime,
      locationSource: state.locationSource,
      eventDateSource: state.eventDateSource,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    // A failed draft save should never stop the user reporting.
    console.warn("Could not save draft:", error);
  }
}

function applyDraft(draft) {
  state.mode = draft.mode;
  state.includeObserver = Boolean(draft.includeObserver);
  state.photos = draft.photos || [];
  state.photoLocation = draft.photoLocation || null;
  state.gpsAccuracyMetres = draft.gpsAccuracyMetres ?? null;
  state.gpsTime = draft.gpsTime || null;
  state.locationSource = draft.locationSource || null;
  state.eventDateSource = draft.eventDateSource || null;
  restoreFields(draft.fields || {});
  fillTypedPosition();
  state.picker?.showForValue(draft.fields?.speciesId);
  renderPhotoList();
  applyModeText();
  updateConditionalFields();
  const index = currentSteps().indexOf(draft.stepName);
  showStep(index === -1 ? 0 : index);
}

async function saveAndExit() {
  if (!form.hidden) {
    await persistDraft();
  }
  window.location.href = "index.html";
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

async function handlePhotoInput(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = ""; // so choosing the same file again still triggers "change"
  const status = byId("photoStatus");
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
        if (!byId("latitude").value) {
          setLocation(metadata.latitude, metadata.longitude, "photo");
          messages.push("The location has been filled in from your photo. Please check it.");
        }
      }
      if (metadata.takenAt && state.eventDateSource !== "user") {
        byId("eventDate").value = toLocalInputValue(metadata.takenAt);
        state.eventDateSource = "photo";
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
  const list = byId("photoList");
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
  byId("precisionChoices").innerHTML = Object.entries(precisionOptions)
    .map(
      ([value, option]) =>
        `<label class="choice"><input type="radio" name="precision" value="${value}"><span class="choiceMark"></span>` +
        `<span class="choiceText">${escapeHtml(option.label)}${option.hint ? `<small>${escapeHtml(option.hint)}</small>` : ""}</span></label>`
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
  const lat = numberOrNull(byId("latitude").value);
  const lon = numberOrNull(byId("longitude").value);
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

// Sets the saved position. Everything that shows the position is updated from here.
function setLocation(latitude, longitude, source, { moveMap = true, fillTyped = true } = {}) {
  byId("latitude").value = latitude.toFixed(5);
  byId("longitude").value = longitude.toFixed(5);
  state.locationSource = source;
  if (source !== "gps") {
    // The GPS accuracy no longer describes this point.
    state.gpsAccuracyMetres = null;
  }
  placeMarker(latitude, longitude);
  if (map && moveMap) {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 11));
  }
  if (fillTyped) {
    fillTypedPosition();
  }
  byId("boundsWarning").hidden = isInUkIrelandWaters(latitude, longitude);
  updatePositionCard();
}

function clearLocation() {
  byId("latitude").value = "";
  byId("longitude").value = "";
  state.locationSource = null;
  state.gpsAccuracyMetres = null;
  byId("boundsWarning").hidden = true;
  updatePositionCard();
}

function updatePositionCard() {
  const lat = numberOrNull(byId("latitude").value);
  const lon = numberOrNull(byId("longitude").value);
  const card = byId("positionCard");
  if (lat === null || lon === null) {
    card.hidden = true;
    return;
  }
  const sources = {
    gps: "Position found",
    photo: "Position from your photo",
    map: "Pin placed on the map",
    manual: "Position typed in",
  };
  byId("positionSource").textContent = sources[state.locationSource] || "Position";
  byId("positionText").innerHTML = formatPosition(lat, lon)
    .split(", ")
    .map((part) => `<span>${escapeHtml(part)}</span>`)
    .join("");
  byId("positionAccuracy").textContent =
    state.locationSource === "gps" && state.gpsAccuracyMetres
      ? `GPS accurate to about ${state.gpsAccuracyMetres}m${state.gpsTime ? `, at ${formatTime(new Date(state.gpsTime))}` : ""}.`
      : "";
  card.hidden = false;
}

async function useGps() {
  const status = byId("gpsStatus");
  const button = byId("gpsButton");
  status.textContent = "Finding your position. At sea this can take up to 30 seconds...";
  button.disabled = true;
  try {
    const position = await getCurrentPosition();
    state.gpsTime = new Date().toISOString();
    setLocation(position.latitude, position.longitude, "gps");
    state.gpsAccuracyMetres = position.accuracyMetres;
    updatePositionCard();
    status.textContent = `Position found, accurate to about ${position.accuracyMetres}m. Drag the pin if the shark was somewhere else.`;
    await persistDraft();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

// ---- Typed positions (degrees and minutes, or decimal degrees) ----

function typedFormat() {
  return form.querySelector('input[name="coordFormat"]:checked')?.value || "ddm";
}

function showTypedFormat() {
  const format = typedFormat();
  for (const row of form.querySelectorAll("#typePosition [data-format]")) {
    row.hidden = row.dataset.format !== format;
  }
}

// Reads both typed coordinates. Returns { latitude, longitude, errors, empty }.
function readTypedPosition() {
  const format = typedFormat();
  const hemisphere = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value || "";
  const lat = parseTypedCoordinate({
    axis: "lat",
    format,
    degrees: byId("latDegrees").value,
    minutes: byId("latMinutes").value,
    decimal: byId("latDecimal").value,
    hemisphere: hemisphere("latHemisphere"),
  });
  const lon = parseTypedCoordinate({
    axis: "lon",
    format,
    degrees: byId("lonDegrees").value,
    minutes: byId("lonMinutes").value,
    decimal: byId("lonDecimal").value,
    hemisphere: hemisphere("lonHemisphere"),
  });
  const errors = [lat.error, lon.error].filter(Boolean);
  const empty = lat.value === null && lon.value === null && errors.length === 0;
  if (!empty && errors.length === 0 && (lat.value === null || lon.value === null)) {
    errors.push(lat.value === null ? "Type the latitude as well." : "Type the longitude as well.");
  }
  return { latitude: lat.value, longitude: lon.value, latError: lat.error, lonError: lon.error, errors, empty };
}

function showTypedErrors(typed) {
  for (const [id, message] of [["latError", typed.latError], ["lonError", typed.lonError]]) {
    const element = byId(id);
    element.hidden = !message;
    element.innerHTML = message ? `${icon("alert")}<span>Error: ${escapeHtml(message)}</span>` : "";
  }
}

// Called whenever a typed box, direction, or format changes.
function handleTypedPosition() {
  const typed = readTypedPosition();
  showTypedErrors(typed);
  if (typed.errors.length === 0 && !typed.empty) {
    setLocation(typed.latitude, typed.longitude, "manual", { fillTyped: false });
  } else if (!typed.empty) {
    // A half-typed position must not leave an old one saved without the user knowing.
    clearLocation();
  }
}

// Copies the saved position into the typed boxes (both formats).
function fillTypedPosition() {
  const lat = numberOrNull(byId("latitude").value);
  const lon = numberOrNull(byId("longitude").value);
  if (lat === null || lon === null) {
    return;
  }
  for (const [axis, value, prefix, hemisphereName] of [
    ["lat", lat, "lat", "latHemisphere"],
    ["lon", lon, "lon", "lonHemisphere"],
  ]) {
    const parts = splitCoordinate(value, axis);
    byId(`${prefix}Degrees`).value = parts.degrees;
    byId(`${prefix}Minutes`).value = parts.minutes;
    byId(`${prefix}Decimal`).value = parts.decimal;
    const radio = form.querySelector(`input[name="${hemisphereName}"][value="${parts.hemisphere}"]`);
    if (radio) radio.checked = true;
  }
  showTypedErrors({ latError: null, lonError: null });
}

// ---------------------------------------------------------------------------
// Date and time
// ---------------------------------------------------------------------------

function updateWhen() {
  const value = byId("eventDate").value;
  const date = value ? new Date(value) : null;
  const valid = date && !Number.isNaN(date.getTime());
  const text = valid ? formatDateTime(date) : "Not set";
  byId("eventDateHint").textContent = valid ? text : "";
  byId("whenText").textContent = text;
  const sources = { now: "Set to now", photo: "Taken from your photo", user: "Set by you" };
  byId("whenSource").textContent = sources[state.eventDateSource] || "";
}

function setWhenEditing(editing) {
  byId("whenEdit").hidden = !editing;
  byId("whenChange").setAttribute("aria-expanded", String(editing));
}

// ---------------------------------------------------------------------------
// Time spent looking: quick buttons that fill in the minutes box
// ---------------------------------------------------------------------------

function handleDurationPreset(event) {
  if (event.target.name !== "durationPreset") {
    return;
  }
  const input = byId("durationMinutes");
  if (event.target.value === "other") {
    input.focus();
  } else {
    input.value = event.target.value;
  }
}

function syncDurationPreset() {
  const value = byId("durationMinutes").value.trim();
  const presets = [...form.querySelectorAll('input[name="durationPreset"]')];
  const match = presets.find((radio) => radio.value === value);
  for (const radio of presets) {
    radio.checked = match ? radio === match : value !== "" && radio.value === "other";
  }
}

// ---------------------------------------------------------------------------
// Building the final report
// ---------------------------------------------------------------------------

function buildReport(fields) {
  const isSighting = state.mode === "sighting";
  const anonymous = Boolean(fields.anonymous);
  const encounterNeedsGear = ["caughtReleased", "bycatch"].includes(fields.encounterType);
  const choice = isSighting ? parseSpeciesChoice(state.speciesData, fields.speciesId) : null;

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
      locality: fields.locality || null,
    },
    eventDate: toIsoWithOffset(new Date(fields.eventDate)),
    identification: isSighting
      ? {
          speciesId: choice.speciesId,
          // Set when the observer was sure of the kind of shark but not the species.
          speciesGroup: choice.isNotSure ? choice.groupId : null,
          confidence: choice.isNotSure ? null : fields.confidence,
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

// Human-readable labels for the check screen, taken from the form itself so
// the wording is only written once (in report.html).
function labelFor(name, value) {
  const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) {
    const label = input.closest("label");
    const text = label.querySelector(".choiceText");
    return text ? text.firstChild.textContent.trim() : label.textContent.trim();
  }
  const option = form.querySelector(`select[name="${name}"] option[value="${value}"]`);
  return option ? option.textContent : value;
}

function renderReview() {
  const fields = collectFields();
  const rows = [];
  // Each row: what it is, the answer, a second line, and which step "Change" goes to.
  const add = (label, value, sub, step) => rows.push({ label, value, sub, step });
  const isSighting = state.mode === "sighting";

  if (!isSighting) {
    add("Type of report", "No sharks seen", null, null);
  }
  if (isSighting) {
    add("Photos", state.photos.length ? `${numberInWords(state.photos.length)} ${state.photos.length === 1 ? "photo" : "photos"}` : "No photo", state.photos.length ? "Location data removed" : null, "photo");
  }
  if (fields.latitude) {
    const precision = precisionOptions[fields.precision]?.label;
    add("Where", formatPosition(Number(fields.latitude), Number(fields.longitude)), [precision, fields.locality].filter(Boolean).join(". "), "where");
  }
  if (fields.eventDate) add("When", formatDateTime(new Date(fields.eventDate)), null, "where");

  if (isSighting) {
    const choice = parseSpeciesChoice(state.speciesData, fields.speciesId);
    add("What", describeSpeciesChoice(state.speciesData, choice.speciesId, choice.groupId), choice.isNotSure ? null : labelFor("confidence", fields.confidence), "what");
    const gearShown = !form.querySelector('[data-show-when^="encounterType"]').hidden;
    add(
      "How many",
      `${fields.individualCount}${fields.countIsEstimate ? " (an estimate)" : ""}`,
      [labelFor("encounterType", fields.encounterType), gearShown && fields.gearType ? labelFor("gearType", fields.gearType) : ""].filter(Boolean).join(". "),
      "count"
    );
    const shark = [];
    if (fields.lengthBand) shark.push(labelFor("lengthBand", fields.lengthBand));
    if (fields.sex) shark.push(labelFor("sex", fields.sex));
    if (fields.behaviour?.length) shark.push(fields.behaviour.map((b) => labelFor("behaviour", b)).join(", "));
    if (fields.depthMetres) shark.push(`${fields.depthMetres}m deep`);
    if (fields.waterTempCelsius) shark.push(`Water ${fields.waterTempCelsius}°C`);
    if (shark.length) add("The shark", shark.join(". "), null, "extras");
  }

  const trip = [];
  if (fields.durationMinutes) trip.push(`${fields.durationMinutes} minutes`);
  if (fields.minDepthMetres || fields.maxDepthMetres) trip.push(`${fields.minDepthMetres || "?"}m to ${fields.maxDepthMetres || "?"}m deep`);
  add("Your dive or trip", trip.length ? trip.join(", ") : "Not given", null, "extras");

  if (isSighting && (fields.tagsSeen || fields.notes)) {
    add("Tags and notes", [fields.tagsSeen, fields.notes].filter(Boolean).join(". "), null, "extras");
  }

  const role = labelFor("role", fields.role) + (fields.role === "fisher" && fields.fisherType ? ` (${labelFor("fisherType", fields.fisherType)})` : "");
  const who = fields.anonymous ? "Anonymous" : fields.observerName || "Name not given";
  add("Reporting as", role, `${labelFor("experience", fields.experience)} about sharks. ${who}.`, "observer");

  const html = rows
    .map(
      (row) => `
      <div class="checkRow">
        <div>
          <dt>${escapeHtml(row.label)}</dt>
          <dd><strong>${escapeHtml(row.value)}</strong>${row.sub ? `<span>${escapeHtml(row.sub)}</span>` : ""}</dd>
        </div>
        ${row.step ? `<button type="button" class="textButton" data-goto="${row.step}">Change<span class="visuallyHidden"> ${escapeHtml(row.label.toLowerCase())}</span></button>` : ""}
      </div>`
    )
    .join("");
  byId("reviewSummary").innerHTML = `<dl class="checkList">${html}</dl>`;
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
  const submitButton = byId("submitButton");
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
  byId("donePanel").hidden = false;
  byId("doneHeading").focus();
  await updatePendingCount();
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

function applyModeText() {
  const isAbsence = state.mode === "absence";
  byId("pageTitle").textContent = isAbsence ? "No sharks seen" : "Report a sighting";
  document.title = `${isAbsence ? "I looked, but saw no sharks" : "Report a sighting"} | Shark Sightings`;
  byId("extrasHeading").textContent = isAbsence ? "Your dive or trip" : "Anything more to add?";
  if (!isAbsence) {
    byId("extrasHeading").insertAdjacentHTML("beforeend", '<span class="optionalTag">Optional</span>');
  }
  byId("extrasLead").innerHTML = isAbsence
    ? "Tell us about the dive or trip where you saw no sharks. The time spent looking is needed; the depths are optional."
    : "Everything here is <strong>optional</strong>. Add what you can, or skip straight to checking your report.";
  byId("skipButton").hidden = isAbsence;
  byId("effortBadge").textContent = isAbsence ? "Needed" : "Most useful";
  for (const element of form.querySelectorAll("[data-sighting-only]")) {
    element.hidden = isAbsence;
  }
  if (isAbsence) {
    byId("effortFold").open = true;
  }
}

async function startFresh() {
  const remembered = await getSetting("observer");
  if (remembered) {
    restoreFields(remembered);
  }
  state.includeObserver = !remembered;
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
    state.picker = renderSpeciesPicker(byId("speciesPicker"), state.speciesData, {
      onChange: () => updateConditionalFields(),
    });
  } catch (error) {
    byId("speciesPicker").innerHTML = `<p class="errorSummary">${escapeHtml(error.message)}</p>`;
  }

  form.addEventListener("change", updateConditionalFields);
  form.addEventListener("change", handleDurationPreset);
  form.addEventListener("change", clearFieldError);
  form.addEventListener("input", clearFieldError);
  form.addEventListener("submit", handleSubmit);
  byId("nextButton").addEventListener("click", goNext);
  byId("backButton").addEventListener("click", goBack);
  byId("skipButton").addEventListener("click", skipToReview);
  byId("saveExitButton").addEventListener("click", saveAndExit);
  byId("photoInput").addEventListener("change", handlePhotoInput);
  byId("gpsButton").addEventListener("click", useGps);
  byId("photoLocationButton").addEventListener("click", () => {
    setLocation(state.photoLocation.latitude, state.photoLocation.longitude, "photo");
  });

  for (const id of ["latDegrees", "latMinutes", "latDecimal", "lonDegrees", "lonMinutes", "lonDecimal"]) {
    byId(id).addEventListener("change", handleTypedPosition);
  }
  for (const radio of form.querySelectorAll('input[name="latHemisphere"], input[name="lonHemisphere"]')) {
    radio.addEventListener("change", handleTypedPosition);
  }
  for (const radio of form.querySelectorAll('input[name="coordFormat"]')) {
    radio.addEventListener("change", () => {
      showTypedFormat();
      fillTypedPosition();
    });
  }

  byId("whenChange").addEventListener("click", () => {
    const editing = byId("whenEdit").hidden;
    setWhenEditing(editing);
    if (editing) byId("eventDate").focus();
  });
  byId("eventDate").addEventListener("input", () => {
    state.eventDateSource = "user";
    updateWhen();
  });
  byId("durationMinutes").addEventListener("input", syncDurationPreset);
  byId("reviewSummary").addEventListener("click", (event) => {
    const button = event.target.closest("[data-goto]");
    if (button) changeStep(button.dataset.goto);
  });

  const draft = await loadDraft();
  if (draft) {
    const resumePanel = byId("resumePanel");
    byId("resumeText").textContent = `Started ${formatDateTime(new Date(draft.savedAt))}. Would you like to continue it?`;
    resumePanel.hidden = false;
    byId("resumeButton").addEventListener("click", () => {
      resumePanel.hidden = true;
      form.hidden = false;
      applyDraft(draft);
    });
    byId("discardButton").addEventListener("click", async () => {
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
