import { PrimaryButton } from '@mushee/ui'
import type { Metadata } from 'next'

import { EmptyNote, PageHeading, Section } from '@/components/Layout'
import { DeltaText, LegendSwatch, PairBar, StatTile, Tag, TruthTag } from '@/components/Marks'
import { Cell, Head, Row, RowLink, Table } from '@/components/Table'
import type { RunKind } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'
import { BenchmarkStore } from '@/server/BenchmarkStore'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Compare runs' }

const KIND_NOUN: Record<RunKind, string> = {
    real: 'real-recording benchmark run',
    synth: 'synthetic-corpus run',
    timeline: 'timeline commit',
}

const GROUPS: Array<{ kind: RunKind; label: string }> = [
    { kind: 'real', label: 'Real recordings' },
    { kind: 'synth', label: 'Synthetic corpus' },
    { kind: 'timeline', label: 'Timeline commits' },
]

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
    const query = await searchParams
    const a = query.a ? BenchmarkStore.get(query.a) : null
    const b = query.b ? BenchmarkStore.get(query.b) : null
    const options = GROUPS.map((g) => ({ ...g, runs: BenchmarkStore.list(g.kind) })).filter((g) => g.runs.length > 0)
    const cmp = a && b ? BenchmarkStore.compare(a, b) : null
    // Conditions only one run scored: the unpaired numbers (each run's own mean) mix that coverage in.
    const onlyA = cmp ? cmp.a.conditions.filter((c) => !cmp.b.conditions.includes(c)) : []
    const onlyB = cmp ? cmp.b.conditions.filter((c) => !cmp.a.conditions.includes(c)) : []

    return (
        <>
            <PageHeading eyebrow="Benchmark" title="Compare two runs" back={{ href: '/runs', label: 'Runs' }} />

            <form action="/compare" method="get" className="flex flex-wrap items-end gap-3 mb-8">
                <RunSelect name="a" label="Run A" tone="bg-chart-cyan" value={query.a} groups={options} />
                <RunSelect name="b" label="Run B" tone="bg-chart-magenta" value={query.b} groups={options} />
                <PrimaryButton type="submit">Compare</PrimaryButton>
            </form>

            {!cmp ? (
                <EmptyNote title={query.a || query.b ? 'One of these runs is not on this machine' : 'Pick two runs'}>
                    <p className="m-0">Choose run A (the baseline) and run B (the candidate) above, or pick two on the Runs page.</p>
                </EmptyNote>
            ) : (
                <div className="flex flex-col gap-6">
                    {cmp.a.kind !== cmp.b.kind && (
                        <EmptyNote title="These runs measure different things">
                            <p className="m-0">
                                Run A is a {KIND_NOUN[cmp.a.kind]}, run B a {KIND_NOUN[cmp.b.kind]}. Timeline commits run the product&apos;s
                                RecordingPipeline on the test half of a capped clip set; benchmark runs score the converter path on every
                                clip. Read the paired column for direction only, never the levels.
                            </p>
                        </EmptyNote>
                    )}
                    {/* "0.766 → 0.770" needs ~250 px: four across only once the content column is that wide. */}
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                        <StatTile
                            label="COnP · all pooled"
                            value={`${Fmt.score(cmp.a.overallF1)} → ${Fmt.score(cmp.b.overallF1)}`}
                            detail={
                                <>
                                    Change <DeltaText value={cmp.b.overallF1 - cmp.a.overallF1} /> · each run&apos;s own pooled datasets
                                </>
                            }
                        />
                        <StatTile
                            label="COnP · human truth only"
                            value={`${Fmt.score(cmp.a.overallF1Human)} → ${Fmt.score(cmp.b.overallF1Human)}`}
                            detail={
                                cmp.a.overallF1Human != null && cmp.b.overallF1Human != null ? (
                                    <>
                                        Change <DeltaText value={cmp.b.overallF1Human - cmp.a.overallF1Human} />
                                    </>
                                ) : (
                                    'Not available for both runs'
                                )
                            }
                        />
                        <StatTile
                            label="Paired change · pooled"
                            value={Fmt.delta(cmp.paired.delta)}
                            detail={`B − A on the ${Fmt.count(cmp.paired.clips)} clips both scored, mean over ${cmp.paired.datasets} datasets pooled in both runs`}
                        />
                        <StatTile
                            label="Paired change · human truth"
                            value={Fmt.delta(cmp.pairedHuman.delta)}
                            detail={`${Fmt.count(cmp.pairedHuman.clips)} clips, ${cmp.pairedHuman.datasets} human-truth datasets`}
                        />
                    </div>
                    {(onlyA.length > 0 || onlyB.length > 0) && (
                        <EmptyNote title="The runs scored different conditions">
                            <p className="m-0">
                                {onlyB.length > 0 && <>Only run B scored {onlyB.join(', ')}. </>}
                                {onlyA.length > 0 && <>Only run A scored {onlyA.join(', ')}. </>}
                                The first two tiles and the B − A column compare each run&apos;s own mean, so they include that change in
                                coverage. The paired change compares only the clips both runs scored in the same condition.
                            </p>
                        </EmptyNote>
                    )}
                    {cmp.leftOut.length > 0 && (
                        <p className="font-body text-[13px] text-on-surface-variant m-0 max-w-4xl text-pretty">
                            Left out of the paired change:{' '}
                            {cmp.leftOut.map((l, i) => (
                                <span key={l.scenario}>
                                    {i > 0 && ' · '}
                                    <span className="font-mono text-[12px] text-on-surface">{l.scenario}</span> ({l.reason})
                                </span>
                            ))}
                            .
                        </p>
                    )}

                    <Section
                        title="Per dataset"
                        flush
                        aside={
                            <span className="inline-flex flex-wrap gap-x-4 gap-y-1">
                                <LegendSwatch className="bg-chart-cyan" label={`A · ${cmp.a.label}`} />
                                <LegendSwatch className="bg-chart-magenta" label={`B · ${cmp.b.label}`} />
                            </span>
                        }
                        hint="Bars on the absolute 0–1 COnP scale. The paired change pairs the clips (dataset, clip, condition) both runs scored, so a dataset that grew or shrank between the runs does not fake a change; a dataset whose truth source changed is shown but never paired into the headline.">
                        <Table minWidth="min-w-200">
                            <Head
                                columns={[
                                    'Dataset',
                                    'Truth',
                                    'A / B',
                                    { label: 'B − A', align: 'right' },
                                    { label: 'Paired', align: 'right', title: 'Mean of B − A over the clips both runs scored' },
                                    { label: 'Paired clips', align: 'right' },
                                ]}
                            />
                            <tbody>
                                {cmp.rows.map((r) => (
                                    <Row key={r.scenario} muted={!r.pooled}>
                                        <Cell>
                                            <RowLink href={Route.dataset(r.scenario)} sub={r.material}>
                                                {r.scenario}
                                            </RowLink>
                                        </Cell>
                                        <Cell>
                                            <span className="inline-flex flex-wrap gap-1">
                                                {r.truthChange === 'source' && r.truthSourceA && (
                                                    <>
                                                        <TruthTag source={r.truthSourceA} />
                                                        <span className="font-body text-[12px] text-on-surface-variant">→</span>
                                                    </>
                                                )}
                                                <TruthTag source={r.truthSource} />
                                                {r.truthChange === 'files' && (
                                                    <Tag
                                                        tone="quiet"
                                                        title="The runs scored different truth files for this dataset (clips added or truth edited): the paired change may include the truth change">
                                                        truth files differ
                                                    </Tag>
                                                )}
                                                {!r.pooled && <Tag tone="quiet">context</Tag>}
                                            </span>
                                        </Cell>
                                        <Cell className="w-[34%]">
                                            {r.pitchless ? (
                                                <span className="font-body text-[12px] text-on-surface-variant">
                                                    onset truth only, no COnP
                                                </span>
                                            ) : (
                                                <PairBar a={r.a} b={r.b} />
                                            )}
                                        </Cell>
                                        <Cell align="right">
                                            <DeltaText value={!r.pitchless && r.a !== null && r.b !== null ? r.b - r.a : null} />
                                        </Cell>
                                        <Cell align="right">
                                            <DeltaText value={r.pitchless ? null : r.pairedDelta} />
                                        </Cell>
                                        <Cell align="right" mono className="text-on-surface-variant">
                                            {r.pairedClips || '—'}
                                        </Cell>
                                    </Row>
                                ))}
                            </tbody>
                        </Table>
                    </Section>
                    <p className="font-body text-[13px] text-on-surface-variant m-0 max-w-3xl text-pretty">
                        For confidence intervals, run{' '}
                        <code className="font-mono text-[12px] text-on-surface">
                            benchmark.ts compare {cmp.a.id} {cmp.b.id}
                        </code>{' '}
                        in <code className="font-mono text-[12px] text-on-surface">apps/api</code> (paired bootstrap, 9,999 resamples).
                    </p>
                </div>
            )}
        </>
    )
}

