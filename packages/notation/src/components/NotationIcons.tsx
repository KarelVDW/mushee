'use client'

// Notation symbols as inline icons for app chrome (toolbar chips, pickers): each is a sized
// `<svg>` drawn from the same layout and glyph metrics the staff uses, so an icon can't drift
// from what gets engraved. `size` is the icon's height in CSS pixels; `color` fills every
// glyph and label (currentColor by default, so icons follow the surrounding text colour).

import { useMemo } from 'react'

import { Bravura } from '../engraving/Bravura'
import { NUM_STAFF_LINES } from '../engraving/constants'
import type { Duration } from '../model/Duration'
import { KeySignature } from '../model/KeySignature'
import { ClefLayout } from '../model/layout/ClefLayout'
import { Staff } from '../model/layout/Staff'
import { Pitch } from '../model/Pitch'
import { TimeSignature } from '../model/TimeSignature'
import type { ClefType } from '../model/types'
import { BEAT_UNIT_STEM_HEIGHT, BeatUnit, beatUnitWidth } from './BeatUnit'
import { Glyph } from './Glyph'

interface IconProps {
    size?: number
    color?: string
}

/** Window over the staff region (lines sit at y 40–80), padded so taller glyphs and octave markers fit. */
const STAFF_WINDOW_TOP = 10
const STAFF_WINDOW_HEIGHT = 92

/** A clef glyph (with any 8/15 octave marker), drawn from the same layout the staff uses. */
export function ClefIcon({ type, size = 30, color = 'currentColor' }: IconProps & { type: ClefType }) {
    const { glyphName, x, y, octave } = ClefLayout.of(type)
    const width = 28
    return (
        <svg
            width={(size * width) / STAFF_WINDOW_HEIGHT}
            height={size}
            viewBox={`0 ${STAFF_WINDOW_TOP} ${width} ${STAFF_WINDOW_HEIGHT}`}
            aria-hidden>
            <Glyph name={glyphName} x={x} y={y} fill={color} />
            {octave && (
                <text x={octave.x} y={octave.y} fontSize={9} fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill={color}>
                    {octave.text}
                </text>
            )}
        </svg>
    )
}

/**
 * The window every accidental icon shares, in layout units around the glyph's origin (y down):
 * room for all three — the flat reaches highest (≈17.8 up), the sharp lowest (≈14.1 down), the
 * sharp is widest (≈10.1) — so ♭ ♮ ♯ draw at one scale and sit as they would on a line.
 */
const ACCIDENTAL_WINDOW = { x: -1, y: -19, width: 12.5, height: 34 }

/**
 * A flat, natural or sharp (`alter` −1, 0, 1) drawn from Bravura, its window `size` px tall —
 * never the UI font's ♭ ♮ ♯, whose flat and natural come out at half the sharp's height.
 */
export function AccidentalIcon({ alter, size = 20, color = 'currentColor' }: IconProps & { alter: -1 | 0 | 1 }) {
    const glyph = Pitch.glyphForAlter(alter)
    const { x, y, width, height } = ACCIDENTAL_WINDOW
    return (
        <svg width={(size * width) / height} height={size} viewBox={`${x} ${y} ${width} ${height}`} aria-hidden>
            {glyph && <Glyph name={glyph} x={0} y={0} fill={color} />}
        </svg>
    )
}

/** Horizontal step between the accidentals of a key-signature icon. */
const KEY_ACCIDENTAL_ADVANCE = 7

/**
 * A staffed key signature's window (y down): the five lines plus room for the highest sharp
 * (G♯ above the top line reaches y ≈ 20.9) and the lowest flat (F♭ in the first space, ≈ 82.1),
 * the same for every key so a grid of them shares one staff line. An empty staff keeps 2 units
 * round its lines.
 */
const KEY_STAFF_WINDOW = { top: 19, height: 66 }
const EMPTY_STAFF_WINDOW = { top: Staff.TOP_Y - 2, height: Staff.HEIGHT + 4 }
/** The faint staff behind a staffed key signature: outline_variant at 40%, so the accidentals stay the ink. */
const KEY_STAFF_COLOR = 'var(--color-outline-variant, #acadad)'
/** The gap between a staffed key signature's accidentals (the score's own is ACCIDENTAL_GAP, 2). */
const KEY_STAFF_ACCIDENTAL_GAP = 0.5
const KEY_STAFF_OPACITY = 0.4

interface KeySignatureIconProps extends IconProps {
    fifths: number
    /**
     * Draw the accidentals on a faint five-line staff — notation, so they read as a key rather
     * than specks. `size` is then the staff's own height (its five lines), the window growing
     * round it to fit the accidentals; C major is the staff alone.
     */
    staff?: boolean
    /** A staffed icon's width in px, wider than the accidentals need (C major's short empty staff); the accidentals stay centred. */
    width?: number
}

/**
 * The run of sharps/flats for a key. Bare, in a `size`-tall window over the staff region, C major
 * (no accidentals) a natural on the middle line; with `staff`, on faint staff lines of `size` px.
 */
