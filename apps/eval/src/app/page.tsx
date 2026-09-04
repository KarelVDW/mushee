'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Alert, Card, Chip, Eyebrow, PrimaryButton, SecondaryButton, Spinner } from '@/components/ui'
import type { RunDto } from '@/lib/api'
import { useCorpora, useRuns, useStartRun } from '@/lib/queries'

export default function CorporaPage() {
    const router = useRouter()
    const corpora = useCorpora()
    const runs = useRuns()
    const startRun = useStartRun()

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4">
                <h1 className="font-headline font-bold text-[1.6rem] leading-tight text-on-surface m-0">Corpora</h1>
                <div className="flex items-center gap-3">
                    <SecondaryButton onClick={() => startRun.mutate(undefined)} disabled={startRun.isPending}>
                        {startRun.isPending ? 'Scoring full real corpus…' : 'Score full real corpus'}
                    </SecondaryButton>
                    <PrimaryButton emphasis="pop" icon="plus" onClick={() => router.push('/corpora/new')}>
                        New corpus
                    </PrimaryButton>
                </div>
            </div>

            {startRun.isError && <Alert>{String(startRun.error)}</Alert>}

            {corpora.isError && <Alert onRetry={() => corpora.refetch()}>Couldn&apos;t load corpora: {String(corpora.error)}</Alert>}
            {corpora.isPending && (
                <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                    <Spinner /> Loading corpora…
                </div>
            )}

            {corpora.data && corpora.data.length === 0 && (
                <Card>
                    <p className="font-body text-[14px] text-on-surface-variant m-0">
                        No UI-created corpora yet. The script-fetched corpora still live in the fixtures tree — this list holds the ones you
                        create and record here.
                    </p>
                </Card>
            )}

            {corpora.data && corpora.data.length > 0 && (
                <Card className="p-0 overflow-hidden">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="text-left">
                                {['Corpus', 'Kind', 'Tier', 'BPM', 'Clips', 'Created'].map((h) => (
                                    <th
                                        key={h}
                                        className="px-5 py-3 font-label text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {corpora.data.map((corpus) => (
                                <tr
                                    key={corpus.id}
                                    className="border-t border-outline-variant/40 hover:bg-surface-container-low cursor-pointer"
                                    onClick={() => router.push(`/corpora/${corpus.id}`)}>
                                    <td className="px-5 py-3">
                                        <Link
                                            href={`/corpora/${corpus.id}`}
                                            className="font-body font-semibold text-[14px] text-on-surface no-underline hover:text-primary"
                                            onClick={(e) => e.stopPropagation()}>
                                            {corpus.label}
                                        </Link>
                                        <span className="block font-mono text-[11px] text-on-surface-variant">{corpus.id}</span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <Chip>{corpus.kind}</Chip>
                                    </td>
                                    <td className="px-5 py-3">
                                        <Chip active={corpus.tier === 'benchmark'}>{corpus.tier}</Chip>
                                    </td>
                                    <td className="px-5 py-3 font-mono text-[13px] text-on-surface">{corpus.bpm}</td>
                                    <td className="px-5 py-3 font-mono text-[13px] text-on-surface">
                                        {corpus.recordedCount}/{corpus.clipCount}
                                        <span className="text-on-surface-variant"> recorded</span>
                                    </td>
                                    <td className="px-5 py-3 font-body text-[13px] text-on-surface-variant">
                                        {new Date(corpus.createdAt).toLocaleDateString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}

            <LatestRun runs={runs.data} />
        </div>
    )
}

/** Standing overview: the most recent harness run, per-dataset note F1. */
function LatestRun({ runs }: { runs?: RunDto[] }) {
    const latest = runs?.[0]
    if (!latest) return null
    const scenarios = latest.summary.perScenario.filter((s) => s.clips > 0)
    const max = Math.max(0.001, ...scenarios.map((s) => s.f1))
    return (
        <Card>
            <div className="flex items-baseline justify-between gap-3 mb-1">
                <Eyebrow>Latest scored run — note F1 per dataset</Eyebrow>
                <span className="font-mono text-[12px] text-on-surface-variant">
                    {latest.label} · {new Date(latest.createdAt).toLocaleString()} · overall {latest.summary.overallF1.toFixed(3)}
                </span>
            </div>
            <p className="font-body text-[12px] text-on-surface-variant mt-0 mb-4">
                Single series (cyan). Unpooled datasets are marked — they never move the headline.
            </p>
            <div className="flex flex-col gap-2.5">
                {scenarios.map((s) => (
                    <div key={s.scenario} className="grid grid-cols-[11rem_1fr_auto] items-center gap-3">
                        <span className="font-body text-[13px] leading-none text-on-surface truncate">
                            {s.scenario}
                            {!s.pooled && <span className="text-outline"> †</span>}
                        </span>
                        <div className="h-4 flex items-center">
                            <div
                                className="h-4 rounded-r-sm bg-chart-cyan min-w-0.5"
                                style={{ width: `${Math.max(1, (s.f1 / max) * 100)}%` }}
                            />
                        </div>
                        <span className="font-mono text-[13px] leading-none text-on-surface-variant text-right">{s.f1.toFixed(2)}</span>
                    </div>
                ))}
            </div>
        </Card>
    )
}
