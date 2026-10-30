'use client'

import { Eyebrow } from '@mushee/ui'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { type Material, MATERIALS, type TimelinePointDto } from '@/lib/dto'
import { Fmt } from '@/lib/format'

import { DeltaText, LegendSwatch } from '../Marks'
import { LineChart, type LineSeries } from './LineChart'

/**
 * The timeline's charts: the headline COnP over commits (all pooled + human-truth only), then one
 * small multiple per material on a shared y-scale — never more than two lines on one plot. All
 * charts share one crosshair; clicking a commit with a result file opens its breakdown.
 */
export function TimelineCharts({ points, compact }: { points: TimelinePointDto[]; compact?: boolean }) {
    const router = useRouter()
    const [active, setActive] = useState<number | null>(null)
    const xs = useMemo(() => points.map((p) => new Date(p.commitDate).getTime()), [points])

    const overall: LineSeries = { key: 'overall', label: 'All pooled datasets', tone: 'cyan', values: points.map((p) => p.overall) }
    const human: LineSeries = {
        key: 'human',
        label: 'Human-truth datasets only',
        tone: 'magenta',
        values: points.map((p) => p.overallHuman),
    }
    // The human-only line only earns its place once it differs from the pooled one somewhere.
    const showHuman = points.some((p) => p.overallHuman != null && p.overall != null && Math.abs(p.overallHuman - p.overall) > 0.0005)
    // The headline line is drawn last, on top: where the two coincide it is the one you see.
    const headline = showHuman ? [human, overall] : [overall]

    const materials = MATERIALS.filter((m) => points.some((p) => p.perMaterial[m] != null))
    const all = [...headline.flatMap((s) => s.values), ...materials.flatMap((m) => points.map((p) => p.perMaterial[m] ?? null))]
    const domain = paddedDomain(all.filter((v): v is number => v != null))
    const headlineDomain = paddedDomain(headline.flatMap((s) => s.values).filter((v): v is number => v != null))

    const pick = (i: number) => {
        if (points[i]?.hasDetail) router.push(`/runs/${encodeURIComponent(points[i].id)}`)
    }

    const tooltip = (i: number) => <PointCard points={points} index={i} />

    if (compact)
        return (
            <LineChart
                xs={xs}
                series={[overall]}
                height={120}
                yDomain={headlineDomain}
                compact
                ariaLabel="Overall COnP per historical commit"
                active={active}
                onActive={setActive}
                tooltip={tooltip}
                onPick={pick}
            />
        )

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
                {showHuman && (
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                        <LegendSwatch className="bg-chart-cyan" shape="line" label={overall.label} />
                        <LegendSwatch className="bg-chart-magenta" shape="line" label={human.label} />
                    </div>
                )}
                <LineChart
                    xs={xs}
                    series={headline}
                    height={280}
                    yDomain={headlineDomain}
                    pointLabels={points.map((p) => p.short)}
                    ariaLabel="COnP per historical commit"
                    active={active}
                    onActive={setActive}
                    tooltip={tooltip}
                    onPick={pick}
                />
            </div>
            {materials.length > 0 && (
                <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                    {materials.map((m) => (
                        <MaterialMultiple
                            key={m}
                            material={m}
                            points={points}
                            xs={xs}
                            domain={domain}
                            active={active}
                            onActive={setActive}
                            onPick={pick}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

function MaterialMultiple({
    material,
    points,
    xs,
    domain,
    active,
    onActive,
    onPick,
}: {
    material: Material
    points: TimelinePointDto[]
    xs: number[]
    domain: [number, number]
    active: number | null
    onActive: (i: number | null) => void
    onPick: (i: number) => void
}) {
    const values = points.map((p) => p.perMaterial[material] ?? null)
    const shown = active !== null ? values[active] : [...values].reverse().find((v) => v != null)
    const provisional = points.some((p) => p.provisional.includes(material))
    return (
        <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
                <span title={provisional ? 'Provisional: no pooled dataset, built from context truth' : undefined}>
                    <Eyebrow>
                        {material}
                        {provisional ? ' *' : ''}
                    </Eyebrow>
                </span>
                <span className="font-mono tabular-nums text-[13px] text-on-surface">{Fmt.score(shown ?? null)}</span>
            </div>
            <LineChart
                xs={xs}
                series={[{ key: material, label: material, tone: 'cyan', values }]}
                height={130}
                yDomain={domain}
                compact
                ariaLabel={`${material} COnP per historical commit`}
                active={active}
                onActive={onActive}
                tooltip={(i) => <PointCard points={points} index={i} material={material} />}
                onPick={onPick}
            />
        </div>
    )
}

/** The hover card: values lead, the commit follows. */
function PointCard({ points, index, material }: { points: TimelinePointDto[]; index: number; material?: Material }) {
    const p = points[index]
    const prev = points[index - 1]
    const value = material ? (p.perMaterial[material] ?? null) : p.overall
    const prevValue = prev ? (material ? (prev.perMaterial[material] ?? null) : prev.overall) : null
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
                <span className="font-mono tabular-nums text-[15px] font-semibold text-on-surface">{Fmt.score(value)}</span>
                <span className="font-body text-[12px] text-on-surface-variant">{material ?? 'all pooled'}</span>
                {prevValue != null && value != null && <DeltaText value={value - prevValue} className="text-[12px]" />}
            </div>
            {!material && p.overallHuman != null && (
                <div className="flex items-baseline gap-2">
                    <span className="font-mono tabular-nums text-[13px] text-on-surface">{Fmt.score(p.overallHuman)}</span>
                    <span className="font-body text-[12px] text-on-surface-variant">human truth only</span>
                </div>
            )}
            <span className="font-mono text-[12px] text-on-surface">
                {p.short} · {Fmt.dateTime(p.commitDate)}
            </span>
            {p.subject && <span className="font-body text-[12px] leading-snug text-on-surface text-pretty">{p.subject}</span>}
            {p.era && <span className="font-body text-[11px] text-on-surface-variant">era {p.era}</span>}
        </div>
    )
}

/** A y-domain hugging the data with a little air, on round 0.05 steps, inside 0–1. */
function paddedDomain(values: number[]): [number, number] {
    if (!values.length) return [0, 1]
    const lo = Math.max(0, Math.floor((Math.min(...values) - 0.02) * 20) / 20)
    const hi = Math.min(1, Math.ceil((Math.max(...values) + 0.02) * 20) / 20)
    return hi - lo < 0.1 ? [Math.max(0, lo - 0.05), Math.min(1, hi + 0.05)] : [lo, hi]
}
