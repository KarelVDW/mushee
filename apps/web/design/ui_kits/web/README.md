# Sheemu Web — UI kit

High-fidelity React/JSX recreation of the Sheemu web app. Cosmetic / interactive only — no real auth, no real audio, no real notation engine. Designed to be lifted, remixed, and mocked against.

## Files

| File                    | Purpose                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `index.html`            | Click-thru prototype: Library → Login (modal) → New Score → Editor.                       |
| `Brand.jsx`             | `<Wordmark>`, `<Eyebrow>`, `<Pill>` — the typographic primitives.                         |
| `Buttons.jsx`           | `<PrimaryButton>`, `<TertiaryButton>`, `<IconButton>`, `<GroupButton>`, `<ToggleButton>`. |
| `Inputs.jsx`            | `<TextField>` with the cyan underline + `<SearchField>`.                                  |
| `Chrome.jsx`            | `<TopNav>`, `<Footer>`, `<DialogScrim>` + `<DialogPanel>`.                                |
| `Library.jsx`           | The `/scores` library screen — header, search, score row list.                            |
| `Editor.jsx`            | The `/scores/[id]` editor — control bar + sanctuary canvas + measure buttons.             |
| `Auth.jsx`              | The split-panel login / signup card with the brand-side gradient panel.                   |
| `CreateScoreDialog.jsx` | The new-score dialog with `<InstrumentPicker>`.                                           |

## Coverage

- Library screen with hover, empty-state, and active-row variants.
- Auth split panel (login + signup tab states).
- Score editor: control bar (durations, accidentals, transport, tempo), measure +/- buttons, sanctuary canvas with a static placeholder staff (real notation rendering lives in `web/src/components/notation` — out of scope for the kit).
- Create-score dialog with the instrument picker chip grid.

## Out of scope

- Bravura SMuFL notation rendering — placeholder only.
- Real MIDI playback / recording — transport buttons are visual.
- Mobile breakpoints — desktop only (the production app is also desktop-first).
