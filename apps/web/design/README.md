# Sheemu Design System

> **A score editor for the rest of us.** Sheemu is a music score editor — young, fast, and dynamic. The interface is a quiet white-on-white workspace punctuated by two accent colors. Type is calm and editorial. The voice is warm, plain, and human — Sheemu talks to musicians like another musician, not like a SaaS product.

This system encodes the visual + content vocabulary used to design and build for Sheemu. Use it for production code, throwaway prototypes, marketing pages, decks — anywhere Sheemu needs to feel like itself.

---

## Sources

| Source              | Path                                     | Notes                                                                                                                                       |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Production codebase | `web/` (mounted, read-only)              | Next 16 / React 19 / Tailwind v4. App router. The single product.                                                                           |
| Color tokens        | `web/src/app/globals.css`                | M3-style palette with cyan + magenta accents.                                                                                               |
| Type loader         | `web/src/app/layout.tsx`                 | Loads Space Grotesk, Manrope, Newsreader, and Geist Mono via `next/font/google`. Material Symbols Outlined is loaded from Google Fonts CDN. |
| Notation glyphs     | `web/src/origin/fonts/bravura_glyphs.ts` | Bravura SMuFL outlines — bundled glyph data, rendered as SVG `<path>`. Not used outside the score canvas.                                   |

There is **one product**: the web app. The UI kit covers Landing → Auth → Onboarding → Library → Editor → Settings.

---

## Index

| File / Folder         | Purpose                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `README.md`           | This file — the master guide.                                                                           |
| `colors_and_type.css` | All CSS variables (colors, type, radii, shadows, motion). Drop into any HTML to inherit Sheemu styling. |
| `SKILL.md`            | Agent skill manifest — read first when invoked.                                                         |
| `assets/`             | Logo wordmark, favicon, copied SVGs.                                                                    |
| `preview/`            | Card specimens that populate the Design System tab.                                                     |
| `ui_kits/web/`        | High-fidelity React/JSX UI kit recreating the Sheemu app.                                               |
| `fonts/`              | Notes on font sourcing — see Caveats.                                                                   |

---

## Brand voice — one line

> **Quiet tools, real notation. Just you and the notes.**

---

## Content fundamentals

**Tone:** plain, warm, confident, slightly editorial. Sheemu writes the way a thoughtful musician talks to another musician. No hype. No jargon. No SaaS clichés ("supercharge your workflow", "AI-powered", "the future of…"). When in doubt, choose the simpler word and the shorter sentence.

**Casing:**

- **Sentence case** for everything in the UI: buttons, nav, labels, headings, dialogs.
- Title Case is reserved for proper nouns (instrument names, score titles, people).
- ALL-CAPS is used _only_ for the small `--type-label-*` schematic eyebrows — short tags like "How it works" or "Pricing" — at `0.12em` tracking.
- Display headings use a hint of italic via Newsreader for warmth (e.g. "Write the music _in your head._"); sans-serif Space Grotesk does the structural work. **Newsreader is reserved for marketing + auth surfaces** — the landing page, the auth split-panel, the final CTA, pull-quotes, testimonials. In-app chrome (Library, Editor, Settings page titles) stays in Space Grotesk and skips italic; warmth there is earned through copy, not letterforms.

**Voice — first vs second person:**

- **You.** "Write the music in your head." "Pick up where you left off."
- **We** is fine in moderation when Sheemu is making a promise: "Your music belongs to you, not us."
- Avoid invented in-group nicknames ("operative", "maverick", "rebel"). Just call the user _you_.

**Specific examples (canonical Sheemu copy):**

| Surface              | Sheemu copy                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Email field label    | `Email`                                                                                                                            |
| Password field label | `Password`                                                                                                                         |
| Name field label     | `Your name`                                                                                                                        |
| Sign-up CTA          | `Create account`                                                                                                                   |
| Sign-up tagline      | `Get started — it's free.`                                                                                                         |
| Sign-in tagline      | `Welcome back.`                                                                                                                    |
| Sign-in link copy    | `Already have an account?`                                                                                                         |
| Library page title   | `Your scores`                                                                                                                      |
| Empty state          | `No scores yet. Compose your first one.`                                                                                           |
| Hero headline        | `Write the music in your head.`                                                                                                    |
| Hero sub             | `Sheemu is a fast, quiet space for sketching scores — no fiddly menus, no twelve dialogs to find a sharp. Just you and the notes.` |
| Pricing free tier    | `Sketch — free, forever`                                                                                                           |
| Footer               | `© 2026 Sheemu. Made for composers.`                                                                                               |

