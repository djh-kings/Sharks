// species.js
// The species guide page. It reads the same data/species.json as the report
// form, so the guide and the picker can never disagree.

import { loadSpeciesData, findSpecies } from "./speciesPicker.js";
import { escapeHtml } from "./format.js";
import { icon } from "./icons.js";

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
      <section class="guideGroup" aria-labelledby="group-${group.id}">
        <div class="guideGroupHead">
          <span class="shapeImage"><img src="${group.silhouette}" alt="" width="240" height="96"></span>
          <div>
            <h2 id="group-${group.id}">${escapeHtml(group.name)}</h2>
            <p>${escapeHtml(group.hint)}</p>
          </div>
        </div>
        <div class="guideGrid">`;
    for (const species of data.species.filter((s) => s.group === group.id)) {
      const features = species.keyFeatures.map((f) => `<li>${icon("check")}<span>${escapeHtml(f)}</span></li>`).join("");
      const lookalikes = species.lookalikes
        .map((id) => findSpecies(data, id))
        .filter(Boolean)
        .map((s) => `<a href="#${s.id}">${escapeHtml(s.commonName)}</a>`)
        .join(", ");
      html += `
          <article class="card guideSpecies" id="${species.id}">
            <h3>${escapeHtml(species.commonName)}</h3>
            <p class="speciesCardSci">${escapeHtml(species.scientificName)}</p>
            <ul class="features">${features}</ul>
            ${lookalikes ? `<p class="hint"><strong>Easily confused with:</strong> ${lookalikes}.</p>` : ""}
          </article>`;
    }
    html += "</div></section>";
  }
  guide.innerHTML = html;
}

init();
