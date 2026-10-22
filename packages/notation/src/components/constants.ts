// The renderer's palette and its renderer-only sizes. Every colour the canvas draws with is
// named here, so the canvas palette can be audited in one place.

/**
 * Canvas ink — the sanctuary charcoal from DESIGN.md. Notation is drawn in this, never pure
 * black. Kept as a literal (not a CSS var) so exported SVG/PDF snapshots stay correct
 * outside the app's stylesheet.
 */
export const NOTATION_INK = '#2d2f2f'

/**
 * Interaction overlays inside the canvas share this one blue: the selection band, the
 * hovered/selected notehead tint, the input cursor and the playback cursor. It is
 * deliberately neither brand accent, which are banned inside the editor — the recording
 * waveform (cyan/magenta) and the pitch-operation highlight (magenta) are the two
 * sanctioned brand-accent exceptions. Overlay elements carry `data-export-exclude`, so
 * exports never contain it.
 */
export const INTERACTION_BLUE = '#1e90ff'
export const INTERACTION_BLUE_BAND = 'rgba(30, 144, 255, 0.14)'

/**
 * The pitch-operation highlight (transpose aim / minimize flash) — the brand magenta, the
 * second sanctioned transient exception to the canvas color ban (after the recording
 * waveform): only ever at low opacity, animated away, and `data-export-exclude`d.
 */
export const HIGHLIGHT_MAGENTA = '#FF2079'

/** The brand cyan — with HIGHLIGHT_MAGENTA, the live recording waveform's bar colours. */
export const WAVEFORM_CYAN = '#00DBE9'

/** Add/remove-measure button chrome: face, outline and label. */
export const MEASURE_BUTTON_FILL = 'white'
export const MEASURE_BUTTON_STROKE = '#dbdddd'
export const MEASURE_BUTTON_LABEL = '#5a5c5c'

/**
 * Augmentation dot radius. It is an engraving metric (NoteWidth reserves room for it), so it
 * lives in engraving/constants; re-exported here for the renderer's existing imports.
 */
export { DOT_RADIUS } from '../engraving/constants'
