import { MEASURE_BUTTON_SPACING } from '../../components/constants'

/**
 * Horizontal budget available to a row's measures within a score laid out
 * `scoreWidth` units wide. The last row reserves MEASURE_BUTTON_SPACING for the
 * add/remove-measure buttons rendered after the final barline, so packing and
 * RowLayout must agree on this number to keep row composition consistent with
 * layout. See ScoreLayout.packGreedy and RowLayout.
 */
export function availableRowWidth({ isLastRow, scoreWidth }: { isLastRow: boolean; scoreWidth: number }): number {
    return scoreWidth - (isLastRow ? MEASURE_BUTTON_SPACING : 0)
}
