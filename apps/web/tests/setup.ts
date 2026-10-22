import { vi } from 'vitest'

// Deterministic glyph widths: metrics come from the shared width table in @mushee/notation,
// not the font data, so width and layout assertions hold exact numbers (the same double the
// notation and playback suites use).
vi.mock('@mushee/notation/engraving/Bravura', () => import('@mushee/notation/testing/glyphMetricsMock'))
