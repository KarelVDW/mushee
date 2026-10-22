'use client'

import { RecordingWaveformStore } from '@mushee/notation/lib/RecordingWaveformStore'
import type { Note, Score } from '@mushee/notation/model'
import { useRouter } from 'next/navigation'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { dismissToast, showToast } from '@/components/ui'
import { track } from '@/lib/analytics'
import { recordingSocketUrl } from '@/lib/api'
import {
    isIPhone,
    markMicModeGuideConfirmed,
    markMicModeReminded,
    needsMicModeGuide,
    snoozeMicModeGuide,
    takeMicModeReminder,
} from '@/lib/micMode'
import { Microphone } from '@/lib/Microphone'
import { useBillingState, useRefreshBillingState } from '@/lib/queries'
import type { RecordingState } from '@/lib/RecordingEngine'
import { RecordingTake } from '@/lib/RecordingTake'
import type { RecordingLimitInfo } from '@/lib/TranscriptionSocket'
import type { Transport } from '@/lib/Transport'

import { MicFailure, type RecordingStatus, RecordingStripCopy, TakeSummaryCopy } from './RecordingCopy'
import type { ScoreManipulator } from './ScoreManipulator'

/** Why the recording was cut short (or refused, or couldn't hear) — drives which dialog shows. */
export type RecordingHalt = { kind: 'limit'; info: RecordingLimitInfo } | { kind: 'concurrent' } | { kind: 'mic-blocked' }

/** How long the after-take summary stays (it pauses while hovered or focused). */
const SUMMARY_MS = 10_000
/** How long "Notes are back." stays in the strip once transcription recovers. */
const RECOVERED_MS = 3000
/** Waveform samples quieter than this are silence: no bar, so a pause never draws a dotted rule through the staff. */
const SILENCE_AMP = 0.05

/** How a take ended — what follows it once it has drained. */
type TakeEnd = 'stopped' | 'refused' | 'limit' | 'connection-lost'

