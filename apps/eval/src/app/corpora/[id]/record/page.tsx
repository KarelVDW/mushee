'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { ScoreView } from '@/components/ScoreView'
import { Alert, Card, Chip, Eyebrow, PrimaryButton, SecondaryButton, Spinner, ToggleButton } from '@/components/ui'
import type { TranscriptionDto } from '@/lib/api'
import { melodyToScore, playbackInstrument } from '@/lib/buildScore'
import { melodyDurationSec, withCountIn } from '@/lib/melody'
import { useCorpus, useTranscribe, useUploadTake } from '@/lib/queries'
import { useEvalPlayer } from '@/lib/useEvalPlayer'

/**
 * The streamlined recording session: expected notes big on screen, replay and
 * record one keypress apart, a metronome under both, and a straight path to
 * the next clip without touching the list pages. Every finished take uploads,
 * lands in the fixtures tree, and is transcribed in place so a bad take is
 * visible before moving on.
 */

type FlowState =
    | { step: 'ready' }
    | { step: 'recording' }
    | { step: 'uploading' }
    | { step: 'transcribing' }
    | { step: 'done'; transcription: TranscriptionDto | null }
    | { step: 'error'; message: string }

const COUNT_IN_MEASURES = 1

export default function RecordFlowPage() {
    return (
        <Suspense>
            <RecordFlow />
        </Suspense>
    )
}

