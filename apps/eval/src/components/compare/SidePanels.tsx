import { Eyebrow, TextLink } from '@mushee/ui'
import Link from 'next/link'

import type { ClipCompareDto, ResynthPanelDto } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'

import { Card } from '../Card'
import { StatusTag } from '../Marks'

/** The judge's verdict and the loop's live state for one clip. */
export function ResynthPanel({ resynth }: { resynth: ResynthPanelDto | null }) {
    if (!resynth)
        return (
            <Card>
                <Eyebrow className="block mb-2">Resynth</Eyebrow>
                <p className="font-body text-[13px] text-on-surface-variant m-0 text-pretty">
                    This clip has not been through the resynth loop. The roll shows the dataset&apos;s own truth.
                </p>
            </Card>
        )
    const { verdict, work } = resynth
    return (
        <Card>
            <div className="flex items-center justify-between gap-2 mb-3">
                <Eyebrow>Resynth verdict</Eyebrow>
                <StatusTag status={resynth.status} rounds={verdict?.rounds ?? work?.round} />
            </div>
            {verdict && (
                <div className="flex flex-col gap-2">
                    {verdict.summary && (
                        <p className="font-body text-[13px] leading-relaxed text-on-surface m-0 text-pretty">{verdict.summary}</p>
                    )}
                    <Metrics rows={verdict.metrics} />
                    <p className="font-body text-[11px] text-on-surface-variant m-0">
                        Committed {Fmt.dateTime(verdict.createdAt)}
                        {verdict.prior ? ` · prior: ${verdict.prior}` : ''}
                        {verdict.tool ? ` · ${verdict.tool}` : ''}
                    </p>
                </div>
            )}
            {work && (
                <div
                    className={`flex flex-col gap-2 ${verdict ? 'mt-4 pt-4 bg-surface-container-low -mx-5 px-5 pb-1 rounded-b-lg -mb-4' : ''}`}>
                    <span className="font-label font-semibold text-[12px] text-on-surface">
                        Work state · {work.status}
                        {work.round != null ? ` · round ${work.round}` : ''}
                    </span>
                    <span className="font-mono text-[11px] text-on-surface-variant">
                        spec v{work.specVersion ?? '?'} · judged v{work.judgedVersion ?? '—'} · updated {Fmt.dateTime(work.updatedAt)}
                    </span>
                    {(work.judgeVerdict || work.judgeSummary) && (
                        <p className="font-body text-[13px] leading-relaxed text-on-surface m-0 text-pretty">
                            {work.judgeVerdict && <strong className="font-semibold">{work.judgeVerdict}. </strong>}
                            {work.judgeSummary}
                        </p>
                    )}
                    {work.judgeFeedback.length > 0 && (
                        <ol className="m-0 pl-5 flex flex-col gap-1 font-body text-[12px] leading-snug text-on-surface-variant">
                            {work.judgeFeedback.slice(0, 12).map((f, i) => (
                                <li key={i}>{f}</li>
                            ))}
                        </ol>
                    )}
                    <Metrics rows={work.reportMetrics} />
                    {work.diffs.length > 0 && (
                        <div className="flex flex-col gap-1 mt-1">
                            <span className="font-label font-semibold text-[12px] text-on-surface">Open differences</span>
                            <ul className="m-0 p-0 list-none flex flex-col gap-1">
                                {work.diffs.slice(0, 8).map((d) => (
                                    <li key={d.id} className="font-body text-[12px] leading-snug text-on-surface-variant">
                                        <span className="font-mono font-semibold text-on-surface">{d.id}</span>{' '}
                                        <span className="font-mono">
                                            {d.t0.toFixed(2)}–{d.t1.toFixed(2)}
                                        </span>{' '}
                                        {d.type} · {d.text}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </Card>
    )
}

function Metrics({ rows }: { rows: Array<{ key: string; value: string }> }) {
    if (!rows.length) return null
    return (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 m-0">
            {rows.map((r) => (
                <div key={r.key} className="contents">
                    <dt className="font-body text-[12px] text-on-surface-variant">{r.key}</dt>
                    <dd className="m-0 font-mono tabular-nums text-[12px] text-on-surface text-right">{r.value}</dd>
                </div>
            ))}
        </dl>
    )
}

/** This clip's score in every run that scored it, newest first. */
export function ScoresPanel({ scores, pitchless }: { scores: ClipCompareDto['scores']; pitchless: boolean }) {
    return (
        <Card>
            <Eyebrow className="block mb-3">{pitchless ? 'Onset F1 per run' : 'COnP per run'}</Eyebrow>
            {scores.length === 0 ? (
                <p className="font-body text-[13px] text-on-surface-variant m-0">No benchmark run scored this clip.</p>
            ) : (
                <ul className="m-0 p-0 list-none flex flex-col gap-2">
                    {scores.map((s) => (
                        <li key={`${s.runId}/${s.cond}`} className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0">
                                <TextLink as={Link} href={Route.run(s.runId)} className="text-[13px]">
                                    {s.label}
                                </TextLink>
                                <span className="block font-mono text-[11px] text-on-surface-variant">
                                    {Fmt.date(s.date)}
                                    {s.cond !== 'real' ? ` · ${s.cond}` : ''}
                                </span>
                            </span>
                            <span className="font-mono tabular-nums text-[14px] font-semibold text-on-surface">
                                {Fmt.score(pitchless ? s.onF1 : s.f1)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    )
}

/** The comparison panels the judge reads (original and copy spectrograms with f0 and note boxes, onset envelopes). */
export function JudgePanels({ dataset, clip, resynth }: { dataset: string; clip: string; resynth: ResynthPanelDto | null }) {
    const panels = resynth?.work?.panels ?? []
    if (!panels.length) return null
    return (
        <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <Eyebrow>What the judge sees</Eyebrow>
                <span className="font-body text-[12px] text-on-surface-variant">
                    spec v{resynth?.work?.specVersion ?? '?'} · the latest compare report
                </span>
            </div>
            <div className="flex flex-col gap-4">
                {panels.map((p) => (
                    <figure key={p.file} className="m-0 flex flex-col gap-1">
                        {/* A local, unoptimised PNG the resynth tool re-renders in place: next/image would only cache it. */}
                        <img
                            src={`/api/resynth-panel?ds=${encodeURIComponent(dataset)}&clip=${encodeURIComponent(clip)}&file=${encodeURIComponent(p.file)}&v=${resynth?.work?.specVersion ?? 0}`}
                            alt={`Comparison panel ${p.t0.toFixed(1)}–${p.t1.toFixed(1)} s: original and copy spectrograms with pitch and note boxes`}
                            loading="lazy"
                            className="w-full h-auto rounded-md bg-surface-container-low"
                        />
                        <figcaption className="font-mono text-[11px] text-on-surface-variant">
                            {p.file} · {p.t0.toFixed(1)}–{p.t1.toFixed(1)} s
                        </figcaption>
                    </figure>
                ))}
            </div>
        </Card>
    )
}
