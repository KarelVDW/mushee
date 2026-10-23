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
/**
 * The selection band's fill: INTERACTION_BLUE at 14%. Exported for drawings outside the
 * canvas that show a selected note (the landing page's vignettes), so none hard-codes it.
 */
export const INTERACTION_BLUE_BAND = 'rgba(30, 144, 255, 0.14)'

/**
 * The playback cursor while a take records: red, the universal "recording" signal, so the
 * cursor itself says the take is live and that what it passes over is being written. Like
 * INTERACTION_BLUE it is a transient overlay, `data-export-exclude`d with the playhead.
 *
 * The one recording red: it mirrors `--color-record` in packages/ui's theme.css (the record
 * button, the strip's live dot, the count-in dots). A literal here, like every canvas colour,
 * so the canvas never depends on the app's stylesheet — keep the two equal.
 */
export const RECORDING_CURSOR_RED = '#ef4444'

/**
 * The pitch-operation highlight (transpose aim / minimize flash) — the brand magenta, the
 * second sanctioned transient exception to the canvas color ban (after the recording
 * waveform): only ever at low opacity, animated away, and `data-export-exclude`d.
 */
export const HIGHLIGHT_MAGENTA = '#FF2079'

/** The brand cyan — with HIGHLIGHT_MAGENTA, the live recording waveform's bar colours. */
export const WAVEFORM_CYAN = '#00DBE9'

/**
 * The recording waveform's bar colours, alternated bar by bar: brand accents (loud tier), the
 * first sanctioned exception to the canvas colour ban. The landing-page demo reuses them.
 */
export const WAVEFORM_COLORS = [WAVEFORM_CYAN, HIGHLIGHT_MAGENTA] as const
