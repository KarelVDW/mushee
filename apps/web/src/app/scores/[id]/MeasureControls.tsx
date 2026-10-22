'use client'

import type { MeasureButtonsRect } from '@mushee/notation/components'

import { Icon, Tooltip } from '@/components/ui'

interface MeasureControlsProps {
    /** Where the score's final barline is, from the ScoreView (container pixels). */
    rect: MeasureButtonsRect
    /** False with one bar left: a score always keeps one. */
    canRemove: boolean
    /**
     * Held back while the score has no pitched note: the empty state's "Start recording" is the
     * first screen's one next step. Laid out but invisible — out of the tab order and the
     * accessibility tree — so the empty state below keeps its place, and the buttons fade in
     * where they stay as the first note lands.
     */
    waiting: boolean
    onAdd: () => void
    onRemove: () => void
}

/**
 * Add bar / Remove last bar: real, named, tab-reachable buttons under the last row, their
 * right edge on the final barline. HTML after the ScoreView — never in the score's <svg> —
 * in neutral tones, and kept out of exports. 32px on desktop, 40px on touch, and 16px apart
 * so the remove is never a slip of the finger from the add. Removing a bar that held notes
 * offers an Undo (ScoreManipulator.removeMeasure).
 */
export function MeasureControls({ rect, canRemove, waiting, onAdd, onRemove }: MeasureControlsProps) {
    return (
        <div
            data-export-exclude
            className={[
                'mt-3 flex min-w-max items-center justify-end gap-4',
                'transition-[opacity,visibility] duration-200 ease-solkey motion-reduce:transition-none',
                waiting ? 'invisible opacity-0' : 'visible opacity-100',
            ].join(' ')}
            style={{ width: Math.max(0, rect.barlineX) }}>
            <Tooltip hint="Add an empty bar at the end">
                <button
                    type="button"
                    onClick={onAdd}
                    className={[
                        'inline-flex items-center gap-1.5 h-8 pointer-coarse:h-10 px-3 rounded-full border-0 cursor-pointer',
                        'bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                        'font-label font-semibold text-[13px] leading-none whitespace-nowrap',
                        'transition-colors duration-150 ease-solkey focus-ring',
                    ].join(' ')}>
                    <Icon name="plus" size={12} />
                    Add bar
                </button>
            </Tooltip>
            <Tooltip label="Remove the last bar" reason={canRemove ? undefined : 'A score keeps at least one bar.'}>
                <button
                    type="button"
                    aria-label="Remove last bar"
                    onClick={onRemove}
                    disabled={!canRemove}
                    className={[
                        'inline-flex items-center justify-center size-8 pointer-coarse:size-10 rounded-full border-0 cursor-pointer',
                        'bg-transparent text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
                        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                        'transition-colors duration-150 ease-solkey focus-ring',
                    ].join(' ')}>
                    <Icon name="minus" size={14} />
                </button>
            </Tooltip>
        </div>
    )
}
