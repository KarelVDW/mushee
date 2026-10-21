import { vi } from 'vitest'

// Building Scores in tests must never load the large Bravura font data: glyph metrics
// come from the shared width table (the same double the notation and web suites use).
vi.mock('@mushee/notation/engraving/Bravura', () => import('@mushee/notation/testing/glyphMetricsMock'))
