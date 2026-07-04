---
name: sheemu-design
description: Use this skill to generate well-branded interfaces and assets for Sheemu, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files (`colors_and_type.css`, `assets/`, `preview/`, `ui_kits/web/`).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. Drop `colors_and_type.css` into the page and inherit the tokens. The `ui_kits/web/` JSX files are ready to be lifted as-is for prototyping; load them after React + Babel.

If working on production code, you can copy assets and read the rules in `README.md` to become an expert in designing with this brand. The production source of truth is the `web/` Next.js codebase referenced in the README.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

**Critical Sheemu rules to remember:**

- Two accent colors only: cyan `#00DBE9` and magenta `#FF2079`. Use them sparingly; the rest of the system is white-on-white tonal layering.
- **No 1px solid borders for sectioning.** Use surface tonal shifts to define regions.
- Type stack: **Space Grotesk** for display + UI, **Manrope** for body copy at long-reading sizes, **Newsreader** italic for warm/literary moments **on marketing + auth surfaces only** (not in-app page titles), **Geist Mono** for code and numeric readouts.
- The signature CTA treatment — flat magenta `3px 3px 0` drop-shadow that grows to `5px 5px 0` on `-2px` hover translate — is reserved for **one hero CTA per surface** (opt-in via `emphasis="pop"`). Don't apply it to every primary button.
- Voice is plain, warm, and confident. Write the way a thoughtful musician would talk to another musician — no jargon, no hype, no SaaS clichés. "Sketch a piece," "hear it back," "your music belongs to you."
- The score editor canvas is monochrome — pure white with charcoal `#2d2f2f` notes. No cyan or magenta inside.
- Iconography is the **custom Sheemu glyph set** — inline SVGs on a 24px grid with 2px strokes, squared terminals, and mitered joins (registry in `web/src/components/ui/Icon.tsx`, mirrored in `ui_kits/web/Icon.jsx`). No icon fonts, no emoji.
- No purple/blue gradients. No hand-drawn illustrations.
