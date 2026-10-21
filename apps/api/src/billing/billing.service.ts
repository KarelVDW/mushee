import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'

import { isBetaMode } from '../beta/beta-config'
import { RecordingCreditsService } from '../recordings/recording-credits.service'
import { SubscriptionsService } from '../subscriptions/subscriptions.service'
import { isBillingConfigured, polarClient } from './polar/client'
import { PackId, productIdForPack } from './polar/packs'
import { BillingInterval, intervalForProduct, PaidTierId, productIdFor } from './polar/products'

export interface BillingState {
    tierId: string
    tierName: string
    /** Polar subscription status, null on free/beta tiers. */
    status: string | null
    /** Billing cadence of the active subscription, null on free/beta tiers. */
    interval: BillingInterval | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    /** False when POLAR_ACCESS_TOKEN isn't set — the UI hides paid actions. */
    billingConfigured: boolean
    betaMode: boolean
    credits: {
        limitSeconds: number | null
        usedSeconds: number
        remainingSeconds: number | null
        /** Purchased one-time pack seconds; never expire. */
        packSeconds: number
    }
}

/**
 * Polar-backed billing. Checkout and the customer portal are hosted by
 * Polar (they are the merchant of record); this service only creates the
 * redirect sessions and mirrors subscription state from webhooks into
 * `user_subscriptions`.
 */
@Injectable()
export class BillingService {
    private readonly logger = new Logger(BillingService.name)

    constructor(
        private readonly subscriptions: SubscriptionsService,
        private readonly credits: RecordingCreditsService,
    ) {}

    async getState(userId: string): Promise<BillingState> {
        const row = await this.subscriptions.findForUser(userId)
        const tier = await this.subscriptions.tierById(row?.tierId)
        const balance = await this.credits.balance(userId)
        return {
            tierId: tier.id,
            tierName: tier.name,
            status: row?.status ?? null,
            interval: intervalForProduct(row?.polarProductId),
            currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
            billingConfigured: isBillingConfigured(),
            betaMode: isBetaMode(),
            credits: {
                limitSeconds: tier.dailyRecordingCredits,
                usedSeconds: balance.used,
                remainingSeconds: balance.remaining,
                packSeconds: balance.packSeconds,
            },
        }
    }

    /**
     * Create a Polar checkout session and return its hosted URL. The customer
     * IP is forwarded because sessions are created server-side: Polar picks
     * the presentment currency (USD/EUR) by geolocating that IP — without it,
     * every customer would be priced from the server's location.
     */
    async createCheckout(
        user: { id: string; email: string },
        tierId: PaidTierId,
        interval: BillingInterval,
        customerIp?: string,
    ): Promise<{ url: string }> {
        if (isBetaMode()) {
            throw new ForbiddenException('Plans cannot be purchased during the beta — everyone is on the beta plan.')
        }
        const polar = this.requirePolar()
        const productId = productIdFor(tierId, interval)
        if (!productId) {
            throw new BadRequestException(`The ${tierId} (${interval}) plan is not available yet.`)
        }

        const checkout = await polar.checkouts.create({
            products: [productId],
            externalCustomerId: user.id,
            customerEmail: user.email,
            customerIpAddress: customerIp,
            successUrl: `${this.webAppUrl()}/settings?checkout=success`,
            metadata: { userId: user.id },
        })
        return { url: checkout.url }
    }

    /**
     * Create a Polar checkout for a one-time minute pack. Packs are one-off
     * products (no subscription); the grant lands via the `order.paid` webhook.
     */
    async createPackCheckout(user: { id: string; email: string }, packId: PackId, customerIp?: string): Promise<{ url: string }> {
        if (isBetaMode()) {
            throw new ForbiddenException('Packs cannot be purchased during the beta — everyone is on the beta plan.')
        }
        const polar = this.requirePolar()
        const productId = productIdForPack(packId)
        if (!productId) {
            throw new BadRequestException(`The ${packId} pack is not available yet.`)
        }

        const checkout = await polar.checkouts.create({
            products: [productId],
            externalCustomerId: user.id,
            customerEmail: user.email,
            customerIpAddress: customerIp,
            successUrl: `${this.webAppUrl()}/settings?pack=success`,
            metadata: { userId: user.id, packId },
        })
        return { url: checkout.url }
    }

    /** Hosted Polar customer portal (invoices, payment method, cancellation). */
    async createPortalSession(userId: string): Promise<{ url: string }> {
        const polar = this.requirePolar()
        const session = await polar.customerSessions.create({
            externalCustomerId: userId,
            returnUrl: `${this.webAppUrl()}/settings`,
        })
        return { url: session.customerPortalUrl }
    }

    /**
     * Switch an existing subscription to another product (tier or cadence).
     * Polar prorates the difference; the webhook confirms the final state.
     * Users without an active subscription go through checkout instead.
     */
    async changePlan(userId: string, tierId: PaidTierId, interval: BillingInterval): Promise<BillingState> {
        const polar = this.requirePolar()
        const row = await this.subscriptions.findForUser(userId)
        if (!row?.polarSubscriptionId) {
            throw new BadRequestException('No active subscription to change — start a checkout instead.')
        }
        const productId = productIdFor(tierId, interval)
        if (!productId) {
            throw new BadRequestException(`The ${tierId} (${interval}) plan is not available yet.`)
        }
        await polar.subscriptions.update({
            id: row.polarSubscriptionId,
            subscriptionUpdate: { productId },
        })
        await this.subscriptions.upsert(userId, { tierId, polarProductId: productId })
        return this.getState(userId)
    }

    /** Schedule cancellation at period end (the plan stays active until then). */
    async cancelAtPeriodEnd(userId: string): Promise<BillingState> {
        return this.setCancellation(userId, true)
    }

    /** Undo a scheduled cancellation. */
    async resumeSubscription(userId: string): Promise<BillingState> {
        return this.setCancellation(userId, false)
    }

    private async setCancellation(userId: string, cancel: boolean): Promise<BillingState> {
        const polar = this.requirePolar()
        const row = await this.subscriptions.findForUser(userId)
        if (!row?.polarSubscriptionId) {
            throw new BadRequestException('No active subscription to change.')
        }
        await polar.subscriptions.update({
            id: row.polarSubscriptionId,
            subscriptionUpdate: { cancelAtPeriodEnd: cancel },
        })
        // Mirror immediately; the webhook confirms shortly after.
        await this.subscriptions.upsert(userId, { cancelAtPeriodEnd: cancel })
        return this.getState(userId)
    }

    /** GDPR cleanup of the Polar customer when an account is purged. */
    async deletePolarCustomer(userId: string): Promise<void> {
        const polar = polarClient()
        if (!polar) return
        try {
            await polar.customers.deleteExternal({ externalId: userId })
            this.logger.log(`Deleted Polar customer for purged account ${userId}`)
        } catch (err: unknown) {
            // Not existing is fine (the user never checked out). Anything else must
            // fail the purge so the hourly cron retries — the privacy policy
            // promises we ask Polar to delete the customer record.
            const status =
                (err as { statusCode?: number; status?: number }).statusCode ?? (err as { statusCode?: number; status?: number }).status
            if (status === 404) return
            throw err
        }
    }

    private requirePolar() {
        const polar = polarClient()
        if (!polar) {
            throw new ServiceUnavailableException('Billing is not configured on this environment.')
        }
        return polar
    }

    private webAppUrl(): string {
        return (process.env.WEB_APP_URL ?? process.env.CORS_ORIGIN ?? 'http://localhost:3200').replace(/\/$/, '')
    }
}
