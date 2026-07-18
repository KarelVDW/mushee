/** True on macOS/iOS — decides the primary shortcut modifier (⌘ there, Ctrl elsewhere). */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** Keys that can never form a shortcut on their own — recording keeps waiting through these. */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu', 'Fn', 'FnLock'])

/** Display labels for non-printing keys the browser's layout map doesn't cover. */
const SPECIAL_LABELS: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Escape: 'Esc',
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Del',
    Home: 'Home',
    End: 'End',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
}
const MAC_SPECIAL_LABELS: Record<string, string> = { Backspace: '⌫', Delete: '⌦', Enter: '↩' }

/**
 * One keystroke: a physical key ({@link KeyboardEvent.code}) plus modifiers.
 *
 * Binding to the physical key is what makes shortcuts layout-independent — the key next to
 * your pinky stays the shortcut whether the layout prints Q or A on it. Display goes the
 * other way: {@link displayParts} translates the code back through the browser's live layout
 * map (with the character captured at recording time as fallback) so the label always matches
 * what's printed on the user's keycap.
 */
export class Shortcut {
    private constructor(
        readonly code: string,
        readonly ctrl: boolean,
        readonly meta: boolean,
        readonly alt: boolean,
        readonly shift: boolean,
        /** Character the key produced when recorded — the layout-correct label when no layout map is available. */
        readonly label?: string,
    ) {}

    /**
     * Parse a spec like `'Mod+Shift+ArrowLeft'`. Modifier tokens: `Mod` (⌘ on Mac, Ctrl
     * elsewhere), `Ctrl`, `Meta`, `Alt`, `Shift`; the final token is a {@link KeyboardEvent.code}.
     */
    static parse(spec: string, isMac: boolean, label?: string): Shortcut {
        const tokens = spec.split('+')
        const code = tokens.pop()
        if (!code) throw new Error(`Empty shortcut spec: '${spec}'`)
        let ctrl = false
        let meta = false
        let alt = false
        let shift = false
        for (const token of tokens) {
            if (token === 'Mod') {
                if (isMac) meta = true
                else ctrl = true
            } else if (token === 'Ctrl') ctrl = true
            else if (token === 'Meta') meta = true
            else if (token === 'Alt') alt = true
            else if (token === 'Shift') shift = true
            else throw new Error(`Unknown modifier '${token}' in shortcut spec '${spec}'`)
        }
        return new Shortcut(code, ctrl, meta, alt, shift, label)
    }

    /** The keystroke a keydown represents, or null for a bare modifier (nothing to bind yet). */
    static fromEvent(e: KeyboardEvent): Shortcut | null {
        if (!e.code || MODIFIER_KEYS.has(e.key)) return null
        // Only an unmodified single character is a trustworthy label: Shift/Alt change what
        // the key produces ('4' → '$', mac Alt+C → 'ç'), which would mislabel the base key.
        const printable = e.key.length === 1 && !e.shiftKey && !e.altKey ? e.key : undefined
        return new Shortcut(e.code, e.ctrlKey, e.metaKey, e.altKey, e.shiftKey, printable)
    }

    /** Canonical identity (also the storage format) — equal ids fire on the same keystroke. */
    get id(): string {
        const mods = [this.ctrl && 'Ctrl', this.alt && 'Alt', this.shift && 'Shift', this.meta && 'Meta'].filter(Boolean)
        return [...mods, this.code].join('+')
    }

    /**
     * The shortcut as display tokens, e.g. `['⌘', 'C']` or `['Ctrl', 'Shift', '→']`. `layout`
     * is the browser's code→character map (`navigator.keyboard.getLayoutMap()`) when available.
     */
    displayParts(layout: ReadonlyMap<string, string> | null, isMac: boolean): string[] {
        const parts: string[] = []
        if (this.ctrl) parts.push(isMac ? '⌃' : 'Ctrl')
        if (this.alt) parts.push(isMac ? '⌥' : 'Alt')
        if (this.shift) parts.push(isMac ? '⇧' : 'Shift')
        if (this.meta) parts.push(isMac ? '⌘' : 'Win')
        parts.push(this.baseLabel(layout, isMac))
        return parts
    }

