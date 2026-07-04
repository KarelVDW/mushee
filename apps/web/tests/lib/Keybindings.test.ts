import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type BindableCommand, Keybindings, Shortcut, type StoredShortcuts } from '@/lib/Keybindings'

const COMMANDS: BindableCommand[] = [
    { id: 'copy', defaultShortcut: 'Mod+KeyC' },
    { id: 'left', defaultShortcut: 'ArrowLeft' },
    { id: 'rest', defaultShortcut: 'KeyR' },
    { id: 'free', defaultShortcut: null },
]

const STORAGE_KEY = 'test:shortcuts'

const makeKeybindings = (isMac = false) => new Keybindings(COMMANDS, { storageKey: STORAGE_KEY, isMac })

const keydown = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init)

/** Record a shortcut from a synthetic keydown, asserting it is bindable. */
function recorded(init: KeyboardEventInit): Shortcut {
    const shortcut = Shortcut.fromEvent(keydown(init))
    if (!shortcut) throw new Error('expected a bindable shortcut')
    return shortcut
}

beforeEach(() => {
    localStorage.clear()
})

describe('Shortcut', () => {
    it('resolves Mod to the platform primary modifier', () => {
        expect(Shortcut.parse('Mod+KeyC', false)).toMatchObject({ ctrl: true, meta: false, code: 'KeyC' })
        expect(Shortcut.parse('Mod+KeyC', true)).toMatchObject({ ctrl: false, meta: true, code: 'KeyC' })
    })

    it('round-trips through its canonical id', () => {
        const shortcut = Shortcut.parse('Ctrl+Shift+ArrowLeft', false)
        expect(shortcut.id).toBe('Ctrl+Shift+ArrowLeft')
        expect(Shortcut.parse(shortcut.id, false).id).toBe(shortcut.id)
    })

    it('rejects a bare modifier keydown (nothing to bind yet)', () => {
        expect(Shortcut.fromEvent(keydown({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull()
        expect(Shortcut.fromEvent(keydown({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull()
    })

    it('captures the produced character as the label — layout-correct without a layout map', () => {
        // An AZERTY keyboard produces 'é' on the physical Digit2 key.
        const shortcut = recorded({ key: 'é', code: 'Digit2' })
        expect(shortcut.displayParts(null, false)).toEqual(['É'])
    })

    it("prefers the browser's layout map over the recorded label", () => {
        const shortcut = recorded({ key: 'é', code: 'Digit2' })
        expect(shortcut.displayParts(new Map([['Digit2', '2']]), false)).toEqual(['2'])
    })

    it('does not trust characters produced while Shift or Alt were held', () => {
        // Shift+4 produces '$', which would mislabel the base key.
        const shortcut = recorded({ key: '$', code: 'Digit4', shiftKey: true })
        expect(shortcut.label).toBeUndefined()
        expect(shortcut.displayParts(null, false)).toEqual(['Shift', '4'])
    })

    it('renders platform-appropriate modifier and special-key labels', () => {
        expect(Shortcut.parse('Mod+Shift+ArrowLeft', true).displayParts(null, true)).toEqual(['⇧', '⌘', '←'])
        expect(Shortcut.parse('Mod+Shift+ArrowLeft', false).displayParts(null, false)).toEqual(['Ctrl', 'Shift', '←'])
        expect(Shortcut.parse('Backspace', true).displayParts(null, true)).toEqual(['⌫'])
        expect(Shortcut.parse('Backspace', false).displayParts(null, false)).toEqual(['Backspace'])
    })
})

describe('Keybindings resolution', () => {
    it('resolves default bindings by physical key and exact modifiers', () => {
        const keybindings = makeKeybindings()
        expect(keybindings.resolve(keydown({ code: 'KeyC', key: 'c', ctrlKey: true }))?.id).toBe('copy')
        expect(keybindings.resolve(keydown({ code: 'KeyR', key: 'r' }))?.id).toBe('rest')
        expect(keybindings.resolve(keydown({ code: 'ArrowLeft', key: 'ArrowLeft' }))?.id).toBe('left')
        // Extra or missing modifiers don't match.
        expect(keybindings.resolve(keydown({ code: 'KeyC', key: 'c' }))).toBeNull()
        expect(keybindings.resolve(keydown({ code: 'KeyR', key: 'R', shiftKey: true }))).toBeNull()
        expect(keybindings.resolve(keydown({ code: 'KeyC', key: 'c', metaKey: true }))).toBeNull()
    })

    it('binds Mod to ⌘ on a Mac', () => {
        const keybindings = makeKeybindings(true)
        expect(keybindings.resolve(keydown({ code: 'KeyC', key: 'c', metaKey: true }))?.id).toBe('copy')
        expect(keybindings.resolve(keydown({ code: 'KeyC', key: 'c', ctrlKey: true }))).toBeNull()
    })
})

describe('Keybindings customization', () => {
    it('rebinds a command to a new key and releases its old one', () => {
        const keybindings = makeKeybindings()
        const displaced = keybindings.rebind('rest', recorded({ code: 'KeyJ', key: 'j' }))
        expect(displaced).toBeNull()
        expect(keybindings.resolve(keydown({ code: 'KeyJ', key: 'j' }))?.id).toBe('rest')
        expect(keybindings.resolve(keydown({ code: 'KeyR', key: 'r' }))).toBeNull()
        expect(keybindings.isCustomized('rest')).toBe(true)
        expect(keybindings.shortcutFor('rest')?.id).toBe('KeyJ')
    })

    it('taking a shortcut unbinds and reports its previous holder', () => {
        const keybindings = makeKeybindings()
        const displaced = keybindings.rebind('free', Shortcut.parse('ArrowLeft', false))
        expect(displaced?.id).toBe('left')
        expect(keybindings.resolve(keydown({ code: 'ArrowLeft', key: 'ArrowLeft' }))?.id).toBe('free')
        expect(keybindings.shortcutFor('left')).toBeNull()
        expect(keybindings.isCustomized('left')).toBe(true)
    })

    it('rebinding back to the default drops the customization', () => {
        const keybindings = makeKeybindings()
        keybindings.rebind('rest', recorded({ code: 'KeyJ', key: 'j' }))
        keybindings.rebind('rest', recorded({ code: 'KeyR', key: 'r' }))
        expect(keybindings.isCustomized('rest')).toBe(false)
        expect(keybindings.hasCustomizations).toBe(false)
    })

    it('unbinds a command entirely', () => {
        const keybindings = makeKeybindings()
        keybindings.unbind('left')
        expect(keybindings.resolve(keydown({ code: 'ArrowLeft', key: 'ArrowLeft' }))).toBeNull()
        expect(keybindings.shortcutFor('left')).toBeNull()
        expect(keybindings.hasCustomizations).toBe(true)
    })

    it('reset restores the default, taking the shortcut back from its current holder', () => {
        const keybindings = makeKeybindings()
        keybindings.rebind('free', Shortcut.parse('ArrowLeft', false))
        keybindings.reset('left')
        expect(keybindings.resolve(keydown({ code: 'ArrowLeft', key: 'ArrowLeft' }))?.id).toBe('left')
        expect(keybindings.shortcutFor('free')).toBeNull()
        expect(keybindings.isCustomized('left')).toBe(false)
    })

    it('resetAll clears every customization and the stored overrides', () => {
        const keybindings = makeKeybindings()
        keybindings.rebind('rest', recorded({ code: 'KeyJ', key: 'j' }))
        keybindings.unbind('left')
        keybindings.resetAll()
        expect(keybindings.hasCustomizations).toBe(false)
        expect(keybindings.resolve(keydown({ code: 'KeyR', key: 'r' }))?.id).toBe('rest')
        expect(keybindings.resolve(keydown({ code: 'ArrowLeft', key: 'ArrowLeft' }))?.id).toBe('left')
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('notifies subscribers with a bumped version on every change', () => {
        const keybindings = makeKeybindings()
        let calls = 0
        keybindings.subscribe(() => calls++)
        const before = keybindings.getSnapshot()
        keybindings.rebind('rest', recorded({ code: 'KeyJ', key: 'j' }))
        expect(calls).toBe(1)
        expect(keybindings.getSnapshot()).toBeGreaterThan(before)
    })
})

describe('Keybindings persistence', () => {
    it('restores overrides (including explicit unbinds and labels) in a fresh instance', () => {
        const first = makeKeybindings()
        first.rebind('rest', recorded({ code: 'KeyJ', key: 'j' }))
        first.unbind('left')

        const second = makeKeybindings()
        expect(second.resolve(keydown({ code: 'KeyJ', key: 'j' }))?.id).toBe('rest')
        expect(second.resolve(keydown({ code: 'ArrowLeft', key: 'ArrowLeft' }))).toBeNull()
        expect(second.shortcutFor('rest')?.displayParts(null, false)).toEqual(['J'])
    })

    it('falls back to the defaults on corrupted storage', () => {
        localStorage.setItem(STORAGE_KEY, '{not json')
        const keybindings = makeKeybindings()
        expect(keybindings.resolve(keydown({ code: 'KeyR', key: 'r' }))?.id).toBe('rest')
        expect(keybindings.hasCustomizations).toBe(false)
    })

    it('ignores stored overrides for commands that no longer exist', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, overrides: { ghost: { keys: 'KeyZ' } } }))
        const keybindings = makeKeybindings()
        expect(keybindings.resolve(keydown({ code: 'KeyZ', key: 'z' }))).toBeNull()
        expect(keybindings.hasCustomizations).toBe(false)
    })
})

describe('Keybindings account sync', () => {
    it('serializes the override set (rebinds with labels, explicit unbinds) and null for pure defaults', () => {
        const keybindings = makeKeybindings()
        expect(keybindings.toStored()).toBeNull()

        keybindings.rebind('rest', recorded({ code: 'KeyJ', key: 'j' }))
        keybindings.unbind('left')
        expect(keybindings.toStored()).toEqual({
            version: 1,
            overrides: { rest: { keys: 'KeyJ', label: 'j' }, left: null },
        })
    })

    it('reports every change through onDidChange with the serialized set', () => {
        const keybindings = makeKeybindings()
        const changes: Array<StoredShortcuts | null> = []
        keybindings.onDidChange = (stored) => changes.push(stored)

        keybindings.rebind('rest', recorded({ code: 'KeyJ', key: 'j' }))
        keybindings.resetAll()
        expect(changes).toHaveLength(2)
        expect(changes[0]?.overrides.rest).toEqual({ keys: 'KeyJ', label: 'j' })
        expect(changes[1]).toBeNull()
    })

    it('hydrate replaces local overrides with the account set and updates localStorage', () => {
        const keybindings = makeKeybindings()
        keybindings.rebind('copy', recorded({ code: 'KeyX', key: 'x' }))

        let notified = 0
        keybindings.subscribe(() => notified++)
        keybindings.hydrate({ version: 1, overrides: { rest: { keys: 'KeyJ', label: 'j' }, left: null } })

        expect(notified).toBe(1)
        // The account set fully replaces the local one — the copy rebind is gone.
        expect(keybindings.resolve(keydown({ code: 'KeyC', key: 'c', ctrlKey: true }))?.id).toBe('copy')
        expect(keybindings.resolve(keydown({ code: 'KeyJ', key: 'j' }))?.id).toBe('rest')
        expect(keybindings.shortcutFor('left')).toBeNull()
        // A fresh instance reads the hydrated set back from localStorage.
        expect(makeKeybindings().resolve(keydown({ code: 'KeyJ', key: 'j' }))?.id).toBe('rest')
    })

    it('hydrate does not echo into onDidChange', () => {
        const keybindings = makeKeybindings()
        const onDidChange = vi.fn()
        keybindings.onDidChange = onDidChange
        keybindings.hydrate({ version: 1, overrides: { left: null } })
        expect(onDidChange).not.toHaveBeenCalled()
    })

    it('hydrate(null) puts every command back on its default', () => {
        const keybindings = makeKeybindings()
        keybindings.rebind('rest', recorded({ code: 'KeyJ', key: 'j' }))
        keybindings.hydrate(null)
        expect(keybindings.hasCustomizations).toBe(false)
        expect(keybindings.resolve(keydown({ code: 'KeyR', key: 'r' }))?.id).toBe('rest')
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('hydrate skips unknown commands and survives malformed entries', () => {
        const keybindings = makeKeybindings()
        keybindings.hydrate({ version: 1, overrides: { ghost: { keys: 'KeyZ' }, left: null } })
        expect(keybindings.resolve(keydown({ code: 'KeyZ', key: 'z' }))).toBeNull()
        expect(keybindings.shortcutFor('left')).toBeNull()

        expect(() => keybindings.hydrate({ version: 1, overrides: { rest: { keys: 'Bogus+KeyJ' } } })).not.toThrow()
    })
})
