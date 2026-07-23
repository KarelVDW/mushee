'use client'

import type { ScoreDocument } from '@/lib/api'
import { buildPianoRoll, pitchLabel } from '@/lib/piano-roll'

/**
 * Read-only piano-roll rendering of a score document. Honors the Sanctuary
 * rule: a white canvas with notation-ink marks and no brand color — this is
 * the user's music, not console chrome. Gridlines stay recessive; each note
 * carries a native tooltip with pitch and beat.
 */

const QUARTER_WIDTH = 26
const ROW_HEIGHT = 8
const PADDING = 16
const INK = '#2d2f2f'
const GRID = 'rgba(172, 173, 173, 0.35)'

export function ScorePreview({ document }: { document: ScoreDocument }) {
    if (typeof document.raw === 'string') {
        return (
            <p className="font-body text-[13px] leading-normal text-on-surface-variant m-0">
                This score is stored as raw MusicXML (imported file) — the inline preview only reads Solkey&apos;s own format. The raw
                document below has the full content.
            </p>
        )
    }

    const roll = buildPianoRoll(document)
    if (roll.notes.length === 0) {
        return <p className="font-body text-[13px] leading-normal text-on-surface-variant m-0">No notes in this score yet.</p>
    }

    // One semitone of headroom so the extreme notes don't touch the edges.
    const top = roll.maxMidi + 1
    const bottom = roll.minMidi - 1
    const width = Math.ceil(roll.end * QUARTER_WIDTH) + PADDING * 2
    const height = (top - bottom + 1) * ROW_HEIGHT + PADDING * 2

    const x = (quarters: number) => PADDING + quarters * QUARTER_WIDTH
    const y = (midi: number) => PADDING + (top - midi) * ROW_HEIGHT

    // Label every C in range; those octave lines anchor the pitch axis.
    const octaveLines = []
    for (let midi = Math.ceil(bottom / 12) * 12; midi <= top; midi += 12) octaveLines.push(midi)

    return (
        <div className="overflow-x-auto bg-surface-container-lowest rounded-md" role="img" aria-label="Piano-roll preview of the score">
            <svg width={width} height={height} className="block">
                {octaveLines.map((midi) => (
                    <g key={midi}>
                        <line x1={PADDING / 2} x2={width - PADDING / 2} y1={y(midi) + ROW_HEIGHT / 2} y2={y(midi) + ROW_HEIGHT / 2} stroke={GRID} />
                        <text
                            x={2}
                            y={y(midi) + ROW_HEIGHT / 2 - 3}
                            fontSize={9}
                            fill="#5a5c5c"
                            fontFamily="var(--font-mono)">
                            {pitchLabel(midi)}
                        </text>
                    </g>
                ))}
                {roll.measureStarts.map((start, index) =>
                    index === 0 ? null : (
                        <line key={index} x1={x(start)} x2={x(start)} y1={PADDING / 2} y2={height - PADDING / 2} stroke={GRID} />
                    ),
                )}
                {roll.notes.map((note, index) => (
                    <rect
                        key={index}
                        x={x(note.start) + 0.5}
                        y={y(note.midi) + 1}
                        width={Math.max(3, note.duration * QUARTER_WIDTH - 1.5)}
                        height={ROW_HEIGHT - 2}
                        rx={2}
                        fill={INK}>
                        <title>{`${pitchLabel(note.midi)} · beat ${(note.start + 1).toFixed(2).replace(/\.?0+$/, '')} · ${note.duration.toFixed(2).replace(/\.?0+$/, '')} quarters`}</title>
                    </rect>
                ))}
            </svg>
        </div>
    )
}
