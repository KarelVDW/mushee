import type { Metadata } from 'next'

import { EmptyNote, PageHeading } from '@/components/Layout'
import { RunList } from '@/components/RunList'
import { Tabs } from '@/components/Tabs'
import type { RunKind } from '@/lib/dto'
import { BenchmarkStore } from '@/server/BenchmarkStore'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Runs' }

const KINDS: Array<{ key: RunKind; label: string }> = [
    { key: 'real', label: 'Real recordings' },
    { key: 'synth', label: 'Synthetic corpus' },
    { key: 'timeline', label: 'Timeline commits' },
]

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
    const { kind: requested } = await searchParams
    const kind: RunKind = KINDS.some((k) => k.key === requested) ? (requested as RunKind) : 'real'
    const counts = Object.fromEntries(KINDS.map((k) => [k.key, BenchmarkStore.list(k.key).length])) as Record<RunKind, number>
    const runs = BenchmarkStore.list(kind).map((r) => r.summary())

    return (
        <>
            <PageHeading eyebrow="Benchmark" title="Runs" />
            <Tabs
                label="Run kinds"
                active={kind}
                tabs={KINDS.filter((k) => k.key !== 'timeline' || counts.timeline > 0).map((k) => ({
                    key: k.key,
                    label: k.label,
                    href: `/runs?kind=${k.key}`,
                    count: counts[k.key],
                }))}
            />
            {kind === 'synth' && (
                <p className="font-body text-[13px] text-on-surface-variant -mt-2 mb-4 max-w-3xl text-pretty">
                    A synthetic benchmark is one run per recording condition; runs from one commit and label belong together. Superseded
                    corpus versions (<code className="font-mono">synth/archive/</code>) are not listed.
                </p>
            )}
            {runs.length === 0 ? (
                <EmptyNote title="No runs of this kind yet">
                    <p className="m-0">
                        <code>apps/api/scripts/eval/benchmark.ts run{kind === 'synth' ? ' --synth' : ''}</code> writes one JSON per run into{' '}
                        <code>apps/eval/data/benchmarks/{kind}/</code>.
                    </p>
                </EmptyNote>
            ) : (
                <RunList runs={runs} synth={kind === 'synth'} />
            )}
        </>
    )
}