function RunSelect({
    name,
    label,
    tone,
    value,
    groups,
}: {
    name: string
    label: string
    tone: string
    value?: string
    groups: Array<{ kind: RunKind; label: string; runs: ReturnType<typeof BenchmarkStore.list> }>
}) {
    return (
        <label className="flex flex-col gap-1.5 min-w-0 flex-1 basis-72">
            <span className="inline-flex items-center gap-1.5 font-label font-semibold text-[11px] tracking-[0.12em] uppercase text-on-surface-variant">
                <span aria-hidden="true" className={`inline-block w-3 h-2.5 rounded-xs ${tone}`} />
                {label}
            </span>
            <select
                name={name}
                defaultValue={value ?? ''}
                className="h-(--control-md) rounded-sm bg-surface-container-lowest tonal-layer-glow px-3 font-body text-[14px] text-on-surface border-0 focus-ring cursor-pointer min-w-0">
                <option value="" disabled>
                    Choose a run…
                </option>
                {groups.map((g) => (
                    <optgroup key={g.kind} label={g.label}>
                        {g.runs.map((r) => (
                            // One string child: React separates several text children with comments, which an <option> drops.
                            <option key={r.id} value={r.id}>
                                {`${Fmt.date(r.date)} · ${r.gitSha} · ${r.label} · ${Fmt.score(r.summary().overallF1)}`}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </label>
    )
}
