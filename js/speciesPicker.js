// speciesPicker.js
// Loads the species list and draws the "What did you see?" picker.
//
// Design choices:
// - "Not sure" comes FIRST, with the same weight as any species. An honest
//   "not sure, but here is a photo" is far more useful to a biologist than a
//   confident wrong answer.
// - The user chooses a body shape first, then a species. Every shape also has
//   its own "Not sure which catshark" (and so on), so a record that is only
//   sure of the group is not thrown away.
// - Lookalikes can be compared side by side before choosing.
//
// The chosen value is one radio group called speciesId. Its value is one of:
//   "notSure"               not sure at all
//   "notSure-catsharks"     sure of the group, not the species
//   "smallSpottedCatshark"  a species id from data/species.json
//
// On a phone, the shapes and the species are two views of the same screen.
// On a computer (see styles.css) they sit side by side.

import { escapeHtml } from "./format.js";
import { icon } from "./icons.js";

export const notSureId = "notSure";
const groupNotSurePrefix = "notSure-";

let speciesDataPromise = null;

export function loadSpeciesData() {
  if (!speciesDataPromise) {
    speciesDataPromise = fetch("data/species.json").then((response) => {
      if (!response.ok) {
        throw new Error("The species list could not be loaded.");
      }
      return response.json();
    });
  }
  return speciesDataPromise;
}

export function findSpecies(data, speciesId) {
  return data.species.find((s) => s.id === speciesId) || null;
}

export function findGroup(data, groupId) {
  return data.groups.find((g) => g.id === groupId) || null;
}

// Splits a picker value into what it means.
// Returns { speciesId, groupId, isNotSure }.
export function parseSpeciesChoice(data, value) {
  if (!value) {
    return { speciesId: null, groupId: null, isNotSure: false };
  }
  if (value === notSureId) {
    return { speciesId: notSureId, groupId: null, isNotSure: true };
  }
  if (value.startsWith(groupNotSurePrefix)) {
    return { speciesId: notSureId, groupId: value.slice(groupNotSurePrefix.length), isNotSure: true };
  }
  const species = findSpecies(data, value);
  return { speciesId: value, groupId: species?.group || null, isNotSure: false };
}

// A short description of the choice, for the check screen and My reports.
export function describeSpeciesChoice(data, speciesId, groupId) {
  if (speciesId && speciesId !== notSureId) {
    return findSpecies(data, speciesId)?.commonName || "Shark";
  }
  const group = groupId ? findGroup(data, groupId) : null;
  return group ? `Not sure (${group.notSureLabel.replace(/^Not sure which /, "a ")})` : "Not sure";
}

function silhouette(group, className = "shapeImage") {
  return `<span class="${className}"><img src="${group.silhouette}" alt="" width="240" height="96"></span>`;
}

function speciesCardHtml(data, species) {
  const group = findGroup(data, species.group);
  return `
    <label class="speciesCard">
      <input type="radio" name="speciesId" value="${species.id}">
      <span class="choiceMark"></span>
      ${silhouette(group)}
      <span class="speciesCardText">
        <span class="speciesCardName">${escapeHtml(species.commonName)}</span>
        <span class="speciesCardSci">${escapeHtml(species.scientificName)}</span>
        <span class="speciesCardHint">${escapeHtml(species.keyFeatures[0] || "")}</span>
      </span>
    </label>`;
}

