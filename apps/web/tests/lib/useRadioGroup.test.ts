import { describe, expect, it } from 'vitest'

import { rovingIndexForKey } from '@/lib/useRadioGroup'

const press = (key: string, mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => ({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...mods,
})

describe('rovingIndexForKey', () => {
    it('moves to the next item on Down/Right and the previous on Up/Left, wrapping at either end', () => {
        expect(rovingIndexForKey(press('ArrowDown'), 0, 3)).toBe(1)
        expect(rovingIndexForKey(press('ArrowRight'), 2, 3)).toBe(0)
        expect(rovingIndexForKey(press('ArrowUp'), 1, 3)).toBe(0)
        expect(rovingIndexForKey(press('ArrowLeft'), 0, 3)).toBe(2)
    })

    it('jumps to the first item on Home and the last on End', () => {
        expect(rovingIndexForKey(press('Home'), 2, 4)).toBe(0)
        expect(rovingIndexForKey(press('End'), 0, 4)).toBe(3)
    })

    it('ignores other keys and arrows held with a modifier (Alt+Left is Back)', () => {
        expect(rovingIndexForKey(press('Tab'), 0, 3)).toBeNull()
        expect(rovingIndexForKey(press(' '), 0, 3)).toBeNull()
        expect(rovingIndexForKey(press('ArrowLeft', { altKey: true }), 1, 3)).toBeNull()
        expect(rovingIndexForKey(press('ArrowDown', { ctrlKey: true }), 1, 3)).toBeNull()
        expect(rovingIndexForKey(press('ArrowRight', { metaKey: true }), 1, 3)).toBeNull()
    })
})
