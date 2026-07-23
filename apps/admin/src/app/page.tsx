'use client'

import Link from 'next/link'

import { AdminShell, PageHeading } from '@/components/AdminShell'
import { BarList, DailyBars, StatTile } from '@/components/charts'
import { Alert } from '@/components/ui'
import { formatCount, formatSeconds } from '@/lib/format'
import { useStats } from '@/lib/queries'

export default function DashboardPage() {
    const stats = useStats()

    return (
        <AdminShell>
            <PageHeading eyebrow="Overview" title="Dashboard" />

            {stats.isError && <Alert onRetry={() => void stats.refetch()}>Couldn&apos;t load the stats.</Alert>}
            {stats.isPending && <DashboardSkeleton />}

            {stats.data && (
                <div className="flex flex-col gap-8">
                    <section aria-label="Totals" className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatTile
                            label="Users"
                            value={formatCount(stats.data.totals.users)}
                            detail={`${formatCount(stats.data.totals.newUsers7d)} new in the last 7 days`}
                        />
                        <StatTile
                            label="Active users · 7d"
                            value={formatCount(stats.data.totals.activeUsers7d)}
                            detail="Signed-in sessions this week"
                        />
                        <StatTile label="Scores" value={formatCount(stats.data.totals.scores)} />
                        <StatTile
                            label="Recording time"
                            value={formatSeconds(stats.data.totals.recordingSeconds)}
                            detail={`${formatCount(stats.data.totals.recordings)} recordings all-time`}
                        />
                    </section>

                    {stats.data.totals.waitlistPending > 0 && (
                        <Link
                            href="/waitlist"
                            className="no-underline bg-secondary-soft text-on-secondary-soft rounded-md px-4 py-3 font-body text-[13px] leading-normal hover:bg-secondary-container hover:text-on-secondary-container transition-colors duration-150 ease-solkey">
                            <strong className="font-semibold">{formatCount(stats.data.totals.waitlistPending)}</strong>{' '}
                            {stats.data.totals.waitlistPending === 1 ? 'person is' : 'people are'} waiting for beta approval →
                        </Link>
                    )}

                    <section aria-label="Last 30 days" className="grid md:grid-cols-3 gap-4">
                        <DailyBars title="Signups" points={stats.data.timeseries.map((d) => ({ day: d.day, value: d.signups }))} />
                        <DailyBars title="Scores created" points={stats.data.timeseries.map((d) => ({ day: d.day, value: d.scores }))} />
                        <DailyBars
                            title="Recording time"
                            points={stats.data.timeseries.map((d) => ({ day: d.day, value: d.recordingSeconds }))}
                            formatValue={formatSeconds}
                        />
                    </section>

                    <section aria-label="Plans" className="grid md:grid-cols-2 gap-4">
                        <BarList title="Users per plan" rows={stats.data.tiers.map((t) => ({ label: t.name, value: t.users }))} />
                        <StatTile
                            label="Pack minutes outstanding"
                            value={formatSeconds(stats.data.totals.packSecondsOutstanding)}
                            detail="Purchased or granted recording time users can still spend"
                        />
                    </section>
                </div>
            )}
        </AdminShell>
    )
}

function DashboardSkeleton() {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="bg-surface-container-low rounded-lg h-24 animate-pulse" />
            ))}
        </div>
    )
}
