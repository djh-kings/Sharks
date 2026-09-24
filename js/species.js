// species.js
// The species guide page. It reads the same data/species.json as the report
// form, so the guide and the picker can never disagree.

import { loadSpeciesData, findSpecies } from "./speciesPicker.js";
import { escapeHtml } from "./format.js";

async function init() {
  const guide = document.getElementById("guide");
  let data;
  try {
    data = await loadSpeciesData();
  } catch (error) {
    guide.innerHTML = `<p class="errorSummary">${escapeHtml(error.message)}</p>`;
    return;
  }
  document.getElementById("draftNotice").hidden = data.verified;

  let html = "";
  for (const group of data.groups) {
    html += `
      <section class="card">
        <h2>${escapeHtml(group.name)}</h2>
        <img src="${group.silhouette}" alt="" class="groupSilhouette" width="120" height="48">
        <p class="hint">${escapeHtml(group.hint)}</p>`;
    for (const species of data.species.filter((s) => s.group === group.id)) {
      const features = species.keyFeatures.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
      const lookalikes = species.lookalikes
        .map((id) => findSpecies(data, id))
        .filter(Boolean)
        .map((s) => escapeHtml(s.commonName))
        .join(", ");
      html += `
        <article class="guideSpecies" id="${species.id}">
          <h3>${escapeHtml(species.commonName)}</h3>
          <p class="speciesCardSci">${escapeHtml(species.scientificName)}</p>
          <ul>${features}</ul>
          ${lookalikes ? `<p class="hint">Easily confused with: ${lookalikes}.</p>` : ""}
        </article>`;
    }
    html += "</section>";
  }
  guide.innerHTML = html;
}

init();
