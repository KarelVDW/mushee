'use client'

import { useState } from 'react'

import { Eyebrow } from '@/components/ui'
import { formatCount, formatDayTick } from '@/lib/format'

/**
 * Dashboard visual primitives. Everything is a single-series magnitude read,
 * so the marks stay in one hue — `chart-cyan`, the validated data-mark step of
 * the brand cyan ramp (see globals.css); identity never rides on color here.
 * Values and labels wear ink tokens, never the mark color.
 */

export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 flex flex-col gap-2">
            <Eyebrow>{label}</Eyebrow>
            <span className="font-mono text-[28px] leading-none text-on-surface tracking-[-0.02em]">{value}</span>
            {detail && <span className="font-body text-[12px] leading-snug text-on-surface-variant">{detail}</span>}
        </div>
    )
}

export interface DailyPoint {
    day: string
    value: number
}

interface DailyBarsProps {
    title: string
    points: DailyPoint[]
    /** Render values in the tooltip/peak label ("12", "1h 24m", …). */
    formatValue?: (value: number) => string
}

const CHART_HEIGHT = 120

/** Pixel height of a bar — labels/tooltips anchor just above it. */
function barTop(value: number, max: number): number {
    return value === 0 ? 2 : Math.max(3, Math.round((value / max) * CHART_HEIGHT))
}

/**
 * One month of daily counts as thin baseline-anchored bars. Single series, so
 * the title is the legend; the hover layer carries exact values and only the
 * peak day gets a direct label.
 */
export function DailyBars({ title, points, formatValue = formatCount }: DailyBarsProps) {
    const [hover, setHover] = useState<number | null>(null)
    const max = Math.max(1, ...points.map((p) => p.value))
    const peak = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0)
    const total = points.reduce((sum, p) => sum + p.value, 0)

    return (
        <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <Eyebrow>{title}</Eyebrow>
                <span className="font-mono text-[13px] leading-none text-on-surface-variant">{formatValue(total)} / 30d</span>
            </div>
            <div className="relative">
                <div className="flex items-end gap-px" style={{ height: CHART_HEIGHT }} role="img" aria-label={`${title}, last 30 days`}>
                    {points.map((point, i) => {
                        const barHeight = barTop(point.value, max)
                        const active = hover === i
                        return (
                            <div
                                key={point.day}
                                className="flex-1 h-full flex items-end cursor-default"
                                onMouseEnter={() => setHover(i)}
                                onMouseLeave={() => setHover(null)}>
                                <div
                                    className={[
                                        'w-full rounded-t-sm transition-colors duration-150 ease-solkey',
                                        point.value === 0 ? 'bg-surface-container-high' : active ? 'bg-primary' : 'bg-chart-cyan',
                                    ].join(' ')}
                                    style={{ height: barHeight }}
                                />
                            </div>
                        )
                    })}
                </div>
                {hover !== null && (
                    <div
                        className="absolute -translate-x-1/2 glass-panel editorial-shadow rounded-md px-2.5 py-1.5 whitespace-nowrap pointer-events-none z-10"
                        style={{
                            left: `${((hover + 0.5) / points.length) * 100}%`,
                            bottom: barTop(points[hover].value, max) + 6,
                        }}>
                        <span className="font-label font-semibold text-[11px] text-on-surface-variant mr-2">
                            {formatDayTick(points[hover].day)}
                        </span>
                        <span className="font-mono text-[12px] text-on-surface">{formatValue(points[hover].value)}</span>
                    </div>
                )}
                {hover === null && points[peak].value > 0 && (
                    <span
                        className="absolute -translate-x-1/2 font-mono text-[11px] leading-none text-on-surface-variant pointer-events-none"
                        style={{
                            left: `${((peak + 0.5) / points.length) * 100}%`,
                            bottom: barTop(points[peak].value, max) + 5,
                        }}>
                        {formatValue(points[peak].value)}
                    </span>
                )}
            </div>
            <div className="flex justify-between mt-2">
                <span className="font-label text-[10px] tracking-[0.08em] uppercase text-on-surface-variant">
                    {formatDayTick(points[0]?.day ?? '')}
                </span>
                <span className="font-label text-[10px] tracking-[0.08em] uppercase text-on-surface-variant">
                    {formatDayTick(points[points.length - 1]?.day ?? '')}
                </span>
            </div>
        </div>
    )
}

interface BarListProps {
    title: string
    rows: Array<{ label: string; value: number; detail?: string }>
    formatValue?: (value: number) => string
}

/** Horizontal magnitude list (e.g. users per tier): label + thin bar + value. */
export function BarList({ title, rows, formatValue = formatCount }: BarListProps) {
    const max = Math.max(1, ...rows.map((r) => r.value))
    return (
        <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4">
            <Eyebrow className="block mb-4">{title}</Eyebrow>
            <div className="flex flex-col gap-3">
                {rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
                        <span className="font-body text-[13px] leading-none text-on-surface truncate">{row.label}</span>
                        <div className="h-4 flex items-center">
                            <div
                                className="h-4 rounded-r-sm bg-chart-cyan min-w-0.5"
                                style={{ width: `${Math.max(1, (row.value / max) * 100)}%` }}
                            />
                        </div>
                        <span className="font-mono text-[13px] leading-none text-on-surface-variant text-right">
                            {formatValue(row.value)}
                            {row.detail ? <span className="text-outline"> · {row.detail}</span> : null}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
