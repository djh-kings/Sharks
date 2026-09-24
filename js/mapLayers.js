// mapLayers.js
// The two map styles, "Map" (drawn) and "Satellite" (photos), and the switch
// between them. Used by the report form and the My reports page.
//
// OpenStreetMap has no satellite photos of its own, so the photos come from
// Esri World Imagery. To change provider, change the URL and attribution
// below: nothing else needs to change. Neither is cached for offline use:
// the providers' terms do not allow bulk caching.
//
// The user's choice is remembered on this phone.

import { getSetting, setSetting } from "./store.js";

const styles = {
  map: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      maxZoom: 18,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
};

// Adds the tiles to `map`, and wires up the radio buttons named `radioName`
// so they switch style. Returns a promise that resolves once the layer is on.
export async function addMapLayers(map, radioName) {
  const layers = {};
  for (const [name, style] of Object.entries(styles)) {
    layers[name] = window.L.tileLayer(style.url, style.options);
  }

  let saved = "map";
  try {
    saved = (await getSetting("mapStyle")) || "map";
  } catch {
    // A missing setting is not a problem: use the drawn map.
  }
  let current = layers[saved] ? saved : "map";
  layers[current].addTo(map);

  const radios = document.querySelectorAll(`input[name="${radioName}"]`);
  for (const radio of radios) {
    radio.checked = radio.value === current;
    radio.addEventListener("change", async () => {
      if (!radio.checked || radio.value === current) {
        return;
      }
      map.removeLayer(layers[current]);
      current = radio.value;
      layers[current].addTo(map);
      try {
        await setSetting("mapStyle", current);
      } catch {
        // Not being able to remember the choice should never stop the map working.
      }
    });
  }
}
