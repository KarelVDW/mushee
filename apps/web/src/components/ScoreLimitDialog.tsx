'use client'

import { DialogPanel, PrimaryButton, TertiaryButton } from '@/components/ui'
import { formatMoney } from '@/lib/currency'
import { BETA_MODE, planById, type PlanTier } from '@/lib/plans'
import { useBillingState, usePlanCatalogue } from '@/lib/queries'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

interface ScoreAllowanceInit {
    /** Scores in the library (the unfiltered list). */
    count: number
    /** The plan's score cap; null = no cap. */
    cap: number | null
    tierId: string
    tierName: string
    /** The tier an upgrade offers — absent at the top of the ladder and while plans aren't on sale (beta). */
    next?: PlanTier
}

/**
 * Where the account stands against its plan's score cap: what the library header counts and
 * whether a new score can be made before any form is filled in. Quiet until the cap is near
 * (two below it), so a first score never reads as an upsell.
 */
export class ScoreAllowance {
    readonly count: number
    readonly cap: number | null
    readonly tierId: string
    readonly tierName: string
    readonly next: PlanTier | undefined

    constructor({ count, cap, tierId, tierName, next }: ScoreAllowanceInit) {
        this.count = count
        this.cap = cap
        this.tierId = tierId
        this.tierName = tierName
        this.next = next
    }

    /** No room for another score: New score, Import and Duplicate open the limit dialog instead. */
    get atCap(): boolean {
        return this.cap !== null && this.count >= this.cap
    }

    /** The library's count line: '3 of 5 free scores', "You've used all 5 free scores." at the cap, null while it's far off. */
    get line(): string | null {
        if (this.cap === null || this.count < this.cap - 2) return null
        // The free tier's scores are "free scores"; another capped tier names itself.
        const free = this.tierId === 'free'
        if (this.atCap) return free ? `You've used all ${this.cap} free scores.` : `You've used all ${this.cap} scores on ${this.tierName}.`
        return free ? `${this.count} of ${this.cap} free scores` : `${this.count} of ${this.cap} scores on ${this.tierName}`
    }
}

/**
 * The account's {@link ScoreAllowance} for a library of `count` scores; null until both the
 * billing state and the count have resolved, so nothing is counted from a guess.
 */
export function useScoreAllowance(count: number | undefined): ScoreAllowance | null {
    const { data: billing } = useBillingState()
    const plans = usePlanCatalogue()
    if (!billing || count === undefined) return null
    const onSale = !BETA_MODE && !billing.betaMode
    return new ScoreAllowance({
        count,
        cap: plans.maxScoresFor(billing.tierId),
        tierId: billing.tierId,
        tierName: billing.tierName,
        next: onSale ? plans.nextAfter(billing.tierId) : undefined,
    })
}

interface ScoreLimitCopyInit {
    planName: string
    limit: number | null
    next?: PlanTier
    /** The next tier's score cap; null = as many as you like. */
    nextLimit?: number | null
    /** The next tier's monthly price as shown ("$9"). */
    price?: string
}

/** The score-limit dialog's words: a calm plan fact, then the two ways forward in one sentence. */
export class ScoreLimitCopy {
    constructor(private readonly init: ScoreLimitCopyInit) {}

    get title(): string {
        const { planName, limit } = this.init
        return limit !== null ? `Your ${planName} plan holds ${limit} scores.` : "You've reached your plan's score limit."
    }

    get body(): string {
        const { next, nextLimit, price } = this.init
        const deleteOne = "To start a new one, delete a score you don't need"
        if (!next) return `${deleteOne}.`
        const room = nextLimit == null ? 'as many scores as you like' : `up to ${nextLimit} scores`
        return `${deleteOne} — or switch to ${next.name} for ${room}${price ? ` (${price} a month)` : ''}.`
    }
}

interface ScoreLimitDialogProps {
    /** The upgrade: called with the next tier's id, to open Settings on the plan tab with that tier picked. */
    onUpgrade: (planId: PlanTier['id']) => void
    onClose: () => void
}

/**
 * Opens when a new score doesn't fit the plan's cap — before the form when the library knows
 * it is full, or when the API refuses a create (403 code 'score-limit'). A normal moment, not
 * an error: no red, no callout, a flat button. The cap, names and prices come from the
 * database catalogue; the static list only bridges the moment before the queries resolve.
 */
export function ScoreLimitDialog({ onUpgrade, onClose }: ScoreLimitDialogProps) {
    const { data: billing } = useBillingState()
    const plans = usePlanCatalogue()
    const currency = useDisplayCurrency()

    // Only the free tier is capped today, so it is the safe fallback while the billing query resolves.
    const planId = billing?.tierId ?? 'free'
    // Plans aren't on sale during the closed beta: no upgrade to offer then.
    const onSale = !BETA_MODE && !billing?.betaMode
    const next = onSale ? plans.nextAfter(planId) : undefined
    const copy = new ScoreLimitCopy({
        planName: billing?.tierName ?? planById(planId).name,
        limit: plans.maxScoresFor(planId),
        next,
        nextLimit: next ? plans.maxScoresFor(next.id) : null,
        price: next ? formatMoney(next.priceMonthly, currency) : undefined,
    })

    return (
        <DialogPanel
            title={copy.title}
            subtitle="Everything you've written stays safe and editable."
            onClose={onClose}
            width={480}
            footer={
                <>
                    <TertiaryButton onClick={onClose}>Not now</TertiaryButton>
                    {next && (
                        <PrimaryButton icon="arrow-right" onClick={() => onUpgrade(next.id)}>
                            See {next.name}
                        </PrimaryButton>
                    )}
                </>
            }>
            <p className="m-0 pb-2 font-body font-normal text-[14px] leading-normal text-on-surface-variant">{copy.body}</p>
        </DialogPanel>
    )
}
