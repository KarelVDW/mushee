'use client'

import { Chip, PrimaryButton } from '@mushee/ui'
import { useState } from 'react'

import type { RunSummaryDto } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import { Route } from '@/lib/routes'

import { Tag } from './Marks'
import { Cell, Head, Row, RowLink, Table } from './Table'

/**
 * Every run of one kind, newest first. A row opens the run; the A/B chips pick two runs for a
 * side-by-side comparison (first pick A, second B, a third replaces B).
 */
export function RunList({ runs, synth }: { runs: RunSummaryDto[]; synth?: boolean }) {
    const [a, setA] = useState<string | null>(null)
    const [b, setB] = useState<string | null>(null)

    const pick = (id: string) => {
        if (a === id) setA(null)
        else if (b === id) setB(null)
        else if (!a) setA(id)
        else setB(id)
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 min-h-10">
                <span className="font-body text-[13px] text-on-surface-variant">
                    {a && b ? 'Ready to compare.' : a ? 'Now pick run B.' : 'Pick two runs to compare them dataset by dataset.'}
                </span>
                {a && b && <PrimaryButton href={Route.compare(a, b)}>Compare A with B</PrimaryButton>}
            </div>
            <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow">
                <Table minWidth="min-w-220">
                    <Head
                        columns={[
                            'Pick',
                            'Run',
                            'Date',
                            synth ? 'Condition' : 'Conditions',
                            { label: 'COnP', align: 'right' },
                            { label: 'Human only', align: 'right' },
                            { label: 'COnPOff', align: 'right' },
                            { label: 'Datasets', align: 'right' },
                            { label: 'Clips', align: 'right' },
                            { label: 'Took', align: 'right' },
                        ]}
                    />
                    <tbody>
                        {runs.map((run) => {
                            const role = a === run.id ? 'A' : b === run.id ? 'B' : null
                            return (
                                <Row key={run.id}>
                                    <Cell>
                                        {/* Above the row's stretched link, so picking never opens the run. */}
                                        <span className="relative z-10">
                                            <Chip
                                                active={role !== null}
                                                onClick={() => pick(run.id)}
                                                ariaLabel={role ? `Unpick ${run.label}` : `Pick ${run.label} to compare`}>
                                                {role ?? 'pick'}
                                            </Chip>
                                        </span>
                                    </Cell>
                                    <Cell>
                                        <RowLink href={Route.run(run.id)} sub={`${run.gitSha}${run.gitDirty ? '* dirty tree' : ''}`}>
                                            {run.label}
                                        </RowLink>
                                    </Cell>
                                    <Cell mono className="whitespace-nowrap text-on-surface-variant">
                                        {Fmt.dateTime(run.date)}
                                    </Cell>
                                    <Cell>
                                        <span className="flex flex-wrap gap-1">
                                            {run.quick && !synth ? (
                                                <Tag tone="quiet">quick · real only</Tag>
                                            ) : (
                                                run.conditions.map((c) => (
                                                    <Tag key={c} tone="quiet">
                                                        {c}
                                                    </Tag>
                                                ))
                                            )}
                                        </span>
                                    </Cell>
                                    <Cell align="right" mono>
                                        <span className="font-semibold text-on-surface">{Fmt.score(run.overallF1)}</span>
                                    </Cell>
                                    <Cell align="right" mono>
                                        {synth ? '—' : Fmt.score(run.overallF1Human)}
                                    </Cell>
                                    <Cell align="right" mono>
                                        {Fmt.score(run.overallF1Off)}
                                    </Cell>
                                    <Cell align="right" mono>
                                        {run.pooledCount}/{run.datasetCount}
                                    </Cell>
                                    <Cell align="right" mono>
                                        {Fmt.count(run.clipCount)}
                                    </Cell>
                                    <Cell align="right" mono className="whitespace-nowrap text-on-surface-variant">
                                        {Fmt.duration(run.durationSec)}
                                    </Cell>
                                </Row>
                            )
                        })}
                    </tbody>
                </Table>
            </div>
        </div>
    )
}
