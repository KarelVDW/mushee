'use client'

import { useSyncExternalStore } from 'react'

import { ChipToggle, Icon, TransportBtn } from '@/components/ui'

import type { ScoreManipulator } from './ScoreManipulator'

/**
 * Undo / redo. History travel is a document-level (meta) operation, not a selection edit, so
 * on desktop the pair sits in the header with the other score-level chrome, each naming its
 * ⌘Z / ⇧⌘Z in a tooltip. Phones have no ⌘Z and no header room (`compact`): Undo leads the
 * dock's tool row as a 40px round button, and Redo lives in the More sheet.
 */
export function HistoryTools({ manipulator, compact = false }: { manipulator: ScoreManipulator; compact?: boolean }) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const keybindings = manipulator.keybindings

    if (compact) {
        return (
            <TransportBtn
                size={40}
                onClick={() => manipulator.undo()}
                disabled={!manipulator.canUndo}
                ariaLabel="Undo"
                shortcut={keybindings.shortcutFor('undo')}>
                <Icon name="undo" size={16} />
            </TransportBtn>
        )
    }
    return (
        <div role="group" aria-label="History" className="flex items-center gap-1">
            <ChipToggle
                onClick={() => manipulator.undo()}
                disabled={!manipulator.canUndo}
                ariaLabel="Undo"
                shortcut={keybindings.shortcutFor('undo')}
                tooltipSide="bottom">
                <Icon name="undo" size={16} />
            </ChipToggle>
            <ChipToggle
                onClick={() => manipulator.redo()}
                disabled={!manipulator.canRedo}
                ariaLabel="Redo"
                shortcut={keybindings.shortcutFor('redo')}
                tooltipSide="bottom">
                <Icon name="redo" size={16} />
            </ChipToggle>
        </div>
    )
}