**Punctuation & tics:**

- Em-dashes for cadence breaks. No emoji. Exclamation marks only when genuinely warranted (almost never).
- Sentences end with periods, including in body copy and inside cards. Short button labels ("Create account", "Sign in") do not.
- Numbers are bare and lowercase units: `120 bpm`, `4/4`, `8 bars`. Never spelled out.

**Vibe check:** if a draft sounds like a sales pitch, a fighter-jet HUD, or a recruiter LinkedIn post — push it back toward plain. If it sounds like the way you'd describe Sheemu to a friend over coffee, you're close.

---

## Visual foundations

### Colors

A **white-on-white** layering system punctuated by two accent colors. Accents are used sparingly — the workspace stays calm; accents announce action.

| Role                        | Hex                   | Usage                                                                        |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `surface` / canvas          | `#f6f6f6`             | Page background.                                                             |
| `surface_container_lowest`  | `#ffffff`             | Floating cards, modal backgrounds, the score editor.                         |
| `surface_container_low`     | `#f0f1f1`             | Sidebar lift, input field fill, sticky nav.                                  |
| `surface_container`         | `#e7e8e8`             | Mid-level panels, secondary chips.                                           |
| `surface_container_high`    | `#e1e3e3`             | Icon button backgrounds.                                                     |
| `surface_container_highest` | `#dbdddd`             | Heaviest tonal lift.                                                         |
| `on_surface`                | `#2d2f2f`             | Foreground — a soft charcoal, never pure black.                              |
| `on_surface_variant`        | `#5a5c5c`             | Secondary text.                                                              |
| `outline_variant`           | `#acadad`             | Used at 15% opacity as ghost border only.                                    |
| **`primary_container`**     | **`#00DBE9`** Cyan    | LOUD primary fill — CTAs, focus indicators, active tab underline.            |
| `primary_soft`              | `#A6F2F7`             | QUIET cyan fill — feature-icon circles, BPM tap pad, large selectable cards. |
| `primary`                   | `#00666d`             | Primary text on pale surfaces (links).                                       |
| **`secondary_container`**   | **`#FF2079`** Magenta | The signature drop-shadow on the hero CTA, active genre/instrument chips.    |
| `secondary_soft`            | `#FFADBF`             | QUIET magenta fill — avatar initials, "you" tags, instrument pills.          |
| `secondary`                 | `#b60052`             | Destructive text (Sign out, Delete).                                         |
| `error` / `error_container` | `#b31b25` / `#fb5151` | Form errors.                                                                 |

**The no-line rule.** Never use a 1px solid border to section UI. Define boundaries with **tonal shifts** between surfaces. A sidebar at `surface_container_low` against a `surface` background creates a "molded" lift, not a boxed-in feel. Only exception: `outline_variant` at 15% opacity ("ghost border") for accessibility-critical containers.

**The sanctuary rule.** The score editor canvas is _strictly_ `#ffffff` with `#2d2f2f` notes. **No cyan, no magenta in the editor area.** That space stays monochrome for cognitive focus.

**The three-intensity accent rule.** Each accent comes in three intensities — pick by the size _and_ interactivity of the surface:

1. **`*-container`** (`#00DBE9` / `#FF2079`) — **LOUD fill.** Reserved for interactive surfaces that should read as "the action": primary buttons, focus indicators, the active-tab underline, the magenta drop-shadow on the hero CTA. At most one or two on a surface.
2. **`*-soft`** (`#A6F2F7` / `#FFADBF`) — **QUIET fill.** Used when the loud fill would dominate. Two cases:
    - Small **non-clickable identity tags** — avatar initials, instrument pills, "you" badges, status chips. Magenta-container on these reads as a call to action when it shouldn't.
    - **Large selectable / focusable surfaces** where the full neon would shout — onboarding option cards, feature-icon circles on the marketing surface, the BPM tap pad, multi-select chips at rest. Pair with `on-*-soft` for text and iconography (both clear WCAG AA on the soft fill).
3. **bare `primary` / `secondary`** (`#00666d` / `#b60052`) — **ACCENT TEXT.** Foreground only — link text, eyebrow accents, step numbers, hover-darkened states on cyan/magenta-fill buttons, the destructive `Sign out` text. The neons themselves do not pass WCAG AA as text on white (cyan-on-white is ~1.6:1).