    private baseLabel(layout: ReadonlyMap<string, string> | null, isMac: boolean): string {
        const printed = layout?.get(this.code) ?? this.label
        if (printed?.trim()) return printed.length === 1 ? printed.toUpperCase() : printed
        const special = (isMac ? MAC_SPECIAL_LABELS[this.code] : undefined) ?? SPECIAL_LABELS[this.code]
        return special ?? this.code.replace(/^(Key|Digit)/, '')
    }
}

/** What {@link Keybindings} needs to know about a command; the UI layers richer types on top. */
export interface BindableCommand {
    id: string
    /** Default shortcut spec (see {@link Shortcut.parse}) — null for commands unbound by default. */
    defaultShortcut: string | null
}

/** One persisted deviation from a command's default; null in a {@link StoredShortcuts} map means "explicitly unbound". */
export interface StoredOverride {
    keys: string
    label?: string
}

/**
 * The serialized override set — the format persisted to localStorage and to the user's
 * account settings (see `keyboardShortcuts` in the settings API).
 */
export interface StoredShortcuts {
    version: 1
    overrides: Record<string, StoredOverride | null>
}

export interface KeybindingsOptions {
    /** localStorage key holding the user's overrides. */
    storageKey?: string
    /** Platform override for tests; defaults to the detected platform. */
    isMac?: boolean
}

/**
 * The user's keyboard map for a set of commands: the commands' defaults plus persisted
 * overrides. Only deviations from the defaults are stored (in localStorage, tolerating
 * unavailable storage), and a `null` override means "explicitly unbound". A keystroke can
 * only mean one thing: binding a taken shortcut unbinds its previous holder.
 *
 * Like the ScoreManipulator it is a `useSyncExternalStore` source — {@link subscribe} +
 * {@link getSnapshot} expose a monotonic version that bumps on any change.
 */
export class Keybindings<C extends BindableCommand> {
    readonly isMac: boolean
    private readonly storageKey: string
    private readonly defaults = new Map<string, Shortcut | null>()
    private readonly overrides = new Map<string, Shortcut | null>()
    private byShortcut = new Map<string, C>()
    private _version = 0
    private readonly listeners = new Set<() => void>()

    /**
     * Notified after every user-made change with the full serialized override set (null when
     * back on the defaults) — the hook for pushing customizations to the user's account.
     * Not called by {@link hydrate}, whose data already lives at the source.
     */
    onDidChange?: (stored: StoredShortcuts | null) => void

