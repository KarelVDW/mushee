'use client'

import { useId, useSyncExternalStore } from 'react'

import { ChipToggle, HeaderMenu, Icon, type IconName, ToolGroup, type TooltipShortcut, TransportBtn } from '@/components/ui'
import { shortcutText } from '@/components/ui/Tooltip'

import { SHOW_SHORTCUTS_KEY } from './commands'
import type { ScoreManipulator } from './ScoreManipulator'
import { usePhoneDockButtonSize } from './TransportControls'

/**
 * Undo / redo. History travel is a document-level (meta) operation, not a selection edit, so
 * on desktop the pair sits in the header with the other score-level chrome, each naming its
 * ⌘Z / ⇧⌘Z in a tooltip. Phones have no ⌘Z and no header room (`compact`): Undo leads the
 * dock's tool row as a round button the nudges' size, and Redo leads the More sheet's "Whole score" rows.
 * A narrow desktop header folds the pair and the shortcuts list into one chip ({@link HistoryMenu}).
 */
export function HistoryTools({ manipulator, compact = false }: { manipulator: ScoreManipulator; compact?: boolean }) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const keybindings = manipulator.keybindings

    if (compact) return <PhoneUndo manipulator={manipulator} />
    // One white well for the pair, so a disabled Undo still shows its place (its glyph fades, the well stays).
    return (
        <ToolGroup ariaLabel="History" size="header">
            <ChipToggle
                plain
                onClick={() => manipulator.undo()}
                disabled={!manipulator.canUndo}
                ariaLabel="Undo"
                shortcut={keybindings.shortcutFor('undo')}
                tooltipSide="bottom">
                <Icon name="undo" size={16} />
            </ChipToggle>
            <ChipToggle
                plain
                onClick={() => manipulator.redo()}
                disabled={!manipulator.canRedo}
                ariaLabel="Redo"
                shortcut={keybindings.shortcutFor('redo')}
                tooltipSide="bottom">
                <Icon name="redo" size={16} />
            </ChipToggle>
        </ToolGroup>
    )
}

/** The phone tool row's Undo: a round button the nudges' size (40px, 44px from 400px wide), 18px glyph. */
function PhoneUndo({ manipulator }: { manipulator: ScoreManipulator }) {
    const size = usePhoneDockButtonSize()
    return (
        <TransportBtn
            size={size}
            onClick={() => manipulator.undo()}
            disabled={!manipulator.canUndo}
            ariaLabel="Undo"
            shortcut={manipulator.keybindings.shortcutFor('undo')}>
            <Icon name="undo" size={18} />
        </TransportBtn>
    )
}

interface HistoryMenuProps {
    manipulator: ScoreManipulator
    onOpenShortcuts: () => void
}

/**
 * The narrow desktop header's one chip for Undo, Redo and the keyboard shortcuts list (under
 * 1024px three chips don't fit beside the transport). Undo and Redo keep the panel open, so a
 * run of undos is a run of clicks; the shortcuts row closes it and opens the list.
 */
export function HistoryMenu({ manipulator, onOpenShortcuts }: HistoryMenuProps) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const keybindings = manipulator.keybindings
    useSyncExternalStore(keybindings.subscribe, keybindings.getSnapshot, keybindings.getSnapshot)

    return (
        <HeaderMenu icon="more-horizontal" ariaLabel="Undo, redo and shortcuts" title="Undo, redo and shortcuts" className="w-72 gap-1">
            {({ close }) => (
                <div className="flex flex-col gap-0.5 pt-1.5 -mx-1.5">
                    <MenuRow
                        icon="undo"
                        label="Undo"
                        disabledHint={manipulator.canUndo ? undefined : 'Nothing to undo yet.'}
                        shortcut={keybindings.shortcutFor('undo')}
                        onClick={() => manipulator.undo()}
                    />
                    <MenuRow
                        icon="redo"
                        label="Redo"
                        disabledHint={manipulator.canRedo ? undefined : 'Nothing to redo yet.'}
                        shortcut={keybindings.shortcutFor('redo')}
                        onClick={() => manipulator.redo()}
                    />
                    <MenuRow
                        icon="keyboard"
                        label="Keyboard shortcuts"
                        shortcut={[SHOW_SHORTCUTS_KEY.label]}
                        onClick={() => {
                            close()
                            onOpenShortcuts()
                        }}
                    />
                </div>
            )}
        </HeaderMenu>
    )
}

interface MenuRowProps {
    icon: IconName
    label: string
    /** Why the row can't act right now; set, the row is off (still focusable) and says so. */
    disabledHint?: string
    shortcut?: TooltipShortcut
    onClick: () => void
}

/** One 44px row of the history menu: icon, name, the reason when it's off, and the live key. */
function MenuRow({ icon, label, disabledHint, shortcut, onClick }: MenuRowProps) {
    const hintId = useId()
    const keys = shortcutText(shortcut)
    const off = disabledHint !== undefined
    return (
        <button
            type="button"
            aria-label={label}
            aria-disabled={off || undefined}
            aria-describedby={off ? hintId : undefined}
            onClick={off ? undefined : onClick}
            className={[
                'w-full min-h-11 flex items-center gap-3 px-2.5 py-1.5 rounded-md border-0 bg-transparent text-left',
                'transition-colors duration-150 ease-solkey focus-ring',
                off ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-surface-container-high',
            ].join(' ')}>
            <Icon name={icon} size={16} className="shrink-0 text-on-surface" />
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="font-label font-semibold text-[14px] leading-tight text-on-surface">{label}</span>
                {off && (
                    <span id={hintId} className="font-body text-[12px] leading-tight text-on-surface-variant">
                        {disabledHint}
                    </span>
                )}
            </span>
            {keys && (
                <kbd className="shrink-0 font-label font-semibold text-[11px] leading-none text-on-surface bg-surface-container rounded-sm px-1.5 py-1">
                    {keys}
                </kbd>
            )}
        </button>
    )
}
