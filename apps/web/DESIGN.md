# Solkey Design System — Working Rules

> The full system (tokens, type specimens, UI kit, brand voice) lives in [`design/README.md`](design/README.md).
> This file is the short rulebook for day-to-day work in `apps/web`. Where the two ever disagree, `design/README.md` wins — and please fix the discrepancy.

**Creative North Star: "The Precision Maverick."** A quiet, white-on-white workspace punctuated by two neon accents. Structured yet rebellious; breathable yet punchy. The workspace stays calm — accents announce action.

---

## 1. Colors

White-on-white tonal layering plus two accents, each in three intensities:

| Intensity | Cyan | Magenta | Use for |
| --- | --- | --- | --- |
| **Loud** `*-container` | `#00DBE9` | `#FF2079` | The action: primary buttons, focus indicators, active-tab underline, the hero CTA's magenta offset shadow. At most one or two per surface. |
| **Quiet** `*-soft` | `#A6F2F7` | `#FFADBF` | Identity tags (avatar initials, instrument pills, status chips) and large selectable surfaces (option cards, tap pads, **active** selectable chips). Pair with `on-*-soft`. |
| **Text** bare `primary`/`secondary` | `#00666d` | `#b60052` | Accent/link text, step numbers, destructive text. The neons themselves fail WCAG AA as text — never use them for copy. |

Note the WCAG consequence: a **selected chip is `secondary-soft`**, not loud magenta — 11px labels on `#FF2079` don't pass contrast.

