import { SecondaryButton } from '@mushee/ui'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { CompareView } from '@/components/compare/CompareView'
import { JudgePanels, ResynthPanel, ScoresPanel } from '@/components/compare/SidePanels'
import { PageHeading } from '@/components/Layout'
import { Tag, TruthTag } from '@/components/Marks'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'
import { EvalData } from '@/server/EvalData'
import { PipelineNotes } from '@/server/PipelineNotes'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string; clip: string }>; searchParams: Promise<{ source?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { clip } = await params
    return { title: Route.param(clip) }
}

export default async function ClipPage({ params, searchParams }: Props) {
    const { id: rawId, clip: rawClip } = await params
    const { source: requested } = await searchParams
    const id = Route.param(rawId)
    const clip = Route.param(rawClip)
    const dto = EvalData.clipCompare(id, clip)
    if (!dto) notFound()

    // Whose notes to overlay first: the one asked for (a run's worst-clips link), else the newest run that scored this clip.
    const source =
        dto.pipelineSources.find((s) => s.key === requested)?.key ??
        dto.pipelineSources.find((s) => dto.scores.some((score) => `run:${score.runId}` === s.key))?.key ??
        dto.pipelineSources[0]?.key ??
        null
    const initialNotes = source ? PipelineNotes.read(source, id, clip) : null
    const prevHref = dto.prev ? Route.clip(id, dto.prev) : null
    const nextHref = dto.next ? Route.clip(id, dto.next) : null

    return (
        <>
            <PageHeading
                eyebrow="Clip"
                title={<span className="font-mono text-[22px] sm:text-[26px] tracking-[-0.01em]">{clip}</span>}
                back={{ href: Route.dataset(id), label: dto.dataset.label }}>
                <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-on-surface-variant mr-1">
                        {dto.index + 1} / {dto.total}
                    </span>
                    {prevHref ? (
                        <SecondaryButton href={prevHref}>Previous</SecondaryButton>
                    ) : (
                        <SecondaryButton disabled>Previous</SecondaryButton>
                    )}
                    {nextHref ? <SecondaryButton href={nextHref}>Next</SecondaryButton> : <SecondaryButton disabled>Next</SecondaryButton>}
                </div>
            </PageHeading>
            <div className="flex flex-wrap items-center gap-1.5 -mt-5 mb-6">
                <Tag>{dto.dataset.tier}</Tag>
                <Tag>{dto.dataset.material}</Tag>
                <TruthTag source={dto.dataset.truthSource} />
                {!dto.dataset.pooled && dto.dataset.tier !== 'synthetic' && <Tag tone="quiet">not pooled</Tag>}
                <span className="font-mono text-[12px] text-on-surface-variant ml-1">{Fmt.clock(dto.durationSec)}</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] items-start">
                <div className="flex flex-col gap-4 min-w-0">
                    <CompareView dto={dto} initialSource={source} initialNotes={initialNotes} prevHref={prevHref} nextHref={nextHref} />
                    <JudgePanels dataset={id} clip={clip} resynth={dto.resynth} />
                </div>
                <div className="flex flex-col gap-4">
                    <ResynthPanel resynth={dto.resynth} />
                    <ScoresPanel scores={dto.scores} pitchless={dto.dataset.truthSource === 'onsets'} />
                </div>
            </div>
        </>
    )
}
