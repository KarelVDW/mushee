import { Icon, TextLink } from '@mushee/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ClipTable } from '@/components/ClipTable'
import { PageHeading } from '@/components/Layout'
import { ResynthBar, StatTile, Tag, TruthTag } from '@/components/Marks'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'
import { EvalData } from '@/server/EvalData'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
    return { title: Route.param((await params).id) }
}

export default async function DatasetPage({ params }: Params) {
    const detail = EvalData.datasetDetail(Route.param((await params).id))
    if (!detail) notFound()
    const d = detail.dataset
    const totalSec = detail.clips.reduce((s, c) => s + (c.durationSec ?? 0), 0)
    const totalNotes = detail.clips.reduce((s, c) => s + (c.notes ?? 0), 0)

    return (
        <>
            <PageHeading
                eyebrow="Dataset"
                title={d.label}
                back={{ href: d.tier === 'synthetic' ? '/datasets?corpus=synthetic' : '/datasets', label: 'Datasets' }}>
                <span className="inline-flex flex-wrap gap-1.5">
                    <Tag>{d.tier}</Tag>
                    <Tag>{d.material}</Tag>
                    <TruthTag source={d.truthSource} inferred={d.truthSourceInferred} />
                    {d.tier === 'synthetic' ? (
                        <Tag>synth benchmark</Tag>
                    ) : (
                        <Tag tone={d.pooled ? 'selected' : 'quiet'}>{d.pooled ? 'pooled' : 'not pooled'}</Tag>
                    )}
                </span>
            </PageHeading>

            <div className="flex flex-col gap-6">
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile
                        label="Clips"
                        value={Fmt.count(d.clips)}
                        detail={`${Fmt.duration(totalSec)} of audio · ${Fmt.count(totalNotes)} truth notes`}
                    />
                    <StatTile
                        label="Latest COnP"
                        value={d.truthSource === 'onsets' ? '—' : Fmt.score(d.latestF1)}
                        detail={
                            detail.latestRun ? (
                                <>
                                    <TextLink as={Link} href={Route.run(detail.latestRun.id)}>
                                        {detail.latestRun.label}
                                    </TextLink>
                                    {d.truthSource === 'onsets' ? ' — onsets only, read the onset F1 per clip' : ''}
                                </>
                            ) : (
                                'Not scored yet'
                            )
                        }
                    />
                    <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 flex flex-col gap-2 sm:col-span-2">
                        <span className="font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                            About
                        </span>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-body text-[13px] m-0">
                            <dt className="text-on-surface-variant">Id</dt>
                            <dd className="m-0 font-mono text-[12px]">{d.id}</dd>
                            <dt className="text-on-surface-variant">Licence</dt>
                            <dd className="m-0">
                                {d.license ?? '—'}
                                {d.licenceRestricted ? ' (restricted: context only)' : ''}
                            </dd>
                            {!d.pooled && (
                                <>
                                    <dt className="text-on-surface-variant">Not pooled</dt>
                                    <dd className="m-0">{d.unpooledReason}</dd>
                                </>
                            )}
                            {d.source && (
                                <>
                                    <dt className="text-on-surface-variant">Source</dt>
                                    <dd className="m-0 break-all">
                                        {/^https?:/.test(d.source) ? (
                                            <TextLink href={d.source} target="_blank" rel="noreferrer">
                                                {d.source}
                                            </TextLink>
                                        ) : (
                                            d.source
                                        )}
                                    </dd>
                                </>
                            )}
                            {d.resynth && (
                                <>
                                    <dt className="text-on-surface-variant pt-0.5">Resynth</dt>
                                    <dd className="m-0">
                                        <ResynthBar progress={d.resynth} />
                                    </dd>
                                </>
                            )}
                        </dl>
                    </div>
                </div>

                {d.notes && (
                    <details className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-3 group">
                        <summary className="cursor-pointer list-none font-label font-semibold text-[13px] text-on-surface min-h-8 flex items-center gap-1.5 focus-ring rounded-sm">
                            <span className="inline-flex transition-transform duration-150 ease-solkey group-open:rotate-90 motion-reduce:transition-none">
                                <Icon name="chevron-right" size={16} />
                            </span>
                            Dataset notes
                        </summary>
                        <p className="font-body text-[13px] leading-relaxed text-on-surface-variant m-0 mt-2 max-w-4xl text-pretty">
                            {d.notes}
                        </p>
                    </details>
                )}

                <ClipTable dataset={d.id} clips={detail.clips} hasResynth={!!d.resynth} pitchless={d.truthSource === 'onsets'} />
            </div>
        </>
    )
}
