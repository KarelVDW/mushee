'use client'

import type { MxmlMeasure } from '@mushee/notation/components/types'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { MetricsPanel } from '@/components/MetricsPanel'
import { NotesCompare } from '@/components/NotesCompare'
import { ScoreView } from '@/components/ScoreView'
import { Alert, Card, Chip, Eyebrow, PrimaryButton, SecondaryButton, Spinner, ToggleButton } from '@/components/ui'
import { clipAudioUrl } from '@/lib/api'
import { melodyToScore, mxmlMeasuresToScore, playbackInstrument } from '@/lib/buildScore'
import { melodyToTruth } from '@/lib/melody'
import { useClip, useTranscribe } from '@/lib/queries'
import { useEvalPlayer } from '@/lib/useEvalPlayer'

export default function ClipDetailPage() {
    const { id, clipId } = useParams<{ id: string; clipId: string }>()
    const detail = useClip(clipId)
    const transcribe = useTranscribe()
    const { player, mode } = useEvalPlayer()
    const [metronomeOn, setMetronomeOn] = useState(true)

    const built = useMemo(() => {
        if (!detail.data) return null
        const { clip, corpus, transcription } = detail.data
        const instrument = playbackInstrument(corpus.kind, corpus.instrumentId)
        return {
            instrument,
            expectedScore: melodyToScore(clip.melody, instrument),
            derivedScore: transcription?.measures
                ? mxmlMeasuresToScore(
                      transcription.measures as Record<number, MxmlMeasure>,
                      corpus.bpm,
                      corpus.beatsPerMeasure,
                      instrument,
                  )
                : null,
        }
    }, [detail.data])

    if (detail.isPending)
        return (
            <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                <Spinner /> Loading clip…
            </div>
        )
    if (detail.isError) return <Alert onRetry={() => detail.refetch()}>Couldn&apos;t load clip: {String(detail.error)}</Alert>

    const { clip, corpus, transcription, prevClipId, nextClipId, clipIndex, clipTotal } = detail.data

    const replay = () => {
        if (mode === 'playing') {
            player.stop()
            return
        }
        void player.prepare(built!.instrument).then(() => player.playScore(built!.expectedScore, { metronome: metronomeOn }))
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-1.5">
                    <div className="font-body text-[12px] text-on-surface-variant">
                        <Link href={`/corpora/${id}`} className="text-primary no-underline hover:underline">
                            {corpus.label}
                        </Link>{' '}
                        · clip {clipIndex + 1}/{clipTotal}
                    </div>
                    <h1 className="font-headline font-bold text-[1.5rem] leading-tight text-on-surface m-0">{clip.name}</h1>
                    <div className="flex items-center gap-2">
                        <Chip>{clip.melody.keyLabel}</Chip>
                        <Chip>{corpus.bpm} bpm</Chip>
                        <Chip active={clip.status === 'recorded'}>{clip.status}</Chip>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {prevClipId && (
                        <Link href={`/corpora/${id}/clips/${prevClipId}`} className="font-label text-[13px] text-primary no-underline hover:underline">
                            ← prev
                        </Link>
                    )}
                    {nextClipId && (
                        <Link href={`/corpora/${id}/clips/${nextClipId}`} className="font-label text-[13px] text-primary no-underline hover:underline">
                            next →
                        </Link>
                    )}
                </div>
            </div>

            <Card>
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <Eyebrow>Expected notes</Eyebrow>
                    <div className="flex items-center gap-2">
                        <ToggleButton active={metronomeOn} onClick={() => setMetronomeOn((v) => !v)}>
                            metronome
                        </ToggleButton>
                        <PrimaryButton icon={mode === 'playing' ? 'square' : 'play'} onClick={replay}>
                            {mode === 'playing' ? 'Stop' : 'Replay'}
                        </PrimaryButton>
                        <Link href={`/corpora/${id}/record?clip=${clip.id}`} className="no-underline">
                            <SecondaryButton>{clip.status === 'recorded' ? 'Re-record' : 'Record'}</SecondaryButton>
                        </Link>
                    </div>
                </div>
                {built && <ScoreView score={built.expectedScore} />}
            </Card>

            {clip.status === 'recorded' && (
                <Card>
                    <Eyebrow className="block mb-3">Recording</Eyebrow>
                    {/* key forces a reload after a re-record */}
                    <audio key={clip.recordedAt ?? 'none'} controls src={clipAudioUrl(clip.id)} className="w-full" />
                </Card>
            )}

            <Card>
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <Eyebrow>Pipeline transcription</Eyebrow>
                    <div className="flex items-center gap-3">
                        {transcription && (
                            <span className="font-mono text-[12px] text-on-surface-variant">
                                {new Date(transcription.createdAt).toLocaleString()}
                            </span>
                        )}
                        <PrimaryButton
                            icon="refresh-cw"
                            disabled={clip.status !== 'recorded' || transcribe.isPending}
                            onClick={() => transcribe.mutate(clip.id)}>
                            {transcribe.isPending ? 'Transcribing…' : transcription ? 'Retry' : 'Transcribe'}
                        </PrimaryButton>
                    </div>
                </div>
                {transcribe.isError && <Alert>{String(transcribe.error)}</Alert>}
                {clip.status !== 'recorded' && (
                    <p className="font-body text-[13px] text-on-surface-variant m-0">Record this clip first, then the pipeline runs on it.</p>
                )}
                {clip.status === 'recorded' && !transcription && !transcribe.isPending && (
                    <p className="font-body text-[13px] text-on-surface-variant m-0">
                        No transcription stored yet — hit Transcribe. The first call warms the model worker (~10 s); retries after a
                        pipeline change are fast.
                    </p>
                )}
                {transcribe.isPending && (
                    <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                        <Spinner /> Running the production pipeline…
                    </div>
                )}
                {transcription && (
                    <div className="flex flex-col gap-5">
                        {transcription.metrics && <MetricsPanel metrics={transcription.metrics} />}
                        {built?.derivedScore && <ScoreView score={built.derivedScore} />}
                        <NotesCompare expected={melodyToTruth(clip.melody).notes} derived={transcription.notes} />
                    </div>
                )}
            </Card>
        </div>
    )
}
