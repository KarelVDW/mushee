# Fonts

Sheemu uses four families, each with a clear job:

- **Space Grotesk** — display + UI (wordmark, headlines, buttons, labels)
- **Manrope** — body copy at long-reading sizes
- **Newsreader** — serif italic accent, **marketing + auth surfaces only** (never in-app page titles)
- **Geist Mono** — code and numeric readouts (bpm, time signatures, file paths)

The production app loads all four via `next/font/google` in `apps/web/src/app/layout.tsx`; this design kit loads the same families from Google Fonts via the `@import` at the top of `../colors_and_type.css`. No local font files are committed in the source codebase, so none have been copied here.

If you need an offline / licensed copy:

1. Download `.woff2` files from Google Fonts (or your licensed vendor).
2. Drop them into this folder.
3. Add `@font-face` declarations to `../colors_and_type.css` and remove the Google Fonts `@import` line.

No font substitutions were needed — all four families are available on Google Fonts.

## Notation glyphs

Music notation in the score editor is rendered from **Bravura** SMuFL outlines bundled at `apps/web/src/components/notation/fonts/bravura_glyphs.ts` in the production codebase. These are _not_ used outside the score canvas and are not copied here — re-import from the app when working on notation features.
