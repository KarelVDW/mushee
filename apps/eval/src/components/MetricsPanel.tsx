'use client'

import { Eyebrow } from '@/components/ui'

/**
 * The harness's per-clip numbers, shaped like run-eval's report: note F1 and
 * friends, then the segmentation taxonomy (read `missed` first — it's the
 * expensive one).
 */

interface MetricsPanelProps {
    metrics: Record<string, unknown>
}

function num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-4 py-3 flex flex-col gap-1.5">
            <Eyebrow>{label}</Eyebrow>
            <span className="font-mono text-[22px] leading-none text-on-surface tracking-[-0.02em]">{value}</span>
            {detail && <span className="font-body text-[11px] leading-snug text-on-surface-variant">{detail}</span>}
        </div>
    )
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
    const f1 = num(metrics.f1)
    const precision = num(metrics.precision)
    const recall = num(metrics.recall)
    const chromaF1 = num(metrics.chromaF1)
    const octaveErrorRate = num(metrics.octaveErrorRate)
    const onsetOnly = (metrics.onsetOnly ?? {}) as Record<string, unknown>
    const seg = (metrics.seg ?? {}) as Record<string, unknown>
    const timing = (metrics.timing ?? {}) as Record<string, unknown>

    const pct = (v: number | null) => (v === null ? '—' : v.toFixed(2))
    const segLine = (['missed', 'spurious', 'split', 'merged'] as const).map((k) => `${k} ${num(seg[k]) ?? 0}`).join(' · ')

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Note F1 (COnP@0.1)" value={pct(f1)} detail={`precision ${pct(precision)} · recall ${pct(recall)}`} />
            <Tile label="Chroma F1" value={pct(chromaF1)} detail={`octave errors ${pct(octaveErrorRate)}`} />
            <Tile label="Onset F1 (COn)" value={pct(num(onsetOnly.f1))} detail={`recall ${pct(num(onsetOnly.recall))}`} />
            <Tile
                label="Segmentation"
                value={String(num(seg.clean) ?? '—')}
                detail={`${segLine} · onset bias ${num(timing.onsetBiasMs)?.toFixed(0) ?? '—'} ms`}
            />
        </div>
    )
}