function RecordFlow() {
    const { id } = useParams<{ id: string }>()
    const searchParams = useSearchParams()
    const detail = useCorpus(id)
    const uploadTake = useUploadTake()
    const transcribe = useTranscribe()
    const { player, mode } = useEvalPlayer()

    const [currentClipId, setCurrentClipId] = useState<string | null>(searchParams.get('clip'))
    const [flow, setFlow] = useState<FlowState>({ step: 'ready' })
    const [metronomeOn, setMetronomeOn] = useState(true)
    const [progress, setProgress] = useState(0)

    const clips = detail.data?.clips
    const corpus = detail.data?.corpus
    const clip = useMemo(() => {
        if (!clips?.length) return null
        return clips.find((c) => c.id === currentClipId) ?? clips.find((c) => c.status === 'pending') ?? clips[0]
    }, [clips, currentClipId])

    const built = useMemo(() => {
        if (!clip || !corpus) return null
        const instrument = playbackInstrument(corpus.kind, corpus.instrumentId)
        const countInMelody = withCountIn(clip.melody, COUNT_IN_MEASURES)
        return {
            instrument,
            expectedScore: melodyToScore(clip.melody, instrument),
            clickScore: melodyToScore(countInMelody, instrument),
            countInSec: (COUNT_IN_MEASURES * clip.melody.beatsPerMeasure * 60) / clip.melody.bpm,
            totalSec: melodyDurationSec(countInMelody),
        }
    }, [clip, corpus])

    // Take progress bar — reads the playback clock while a take runs.
    useEffect(() => {
        if (mode !== 'recording' || !built) return
        const timer = setInterval(() => setProgress(player.midiPlayer.currentTime / built.totalSec), 100)
        return () => clearInterval(timer)
    }, [mode, built, player])

    // Keep a reference to the freshest clip for the async take-finished chain.
    const clipRef = useRef(clip)
    clipRef.current = clip

    if (detail.isPending)
        return (
            <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                <Spinner /> Loading corpus…
            </div>
        )
    if (detail.isError) return <Alert onRetry={() => detail.refetch()}>Couldn&apos;t load corpus: {String(detail.error)}</Alert>
    if (!clip || !corpus || !built)
        return <Alert>This corpus has no clips.</Alert>

    const clipIndex = clips!.findIndex((c) => c.id === clip.id)
    const nextClip = clips![clipIndex + 1] ?? null
    const remaining = clips!.filter((c) => c.status === 'pending' && c.id !== clip.id).length

    const replay = () => {
        if (mode === 'playing') {
            player.stop()
            return
        }
        void player.prepare(built.instrument).then(() => player.playScore(built.expectedScore, { metronome: metronomeOn }))
    }

    const startTake = () => {
        setFlow({ step: 'recording' })
        setProgress(0)
        void player
            .prepare(built.instrument)
            .then(() =>
                player.record(built.clickScore, {
                    countInSec: built.countInSec,
                    totalSec: built.totalSec,
                    onFinish: (take) => {
                        const takenClip = clipRef.current
                        if (!takenClip) return
                        setFlow({ step: 'uploading' })
                        uploadTake.mutate(
                            { clipId: takenClip.id, take: take.blob, trimSec: take.trimSec },
                            {
                                onSuccess: () => {
                                    setFlow({ step: 'transcribing' })
                                    transcribe.mutate(takenClip.id, {
                                        onSuccess: ({ transcription }) => setFlow({ step: 'done', transcription }),
                                        onError: (err) => setFlow({ step: 'error', message: `transcription failed: ${String(err)}` }),
                                    })
                                },
                                onError: (err) => setFlow({ step: 'error', message: `upload failed: ${String(err)}` }),
                            },
                        )
                    },
                }),
            )
            .catch((err) => setFlow({ step: 'error', message: `mic failed: ${String(err)}` }))
    }

    const cancelTake = () => {
        player.stop()
        setFlow({ step: 'ready' })
    }

    const goNext = () => {
        if (!nextClip) return
        player.stop()
        setCurrentClipId(nextClip.id)
        setFlow({ step: 'ready' })
        setProgress(0)
    }

    const doneF1 = flow.step === 'done' ? (flow.transcription?.metrics as { f1?: number } | null)?.f1 : undefined
    const inCountIn = mode === 'recording' && progress * built.totalSec < built.countInSec

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-1.5">
                    <div className="font-body text-[12px] text-on-surface-variant">
                        <Link href={`/corpora/${id}`} className="text-primary no-underline hover:underline">
                            {corpus.label}
                        </Link>{' '}
                        · recording session · {remaining} clip{remaining === 1 ? '' : 's'} left after this one
                    </div>
                    <h1 className="font-headline font-bold text-[1.5rem] leading-tight text-on-surface m-0">
                        {clip.name} <span className="text-on-surface-variant font-normal">({clipIndex + 1}/{clips!.length})</span>
                    </h1>
                    <div className="flex items-center gap-2">
                        <Chip>{clip.melody.keyLabel}</Chip>
                        <Chip>{corpus.bpm} bpm</Chip>
                        <Chip>{corpus.beatsPerMeasure}/4</Chip>
                        <Chip active={clip.status === 'recorded'}>{clip.status === 'recorded' ? 're-recording' : 'not recorded yet'}</Chip>
                    </div>
                </div>
                <Link href={`/corpora/${id}/clips/${clip.id}`} className="font-label text-[13px] text-primary no-underline hover:underline">
                    open clip page →
                </Link>
            </div>

            <Card>
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <Eyebrow>Expected notes — replay until it&apos;s in your ear, then record</Eyebrow>
                    <ToggleButton active={metronomeOn} onClick={() => setMetronomeOn((v) => !v)} disabled={mode === 'recording'}>
                        replay metronome
                    </ToggleButton>
                </div>
                <ScoreView score={built.expectedScore} />
            </Card>

            <Card className="flex flex-col gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <SecondaryButton onClick={replay} disabled={mode === 'recording'}>
                        {mode === 'playing' ? 'Stop replay' : 'Replay expected'}
                    </SecondaryButton>
                    {mode !== 'recording' && (
                        <PrimaryButton emphasis="pop" icon="mic" onClick={startTake} disabled={flow.step === 'uploading' || flow.step === 'transcribing'}>
                            {clip.status === 'recorded' ? 'Record new take' : 'Record'} (1 measure count-in)
                        </PrimaryButton>
                    )}
                    {mode === 'recording' && (
                        <PrimaryButton danger icon="square" onClick={cancelTake}>
                            Cancel take
                        </PrimaryButton>
                    )}
                    {flow.step === 'done' && nextClip && (
                        <PrimaryButton emphasis="pop" icon="arrow-right" onClick={goNext}>
                            Next clip
                        </PrimaryButton>
                    )}
                    {flow.step === 'done' && (
                        <SecondaryButton onClick={() => setFlow({ step: 'ready' })}>Redo this clip</SecondaryButton>
                    )}
                </div>

                {mode === 'recording' && (
                    <div className="flex flex-col gap-2">
                        <span className="font-label text-[12px] font-semibold text-on-surface-variant uppercase tracking-[0.1em]">
                            {inCountIn ? 'Count-in…' : 'Recording — the metronome is your grid'}
                        </span>
                        <div className="h-2 rounded-full bg-surface-container overflow-hidden">
                            <div
                                className={`h-2 rounded-full ${inCountIn ? 'bg-surface-container-highest' : 'bg-error-container'}`}
                                style={{ width: `${Math.min(100, progress * 100)}%` }}
                            />
                        </div>
                    </div>
                )}

                {flow.step === 'uploading' && (
                    <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                        <Spinner /> Saving the take into the fixtures tree…
                    </div>
                )}
                {flow.step === 'transcribing' && (
                    <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                        <Spinner /> Running the pipeline on your take…
                    </div>
                )}
                {flow.step === 'done' && (
                    <div className="flex items-center gap-3">
                        <Chip active>saved ✓</Chip>
                        <span className="font-mono text-[14px] text-on-surface">
                            note F1 {typeof doneF1 === 'number' ? doneF1.toFixed(2) : '—'}
                        </span>
                        <Link href={`/corpora/${id}/clips/${clip.id}`} className="font-label text-[12px] text-primary no-underline hover:underline">
                            inspect →
                        </Link>
                        {!nextClip && <span className="font-body text-[13px] text-on-surface-variant">That was the last clip 🎉</span>}
                    </div>
                )}
                {flow.step === 'error' && <Alert onRetry={() => setFlow({ step: 'ready' })} retryLabel="Back to ready">{flow.message}</Alert>}
            </Card>
        </div>
    )
}