/**
 * The recording flow: owns the live waveform store, the recording state and the recording
 * strip's status, the halt-dialog state, and the record toggle that drives a take end to end —
 * where it starts (the selected note's bar, or after the music), the WS session, transcription
 * updates, and what follows it: the bar after the take quietly selected, a summary that names
 * the next step, or — when it never got going — the score and selection exactly as they were.
 * News during a take goes to the strip; toasts only ever follow a stopped take.
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
    playFrom,
    touch,
}: {
    id: string
    manipulator: ScoreManipulator
    score: Score | null
    activeNote: Note | null
    transportRef: RefObject<Transport | null>
    playbackCursorRef: RefObject<SVGRectElement | null>
    stopAll: () => void
    saveToApi: (changes: { title?: string; score?: Score }) => void
    /** Play from a note — the summary's "Hear it back". */
    playFrom: (note: Note | null) => void
    /** A phone: "Tap", not "Click". */
    touch: boolean
}) {
    const router = useRouter()
    // Live waveform bars: an external store so 30Hz mic samples re-render only
    // the waveform layer inside the score SVG, never this page.
    const [waveformStore] = useState(() => new RecordingWaveformStore())
    const [recordingState, setRecordingState] = useState<RecordingState>('idle')
    const [status, setStatus] = useState<RecordingStatus | null>(null)
    const [recordingHalt, setRecordingHalt] = useState<RecordingHalt | null>(null)
    const dismissRecordingHalt = useCallback(() => setRecordingHalt(null), [])
    const [micModeGuideOpen, setMicModeGuideOpen] = useState(false)
    // The take started by confirming the guide skips the count-in reminder — the
    // user just read the full walkthrough.
    const skipMicModeReminder = useRef(false)
    // Held open for the guide dialog's lifetime so Control Center shows the
    // Mic Mode tile; the pending flag spans the permission prompt, where the
    // dialog isn't open yet to block a re-toggle.
    const micWarmup = useRef<MediaStream | null>(null)
    const micWarmupPending = useRef(false)
    // The after-take summary's retirement: it goes (and stops listening for the next edit) when
    // the next take starts or the page goes — its Undo must never reach past its own take, nor
    // edit a score no longer on screen (the app-wide Toaster outlives the page).
    const retireSummary = useRef<(() => void) | null>(null)
    const recoveredTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const { data: billing } = useBillingState()
    const refreshBilling = useRefreshBillingState()

    const releaseMicWarmup = useCallback(() => {
        if (micWarmup.current) Microphone.release(micWarmup.current)
        micWarmup.current = null
    }, [])

    // Navigating away with the guide open must not leave the mic indicator lit.
    useEffect(() => releaseMicWarmup, [releaseMicWarmup])
    useEffect(
        () => () => {
            retireSummary.current?.()
            if (recoveredTimer.current) clearTimeout(recoveredTimer.current)
        },
        [],
    )

    /** A microphone that wouldn't open: the blocked-mic dialog, or a toast saying what to try. */
    const reportMicFailure = useCallback((err: unknown) => {
        const problem = MicFailure.problemFor(err)
        if (problem.kind === 'blocked') setRecordingHalt({ kind: 'mic-blocked' })
        else showToast(problem.message)
    }, [])

    /**
     * The after-take summary, once the take has drained: what was added and the next step, with
     * a way to hear it back and to undo it (with no notes, only the undo). Undo takes the whole
     * take back in one step — the history folds a take into one. Showing it teaches what the
     * dock's first-selection hint would have; the next edit retires it, so its actions only ever
     * mean this take.
     */
    const summarize = useCallback(
        (take: RecordingTake) => {
            const measures = take.measures
            const first = measures[0]
            const last = measures[measures.length - 1]
            if (!first || !last) return
            const copy = new TakeSummaryCopy({
                firstBar: first.index + 1,
                lastBar: last.index + 1,
                wrotePitchedNotes: take.wrotePitchedNotes,
                touch,
                iPhone: isIPhone(),
            })
            manipulator.announce(copy.announcement)
            manipulator.moveNoteHint.markSeen()
            retireSummary.current?.()
            const undo = { label: 'Undo', ariaLabel: 'Undo this recording', onClick: () => manipulator.undo() }
            const actions = take.wrotePitchedNotes ? [{ label: 'Hear it back', onClick: () => playFrom(first.firstNote) }, undo] : [undo]
            const toast = showToast(copy.toast, 'info', { duration: SUMMARY_MS, actions })
            const edits = manipulator.editCount
            const retire = () => {
                unsubscribe()
                dismissToast(toast)
                if (retireSummary.current === retire) retireSummary.current = null
            }
            const unsubscribe = manipulator.subscribe(() => {
                if (manipulator.editCount !== edits) retire()
            })
            retireSummary.current = retire
        },
        [manipulator, playFrom, touch],
    )

    const handleRecordToggle = useCallback(async () => {
        const transport = transportRef.current
        if (!transport) return

        // A running take stops — the record button is its stop while it runs.
        if (transport.isRecording) {
            stopAll()
            return
        }
        if (!score) return

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
                reportMicFailure(err)
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
        // With a note selected the take records into its bar; with nothing selected — or only the
        // editor's opening selection, on a score just opened — it carries on after the music
        // (see ScoreManipulator.recordingStartNote and RecordingTake.startingAt).
        const before = activeNote
        const beforeWasInitial = manipulator.selectionIsInitial
        const take = RecordingTake.startingAt(score, manipulator.recordingStartNote)
        if (!take) return

        // Stop any ongoing playback before beginning a recording session.
        stopAll()
        retireSummary.current?.()

        let end: TakeEnd = 'stopped'
        let started = false
        let drained = false
        // The take writes into the score from here until its socket has drained the
        // last transcription updates — history travel stays locked for all of it.
        const releaseHistory = manipulator.lockHistory()

        /**
         * The take never got going (or was cut off before it wrote a note): put the score and the
         * selection back — the selection only while no newer take has started meanwhile.
         */
        const abandon = () => {
            if (take.discardIfEmpty()) saveToApi({ score })
            if (!transport.isRecording) {
                manipulator.select(before?.isAttached ? before : null, { quiet: true, initial: beforeWasInitial })
            }
        }
        /** The bar after the take, quietly selected — Record, the dock and the phone's nudges work at once. */
        const carryOn = () => {
            const next = take.noteAfter()
            saveToApi({ score })
            if (next && !manipulator.selectedNote) manipulator.select(next, { quiet: true })
        }
        /** Once nothing more can reach the score: what follows this take. */
        const finish = () => {
            void refreshBilling()
            if (end === 'connection-lost') {
                showToast('The connection dropped, so recording stopped. Your notes so far are saved — press record to carry on.')
            }
            // Refused, or cut off (limit, a dropped connection) before a single note: nothing to keep.
            if (end === 'refused' || (end !== 'stopped' && !take.wrotePitchedNotes)) return abandon()
            // Record was pressed again before this take finished draining: the new take owns the
            // selection and the strip now, so this one only leaves its notes behind.
            if (transport.isRecording) return
            carryOn()
            if (end === 'stopped') summarize(take)
        }

        manipulator.select(null)
        waveformStore.reset()
        take.begin()
        saveToApi({ score })
        const credits = billing?.credits
        const reminder = skipMicModeReminder.current ? false : takeMicModeReminder()
        skipMicModeReminder.current = false
        setStatus({
            phase: 'countoff',
            countoff: null,
            captureStartedAt: null,
            health: 'ok',
            micModeReminder: reminder,
            secondsLeftAtStart: credits && credits.remainingSeconds !== null ? credits.remainingSeconds + credits.packSeconds : null,
            startBar: take.startIndex + 1,
        })

        let mic: MediaTrackSettings | null
        try {
            mic = await transport.record({
                score,
                startMeasureIndex: take.startIndex,
                cursorEl,
                wsUrl: recordingSocketUrl(id),
                onStateChange: (state) => {
                    setRecordingState(state)
                    if (state === 'countoff') manipulator.announce(RecordingStripCopy.countInAnnouncement(take.startIndex + 1))
                    if (state === 'idle') {
                        setStatus(null)
                        // The take ended: whatever bars are still waiting for their
                        // notes animate out together.
                        waveformStore.clearAll()
                    }
                },
                onCountoffBeat: (beat, total) => setStatus((s) => (s ? { ...s, countoff: { beat, total } } : s)),
                onCaptureStart: () => {
                    manipulator.announce('Recording')
                    setStatus((s) => (s ? { ...s, phase: 'recording', captureStartedAt: performance.now() } : s))
                },
                onDrained: () => {
                    releaseHistory()
                    drained = true
                    if (started) finish()
                },
                onHealth: ({ ok }) => {
                    // The server's transcription backend went away (or came back). Say so in the
                    // strip: waveform bars with no notes must read as "Solkey is having trouble",
                    // not "I sang it wrong" — and the time is not charged meanwhile.
                    if (recoveredTimer.current) clearTimeout(recoveredTimer.current)
                    setStatus((s) => (s && (!ok || s.health === 'down') ? { ...s, health: ok ? 'back' : 'down' } : s))
                    if (ok) {
                        recoveredTimer.current = setTimeout(
                            () => setStatus((s) => (s?.health === 'back' ? { ...s, health: 'ok' } : s)),
                            RECOVERED_MS,
                        )
                    }
                },
                onSample: (sample) => {
                    if (sample.amp < SILENCE_AMP) return
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
                // The halts show their dialog alone — no toast beside it.
                onLimitReached: (info) => {
                    end = 'limit'
                    stopAll()
                    setRecordingHalt({ kind: 'limit', info })
                },
                onConnectionLost: () => {
                    end = 'connection-lost'
                    stopAll()
                },
                onRecordingError: (code) => {
                    end = 'refused'
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
            stopAll()
            releaseHistory()
            setStatus(null)
            abandon()
            reportMicFailure(err)
            return
        }
        // Stopped while the permission prompt was still open (it drained before it ever counted
        // in): the take never ran.
        if (drained || !transport.isRecording) {
            releaseHistory()
            setStatus(null)
            abandon()
            return
        }
        started = true

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
    }, [
        manipulator,
        score,
        activeNote,
        stopAll,
        saveToApi,
        id,
        router,
        waveformStore,
        transportRef,
        playbackCursorRef,
        billing,
        refreshBilling,
        reportMicFailure,
        summarize,
    ])

    /** The guide's confirm button: persist the attestation, start the take.
     *  The warm-up stream is released first — the take re-acquires the mic
     *  with the real constraints, and iOS keeps the Mic Mode choice per app. */
    const confirmMicModeGuide = useCallback(() => {
        track('mic_mode_guide_confirmed')
        markMicModeGuideConfirmed()
        markMicModeReminded()
        releaseMicWarmup()
        setMicModeGuideOpen(false)
        skipMicModeReminder.current = true
        void handleRecordToggle()
    }, [handleRecordToggle, releaseMicWarmup])

    /** "Record without it": no attestation, the guide stays away for this visit, the take starts. */
    const skipMicModeGuide = useCallback(() => {
        track('mic_mode_guide_skipped')
        snoozeMicModeGuide()
        releaseMicWarmup()
        setMicModeGuideOpen(false)
        void handleRecordToggle()
    }, [handleRecordToggle, releaseMicWarmup])

    /** The Record button: stop a running take, or start one (at the selected note, or after the music). */
    const toggleRecording = useCallback(() => void handleRecordToggle(), [handleRecordToggle])

    // Where pressing Record now would start, 1-based — named by the Record button's tooltip, from
    // the same note the take reads (ScoreManipulator.recordingStartNote), so the two agree.
    const startIndex = score ? RecordingTake.startIndexFor(score, manipulator.recordingStartNote) : null
    const recordFromBar = startIndex === null ? null : startIndex + 1

    /** The blocked-mic dialog's "Try again": close it and press Record again. */
    const retryRecording = useCallback(() => {
        setRecordingHalt(null)
        void handleRecordToggle()
    }, [handleRecordToggle])

    /** Backing out (Escape / scrim / ✕): no take, and the guide returns next time. */
    const dismissMicModeGuide = useCallback(() => {
        releaseMicWarmup()
        setMicModeGuideOpen(false)
    }, [releaseMicWarmup])

    return {
        waveformStore,
        recordingState,
        recordingStatus: status,
        recordingHalt,
        dismissRecordingHalt,
        toggleRecording,
        recordFromBar,
        retryRecording,
        micModeGuideOpen,
        confirmMicModeGuide,
        skipMicModeGuide,
        dismissMicModeGuide,
    }
}
