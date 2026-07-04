'use client'

import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'

import { DialogPanel, DialogScrim, Eyebrow, IconButton, PrimaryButton, TertiaryButton } from '@/components/ui'
import { type Keybindings, Shortcut } from '@/lib/Keybindings'

import { EDITOR_COMMAND_GROUPS, type EditorCommand } from './commands'

/** Minimal typing for the (Chromium-only) Keyboard Layout Map API. */
interface KeyboardLayoutNavigator {
    keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> }
}

interface KeyboardShortcutsDialogProps {
    open: boolean
    keybindings: Keybindings<EditorCommand>
    onClose: () => void
}

/**
 * Lists every editor command with its shortcut and lets the user rebind them: click a
 * shortcut, press the new keys. Changes persist through the {@link Keybindings} store and
 * apply immediately. Keycap labels follow the user's own keyboard layout (see Keybindings).
 */
export function KeyboardShortcutsDialog({ open, keybindings, onClose }: KeyboardShortcutsDialogProps) {
    useSyncExternalStore(keybindings.subscribe, keybindings.getSnapshot, keybindings.getSnapshot)
    const [layout, setLayout] = useState<ReadonlyMap<string, string> | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    // Fetch the browser's live code → character map on every open (the user may have switched
    // system layouts); where the API is missing, labels fall back inside Shortcut.displayParts.
    useEffect(() => {
        if (!open) return
        setEditingId(null)
        setNotice(null)
        const { keyboard } = navigator as Navigator & KeyboardLayoutNavigator
        keyboard?.getLayoutMap?.().then(setLayout, () => undefined)
    }, [open])

    // While recording, capture every keydown before the rest of the app sees it: Escape
    // cancels, a bare modifier keeps waiting, anything else becomes the new binding.
    useEffect(() => {
        if (!editingId) return
        const record = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.key === 'Escape') {
                setEditingId(null)
                return
            }
            const shortcut = Shortcut.fromEvent(e)
            if (!shortcut) return
            const displaced = keybindings.rebind(editingId, shortcut)
            setNotice(displaced ? `This shortcut was taken from “${displaced.label}”, which is now unbound.` : null)
            setEditingId(null)
        }
        window.addEventListener('keydown', record, { capture: true })
        return () => window.removeEventListener('keydown', record, { capture: true })
    }, [editingId, keybindings])

    // Escape closes the dialog — unless a recording is in progress, which captures it above.
    useEffect(() => {
        if (!open) return
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [open, onClose])

    if (!open) return null

    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title="Keyboard shortcuts"
                eyebrow="Click a shortcut to record a new one. Keys follow your keyboard layout."
                onClose={onClose}
                width={620}
                footer={
                    <>
                        {notice && (
                            <span className="mr-auto text-left font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                                {notice}
                            </span>
                        )}
                        {keybindings.hasCustomizations && (
                            <TertiaryButton
                                onClick={() => {
                                    keybindings.resetAll()
                                    setNotice(null)
                                }}>
                                Restore defaults
                            </TertiaryButton>
                        )}
                        <PrimaryButton emphasis="pop" onClick={onClose}>
                            Done
                        </PrimaryButton>
                    </>
                }>
                <div className="overflow-y-auto min-h-0 flex flex-col gap-5 pb-2">
                    {EDITOR_COMMAND_GROUPS.map((group) => (
                        <section key={group} className="flex flex-col">
                            <div className="px-2.5 pb-1.5">
                                <Eyebrow>{group}</Eyebrow>
                            </div>
                            {keybindings.commands
                                .filter((command) => command.group === group)
                                .map((command) => (
                                    <ShortcutRow
                                        key={command.id}
                                        command={command}
                                        keybindings={keybindings}
                                        layout={layout}
                                        editing={editingId === command.id}
                                        onEditToggle={() => setEditingId((current) => (current === command.id ? null : command.id))}
                                    />
                                ))}
                        </section>
                    ))}
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}

interface ShortcutRowProps {
    command: EditorCommand
    keybindings: Keybindings<EditorCommand>
    layout: ReadonlyMap<string, string> | null
    editing: boolean
    onEditToggle: () => void
}

function ShortcutRow({ command, keybindings, layout, editing, onEditToggle }: ShortcutRowProps) {
    const shortcut = keybindings.shortcutFor(command.id)
    return (
        <div className="group flex items-center justify-between gap-4 px-2.5 py-1 rounded-lg hover:bg-surface-container-low transition-colors duration-150">
            <span className="font-body font-normal text-[13px] leading-none text-on-surface">{command.label}</span>
            <div className="flex items-center gap-1">
                {!editing && keybindings.isCustomized(command.id) && (
                    <IconButton
                        icon="rotate-ccw"
                        size={24}
                        ariaLabel={`Reset shortcut for ${command.label}`}
                        idleClassName="bg-transparent text-on-surface-variant opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => keybindings.reset(command.id)}
                    />
                )}
                {!editing && shortcut && (
                    <IconButton
                        icon="x"
                        size={24}
                        ariaLabel={`Remove shortcut for ${command.label}`}
                        idleClassName="bg-transparent text-on-surface-variant opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => keybindings.unbind(command.id)}
                    />
                )}
                <button
                    type="button"
                    onClick={onEditToggle}
                    aria-label={`Change shortcut for ${command.label}`}
                    className="bg-transparent border-0 p-0 cursor-pointer">
                    {editing ? (
                        <span className="inline-flex items-center font-label font-semibold text-[11px] leading-none uppercase tracking-[0.04em] text-on-surface bg-primary-container/40 rounded-[0.25rem] px-2 py-1.5 animate-pulse">
                            Press a key…
                        </span>
                    ) : shortcut ? (
                        <ShortcutKeys shortcut={shortcut} layout={layout} isMac={keybindings.isMac} />
                    ) : (
                        <span className="inline-flex items-center font-body font-normal text-[12px] leading-none text-on-surface-variant px-1 py-1.5">
                            Not set
                        </span>
                    )}
                </button>
            </div>
        </div>
    )
}

function ShortcutKeys({ shortcut, layout, isMac }: { shortcut: Shortcut; layout: ReadonlyMap<string, string> | null; isMac: boolean }) {
    return (
        <span className="inline-flex items-center gap-1">
            {shortcut.displayParts(layout, isMac).map((part, index) => (
                <Fragment key={`${index}-${part}`}>
                    {index > 0 && (
                        <span aria-hidden className="font-body font-normal text-[11px] leading-none text-on-surface-variant">
                            +
                        </span>
                    )}
                    <kbd className="inline-flex items-center justify-center font-label font-semibold text-[11px] leading-none text-on-surface bg-surface-container rounded-[0.25rem] px-1.5 py-1.5 min-w-6">
                        {part}
                    </kbd>
                </Fragment>
            ))}
        </span>
    )
}
