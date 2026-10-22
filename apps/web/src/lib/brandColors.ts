/**
 * JS mirror of the shared theme's @theme colour tokens (packages/ui/src/theme.css),
 * for the contexts that can't read the stylesheet: the viewport theme colour, the
 * web manifest, the Open Graph card (rendered by Satori) and the last-resort
 * global error page (which renders when the layout that imports globals.css has
 * failed). Keep each value in step with its `--color-*` token in theme.css.
 */
export const BRAND = {
    /** --color-surface: the canvas tone. */
    surface: '#f6f6f6',
    /** --color-on-surface: body ink. */
    onSurface: '#2d2f2f',
    /** --color-on-surface-variant: secondary ink. */
    onSurfaceVariant: '#5a5c5c',
    /** --color-surface-container-low: the quiet tonal step (secondary buttons). */
    surfaceContainerLow: '#f0f1f1',
    /** --color-primary-container: the neon cyan fill. */
    primaryContainer: '#00dbe9',
    /** --color-on-primary-container: ink on the cyan fill, and the brand's deep teal. */
    onPrimaryContainer: '#005359',
} as const
