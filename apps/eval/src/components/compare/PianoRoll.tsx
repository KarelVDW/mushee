'use client'

import { memo, type PointerEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { NoteDto } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { type Contour, PianoRollModel } from '@/lib/pianoRoll/PianoRollModel'

/**
 * The clip on a time × pitch grid, every layer on the same axes:
 *
 *   copy / truth notes   cyan wash, a solid onset edge; hatched + "?" when flagged uncertain
 *   reference truth      an ink outline (the derived truth replaced, or the human truth)
 *   pipeline notes       a magenta bar along the bottom of the row
 *   original pitch       a wide grey band (the consensus f0 of the recording)
 *   copy pitch           a thin ink line on top (the same tracker on the synthetic copy)
 *   diffs                grey spans labelled D1, D2… (the resynth report's open differences)
 *
 * Where the copy matches, the thin line runs inside the band and through the middle of the
 * notes. The playhead follows the player every frame without re-rendering the roll; a click
 * anywhere on the grid seeks.
 */

export interface RollLayers {
    primary: NoteDto[] | null
    reference: NoteDto[] | null
    pipeline: NoteDto[] | null
    origPitch: Contour | null
    copyPitch: Contour | null
    /** The latest compare report's differences, as time spans behind everything else. */
    diffs: Array<{ id: string; t0: number; t1: number }> | null
}

interface PianoRollProps {
    layers: RollLayers
    /** Notes and contours that set the pitch range even when hidden, so toggling never rescales. */
    rangeNotes: NoteDto[][]
    rangeContours: Contour[]
    durationSec: number
    pxPerSec: number
    labels: { primary: string; reference: string; pipeline: string }
    currentTime: () => number
    playing: boolean
    onSeek: (sec: number) => void
    scrollRef: RefObject<HTMLDivElement | null>
}

interface Hover {
    layer: string
    note: NoteDto
    x: number
    y: number
}

const LABEL_WIDTH = 44

export function PianoRoll({
    layers,
    rangeNotes,
    rangeContours,
    durationSec,
    pxPerSec,
    labels,
    currentTime,
    playing,
    onSeek,
    scrollRef,
}: PianoRollProps) {
    const model = useMemo(
        () => new PianoRollModel({ durationSec, pxPerSec, notes: rangeNotes, contours: rangeContours, targetHeight: 380 }),
        [durationSec, pxPerSec, rangeNotes, rangeContours],
    )
    const playhead = useRef<HTMLDivElement>(null)
    const [hover, setHover] = useState<Hover | null>(null)
    // The hover card sits outside the scroller (so the top rows' cards aren't clipped): place it in viewport terms.
    const onHover = useCallback((h: Hover | null) => setHover(h && { ...h, x: h.x - (scrollRef.current?.scrollLeft ?? 0) }), [scrollRef])

    // The playhead: one transform per frame, read straight off the player.
    useEffect(() => {
        let frame = 0
        let last = -1
        const tick = () => {
            const t = currentTime()
            if (t !== last && playhead.current) {
                last = t
                const x = model.x(t)
                playhead.current.style.transform = `translateX(${x}px)`
                const box = scrollRef.current
                // Follow the music while it plays: page on when the playhead leaves the comfortable middle.
                if (box && playing && (x < box.scrollLeft || x > box.scrollLeft + box.clientWidth * 0.85))
                    box.scrollLeft = x - box.clientWidth * 0.2
            }
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [model, currentTime, playing, scrollRef])

    const seekAt = (e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(model.secAt(e.clientX - rect.left))
    }

    return (
        <div className="relative flex">
            <PitchAxis model={model} />
            <div
                ref={scrollRef}
                className="relative flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
                style={{ height: model.height + 14 }}>
                <div className="relative cursor-crosshair" style={{ width: model.width, height: model.height }} onPointerDown={seekAt}>
                    <Grid model={model} />
                    <Layers model={model} layers={layers} labels={labels} onHover={onHover} />
                    <div
                        ref={playhead}
                        aria-hidden="true"
                        className="absolute top-0 left-0 w-0.5 -ml-px bg-on-surface pointer-events-none will-change-transform"
                        style={{ height: model.plotHeight }}>
                        <span className="absolute -top-1 -left-[3px] size-2 rounded-full bg-on-surface" />
                    </div>
                </div>
            </div>
            {hover && (
                <div
                    className="absolute z-10 pointer-events-none bg-surface-container-lowest shadow-overlay rounded-md px-2.5 py-1.5 w-max max-w-72"
                    style={{
                        left: LABEL_WIDTH + hover.x,
                        top: hover.y < 48 ? hover.y + model.rowHeight + 6 : hover.y - 6,
                        transform: hover.y < 48 ? 'translateX(-50%)' : 'translate(-50%, -100%)',
                    }}>
                    <span className="block font-mono text-[12px] text-on-surface">
                        {PianoRollModel.label(hover.note.midi)} · {hover.note.onsetSec.toFixed(2)}–
                        {(hover.note.onsetSec + hover.note.durSec).toFixed(2)} s
                    </span>
                    <span className="block font-body text-[11px] text-on-surface-variant">
                        {hover.layer}
                        {hover.note.id ? ` · ${hover.note.id}` : ''}
                        {hover.note.flags?.length ? ` · ${hover.note.flags.join(', ')}` : ''}
                    </span>
                </div>
            )}
        </div>
    )
}

/** Pitch names down the left edge, outside the scroller so they stay put while the roll scrolls. */
const PitchAxis = memo(function PitchAxis({ model }: { model: PianoRollModel }) {
    return (
        <svg width={LABEL_WIDTH} height={model.height} className="shrink-0" aria-hidden="true">
            {model.rows.map((midi) =>
                model.labelled(midi) ? (
                    <text
                        key={midi}
                        x={LABEL_WIDTH - 6}
                        y={model.y(midi) + 4}
                        textAnchor="end"
                        fontSize={11}
                        className={`font-mono ${midi % 12 === 0 ? 'fill-on-surface' : 'fill-on-surface-variant'}`}>
                        {PianoRollModel.label(midi)}
                    </text>
                ) : null,
            )}
        </svg>
    )
})

const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

/** Black-key rows a tone darker, a hairline on every time tick, the time axis underneath. */
const Grid = memo(function Grid({ model }: { model: PianoRollModel }) {
    return (
        <svg width={model.width} height={model.height} className="absolute inset-0 pointer-events-none" aria-hidden="true">
            {model.rows.map((midi) =>
                BLACK_KEYS.has(midi % 12) ? (
                    <rect
                        key={midi}
                        x={0}
                        y={model.rowTop(midi)}
                        width={model.width}
                        height={model.rowHeight}
                        fill="var(--color-surface-container-low)"
                    />
                ) : null,
            )}
            {model.ticks().map((t) => (
                <g key={t}>
                    <line
                        x1={model.x(t)}
                        x2={model.x(t)}
                        y1={0}
                        y2={model.plotHeight}
                        stroke="var(--color-surface-container-high)"
                        strokeWidth={1}
                    />
                    <text x={model.x(t) + 3} y={model.plotHeight + 16} fontSize={11} className="font-mono fill-on-surface-variant">
                        {Fmt.clock(t)}
                        {t % 1 ? `.${Math.round((t % 1) * 10)}` : ''}
                    </text>
                </g>
            ))}
        </svg>
    )
})

/** The notes and contours: rebuilt only when the layers or the zoom change, never per frame. */
const Layers = memo(function Layers({
    model,
    layers,
    labels,
    onHover,
}: {
    model: PianoRollModel
    layers: RollLayers
    labels: PianoRollProps['labels']
    onHover: (h: Hover | null) => void
}) {
    const h = model.rowHeight
    const width = (n: NoteDto) => Math.max(2, model.x(n.durSec) - 1)
    const enter = (layer: string, note: NoteDto) => () =>
        onHover({ layer, note, x: model.x(note.onsetSec + note.durSec / 2), y: model.rowTop(note.midi) })
    const leave = () => onHover(null)
    return (
        <svg
            width={model.width}
            height={model.plotHeight}
            className="absolute inset-0"
            role="img"
            aria-label="Piano roll of the clip's notes and pitch">
            <defs>
                <pattern id="uncertain-hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width={6} height={6} fill="var(--color-chart-cyan)" fillOpacity={0.18} />
                    <line x1={0} y1={0} x2={0} y2={6} stroke="var(--color-chart-cyan)" strokeWidth={2.5} />
                </pattern>
            </defs>
            {layers.diffs?.map((d) => (
                <g key={d.id} pointerEvents="none">
                    <rect
                        x={model.x(d.t0)}
                        y={0}
                        width={Math.max(4, model.x(d.t1) - model.x(d.t0))}
                        height={model.plotHeight}
                        fill="var(--color-on-surface)"
                        fillOpacity={0.07}
                    />
                    <text x={model.x(d.t0) + 2} y={11} fontSize={11} fontWeight={600} className="font-mono fill-on-surface-variant">
                        {d.id}
                    </text>
                </g>
            ))}
            {layers.origPitch && (
                <path
                    d={model.contourPath(layers.origPitch)}
                    fill="none"
                    stroke="var(--color-outline-variant)"
                    strokeOpacity={0.75}
                    strokeWidth={Math.max(4, h * 0.45)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                />
            )}
            {layers.primary?.map((n, i) => {
                const uncertain = !!n.flags?.some((f) => f.startsWith('uncertain'))
                return (
                    <g key={`p${i}`} onPointerEnter={enter(labels.primary, n)} onPointerLeave={leave}>
                        <rect
                            x={model.x(n.onsetSec)}
                            y={model.rowTop(n.midi) + 1}
                            width={width(n)}
                            height={h - 2}
                            rx={2}
                            fill={uncertain ? 'url(#uncertain-hatch)' : 'var(--color-chart-cyan)'}
                            fillOpacity={uncertain ? 1 : 0.32}
                        />
                        <rect
                            x={model.x(n.onsetSec)}
                            y={model.rowTop(n.midi) + 1}
                            width={2}
                            height={h - 2}
                            fill="var(--color-chart-cyan)"
                        />
                        {uncertain && (
                            <text
                                x={model.x(n.onsetSec) + 1}
                                y={model.rowTop(n.midi) - 2}
                                fontSize={11}
                                fontWeight={700}
                                className="font-mono fill-primary">
                                ?
                            </text>
                        )}
                    </g>
                )
            })}
            {layers.reference?.map((n, i) => (
                <rect
                    key={`r${i}`}
                    x={model.x(n.onsetSec) + 0.75}
                    y={model.rowTop(n.midi) + 0.75}
                    width={Math.max(1, width(n) - 1.5)}
                    height={h - 1.5}
                    rx={2}
                    fill="transparent"
                    stroke="var(--color-on-surface-variant)"
                    strokeWidth={1.5}
                    onPointerEnter={enter(labels.reference, n)}
                    onPointerLeave={leave}
                />
            ))}
            {layers.pipeline?.map((n, i) => (
                <rect
                    key={`m${i}`}
                    x={model.x(n.onsetSec)}
                    y={model.rowTop(n.midi) + h * 0.6}
                    width={width(n)}
                    height={Math.max(2.5, h * 0.4 - 1)}
                    rx={1}
                    fill="var(--color-chart-magenta)"
                    onPointerEnter={enter(labels.pipeline, n)}
                    onPointerLeave={leave}
                />
            ))}
            {layers.copyPitch && (
                <path
                    d={model.contourPath(layers.copyPitch)}
                    fill="none"
                    stroke="var(--color-on-surface)"
                    strokeWidth={1.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                />
            )}
        </svg>
    )
})

/** Keeps the time under the viewport's centre in place across a zoom. */
export function useZoomAnchor(scrollRef: RefObject<HTMLDivElement | null>, pxPerSec: number) {
    const previous = useRef(pxPerSec)
    useLayoutEffect(() => {
        const box = scrollRef.current
        const before = previous.current
        previous.current = pxPerSec
        if (!box || before === pxPerSec) return
        const centreSec = (box.scrollLeft + box.clientWidth / 2) / before
        box.scrollLeft = centreSec * pxPerSec - box.clientWidth / 2
    }, [scrollRef, pxPerSec])
}
