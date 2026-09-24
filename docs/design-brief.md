# Shark Sightings: design brief

## What it is

Shark Sightings is a mobile website where divers, dive masters, and fishers report sharks they see in UK and Irish waters. The records go to the Biology Department at King's College School, Wimbledon, and to shark conservation charities. The working prototype is at https://djh-kings.github.io/Sharks/.

## Who uses it, and where

- **Recreational divers**, often just back on the boat, cold and wet, and with a range of knowledge from none to expert.
- **Dive masters and instructors**, who are confident, in a hurry, and may report for a whole group.
- **Fishers (recreational and commercial)**, on a moving deck, possibly wearing gloves, and wary of reporting sharks they caught by accident.

The typical conditions are bright sun or low light, wet hands, one-handed use, a moving boat, and often **no phone signal**.

## What we need designed

Designs are needed for these screens, in order of priority:

1. **Species picker ("What did you see?").** This matters most. At present it is a long scroll of 16 text cards in five body-shape groups, with placeholder silhouettes. It must:
   - Keep **"Not sure" as the first and fully respectable option**.
   - Make comparing lookalikes easy (eg small-spotted catshark and nursehound).
   - Show each species' key features after it is chosen.
   - Leave room for real illustrations or photos, to be supplied later.
2. **Home page.** It needs a clear main action ("Report a sighting"), a second action ("I looked, but saw no sharks"), and a count of reports waiting to upload. It should give the site an identity divers want to open, and briefly explain why "no sharks" records matter.
3. **The report flow as a whole.** There are nine steps: about you, photo, where, when, what, how many, more detail, your dive or trip, and check and save. Ideas are welcome for making it feel shorter without removing information. The optional steps (more detail, and the dive or trip) should feel skippable.
4. **The location step.** It has a "Use my current position" button, a map with a draggable pin, latitude and longitude boxes, and a choice of how accurate the location is. It must work without the map, because map images do not load offline.

The "My reports" page (map, list, and CSV export) and the species guide are lower priority. They should follow the same visual system.

## Constraints (please treat these as fixed)

- **Mobile first,** designed at 375px wide. Desktop is secondary.
- **Touch targets at least 48px,** with generous spacing, for gloves and wet fingers.
- **High contrast.** Everything must be readable in direct sunlight. Meet WCAG AA at minimum, and aim for AAA on body text. No thin or light-grey text.
- **Body text at least 18px.** Use the system font stack only: no web fonts, because the site must work offline.
- **Light and dark themes** are both needed, since dark is useful at dusk and on night dives.
- **Must work offline.** Nothing may be loaded from the internet except map images.
- **Plain HTML and CSS.** The design will be built by hand into the existing site, with no framework and no build step, so pupils can maintain it. Please avoid effects that need JavaScript libraries. Design components, not code.
- **Accessible:** visible focus states, errors that do not rely on colour alone, and a logical order for screen readers.

## Tone and wording

- The tone should be friendly, clear, and never patronising. It should reassure beginners that uncertainty is fine.
- Use formal British English, with no contractions and no emojis.
- Dates are written like "Monday 20th July 2026" and times like "9.00am".
- Refer to the school as King's College School, Wimbledon.

## Current visual starting point

- The primary colour is deep sea blue, #0b4f6c. In dark mode it is #5bc0eb. These can change if you propose a better palette that still meets the contrast rules.
- The current layout is a single column, uses cards, and has large radio buttons shown as tappable rows.

## What we would like back

- Mock-ups of the four priority screens at 375px, in light and dark themes.
- A small component set: buttons (primary and secondary), tappable choice rows, species cards, notices and errors, and the step progress indicator.
- Colour and type tokens (hex values and sizes) that can go into CSS custom properties.
- Short notes on any UX change and the reason for it.