// Draws the picker into `container`. Calls onChange(value) when the choice
// changes. Returns { showForValue(value) } so a restored draft can open the
// right view.
export function renderSpeciesPicker(container, data, { onChange }) {
  const shapeButtons = data.groups
    .map(
      (group) => `
      <li>
        <button type="button" class="shapeButton" data-group="${group.id}" aria-pressed="false">
          ${silhouette(group)}
          <span class="shapeText">
            <strong>${escapeHtml(group.name)}</strong>
            <span>${escapeHtml(group.hint)}</span>
          </span>
          <span class="chevron">${icon("chevron")}</span>
        </button>
      </li>`
    )
    .join("");

  const groupPanels = data.groups
    .map((group) => {
      const members = data.species.filter((s) => s.group === group.id);
      return `
      <section class="groupPanel" data-group="${group.id}" hidden>
        <h3 tabindex="-1">${escapeHtml(group.question)}</h3>
        <label class="choice">
          <input type="radio" name="speciesId" value="${groupNotSurePrefix}${group.id}">
          <span class="choiceMark"></span>
          <span class="choiceText">${escapeHtml(group.notSureLabel)}<small>Still useful. We will record the kind of shark.</small></span>
        </label>
        ${members.map((species) => speciesCardHtml(data, species)).join("")}
      </section>`;
    })
    .join("");

  container.innerHTML = `
    <div class="picker" data-view="shapes">
      <div class="pickerShapes">
        <label class="notSureCard">
          <input type="radio" name="speciesId" value="${notSureId}">
          <span class="notSureIcon">${icon("question")}</span>
          <span class="notSureText">
            <strong>Not sure</strong>
            <span>Still a useful record. An expert can identify it from your photo.</span>
          </span>
        </label>
        <h3 id="shapesHeading" tabindex="-1">Or choose its shape</h3>
        <ul class="shapeList">${shapeButtons}</ul>
        <p class="hint">Know the name already?</p>
        <button type="button" class="button buttonSecondary buttonFull" data-show-all>${icon("list")}Show all ${data.species.length} species</button>
      </div>
      <div class="pickerSpecies">
        <button type="button" class="backLink" data-show-shapes>${icon("back")}All shapes</button>
        <div class="groupPanels">${groupPanels}</div>
      </div>
      <div class="pickerDetail">
        <div id="speciesDetail" class="speciesDetail" aria-live="polite" hidden></div>
      </div>
    </div>`;

  const picker = container.querySelector(".picker");
  const detail = container.querySelector("#speciesDetail");
  const detailHome = container.querySelector(".pickerDetail");
  // On a computer the details have their own column. On a phone or tablet
  // they go straight under the chosen card, so they are seen at once.
  const wideScreen = window.matchMedia("(min-width: 68.75rem)");

  function placeDetail() {
    const chosen = picker.querySelector('.groupPanel:not([hidden]) input[name="speciesId"]:checked');
    const card = chosen?.closest(".speciesCard");
    if (!wideScreen.matches && card) {
      card.after(detail);
    } else if (detail.parentElement !== detailHome) {
      detailHome.append(detail);
    }
  }
  wideScreen.addEventListener("change", placeDetail);
  const dialog = createCompareDialog();

  function setView(view, { focus = false } = {}) {
    picker.dataset.view = view;
    const groupId = view.startsWith("group:") ? view.slice(6) : null;
    for (const panel of picker.querySelectorAll(".groupPanel")) {
      panel.hidden = view !== "all" && panel.dataset.group !== groupId;
    }
    for (const button of picker.querySelectorAll(".shapeButton")) {
      button.setAttribute("aria-pressed", String(button.dataset.group === groupId));
    }
    placeDetail();
    if (focus) {
      const target =
        view === "shapes" ? picker.querySelector("#shapesHeading") : picker.querySelector(".groupPanel:not([hidden]) h3");
      target?.focus();
    }
  }

  function choose(value) {
    const input = picker.querySelector(`input[name="speciesId"][value="${value}"]`);
    if (input) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function showDetail(value) {
    const choice = parseSpeciesChoice(data, value);
    const species = choice.isNotSure ? null : findSpecies(data, choice.speciesId);
    if (!species) {
      detail.hidden = true;
      detail.innerHTML = "";
      return;
    }
    const group = findGroup(data, species.group);
    const features = species.keyFeatures.map((f) => `<li>${icon("check")}<span>${escapeHtml(f)}</span></li>`).join("");
    const lookalikes = species.lookalikes.map((id) => findSpecies(data, id)).filter(Boolean);
    const compare = lookalikes.length
      ? `<div class="lookalikeBox">
          <p><strong>Often confused with</strong> ${lookalikes.map((s) => escapeHtml(s.commonName.toLowerCase())).join(" and ")}.</p>
          ${lookalikes
            .map(
              (other) =>
                `<button type="button" class="button buttonSecondary" data-compare="${other.id}">${icon("compare")}${
                  lookalikes.length === 1 ? "Compare the two" : `Compare with ${escapeHtml(other.commonName.toLowerCase())}`
                }</button>`
            )
            .join("")}
        </div>`
      : "";
    detail.innerHTML = `
      <div class="speciesDetailImage">
        <img src="${group.silhouette}" alt="" width="240" height="96">
        <span class="imageNote">Illustration to come</span>
      </div>
      <div class="speciesDetailBody">
        <h3>${escapeHtml(species.commonName)}</h3>
        <p class="speciesCardSci">${escapeHtml(species.scientificName)}</p>
        <p><strong>Did you see these features?</strong></p>
        <ul class="features">${features}</ul>
        ${compare}
      </div>`;
    detail.hidden = false;
    placeDetail();
    for (const button of detail.querySelectorAll("[data-compare]")) {
      button.addEventListener("click", () =>
        openCompare(dialog, data, species, findSpecies(data, button.dataset.compare), choose)
      );
    }
  }

  picker.addEventListener("click", (event) => {
    const shape = event.target.closest(".shapeButton");
    if (shape) {
      setView(`group:${shape.dataset.group}`, { focus: true });
    } else if (event.target.closest("[data-show-shapes]")) {
      setView("shapes", { focus: true });
    } else if (event.target.closest("[data-show-all]")) {
      setView("all", { focus: true });
    }
  });

  picker.addEventListener("change", (event) => {
    if (event.target.name === "speciesId") {
      showDetail(event.target.value);
      onChange(event.target.value);
    }
  });

  return {
    showForValue(value) {
      const choice = parseSpeciesChoice(data, value);
      setView(choice.groupId ? `group:${choice.groupId}` : "shapes");
      showDetail(value);
    },
  };
}

// ---------------------------------------------------------------------------
// Comparing two lookalikes
// ---------------------------------------------------------------------------

function createCompareDialog() {
  let dialog = document.getElementById("compareDialog");
  if (dialog) {
    return dialog;
  }
  dialog = document.createElement("dialog");
  dialog.id = "compareDialog";
  dialog.className = "compareDialog";
  dialog.setAttribute("aria-labelledby", "compareHeading");
  document.body.append(dialog);
  return dialog;
}

function openCompare(dialog, data, first, second, choose) {
  const groupA = findGroup(data, first.group);
  const groupB = findGroup(data, second.group);
  const rows = Math.max(first.keyFeatures.length, second.keyFeatures.length);
  let body = "";
  for (let i = 0; i < rows; i += 1) {
    body += `<tr><td>${escapeHtml(first.keyFeatures[i] || "")}</td><td>${escapeHtml(second.keyFeatures[i] || "")}</td></tr>`;
  }
  // "Still not sure" keeps what the user IS sure of: the group, if both share one.
  const stillNotSure = first.group === second.group ? `${groupNotSurePrefix}${first.group}` : notSureId;

  dialog.innerHTML = `
    <div class="compareHeader">
      <h2 id="compareHeading">Compare lookalikes</h2>
      <button type="button" class="button buttonSecondary" data-close>${icon("close")}Close</button>
    </div>
    <div class="compareBody">
      <p class="hint">Look at the key features of each. Size can overlap, so check the other features too.</p>
      <table class="compareTable">
        <caption class="visuallyHidden">${escapeHtml(first.commonName)} compared with ${escapeHtml(second.commonName)}</caption>
        <thead>
          <tr>
            <th scope="col">${silhouette(groupA)}${escapeHtml(first.commonName)}</th>
            <th scope="col">${silhouette(groupB)}${escapeHtml(second.commonName)}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <div class="compareActions">
        <button type="button" class="button" data-choose="${first.id}">It was a ${escapeHtml(first.commonName.toLowerCase())}</button>
        <button type="button" class="button" data-choose="${second.id}">It was a ${escapeHtml(second.commonName.toLowerCase())}</button>
        <button type="button" class="button buttonSecondary" data-choose="${stillNotSure}">Still not sure which</button>
      </div>
    </div>`;

  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  for (const button of dialog.querySelectorAll("[data-choose]")) {
    button.addEventListener("click", () => {
      dialog.close();
      choose(button.dataset.choose);
    });
  }
  dialog.showModal();
}