- **The No-Line Rule.** No 1px borders for sectioning. Boundaries come from tonal shifts (`surface` → `surface_container_low` → …). The only sanctioned borders: 3px cyan active-tab underline, 2px animated input bottom-stroke, the 15%-opacity ghost border, and the 4px cyan list-row hover stripe.
- **Hover shifts away from the page background.** A white row hovers to `surface_container_high` (#e1e3e3), never to `surface_container_low` (too close to the page's #f6f6f6).
- **Sticky navs** sit on `surface-container-low/85` + `backdrop-blur-xl`.

### The Sanctuary (score canvas)

The editor canvas is strictly `#ffffff` with **`#2d2f2f` ink — never pure black** (`NOTATION_INK` in `src/components/notation/constants.ts`). No cyan, no magenta inside the canvas — with one sanctioned exception: the **live recording waveform** (`RecordingWaveform.tsx`) renders alternating cyan/magenta bars while a take is in flight; it is transient by nature and always `data-export-exclude`d. All other transient interaction overlays (selection bands, input cursor, playback cursor) use the one sanctioned third color, `INTERACTION_BLUE` (`#1e90ff`) — deliberately neither brand accent, always `data-export-exclude`d so exports stay monochrome. The optional `manuscript-canvas` dot texture (40px grid, 15% `outline_variant`) may sit behind the staff.

---

## 2. Typography

Four families (loaded in `app/layout.tsx`), each with one job:

- **Space Grotesk** — display + UI: wordmark, headlines, buttons, labels. The wordmark is `Solkey`, 700 italic, tracked `-0.04em`.
- **Manrope** — body copy at reading sizes.
- **Newsreader italic** — the warm serif clause in display headlines, **marketing + auth surfaces only**. In-app chrome (Library, Editor, Settings — including the score-title field) stays Space Grotesk.
- **Geist Mono** — numeric readouts: bpm, prices, step numbers, time signatures.

ALL-CAPS only for `Eyebrow`-style schematic labels (11px, `0.12em` tracking). Everything else is sentence case.

---

## 3. Depth & surfaces

- **Cards:** `surface_container_lowest` + `tonal-layer-glow` (24px blur, 6% `on_surface`). List rows and compact cards use `rounded-md`; standalone cards and panels `rounded-lg`; full sheets `rounded-xl`.
- **Modals & glass panels:** `.glass-panel` (85% white + 12px blur) + `editorial-shadow` (19px tier) + `rounded-lg`. Scrim: `bg-on-surface/40 backdrop-blur-xs`. `DialogScrim`/`DialogPanel` already carry the a11y contract (role, focus trap, Escape, focus restore) — always build dialogs from them.
- **Never black shadows.** Always `on_surface` at 6%.
- **The magenta pop** (`emphasis="pop"`: 3px→5px offset shadow + −2px hover lift) is reserved for **at most one hero CTA per viewport** — landing hero and final CTA, the top-nav "New score". Dialog confirms, section actions, and utility buttons stay flat.

---

## 4. Components

- **Buttons:** Primary = flat loud-cyan capsule; Secondary = tonal capsule; Tertiary = bare text. Destructive = `danger` red fill (never gets the pop). All interactive elements share the focus ring: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`.
- **Inputs:** `surface_container_low` fill, `rounded-sm`, 2px cyan bottom stroke animating in from the centre on focus. No four-sided boxes.
- **The Tool-Dock:** the editor's note tools live in a docked bar along the editor's bottom edge — the chrome mirror of the slim header (`surface-container-low/85` + `backdrop-blur-xl`), never floating over the score. The canvas scrolls edge-to-edge between the two bars. Groups are separated by 1.5rem of space — **no dividers** — and new tool groups wrap onto additional rows rather than overflowing. Popovers open upward, away from the dock. The transport (stop / play / record / metronome) sits centred in the slim editor header.
- **Motion:** `--ease-solkey` (`cubic-bezier(0.2, 0.8, 0.2, 1)`); 150ms for color hovers, 200ms for shadow/transform, 300ms for tab/stroke sweeps. No bounces, no fade-up-on-scroll.

---

## 4b. Mobile (< 768px)

Phones get the same design language, restructured — never a shrunken desktop:

- **The score reflows, it never scales down.** `ScoreLayout` packs rows against the container width (`Score.setLayoutWidth`, floor 340 units), so notation keeps full glyph size and the piece reads as a vertically scrolling column of 1–2-measure rows. Exports stay print-shaped: PDF pins the layout back to the standard 1000-unit width for the snapshot.
- **Transport moves into the dock.** On phones the header keeps only back / title / instrument chip / export (icon-only); the dock gains an action row — note navigator (◀ ▶), pitch nudges (▼ ▲), then stop / play / **record**. The record button is always the largest control on screen (54px vs 46px play); its emphasis never disappears. The metronome joins the tool strip as a chip.
- **Touch replaces hover and the keyboard.** Tap selects; horizontal drag extends the selection (`touch-action: pan-y` keeps vertical scrolling native); the hover ghost-pitch preview is mouse-only — pitch edits go through the nudge buttons. The keyboard-shortcuts entry point is hidden. The selection and the playback/recording cursor auto-scroll their row into view.
- **Dock popovers become sheets.** Clef / key / tempo popovers span the dock's width (`popoverPosition(compact)`) instead of anchoring to their chip — anchored panels clip at the viewport edge.
- **Tap targets grow on coarse pointers.** Shared controls use `pointer-coarse:` bumps (chips ≥ 40px, segmented ≥ 40px); don't hand-size touch targets per screen.
- **Full-height surfaces use `dvh`, never `100vh`** (mobile browser toolbars), and the dock pads `env(safe-area-inset-bottom)`.
- **Page scaffolding stacks below `md`:** multi-column grids go single-column, the auth card stacks its brand panel into a strip, settings' side rail becomes a tab row, the library table collapses to title + updated cards. Section padding steps down (`px-5 sm:px-8`, `py-14 sm:py-22`); display type steps down one size (`text-[34px] sm:text-[48px]`, hero `text-[40px] sm:text-[56px] lg:text-[72px]`).

---

## 5. Do / Don't

**Do**
- Define regions with tonal shifts; lift hovers away from the page tone.
- Keep one loud accent per moment — if two things shout, neither is heard.
- Reference tokens (`var(--color-…)`, `--shadow-*`) — never re-hardcode a hex the palette already names.

**Don't**
- No divider lines between list items — use background shifts.
- No gradients on buttons or CTAs; the energy is the offset shadow.
- No color in the score canvas beyond ink + `INTERACTION_BLUE` overlays.
- No emoji, no icon fonts, no unicode glyphs as chrome icons (`♮ ♭ ♯` in the control bar are the only exception — they're notation).
