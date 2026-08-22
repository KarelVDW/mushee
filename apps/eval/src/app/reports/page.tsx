'use client'

import { useMemo, useState } from 'react'

import { LegendSwatch } from '@/components/NotesCompare'
import { Alert, Card, Chip, Eyebrow, Spinner } from '@/components/ui'
import type { ReportDto } from '@/lib/api'
import { useReportDetail, useReports } from '@/lib/queries'

/**
 * Run-vs-run comparison: pick a baseline and a candidate report, get per-
 * dataset paired bars on the shared 0–1 F1 scale with signed deltas. Two
 * series exactly — that's what the validated cyan/magenta pair covers, and
 * more than two runs side by side is a table job anyway.
 */

type Ref = { root: string; file: string }

const sameRef = (a: Ref | null, b: Ref) => a?.root === b.root && a?.file === b.file

export default function ReportsPage() {
    const reports = useReports()
    const [baseRef, setBaseRef] = useState<Ref | null>(null)
    const [candidateRef, setCandidateRef] = useState<Ref | null>(null)
    const base = useReportDetail(baseRef)
    const candidate = useReportDetail(candidateRef)

    const toggle = (ref: Ref) => {
        if (sameRef(baseRef, ref)) setBaseRef(null)
        else if (sameRef(candidateRef, ref)) setCandidateRef(null)
        else if (!baseRef) setBaseRef(ref)
        else if (!candidateRef) setCandidateRef(ref)
        else setCandidateRef(ref)
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <h1 className="font-headline font-bold text-[1.6rem] leading-tight text-on-surface m-0">Reports</h1>
                <p className="font-body text-[13px] text-on-surface-variant m-0">
                    Every report JSON in the fixtures trees (harness runs and app-triggered runs alike). Pick two to compare:
                    first pick = baseline, second = candidate.
                </p>
            </div>

            {reports.isError && <Alert onRetry={() => reports.refetch()}>Couldn&apos;t list reports: {String(reports.error)}</Alert>}
            {reports.isPending && (
                <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                    <Spinner /> Scanning fixtures…
                </div>
            )}

            {reports.data && (
                <Card className="p-0 overflow-hidden">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="text-left">
                                {['Compare', 'Report', 'Mode', 'Overall F1', 'Datasets', 'Written'].map((h) => (
                                    <th key={h} className="px-5 py-3 font-label text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {reports.data.map((report) => {
                                const ref = { root: report.root, file: report.file }
                                const role = sameRef(baseRef, ref) ? 'baseline' : sameRef(candidateRef, ref) ? 'candidate' : null
                                return (
                                    <tr key={`${report.root}/${report.file}`} className="border-t border-outline-variant/40 hover:bg-surface-container-low">
                                        <td className="px-5 py-2.5">
                                            <Chip active={role !== null} onClick={() => toggle(ref)}>
                                                {role ?? 'pick'}
                                            </Chip>
                                        </td>
                                        <td className="px-5 py-2.5">
                                            <span className="font-body font-semibold text-[13px] text-on-surface">{report.label}</span>
                                            <span className="block font-mono text-[11px] text-on-surface-variant">
                                                {report.root}/{report.file}
                                            </span>
                                        </td>
                                        <td className="px-5 py-2.5 font-body text-[13px] text-on-surface-variant">
                                            {report.mode} · {report.provider}
                                        </td>
                                        <td className="px-5 py-2.5 font-mono text-[13px] text-on-surface">{report.overallF1.toFixed(3)}</td>
                                        <td className="px-5 py-2.5 font-mono text-[13px] text-on-surface">{report.scenarios}</td>
                                        <td className="px-5 py-2.5 font-body text-[12px] text-on-surface-variant">
                                            {new Date(report.modifiedAt).toLocaleString()}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </Card>
            )}

            {(base.isFetching || candidate.isFetching) && (
                <div className="flex items-center gap-2 text-on-surface-variant font-body text-[13px]">
                    <Spinner /> Loading reports…
                </div>
            )}
            {base.data && candidate.data && baseRef && candidateRef && (
                <Comparison base={base.data} candidate={candidate.data} baseName={baseRef.file} candidateName={candidateRef.file} />
            )}
        </div>
    )
}

function Comparison({
    base,
    candidate,
    baseName,
    candidateName,
}: {
    base: ReportDto
    candidate: ReportDto
    baseName: string
    candidateName: string
}) {
    const rows = useMemo(() => {
        const byScenario = new Map(base.perScenario.map((s) => [s.scenario, s]))
        const scenarios = new Set([...base.perScenario.map((s) => s.scenario), ...candidate.perScenario.map((s) => s.scenario)])
        return [...scenarios].sort().map((scenario) => {
            const baseRow = byScenario.get(scenario)
            const candidateRow = candidate.perScenario.find((s) => s.scenario === scenario)
            return { scenario, base: baseRow?.f1 ?? null, candidate: candidateRow?.f1 ?? null, pooled: candidateRow?.pooled ?? baseRow?.pooled ?? true }
        })
    }, [base, candidate])

    const overallDelta = candidate.overallF1 - base.overallF1

    return (
        <Card>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                <Eyebrow>Run vs run — note F1 per dataset (0–1 scale)</Eyebrow>
                <span className="font-mono text-[13px] text-on-surface">
                    overall {base.overallF1.toFixed(3)} → {candidate.overallF1.toFixed(3)}{' '}
                    <DeltaLabel delta={overallDelta} digits={3} />
                </span>
            </div>
            <div className="flex items-center gap-4 mb-4">
                <LegendSwatch color="var(--color-chart-cyan)" label={`baseline · ${baseName}`} />
                <LegendSwatch color="var(--color-chart-magenta)" label={`candidate · ${candidateName}`} />
            </div>
            <div className="flex flex-col gap-3">
                {rows.map((row) => (
                    <div key={row.scenario} className="grid grid-cols-[11rem_1fr_5rem] items-center gap-3">
                        <span className="font-body text-[13px] leading-none text-on-surface truncate">
                            {row.scenario}
                            {!row.pooled && <span className="text-outline"> †</span>}
                        </span>
                        <div className="flex flex-col gap-0.5">
                            <PairBar value={row.base} color="var(--color-chart-cyan)" />
                            <PairBar value={row.candidate} color="var(--color-chart-magenta)" />
                        </div>
                        <span className="font-mono text-[12px] leading-none text-right">
                            {row.base !== null && row.candidate !== null ? <DeltaLabel delta={row.candidate - row.base} digits={2} /> : '—'}
                        </span>
                    </div>
                ))}
            </div>
            <p className="font-body text-[11px] text-on-surface-variant mt-4 mb-0">
                † not pooled into the overall number (derived truth, pitchless, or constructed performance). A dataset missing one
                bar exists in only one report.
            </p>
        </Card>
    )
}

/** One thin bar on the full 0–1 F1 scale with its value label at the end. */
function PairBar({ value, color }: { value: number | null; color: string }) {
    if (value === null)
        return <div className="h-3 flex items-center"><span className="font-mono text-[10px] text-outline">absent</span></div>
    return (
        <div className="h-3 flex items-center gap-1.5">
            <div className="h-3 rounded-r-sm min-w-0.5" style={{ width: `${Math.max(0.5, value * 100)}%`, background: color }} />
            <span className="font-mono text-[10px] leading-none text-on-surface-variant">{value.toFixed(2)}</span>
        </div>
    )
}

function DeltaLabel({ delta, digits }: { delta: number; digits: number }) {
    const magnitude = Math.abs(delta) < 0.5 / 10 ** digits
    return (
        <span className={magnitude ? 'text-on-surface-variant' : delta > 0 ? 'text-primary' : 'text-secondary'}>
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(digits)}
        </span>
    )
}
