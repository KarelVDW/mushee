import { vi } from 'vitest'

// Deterministic glyph widths: metrics come from the shared width table, not the font data,
// so width and layout assertions hold exact numbers (the same double the web and playback
// suites use).
vi.mock('../src/engraving/Bravura', () => import('../src/testing/glyphMetricsMock'))