> Rule of thumb: `*-container` → loud fill (the action), `*-soft` → quiet fill (identity tags + big selectable areas), bare → accent text on a light surface.

### Typography

Four families, each with a clear job.

| Family            | Role                 | Where                                                                                                                                                                                   |
| ----------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space Grotesk** | Display + UI default | Wordmark, headlines, button labels, nav, card titles, schematic labels. Quirky terminals + technical bones. Loaded weights 300–700.                                                     |
| **Manrope**       | Body copy            | Long-reading paragraphs, marketing prose, settings descriptions. Geometric and very readable. Loaded weights 300–800.                                                                   |
| **Newsreader**    | Serif italic accent  | The italic clause inside a display headline ("_in your head._"), pull-quotes, testimonial copy. **Marketing + auth surfaces only** — not for in-app page titles. Optical-size variable. |
| **Geist Mono**    | Mono                 | File paths, raw MIDI values, bpm and time-signature readouts, step numbers in numbered flows. Loaded weights 400–600.                                                                   |

The wordmark is always **`Sheemu`** in Space Grotesk Bold (700) **italic**, tracked `-0.04em`. Lowercase save the capital S. This _is_ the logo.

Scale tokens live in `colors_and_type.css` — `display-lg / md / sm`, `headline-lg / md`, `title-lg`, `body-lg / md / sm`, `label-lg / md`, `mono-md`.

### Spacing & layout

- 8px base grid; `0.4rem` (~6.4px) is the smallest meaningful step.
- Page max width `1280px` for marketing; `1536px` for app chrome; modal max `42rem`.
- Page-edge gutters: `2rem` (32px) on desktop, `1.2rem` on mobile.
- Sections breathe — `88px` vertical padding on marketing rows, `64px` between major content groups.

### Backgrounds

