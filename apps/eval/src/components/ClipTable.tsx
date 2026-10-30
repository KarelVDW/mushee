'use client'

import { Chip, TextField } from '@mushee/ui'
import { useMemo, useState } from 'react'

import type { ClipRowDto, ResynthStatus } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'

import { ScoreBar, StatusTag } from './Marks'
import { Cell, Head, Row, RowLink, Table } from './Table'

type Sort = 'name' | 'worst' | 'best' | 'longest'

const SORTS: Array<{ key: Sort; label: string }> = [
    { key: 'name', label: 'Name' },
    { key: 'worst', label: 'Lowest COnP' },
    { key: 'best', label: 'Highest COnP' },
    { key: 'longest', label: 'Longest' },
]

const STATUSES: Array<{ key: ResynthStatus; label: string }> = [
    { key: 'passed', label: 'Passed' },
    { key: 'unresolved', label: 'Unresolved' },
    { key: 'in-progress', label: 'In progress' },
    { key: 'pending', label: 'Pending' },
]

/** A dataset's clips with a name filter, a resynth status filter and a sort. A row opens the clip's compare view. */
export function ClipTable({
    dataset,
    clips,
    hasResynth,
    pitchless,
}: {
    dataset: string
    clips: ClipRowDto[]
    hasResynth: boolean
    pitchless: boolean
}) {
    const [query, setQuery] = useState('')
    const [status, setStatus] = useState<ResynthStatus | null>(null)
    const [sort, setSort] = useState<Sort>('name')

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase()
        const filtered = clips.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!status || (c.status ?? 'pending') === status))
        const score = (c: ClipRowDto) => (pitchless ? c.onF1 : c.f1)
        if (sort === 'worst') return [...filtered].sort((a, b) => (score(a) ?? 2) - (score(b) ?? 2))
        if (sort === 'best') return [...filtered].sort((a, b) => (score(b) ?? -1) - (score(a) ?? -1))
        if (sort === 'longest') return [...filtered].sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))
        return filtered
    }, [clips, query, status, sort, pitchless])

    const counts = useMemo(() => {
        const out: Partial<Record<ResynthStatus, number>> = {}
        for (const c of clips) out[c.status ?? 'pending'] = (out[c.status ?? 'pending'] ?? 0) + 1
        return out
    }, [clips])

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="w-full sm:w-72">
                    <TextField
                        value={query}
                        onChange={setQuery}
                        placeholder="Filter clips…"
                        ariaLabel="Filter clips by name"
                        leftIcon="search"
                    />
                </div>
                {hasResynth && (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Resynth status">
                        {STATUSES.filter((s) => counts[s.key]).map((s) => (
                            <Chip key={s.key} active={status === s.key} onClick={() => setStatus(status === s.key ? null : s.key)}>
                                {s.label} {counts[s.key]}
                            </Chip>
                        ))}
                    </div>
                )}
                <div className="flex flex-wrap gap-1.5 sm:ml-auto" role="group" aria-label="Sort clips">
                    {SORTS.map((s) => (
                        <Chip key={s.key} active={sort === s.key} onClick={() => setSort(s.key)}>
                            {s.label}
                        </Chip>
                    ))}
                </div>
            </div>
            <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow">
                <Table minWidth="min-w-200">
                    <Head
                        columns={[
                            'Clip',
                            { label: 'Length', align: 'right' },
                            { label: 'Notes', align: 'right' },
                            ...(hasResynth ? ['Resynth'] : []),
                            pitchless ? 'Onset F1 (latest)' : 'COnP (latest)',
                        ]}
                    />
                    <tbody>
                        {rows.map((c) => (
                            <Row key={c.name}>
                                <Cell className="max-w-120">
                                    <RowLink href={Route.clip(dataset, c.name)}>
                                        <span className="font-mono text-[13px] font-medium break-all">{c.name}</span>
                                    </RowLink>
                                </Cell>
                                <Cell align="right" mono className="text-on-surface-variant">
                                    {Fmt.clock(c.durationSec)}
                                </Cell>
                                <Cell align="right" mono>
                                    {c.notes ?? '—'}
                                </Cell>
                                {hasResynth && (
                                    <Cell>
                                        {c.status ? <StatusTag status={c.status} rounds={c.rounds} /> : <StatusTag status="pending" />}
                                    </Cell>
                                )}
                                <Cell className="w-56">
                                    <ScoreBar value={pitchless ? c.onF1 : c.f1} />
                                </Cell>
                            </Row>
                        ))}
                    </tbody>
                </Table>
                {rows.length === 0 && <p className="font-body text-[14px] text-on-surface-variant m-0 px-5 py-4">No clip matches.</p>}
            </div>
            <p className="font-body text-[12px] text-on-surface-variant m-0">
                {rows.length} of {clips.length} clips
            </p>
        </div>
    )
}
