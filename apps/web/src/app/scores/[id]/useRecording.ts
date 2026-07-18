'use client'

import { useRouter } from 'next/navigation'
import { type RefObject, useCallback, useState } from 'react'

import { showToast } from '@/components/ui'
import { track } from '@/lib/analytics'
import { type RecordingLimitInfo, type RecordingState, RecordingUnsupportedError } from '@/lib/RecordingEngine'
import { RecordingWaveformStore } from '@/lib/RecordingWaveformStore'
import type { Transport } from '@/lib/Transport'
import type { Note, Score } from '@/model'
import { ScoreDeserializer } from '@/model/util/ScoreDeserializer'

import type { ScoreManipulator } from './ScoreManipulator'

// Why the recording was cut short (or refused) — drives which dialog shows.
export type RecordingHalt = { kind: 'limit'; info: RecordingLimitInfo } | { kind: 'concurrent' } | null

/**
 * The recording flow: owns the live waveform store, the recording state, the
 * halt-dialog state, and the record toggle that drives a take end-to-end
 * (measure setup, WS session, transcription updates, error handling).
 */
export function useRecording({
    id,
    manipulator,
    score,
    activeNote,
    transportRef,
    playbackCursorRef,
    stopAll,
    saveToApi,
}: {
    id: string
    manipulator: ScoreManipulator
    score: Score | null
    activeNote: Note | null
    transportRef: RefObject<Transport | null>
    playbackCursorRef: RefObject<SVGRectElement | null>
    stopAll: () => void
    saveToApi: (changes: { title?: string; score?: Score }) => void
}) {
    const router = useRouter()
    // Live waveform bars: an external store so 30Hz mic samples re-render only
    // the waveform layer inside the score SVG, never this page.
    const [waveformStore] = useState(() => new RecordingWaveformStore())
    const [recordingState, setRecordingState] = useState<RecordingState>('idle')
    const [recordingHalt, setRecordingHalt] = useState<RecordingHalt>(null)

    const handleRecordToggle = useCallback(async () => {
        if (!score || !activeNote) return
        const transport = transportRef.current
        if (!transport) return

        if (transport.isRecording) {
            stopAll()
            return
        }

        const cursorEl = playbackCursorRef.current
        if (!cursorEl) return

        // Stop any ongoing playback before beginning a recording session.
        stopAll()

        let measureIndex = activeNote.measure.index
        // The clef the take records into: transcribed notes are octave-normalized
        // onto its staff. Decided once, from the first update's notes, then locked
        // for the take — emitted measures are frozen, so re-deciding would leave
        // earlier measures an octave apart.
        const recordingClef = activeNote.clef
        let octaveShift: number | null = null
        manipulator.select(null)
        waveformStore.reset()
        const startIndex = measureIndex
        // The take's first measure displaces the cursor's measure and adopts its
        // tempo marking, so the count-off and click run at the bpm the cursor sat in.
        score.addMeasureAdoptingTempo(measureIndex++).complete()
        saveToApi({ score })

        const resolvePosition = (measureIndex: number, beat: number) => {
            const measure = score.measures[measureIndex]
            if (!measure) return null
            const row = score.layout.rowFor(measure)
            const measureX = row.getMeasureX(measure)
            return { x: measureX + measure.layout.getXForBeat(beat), rowY: score.layout.getYForRow(row) }
        }

        // Every recording belongs to a score; the gateway requires the id up front.
        const wsUrl =
            (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4200').replace(/^http/, 'ws') +
            `/recording?scoreId=${encodeURIComponent(id)}`

        try {
            await transport.record({
                score,
                startMeasureIndex: startIndex,
                cursorEl,
                resolvePosition,
                wsUrl,
                onStateChange: (state) => {
                    setRecordingState(state)
                    // The take ended: whatever bars are still waiting for their
                    // notes animate out together.
                    if (state === 'idle') waveformStore.clearAll()
                },
                onSample: (sample) => {
                    waveformStore.add({
                        id: sample.timeMs,
                        measureIndex: sample.measureIndex,
                        beat: sample.beat,
                        amp: sample.amp,
                    })
                },
                onNeedNewMeasure: () => {
                    score.addMeasure(measureIndex++).complete()
                    saveToApi({ score })
                },
                onScoreUpdate: ({ measures }) => {
                    for (const [key, mxmlMeasure] of Object.entries(measures)) {
                        const absIndex = startIndex + Number(key)
                        const measure = score.measures[absIndex]
                        if (!measure?.firstNote) continue
                        let notes = ScoreDeserializer.mxmlMeasureToNotes(mxmlMeasure)
                        if (!notes.length) continue
                        // Recorded audio's absolute octave is arbitrary relative to
                        // the staff (whistling sits 1-2 octaves up); pull the take
                        // onto the clef the user is writing in.
                        if (octaveShift === null) {
                            const pitches = notes.flatMap((n) => (n.pitch ? [n.pitch] : []))
                            if (pitches.length) octaveShift = recordingClef.octavesToCenter(pitches)
                        }
                        if (octaveShift) {
                            const shift = octaveShift
                            notes = notes.map((n) => (n.pitch ? n.clone({ pitch: n.pitch.octaveShifted(shift) }) : n))
                        }
                        score.replace([measure.firstNote], notes)
                        // The staff now shows real notes up to the end of the last
                        // pitched note in this measure — their waveform bars have
                        // done their job and can animate out.
                        let beat = 0
                        let coveredBeats = 0
                        for (const note of notes) {
                            const span = note.duration.effectiveBeats
                            if (!note.isRest) coveredBeats = beat + span
                            beat += span
                        }
                        if (coveredBeats > 0) waveformStore.clearCovered(absIndex, coveredBeats)
                    }
                    saveToApi({ score })
                },
                onLimitReached: (info) => {
                    stopAll()
                    setRecordingHalt({ kind: 'limit', info })
                },
                onConnectionLost: () => {
                    stopAll()
                    showToast('The recording connection was lost. Notes transcribed so far are kept — try recording again.')
                },
                onRecordingError: (code) => {
                    stopAll()
                    if (code === 'concurrent-recording') setRecordingHalt({ kind: 'concurrent' })
                    // Belt-and-braces: AuthGate keeps unapproved beta users off
                    // this page, but the gateway enforces it too.
                    if (code === 'beta-pending') {
                        showToast('Your beta access is still awaiting approval.')
                        router.push('/beta')
                    }
                },
            })
        } catch (err) {
            console.error('Recording failed to start', err)
            if (err instanceof RecordingUnsupportedError) {
                showToast("This browser can't record audio. Use a recent Chrome, Edge, Firefox, or Safari over HTTPS.")
            } else if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
                showToast('Microphone access was blocked. Allow the microphone for this site, then try again.')
            } else {
                showToast("Recording couldn't start. Check your microphone permission and connection, then try again.")
            }
            stopAll()
            return
        }

        // Carry what the browser actually honored for the mic: the constraints
        // request raw audio, but devices that force voice processing back on are
        // the ones that switch into a call-style route and duck the metronome
        // (Android communication mode, iOS play-and-record) — this measures how
        // common that is before we engineer around it further.
        const mic = transport.micSettings
        track('recording_started', {
            micEchoCancellation: mic?.echoCancellation ?? null,
            micNoiseSuppression: mic?.noiseSuppression ?? null,
            micAutoGainControl: mic?.autoGainControl ?? null,
            micSampleRate: mic?.sampleRate ?? null,
        })
    }, [manipulator, score, activeNote, stopAll, saveToApi, id, router, waveformStore, transportRef, playbackCursorRef])

    return { waveformStore, recordingState, recordingHalt, setRecordingHalt, handleRecordToggle }
}
