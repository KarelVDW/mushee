'use client'

import { useSyncExternalStore } from 'react'

import { ChipToggle, Icon, ToolGroup } from '@/components/ui'

import type { ScoreManipulator } from './ScoreManipulator'

/**
 * Undo / redo. History travel is a document-level (meta) operation, not a selection edit, so
 * on desktop the pair sits in the header with the other score-level chrome. Phones have no ⌘Z
 * and no header room: there it is the dock's trailing well (`plain`).
 */
export function HistoryTools({ manipulator, plain = false }: { manipulator: ScoreManipulator; plain?: boolean }) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const iconSize = plain ? 14 : 16

    const buttons = (
        <>
            <ChipToggle plain={plain} onClick={() => manipulator.undo()} disabled={!manipulator.canUndo} ariaLabel="Undo">
                <Icon name="undo" size={iconSize} />
            </ChipToggle>
            <ChipToggle plain={plain} onClick={() => manipulator.redo()} disabled={!manipulator.canRedo} ariaLabel="Redo">
                <Icon name="redo" size={iconSize} />
            </ChipToggle>
        </>
    )

    if (plain) return <ToolGroup ariaLabel="History">{buttons}</ToolGroup>
    return (
        <div role="group" aria-label="History" className="flex items-center gap-1">
            {buttons}
        </div>
    )
}
