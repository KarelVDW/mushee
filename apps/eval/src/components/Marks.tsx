import { Eyebrow, Icon } from '@mushee/ui'
import type { ReactNode } from 'react'

import type { ResynthProgressDto, ResynthStatus, TruthSource } from '@/lib/dto'
import { Fmt } from '@/lib/format'

/**
 * The small marks every page shares. Scores live on the absolute 0–1 scale everywhere, so a bar
 * on one page reads like a bar on any other. Marks carry the series colour; their text stays in
 * ink tokens (dataviz rule: text never wears the data colour).
 */

export function StatTile({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
    return (
        <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 flex flex-col gap-2 min-w-0">
            <Eyebrow>{label}</Eyebrow>
            <span className="font-display font-semibold text-[34px] leading-none text-on-surface tracking-[-0.02em]">{value}</span>
            {detail && <span className="font-body text-[12px] leading-snug text-on-surface-variant text-pretty">{detail}</span>}
        </div>
    )
}

/** One score as a thin bar on the 0–1 scale, value at its tip. */
export function ScoreBar({ value, tone = 'cyan', muted }: { value: number | null; tone?: 'cyan' | 'magenta'; muted?: boolean }) {
    if (value === null) return <span className="font-mono text-[12px] text-on-surface-variant">—</span>
    const color = muted ? 'bg-outline-variant' : tone === 'cyan' ? 'bg-chart-cyan' : 'bg-chart-magenta'
    return (
        <div className="flex items-center gap-2 min-w-24">
            <div className="flex-1 h-3 flex items-center">
                <div className={`h-3 rounded-r-sm min-w-0.5 ${color}`} style={{ width: `${Math.max(0.5, value * 100)}%` }} />
            </div>
            <span className="font-mono tabular-nums text-[12px] leading-none text-on-surface w-10 text-right">{Fmt.score(value)}</span>
        </div>
    )
}

/** Run A (cyan, upper) and run B (magenta, lower) for one dataset — position and colour both say which. */
export function PairBar({ a, b }: { a: number | null; b: number | null }) {
    return (
        <div className="flex flex-col gap-0.5 min-w-32">
            <PairLine value={a} color="bg-chart-cyan" />
            <PairLine value={b} color="bg-chart-magenta" />
        </div>
    )
}

function PairLine({ value, color }: { value: number | null; color: string }) {
    if (value === null)
        return (
            <div className="h-3 flex items-center">
                <span className="font-mono text-[11px] leading-none text-on-surface-variant">absent</span>
            </div>
        )
    return (
        <div className="h-3 flex items-center gap-1.5">
            <div className={`h-3 rounded-r-sm min-w-0.5 ${color}`} style={{ width: `${Math.max(0.5, value * 85)}%` }} />
            <span className="font-mono tabular-nums text-[11px] leading-none text-on-surface-variant">{Fmt.score(value)}</span>
        </div>
    )
}

/**
 * A signed change. The number stays in ink (secondary is the very magenta run B's bars wear, so a
 * coloured "−0.004" would read as "B"); the direction rides on a small triangle mark, its colour
 * redundant with its shape. A change that rounds to zero gets no mark.
 */
export function DeltaText({ value, digits = 3, className }: { value: number | null; digits?: number; className?: string }) {
    if (value === null) return <span className={`text-on-surface-variant ${className ?? ''}`}>—</span>
    const negligible = Math.abs(value) < 0.5 / 10 ** digits
    const up = value > 0
    return (
        <span
            className={`inline-flex items-baseline gap-1 font-mono tabular-nums ${negligible ? 'text-on-surface-variant' : 'text-on-surface'} ${className ?? ''}`}>
            {!negligible && (
                <span aria-hidden="true" className={`text-[11px] leading-none ${up ? 'text-primary' : 'text-error'}`}>
                    {up ? '▲' : '▼'}
                </span>
            )}
            {Fmt.delta(value, digits)}
        </span>
    )
}

export function LegendSwatch({
    className,
    label,
    shape = 'bar',
}: {
    className: string
    label: string
    shape?: 'bar' | 'line' | 'outline'
}) {
    const mark =
        shape === 'line'
            ? 'w-4 h-0.5 rounded-full'
            : shape === 'outline'
              ? 'w-3.5 h-2.5 rounded-xs border-[1.5px] bg-transparent'
              : 'w-3 h-2.5 rounded-xs'
    return (
        <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block shrink-0 ${mark} ${className}`} />
            <span className="font-label text-[12px] font-semibold text-on-surface-variant">{label}</span>
        </span>
    )
}

/** A quiet display label (truth source, tier, condition). */
export function Tag({
    children,
    tone = 'neutral',
    title,
}: {
    children: ReactNode
    tone?: 'neutral' | 'quiet' | 'selected'
    title?: string
}) {
    const palette =
        tone === 'selected'
            ? 'bg-primary-soft text-on-primary-soft'
            : tone === 'quiet'
              ? 'bg-surface-container-low text-on-surface-variant'
              : 'bg-surface-container text-on-surface'
    return (
        <span
            title={title}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-label font-semibold text-[11px] leading-none whitespace-nowrap ${palette}`}>
            {children}
        </span>
    )
}

