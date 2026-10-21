import type { Score } from '../Score'

/**
 * What a file importer hands back: the score, the title the file carried (if any),
 * and the simplifications it had to make — the importers accept far more than the
 * single-voice model can hold, so anything reduced or left out is reported here
 * for the user to see before the score is created.
 */
export interface ImportedScore {
    score: Score
    title?: string
    warnings: string[]
}
