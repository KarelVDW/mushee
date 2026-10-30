import type { Metadata } from 'next'

import { TimelineCharts } from '@/components/charts/TimelineCharts'
import { EmptyNote, PageHeading, Section } from '@/components/Layout'
import { DeltaText, Tag } from '@/components/Marks'
import { Cell, Head, Row, RowLink, Table } from '@/components/Table'
import { MATERIALS } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'
import { TimelineStore } from '@/server/TimelineStore'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Timeline' }

export default function TimelinePage() {
    const timeline = TimelineStore.read()
    const points = timeline.points
    const materials = MATERIALS.filter((m) => points.some((p) => p.perMaterial[m] != null))
    const showErrors = points.some((p) => p.empty != null || p.errors != null)
    const provisional = new Set(points.flatMap((p) => p.provisional))

    return (
        <>
            <PageHeading eyebrow="History" title="Score timeline" />
            <p className="font-body text-[14px] leading-relaxed text-on-surface-variant max-w-3xl -mt-4 mb-8 text-pretty">
                The product&apos;s <code className="font-mono text-[13px] text-on-surface">RecordingPipeline</code> path at historical
                commits, each scored by today&apos;s harness on the <strong className="font-semibold text-on-surface">test split</strong> of
                today&apos;s clips
                {timeline.clipset ? ` (clipset ${timeline.clipset})` : ''}. These are product-path numbers on one fixed clip set: they are
                not comparable to the converter-level numbers in <code className="font-mono text-[13px] text-on-surface">RESULTS.md</code>{' '}
                or to the benchmark runs.
            </p>
            {timeline.sameTruth === false && (
                <div className="mb-6">
                    <EmptyNote title="These commits were scored against different truth">
                        <p className="m-0">
                            Truth changed while the timeline was being scored, so a step between two commits may be the truth moving, not
                            the pipeline. Rescore every commit with <code>pnpm exec tsx scripts/eval/timeline/score.ts</code> in{' '}
                            <code>apps/api</code> (about a second per commit, no pipeline run).
                        </p>
                    </EmptyNote>
                </div>
            )}

            {points.length === 0 ? (
                <EmptyNote title="No historical commits scored yet">
                    <p className="m-0">
                        In <code>apps/api</code>, <code>scripts/eval/timeline/run.ts</code> transcribes the clipset with each sampled
                        commit&apos;s pipeline (resumable), and <code>scripts/eval/timeline/score.ts</code> scores those notes into{' '}
                        <code>apps/eval/data/timeline/</code>: <code>index.json</code> plus one file per commit. This page fills in as
                        commits are scored.
                    </p>
                </EmptyNote>
            ) : (
                <div className="flex flex-col gap-6">
                    <Section
                        title="COnP per commit"
                        aside={`${points.length} commits · ${Fmt.date(points[0].commitDate)} → ${Fmt.date(points[points.length - 1].commitDate)}`}
                        hint={
                            <>
                                Hover or use the arrow keys for a commit&apos;s numbers; click a point to open its per-dataset breakdown.
                                Materials share one y-scale
                                {provisional.size > 0 ? '; * marks a provisional row (context truth only, never gates)' : ''}.
                                {timeline.note && <span className="block mt-1">{timeline.note}</span>}
                            </>
                        }>
                        <TimelineCharts points={points} />
                    </Section>

                    <Section title="Every commit" flush>
                        <Table minWidth="min-w-240">
                            <Head
                                columns={[
                                    'Commit',
                                    'Date',
                                    { label: 'All pooled', align: 'right' },
                                    { label: 'Δ', align: 'right', title: 'Change against the previous commit' },
                                    { label: 'Human only', align: 'right' },
                                    ...materials.map((m) => ({
                                        label: provisional.has(m) ? `${m} *` : m,
                                        align: 'right' as const,
                                        title: provisional.has(m) ? 'Provisional: no pooled dataset, built from context truth' : undefined,
                                    })),
                                    { label: 'Clips', align: 'right' },
                                    ...(showErrors ? [{ label: 'Empty / errors', align: 'right' as const }] : []),
                                ]}
                            />
                            <tbody>
                                {[...points].reverse().map((p, i, rows) => {
                                    const prev = rows[i + 1]
                                    return (
                                        <Row key={p.id}>
                                            <Cell className="min-w-72 max-w-120">
                                                {p.hasDetail ? (
                                                    <RowLink
                                                        href={Route.run(p.id)}
                                                        sub={
                                                            [p.era && `era ${p.era}`, p.partial && 'partial: some clips not run']
                                                                .filter(Boolean)
                                                                .join(' · ') || undefined
                                                        }>
                                                        <span className="font-mono">{p.short}</span>{' '}
                                                        <span className="font-normal">{p.subject}</span>
                                                    </RowLink>
                                                ) : (
                                                    <span className="font-body text-[14px] text-on-surface">
                                                        <span className="font-mono">{p.short}</span> {p.subject}
                                                    </span>
                                                )}
                                            </Cell>
                                            <Cell mono className="whitespace-nowrap text-on-surface-variant">
                                                {Fmt.date(p.commitDate)}
                                            </Cell>
                                            <Cell align="right" mono>
                                                <span className="font-semibold">{Fmt.score(p.overall)}</span>
                                            </Cell>
                                            <Cell align="right">
                                                <DeltaText
                                                    value={
                                                        prev && p.overall != null && prev.overall != null ? p.overall - prev.overall : null
                                                    }
                                                />
                                            </Cell>
                                            <Cell align="right" mono>
                                                {Fmt.score(p.overallHuman)}
                                            </Cell>
                                            {materials.map((m) => (
                                                <Cell key={m} align="right" mono>
                                                    {Fmt.score(p.perMaterial[m] ?? null)}
                                                </Cell>
                                            ))}
                                            <Cell align="right" mono>
                                                {Fmt.count(p.clips)}
                                            </Cell>
                                            {showErrors && (
                                                <Cell align="right" mono>
                                                    {p.empty ?? '—'} / {p.errors ?? '—'}
                                                </Cell>
                                            )}
                                        </Row>
                                    )
                                })}
                            </tbody>
                        </Table>
                    </Section>
                </div>
            )}

            {timeline.progress.some((c) => !c.scored) && (
                <div className="mt-6">
                    <Section
                        title="Sampled commits — build progress"
                        flush
                        aside={`${timeline.progress.filter((c) => c.scored).length} of ${timeline.progress.length} scored`}
                        hint="apps/api/scripts/eval/timeline/commits.json. Transcription counts come from each commit's notes summary; a commit joins the chart once it is scored.">
                        <Table minWidth="min-w-220">
                            <Head
                                columns={[
                                    'Commit',
                                    'Date',
                                    'Era',
                                    { label: 'Transcribed', align: 'right' },
                                    { label: 'Errors', align: 'right' },
                                    { label: 'Empty', align: 'right' },
                                    'Scored',
                                ]}
                            />
                            <tbody>
                                {[...timeline.progress].reverse().map((c) => (
                                    <Row key={c.short}>
                                        <Cell className="max-w-120">
                                            <span className="font-body text-[14px] text-on-surface" title={c.why}>
                                                <span className="font-mono">{c.short}</span> {c.subject}
                                            </span>
                                        </Cell>
                                        <Cell mono className="text-on-surface-variant">
                                            {Fmt.date(c.date)}
                                        </Cell>
                                        <Cell>{c.era}</Cell>
                                        <Cell align="right" mono>
                                            {c.present != null ? `${c.present} / ${c.clips ?? '?'}` : '—'}
                                        </Cell>
                                        <Cell align="right" mono>
                                            {c.errors ?? '—'}
                                        </Cell>
                                        <Cell align="right" mono>
                                            {c.empty ?? '—'}
                                        </Cell>
                                        <Cell>{c.scored ? <Tag tone="selected">scored</Tag> : <Tag tone="quiet">not yet</Tag>}</Cell>
                                    </Row>
                                ))}
                            </tbody>
                        </Table>
                    </Section>
                </div>
            )}
        </>
    )
}
