'use client'

import { RecordingWaveformStore } from '@mushee/notation/lib/RecordingWaveformStore'
import type { Note, Score } from '@mushee/notation/model'
import { useRouter } from 'next/navigation'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { showToast } from '@/components/ui'
import { track } from '@/lib/analytics'
import { recordingSocketUrl } from '@/lib/api'
import { markMicModeGuideConfirmed, needsMicModeGuide, needsMicModeReminder } from '@/lib/micMode'
import { Microphone, RecordingUnsupportedError } from '@/lib/Microphone'
import type { RecordingState } from '@/lib/RecordingEngine'
import { RecordingTake } from '@/lib/RecordingTake'
import type { RecordingLimitInfo } from '@/lib/TranscriptionSocket'
import type { Transport } from '@/lib/Transport'

import type { ScoreManipulator } from './ScoreManipulator'

// Why the recording was cut short (or refused) — drives which dialog shows.
type RecordingHalt = { kind: 'limit'; info: RecordingLimitInfo } | { kind: 'concurrent' }

/** Pick the toast for a mic that couldn't be opened — shared by the real take
 *  and the Mic Mode guide's warm-up stream. */
function micErrorToast(err: unknown): string {
    if (err instanceof RecordingUnsupportedError) {
        return "This browser can't record audio. Use a recent Chrome, Edge, Firefox, or Safari over HTTPS."
    }
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        return 'Microphone access was blocked. Allow the microphone for this site, then try again.'
    }
    return "Recording couldn't start. Check your microphone permission and connection, then try again."
}

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
    const [recordingHalt, setRecordingHalt] = useState<RecordingHalt | null>(null)
    const dismissRecordingHalt = useCallback(() => setRecordingHalt(null), [])
    const [micModeGuideOpen, setMicModeGuideOpen] = useState(false)
    // The take started by confirming the guide skips the reminder toast — the
    // user just read the full walkthrough.
    const skipMicModeReminder = useRef(false)
    // Held open for the guide dialog's lifetime so Control Center shows the
    // Mic Mode tile; the pending flag spans the permission prompt, where the
    // dialog isn't open yet to block a re-toggle.
    const micWarmup = useRef<MediaStream | null>(null)
    const micWarmupPending = useRef(false)

    const releaseMicWarmup = useCallback(() => {
        if (micWarmup.current) Microphone.release(micWarmup.current)
        micWarmup.current = null
    }, [])

    // Navigating away with the guide open must not leave the mic indicator lit.
    useEffect(() => releaseMicWarmup, [releaseMicWarmup])

    const handleRecordToggle = useCallback(async () => {
        const transport = transportRef.current
        if (!transport) return

        // Stopping comes first: a take clears the selection as it starts, so a selection
        // guard ahead of this would leave a running take unstoppable from its own button.
        if (transport.isRecording) {
            stopAll()
            return
        }
        // Starting needs a note to record into (the button is disabled without one).
        if (!score || !activeNote) return

        // iPhones filter the mic for speech; the fix is a user-only Control
        // Center setting (src/lib/micMode.ts). First take on the device blocks
        // on the walkthrough dialog — confirming it restarts this toggle. The
        // Mic Mode tile only exists in Control Center while capture is live,
        // so the mic opens first (raising the permission prompt) and stays
        // open for as long as the dialog is up.
        if (needsMicModeGuide()) {
            if (micWarmupPending.current || micWarmup.current) return
            micWarmupPending.current = true
            try {
                micWarmup.current = await Microphone.open({ audio: true })
            } catch (err) {
                console.error('Mic warm-up for the Mic Mode guide failed', err)
                showToast(micErrorToast(err))
                return
            } finally {
                micWarmupPending.current = false
            }
            track('mic_mode_guide_shown')
            setMicModeGuideOpen(true)
            return
        }

        const cursorEl = playbackCursorRef.current
        if (!cursorEl) return

        // Stop any ongoing playback before beginning a recording session.
        stopAll()

        // The take records into the cursor's measure and clef (see RecordingTake).
        const take = new RecordingTake(score, activeNote.measure.index, activeNote.clef)
        let transcriptionDown = false
        // The take writes into the score from here until its socket has drained the
        // last transcription updates — history travel stays locked for all of it.
        const releaseHistory = manipulator.lockHistory()
        manipulator.select(null)
        waveformStore.reset()
        take.begin()
        saveToApi({ score })

        let mic: MediaTrackSettings | null
        try {
            mic = await transport.record({
                score,
                startMeasureIndex: take.startIndex,
                cursorEl,
                wsUrl: recordingSocketUrl(id),
                onStateChange: (state) => {
                    setRecordingState(state)
                    // The take ended: whatever bars are still waiting for their
                    // notes animate out together.
                    if (state === 'idle') waveformStore.clearAll()
                },
                onDrained: releaseHistory,
                onHealth: ({ ok }) => {
                    // The server's transcription backend went away (or came back). Say so:
                    // waveform bars with no notes must read as "Solkey is having trouble",
                    // not "I sang it wrong" — and the time is not charged meanwhile.
                    if (!ok) {
                        transcriptionDown = true
                        showToast(
                            "Transcription is unavailable right now. We're still recording your audio and not charging for this time, but no notes will appear until it recovers.",
                        )
                    } else if (transcriptionDown) {
                        transcriptionDown = false
                        showToast('Transcription is back — notes are appearing again.', 'info')
                    }
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
                    take.appendMeasure()
                    saveToApi({ score })
                },
                onScoreUpdate: ({ measures }) => {
                    // The staff now shows real notes over these stretches — their
                    // waveform bars have done their job and can animate out.
                    for (const { measureIndex, coveredBeats } of take.applyUpdate(measures)) {
                        waveformStore.clearCovered(measureIndex, coveredBeats)
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
            showToast(micErrorToast(err))
            stopAll()
            releaseHistory()
            return
        }

        // Carry what the browser actually honored for the mic: the constraints
        // request raw audio, but devices that force voice processing back on are
        // the ones that switch into a call-style route and duck the metronome
        // (Android communication mode, iOS play-and-record) — this measures how
        // common that is before we engineer around it further.
        track('recording_started', {
            micEchoCancellation: mic?.echoCancellation ?? null,
            micNoiseSuppression: mic?.noiseSuppression ?? null,
            micAutoGainControl: mic?.autoGainControl ?? null,
            micSampleRate: mic?.sampleRate ?? null,
        })

        // The take is running — remind returning iPhone users to keep the
        // Mic Mode setting right, while the count-off gives them a moment.
        if (needsMicModeReminder() && !skipMicModeReminder.current) {
            showToast('Recording on iPhone: keep Mic Mode on Wide Spectrum (Control Center) so every note comes through.', 'info', 'mic')
        }
        skipMicModeReminder.current = false
    }, [manipulator, score, activeNote, stopAll, saveToApi, id, router, waveformStore, transportRef, playbackCursorRef])

    /** The guide's confirm button: persist the attestation, start the take.
     *  The warm-up stream is released first — the take re-acquires the mic
     *  with the real constraints, and iOS keeps the Mic Mode choice per app. */
    const confirmMicModeGuide = useCallback(() => {
        track('mic_mode_guide_confirmed')
        markMicModeGuideConfirmed()
        releaseMicWarmup()
        setMicModeGuideOpen(false)
        skipMicModeReminder.current = true
        void handleRecordToggle()
    }, [handleRecordToggle, releaseMicWarmup])

    /** Backing out (Escape / scrim / ✕): no take, and the guide returns next time. */
    const dismissMicModeGuide = useCallback(() => {
        releaseMicWarmup()
        setMicModeGuideOpen(false)
    }, [releaseMicWarmup])

    return {
        waveformStore,
        recordingState,
        recordingHalt,
        dismissRecordingHalt,
        handleRecordToggle,
        micModeGuideOpen,
        confirmMicModeGuide,
        dismissMicModeGuide,
    }
}
