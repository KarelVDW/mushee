import { TextLink } from '@mushee/ui'
import Link from 'next/link'

import { TimelineCharts } from '@/components/charts/TimelineCharts'
import { EmptyNote, PageHeading, Section } from '@/components/Layout'
import { DeltaText, ResynthBar, ResynthLegend, ScoreBar, StatTile, Tag, TruthTag } from '@/components/Marks'
import { Cell, Head, Row, RowLink, Table } from '@/components/Table'
import { TRUTH_SOURCES } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'
import { EvalData } from '@/server/EvalData'

export const dynamic = 'force-dynamic'

export default function OverviewPage() {
    const data = EvalData.overview()
    const latest = data.latest
    const points = data.timeline.points
    const lastPoint = points[points.length - 1]
    const prevPoint = points[points.length - 2]

    return (
        <>
            <PageHeading eyebrow="Recording pipeline benchmark" title="Overview">
                {latest && (
                    <span className="font-mono text-[13px] text-on-surface-variant">
                        latest real run{' '}
                        <Link href={Route.run(latest.summary.id)} className="text-primary no-underline hover:underline">
                            {latest.summary.label}
                        </Link>{' '}
                        · {latest.summary.gitSha}
                        {latest.summary.gitDirty ? '*' : ''} · {Fmt.dateTime(latest.summary.date)}
                    </span>
                )}
            </PageHeading>

            {!latest ? (
                <EmptyNote title="No benchmark results yet">
                    <p className="m-0">
                        Run <code>pnpm exec tsx scripts/eval/benchmark.ts run --quick</code> in <code>apps/api</code>; its result lands in{' '}
                        <code>apps/eval/data/benchmarks/real/</code>.
                    </p>
                </EmptyNote>
            ) : (
                <div className="flex flex-col gap-6">
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                        <StatTile
                            label="COnP · all pooled"
                            value={Fmt.score(latest.summary.overallF1)}
                            detail={`Mean of ${latest.summary.pooledCount} pooled datasets · ${Fmt.count(latest.summary.clipCount)} clips`}
                        />
                        <StatTile
                            label="COnP · human truth only"
                            value={Fmt.score(latest.summary.overallF1Human)}
                            detail={
                                latest.summary.humanComputed
                                    ? 'Computed here: this run predates the split, every pooled set was human truth'
                                    : 'Continuous with the history before resynth truth'
                            }
                        />
                        <StatTile
                            label="COnPOff · all pooled"
                            value={Fmt.score(latest.summary.overallF1Off)}
                            detail="Onset, pitch and offset all right"
                        />
                        <StatTile
                            label="Synthetic corpus"
                            value={Fmt.score(data.synth?.meanF1 ?? null)}
                            detail={
                                data.synth
                                    ? `Mean of ${data.synth.runs.length} conditions · ${data.synth.label} · ${data.synth.gitSha}`
                                    : 'No synthetic run yet'
                            }
                        />
                    </div>

                    <Section
                        title="By material — latest real run"
                        flush
                        hint="COnP: onset within 100 ms and the exact semitone. A provisional row has no benchmark-grade truth yet: it is built from context datasets and never gates a decision.">
                        <Table>
                            <Head
                                columns={[
                                    'Material',
                                    'COnP',
                                    { label: 'COnPOff', align: 'right' },
                                    { label: 'Clips', align: 'right' },
                                    'Truth behind it',
                                    'Context datasets',
                                ]}
                            />
                            <tbody>
                                {latest.materials.map((m) => (
                                    <Row key={m.material}>
                                        <Cell>
                                            <span className="font-body font-semibold text-[14px] text-on-surface whitespace-nowrap">
                                                {m.material}
                                            </span>
                                            {m.provisional && (
                                                <span className="ml-2">
                                                    <Tag tone="quiet" title="Built from context-tier truth only — never gates">
                                                        provisional
                                                    </Tag>
                                                </span>
                                            )}
                                        </Cell>
                                        <Cell className="w-[30%]">
                                            <ScoreBar value={m.clips > 0 ? m.f1 : null} muted={m.provisional} />
                                        </Cell>
                                        <Cell align="right" mono>
                                            {m.clips > 0 ? Fmt.score(m.f1Off) : '—'}
                                        </Cell>
                                        <Cell align="right" mono>
                                            {Fmt.count(m.clips)}
                                        </Cell>
                                        <Cell>
                                            <TruthMix mix={m.truthMix} datasets={m.datasets.length} provisional={m.provisional} />
                                        </Cell>
                                        <Cell className="text-on-surface-variant text-[12px]">{m.contextDatasets.join(', ') || '—'}</Cell>
                                    </Row>
                                ))}
                            </tbody>
                        </Table>
                    </Section>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Section
                            title="Timeline"
                            aside={
                                <TextLink as={Link} href="/timeline">
                                    Open the timeline
                                </TextLink>
                            }>
                            {points.length === 0 ? (
                                <p className="font-body text-[14px] text-on-surface-variant m-0">
                                    No historical commits scored yet.{' '}
                                    <code className="font-mono text-[13px]">apps/api/scripts/eval/timeline/score.ts</code> fills{' '}
                                    <code className="font-mono text-[13px]">apps/eval/data/timeline/</code> once{' '}
                                    <code className="font-mono text-[13px]">run.ts</code> has transcribed the sampled commits.
                                </p>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-baseline gap-3">
                                        <span className="font-display font-semibold text-[28px] leading-none text-on-surface">
                                            {Fmt.score(lastPoint?.overall)}
                                        </span>
                                        {prevPoint?.overall != null && lastPoint?.overall != null && (
                                            <DeltaText value={lastPoint.overall - prevPoint.overall} className="text-[13px]" />
                                        )}
                                        <span className="font-body text-[13px] text-on-surface-variant">
                                            at {lastPoint?.short} · {points.length} commits
                                        </span>
                                    </div>
                                    <TimelineCharts points={points} compact />
                                </div>
                            )}
                        </Section>

                        <Section
                            title="Synthetic corpus — latest run"
                            flush
                            aside={
                                data.synth && (
                                    <TextLink as={Link} href="/runs?kind=synth">
                                        All synth runs
                                    </TextLink>
                                )
                            }>
                            {data.synth ? (
                                <Table minWidth="min-w-0">
                                    <Head
                                        columns={[
                                            'Condition',
                                            'COnP',
                                            { label: 'COnPOff', align: 'right' },
                                            { label: 'Clips', align: 'right' },
                                        ]}
                                    />
                                    <tbody>
                                        {data.synth.runs.map((r) => (
                                            <Row key={r.id}>
                                                <Cell>
                                                    <RowLink href={Route.run(r.id)}>{r.condition}</RowLink>
                                                </Cell>
                                                <Cell className="w-[45%]">
                                                    <ScoreBar value={r.overallF1} />
                                                </Cell>
                                                <Cell align="right" mono>
                                                    {Fmt.score(r.overallF1Off)}
                                                </Cell>
                                                <Cell align="right" mono>
                                                    {Fmt.count(r.clipCount)}
                                                </Cell>
                                            </Row>
                                        ))}
                                    </tbody>
                                </Table>
                            ) : (
                                <p className="font-body text-[14px] text-on-surface-variant m-0 px-5 pb-4">No synthetic benchmark yet.</p>
                            )}
                        </Section>
                    </div>
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2 mt-6">
                <Section
                    title="Datasets by truth source"
                    flush
                    aside={
                        <TextLink as={Link} href="/datasets">
                            {data.datasetCount} real datasets
                        </TextLink>
                    }>
                    <Table minWidth="min-w-0">
                        <Head
                            columns={[
                                'Truth',
                                { label: 'Datasets', align: 'right' },
                                { label: 'Pooled', align: 'right' },
                                { label: 'Clips', align: 'right' },
                            ]}
                        />
                        <tbody>
                            {TRUTH_SOURCES.map((source) => {
                                const row = data.truthSources.find((r) => r.source === source)
                                if (!row) return null
                                return (
                                    <Row key={source}>
                                        <Cell>
                                            <TruthTag source={source} />
                                        </Cell>
                                        <Cell align="right" mono>
                                            {row.datasets}
                                        </Cell>
                                        <Cell align="right" mono>
                                            {row.pooledDatasets}
                                        </Cell>
                                        <Cell align="right" mono>
                                            {Fmt.count(row.clips)}
                                        </Cell>
                                    </Row>
                                )
                            })}
                        </tbody>
                    </Table>
                </Section>
                <Section title="Resynth truth" aside={data.resynth.datasets > 0 ? `${data.resynth.datasets} datasets in scope` : undefined}>
                    {data.resynth.total === 0 && data.resynth.calibrationClips === 0 ? (
                        <p className="font-body text-[14px] text-on-surface-variant m-0">
                            No clip has entered the resynth loop yet (
                            <code className="font-mono text-[13px]">synthetic-corpus/RESYNTH.md</code>).
                        </p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {data.resynth.total > 0 && <ResynthBar progress={{ ...data.resynth, calibration: false }} />}
                            {data.resynth.total > 0 && <ResynthLegend />}
                            {data.resynth.calibrationClips > 0 && (
                                <p className="font-body text-[13px] text-on-surface-variant m-0">
                                    Plus {data.resynth.calibrationClips} blind calibration clips on human-truth datasets.
                                </p>
                            )}
                        </div>
                    )}
                </Section>
            </div>
        </>
    )
}

function TruthMix({ mix, datasets, provisional }: { mix: Partial<Record<string, number>>; datasets: number; provisional: boolean }) {
    const entries = Object.entries(mix).filter(([, n]) => (n ?? 0) > 0)
    if (provisional || !entries.length)
        return (
            <span className="font-body text-[12px] text-on-surface-variant">
                {datasets ? `${datasets} context datasets` : 'no note truth'}
            </span>
        )
    return (
        <span className="font-body text-[13px] text-on-surface">
            {entries.map(([source, n]) => `${n} ${source}`).join(' · ')}
            <span className="text-on-surface-variant"> pooled</span>
        </span>
    )
}
