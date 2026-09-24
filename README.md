# Shark Sightings

A mobile-first website where divers, dive masters, and fishers report shark sightings in UK and Irish waters. The data is for the Biology Department at King's College School, Wimbledon, and for shark conservation charities.

**Status: front end only.** There is no server yet. Reports are saved in the browser (IndexedDB) and can be exported as a Darwin Core CSV file.

## Design principles

1. **Photo first.** A photo lets an expert confirm the species whatever the observer knows.
2. **"Not sure" is a proper answer.** It comes first in the species picker. Every named species also needs a confidence rating.
3. **Record effort, not just sightings.** Time spent looking, and "I looked but saw no sharks" (absence records), stop the data just showing where people dive.
4. **Honest locations.** GPS does not work underwater, so the user can move the pin and must say how accurate the location is. This becomes `coordinateUncertaintyInMeters`.
5. **Works offline.** Service worker plus IndexedDB, because there is often no signal at sea.
6. **Privacy.** Photos are resized and their EXIF metadata (including GPS) is removed before saving. Anonymous reports are allowed.

## Running it

A service worker needs a real web server; opening the files directly will not work.

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Testing

```
npm install
npm test
```

This drives Chromium through a full sighting report (with a photo carrying EXIF GPS and date), resuming a draft, an offline absence report, and the CSV export. Screenshots go to `tests/output/`.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `report.html`, `sightings.html`, `species.html` | The four pages |
| `js/report.js` | Step-by-step report form: validation, drafts, building the report |
| `js/store.js` | IndexedDB: reports, drafts, and settings |
| `js/geo.js` | GPS, location accuracy, coordinate checks |
| `js/photos.js` | Reads EXIF, resizes photos, removes metadata |
| `js/speciesPicker.js` | Species picker and key-feature panel |
| `js/exportDwc.js` | Darwin Core mapping and CSV |
| `js/format.js` | House-style dates ("Monday 20th July 2026"), times ("9.00am"), and numbers |
| `data/species.json` | Species list, used by both the picker and the guide |
| `sw.js` | Service worker (offline cache) |
| `vendor/` | Leaflet 1.9.4 and exifr 7.1.3, stored locally so they work offline |

## Common changes

**Add a species:** add an entry to `data/species.json` with a unique camelCase `id` and an existing `group`. No code changes are needed.

**Add a question:** add the input to `report.html` inside the right `<section data-step>`. Read it in `buildReport()` in `js/report.js`, and map it in `js/exportDwc.js` (use a Darwin Core term if one fits, otherwise `dynamicProperties`).

**Show a field only sometimes:** add `data-show-when="fieldName=value1,value2"` to its wrapper.

**After changing any file:** increase `cacheVersion` in `sw.js`, or phones will keep the old version.

## Before launch

UI and UX work should follow the [design brief](docs/design-brief.md).

- [ ] Biology Department to check the species list, key features, and lookalikes, then set `"verified": true`.
- [ ] Replace the placeholder group silhouettes with proper illustrations or photos (with permission).
- [ ] Add conservation status from a current, cited source.
- [ ] Confirm the Darwin Core mapping with the receiving charity (eg recording "not sure" as `Selachimorpha`).
- [ ] Data Protection Officer sign-off before collecting any personal data from the public.
- [ ] Backend: upload queue, verification workflow, public map with blurred locations.
