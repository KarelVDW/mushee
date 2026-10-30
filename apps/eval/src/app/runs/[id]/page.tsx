import { SecondaryButton } from '@mushee/ui'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeading, Section } from '@/components/Layout'
import { ScoreBar, StatTile, Tag, TruthTag } from '@/components/Marks'
import { Cell, Head, Row, RowLink, Table } from '@/components/Table'
import { MATERIALS, type RunKind, type ScenarioRowDto } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'
import { BenchmarkStore } from '@/server/BenchmarkStore'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const KIND_LABEL: Record<RunKind, string> = { real: 'Real-recording run', synth: 'Synthetic-corpus run', timeline: 'Timeline commit' }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
    const run = BenchmarkStore.get(Route.param((await params).id))
    return { title: run ? run.label : 'Run not found' }
}

export default async function RunPage({ params }: Params) {
    const run = BenchmarkStore.get(Route.param((await params).id))
    if (!run) notFound()
    const detail = run.detail(30)
    const s = detail.summary
    // The natural comparison: the run of the same kind just before this one.
    const runs = BenchmarkStore.list(run.kind)
    const previous = runs[runs.findIndex((r) => r.id === run.id) + 1] ?? null
    const scenarios = [...detail.perScenario].sort(
        (x, y) =>
            Number(y.pooled) - Number(x.pooled) ||
            MATERIALS.indexOf(x.material) - MATERIALS.indexOf(y.material) ||
            x.scenario.localeCompare(y.scenario),
    )
    const env = detail.extra.env ? Object.entries(detail.extra.env) : []
    // Whose cached notes the worst clips open with: a benchmark run's, or a timeline commit's.
    const notesSource = run.kind === 'timeline' ? `timeline:${s.gitSha}` : `run:${run.id}`
    const timeline = run.kind === 'timeline' ? TimelineMeta.of(run.meta) : null

    return (
        <>
            <PageHeading eyebrow={KIND_LABEL[run.kind]} title={s.label} back={{ href: Route.runs(run.kind), label: 'Runs' }}>
                {previous && <SecondaryButton href={Route.compare(previous.id, run.id)}>Compare with the run before</SecondaryButton>}
            </PageHeading>

            <dl className="grid gap-x-8 gap-y-2 grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_1fr] font-body text-[13px] -mt-4 mb-8">
                <MetaItem label="Commit">
                    <span className="font-mono">
                        {s.gitSha}
                        {s.gitDirty ? '* (dirty tree)' : ''}
                    </span>
                    {s.subject && s.subject !== s.label && <span className="text-on-surface-variant"> — {s.subject}</span>}
                </MetaItem>
                <MetaItem label={run.kind === 'timeline' ? 'Committed' : 'Recorded'}>
                    {Fmt.dateTime(s.date)} · {run.kind === 'timeline' ? 'transcribing took' : 'took'} {Fmt.duration(s.durationSec)}
                </MetaItem>
                <MetaItem label="Conditions">
                    {s.conditions.join(', ')}
                    {s.quick ? ' (quick: real only)' : ''}
                </MetaItem>
                <MetaItem label="Matching">
                    {detail.extra.matchTol?.onsetTolSec != null
                        ? `onset ±${Math.round(detail.extra.matchTol.onsetTolSec * 1000)} ms, exact MIDI`
                        : '—'}
                    {s.era ? ` · era ${s.era}` : ''}
                </MetaItem>
                {env.length > 0 && (
                    <MetaItem label="Environment">
                        <span className="font-mono text-[12px]">
                            {env.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}
                        </span>
                    </MetaItem>
                )}
                {detail.extra.corpus && (
                    <MetaItem label="Corpus">
                        {detail.extra.corpus.datasets} datasets fingerprinted
                        {detail.extra.corpus.version ? ` · corpus ${detail.extra.corpus.version}` : ''}
                    </MetaItem>
                )}
                {timeline && (
                    <MetaItem label="Clips">
                        {timeline.counts}
                        {timeline.medianMs != null ? ` · median ${Fmt.duration(timeline.medianMs / 1000)} per clip` : ''}
                    </MetaItem>
                )}
            </dl>
            {timeline?.note && (
                <p className="font-body text-[13px] leading-relaxed text-on-surface-variant max-w-4xl -mt-4 mb-8 text-pretty">
                    {timeline.note}
                </p>
            )}

            <div className="flex flex-col gap-6">
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile
                        label="COnP · all pooled"
                        value={Fmt.score(s.overallF1)}
                        detail={`Mean of ${s.pooledCount} pooled dataset means`}
                    />
                    <StatTile
                        label="COnP · human truth only"
                        value={run.kind === 'synth' ? '—' : Fmt.score(s.overallF1Human)}
                        detail={
                            run.kind === 'synth'
                                ? 'Synthetic truth is constructed'
                                : s.humanComputed
                                  ? 'Computed from the per-dataset rows'
                                  : 'As recorded'
                        }
                    />
                    <StatTile label="COnPOff · all pooled" value={Fmt.score(s.overallF1Off)} detail="Onset, pitch and offset" />
                    <StatTile label="Clips scored" value={Fmt.count(s.clipCount)} detail={`${s.datasetCount} datasets × conditions`} />
                </div>

                <Section title="By material" flush>
                    <Table>
                        <Head
                            columns={[
                                'Material',
                                'COnP',
                                { label: 'COnPOff', align: 'right' },
                                { label: 'P / R', align: 'right' },
                                { label: 'Clips', align: 'right' },
                                {
                                    label: 'Datasets',
                                    title: 'The datasets behind the row: pooled ones, or context ones for a provisional row',
                                },
                            ]}
                        />
                        <tbody>
                            {detail.perMaterial.map((m) => (
                                <Row key={m.material}>
                                    <Cell>
                                        <span className="font-semibold text-[14px] text-on-surface whitespace-nowrap">{m.material}</span>
                                        {m.provisional && (
                                            <span className="ml-2">
                                                <Tag tone="quiet">provisional</Tag>
                                            </span>
                                        )}
                                    </Cell>
                                    <Cell className="w-[28%]">
                                        <ScoreBar value={m.clips > 0 ? m.f1 : null} muted={m.provisional} />
                                    </Cell>
                                    <Cell align="right" mono>
                                        {m.clips > 0 ? Fmt.score(m.f1Off) : '—'}
                                    </Cell>
                                    <Cell align="right" mono>
                                        {m.clips > 0 ? `${Fmt.score(m.precision, 2)} / ${Fmt.score(m.recall, 2)}` : '—'}
                                    </Cell>
                                    <Cell align="right" mono>
                                        {Fmt.count(m.clips)}
                                    </Cell>
                                    <Cell className="text-[12px] text-on-surface-variant">{m.datasets.join(', ') || '—'}</Cell>
                                </Row>
                            ))}
                        </tbody>
                    </Table>
                </Section>

                <Section
                    title="By dataset"
                    flush
                    aside={`${scenarios.filter((x) => x.pooled).length} pooled · ${scenarios.filter((x) => !x.pooled).length} context`}
                    hint="Pooled datasets first. Context datasets never move the headline: derived truth, onsets only, constructed performance, a restricted licence or an explicit opt-out.">
                    <Table minWidth="min-w-260">
                        <Head
                            columns={[
                                'Dataset',
                                'Truth',
                                'COnP',
                                { label: 'COnPOff', align: 'right' },
                                { label: 'Onset F1', align: 'right' },
                                { label: 'P / R', align: 'right' },
                                { label: 'Octave err.', align: 'right' },
                                {
                                    label: 'Seg. /100',
                                    align: 'right',
                                    title: 'Molina segmentation errors per 100 reference notes: split / merged / missed / spurious',
                                },
                                { label: 'Clips', align: 'right' },
                            ]}
                        />
                        <tbody>
                            {scenarios.map((row) => (
                                <ScenarioRow key={row.scenario} row={row} />
                            ))}
                        </tbody>
                    </Table>
                </Section>

                {detail.perCondition.length > 0 && (
                    <Section title="By condition" flush hint="Clip-level means over the pooled datasets.">
                        <Table minWidth="min-w-0">
                            <Head
                                columns={[
                                    'Condition',
                                    'COnP',
                                    { label: 'COnPOff', align: 'right' },
                                    { label: 'P / R', align: 'right' },
                                    { label: 'Clips', align: 'right' },
                                ]}
                            />
                            <tbody>
                                {detail.perCondition.map((c) => (
                                    <Row key={c.condition}>
                                        <Cell>
                                            <span className="font-semibold text-on-surface">{c.label}</span>
                                        </Cell>
                                        <Cell className="w-[35%]">
                                            <ScoreBar value={c.f1} />
                                        </Cell>
                                        <Cell align="right" mono>
                                            {Fmt.score(c.f1Off)}
                                        </Cell>
                                        <Cell align="right" mono>
                                            {Fmt.score(c.precision, 2)} / {Fmt.score(c.recall, 2)}
                                        </Cell>
                                        <Cell align="right" mono>
                                            {Fmt.count(c.clips)}
                                        </Cell>
                                    </Row>
                                ))}
                            </tbody>
                        </Table>
                    </Section>
                )}

                <Section
                    title="Worst clips"
                    flush
                    hint="The lowest-scoring clips of the pooled datasets — open one to hear it against its truth and this run's notes.">
                    <Table>
                        <Head
                            columns={[
                                'Clip',
                                'Condition',
                                'Split',
                                { label: 'COnP', align: 'right' },
                                { label: 'COnPOff', align: 'right' },
                                { label: 'P / R', align: 'right' },
                                { label: 'Onset F1', align: 'right' },
                            ]}
                        />
                        <tbody>
                            {detail.worstClips.map((c) => (
                                <Row key={`${c.d}/${c.c}/${c.cond}`}>
                                    <Cell>
                                        <RowLink href={Route.clip(c.d, c.c, notesSource)} sub={c.d}>
                                            {c.c}
                                        </RowLink>
                                    </Cell>
                                    <Cell>{c.cond}</Cell>
                                    <Cell className="text-on-surface-variant">{c.split}</Cell>
                                    <Cell align="right" mono>
                                        <span className="font-semibold">{Fmt.score(c.f1)}</span>
                                    </Cell>
                                    <Cell align="right" mono>
                                        {Fmt.score(c.f1Off)}
                                    </Cell>
                                    <Cell align="right" mono>
                                        {Fmt.score(c.p, 2)} / {Fmt.score(c.r, 2)}
                                    </Cell>
                                    <Cell align="right" mono>
                                        {Fmt.score(c.onF1)}
                                    </Cell>
                                </Row>
                            ))}
                        </tbody>
                    </Table>
                </Section>

                <p className="font-mono text-[11px] text-on-surface-variant m-0 break-all">{detail.extra.file}</p>
            </div>
        </>
    )
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <>
            <dt className="font-label font-semibold text-[11px] tracking-[0.12em] uppercase text-on-surface-variant pt-0.5">{label}</dt>
            <dd className="m-0 text-on-surface min-w-0">{children}</dd>
        </>
    )
}

