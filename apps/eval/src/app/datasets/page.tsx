import type { Metadata } from 'next'

import { EmptyNote, PageHeading } from '@/components/Layout'
import { ResynthBar, ResynthLegend, ScoreBar, Tag, TruthTag } from '@/components/Marks'
import { Cell, Head, Row, RowLink, Table } from '@/components/Table'
import { Tabs } from '@/components/Tabs'
import { type DatasetDto, MATERIALS } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'
import { EvalData } from '@/server/EvalData'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Datasets' }

const TIER_ORDER = ['benchmark', 'context', 'synthetic']

export default async function DatasetsPage({ searchParams }: { searchParams: Promise<{ corpus?: string }> }) {
    const { corpus } = await searchParams
    const synthetic = corpus === 'synthetic'
    const all = EvalData.datasets()
    const datasets = all
        .filter((d) => (d.tier === 'synthetic') === synthetic)
        .sort(
            (a, b) =>
                TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
                MATERIALS.indexOf(a.material) - MATERIALS.indexOf(b.material) ||
                a.id.localeCompare(b.id),
        )
    const anyResynth = datasets.some((d) => d.resynth && !d.resynth.calibration)

    return (
        <>
            <PageHeading eyebrow="Corpus" title="Datasets" />
            <Tabs
                label="Corpus"
                active={synthetic ? 'synthetic' : 'real'}
                tabs={[
                    { key: 'real', label: 'Real recordings', href: '/datasets', count: all.filter((d) => d.tier !== 'synthetic').length },
                    {
                        key: 'synthetic',
                        label: 'Synthetic corpus',
                        href: '/datasets?corpus=synthetic',
                        count: all.filter((d) => d.tier === 'synthetic').length,
                    },
                ]}
            />
            {datasets.length === 0 ? (
                <EmptyNote title="No datasets on this machine">
                    <p className="m-0">
                        The corpus is gitignored: the fetchers in <code>apps/api/scripts/eval/fetch/</code> build{' '}
                        <code>apps/api/scripts/fixtures/{synthetic ? 'eval-synth' : 'eval-real'}/</code>.
                    </p>
                </EmptyNote>
            ) : (
                <div className="flex flex-col gap-3">
                    {anyResynth && <ResynthLegend />}
                    <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow">
                        <Table minWidth="min-w-240">
                            <Head
                                columns={[
                                    'Dataset',
                                    'Tier',
                                    'Truth',
                                    { label: 'Clips', align: 'right' },
                                    'Resynth',
                                    'Licence',
                                    'Pooled',
                                    {
                                        label: 'Latest COnP',
                                        title: synthetic ? 'Mean over the latest synthetic run’s conditions' : 'From the latest real run',
                                    },
                                ]}
                            />
                            <tbody>
                                {datasets.map((d) => (
                                    <DatasetRow key={d.id} d={d} />
                                ))}
                            </tbody>
                        </Table>
                    </div>
                </div>
            )}
        </>
    )
}

function DatasetRow({ d }: { d: DatasetDto }) {
    return (
        <Row muted={!d.pooled && d.tier !== 'synthetic'}>
            <Cell className="max-w-80">
                <RowLink href={Route.dataset(d.id)} sub={`${d.id} · ${d.material}`}>
                    <span className="line-clamp-2">{d.label}</span>
                </RowLink>
            </Cell>
            <Cell>
                <Tag tone={d.tier === 'benchmark' ? 'neutral' : 'quiet'}>{d.tier}</Tag>
            </Cell>
            <Cell>
                <TruthTag source={d.truthSource} inferred={d.truthSourceInferred} />
            </Cell>
            <Cell align="right" mono>
                {Fmt.count(d.clips)}
            </Cell>
            <Cell>{d.resynth ? <ResynthBar progress={d.resynth} compact /> : <span className="text-on-surface-variant">—</span>}</Cell>
            <Cell className="text-[12px] max-w-40">
                <span className="line-clamp-2 break-words">{d.license ?? '—'}</span>
                {d.licenceRestricted && <span className="block text-secondary text-[11px] font-semibold">restricted</span>}
            </Cell>
            <Cell className="text-[12px]">
                {d.tier === 'synthetic' ? (
                    <span className="text-on-surface">synth benchmark</span>
                ) : d.pooled ? (
                    <span className="text-on-surface font-semibold">pooled</span>
                ) : (
                    <span>{d.unpooledReason}</span>
                )}
            </Cell>
            <Cell className="w-40">
                <ScoreBar value={d.truthSource === 'onsets' ? null : d.latestF1} muted={!d.pooled && d.tier !== 'synthetic'} />
            </Cell>
        </Row>
    )
}
