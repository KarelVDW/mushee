'use client'

import type { Score } from '@mushee/notation/model'

import { Icon } from '@/components/ui'
import type { ImportedScoreFile } from '@/lib/ScoreFileImporter'

import { NewScoreDialog } from './NewScoreDialog'

/** The heading of the import notice, and the name of its status region. */
export const IMPORT_NOTICE_TITLE = 'A few things were simplified'

/** What the import dialog says it read from a file, in plain words. */
export class ImportSummary {
    constructor(readonly score: Score) {}

    /** "2 bars". */
    get bars(): string {
        const bars = this.score.measures.length
        return `${bars} ${bars === 1 ? 'bar' : 'bars'}`
    }

    /** "in 3/4 — 3 beats in a bar —": the meter, with the beats a listener counts in it. */
    get meter(): string | null {
        const meter = this.score.firstMeasure?.timeSignature
        return meter ? `in ${meter.beatAmount}/${meter.beatType} — ${meter.plainNamePerBar} —` : null
    }

    /** "We read 2 bars in 3/4 — 3 beats in a bar — from your file. Check the title, then create the score." */
    get subtitle(): string {
        const read = [this.bars, this.meter].filter(Boolean).join(' ')
        return `We read ${read} from your file. Check the title, then create the score.`
    }
}

interface ImportScoreDialogProps {
    imported: ImportedScoreFile
    /** What a blank title saves as. */
    titlePlaceholder?: string
    onCancel: () => void
    onCreate: (title: string, score: Score) => void
}

/**
 * The last step of importing a file: the score has been read, and the user confirms its
 * title — the instrument the file named sits in one row, its picker behind 'Change' — and
 * sees what the import had to simplify before the score is created.
 */
export function ImportScoreDialog({ imported, titlePlaceholder, onCancel, onCreate }: ImportScoreDialogProps) {
    const { score, warnings } = imported

    return (
        <NewScoreDialog
            title="Import score"
            subtitle={new ImportSummary(score).subtitle}
            initialTitle={imported.title}
            initialInstrument={score.instrument}
            titlePlaceholder={titlePlaceholder}
            picker="collapsed"
            chordHint={false}
            notice={
                warnings.length > 0 && (
                    <div
                        role="status"
                        aria-label={IMPORT_NOTICE_TITLE}
                        className="bg-surface-container-low rounded-md px-3.5 py-3 flex gap-3">
                        <span className="text-on-surface-variant shrink-0 pt-0.5">
                            <Icon name="info" size={16} />
                        </span>
                        <div className="flex flex-col gap-1.5 min-w-0">
                            <span className="font-label font-semibold text-[13px] leading-[1.3] text-on-surface">
                                {IMPORT_NOTICE_TITLE}
                            </span>
                            <ul className="m-0 p-0 list-none flex flex-col gap-1">
                                {warnings.map((warning) => (
                                    <li key={warning} className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                                        {warning}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )
            }
            onCancel={onCancel}
            onCreate={(title, instrument) => {
                // Switching instrument keeps the sounding music: the model rewrites written pitch for the new transposition.
                if (instrument !== score.instrument) score.setInstrument(instrument)
                onCreate(title, score)
            }}
        />
    )
}
