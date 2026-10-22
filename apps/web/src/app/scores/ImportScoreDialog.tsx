'use client'

import type { Score } from '@mushee/notation/model'

import { Eyebrow, Icon } from '@/components/ui'
import type { ImportedScoreFile } from '@/lib/ScoreFileImporter'

import { NewScoreDialog } from './NewScoreDialog'

interface ImportScoreDialogProps {
    imported: ImportedScoreFile
    onCancel: () => void
    onCreate: (title: string, score: Score) => void
}

/**
 * The last step of importing a file: the score has been read, and the user
 * confirms its title and lead instrument — and sees what the import had to
 * simplify — before the score is created.
 */
export function ImportScoreDialog({ imported, onCancel, onCreate }: ImportScoreDialogProps) {
    const { score, warnings } = imported
    const first = score.firstMeasure
    const bars = score.measures.length
    const summary = [`${bars} ${bars === 1 ? 'bar' : 'bars'}`, first && `${first.timeSignature.beatAmount}/${first.timeSignature.beatType}`]
        .filter(Boolean)
        .join(' · ')

    return (
        <NewScoreDialog
            title="Import score"
            subtitle={`${summary} read from the file. Check the title and lead instrument, then create the score.`}
            initialTitle={imported.title}
            initialInstrument={score.instrument}
            notice={
                warnings.length > 0 && (
                    <div
                        role="status"
                        aria-label="Adjusted on import"
                        className="bg-surface-container-low rounded-md px-3.5 py-3 flex gap-3">
                        <span className="text-on-surface-variant shrink-0 pt-0.5">
                            <Icon name="info" size={16} />
                        </span>
                        <div className="flex flex-col gap-1.5 min-w-0">
                            <Eyebrow>Adjusted on import</Eyebrow>
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
