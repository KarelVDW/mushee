'use client'

import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'

import { DialogPanel, Eyebrow, IconButton, Keycap, PrimaryButton, TertiaryButton } from '@/components/ui'
import { useKeyboardLayout } from '@/components/ui/Tooltip'
import { type Keybindings, KeyboardLayout, Shortcut } from '@/lib/Keybindings'

import { EDITOR_COMMAND_GROUPS, type EditorCommand } from './commands'

interface KeyboardShortcutsDialogProps {
    keybindings: Keybindings<EditorCommand>
    onClose: () => void
}

/**
 * Lists every editor command with its shortcut and lets the user rebind them: click a
 * shortcut, press the new keys. Changes persist through the {@link Keybindings} store and
 * apply immediately. Keycap labels follow the user's own keyboard layout ({@link KeyboardLayout},
 * the same map the tooltips and the More popover read). Mounted only while open, so each
 * opening starts with no recording and no notice.
 */
export function KeyboardShortcutsDialog({ keybindings, onClose }: KeyboardShortcutsDialogProps) {
    useSyncExternalStore(keybindings.subscribe, keybindings.getSnapshot, keybindings.getSnapshot)
    const layout = useKeyboardLayout()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    // Fetch the browser's live code → character map again on every open (the user may have
    // switched system layouts); every other surface naming a key follows the refreshed map.
    useEffect(() => KeyboardLayout.current.refresh(), [])

    // While recording, capture every keydown before the rest of the app sees it — DialogPanel's
    // own Escape included: Escape cancels the recording (the dialog stays open), a bare modifier
    // keeps waiting, anything else becomes the new binding.
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
            const result = keybindings.rebind(editingId, shortcut)
            if (result.ok) {
                setNotice(result.displaced ? `This shortcut was taken from “${result.displaced.label}”, which is now unbound.` : null)
            } else {
                setNotice(`That shortcut is reserved for “${result.reservedBy.label}”.`)
            }
            setEditingId(null)
        }
        window.addEventListener('keydown', record, { capture: true })
        return () => window.removeEventListener('keydown', record, { capture: true })
    }, [editingId, keybindings])

    return (
        <DialogPanel
            title="Keyboard shortcuts"
            subtitle="Click a shortcut to change it. Keys follow your keyboard layout."
            onClose={onClose}
            width={672}
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
                    <PrimaryButton onClick={onClose}>Done</PrimaryButton>
                </>
            }>
            {/* Two columns from md, the groups flowing down them in order (never split), so every key
                sits close to its label and the whole list fits without scrolling. */}
            <div className="min-h-0 pb-2 md:columns-2 md:gap-x-10">
                {EDITOR_COMMAND_GROUPS.map((group) => (
                    <section key={group} className="flex flex-col break-inside-avoid mb-5">
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
    )
}

/** One shortcut row: at least 36px, its 14px label on the left and the keys on the right. */
const ROW = 'flex items-center justify-between gap-4 min-h-9 px-2.5 rounded-md hover:bg-surface-container transition-colors duration-150'
const ROW_LABEL = 'font-body font-normal text-[14px] leading-tight text-on-surface'

interface ShortcutRowProps {
    command: EditorCommand
    keybindings: Keybindings<EditorCommand>
    layout: ReadonlyMap<string, string> | null
    editing: boolean
    onEditToggle: () => void
}

function ShortcutRow({ command, keybindings, layout, editing, onEditToggle }: ShortcutRowProps) {
    const shortcut = keybindings.shortcutFor(command.id)
    // Fixed commands (⌘C/⌘X/⌘V/⌘A) follow the OS convention: listed, but with no
    // rebind / unbind / reset affordances — the keys render as a plain fact. No layout
    // map here: the convention is character-based (⌘A is the key that *types* A, whatever
    // its physical position), so the label is the character itself.
    if (command.fixed) {
        // A key the command reaches by name (the Menu key, Escape for a take) is a keycap of its own.
        const namedKey = command.alternateKey ?? command.preemptKey
        return (
            <div className={ROW}>
                <span className={ROW_LABEL}>{command.label}</span>
                <span className="inline-flex items-center gap-1.5">
                    {shortcut && <ShortcutKeys shortcut={shortcut} layout={null} isMac={keybindings.isMac} />}
                    {namedKey && (
                        <>
                            {shortcut && <span className="font-body font-normal text-[11px] leading-none text-on-surface-variant">or</span>}
                            <Keycap size="md">{namedKey.label}</Keycap>
                        </>
                    )}
                </span>
            </div>
        )
    }
    return (
        <div className={`group ${ROW}`}>
            <span className={ROW_LABEL}>{command.label}</span>
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
                        <span className="inline-flex items-center font-body font-normal text-[12px] leading-none bg-primary-soft text-on-primary-soft rounded-sm px-2 py-1.5 animate-solkey-pulse">
                            Press the new keys…
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
                    <Keycap size="md">{part}</Keycap>
                </Fragment>
            ))}
        </span>
    )
}
