'use client'

import { Glyph } from '@mushee/notation/components'
import { Bravura } from '@mushee/notation/engraving/Bravura'
import { TUPLET_NUMBER_SCALE } from '@mushee/notation/engraving/constants'
import { type Accidental, CLEF_DEFS, Duration, type DurationType } from '@mushee/notation/model'

import { KeyName } from '@/components/editor/KeySignaturePopover'

import { LENGTH_NEEDS_ONE_NOTE } from './commands'
import type { ScoreManipulator, ScoreSettings } from './ScoreManipulator'

/*
 * The pieces the desktop dock (NoteToolDock) and the phone's More sheet (MoreToolsSheet)
 * share: the tools' enabled / pressed / why-not rules, the score settings in words, and the
 * drawn tool glyphs.
 */

/** Why a note tool is off with nothing selected. */
export const NEEDS_A_NOTE = 'Select a note first'
/** Why Tie is off: a tie only binds into the next note at the same pitch (Score.canTieForward). */
export const TIE_NEEDS_SAME_PITCH = 'Tie needs the next note to be the same pitch.'
/** Why the clef / key / time / tempo chips are off: a recording is still writing into the score. */
export const STOP_RECORDING_FIRST = 'Stop recording to change this'

/** The note values the length picker offers, longest first. */
export const DURATION_TYPES: readonly DurationType[] = ['w', 'h', 'q', '8', '16']

// --- Tool states ---

/** How a note tool shows: pressed or not, and off — with the reason it says, when it has one. */
export interface ToolState {
    active: boolean
    disabled: boolean
    reason?: string
}

/** A picker's state: the option every selected note shares (null: none pressed — a mixed run). */
export interface PickerState<T> extends ToolState {
    value: T | null
}

/**
 * The selection-scoped note tools' state, read off the manipulator: the one place the rules
 * for what is pressed, what is off and why live, for the desktop dock and the phone's More
 * sheet alike. Pickers press only what every selected note shares; the length tools act on
 * one note at a time, so a run turns them off rather than letting them change one note.
 */
export class NoteToolStates {
    constructor(private readonly manipulator: ScoreManipulator) {}

    private get note() {
        return this.manipulator.selectedNote
    }

    /** Off with nothing selected, saying so. */
    private needsNote(): ToolState | null {
        return this.note ? null : { active: false, disabled: true, reason: NEEDS_A_NOTE }
    }

    /** The length tools' extra rule: off on a run of notes. */
    private needsOneNote(): ToolState | null {
        return (
            this.needsNote() ?? (this.manipulator.isRangeSelected ? { active: false, disabled: true, reason: LENGTH_NEEDS_ONE_NOTE } : null)
        )
    }

    get duration(): PickerState<DurationType> {
        const off = this.needsOneNote()
        // A run's lengths still show (mixed: nothing pressed), though they can't be changed from here.
        return { ...(off ?? { active: false, disabled: false }), value: this.manipulator.selectionDuration }
    }

    get dotted(): ToolState {
        const active = this.manipulator.selectionDotted
        const off = this.needsOneNote()
        if (off) return { ...off, active }
        return { active, disabled: !this.note?.duration.canDot }
    }

    get triplet(): ToolState {
        const active = this.manipulator.selectionInTuplet
        const off = this.needsOneNote()
        if (off) return { ...off, active }
        return { active, disabled: !this.note?.canToggleTuplet }
    }

    get rest(): ToolState {
        return this.needsNote() ?? { active: this.note?.isRest ?? false, disabled: false }
    }

    get tie(): ToolState {
        const active = this.note?.tiesForward ?? false
        if (this.needsNote()) return { active, disabled: true, reason: NEEDS_A_NOTE }
        return this.manipulator.canTie ? { active, disabled: false } : { active, disabled: true, reason: TIE_NEEDS_SAME_PITCH }
    }

    get accidental(): PickerState<Accidental | undefined> {
        return { ...(this.needsNote() ?? { active: false, disabled: false }), value: this.manipulator.selectionAccidental }
    }

    /** Higher / Lower and Simplify sharps and flats: anything selected will do. */
    get pitch(): ToolState {
        return this.needsNote() ?? { active: false, disabled: false }
    }

    /**
     * The clef, key, time and tempo chips: on with or without a selection (they read and
     * change bar 1 then), but off while a recording writes into the score — they still show
     * its values (ScoreManipulator.settings).
     */
    get scoreSettings(): ToolState {
        return this.manipulator.historyLocked
            ? { active: false, disabled: true, reason: STOP_RECORDING_FIRST }
            : { active: false, disabled: false }
    }
}

// --- Score settings in words ---

/**
 * The clef, key, meter and tempo at the dock's position (ScoreManipulator.settings), as the
 * chips and More-sheet rows say them — visible text and accessible names alike.
 */
export class ScoreSettingsWords {
    constructor(readonly settings: ScoreSettings) {}

    /** "Treble". */
    get clef(): string {
        return CLEF_DEFS[this.settings.clef].label
    }

    get clefLabel(): string {
        return `Clef: ${this.clef}`
    }

    /** "D major", "A minor". */
    get key(): string {
        return KeyName.of(this.settings.key).long
    }

    get keyLabel(): string {
        return `Key: ${this.key}`
    }

    /** "4/4". */
    get time(): string {
        const { beatAmount, beatType } = this.settings.timeSignature
        return `${beatAmount}/${beatType}`
    }

    get timeLabel(): string {
        return `Time signature: ${this.time}`
    }

