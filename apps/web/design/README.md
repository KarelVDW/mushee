# Solkey Design System

> **A score editor for the rest of us.** Solkey is a music score editor for amateurs and dabblers — young, fast, and dynamic. The interface is a quiet white-on-white workspace punctuated by two accent colors. Type is calm and editorial. The voice is warm, plain, and human — Solkey talks to people who make music like a friend who plays, not like a SaaS product or a theory textbook.

This system encodes the visual + content vocabulary used to design and build for Solkey. Use it for production code, throwaway prototypes, marketing pages, decks — anywhere Solkey needs to feel like itself.

---

## Who we design for — the north star

**Solkey is for the amateur, not the professional.** Our person hums in the shower, plays guitar by ear, writes songs on the side, or noodles at the piano — and wants that music on paper _quickly_, without learning notation software first. They may barely read sheet music. They have never opened a palette, an inspector or a ribbon, and they shouldn't have to.

That is the main way we differ from the competition. MuseScore, Sibelius, Dorico and friends are built for engravers and conservatory students, and you can tell: dense toolbars, nested menus, jargon everywhere. Solkey wins by being **approachable first** — real notation underneath, but no technical mumbo-jumbo and no wall of buttons on the way to it.

Every decision answers to this person: what we build, what we leave out, where a button goes, how big a title is, how something moves. Accessibility here means both things — _easy to get_ for a newcomer, and _usable by everyone_ (keyboard, screen readers, low vision, reduced motion).

**The principles:**

