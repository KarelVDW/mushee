import { vi } from 'vitest'

// Keep the large Bravura font data out of the suite: glyph metrics come from the shared
// width table (the same double the web and playback suites use).
vi.mock('../src/engraving/Bravura', () => import('../src/testing/glyphMetricsMock'))
