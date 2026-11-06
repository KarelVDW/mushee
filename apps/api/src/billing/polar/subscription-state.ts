/**
 * Pure mapping from Polar webhook payloads to `user_subscriptions` row
 * patches. Kept free of Nest/TypeORM so the billing state machine is easy
 * to unit test.
 *
 * Polar's canonical customer key is the customer's `external_id`, which we
 * always set to the Solkey user id at checkout.
 */

import { isPaidTierId } from './products'
import type { models } from './sdk'

export interface SubscriptionSnapshot {
    id: string
    status: string
    productId: string
    customerId?: string
    currentPeriodEnd?: Date | null
    cancelAtPeriodEnd?: boolean
    /** Polar's `modified_at` — used to drop out-of-order webhook retries. */
    modifiedAt?: Date | null
}

/** A subscription as Polar sends it: in subscription.* events, or inside a
 *  customer.state_changed snapshot (which carries no customer id). */
export type PolarSubscription = models.Subscription | models.CustomerStateSubscription

/**
 * Our view of a Polar subscription. Polar payloads are snake_case with ISO
 * timestamp strings; the state machine below works on Dates.
 */
export function snapshotFromPolar(sub: PolarSubscription): SubscriptionSnapshot {
    return {
        id: sub.id,
        status: sub.status,
        productId: sub.product_id,
        customerId: 'customer_id' in sub ? sub.customer_id : undefined,
        currentPeriodEnd: parseTimestamp(sub.current_period_end),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        modifiedAt: parseTimestamp(sub.modified_at),
    }
}

/** An ISO timestamp from a Polar payload; null when absent or unparseable. */
function parseTimestamp(value: string | null | undefined): Date | null {
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

export interface SubscriptionRowPatch {
    tierId: string
    polarCustomerId: string | null
    polarSubscriptionId: string | null
    polarProductId: string | null
    status: string | null
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
    lastPolarEventAt: Date | null
}

/** Statuses during which the customer keeps the paid tier. `past_due` keeps
 *  access while Polar retries payment; Polar emits `subscription.revoked`
 *  when it finally gives up. */
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function isEntitledStatus(status: string): boolean {
    return ENTITLED_STATUSES.has(status)
}

/**
 * Compute the row patch for a subscription lifecycle event.
 * `resolveTier` maps a Polar product id to a tier id (a PaidTierId).
 * Returns null when the product isn't one of ours (e.g. a stray sandbox
 * product) — the event should then be acknowledged but ignored.
 */
export function patchFromSubscription(
    sub: SubscriptionSnapshot,
    resolveTier: (productId: string) => string | null,
): SubscriptionRowPatch | null {
    const tierId = resolveTier(sub.productId)
    if (!tierId) return null

    if (isEntitledStatus(sub.status)) {
        return {
            tierId,
            polarCustomerId: sub.customerId ?? null,
            polarSubscriptionId: sub.id,
            polarProductId: sub.productId,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
            lastPolarEventAt: sub.modifiedAt ?? null,
        }
    }

    // Revoked / ended: back to the free tier, keep the customer link for the
    // billing history but clear the dead subscription.
    return {
        tierId: 'free',
        polarCustomerId: sub.customerId ?? null,
        polarSubscriptionId: null,
        polarProductId: null,
        status: sub.status,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        lastPolarEventAt: sub.modifiedAt ?? null,
    }
}

/**
 * Reconcile from a `customer.state_changed` snapshot: the state carries every
 * *active* subscription, so an empty list means no entitlement. Returns null
 * when nothing in the snapshot maps to one of our products AND the customer
 * has no active subscriptions we ever knew about (nothing to change).
 */
export function patchFromCustomerState(
    state: {
        id: string
        activeSubscriptions: SubscriptionSnapshot[]
    },
    resolveTier: (productId: string) => string | null,
    currentTierId: string | undefined,
): SubscriptionRowPatch | null {
    const entitled = state.activeSubscriptions.find((sub) => resolveTier(sub.productId) !== null && isEntitledStatus(sub.status))

    if (entitled) {
        return patchFromSubscription({ ...entitled, customerId: state.id }, resolveTier)
    }

    // No active paid subscription. Only downgrade users who currently hold a
    // paid tier — never touch 'beta' (waitlist users can't buy) or 'free'.
    if (currentTierId && isPaidTierId(currentTierId)) {
        return {
            tierId: 'free',
            polarCustomerId: state.id,
            polarSubscriptionId: null,
            polarProductId: null,
            status: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            lastPolarEventAt: null,
        }
    }
    return null
}
