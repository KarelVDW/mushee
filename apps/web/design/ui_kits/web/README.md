# Sheemu Web — UI kit

High-fidelity React/JSX recreation of the Sheemu web app. Cosmetic / interactive only — no real auth, no real audio, no real notation engine. Designed to be lifted, remixed, and mocked against.

## Files

| File                    | Purpose                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `index.html`            | Click-thru prototype: Landing → Login (modal) → Onboarding → Library → New Score → Editor → Settings.   |
| `Brand.jsx`             | `<Wordmark>`, `<Eyebrow>`, `<Pill>` — the typographic primitives.                                       |
| `Icon.jsx`              | `<Icon>` — the custom Sheemu glyph set; kept in sync with `src/components/ui/Icon.tsx`.                 |
| `Buttons.jsx`           | `<PrimaryButton>`, `<SecondaryButton>`, `<TertiaryButton>`, `<IconButton>`, `<ToggleButton>`.           |
| `Inputs.jsx`            | `<TextField>` with the cyan underline + `<TextArea>`.                                                   |
| `Chrome.jsx`            | `<TopNav>`, `<PageHeader>`, `<Footer>`, `<DialogScrim>` + `<DialogPanel>`.                              |
| `Landing.jsx`           | The public marketing landing page.                                                                      |
| `Auth.jsx`              | The split-panel login / signup card with the brand-side gradient panel.                                 |
| `Onboarding.jsx`        | The post-signup onboarding flow.                                                                        |
| `Library.jsx`           | The `/scores` library screen — header, search, score row list.                                          |
| `Editor.jsx`            | The `/scores/[id]` editor — slim header (transport centred) + sanctuary canvas + bottom note tool dock. |
| `Settings.jsx`          | The account / plan settings screen.                                                                     |
| `CreateScoreDialog.jsx` | The new-score dialog with `<InstrumentPicker>`.                                                         |
| `AppIcon.html`          | The app icon specimen.                                                                                  |

## Coverage

- Landing, auth split panel (login + signup tab states), and onboarding.
- Library screen with hover, empty-state, and active-row variants.
- Score editor: slim header (back · title · instrument chip · centred transport · shortcuts · export) plus the bottom-docked note tool bar (durations as SVG note icons, dot/tuplet/rest/tie, accidentals, clef, key signature, tempo) with upward-opening popovers. Sanctuary canvas with a static placeholder staff (real notation rendering lives in `web/src/components/notation` — out of scope for the kit). Recording limit + concurrent-recording dialogs.
- Settings and the create-score dialog with the instrument picker chip grid.

## Out of scope

- Bravura SMuFL notation rendering — placeholder only (the dock's note glyphs are plain-SVG approximations).
- Real MIDI playback / recording — transport buttons are visual; the recording quota is simulated client-side.
- Mobile breakpoints — the kit renders the desktop layout only. In production, below 768px the transport moves out of the header into the bottom dock as a thumb-sized action row (record grows to 54px, the biggest control on screen), note-nav and pitch-nudge buttons join it, and the dock popovers become full-width sheets.