- Default: solid `surface` (#f6f6f6) — flat, never gradients.
- The editor canvas: pure `#ffffff`, optionally with a 40px-grid `manuscript-canvas` dot texture at 15% `outline_variant`.
- The hero and final-CTA sections may carry a single oversized soft blur — cyan or magenta at low opacity, blurred at 120px — pinned to one corner. This is the **only** place a colored haze is permitted, and it's used quietly.
- **Marketing-emphasis surface (dark inversion).** Exactly one element per marketing surface may invert to `on-surface` (#2d2f2f) fill with `surface` text — used today for the "most picked" pricing tier. This is the only sanctioned dark surface in the system and it lives **strictly on copy / sales / advertising surfaces** (landing, pricing, in-product upsell cards). Never on app chrome or the editor.
- **Forbidden:** purple/blue gradients, mesh gradients, hand-drawn illustrations, photographic full-bleeds in chrome.

### Animation

- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)` — quick out, soft settle. (`--ease`).
- Durations: `150ms` (--t-quick) for hover color, `220ms` (--t-snap) for shadow lift, `300ms` (--t-flow) for tab/border-width transitions.
- **Selected & hovered states must shift _away_ from the page background, not toward it.** Hovered list rows go from `surface_container_lowest` (#fff) up to `surface_container_high` (#e1e3e3) — never to `surface_container_low` (#f0f1f1), which is too close to the page's `surface` (#f6f6f6) and reads as blended. The same rule applies to split-panel layouts (auth, settings): the standout panel uses `surface_container_high`, not `low`, to register clearly against the page.

**The signature interaction (reserved):** the hero CTA on each surface — opt-in via `emphasis="pop"` — translates `-2px` on hover and grows its magenta drop-shadow from `3px 3px` to `5px 5px`. Use this on **at most one or two key actions per surface** — typically the hero CTA, plus the "create" action in the top nav of authenticated views. Don't pop every primary button.

- Input fields animate a **2px primary-cyan bar** from 0 → 100% width along the bottom on focus.
- No bounces, no spring physics, no fade-up-on-scroll. Motion is sharp and quiet.

### Hover & press states

| Element                     | Hover                                                                                                               | Press / active                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Hero CTA (`emphasis="pop"`) | `-translate-y-[2px]`, shadow grows 3px→5px                                                                          | (no extra; it's already lifted) |
| Standard primary button     | bg darkens slightly                                                                                                 | bg darkens further              |
| Icon button                 | bg `surface_container_high` → `primary_container` (cyan) or `secondary_container` (magenta for destructive)         | —                               |
| List row                    | bg `surface_container_lowest` → `surface_container_low`, plus a 4px-wide cyan accent stripe slides in from the left | —                               |
| Tab text                    | `on_surface_variant` → `on_surface`; active tab gains a 3px cyan underline                                          | —                               |
| Sign-out / destructive text | `on_surface` → `secondary` (magenta)                                                                                | —                               |

### Borders

Almost never. The complete border vocabulary:

1. **Active-tab underline** — `border-bottom: 3px solid var(--color-primary-container)`.
2. **Input field bottom stroke** — `2px` cyan, animates 0→100% width on focus.
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

- **Glassmorphism** is reserved for **floating tool-docks** and **dialog overlays**: `surface_container_lowest` at 85% opacity + `backdrop-filter: blur(12px)`. No other use.
- The dialog scrim is `bg-on-surface/40 backdrop-blur-sm` — soft charcoal at 40% with a light blur.
- The sticky top nav uses `surface_container_low/85` + `backdrop-blur-xl` — a barely-there glassy version of the sidebar tone.

### Corner radii

| Token           | Value            | Usage                                                            |
| --------------- | ---------------- | ---------------------------------------------------------------- |
| `--radius-sm`   | `0.25rem` (4px)  | Input fields, control-bar buttons, score-row cells. The default. |
| `--radius-md`   | `0.5rem` (8px)   | Cards, list rows, grouped-button ends.                           |
| `--radius-lg`   | `0.75rem` (12px) | Tool-docks, modals, glass panels, marketing cards.               |
| `--radius-xl`   | `1rem` (16px)    | Full sheets, marketing hero tiles.                               |
| `--radius-full` | `9999px`         | All primary buttons (capsule), chips, icon-only round buttons.   |

### Cards

A Sheemu card is **`surface_container_lowest` + `--shadow-tonal` + `--radius-lg`**. _No border._ On hover, a list-style card may receive a left-side cyan accent stripe slide-in. Padding: `24–28px`. Cards never sit on each other directly — always with `0.8rem` (12.8px) of gap.

---

## Iconography

**Primary system: Material Symbols Outlined** (Google Fonts CDN). Variable font axes set to `wght 400`, `FILL 0`, `GRAD 0`, `opsz 24`. Used inline as `<span class="material-symbols-outlined">name</span>`, or via the `<Icon name="…">` helper in `ui_kits/web/Icon.jsx` (which also accepts Lucide-style aliases like `play`, `trash-2`, `arrow-right` and maps them to Material Symbols names). Common names: `search`, `edit`, `delete`, `close`, `visibility`, `visibility_off`, `arrow_forward`, `music_note`. Loaded in `colors_and_type.css` automatically.

**Notation glyphs: SMuFL / Bravura.** The score editor renders music notation using bundled Bravura outlines (`web/src/origin/fonts/bravura_glyphs.ts`) drawn as `<path>` inside `<svg>`. These are **not for general UI**; they only appear inside the score canvas. We did not copy this 1MB+ glyph file into the design system — re-import from `web/` if you actually need to render notation.

**No emoji.** Sheemu's voice is plain, but it's not casual in that way.

**No unicode glyph icons** for chrome — except the music accidental characters `♮ ♭ ♯` in the score control bar (where they're effectively notation, not iconography).

**Logos / brand marks.** Sheemu has no graphic logo. The wordmark **is** the brand: `Sheemu` set in Space Grotesk 700 italic, tracked `-0.04em`. Always render it as live text. An SVG fallback lives at `assets/sheemu-wordmark.svg` for places that demand an image.

---

## Caveats

- **Fonts are CDN-only.** The codebase uses `next/font/google` to fetch Space Grotesk, Manrope, Newsreader, and Geist Mono at build time; no `.woff2` files are committed. The design system imports them via Google Fonts `@import`, which serves the same files. If you need an offline / paid-license version, source `.woff2`s yourself and drop them in `fonts/` with a matching `@font-face` block.
- **No marketing site / mobile app exists in the codebase.** The Landing and Onboarding screens in this UI kit are designed to fit the brand but are not direct recreations of production code — they're Sheemu-shaped extensions.
- **Notation glyph rendering is not part of the kit.** A static placeholder staff renders in the editor recreation; for real notation, pull `bravura_glyphs.ts` from `web/`.
