'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

import { Alert, Card, Chip, Eyebrow, PrimaryButton, SecondaryButton, Spinner, TertiaryButton } from '@/components/ui'
import { melodyDurationSec, melodyNoteCount } from '@/lib/melody'
import { useCorpus, useDeleteCorpus, useStartRun } from '@/lib/queries'

export default function CorpusDetailPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const detail = useCorpus(id)
    const deleteCorpus = useDeleteCorpus()
    const startRun = useStartRun()

    if (detail.isPending)
        return (
            <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                <Spinner /> Loading corpus…
            </div>
        )
    if (detail.isError) return <Alert onRetry={() => detail.refetch()}>Couldn&apos;t load corpus: {String(detail.error)}</Alert>

    const { corpus, clips, metricsByClip } = detail.data
    const firstPending = clips.find((clip) => clip.status === 'pending')

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-2">
                    <h1 className="font-headline font-bold text-[1.6rem] leading-tight text-on-surface m-0">{corpus.label}</h1>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Chip>{corpus.kind}</Chip>
                        {corpus.instrumentId && <Chip>{corpus.instrumentId}</Chip>}
                        <Chip active={corpus.tier === 'benchmark'}>{corpus.tier}</Chip>
                        <Chip>{corpus.bpm} bpm</Chip>
                        <Chip>{corpus.beatsPerMeasure}/4</Chip>
                        <span className="font-mono text-[12px] text-on-surface-variant">
                            fixtures/eval-real/{corpus.tier}/{corpus.id}
                        </span>
                    </div>
                    {corpus.notes && <p className="font-body text-[13px] text-on-surface-variant m-0 max-w-xl">{corpus.notes}</p>}
                </div>
                <div className="flex items-center gap-3">
                    <TertiaryButton
                        danger
                        onClick={() => {
                            if (!window.confirm(`Delete "${corpus.label}" and its recordings in the fixtures tree?`)) return
                            deleteCorpus.mutate(corpus.id, { onSuccess: () => router.push('/') })
                        }}>
                        Delete
                    </TertiaryButton>
                    <SecondaryButton onClick={() => startRun.mutate(corpus.id)} disabled={startRun.isPending || corpus.recordedCount === 0}>
                        {startRun.isPending ? 'Scoring…' : 'Score with harness'}
                    </SecondaryButton>
                    <PrimaryButton
                        emphasis="pop"
                        icon="mic"
                        disabled={!firstPending && corpus.clipCount === 0}
                        onClick={() => router.push(`/corpora/${corpus.id}/record${firstPending ? `?clip=${firstPending.id}` : ''}`)}>
                        {firstPending ? 'Record clips' : 'Re-record clips'}
                    </PrimaryButton>
                </div>
            </div>

            {startRun.isError && <Alert>{String(startRun.error)}</Alert>}
            {startRun.isSuccess && (
                <Card>
                    <Eyebrow>Harness result</Eyebrow>
                    <p className="font-mono text-[14px] text-on-surface mt-2 mb-0">
                        note F1 {startRun.data.run.summary.overallF1.toFixed(3)} — report {startRun.data.reportFile} (see Reports)
                    </p>
                </Card>
            )}

            <Card className="p-0 overflow-hidden">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="text-left">
                            {['Clip', 'Key', 'Notes', 'Length', 'Status', 'Latest F1', ''].map((h, i) => (
                                <th key={i} className="px-5 py-3 font-label text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {clips.map((clip) => {
                            const f1 = metricsByClip[clip.id]?.f1
                            return (
                                <tr key={clip.id} className="border-t border-outline-variant/40 hover:bg-surface-container-low">
                                    <td className="px-5 py-3">
                                        <Link
                                            href={`/corpora/${corpus.id}/clips/${clip.id}`}
                                            className="font-body font-semibold text-[14px] text-on-surface no-underline hover:text-primary">
                                            {clip.name}
                                        </Link>
                                    </td>
                                    <td className="px-5 py-3 font-body text-[13px] text-on-surface-variant">{clip.melody.keyLabel}</td>
                                    <td className="px-5 py-3 font-mono text-[13px] text-on-surface">{melodyNoteCount(clip.melody)}</td>
                                    <td className="px-5 py-3 font-mono text-[13px] text-on-surface">{melodyDurationSec(clip.melody).toFixed(0)}s</td>
                                    <td className="px-5 py-3">
                                        <Chip active={clip.status === 'recorded'}>{clip.status}</Chip>
                                    </td>
                                    <td className="px-5 py-3 font-mono text-[13px] text-on-surface">
                                        {typeof f1 === 'number' ? f1.toFixed(2) : '—'}
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <Link
                                            href={`/corpora/${corpus.id}/record?clip=${clip.id}`}
                                            className="font-label text-[12px] font-semibold text-primary no-underline hover:underline">
                                            record
                                        </Link>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </Card>
        </div>
    )
}
