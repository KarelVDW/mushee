# Solkey Web — UI kit

High-fidelity React/JSX recreation of the Solkey web app. Cosmetic / interactive only — no real auth, no real audio, no real notation engine. Designed to be lifted, remixed, and mocked against.

## Files

| File                    | Purpose                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `index.html`            | Click-thru prototype: Landing → Login (modal) → Onboarding → Library → New Score → Editor → Settings.   |
| `Brand.jsx`             | `<Wordmark>`, `<Eyebrow>`, `<Pill>` — the typographic primitives.                                       |
| `Icon.jsx`              | `<Icon>` — the custom Solkey glyph set; kept in sync with `packages/ui/src/Icon.tsx`.                   |
| `Buttons.jsx`           | `<PrimaryButton>`, `<SecondaryButton>`, `<TertiaryButton>`, `<IconButton>`, `<ToggleButton>`.           |
| `Inputs.jsx`            | `<TextField>` with the cyan underline + `<TextArea>`.                                                   |
| `Chrome.jsx`            | `<TopNav>`, `<PageHeader>`, `<Footer>`, `<DialogPanel>` (it renders its own scrim).                     |
| `Landing.jsx`           | The public marketing landing page.                                                                      |
| `Auth.jsx`              | The split-panel login / signup card with the brand-side gradient panel.                                 |
| `Onboarding.jsx`        | The post-signup onboarding flow.                                                                        |
| `Library.jsx`           | The `/scores` library screen — header, search, score row list.                                          |
| `Editor.jsx`            | The `/scores/[id]` editor — slim header (transport centred) + sanctuary canvas + bottom note tool dock. |
| `Settings.jsx`          | The account / plan settings screen.                                                                     |
| `NewScoreDialog.jsx`    | The new-score dialog with `<InstrumentPicker>`.                                                         |
| `AppIcon.html`          | The app icon specimen.                                                                                  |

## Coverage

- Landing, auth split panel (login + signup tab states), and onboarding.
- Library screen with hover, empty-state, and active-row variants.
- Score editor: slim header (back · title · instrument chip · centred transport — Stop only while playing or recording, Play 40, Record 48 turning into a stop square while a take runs, the metronome glyph · shortcuts · export) plus the bottom-docked note tool bar in the production order: Pitch (Higher · Lower) · Length (durations as SVG note icons + a drawn Dotted glyph) · ♭ ♮ ♯ · Rest · More (Triplet, Tie, Simplify sharps and flats) · clef, key (in words), tempo. Each tool group sits in a white capsule well (`ToolGroup` / the `Segmented` track — surface_container_lowest + tonal glow), controls transparent at rest, with upward-opening opaque popovers. Sanctuary canvas with a static placeholder staff (real notation rendering lives in the `@mushee/notation` package, `packages/notation` — out of scope for the kit) and the "Add bar" / "Remove last bar" chrome under it. Recording limit, concurrent-recording, and the iPhone Mic Mode guide dialogs, plus a returning-iPhone reminder toast that production has since replaced with the recording strip's count-in line.
- Settings (Profile / Account) with the change-plan grid, and the new-score dialog with the category-grouped instrument picker. Production has since moved on: four settings tabs (Profile, Plan, Recordings, Account), popular instrument tiles ahead of "All instruments", a four-step onboarding, library rows with one "More" menu. Where the kit and `../../README.md` / `../../../DESIGN.md` disagree, the docs describe what ships.

## Out of scope

- Bravura SMuFL notation rendering — placeholder only (the dock's note glyphs are plain-SVG approximations).
- Real MIDI playback / recording — transport buttons are visual; the recording quota is simulated client-side.
- Mobile breakpoints — the kit renders the desktop layout only. In production, below 768px the dock is two rows: a tool row (Undo · note lengths · a labelled More) over the action row ("Note" ◀ ▶, "Pitch" ▼ ▲, then stop 40 / play 46 / record 54 — the biggest control on screen), with everything else in the "More tools" sheet; dock popovers become opaque sheets between the header and the dock. Selection actions (copy, paste, delete, select all) are not dock buttons on any breakpoint: they live in the floating selection popover that right-click / Shift+F10 opens on desktop, and a long-press, double-tap, drag-release or a tap on the selected note opens on phones.
- The recording strip, the editor empty state, the save status, tooltips and the dock's hint line — see `../../../DESIGN.md` §4.