export function TruthTag({ source, inferred }: { source: TruthSource; inferred?: boolean }) {
    return (
        <Tag
            tone={source === 'human' || source === 'resynth' ? 'neutral' : 'quiet'}
            title={inferred ? 'Read from the dataset flags (no truthSource recorded)' : undefined}>
            {Fmt.truthSource(source)}
        </Tag>
    )
}

const STATUS: Record<ResynthStatus, { label: string; icon: 'check' | 'x' | 'loader' | 'circle'; tone: string }> = {
    passed: { label: 'Passed', icon: 'check', tone: 'bg-primary-soft text-on-primary-soft' },
    unresolved: { label: 'Unresolved', icon: 'x', tone: 'bg-secondary-soft text-on-secondary-soft' },
    'in-progress': { label: 'In progress', icon: 'loader', tone: 'bg-surface-container text-on-surface' },
    pending: { label: 'Pending', icon: 'circle', tone: 'bg-surface-container-low text-on-surface-variant' },
}

/** A resynth verdict: icon + word, never colour alone. */
export function StatusTag({ status, rounds }: { status: ResynthStatus; rounds?: number | null }) {
    const s = STATUS[status]
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-label font-semibold text-[11px] leading-none whitespace-nowrap ${s.tone}`}>
            <Icon name={s.icon} size={12} />
            {s.label}
            {rounds != null && rounds > 0 && <span className="font-mono font-medium opacity-80">· r{rounds}</span>}
        </span>
    )
}

/**
 * Resynth progress over a dataset's clips as one stacked bar (passed · unresolved · in progress ·
 * pending), 2px surface gaps between segments, counts beside it.
 */
export function ResynthBar({ progress, compact }: { progress: ResynthProgressDto; compact?: boolean }) {
    const { passed, unresolved, inProgress, pending, total } = progress
    if (progress.calibration) {
        const done = passed + unresolved
        return (
            <Tag tone="quiet" title={`Blind calibration runs: ${done} finished, ${total - done} queued or in the loop`}>
                calibration · {done}
                {done < total ? ` of ${total}` : ''}
            </Tag>
        )
    }
    const segments = [
        { n: passed, className: 'bg-chart-cyan', label: 'passed' },
        { n: unresolved, className: 'bg-chart-magenta', label: 'unresolved' },
        { n: inProgress, className: 'bg-primary-soft', label: 'in progress' },
        { n: pending, className: 'bg-surface-container-high', label: 'pending' },
    ].filter((s) => s.n > 0)
    const title = segments.map((s) => `${s.n} ${s.label}`).join(' · ')
    return (
        <div className={`flex flex-col gap-1 ${compact ? 'min-w-28' : 'min-w-40'}`} title={title}>
            <div className="flex h-2.5 gap-0.5" role="img" aria-label={`Resynth: ${title}`}>
                {segments.map((s) => (
                    <div key={s.label} className={`h-full first:rounded-l-sm last:rounded-r-sm ${s.className}`} style={{ flexGrow: s.n }} />
                ))}
            </div>
            <span className="font-body text-[11px] leading-snug text-on-surface-variant">{title || `${total} pending`}</span>
        </div>
    )
}

export function ResynthLegend() {
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
            <LegendSwatch className="bg-chart-cyan" label="passed" />
            <LegendSwatch className="bg-chart-magenta" label="unresolved" />
            <LegendSwatch className="bg-primary-soft" label="in progress" />
            <LegendSwatch className="bg-surface-container-high" label="pending" />
        </div>
    )
}
