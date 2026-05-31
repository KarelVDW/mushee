import { MEASURE_BUTTON_SPACING, SCORE_WIDTH } from '@/components/notation/constants'

/**
 * Horizontal budget available to a row's measures. The last row reserves
 * MEASURE_BUTTON_SPACING for the add/remove-measure buttons rendered after the
 * final barline, so Row.canFit and RowLayout must agree on this number to keep
 * row composition consistent with layout. See RowLayout and Row.canFit.
 */
export function availableRowWidth({ isLastRow }: { isLastRow: boolean }): number {
    return SCORE_WIDTH - (isLastRow ? MEASURE_BUTTON_SPACING : 0)
}
