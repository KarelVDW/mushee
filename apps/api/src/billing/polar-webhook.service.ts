import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'

import { RecordingCreditsService } from '../recordings/recording-credits.service'
import { SubscriptionsService } from '../subscriptions/subscriptions.service'
import { ProcessedWebhookEvent } from './entities/processed-webhook-event.entity'
import { PACK_SECONDS, packForProduct } from './polar/packs'
import { tierForProduct } from './polar/products'
import { patchFromCustomerState, patchFromSubscription, SubscriptionSnapshot } from './polar/subscription-state'
import { type PolarWebhookEvent, validateEvent, WebhookVerificationError } from './polar/webhook-verify'

/**
 * Inbound side of the Polar integration: verifies webhook deliveries, dedupes
 * them by delivery id, and applies each event to our state.
 */
@Injectable()
export class PolarWebhookService {
    private readonly logger = new Logger(PolarWebhookService.name)

    constructor(
        @InjectRepository(ProcessedWebhookEvent)
        private readonly webhookEvents: Repository<ProcessedWebhookEvent>,
        private readonly subscriptions: SubscriptionsService,
        private readonly credits: RecordingCreditsService,
    ) {}

    /**
     * Validate and process a Polar webhook. Returns false when the delivery is
     * a duplicate (already processed). Throws WebhookVerificationError on bad
     * signatures — the controller maps that to a 403.
     */
    async handleWebhook(rawBody: Buffer | string, headers: Record<string, string>): Promise<boolean> {
        const secret = process.env.POLAR_WEBHOOK_SECRET
        if (!secret) {
            throw new WebhookVerificationError('POLAR_WEBHOOK_SECRET is not configured')
        }
        const event = validateEvent(rawBody, headers, secret)

        // Dedupe + apply in ONE transaction: if applying fails, the dedupe row
        // rolls back with it, so Polar's retry gets a clean attempt instead of
        // being swallowed as a "duplicate" of a delivery that never took effect.
        const deliveryId = headers['webhook-id']
        let applied = false
        await this.webhookEvents.manager.transaction(async (em) => {
            if (deliveryId && !(await this.markProcessed(deliveryId, em))) return
            await this.applyEvent(event, em)
            applied = true
        })
        if (!applied) {
            this.logger.log(`Skipping duplicate webhook delivery ${deliveryId ?? ''}`)
        }
        return applied
    }

    /** Insert the delivery id; false means we've already seen it. */
    private async markProcessed(deliveryId: string, em: EntityManager): Promise<boolean> {
        const result = await em.createQueryBuilder().insert().into(ProcessedWebhookEvent).values({ id: deliveryId }).orIgnore().execute()
        return (result.identifiers?.length ?? 0) > 0
    }

    private async applyEvent(event: PolarWebhookEvent, em: EntityManager): Promise<void> {
        switch (event.type) {
            case 'subscription.created':
            case 'subscription.active':
            case 'subscription.updated':
            case 'subscription.canceled':
            case 'subscription.uncanceled':
            case 'subscription.past_due':
            case 'subscription.revoked': {
                const sub = event.data as SubscriptionSnapshot & {
                    customer?: { externalId?: string | null }
                    metadata?: Record<string, unknown>
                }
                const userId = this.externalUserId(sub)
                if (!userId) {
                    this.logger.warn(`Webhook ${event.type} for subscription ${sub.id} has no external customer id — ignoring`)
                    return
                }
                const patch = patchFromSubscription(sub, tierForProduct)
                if (!patch) {
                    this.logger.warn(`Webhook ${event.type}: product ${sub.productId} is not mapped to a tier — ignoring`)
                    return
                }
                // Polar retries can arrive out of order; never let an older snapshot
                // overwrite newer state (e.g. an old `active` after a `revoked`).
                const existing = await this.subscriptions.findForUser(userId, em)
                if (existing?.lastPolarEventAt && sub.modifiedAt && sub.modifiedAt < existing.lastPolarEventAt) {
                    this.logger.log(
                        `${event.type}: stale event for user ${userId} (modified ${sub.modifiedAt.toISOString()} < applied ${existing.lastPolarEventAt.toISOString()}) — ignoring`,
                    )
                    return
                }
                await this.subscriptions.upsert(userId, patch, em)
                this.logger.log(`${event.type}: user ${userId} → tier ${patch.tierId} (status ${patch.status})`)
                return
            }

            case 'customer.state_changed': {
                const state = event.data as {
                    id: string
                    externalId?: string | null
                    activeSubscriptions: SubscriptionSnapshot[]
                }
                if (!state.externalId) return
                const row = await this.subscriptions.findForUser(state.externalId, em)
                const patch = patchFromCustomerState(state, tierForProduct, row?.tierId)
                if (!patch) return
                await this.subscriptions.upsert(state.externalId, patch, em)
                this.logger.log(`customer.state_changed: user ${state.externalId} → tier ${patch.tierId}`)
                return
            }

            // One-time minute packs. Only `order.paid` grants (never `order.created`
            // / `order.updated`, which would double-credit the same purchase), and
            // only for products mapped to a pack — subscription invoices also arrive
            // as orders and must fall through untouched.
            case 'order.paid': {
                const order = this.asOrder(event.data)
                const packId = packForProduct(order.productId)
                if (!packId) return
                if (!order.userId) {
                    this.logger.warn(`order.paid for pack product ${order.productId} has no external customer id — ignoring`)
                    return
                }
                await this.credits.grantPackSeconds(order.userId, PACK_SECONDS[packId], em)
                this.logger.log(`order.paid: user ${order.userId} +${PACK_SECONDS[packId]}s (${packId} pack)`)
                return
            }

            case 'order.refunded': {
                const order = this.asOrder(event.data)
                const packId = packForProduct(order.productId)
                if (!packId || !order.userId) return
                // Refunds are all-or-nothing for packs; already-recorded seconds
                // clamp at zero rather than going negative.
                await this.credits.revokePackSeconds(order.userId, PACK_SECONDS[packId], em)
                this.logger.log(`order.refunded: user ${order.userId} -${PACK_SECONDS[packId]}s (${packId} pack)`)
                return
            }

            default:
                // Benefits, other order states… — nothing to mirror yet.
                this.logger.debug(`Ignoring webhook event ${event.type}`)
        }
    }

    /** The slice of a Polar order webhook payload this service reads. */
    private asOrder(data: unknown): {
        productId: string | null
        userId: string | null
    } {
        const order = data as {
            productId?: string | null
            product?: { id?: string | null } | null
            customer?: { externalId?: string | null } | null
            metadata?: Record<string, unknown>
        }
        return {
            productId: order.productId ?? order.product?.id ?? null,
            userId: this.externalUserId(order),
        }
    }

    /** Our user id on a subscription or order payload: the Polar customer's
     *  external id, else the `userId` we put in the checkout metadata. */
    private externalUserId(payload: {
        customer?: { externalId?: string | null } | null
        metadata?: Record<string, unknown>
    }): string | null {
        return payload.customer?.externalId ?? (typeof payload.metadata?.userId === 'string' ? payload.metadata.userId : null)
    }
}
