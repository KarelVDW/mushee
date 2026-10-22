'use client'

import { useSyncExternalStore } from 'react'

import type { PitchScope } from '@/components/editor/pitchScope'
import { TransposePopover } from '@/components/editor/TransposePopover'
import { ChipToggle, Icon } from '@/components/ui'

import { PopoverChip } from './NoteToolDock'
import type { ScoreManipulator } from './ScoreManipulator'

/** Where the header's transpose popover opens: below its chip, right-aligned to it. */
const HEADER_POPOVER_POSITION = 'right-0 top-[calc(100%+0.5rem)]'

interface PitchToolsProps {
    manipulator: ScoreManipulator
    /**
     * Inside a ToolGroup well — the phone dock's score-settings well: plain chips and smaller
     * icons, no group of its own, and the transpose popover opens from the dock. Otherwise the
     * tools stand alone in the desktop header.
     */
    plain?: boolean
    /** Phone layout: the transpose popover opens as the dock-wide sheet. */
    compact?: boolean
    /**
     * Transpose popover state, kept by the page so the transpose shortcut opens whichever
     * instance is rendered (header or dock).
     */
    transposeOpen: boolean
    onTransposeOpenChange: (open: boolean) => void
    /** Forwarded to the popover's onScopeChange: the canvas pulse over its target. Keep referentially stable. */
    onTransposeAim: (scope: PitchScope | null) => void
}

/**
 * The pitch operations — minimize accidentals and transpose. They act on the whole score by
 * default (a multi-note selection narrows them), so they sit with the document-level chrome
 * in the desktop header; phones host them in the dock's score-settings well instead.
 */
export function PitchTools({
    manipulator,
    plain = false,
    compact = false,
    transposeOpen,
    onTransposeOpenChange,
    onTransposeAim,
}: PitchToolsProps) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const score = manipulator.score
    if (!score) return null
    const iconSize = plain ? 14 : 16

    const tools = (
        <>
            <ChipToggle
                plain={plain}
                onClick={() => manipulator.minimizeAccidentals()}
                disabled={!manipulator.selectedNote}
                ariaLabel="Minimize accidentals">
                <Icon name="natural" size={iconSize} />
            </ChipToggle>
            <PopoverChip
                plain={plain}
                compact={compact}
                // In the dock it follows the dock's rule — no selected note, no tool; the header's
                // stays available, since transposing the whole score needs no selection.
                disabled={plain && !manipulator.selectedNote}
                ariaLabel="Transpose"
                chip={<Icon name="transpose" size={iconSize} />}
                className={plain ? undefined : HEADER_POPOVER_POSITION}
                open={transposeOpen}
                onOpenChange={onTransposeOpenChange}>
                {({ anchorRef, className, close }) => (
                    <TransposePopover
                        score={score}
                        selectedNotes={manipulator.selectedNotes}
                        selectionNarrowsPitchOps={manipulator.selectionNarrowsPitchOps}
                        anchorRef={anchorRef}
                        className={className}
                        onApply={(interval, scope) => {
                            manipulator.transpose(interval, scope)
                            close()
                        }}
                        onDismiss={close}
                        onScopeChange={onTransposeAim}
                    />
                )}
            </PopoverChip>
        </>
    )

    if (plain) return tools
    return (
        <div role="group" aria-label="Pitch" className="flex items-center gap-1">
            {tools}
        </div>
    )
}
