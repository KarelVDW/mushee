'use client'

import { useSyncExternalStore } from 'react'

import type { PitchScope } from '@/components/editor/pitchScope'
import { TransposePopover } from '@/components/editor/TransposePopover'
import { Icon } from '@/components/ui'

import { STOP_RECORDING_FIRST } from './NoteToolParts'
import { PopoverChip } from './PopoverChip'
import type { ScoreManipulator } from './ScoreManipulator'

/** Where the header's transpose popover opens: below its chip, right-aligned to it. */
const HEADER_POPOVER_POSITION = 'right-0 top-[calc(100%+0.5rem)]'

interface PitchToolsProps {
    manipulator: ScoreManipulator
    /**
     * Transpose popover state, kept by the page so the transpose shortcut opens it from
     * anywhere (on phones it opens inside the dock's More sheet instead).
     */
    transposeOpen: boolean
    onTransposeOpenChange: (open: boolean) => void
    /** Forwarded to the popover's onScopeChange: the canvas pulse over its target. Keep referentially stable. */
    onTransposeAim: (scope: PitchScope | null) => void
    /** A narrow header: the chip shows its icon alone, and its tooltip names it ("Transpose — move the whole song…"). */
    iconOnly?: boolean
}

/**
 * The header's pitch tool: a labelled Transpose chip. It acts on the whole score by default
 * (a multi-note selection narrows it), so it sits with the document-level chrome on desktop.
 * Simplify sharps and flats lives in the dock's More (desktop popover, phone sheet), and
 * phones reach Transpose there too. While a recording writes into the score the chip stays in
 * place but off, saying why — like the dock's clef / key / time / tempo chips.
 */
export function PitchTools({ manipulator, transposeOpen, onTransposeOpenChange, onTransposeAim, iconOnly = false }: PitchToolsProps) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const keybindings = manipulator.keybindings
    useSyncExternalStore(keybindings.subscribe, keybindings.getSnapshot, keybindings.getSnapshot)
    const score = manipulator.score
    if (!score) return null

    return (
        <PopoverChip
            ariaLabel="Transpose"
            disabled={manipulator.historyLocked}
            disabledReason={STOP_RECORDING_FIRST}
            // Labelled, the chip names itself and the tooltip says what it does; icon-only, the tooltip names it too.
            tooltip={iconOnly ? 'Transpose' : 'Move the whole song higher or lower'}
            hint={iconOnly ? 'move the whole song higher or lower' : undefined}
            shortcut={keybindings.shortcutFor('transpose')}
            tooltipSide="bottom"
            chip={
                <span className="inline-flex items-center gap-1.5">
                    <Icon name="transpose" size={14} />
                    {!iconOnly && 'Transpose'}
                </span>
            }
            className={HEADER_POPOVER_POSITION}
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
    )
}
