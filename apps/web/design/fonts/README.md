# Fonts

Sheemu uses **Space Grotesk** and **Geist Mono** exclusively, both loaded from Google Fonts via the `@import` at the top of `../colors_and_type.css`. No local font files are committed in the source codebase, so none have been copied here.

If you need an offline / licensed copy:
1. Download `.woff2` files from Google Fonts (or your licensed vendor).
2. Drop them into this folder.
3. Add `@font-face` declarations to `../colors_and_type.css` and remove the Google Fonts `@import` line.

No font substitutions were needed — Space Grotesk and Geist Mono are both available on Google Fonts.

## Notation glyphs

Music notation in the score editor is rendered from **Bravura** SMuFL outlines bundled at `web/src/origin/fonts/bravura_glyphs.ts` in the production codebase. These are *not* used outside the score canvas and are not copied here — re-import from `web/` when working on notation features.
