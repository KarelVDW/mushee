'use client'

import type { MeasureButtonsRect } from '@mushee/notation/components'

import { Icon, Tooltip } from '@/components/ui'

/** The controls' least distance under the last row's bottom staff line, and under its lowest ink (CSS px). */
const STAFF_CLEARANCE = 24
const INK_CLEARANCE = 12

/**
 * Selects the controls' in-flow placeholder, which sits after the whole score <svg>: the empty
 * state below measures it to lift itself from there up to the row the buttons really sit in.
 */
export const BAR_ROW_PLACEHOLDER = '[data-bar-row-placeholder]'

/** Where the controls' row starts, in the score wrapper's pixels: under the last row (see MeasureControls). */
export function barRowTop(rect: MeasureButtonsRect): number {
    return Math.max(rect.staffBottom + STAFF_CLEARANCE, rect.inkBottom + INK_CLEARANCE)
}

interface MeasureControlsProps {
    /** Where the score's final barline and last row are, from the ScoreView (container pixels). */
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
 *
 * They hug the row they extend: 24px under its bottom staff line, or 12px under its lowest ink
 * when that reaches lower (a ledger-line note, a down-stem, the input cursor under a note). The
 * pair sits absolutely in the score's wrapper, whose origin is the ScoreView's container (the
 * rect's coordinates); an in-flow placeholder of their height keeps their old place, so the
 * empty state below doesn't move.
 */
export function MeasureControls({ rect, canRemove, waiting, onAdd, onRemove }: MeasureControlsProps) {
    const top = barRowTop(rect)
    return (
        <div data-export-exclude data-bar-row-placeholder="" className="mt-3 h-8 pointer-coarse:h-10">
            <div
                className={[
                    // Over the svg's empty room under the last row: only the buttons take the pointer,
                    // so a click or hover beside them still reaches the score.
                    'absolute left-0 flex min-w-max items-center justify-end gap-4 pointer-events-none [&_button]:pointer-events-auto',
                    'transition-[opacity,visibility] duration-200 ease-solkey motion-reduce:transition-none',
                    waiting ? 'invisible opacity-0' : 'visible opacity-100',
                ].join(' ')}
                style={{ top, width: Math.max(0, rect.barlineX) }}>
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
                            // The same tonal fill as Add bar at rest, so the two read as one set.
                            'bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-container-low disabled:hover:text-on-surface-variant',
                            'transition-colors duration-150 ease-solkey focus-ring',
                        ].join(' ')}>
                        <Icon name="minus" size={14} />
                    </button>
                </Tooltip>
            </div>
        </div>
    )
}