export function KeySignatureIcon({ fifths, size = 30, color = 'currentColor', staff = false, width }: KeySignatureIconProps) {
    const accidentals = KeySignature.accidentalsForFifths(fifths)
    if (staff) return <StaffedKeySignature fifths={fifths} staffSize={size} color={color} width={width} />
    const viewWidth = Math.max(1, accidentals.length) * KEY_ACCIDENTAL_ADVANCE + 4
    if (accidentals.length === 0) {
        return (
            <svg
                width={(size * viewWidth) / STAFF_WINDOW_HEIGHT}
                height={size}
                viewBox={`0 ${STAFF_WINDOW_TOP} ${viewWidth} ${STAFF_WINDOW_HEIGHT}`}
                aria-hidden>
                <Glyph name="accidentalNatural" x={2} y={Staff.TOP_Y + Staff.HEIGHT / 2} fill={color} />
            </svg>
        )
    }
    return (
        <svg
            width={(size * viewWidth) / STAFF_WINDOW_HEIGHT}
            height={size}
            viewBox={`0 ${STAFF_WINDOW_TOP} ${viewWidth} ${STAFF_WINDOW_HEIGHT}`}
            aria-hidden>
            {accidentals.map((a, i) => (
                <Glyph
                    key={i}
                    name={a.glyphName}
                    x={2 + i * KEY_ACCIDENTAL_ADVANCE}
                    y={Staff.yForNoteLine(new Pitch({ name: a.name, octave: a.octave }).line)}
                    fill={color}
                />
            ))}
        </svg>
    )
}

/** {@link KeySignatureIcon} on its staff: the lines, then the accidentals over them, centred across the width. */
function StaffedKeySignature({ fifths, staffSize, color, width }: { fifths: number; staffSize: number; color: string; width?: number }) {
    const accidentals = KeySignature.accidentalsForFifths(fifths)
    const window = accidentals.length ? KEY_STAFF_WINDOW : EMPTY_STAFF_WINDOW
    const scale = staffSize / Staff.HEIGHT
    // On a staff the accidentals keep their real proportions, so they step by their own widths
    // (a touch tighter than the score's spacing) instead of overlapping: each one's x, then the run's ink.
    const xs: number[] = []
    let ink = 0
    for (const a of accidentals) {
        if (xs.length) ink += KEY_STAFF_ACCIDENTAL_GAP
        xs.push(ink)
        ink += Bravura.width(a.glyphName)
    }
    const viewWidth = Math.max(ink + 4, width === undefined ? 0 : width / scale)
    const left = (viewWidth - ink) / 2
    return (
        <svg width={viewWidth * scale} height={window.height * scale} viewBox={`0 ${window.top} ${viewWidth} ${window.height}`} aria-hidden>
            {Array.from({ length: NUM_STAFF_LINES }, (_, i) => (
                <line
                    key={i}
                    x1={0}
                    x2={viewWidth}
                    y1={Staff.yForStaffLine(i)}
                    y2={Staff.yForStaffLine(i)}
                    stroke={KEY_STAFF_COLOR}
                    strokeOpacity={KEY_STAFF_OPACITY}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                />
            ))}
            {accidentals.map((a, i) => (
                <Glyph
                    key={i}
                    name={a.glyphName}
                    x={left + xs[i]}
                    y={Staff.yForNoteLine(new Pitch({ name: a.name, octave: a.octave }).line)}
                    fill={color}
                />
            ))}
        </svg>
    )
}

/** Room kept around the digits on every side of the time-signature icon's window. */
const TIME_SIGNATURE_MARGIN = 2

/** Stacked meter digits (e.g. 6 over 8), drawn from the same layout the staff uses. */
export function TimeSignatureIcon({
    beatAmount,
    beatType,
    size = 30,
    color = 'currentColor',
}: IconProps & { beatAmount: number; beatType: number }) {
    const layout = useMemo(() => new TimeSignature(beatAmount, beatType).layout, [beatAmount, beatType])
    const { topDigits, bottomDigits } = layout
    const { paddingLeft, content } = layout.width
    // Window over the digits' content box (the staff padding trimmed) and the staff band:
    // the digits sit on lines 1 and 3, each spanning a space up and down.
    const left = paddingLeft - TIME_SIGNATURE_MARGIN
    const width = content + 2 * TIME_SIGNATURE_MARGIN
    const top = Staff.TOP_Y - TIME_SIGNATURE_MARGIN
    const height = Staff.HEIGHT + 2 * TIME_SIGNATURE_MARGIN
    return (
        <svg width={(size * width) / height} height={size} viewBox={`${left} ${top} ${width} ${height}`} aria-hidden>
            {[...topDigits, ...bottomDigits].map((digit, i) => (
                <Glyph key={i} name={digit.glyphName} x={digit.x} y={digit.y} scale={digit.scale} fill={color} />
            ))}
        </svg>
    )
}

/** The note of a metronome mark (♩, ♩., 𝅗𝅥) as an inline icon, sized by its height. */
export function BeatUnitIcon({ duration, size = 18, color = 'currentColor' }: IconProps & { duration: Duration }) {
    // The glyph sits with its notehead centre on y = 0: the stem reaches up, the head 5 down.
    const top = -(BEAT_UNIT_STEM_HEIGHT + 3)
    const height = 24
    const width = beatUnitWidth(duration) + 2
    return (
        <svg width={(size * width) / height} height={size} viewBox={`-1 ${top} ${width} ${height}`} aria-hidden>
            <BeatUnit duration={duration} fill={color} />
        </svg>
    )
}
