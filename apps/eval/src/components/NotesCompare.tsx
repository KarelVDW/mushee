'use client'

import { useMemo, useState } from 'react'

import type { EstNoteDto } from '@/lib/api'

/**
 * Piano-roll overlay of expected vs derived notes — the visual that makes a
 * transcription's misses obvious at a glance where two engravings side by
 * side stay hard to diff. Identity: expected = cyan upper lane, derived =
 * magenta lower lane (series rides on position AND color — the two lanes never
 * overlap, which is also the dataviz overlap rule satisfied by construction).
 * State: a note the other series doesn't match within the harness's 100 ms /
 * exact-pitch gate renders hollow.
 */

interface NotesCompareProps {
    expected: EstNoteDto[]
    derived: EstNoteDto[]
}

const ONSET_TOL_SEC = 0.1
const ROW_HEIGHT = 14
const LANE_HEIGHT = 5
const AXIS_HEIGHT = 22
const LABEL_WIDTH = 34

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function pitchName(midi: number): string {
    return `${PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/** Greedy one-to-one matching under the harness's onset window + exact pitch. */
function matchNotes(expected: EstNoteDto[], derived: EstNoteDto[]): { expMatched: boolean[]; derMatched: boolean[] } {
    const expMatched = expected.map(() => false)
    const derMatched = derived.map(() => false)
    for (let e = 0; e < expected.length; e++) {
        let best = -1
        let bestDelta = Infinity
        for (let d = 0; d < derived.length; d++) {
            if (derMatched[d] || derived[d].midi !== expected[e].midi) continue
            const delta = Math.abs(derived[d].onsetSec - expected[e].onsetSec)
            if (delta <= ONSET_TOL_SEC && delta < bestDelta) {
                best = d
                bestDelta = delta
            }
        }
        if (best >= 0) {
            expMatched[e] = true
            derMatched[best] = true
        }
    }
    return { expMatched, derMatched }
}

interface Hover {
    series: 'expected' | 'derived'
    note: EstNoteDto
    matched: boolean
    x: number
    y: number
}

export function NotesCompare({ expected, derived }: NotesCompareProps) {
    const [hover, setHover] = useState<Hover | null>(null)

    const model = useMemo(() => {
        const all = [...expected, ...derived]
        if (!all.length) return null
        const minMidi = Math.min(...all.map((n) => n.midi)) - 1
        const maxMidi = Math.max(...all.map((n) => n.midi)) + 1
        const endSec = Math.max(...all.map((n) => n.onsetSec + n.durSec), 1)
        return { minMidi, maxMidi, endSec, ...matchNotes(expected, derived) }
    }, [expected, derived])

    if (!model) return <p className="font-body text-[13px] text-on-surface-variant m-0">No notes to compare.</p>

    const rows = model.maxMidi - model.minMidi + 1
    const plotHeight = rows * ROW_HEIGHT
    const height = plotHeight + AXIS_HEIGHT
    const width = 860
    const plotWidth = width - LABEL_WIDTH
    const xFor = (sec: number) => LABEL_WIDTH + (sec / model.endSec) * plotWidth
    const rowFor = (midi: number) => (model.maxMidi - midi) * ROW_HEIGHT
    const seconds = Array.from({ length: Math.floor(model.endSec) + 1 }, (_, i) => i)

    const bar = (note: EstNoteDto, series: 'expected' | 'derived', matched: boolean, key: number) => {
        const laneOffset = series === 'expected' ? ROW_HEIGHT / 2 - LANE_HEIGHT - 1 : ROW_HEIGHT / 2 + 1
        const x = xFor(note.onsetSec)
        const y = rowFor(note.midi) + laneOffset
        const barWidth = Math.max(3, xFor(note.onsetSec + note.durSec) - x - 1)
        const color = series === 'expected' ? 'var(--color-chart-cyan)' : 'var(--color-chart-magenta)'
        return (
            <rect
                key={`${series}-${key}`}
                x={x}
                y={y}
                width={barWidth}
                height={LANE_HEIGHT}
                rx={2}
                fill={matched ? color : 'var(--color-surface-container-lowest)'}
                stroke={color}
                strokeWidth={matched ? 0 : 1.5}
                onMouseEnter={() => setHover({ series, note, matched, x: x + barWidth / 2, y })}
                onMouseLeave={() => setHover(null)}
            />
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-4">
                <LegendSwatch color="var(--color-chart-cyan)" label="Expected (upper lane)" />
                <LegendSwatch color="var(--color-chart-magenta)" label="Pipeline (lower lane)" />
                <span className="font-body text-[12px] text-on-surface-variant">hollow = unmatched at ±100 ms / exact pitch</span>
            </div>
            <div className="relative overflow-x-auto">
                <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Expected vs pipeline notes">
                    {/* Row bands + pitch labels — recessive, ink for text. */}
                    {Array.from({ length: rows }, (_, i) => {
                        const midi = model.maxMidi - i
                        return (
                            <g key={midi}>
                                <rect
                                    x={LABEL_WIDTH}
                                    y={i * ROW_HEIGHT}
                                    width={plotWidth}
                                    height={ROW_HEIGHT}
                                    fill={midi % 12 === 0 ? 'var(--color-surface-container-low)' : i % 2 ? 'var(--color-surface-container-lowest)' : 'transparent'}
                                />
                                <text
                                    x={LABEL_WIDTH - 5}
                                    y={i * ROW_HEIGHT + ROW_HEIGHT / 2 + 3}
                                    textAnchor="end"
                                    className="fill-(--color-on-surface-variant)"
                                    fontSize={9}
                                    fontFamily="var(--font-mono)">
                                    {pitchName(midi)}
                                </text>
                            </g>
                        )
                    })}
                    {/* Time grid + axis */}
                    {seconds.map((sec) => (
                        <g key={sec}>
                            <line
                                x1={xFor(sec)}
                                y1={0}
                                x2={xFor(sec)}
                                y2={plotHeight}
                                stroke="var(--color-outline-variant)"
                                strokeWidth={0.5}
                                opacity={0.5}
                            />
                            <text
                                x={xFor(sec)}
                                y={plotHeight + 14}
                                textAnchor="middle"
                                className="fill-(--color-on-surface-variant)"
                                fontSize={9}
                                fontFamily="var(--font-mono)">
                                {sec}s
                            </text>
                        </g>
                    ))}
                    {expected.map((note, i) => bar(note, 'expected', model.expMatched[i], i))}
                    {derived.map((note, i) => bar(note, 'derived', model.derMatched[i], i))}
                </svg>
                {hover && (
                    <div
                        className="absolute z-10 pointer-events-none bg-inverse-surface text-inverse-on-surface rounded-md px-2.5 py-1.5 whitespace-nowrap"
                        style={{ left: `${(hover.x / width) * 100}%`, top: Math.max(0, (hover.y / height) * 100 - 8) + '%', transform: 'translate(-50%, -100%)' }}>
                        <span className="font-mono text-[11px]">
                            {hover.series === 'expected' ? 'expected' : 'pipeline'} · {pitchName(hover.note.midi)} ·{' '}
                            {hover.note.onsetSec.toFixed(2)}s +{hover.note.durSec.toFixed(2)}s · {hover.matched ? 'matched' : 'unmatched'}
                        </span>
                    </div>
                )}
            </div>
        </div>
    )
}

export function LegendSwatch({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-2 rounded-xs" style={{ background: color }} />
            <span className="font-label text-[11px] font-semibold text-on-surface-variant">{label}</span>
        </span>
    )
}
