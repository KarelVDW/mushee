'use client'

import { type KeyboardEvent, type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

/**
 * A line chart over time with at most two series (the theme's two validated chart colours),
 * 2px lines, 8px markers with a 2px surface ring, solid hairline grid, one y-axis. Hover (or the
 * arrow keys) snaps a crosshair to the nearest point; `active` is lifted so small multiples share
 * one crosshair. Point labels are placed selectively — only where they don't collide.
 */

export interface LineSeries {
    key: string
    label: string
    tone: 'cyan' | 'magenta'
    values: Array<number | null>
}

interface LineChartProps {
    /** Point positions (ms since epoch), ascending. */
    xs: number[]
    series: LineSeries[]
    height: number
    yDomain: [number, number]
    /** Text above each point, shown only where it fits (short shas). */
    pointLabels?: string[]
    compact?: boolean
    ariaLabel: string
    active: number | null
    onActive: (index: number | null) => void
    /** The hover card for a point; shown only on the chart the pointer is over. */
    tooltip?: (index: number) => ReactNode
    onPick?: (index: number) => void
}

const TONE = { cyan: 'var(--color-chart-cyan)', magenta: 'var(--color-chart-magenta)' }
const PAD = { left: 40, right: 16, top: 22, bottom: 24 }
const PAD_COMPACT = { left: 34, right: 10, top: 10, bottom: 20 }

export function LineChart({
    xs,
    series,
    height,
    yDomain,
    pointLabels,
    compact,
    ariaLabel,
    active,
    onActive,
    tooltip,
    onPick,
}: LineChartProps) {
    const box = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    const [hovering, setHovering] = useState(false)

    useLayoutEffect(() => {
        const el = box.current
        if (!el) return
        const observer = new ResizeObserver(() => setWidth(el.clientWidth))
        observer.observe(el)
        setWidth(el.clientWidth)
        return () => observer.disconnect()
    }, [])

    const pad = compact ? PAD_COMPACT : PAD
    const plotW = Math.max(10, width - pad.left - pad.right)
    const plotH = height - pad.top - pad.bottom
    const [x0, x1] = [xs[0] ?? 0, xs[xs.length - 1] ?? 1]
    const span = x1 - x0 || 1
    // A single point sits in the middle; otherwise the first and last commits touch the edges.
    const xAt = (i: number) => pad.left + (xs.length === 1 ? plotW / 2 : ((xs[i] - x0) / span) * plotW)
    const yAt = (v: number) => pad.top + (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH

    const yTicks = ticks(yDomain, compact ? 3 : 5)
    const xTicks = timeTicks(x0, x1, Math.max(2, Math.floor(plotW / 110)))

    const nearest = (clientX: number): number | null => {
        const rect = box.current?.getBoundingClientRect()
        if (!rect || !xs.length) return null
        const x = clientX - rect.left
        let best = 0
        for (let i = 1; i < xs.length; i++) if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i
        return best
    }

    const onKey = (e: KeyboardEvent) => {
        if (!xs.length) return
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault()
            const step = e.key === 'ArrowRight' ? 1 : -1
            onActive(Math.max(0, Math.min(xs.length - 1, (active ?? (step > 0 ? -1 : xs.length)) + step)))
            setHovering(true)
        } else if (e.key === 'Enter' && active !== null) onPick?.(active)
    }

    // Selective point labels: from the newest back, skipping any that would touch the one already placed.
    const labelled = new Set<number>()
    if (pointLabels && !compact) {
        let lastX = -Infinity
        for (let i = xs.length - 1; i >= 0; i--) {
            if (Math.abs(lastX - xAt(i)) >= 58) {
                labelled.add(i)
                lastX = xAt(i)
            }
        }
    }

    const path = (values: Array<number | null>) => {
        let d = ''
        let pen = false
        values.forEach((v, i) => {
            if (v == null) {
                pen = false
                return
            }
            d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`
            pen = true
        })
        return d
    }

    const tip = hovering && active !== null && tooltip ? tooltip(active) : null
    const tipLeft = active !== null ? xAt(active) : 0

    return (
        <div ref={box} className="relative w-full select-none" style={{ height }}>
            {width > 0 && (
                <svg
                    width={width}
                    height={height}
                    role="img"
                    aria-label={ariaLabel}
                    tabIndex={0}
                    className="block focus-ring rounded-sm"
                    onKeyDown={onKey}
                    onBlur={() => setHovering(false)}
                    onPointerMove={(e: PointerEvent) => {
                        setHovering(true)
                        onActive(nearest(e.clientX))
                    }}
                    onPointerLeave={() => {
                        setHovering(false)
                        onActive(null)
                    }}
                    onClick={(e) => {
                        const i = nearest(e.clientX)
                        if (i !== null) onPick?.(i)
                    }}>
                    {yTicks.map((t) => (
                        <g key={t}>
                            <line
                                x1={pad.left}
                                x2={pad.left + plotW}
                                y1={yAt(t)}
                                y2={yAt(t)}
                                stroke="var(--color-surface-container-high)"
                                strokeWidth={1}
                            />
                            <text
                                x={pad.left - 6}
                                y={yAt(t) + 4}
                                textAnchor="end"
                                fontSize={11}
                                className="fill-on-surface-variant font-mono">
                                {t.toFixed(2)}
                            </text>
                        </g>
                    ))}
                    {xTicks.map((t) => {
                        const x = pad.left + (xs.length === 1 ? plotW / 2 : ((t - x0) / span) * plotW)
                        return (
                            <text
                                key={t}
                                x={x}
                                y={height - 6}
                                textAnchor="middle"
                                fontSize={11}
                                className="fill-on-surface-variant font-mono">
                                {shortDate(t)}
                            </text>
                        )
                    })}
                    {active !== null && (
                        <line
                            x1={xAt(active)}
                            x2={xAt(active)}
                            y1={pad.top - 4}
                            y2={pad.top + plotH}
                            stroke="var(--color-outline-variant)"
                            strokeWidth={1}
                        />
                    )}
                    {series.map((s) => (
                        <path
                            key={s.key}
                            d={path(s.values)}
                            fill="none"
                            stroke={TONE[s.tone]}
                            strokeWidth={2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                        />
                    ))}
                    {series.map((s) =>
                        s.values.map((v, i) =>
                            v == null ? null : (
                                <circle
                                    key={`${s.key}-${i}`}
                                    cx={xAt(i)}
                                    cy={yAt(v)}
                                    r={active === i ? 5 : compact ? 3 : 4}
                                    fill={TONE[s.tone]}
                                    stroke="var(--color-surface-container-lowest)"
                                    strokeWidth={2}
                                />
                            ),
                        ),
                    )}
                    {[...labelled].map((i) => {
                        // The label rides above the highest series at that point, kept inside the plot at both ends.
                        const values = series.map((s) => s.values[i]).filter((x): x is number => x != null)
                        if (!values.length || !pointLabels) return null
                        const x = xAt(i)
                        const anchor = x > width - pad.right - 30 ? 'end' : x < pad.left + 30 ? 'start' : 'middle'
                        return (
                            <text
                                key={`l${i}`}
                                x={anchor === 'end' ? x + 4 : anchor === 'start' ? x - 4 : x}
                                y={yAt(Math.max(...values)) - 9}
                                textAnchor={anchor}
                                fontSize={11}
                                className="fill-on-surface-variant font-mono">
                                {pointLabels[i]}
                            </text>
                        )
                    })}
                </svg>
            )}
            {tip && (
                <div
                    className="absolute z-10 pointer-events-none bg-surface-container-lowest shadow-overlay rounded-md px-3 py-2 w-max max-w-72"
                    style={{
                        left: tipLeft,
                        top: 0,
                        transform: `translate(${tipLeft > width / 2 ? 'calc(-100% - 12px)' : '12px'}, 0)`,
                    }}>
                    {tip}
                </div>
            )}
        </div>
    )
}

/** Round y ticks across a domain. */
function ticks([lo, hi]: [number, number], count: number): number[] {
    const raw = (hi - lo) / count
    const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5].find((s) => s >= raw) ?? 1
    const out: number[] = []
    for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) out.push(Number(t.toFixed(4)))
    return out
}

/** About `count` date ticks at whole days, weeks or months. */
function timeTicks(x0: number, x1: number, count: number): number[] {
    if (x1 <= x0) return [x0]
    const day = 86_400_000
    const step = [1, 2, 7, 14, 30, 61, 91].map((d) => d * day).find((s) => (x1 - x0) / s <= count) ?? 182 * day
    const start = new Date(x0)
    start.setHours(0, 0, 0, 0)
    const out: number[] = []
    for (let t = start.getTime() + (start.getTime() < x0 ? day : 0); t <= x1; t += step) out.push(t)
    return out
}

function shortDate(ms: number): string {
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
