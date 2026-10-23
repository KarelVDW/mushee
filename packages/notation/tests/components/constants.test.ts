import { INTERACTION_BLUE, INTERACTION_BLUE_BAND, RECORDING_CURSOR_RED } from '@mushee/notation/components'
import { describe, expect, it } from 'vitest'

describe('the canvas palette', () => {
    it('keeps the one recording red, mirroring --color-record in packages/ui theme.css', () => {
        expect(RECORDING_CURSOR_RED).toBe('#ef4444')
    })

    it('exports the selection band fill: the interaction blue at 14%', () => {
        expect(INTERACTION_BLUE).toBe('#1e90ff')
        expect(INTERACTION_BLUE_BAND).toBe('rgba(30, 144, 255, 0.14)')
    })
})
