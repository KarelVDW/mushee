'use client'

import { AdminShell, PageHeading } from '@/components/AdminShell'
import { Alert, Pill } from '@/components/ui'
import { formatCount, formatSeconds } from '@/lib/format'
import { useTiers } from '@/lib/queries'

/**
 * Read-only view of the subscription_tiers table — the DB-driven entitlement
 * config behind /plans. Pricing itself lives in Polar; changes here go
 * through migrations, so the console only surfaces the current values.
 */
export default function TiersPage() {
    const tiers = useTiers()

    return (
        <AdminShell>
            <PageHeading eyebrow="Plans" title="Tiers" />

            {tiers.isError && <Alert onRetry={() => void tiers.refetch()}>Couldn&apos;t load the tiers.</Alert>}

            {tiers.data && (
                <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow overflow-x-auto">
                    <table className="w-full border-collapse min-w-140">
                        <thead>
                            <tr className="text-left">
                                {['Tier', 'Daily recording', 'Score cap', 'Users', 'Visibility'].map((heading) => (
                                    <th
                                        key={heading}
                                        className="bg-surface-container-low font-label font-semibold text-[11px] tracking-[0.12em] uppercase text-on-surface-variant px-4 py-3">
                                        {heading}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {tiers.data.map((tier) => (
                                <tr key={tier.id}>
                                    <td className="px-4 py-3">
                                        <span className="block font-body font-medium text-[14px] leading-tight text-on-surface">
                                            {tier.name}
                                        </span>
                                        <span className="block font-mono text-[11px] leading-tight text-on-surface-variant">{tier.id}</span>
                                    </td>
                                    <td className="px-4 py-3 font-body text-[13px] text-on-surface">
                                        {tier.dailyRecordingCredits === null ? 'Unlimited' : `${formatSeconds(tier.dailyRecordingCredits)} / day`}
                                    </td>
                                    <td className="px-4 py-3 font-body text-[13px] text-on-surface">
                                        {tier.maxScores === null ? 'No cap' : `${tier.maxScores} scores`}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-on-surface-variant">{formatCount(tier.userCount)}</td>
                                    <td className="px-4 py-3">{tier.sellable ? <Pill tone="cyan">Sellable</Pill> : <Pill>Internal</Pill>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="font-body text-[12px] leading-normal text-on-surface-variant mt-4">
                Entitlements are database config (surfaced to the product via <code className="font-mono">GET /plans</code>); prices and
                checkout live in Polar. Changing a tier means a migration, not a console action.
            </p>
        </AdminShell>
    )
}