    constructor(
        readonly commands: readonly C[],
        options: KeybindingsOptions = {},
    ) {
        this.isMac = options.isMac ?? IS_MAC
        this.storageKey = options.storageKey ?? 'solkey:shortcuts'
        for (const command of commands) {
            this.defaults.set(command.id, command.defaultShortcut ? Shortcut.parse(command.defaultShortcut, this.isMac) : null)
        }
        this.load()
        this.reindex()
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSnapshot = (): number => this._version

    /** The shortcut currently bound to a command (override, else default), or null when unbound. */
    shortcutFor(commandId: string): Shortcut | null {
        if (this.overrides.has(commandId)) return this.overrides.get(commandId) ?? null
        return this.defaults.get(commandId) ?? null
    }

    /** Whether a command deviates from its default (rebound or explicitly unbound). */
    isCustomized(commandId: string): boolean {
        return this.overrides.has(commandId)
    }

    get hasCustomizations(): boolean {
        return this.overrides.size > 0
    }

    /** The command a keydown should trigger, or null when the keystroke isn't bound. */
    resolve(e: KeyboardEvent): C | null {
        const shortcut = Shortcut.fromEvent(e)
        return shortcut ? (this.byShortcut.get(shortcut.id) ?? null) : null
    }

    /**
     * Bind a shortcut to a command. A different command previously holding that shortcut is
     * unbound and returned, so the UI can call the reassignment out.
     */
    rebind(commandId: string, shortcut: Shortcut): C | null {
        const holder = this.byShortcut.get(shortcut.id)
        const displaced = holder && holder.id !== commandId ? holder : null
        if (displaced) this.override(displaced.id, null)
        this.override(commandId, shortcut)
        this.commit()
        return displaced
    }

    /** Remove a command's shortcut entirely. */
    unbind(commandId: string): void {
        this.override(commandId, null)
        this.commit()
    }

    /** Put a command back on its default, unbinding whichever command holds that shortcut now. */
    reset(commandId: string): void {
        const fallback = this.defaults.get(commandId)
        if (fallback) {
            const holder = this.byShortcut.get(fallback.id)
            if (holder && holder.id !== commandId) this.override(holder.id, null)
        }
        this.overrides.delete(commandId)
        this.commit()
    }

    resetAll(): void {
        this.overrides.clear()
        this.commit()
    }

    /** The full override set in storage format, or null when every command is on its default. */
    toStored(): StoredShortcuts | null {
        if (this.overrides.size === 0) return null
        const overrides: Record<string, StoredOverride | null> = {}
        for (const [id, shortcut] of this.overrides) overrides[id] = shortcut ? { keys: shortcut.id, label: shortcut.label } : null
        return { version: 1, overrides }
    }

    /**
     * Replace the override set with one loaded from the user's account (cross-device sync),
     * updating the localStorage copy to match. Subscribers are notified; {@link onDidChange}
     * is not — the source already has this state.
     */
    hydrate(stored: StoredShortcuts | null): void {
        this.overrides.clear()
        try {
            this.applyStored(stored)
        } catch {
            /* malformed data — whatever applied before the bad entry stands */
        }
        this.reindex()
        this.persist()
        this._version++
        for (const listener of this.listeners) listener()
    }

    /** Record an override, dropping it when it lands back on the command's own default. */
    private override(commandId: string, shortcut: Shortcut | null): void {
        const fallback = this.defaults.get(commandId) ?? null
        const isDefault = shortcut === null ? fallback === null : fallback !== null && fallback.id === shortcut.id
        if (isDefault) this.overrides.delete(commandId)
        else this.overrides.set(commandId, shortcut)
    }

    private commit(): void {
        this.reindex()
        this.persist()
        this._version++
        for (const listener of this.listeners) listener()
        this.onDidChange?.(this.toStored())
    }

    private reindex(): void {
        this.byShortcut = new Map()
        for (const command of this.commands) {
            const shortcut = this.shortcutFor(command.id)
            if (shortcut && !this.byShortcut.has(shortcut.id)) this.byShortcut.set(shortcut.id, command)
        }
    }

    private persist(): void {
        // Tolerate unavailable localStorage (private mode) — customizations simply don't stick.
        try {
            const stored = this.toStored()
            if (stored === null) localStorage.removeItem(this.storageKey)
            else localStorage.setItem(this.storageKey, JSON.stringify(stored))
        } catch {
            /* noop */
        }
    }

    private load(): void {
        if (typeof window === 'undefined') return
        try {
            const raw = localStorage.getItem(this.storageKey)
            if (raw) this.applyStored(JSON.parse(raw) as StoredShortcuts)
        } catch {
            /* corrupted or unavailable storage — fall back to the defaults */
        }
    }

    private applyStored(stored: StoredShortcuts | null): void {
        for (const [id, entry] of Object.entries(stored?.overrides ?? {})) {
            if (!this.defaults.has(id)) continue // the command no longer exists
            if (entry === null) this.overrides.set(id, null)
            else if (typeof entry.keys === 'string') this.overrides.set(id, Shortcut.parse(entry.keys, this.isMac, entry.label))
        }
    }
}
