import type { PlanTier } from './plans'

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
 * Where the account stands against its plan's score cap: what the library header and
 * Settings' plan card count, and whether a new score can be made before any form is filled
 * in. One wording for the count everywhere it shows ('3 of 5 free scores').
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

    /**
     * The count against the cap: '3 of 5 free scores', "You've used all 5 free scores." at the
     * cap; null without a cap. Settings' plan card shows it whenever there is a cap.
     */
    get summary(): string | null {
        if (this.cap === null) return null
        // The free tier's scores are "free scores"; another capped tier names itself.
        const free = this.tierId === 'free'
        if (this.atCap) return free ? `You've used all ${this.cap} free scores.` : `You've used all ${this.cap} scores on ${this.tierName}.`
        return free ? `${this.count} of ${this.cap} free scores` : `${this.count} of ${this.cap} scores on ${this.tierName}`
    }

    /** The library's count line: the summary once the cap is near (two below it), so a first score never reads as an upsell. */
    get line(): string | null {
        return this.cap !== null && this.count >= this.cap - 2 ? this.summary : null
    }
}