    /** The beat the tempo is counted in — the felt pulse (a dotted quarter in 6/8). */
    get pulse(): Duration {
        return this.settings.timeSignature.pulse
    }

    /** Whether the beat is a plain quarter, so the tempo needs no note to say what it counts. */
    get pulseIsQuarter(): boolean {
        return this.pulse.beats === 1
    }

    /** The tempo in the felt beat: 60 for ♩. = 60 in 6/8. */
    get pulseBpm(): number {
        return Math.round(this.settings.timeSignature.pulseBpmOf(this.settings.bpm))
    }

    /** "Tempo: 100 bpm", "Tempo: 60 dotted-quarter bpm". */
    get tempoLabel(): string {
        const unit = this.pulseIsQuarter ? '' : `${this.pulse.name.replace(' ', '-')} `
        return `Tempo: ${this.pulseBpm} ${unit}bpm`
    }
}

// --- Note-value glyphs ---

const ICON_STEM_HEIGHT = 22
/** Baseline of the notehead in the icon's 30-unit-tall view box. */
const ICON_NOTE_Y = 26
const ICON_VIEW_HEIGHT = 30

/** How far a duration's glyph reaches to the right of its notehead's left edge (layout units). */
function glyphExtent(type: DurationType): number {
    const duration = new Duration({ type })
    const head = Bravura.width(duration.noteheadGlyph)
    const flag = duration.flagGlyph('up')
    return flag ? head + Bravura.width(flag) : head
}

/**
 * One view-box width for every value, wide enough for the widest (the flagged eighth and
 * sixteenth, the whole notehead), so the five glyphs share a scale and none is clipped.
 */
const ICON_VIEW_WIDTH = Math.ceil(Math.max(...DURATION_TYPES.map(glyphExtent)) + 2)

/** A note value drawn as notation — notehead, stem and flag — 28px tall, centred in its box. */
export function DurationIcon({ dur, dotted = false }: { dur: DurationType; dotted?: boolean }) {
    const duration = new Duration({ type: dur })
    const noteGlyph = duration.noteheadGlyph
    const flagName = duration.flagGlyph('up')
    const hasStem = dur !== 'w'
    const nhWidth = Bravura.width(noteGlyph)
    const dotGap = dotted ? 6 : 0
    const viewWidth = ICON_VIEW_WIDTH + dotGap
    const noteX = (viewWidth - glyphExtent(dur) - dotGap) / 2
    const stemX = noteX + nhWidth
    const stemY2 = ICON_NOTE_Y - ICON_STEM_HEIGHT
    return (
        <svg width={(28 * viewWidth) / ICON_VIEW_HEIGHT} height={28} viewBox={`0 0 ${viewWidth} ${ICON_VIEW_HEIGHT}`} aria-hidden>
            {hasStem && <line x1={stemX} y1={ICON_NOTE_Y} x2={stemX} y2={stemY2} stroke="currentColor" strokeWidth={1.2} />}
            {flagName && <Glyph name={flagName} x={stemX} y={stemY2} fill="currentColor" />}
            <Glyph name={noteGlyph} x={noteX} y={ICON_NOTE_Y} fill="currentColor" />
            {/* The augmentation dot: a drawn mark beside the head, never a "·" character. */}
            {dotted && <circle cx={stemX + dotGap} cy={ICON_NOTE_Y - 2} r={1.9} fill="currentColor" />}
        </svg>
    )
}

/** The Dotted control's face: a dotted quarter note. */
export function DottedIcon() {
    return <DurationIcon dur="q" dotted />
}

// --- Tie ---

/**
 * The tie curve on its own — the same tapered arc the score draws (see Tie.tsx),
 * thin at the ends and thick in the middle. Two noteheads plus the arc read as a
 * face at chip size, so the icon keeps only the mark the button actually toggles.
 */
export function TieIcon({ size = 18 }: { size?: number }) {
    const [x1, x2, y] = [2, 30, 6]
    const midX = (x1 + x2) / 2
    return (
        <svg width={size} height={(size * 20) / 32} viewBox="0 0 32 20" aria-hidden>
            <path d={`M ${x1} ${y} Q ${midX} ${y + 9} ${x2} ${y} Q ${midX} ${y + 14} ${x1} ${y} Z`} fill="currentColor" />
        </svg>
    )
}

// --- Triplet ---

export function TupletIcon({ size = 18 }: { size?: number }) {
    const numWidth = Bravura.width('timeSig3', TUPLET_NUMBER_SCALE)
    const gap = numWidth / 2 + 3
    const y = 10
    return (
        <svg width={size} height={(size * 20) / 32} viewBox="0 0 32 20" aria-hidden>
            <rect x={1} y={y} width={1.5} height={5} fill="currentColor" />
            <rect x={1} y={y} width={16 - gap - 1} height={1.5} fill="currentColor" />
            <rect x={16 + gap} y={y} width={15 - gap} height={1.5} fill="currentColor" />
            <rect x={29.5} y={y} width={1.5} height={5} fill="currentColor" />
            <Glyph name="timeSig3" x={16 - numWidth / 2} y={y} scale={TUPLET_NUMBER_SCALE} fill="currentColor" />
        </svg>
    )
}

// --- Rest ---

/** A quarter rest, its ink `height` px tall (the view box hugs the glyph's outline). */
export function RestIcon({ height = 12 }: { height?: number }) {
    return (
        <svg width={(height * 10) / 22} height={height} viewBox="0 9 10 22" aria-hidden>
            <Glyph name="restQuarter" x={1} y={20} fill="currentColor" />
        </svg>
    )
}
