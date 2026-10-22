'use client'

import { Icon, TransportBtn } from '@/components/ui'
import type { RecordingState } from '@/lib/RecordingEngine'
import type { PlaybackState } from '@/lib/Transport'

// --- Transport (lives in the editor header on desktop, the dock's action row on phones) ---

export interface TransportControlsProps {
    playbackState: PlaybackState
    onPlayToggle: () => void
    onStop: () => void
    recordingState: RecordingState
    onRecordToggle: () => void
    /** Record can't start: there is no selected note to record into. A running take always stays stoppable. */
    recordDisabled?: boolean
    metronome: boolean
    onMetronomeToggle: () => void
    /** Thumb-sized buttons with the record button as the biggest of the set (the mobile dock). */
    large?: boolean
    /** The mobile dock hides the metronome here and hosts it in the tool strip instead. */
    showMetronome?: boolean
}

export function TransportControls({
    playbackState,
    onPlayToggle,
    onStop,
    recordingState,
    onRecordToggle,
    recordDisabled = false,
    metronome,
    onMetronomeToggle,
    large = false,
    showMetronome = true,
}: TransportControlsProps) {
    const isRecording = recordingState !== 'idle'
    const isPlaying = playbackState === 'playing'
    const canStop = playbackState !== 'stopped' || isRecording

    return (
        <div className={`flex items-center shrink-0 ${large ? 'gap-2' : 'gap-2.5'}`}>
            <TransportBtn size={large ? 36 : 30} onClick={onStop} ariaLabel="Stop" disabled={!canStop}>
                <Icon name="square" size={large ? 14 : 12} />
            </TransportBtn>
            <TransportBtn
                size={large ? 46 : 40}
                tone="play"
                active={isPlaying}
                onClick={onPlayToggle}
                ariaLabel={isPlaying ? 'Pause' : 'Play'}
                disabled={isRecording}>
                <Icon name={isPlaying ? 'pause' : 'play'} size={large ? 20 : 18} />
            </TransportBtn>
            <TransportBtn
                size={large ? 54 : 40}
                tone="record"
                active={isRecording}
                onClick={onRecordToggle}
                ariaLabel="Record"
                disabled={recordDisabled}
            />
            {showMetronome && (
                <TransportBtn size={large ? 36 : 30} active={metronome} onClick={onMetronomeToggle} ariaLabel="Metronome">
                    <Icon name="audio-lines" size={large ? 14 : 12} />
                </TransportBtn>
            )}
        </div>
    )
}

// --- Mobile action row (bottom of the dock): note navigation, pitch nudges, transport ---

interface MobileEditorActionsProps {
    transport: TransportControlsProps
    onPrevious: () => void
    onNext: () => void
    onPitchUp: () => void
    onPitchDown: () => void
    /** No note selected (nothing to navigate from or nudge). */
    disabled: boolean
}

/**
 * Touch replaces the keyboard: arrows become the note navigator, ArrowUp/Down become
 * pitch nudges, and the transport moves down here where thumbs live. The record button
 * stays the biggest, loudest control on the screen. Selection-scoped actions (copy /
 * delete / select all) are NOT buttons here — they live in the score's selection
 * popover, opened by long-press / double-tap / drag-release.
 */
export function MobileEditorActions({ transport, onPrevious, onNext, onPitchUp, onPitchDown, disabled }: MobileEditorActionsProps) {
    return (
        <div role="group" aria-label="Note navigation and transport" className="flex items-center justify-between gap-1.5 pt-2">
            <div className="flex items-center gap-1">
                <TransportBtn size={36} onClick={onPrevious} ariaLabel="Select previous note" disabled={disabled}>
                    <Icon name="chevron-left" size={18} />
                </TransportBtn>
                <TransportBtn size={36} onClick={onNext} ariaLabel="Select next note" disabled={disabled}>
                    <Icon name="chevron-right" size={18} />
                </TransportBtn>
            </div>
            <div className="flex items-center gap-1">
                <TransportBtn size={36} onClick={onPitchDown} ariaLabel="Lower pitch" disabled={disabled}>
                    <Icon name="chevron-down" size={18} />
                </TransportBtn>
                <TransportBtn size={36} onClick={onPitchUp} ariaLabel="Raise pitch" disabled={disabled}>
                    <Icon name="chevron-up" size={18} />
                </TransportBtn>
            </div>
            <TransportControls {...transport} large showMetronome={false} />
        </div>
    )
}
