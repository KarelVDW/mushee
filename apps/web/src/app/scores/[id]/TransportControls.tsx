'use client'

import type { ReactNode } from 'react'

import { Icon, ToolGroup, type TooltipShortcut, TransportBtn } from '@/components/ui'
import type { RecordingState } from '@/lib/RecordingEngine'
import type { PlaybackState } from '@/lib/Transport'
import { useMediaQuery } from '@/lib/useMediaQuery'

// --- Transport (lives in the editor header on desktop, the dock's action row on phones) ---

/** The live keys the transport's tooltips name (from the editor's Keybindings, so a rebound key shows). */
export interface TransportShortcuts {
    /** Space: play / pause, and stop a running take. */
    playPause: TooltipShortcut
    /** ⇧R by default: start a take. */
    record: TooltipShortcut
}

export interface TransportControlsProps {
    playbackState: PlaybackState
    onPlayToggle: () => void
    onStop: () => void
    recordingState: RecordingState
    onRecordToggle: () => void
    /**
     * Record can't start at all (no microphone, or the day's recording is spent). Never set for
     * a missing selection: with nothing selected a take carries on after the music. A running
     * take always stays stoppable.
     */
    recordDisabled?: boolean
    metronome: boolean
    onMetronomeToggle: () => void
    /** Thumb-sized buttons with the record button as the biggest of the set (the mobile dock). */
    large?: boolean
    /** The mobile dock hides the metronome here and hosts it in the More sheet instead. */
    showMetronome?: boolean
    shortcuts?: TransportShortcuts
}

/** Finds the record button (idle or as the stop) inside a container — where the page hands focus when a take swaps the phone dock. */
export const RECORD_BUTTON_SELECTOR = '[data-record-button] button'

/**
 * Record, and while a take runs (count-in and recording alike) the same button as Stop: the
 * white dot crossfades into a white stop square and the button's name follows ('Record' ↔
 * 'Stop recording'), so the state is never colour alone.
 */
export function RecordButton({
    recordingState,
    onRecordToggle,
    recordDisabled = false,
    large = false,
    shortcuts,
}: Pick<TransportControlsProps, 'recordingState' | 'onRecordToggle' | 'recordDisabled' | 'large' | 'shortcuts'>) {
    const live = recordingState !== 'idle'
    return (
        <span data-record-button className="contents">
            <TransportBtn
                size={large ? 54 : 48}
                tone="record"
                active={live}
                onClick={onRecordToggle}
                ariaLabel={live ? 'Stop recording' : 'Record'}
                tooltip={live ? 'Stop recording' : 'Record a melody'}
                shortcut={live ? shortcuts?.playPause : shortcuts?.record}
                tooltipSide={large ? 'top' : 'bottom'}
                disabled={!live && recordDisabled}
            />
        </span>
    )
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
    shortcuts,
}: TransportControlsProps) {
    const isRecording = recordingState !== 'idle'
    const isPlaying = playbackState === 'playing'
    // Stop keeps its slot (the centred transport never shifts) but only shows while something
    // plays or records — at rest there is nothing to stop.
    const canStop = playbackState !== 'stopped' || isRecording
    const side = large ? 'top' : 'bottom'

    return (
        <div className={`flex items-center shrink-0 ${large ? 'gap-1.5' : 'gap-2.5'}`}>
            <span
                className={[
                    'inline-flex transition-[opacity,visibility] duration-150 ease-solkey motion-reduce:transition-none',
                    canStop ? 'visible opacity-100' : 'invisible opacity-0',
                ].join(' ')}>
                <TransportBtn
                    size={large ? 40 : 36}
                    onClick={onStop}
                    ariaLabel="Stop"
                    tooltip="Stop"
                    tooltipSide={side}
                    disabled={!canStop}>
                    <Icon name="square" size={14} />
                </TransportBtn>
            </span>
            <TransportBtn
                size={large ? 46 : 40}
                tone="play"
                active={isPlaying}
                onClick={onPlayToggle}
                ariaLabel={isPlaying ? 'Pause' : 'Play'}
                tooltip={isPlaying ? 'Pause' : 'Hear it back'}
                shortcut={shortcuts?.playPause}
                tooltipSide={side}
                disabled={isRecording}>
                <Icon name={isPlaying ? 'pause' : 'play'} size={large ? 20 : 18} />
            </TransportBtn>
            <RecordButton
                recordingState={recordingState}
                onRecordToggle={onRecordToggle}
                recordDisabled={recordDisabled}
                large={large}
                shortcuts={shortcuts}
            />
            {showMetronome && (
                <TransportBtn
                    size={36}
                    pressed={metronome}
                    onClick={onMetronomeToggle}
                    ariaLabel="Metronome"
                    tooltip="Metronome"
                    hint="clicks during playback"
                    description="Clicks during playback. Recording always counts you in."
                    tooltipSide={side}>
                    <Icon name="metronome" size={16} />
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

/** One labelled pair of the phone's note controls: the white well, its two buttons, and an 11px caption under it. */
function LabelledWell({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-0.5">
            <ToolGroup ariaLabel={label}>{children}</ToolGroup>
            <span aria-hidden className="font-label font-semibold text-[11px] leading-none text-on-surface-variant">
                {label}
            </span>
        </div>
    )
}

/**
 * Touch replaces the keyboard: arrows become the note navigator, ArrowUp/Down become
 * pitch nudges, and the transport moves down here where thumbs live. The two pairs sit in
 * their own labelled wells ('Note' ‹ ›, 'Pitch' ▼ ▲ — named 'Lower' and 'Higher', like the
 * desktop dock's nudges) so moving between notes never reads as changing one. Buttons are
 * 40px (44px from 400px wide), and the record button stays the biggest, loudest control on
 * the screen. Selection-scoped actions (copy / delete / select
 * all) are NOT buttons here — they live in the score's selection popover, opened by
 * long-press / double-tap / drag-release.
 */
export function MobileEditorActions({ transport, onPrevious, onNext, onPitchUp, onPitchDown, disabled }: MobileEditorActionsProps) {
    const roomy = useMediaQuery('(min-width: 400px)')
    const size = roomy ? 44 : 40
    return (
        <div role="group" aria-label="Note navigation and transport" className="flex items-center justify-between gap-1.5 pt-2">
            <div className="flex items-center gap-1.5">
                <LabelledWell label="Note">
                    <TransportBtn size={size} onClick={onPrevious} ariaLabel="Select previous note" disabled={disabled}>
                        <Icon name="chevron-left" size={18} />
                    </TransportBtn>
                    <TransportBtn size={size} onClick={onNext} ariaLabel="Select next note" disabled={disabled}>
                        <Icon name="chevron-right" size={18} />
                    </TransportBtn>
                </LabelledWell>
                <LabelledWell label="Pitch">
                    <TransportBtn size={size} onClick={onPitchDown} ariaLabel="Lower" disabled={disabled}>
                        <Icon name="chevron-down" size={18} />
                    </TransportBtn>
                    <TransportBtn size={size} onClick={onPitchUp} ariaLabel="Higher" disabled={disabled}>
                        <Icon name="chevron-up" size={18} />
                    </TransportBtn>
                </LabelledWell>
            </div>
            <TransportControls {...transport} large showMetronome={false} />
        </div>
    )
}