1. **One obvious next step.** Each screen has one primary action, placed where the eye lands first. Everything else recedes. Empty states say what to do and put the button to do it right there. Never disable the primary action without a visible reason — prefer a default that lets it act (Record works with nothing selected; "Create score" works without a title). Limits are visible before you hit them ("3 of 5 free scores"), and reaching one says what still works.
2. **Plain words first.** Name actions by what they do for the user ("Record", "Hear it back", "Higher", "Change key"), not by engraving terms. When a notation word is the right one (key, time signature, tempo, tie), pair it with a short plain hint the first time a newcomer meets it ("4/4 — four beats in a bar"). Never leave an unexplained term or abbreviation in a newcomer's path.
3. **Few controls, more on request.** Show the handful of tools a beginner reaches for; put the rest behind a clearly labelled "More", rather than adding rows or tiny icons. Before you add a button, ask whether a better default would make it unnecessary.
4. **Forgiving by default.** Autosave, undo for everything, and nothing destructive without a confirmation or an undo. Transcription mistakes are expected, so fixing a note has to be one tap or one key.
5. **Big, legible, touchable.** Headings readable at a glance, body text at a comfortable reading size, labels never smaller than 11px, touch targets at least 40px (44px preferred), and WCAG AA contrast at minimum. Icon-only controls always have an accessible name and a visible tooltip — the shared `Tooltip` primitive (`apps/web/src/components/ui/Tooltip.tsx`, rules in `../DESIGN.md` §4), which on touch names a control on press-and-hold.
6. **Motion that explains.** Animation confirms an action or shows where something went. It never decorates or slows you down, and everything respects `prefers-reduced-motion`.
7. **Works for every body.** Full keyboard operation, a visible focus ring, screen-reader names and live announcements for state changes, and color is never the only signal — a selected state always pairs its colour with a shape (a check, a stripe or an underline). The editor speaks through one polite live region, and its spoken contract is fixed:
    - **On select:** the note and where it is — "G, quarter note. Bar 2, beat 1." (`Note`'s spoken description plus bar and beat); a range — "5 notes selected, bars 1 to 2."
    - **On edit:** just what changed — "A." after a pitch change, "Eighth note." after a length change.
    - **On play and record:** "Playing" / "Stopped"; "Count-in", "Recording", then "Recording stopped. Added bars 3 to 6." (or "No notes this time.").
    - The canvas itself is named ("{title} — score", role description "score editor") and described by the live arrow-key shortcuts, ending "Press ? for all shortcuts." Announcements stay quiet during a take, apart from the recording states.
8. **Defaults that just work.** A new score is ready to record with zero setup. Instrument, key, meter and tempo start sensible and can be changed later. No settings screen stands between a new user and their first melody. Onboarding asks only what shapes the first session: survey questions are optional and share one screen, and onboarding ends in the editor, ready to record. A visitor can hear a real Solkey score before creating an account ("Hear an example" on the landing page).

**The dabbler test** — run it on every screen and every change: _could someone who has never used notation software do this on the first try, without reading anything?_ If not, simplify it. If it still needs explaining, explain it in the UI, in one plain line.

**How we say it's monophonic.** Solkey writes melodies, one note at a time. We say so plainly at the five moments it matters — the landing page's How it works step 02, the first FAQ answer (landing and pricing), when a chordal instrument is picked (the instrument picker and onboarding), the empty score, and an import notice when chords really were reduced — once per moment, and never as a banner, warning, icon or apology. Nowhere else: not in tooltips, toasts, the count-in, the microphone step or the Recordings panel. The exact strings are in the [monophonic copy table](#what-solkey-doesnt-do).

---

## Sources

| Source              | Path                                                | Notes                                                                                                                            |
| ------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Production codebase | `apps/web/`                                         | Next 16 / React 19 / Tailwind v4. App router. The single product — this design system lives inside it at `apps/web/design/`.     |
| Color tokens        | `packages/ui/src/theme.css`                         | M3-style palette with cyan + magenta accents — the shared theme each app's `globals.css` imports.                                |
| UI primitives       | `packages/ui/src/`                                  | The shared `@mushee/ui` kit: buttons, inputs, feedback, icons, toasts. Web-only pieces live in `apps/web/src/components/ui/`.    |
| Type loader         | `apps/web/src/app/layout.tsx`                       | Loads Space Grotesk, Manrope, Newsreader, and Geist Mono via `next/font/google`. Icons are inline SVGs — no icon font is loaded. |
| Notation glyphs     | `packages/notation/src/engraving/bravura_glyphs.ts` | Bravura SMuFL outlines — bundled glyph data, rendered as SVG `<path>`. Not used outside the score canvas.                        |

There is **one product**: the web app. The UI kit covers Landing → Auth → Onboarding → Library → Editor → Settings.

---

## Index

| File / Folder         | Purpose                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `README.md`           | This file — the master guide.                                                                           |
| `colors_and_type.css` | All CSS variables (colors, type, radii, shadows, motion). Drop into any HTML to inherit Solkey styling. |
| `SKILL.md`            | Agent skill manifest — read first when invoked.                                                         |
| `assets/`             | Logo wordmark, favicon, copied SVGs.                                                                    |
| `preview/`            | Card specimens that populate the Design System tab.                                                     |
| `ui_kits/web/`        | High-fidelity React/JSX UI kit recreating the Solkey app.                                               |
| `fonts/`              | Notes on font sourcing — see Caveats.                                                                   |

---

## Brand voice — one line

> **Simple tools, real notation. Just you and the notes.**

---

## Content fundamentals

**Tone:** plain, warm, confident, slightly editorial. Solkey writes the way a thoughtful musician talks to another musician. No hype. No jargon. No SaaS clichés ("supercharge your workflow", "AI-powered", "the future of…"). When in doubt, choose the simpler word and the shorter sentence.

**Casing:**

- **Sentence case** for everything in the UI: buttons, nav, labels, headings, dialogs. Legal page titles are sentence case too ("Privacy policy", "Terms of service").
- Title Case is reserved for proper nouns (instrument names, score titles, people).
- ALL-CAPS is used _only_ for the small `--type-label-*` schematic eyebrows — short tags like "How it works" or "Pricing" — at `0.12em` tracking.
- Display headings use a hint of italic via Newsreader for warmth (e.g. "The fastest way to get a melody _on the page._"); sans-serif Space Grotesk does the structural work. **Newsreader is reserved for marketing + auth surfaces** — the landing page, the auth split-panel, the final CTA, pull-quotes, testimonials. In-app chrome (Library, Editor, Settings page titles) stays in Space Grotesk and skips italic; warmth there is earned through copy, not letterforms.

**Voice — first vs second person:**

- **You.** "Start a score, press record, and hum, sing or play." "Pick up where you left off."
- **We** is fine in moderation when Solkey is making a promise: "Your music belongs to you, not us."
- Avoid invented in-group nicknames ("operative", "maverick", "rebel"). Just call the user _you_.

**Specific examples (canonical Solkey copy):**

| Surface                    | Solkey copy                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Email field label          | `Email`                                                                                                                               |
| Password field label       | `Password` · signup hint `At least 8 characters.`                                                                                     |
| Name field label           | `Your name` (signup and Settings → Profile)                                                                                           |
| Sign-up CTA                | `Create account` · under it `Free to start — no card needed.` (beta: `Free during the beta.`)                                         |
| Sign-up headline           | `Notation made easy.`                                                                                                                 |
| Sign-in headline           | `Welcome back.`                                                                                                                       |
| Sign-in link copy          | `Already have an account?`                                                                                                            |
| Hero eyebrow               | `Melody to sheet music` (beta: `Now in closed beta`)                                                                                  |
| Hero headline              | `The fastest way to get a melody on the page.`                                                                                        |
| Hero sub                   | `Hum it, sing it, or play it — Solkey listens and writes the sheet music in front of your eyes.`                                      |
| Hero line under the CTA    | `Free to start — no card, nothing to install.`                                                                                        |
| Pricing free tier          | `Sketch` — `Free` · tagline `For trying things out` · CTA `Start free`; paid cards `Choose {plan}`, every card shows its tagline      |
| Library page title         | `Your scores`                                                                                                                         |
| Library offline            | `Can't connect right now` / `Check your internet connection and try again. Your scores are safe.`                                     |
| Tab titles                 | `Your scores — Solkey` · the editor `{score title} — Solkey` (`Untitled score — Solkey` while it has none)                            |
| Empty library              | `No scores yet.` / `Start a score, press record, and hum, sing or play — Solkey writes your melody down.` · `New score`               |
| Score count (capped plans) | `3 of 5 free scores` from two below the cap; at the cap `You've used all 5 free scores.` · `See plans`                                |
| Score-limit dialog         | `Your Sketch plan holds 5 scores.` / `Everything you've written stays safe and editable.`                                             |
| Default score title        | `My first melody` (the first score) / `Untitled score` (every other) — the title field is optional                                    |
| Instrument picker label    | `What will you sing or play?`                                                                                                         |
| Change instrument          | `Changes the playback sound and how the notes are written for it. Your melody stays the same.` · `Use {instrument}`                   |
| Editor empty state         | `Sing, hum or play your tune` · the how-to line from the [monophonic copy table](#what-solkey-doesnt-do) · `Start recording`          |
| Recording strip            | `Get ready` → `Recording` · `Press Space or ■ to stop` (phones `Tap ■ to stop`)                                                       |
| After a recording          | `Added bars 3–6. Click any note to fix it.` (phones `Tap any note…`; one bar `Added bar 3.`) · `Hear it back` · `Undo`                |
| Daily recording limit      | `That's your 3 minutes of recording for today.` / `Everything you recorded is in your score. … recording is back tonight at 8:00 PM.` |
| Footer                     | `© 2026 Solkey.`                                                                                                                      |

**Punctuation & tics:**

- Em-dashes for cadence breaks. No emoji. Exclamation marks only when genuinely warranted (almost never) — payment and save toasts included.
- Sentences end with periods, including in body copy and inside cards. Short button labels ("Create account", "Sign in") do not.
- Numbers are bare and lowercase units: `120 bpm`, `4/4`, `8 bars`. Never spelled out. Units stay lowercase in unit fields and suffixes too (the tempo field's `bpm`, an export's `.pdf`).
- **Allowances are written in words** ("3 minutes", "2 min 40 sec left today", "20 minutes of recording a day"); a clock readout ("0:42") is only ever the length of a recording. Reset times are shown in the viewer's local time ("recording is back tonight at 8:00 PM", "tomorrow at 01:00"), never as "midnight". The helpers live in `src/lib/recordingTime.ts`.

**Vibe check:** if a draft sounds like a sales pitch, a fighter-jet HUD, or a recruiter LinkedIn post — push it back toward plain. The same goes for the twee direction: pet metaphors ("your shelf of scores", "quiet tools"), piled-up negations ("no clicking, no menus, just record"), and sentimental sign-offs ("Made for composers") are trying too hard. If it sounds like the way you'd describe Solkey to a friend over coffee, you're close.

**Words that don't appear in user copy** — each has a plain replacement:

| Don't say                 | Say instead                                                              |
| ------------------------- | ------------------------------------------------------------------------ |
| audio-to-notation         | "sing or play, see the notes", "melody to sheet music"                   |
| engraving, real engraving | "looks like real sheet music"                                            |
| keyboard-first            | "use your keyboard if you have one"                                      |
| tier                      | plan                                                                     |
| cadence, billing cadence  | "monthly or yearly", "a month" / "a year"                                |
| prorate, proration        | "you pay the difference" — or say nothing until the payment page         |
| budget, recording budget  | "daily minutes", "3 minutes of recording a day"                          |
| merchant of record, Polar | nothing — Polar is named only at the payment step itself                 |
| semitone                  | half step (the semitone stepper stays inside Transpose's "More options") |
| minimize accidentals      | "Simplify sharps and flats"                                              |

### Glossary

One name per thing, everywhere in the UI (code identifiers may keep their old names):

- **recording** — the audio a user records, and the act of recording. Never "take" in UI copy, accessible names included ("Recordings", "Recording 3", "Undo this recording"). "Take" may live on in code and in these docs.
- **score** — what the user writes and keeps. Never "piece" or "composition". An empty title is "Untitled score".
- **bar** — never "measure" ("Add bar", "Remove last bar", "Added bars 3–6").
- **half step** — never "semitone" in the main path ("Half step higher", "2 half steps higher").
- **Sign in** / **Sign out** — never "Log in" / "Log out"; the sign-up button says "Create account".
- **Simplify sharps and flats** — the tool once called "Minimize accidentals".
- **Voice** — the singer's instrument (once "Voice Lead"); **Double Bass** (once "Contrabass").
- Sentence case throughout.

### What Solkey doesn't do

**State a limit once, plainly, where it matters** — the canonical phrase for the big one is "melodies, one note at a time". Never as a warning banner, an icon, a red tone or an apology, and never repeated on the same surface. **Describing recording:** say "a melody, one note at a time"; never "any instrument" in a way that implies chords ("Your voice or any instrument, one note at a time" is fine — the clause carries the limit).

The monophonic copy lives at exactly these five moments (owner decision, 2026-10-22) — use the strings verbatim, and don't add a sixth without that decision being revisited:

| Moment                                         | Copy                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Landing, How it works 02                       | `Sing or play the tune` / `Your voice or any instrument, one note at a time. Solkey writes the melody onto the staff, bar by bar, while you play.`                                                                                         |
| FAQ, first question (landing + pricing)        | `Can Solkey write chords?` / `Solkey writes melodies, one note at a time. Sing, hum or whistle, or play the tune on any instrument. On piano or guitar, play the melody line on its own: notes played together won't come out as a chord.` |
| Chordal instrument picked (picker, onboarding) | `On {instrument}, play the tune one note at a time — Solkey writes melodies.` ({instrument} lower-cased: "piano")                                                                                                                          |
| Empty score body                               | `Press record, wait for the count-in, then go. Solkey writes melodies, one note at a time.` (phones `Tap record, …`)                                                                                                                       |
| Import reduced chords (only when it happened)  | `Solkey keeps one note at a time, so chords were reduced to their top note.` / `Solkey keeps one note at a time, so notes played together were reduced to the top one.`                                                                    |

Not in: tooltips, toasts, banners, the count-in, the Recordings empty state, the beta waitlist tip, or the onboarding microphone step — that step describes listening and privacy only ("Solkey uses your microphone to hear you sing, hum, whistle or play. It only listens while you press Record, never in the background.").

### Errors, limits and disabled controls

- **Errors say what happened in plain words and hand over the next step** as a link or button: "That email and password don't match. Check for a typo, or reset your password." Never surface a server, library or browser string or code ("Invalid token", "User already exists", "Invalid OTP") — map it (`AuthErrorCopy.for(error)` for auth) and fall back to "Something went wrong. Try again in a moment."
- **"Can't connect" is not a fault.** Offline and unreachable states read as reassurance ("Can't connect right now" · "Check your internet connection and try again. Your scores are safe."), retry on their own when the connection returns, and use the neutral tone.
- **Limits say what still works.** "Everything you've written stays safe and editable." "Playing, editing and exporting still work." Then one calm way forward, priced.
- **Disable only what truly can't act, and say why** — in the tooltip on desktop, in an inline hint or caption on touch ("Select a note first", "Tie needs the next note to be the same pitch."). Record is never disabled for lack of a selection.

---

## Visual foundations

### Colors

A **white-on-white** layering system punctuated by two accent colors. Accents are used sparingly — the workspace stays calm; accents announce action.

| Role                        | Hex                   | Usage                                                                                                                                                  |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `surface` / canvas          | `#f6f6f6`             | Page background.                                                                                                                                       |
| `surface_container_lowest`  | `#ffffff`             | Floating cards, modal backgrounds, the score editor.                                                                                                   |
| `surface_container_low`     | `#f0f1f1`             | Sidebar lift, input field fill, sticky nav.                                                                                                            |
| `surface_container`         | `#e7e8e8`             | Mid-level panels, secondary chips.                                                                                                                     |
| `surface_container_high`    | `#e1e3e3`             | Icon button backgrounds.                                                                                                                               |
| `surface_container_highest` | `#dbdddd`             | Heaviest tonal lift.                                                                                                                                   |
| `on_surface`                | `#2d2f2f`             | Foreground — a soft charcoal, never pure black.                                                                                                        |
| `on_surface_variant`        | `#5a5c5c`             | Secondary text, hints, and the placeholder text token (set kit-wide).                                                                                  |
| `outline_variant`           | `#acadad`             | Used at 15% opacity as ghost border only.                                                                                                              |
| **`primary_container`**     | **`#00DBE9`** Cyan    | LOUD primary fill — CTAs, focus indicators, active tab underline.                                                                                      |
| `primary_soft`              | `#A6F2F7`             | QUIET cyan fill — feature-icon circles, BPM tap pad, large selectable cards.                                                                           |
| `primary`                   | `#00666d`             | Primary text on pale surfaces (links), the focus ring and the input focus stroke.                                                                      |
| **`secondary_container`**   | **`#FF2079`** Magenta | The signature drop-shadow on the hero CTA.                                                                                                             |
| `secondary_soft`            | `#FFADBF`             | QUIET magenta fill — avatar initials, "you" tags, instrument pills.                                                                                    |
| `secondary`                 | `#b60052`             | Destructive text (Sign out, Delete).                                                                                                                   |
| `error` / `error_container` | `#b31b25` / `#fb5151` | Form errors and real faults only. "Can't connect" and offline states use a neutral `surface_container_high` icon well; limit dialogs stay neutral too. |

**The no-line rule.** Never use a 1px solid border to section UI. Define boundaries with **tonal shifts** between surfaces. A sidebar at `surface_container_low` against a `surface` background creates a "molded" lift, not a boxed-in feel. Only exception: `outline_variant` at 15% opacity ("ghost border") for accessibility-critical containers.

**The sanctuary rule.** The score editor canvas is _strictly_ `#ffffff` with `#2d2f2f` ink (`NOTATION_INK`) — never pure black. **No cyan, no magenta in the editor area** — with two sanctioned exceptions, both transient and always excluded from exports: the live recording waveform's alternating cyan/magenta bars while a take runs (silence draws no bars), and the low-opacity magenta pitch-operation highlight (`HIGHLIGHT_MAGENTA`) that pulses under an open transpose popover's target range and flashes away when a transpose or "Simplify sharps and flats" lands. All other transient interaction overlays (selection bands, cursors, the lettered ghost note, the hover tint on an in-score clef, key, time or tempo) use the one sanctioned third color, `INTERACTION_BLUE` (`#1e90ff`), and are excluded from exports — save the playback cursor while a take records, which turns `RECORDING_CURSOR_RED` (`#ef4444`), the universal recording signal. Two pieces of **HTML chrome** may sit on the canvas, both after the score's SVG (never inside it), export-excluded and in neutral tones: the **editor empty state** while the score has no pitched notes (its inline record-red dot is its only colour, and it leaves once a note exists) and the **"Add bar" / "Remove last bar"** controls under the last barline — full rules in `../DESIGN.md` §1. Editor chrome is a slim header (transport centred) plus the docked **tool-dock** of note tools along the editor's bottom edge — the header's chrome mirror (`surface_container_low` at 85% + backdrop blur), never floating over the score; the canvas scrolls edge-to-edge between the two bars, tool groups wrap onto extra rows as they grow (desktop; on phones new tools go into the More sheet), and popovers open upward. The dock carries one hint line along its top edge, and for the length of a take its tool wells give way to the recording strip. On that chrome tone, controls take the card lift: each tool group sits in a white capsule well (`surface_container_lowest` + tonal glow — the `ToolGroup`/`Segmented` track) with its controls transparent at rest, and standalone chrome controls carry the white fill themselves.

**The three-intensity accent rule.** Each accent comes in three intensities — pick by the size _and_ interactivity of the surface:

1. **`*-container`** (`#00DBE9` / `#FF2079`) — **LOUD fill.** Reserved for interactive surfaces that should read as "the action": primary buttons, focus indicators, the active-tab underline, the magenta drop-shadow on the hero CTA. At most one or two on a surface.
2. **`*-soft`** (`#A6F2F7` / `#FFADBF`) — **QUIET fill.** Used when the loud fill would dominate. Two cases:
    - Small **identity/status tags** — avatar initials, instrument pills, "you" badges, status chips, and the **active state of selectable chips**. Magenta-container on these reads as a call to action when it shouldn't — and its `on-` text fails WCAG AA at chip sizes.
    - **Large selectable / focusable surfaces** where the full neon would shout — onboarding option cards, feature-icon circles on the marketing surface, the BPM tap pad, multi-select chips at rest. Pair with `on-*-soft` for text and iconography (both clear WCAG AA on the soft fill).
3. **bare `primary` / `secondary`** (`#00666d` / `#b60052`) — **ACCENT TEXT.** Foreground only — link text, eyebrow accents, step numbers, hover-darkened states on cyan/magenta-fill buttons, the destructive `Sign out` text. The neons themselves do not pass WCAG AA as text on white (cyan-on-white is ~1.6:1).

> Rule of thumb: `*-container` → loud fill (the action), `*-soft` → quiet fill (identity tags + big selectable areas), bare → accent text on a light surface.

### Typography

Four families, each with a clear job.

| Family            | Role                 | Where                                                                                                                                                                                  |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space Grotesk** | Display + UI default | Wordmark, headlines, button labels, nav, card titles, schematic labels. Quirky terminals + technical bones. Loaded weights 300–700.                                                    |
| **Manrope**       | Body copy            | Long-reading paragraphs, marketing prose, settings descriptions. Geometric and very readable. Loaded weights 300–800.                                                                  |
| **Newsreader**    | Serif italic accent  | The italic clause inside a display headline ("_on the page._"), pull-quotes, testimonial copy. **Marketing + auth surfaces only** — not for in-app page titles. Optical-size variable. |
| **Geist Mono**    | Mono                 | File paths, raw MIDI values, bpm and time-signature readouts, step numbers in numbered flows, the recording clock, the 6-digit code field. Loaded weights 400–600.                     |

The wordmark is always **`Solkey`** in Space Grotesk Bold (700) **italic**, tracked `-0.04em`. Lowercase save the capital S. This _is_ the logo.

Scale tokens live in `colors_and_type.css` — `display-lg / md / sm`, `headline-lg / md`, `title-lg`, `body-lg / md / sm`, `label-lg / md`, `mono-md`.

### Spacing & layout

- 8px base grid; `0.4rem` (~6.4px) is the smallest meaningful step.
- Page max width `1280px` for marketing; `1536px` for app chrome; modal max `42rem`.
- Page-edge gutters: `2rem` (32px) on desktop, `1.2rem` on mobile.
- Sections breathe — `88px` vertical padding on marketing rows, `64px` between major content groups.

### Mobile (< 768px)

Phones get the same design language, restructured — never a shrunken desktop. The full rulebook is `../DESIGN.md` §4b; the headlines: the score **reflows** against the container width (it never scales down); the dock is **two rows** — a tool row (Undo, note length, a labelled More) and the action row ("Note" and "Pitch" wells, then stop / play / record, with record the largest control on screen) — and everything else lives in the labelled **More tools** sheet, each item with a text label and its current value; during a take the dock collapses to the recording strip and the record-as-stop. Sheets are opaque, sit between the header and the dock, and carry a Close. Toasts stack above the dock. Full-height surfaces use `dvh` (never `100vh`) and the dock pads `env(safe-area-inset-bottom)`; text inputs are 16px on coarse pointers; touch targets grow via `pointer-coarse:` bumps on the shared controls rather than per-screen hand-sizing.

### Backgrounds

- Default: solid `surface` (#f6f6f6) — flat, never gradients.
- The editor canvas: pure `#ffffff`, optionally with a 40px-grid `manuscript-canvas` dot texture at 15% `outline_variant`.
- The hero and final-CTA sections may carry a single oversized soft blur — cyan or magenta at low opacity, blurred at 120px — pinned to one corner. This is the **only** place a colored haze is permitted, and it's used quietly.
- **Marketing-emphasis surface (dark inversion).** Exactly one element per marketing surface may invert to `on-surface` (#2d2f2f) fill with `surface` text — used today for the "most picked" pricing tier. This is the only sanctioned dark surface in the system and it lives **strictly on copy / sales / advertising surfaces** (landing, pricing, in-product upsell cards). Never on app chrome or the editor.
- **Forbidden:** purple/blue gradients, mesh gradients, hand-drawn illustrations, photographic full-bleeds in chrome.

### Animation

- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)` — quick out, soft settle. (`--ease` in the CSS tokens; exposed in the app as the Tailwind utility `ease-solkey`).
- Durations: `150ms` (--t-quick) for hover color, `200ms` (--t-snap) for shadow/transform lift, `300ms` (--t-flow) for tab/border-width transitions.
- **Selected & hovered states must shift _away_ from the page background, not toward it.** Hovered list rows go from `surface_container_lowest` (#fff) up to `surface_container_high` (#e1e3e3) — never to `surface_container_low` (#f0f1f1), which is too close to the page's `surface` (#f6f6f6) and reads as blended. The same rule applies to split-panel layouts (auth, settings): the standout panel uses `surface_container_high`, not `low`, to register clearly against the page.

**The signature interaction (reserved):** the hero CTA on each surface — opt-in via `emphasis="pop"` — translates `-2px` on hover and grows its magenta drop-shadow from `3px 3px` to `5px 5px`. Aim for **at most one pop visible per viewport**: the landing hero and final CTA, the "create" action in the top nav of authenticated views, a flow's single closing CTA. Dialog confirms (Change plan and the limit dialogs included), section actions, and utility buttons stay flat. Don't pop every primary button.

- Input fields animate a **2px `primary` (dark teal) bar** from the centre out to full width along the bottom on focus (300ms; instant under reduced motion).
- No bounces, no spring physics, no fade-up-on-scroll. Motion is sharp and quiet.

**Reduced motion is global.** One block in `packages/ui/src/theme.css` collapses every animation and transition to 0.01ms under `prefers-reduced-motion: reduce` (0.01ms rather than `none`, so exit animations still fire `animationend` and clear their element) and turns smooth scrolling into a jump. Motion driven from JS — the score's scroll follow, the hero demo's ticker — checks the media query itself. Where a motion carries meaning, its reduced form keeps the meaning, as listed below.

**Sanctioned motion** — everything that moves, and its reduced-motion form:

| Motion                          | What it does                                                                                                                   | Reduced motion                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Count-in dots (recording strip) | One dot per felt pulse fills red on each count-in click (150ms colour), on the engine's own clock — the one beat-synced motion | The dots fill without a fade                     |
| Recording dot                   | The strip's 8px red dot breathes on a slow 1.2s opacity pulse while a take records                                             | Steady                                           |
| Recording waveform              | Bars rise in (200ms), then burst into the notes that replaced them (450ms); no idle sway                                       | Bars appear without scaling and fade out (150ms) |
| Editor empty state              | Fades out and moves 8px down over 200ms when the first pitched note lands                                                      | Gone at once                                     |
| Tooltip                         | Opens after 400ms of hover, at once on keyboard focus; fades in over 150ms. Touch: shows after a 450ms press-and-hold          | Appears without the fade                         |
| Phone sheet                     | Rises 16px and fades in over 200ms; a pick shows its fill for 150ms before the sheet closes                                    | Appears at once                                  |
| Dock hint line                  | Fades in over 200ms                                                                                                            | Appears at once                                  |
| Phone dock during a take        | The tool and action rows fold away over a 200ms height transition                                                              | Folds at once                                    |
| Record ↔ stop glyph             | The record dot crossfades to the stop square over 150ms                                                                        | Swaps at once                                    |
| Pitch-operation highlight       | Pulses under an open transpose popover; flashes away when the edit lands                                                       | A static wash                                    |
| Score scroll follow             | Smooth-scrolls the selection's or cursor's row into view                                                                       | Jumps                                            |
| FAQ chevron                     | Rotates over 150ms as an answer opens                                                                                          | Snaps                                            |
| Loading skeleton                | The staff skeleton pulses its opacity over 1.6s                                                                                | Static                                           |

- **Looping marketing demos longer than 5s** carry a visible pause control and a one-line caption (the hero demo: "Pause demo" / "Play demo"); under `prefers-reduced-motion` they show the finished state.
- **Mic Mode guide (iPhone)** is no longer a storyboard: its three steps (open Control Center → tap Mic Mode → choose Wide Spectrum) are a numbered static list, all visible at once, in the editor's first-recording dialog and inline in onboarding's microphone step.

### Focus

Every interactive element carries the shared keyboard-focus ring, the `focus-ring` utility (defined in `packages/ui/src/theme.css`: a 2px `primary` outline at 2px offset, on `:focus-visible` only) — the dark teal reads on white and on both neon fills. Dialogs are built from `DialogPanel`, which renders its own scrim and owns the modal a11y contract (role/aria-modal/labelling, its subtitle linked as the dialog's description, focus trap, Escape, focus restore; one `onClose` drives Escape, backdrop click and ×). Anchored popovers (the clef / key / time / tempo pickers) are built from `Popover`/`PopoverOption`, which own the transient-surface contract (dialog role/labelling, Escape and outside-click dismissal, keys kept from the editor's shortcuts while open, `aria-pressed` option cells).

- **Multi-step flows move focus to each step's title** (onboarding's step headings take programmatic focus, without the ring), and page-level titles are real headings — one `h1` per screen.
- **Every page opens with a "Skip to content" link** (visible on focus) to its `main#content`.
- **Triggers say what they are:** a chip that opens a popover or menu announces `aria-haspopup` + `aria-expanded`; a real toggle announces `aria-pressed`. **A toggle that swaps its action names the action it will do next** — Record ↔ "Stop recording", Play ↔ Pause — so the name carries the state.
- **The editor keyboard:** Space plays, pauses and stops a take (a focused button keeps Space for itself); ⇧Space plays from the start; ⇧R records; Escape stops a take before it collapses a selection; the ContextMenu key / Shift+F10 opens the selection actions; "?" opens the shortcuts dialog itself (desktop), where all of it is listed, Playback first.

Stacking uses the named layers in `packages/ui/src/theme.css`, lowest first: `--z-sticky` (sticky nav) = `--z-popover` (50) < `--z-banner` (cookie / browser-support banners, 60) < `--z-dialog` (the dialog scrim, 100) < `--z-toast` (110, so toasts stay readable and clickable over an open dialog). Overlay surfaces apply them as `z-(--z-dialog)` etc.; small stacking inside one component (`z-2`, the editor's header and dock) stays numeric. Phone sheets render through one host at the editor root, between the measured header and dock, above both.

**Toasts:** the `Toaster` keeps two live regions mounted from the start — info in `role="status"`, errors in `role="alert"` — so the first message is announced too; at most two show at once, each with up to two action buttons (the after-recording summary's "Hear it back" and "Undo"), and their timers pause on hover, focus or touch. Toasts sit at `max(var(--toast-bottom, 1.5rem), env(safe-area-inset-bottom))`: the editor sets `--toast-bottom` to just above its dock, so in the editor — on phones above all — toasts stack above the dock and never cover the transport. During a take, status goes to the recording strip, not to toasts.

### Hover & press states

| Element                     | Hover                                                                                                                           | Press / active                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Hero CTA (`emphasis="pop"`) | `-translate-y-[2px]`, shadow grows 3px→5px                                                                                      | (no extra; it's already lifted) |
| Standard primary button     | bg darkens slightly                                                                                                             | bg darkens further              |
| Icon button                 | bg `surface_container` → `primary_container` (cyan) or `secondary_container` (magenta for destructive)                          | —                               |
| List row                    | bg `surface_container_lowest` → `surface_container_high`, plus a 4px-wide cyan accent stripe slides in from the left            | —                               |
| Dock control (in a well)    | transparent at rest → `surface_container_high`; the white capsule well supplies the lift, so the control stays bare until hover | active = `primary_container`    |
| Tab text                    | `on_surface_variant` → `on_surface`; active tab gains a 3px cyan underline                                                      | —                               |
| Sign-out / destructive text | `on_surface` → `secondary` (magenta)                                                                                            | —                               |

### Borders

Almost never. The complete border vocabulary:

1. **Active-tab underline** — `border-bottom: 3px solid var(--color-primary-container)`.
2. **Input field bottom stroke** — `2px` `primary` (`#00666d`), animates 0→100% width on focus. Not the neon cyan: it fails the 3:1 non-text contrast a focus indicator needs on the `surface_container_low` input fill.
3. **Ghost border** — `1px solid rgba(172, 173, 173, 0.15)` on a few accessibility-critical containers (e.g. footer top edge).
4. **List-row left accent stripe** on hover — `4px` cyan, opacity 0→1.

That's it. No 1px greys, no dashed dividers, no border-only buttons.

### Shadows — atmospheric, never black

- **Tonal lift** (`--shadow-tonal`): `0 0 24px 0 rgba(45,47,47,0.06)`. Wrapping a `surface_container_lowest` card with this on a `surface` background gives the natural lift the system relies on.
- **Editorial** (`--shadow-editorial`): `0 0 19px 0 rgba(45,47,47,0.06)`. The auth-modal lift — slightly tighter blur.
- **Magenta offset** (`--shadow-offset-3`, `--shadow-offset-5`): `3px 3px 0 0 #ff2079` and `5px 5px 0 0 #ff2079`. Reserved for the hero CTA — the most opinionated move in the system.
- **Cyan offset** (`--shadow-cyan-3`): variant for special "pulse" moments.

**Never use `#000000` for shadows.** Always tint with `on_surface` (`#2d2f2f`) at 6% opacity.

### Transparency & blur

- **Glassmorphism** (`.glass-panel`: `surface_container_lowest` at 85% opacity + `backdrop-filter: blur(12px)`) is reserved for **dialog panels**, which float over the scrim. No other use.
- **A glass panel never renders inside another backdrop-filtered surface — blur doesn't nest.** A panel opened inside the editor's header or dock would sample only that bar and let the staff lines run across its text. So popovers, menus, tooltips and phone sheets use the **opaque card fill** (`surface_container_lowest` + `editorial-shadow`), and anything opened from the header or dock either portals out to the page (phone sheets, tooltips) or sits on that opaque fill. The header's and dock's own blur lives on an `aria-hidden` backdrop layer behind their controls, so a panel opened from them still overlays the real page.
- **Phone sheets are opaque white**, never glass (see `../DESIGN.md` §4b).
- **Banners** (cookie, browser support) are solid `surface_container_lowest` with the tonal glow or editorial shadow — never glass. On phones they never cover a page's primary CTA: the cookie banner is a compact bottom sheet with the page padded underneath it, and the browser-support banner sits in the page flow under the nav rather than over it.
- The **editor tool dock is _not_ glass and never floats**: it's a docked bar on the chrome mirror tone (`surface_container_low/85` + heavy backdrop blur), in-flow along the editor's bottom edge. Its tool groups sit in white capsule wells (see the sanctuary rule).
- The dialog scrim is `bg-on-surface/40 backdrop-blur-xs` (4px) — soft charcoal at 40% with a light blur.
- The sticky top nav uses `surface_container_low/85` + `backdrop-blur-xl` — a barely-there glassy version of the sidebar tone.

### Corner radii

| Token           | Value            | Usage                                                               |
| --------------- | ---------------- | ------------------------------------------------------------------- |
| `--radius-sm`   | `0.25rem` (4px)  | Input fields, score-row cells. The default.                         |
| `--radius-md`   | `0.5rem` (8px)   | List rows, compact cards, grouped-button ends.                      |
| `--radius-lg`   | `0.75rem` (12px) | Standalone cards, dialogs, popovers and menus.                      |
| `--radius-xl`   | `1rem` (16px)    | Full sheets (phone sheets, the cookie sheet), marketing hero tiles. |
| `--radius-full` | `9999px`         | All primary buttons (capsule), chips, icon-only round buttons.      |

### Cards

A Solkey card is **`surface_container_lowest` + `--shadow-tonal` + `--radius-lg`**. _No border._ On hover, a list-style card may receive a left-side cyan accent stripe slide-in. Padding: `24–28px`. Cards never sit on each other directly — always with `0.8rem` (12.8px) of gap.

---

## Iconography

**Primary system: the custom Solkey glyph set.** Inline SVGs drawn on a 24px grid with 2px strokes, **squared linecaps and mitered joins** — icons should read like technical schematics next to Space Grotesk. Color flows from `currentColor`; filled details (noteheads, indicator dots) opt out of the stroke locally. The registry lives in `packages/ui/src/Icon.tsx` (the shared `@mushee/ui` kit, used via `<Icon name="…" size={…}>`; a name it lacks fails type-checking), mirrored for the kit in `ui_kits/web/Icon.jsx` — keep the two in sync. Static HTML previews use the `.ico-glyph` utility from `colors_and_type.css` on a raw `<svg viewBox="0 0 24 24">`. Names are Lucide-style kebab-case: `search`, `pencil`, `trash-2`, `x`, `eye`, `eye-off`, `arrow-right`, `music`. Unknown names render a crossed-box fallback so gaps are visible.

The registry also carries **reserved glyphs** with no call sites yet — navigation chrome (`menu`, `settings`), editing (`copy`, `scissors`, `zoom-in`), transport & audio (`skip-back`, `skip-forward`, `repeat`, `volume`, `headphones`), files & sharing (`upload`, `file-music`, `folder`, `printer`), social (`heart`, `star`, `bookmark`), status (`check-circle`, `help-circle`, `zap`), and music-specific marks (`piano`). Before drawing a new icon, check whether a reserved one already covers the concept — new features should pull from this set rather than a foreign icon pack.

**One glyph, one meaning.** A glyph names one thing across the whole app, so a newcomer can learn it once:

| Glyph                         | Means                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `metronome`                   | The metronome — and nothing else.                                                                                                       |
| `audio-lines`                 | Recorded audio: the Recordings chip, the Settings → Recordings tab.                                                                     |
| `square`                      | Stop: the Stop button, and the record button while a take runs ("Stop recording").                                                      |
| `more-horizontal`             | A "More" menu or sheet (library row actions, the phone dock's More tile).                                                               |
| `chevron-up` / `chevron-down` | Higher / lower (pitch), and open / close on disclosures.                                                                                |
| `globe` / `wifi-off`          | Can't reach Solkey / offline — never an error.                                                                                          |
| `♮ ♭ ♯`                       | Only the accidental control's options (and written pitch or key names such as "F♯ major") — never a standalone icon for another action. |

The dotted-note control is a drawn glyph (a quarter note with its dot), never a "·" character; note lengths, the rest, the tie and the triplet are drawn glyphs too (`NoteToolParts.tsx`).

**Notation glyphs: SMuFL / Bravura.** The score editor renders music notation using bundled Bravura outlines (`packages/notation/src/engraving/bravura_glyphs.ts`, the shared `@mushee/notation` workspace package) drawn as `<path>` inside `<svg>`. These are **not for general UI**; they only appear inside the score canvas. That file is generated: a subset of just the glyphs the app draws, cut from the full Bravura table by `packages/notation/scripts/subset-bravura.ts` (`pnpm --filter @mushee/notation glyphs:subset`), so a new glyph enters by being listed there. We did not copy it into the design system — re-import from `@mushee/notation` if you actually need to render notation.

**No emoji.** Solkey's voice is plain, but it's not casual in that way.

**No unicode glyph icons** for chrome — except the music accidental characters `♮ ♭ ♯` in the accidental control (the desktop dock's well, the phone More sheet's "Sharp or flat"), where they're effectively notation, not iconography. Inline symbols in copy are drawn too: the "■" in "Tap ■ to stop" is the `square` icon, the ▼ ▲ in a hint are the chevrons.

**Logos / brand marks.** Solkey has no graphic logo. The wordmark **is** the brand: `Solkey` set in Space Grotesk 700 italic, tracked `-0.04em`. Always render it as live text. An SVG fallback lives at `assets/solkey-wordmark.svg` for places that demand an image.

---

## Caveats

- **Fonts are CDN-only.** The codebase uses `next/font/google` to fetch Space Grotesk, Manrope, Newsreader, and Geist Mono at build time; no `.woff2` files are committed. The design system imports them via Google Fonts `@import`, which serves the same files. If you need an offline / paid-license version, source `.woff2`s yourself and drop them in `fonts/` with a matching `@font-face` block.
- **Production has a full marketing surface.** The landing + pricing page ships in the app (`apps/web/src/app/LandingPage.tsx`); the UI kit's Landing screen approximates it but is not a 1:1 recreation. The kit's Onboarding screens predate the four-step production flow (`apps/web/src/app/onboarding/`). There is still no native mobile app — phones get the responsive web app (see `../DESIGN.md` §4b).
- **The kit trails production.** The 2026-10 polish pass changed the editor (dock order and More, the recording strip, the empty state, the bar controls, the save status), settings (four tabs), the library rows and onboarding faster than the kit; where a kit screen and this README disagree, this README and `../DESIGN.md` describe what ships.
- **Notation glyph rendering is not part of the kit.** A static placeholder staff renders in the editor recreation; for real notation, pull `bravura_glyphs.ts` from the `@mushee/notation` package (`packages/notation/src/engraving/`).
