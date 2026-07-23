'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

import { AdminShell, PageHeading } from '@/components/AdminShell'
import { EngravedScore } from '@/components/EngravedScore'
import { Alert, Eyebrow, Pill } from '@/components/ui'
import { type AdminScoreRecording, recordingAudioUrl } from '@/lib/api'
import { formatDateTime, formatSeconds } from '@/lib/format'
import { useScore } from '@/lib/queries'

export default function ScoreDetailPage() {
    const { id } = useParams<{ id: string }>()
    const score = useScore(id)

    return (
        <AdminShell>
            {score.data?.owner && (
                <div className="mb-6">
                    <Link
                        href={`/users/${score.data.owner.id}`}
                        className="font-body font-medium text-[13px] no-underline text-on-surface-variant hover:text-primary transition-colors duration-150 ease-solkey">
                        ← {score.data.owner.name || score.data.owner.email}
                    </Link>
                </div>
            )}

            {score.isError && <Alert onRetry={() => void score.refetch()}>Couldn&apos;t load this score.</Alert>}

            {score.data && (
                <>
                    <PageHeading eyebrow="Score · read-only" title={score.data.title} />

                    <div className="grid sm:grid-cols-3 gap-4 mb-4">
                        <MetaTile label="Owner" value={score.data.owner?.email ?? score.data.userId} />
                        <MetaTile label="Created" value={formatDateTime(score.data.createdAt)} />
                        <MetaTile label="Last edited" value={formatDateTime(score.data.updatedAt)} />
                    </div>

                    {score.data.documentError && (
                        <div className="mb-4">
                            <Alert>Couldn&apos;t read the score document: {score.data.documentError}</Alert>
                        </div>
                    )}

                    {score.data.document && (
                        <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 mb-4">
                            <Eyebrow className="block mb-3">Score</Eyebrow>
                            <EngravedScore document={score.data.document} />
                        </section>
                    )}

                    <Recordings recordings={score.data.recordings} />

                    {score.data.document && (
                        <details className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4">
                            <summary className="cursor-pointer font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                                Raw document
                            </summary>
                            <pre className="mt-3 mb-0 overflow-x-auto font-mono text-[11px] leading-relaxed text-on-surface-variant max-h-96">
                                {JSON.stringify(score.data.document, null, 2)}
                            </pre>
                        </details>
                    )}
                </>
            )}
        </AdminShell>
    )
}

/** The takes recorded into this score, each with an inline player. The audio
 *  src points at the console's proxy, which redirects to a signed bucket URL
 *  (GCS) or streams the file (local storage). */
function Recordings({ recordings }: { recordings: AdminScoreRecording[] }) {
    return (
        <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 mb-4">
            <Eyebrow className="block mb-3">Recordings ({recordings.length})</Eyebrow>
            {recordings.length === 0 && (
                <p className="font-body text-[13px] leading-normal text-on-surface-variant m-0">
                    No takes have been recorded into this score.
                </p>
            )}
            <div className="flex flex-col gap-1">
                {recordings.map((recording) => (
                    <div
                        key={recording.id}
                        className="grid md:grid-cols-[12rem_6rem_auto_1fr] grid-cols-1 items-center gap-x-4 gap-y-2 rounded-md px-3 py-2.5 -mx-3 hover:bg-surface-container-high transition-colors duration-150 ease-solkey">
                        <span className="font-body text-[13px] leading-none text-on-surface">
                            {formatDateTime(recording.createdAt)}
                        </span>
                        <span className="font-mono text-[12px] leading-none text-on-surface-variant">
                            {formatSeconds(recording.creditsSpent)}
                        </span>
                        <span>
                            {!recording.endedAt && <Pill tone="magenta">Still open</Pill>}
                            {recording.endedAt && !recording.hasAudio && <Pill>No audio archived</Pill>}
                        </span>
                        {recording.hasAudio ? (
                            <audio
                                controls
                                preload="none"
                                src={recordingAudioUrl(recording.id)}
                                className="w-full max-w-md h-9 justify-self-end"
                                aria-label={`Recording from ${formatDateTime(recording.createdAt)}`}
                            />
                        ) : (
                            <span />
                        )}
                    </div>
                ))}
            </div>
        </section>
    )
}

function MetaTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 flex flex-col gap-2">
            <Eyebrow>{label}</Eyebrow>
            <span className="font-body text-[13px] leading-snug text-on-surface break-all">{value}</span>
        </div>
    )
}