function ScenarioRow({ row }: { row: ScenarioRowDto }) {
    const per100 = (n: number) => (row.seg && row.seg.refTotal > 0 ? ((n / row.seg.refTotal) * 100).toFixed(0) : '—')
    const pitchMetrics = !row.pitchless
    return (
        <Row muted={!row.pooled}>
            <Cell className="min-w-56">
                <RowLink href={Route.dataset(row.scenario)} sub={`${row.material} · ${row.tier}${row.license ? ` · ${row.license}` : ''}`}>
                    {row.scenario}
                </RowLink>
            </Cell>
            <Cell className="min-w-36">
                <span className="inline-flex flex-wrap gap-1">
                    <TruthTag source={row.truthSource} inferred={row.truthSourceInferred} />
                    {!row.pooled && <Tag tone="quiet">context</Tag>}
                    {row.licenceRestricted && <Tag tone="quiet">restricted licence</Tag>}
                </span>
            </Cell>
            <Cell className="w-[18%]">
                <ScoreBar value={pitchMetrics ? row.f1 : null} muted={!row.pooled} />
            </Cell>
            <Cell align="right" mono>
                {pitchMetrics ? Fmt.score(row.f1Off) : '—'}
            </Cell>
            <Cell align="right" mono>
                {Fmt.score(row.onsetF1)}
            </Cell>
            <Cell align="right" mono>
                {pitchMetrics ? `${Fmt.score(row.precision, 2)} / ${Fmt.score(row.recall, 2)}` : '—'}
            </Cell>
            <Cell align="right" mono>
                {pitchMetrics ? Fmt.percent(row.octaveErrorRate) : '—'}
            </Cell>
            <Cell align="right" mono className="whitespace-nowrap">
                {row.seg && pitchMetrics
                    ? `${per100(row.seg.split)} / ${per100(row.seg.merged)} / ${per100(row.seg.missed)} / ${per100(row.seg.spurious)}`
                    : '—'}
            </Cell>
            <Cell align="right" mono>
                {Fmt.count(row.clips)}
            </Cell>
        </Row>
    )
}

/** What a timeline commit's result adds to the benchmark meta (timeline/score.ts `TimelineMeta`). */
class TimelineMeta {
    private constructor(
        readonly note: string | null,
        readonly counts: string,
        readonly medianMs: number | null,
    ) {}

    static of(meta: Readonly<Record<string, unknown>>): TimelineMeta {
        const c = (meta.counts && typeof meta.counts === 'object' ? meta.counts : {}) as Record<string, unknown>
        const n = (k: string): number => {
            const v = c[k]
            return typeof v === 'number' ? v : 0
        }
        const parts = [
            `${n('scored')} scored`,
            n('emptyOutputs') && `${n('emptyOutputs')} empty`,
            n('pipelineErrors') && `${n('pipelineErrors')} pipeline errors`,
            n('noTruth') && `${n('noTruth')} without truth`,
            n('missing') && `${n('missing')} not run yet`,
            n('failed') && `${n('failed')} harness failures`,
        ].filter(Boolean)
        return new TimelineMeta(
            typeof meta.note === 'string' ? meta.note : null,
            parts.join(' · '),
            typeof meta.medianClipMs === 'number' ? meta.medianClipMs : null,
        )
    }
}
