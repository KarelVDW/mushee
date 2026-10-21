import type { ReactNode } from 'react'

import { Icon } from '@/components/ui'
import { type BetaPlan, planFeatures } from '@/lib/plans'

/**
 * The closed-beta plan as a card: its icon, a heading each page words for
 * itself, then the plan's recording budget, score cap and features. Pass the
 * plan merged with the database (usePlanCatalogue().beta) so the limits shown
 * are the ones the server enforces.
 */
export function BetaPlanCard({ plan, title }: { plan: BetaPlan; title: ReactNode }) {
    return (
        <div className="flex items-start gap-4 bg-surface-container-low rounded-md p-5">
            <span className="w-12 h-12 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center shrink-0">
                <Icon name={plan.icon} size={22} />
            </span>
            <div className="flex flex-col gap-1.5">
                <span className="font-body font-semibold text-[15px] leading-[1.3] text-on-surface">{title}</span>
                <ul className="list-none p-0 m-0 flex flex-col gap-1">
                    {planFeatures(plan).map((f) => (
                        <li
                            key={f}
                            className="flex items-start gap-2 font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
                            <span className="mt-px opacity-80">
                                <Icon name="check" size={14} />
                            </span>
                            {f}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}
