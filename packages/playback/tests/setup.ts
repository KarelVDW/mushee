import { vi } from 'vitest'

// Deterministic glyph widths for the Scores the tests build: metrics come from the shared
// width table, not the font data (the same double the notation and web suites use).
vi.mock('@mushee/notation/engraving/Bravura', () => import('@mushee/notation/testing/glyphMetricsMock'))
