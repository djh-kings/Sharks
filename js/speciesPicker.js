// speciesPicker.js
// Loads the species list and draws the "What did you see?" picker.
//
// Design choice: "Not sure" comes FIRST, not last. An honest "not sure, but
// here is a photo" is far more useful to a biologist than a confident wrong
// answer, and putting it first tells the user that it is a respectable choice.

import { escapeHtml } from "./format.js";

export const notSureId = "notSure";

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

// Draws radio-button cards into `container`. Calls onChange(speciesId) when the choice changes.
export function renderSpeciesPicker(container, data, selectedId, onChange) {
  const notSureChecked = selectedId === notSureId ? "checked" : "";
  let html = `
    <label class="speciesCard speciesCardNotSure">
      <input type="radio" name="speciesId" value="${notSureId}" ${notSureChecked} required>
      <span class="speciesCardName">Not sure</span>
      <span class="speciesCardHint">That is fine. Your photo and description are still very useful.</span>
    </label>`;

  for (const group of data.groups) {
    const members = data.species.filter((s) => s.group === group.id);
    html += `
      <fieldset class="speciesGroup">
        <legend>
          <img src="${group.silhouette}" alt="" class="groupSilhouette" width="120" height="48">
          <span>${escapeHtml(group.name)}</span>
        </legend>
        <p class="hint">${escapeHtml(group.hint)}</p>
        <div class="speciesGrid">`;
    for (const species of members) {
      const checked = species.id === selectedId ? "checked" : "";
      html += `
          <label class="speciesCard">
            <input type="radio" name="speciesId" value="${species.id}" ${checked}>
            <span class="speciesCardName">${escapeHtml(species.commonName)}</span>
            <span class="speciesCardSci">${escapeHtml(species.scientificName)}</span>
          </label>`;
    }
    html += `</div></fieldset>`;
  }

  container.innerHTML = html;
  container.addEventListener("change", (event) => {
    if (event.target.name === "speciesId") {
      onChange(event.target.value);
    }
  });
}

// Shows the key features of the chosen species so the user can check their choice.
export function renderSpeciesDetail(container, data, speciesId) {
  const species = findSpecies(data, speciesId);
  if (!species) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const features = species.keyFeatures.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const lookalikes = species.lookalikes
    .map((id) => findSpecies(data, id))
    .filter(Boolean)
    .map((s) => escapeHtml(s.commonName))
    .join(", ");

  container.innerHTML = `
    <h3>Check: ${escapeHtml(species.commonName)}</h3>
    <p>Did you see these features?</p>
    <ul>${features}</ul>
    ${lookalikes ? `<p class="hint">Easily confused with: ${lookalikes}.</p>` : ""}`;
  container.hidden = false;
}
