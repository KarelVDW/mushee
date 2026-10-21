import { vi } from 'vitest'

// Keep the large Bravura font data out of the suite: glyph metrics come from the shared
// width table in @mushee/notation (the same double the notation and playback suites use).
vi.mock('@mushee/notation/engraving/Bravura', () => import('@mushee/notation/testing/glyphMetricsMock'))
