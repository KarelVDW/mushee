import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { isBetaMode } from '../beta/beta-config';
import { RecordingCreditsService } from '../recordings/recording-credits.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionTier } from '../subscriptions/SubscriptionTier';
import { ProcessedWebhookEvent } from './entities/processed-webhook-event.entity';
import { isBillingConfigured, polarClient } from './polar.client';
import {
  BillingInterval,
  intervalForProduct,
  PaidTierId,
  productIdFor,
  tierForProduct,
} from './polar-products';
import { validateEvent, WebhookVerificationError } from './polar-webhooks';
import {
  patchFromCustomerState,
  patchFromSubscription,
  SubscriptionSnapshot,
} from './subscription-state';

export interface BillingState {
  tierId: string;
  tierName: string;
  /** Polar subscription status, null on free/beta tiers. */
  status: string | null;
  /** Billing cadence of the active subscription, null on free/beta tiers. */
  interval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** False when POLAR_ACCESS_TOKEN isn't set — the UI hides paid actions. */
  billingConfigured: boolean;
  betaMode: boolean;
  credits: {
    limitSeconds: number | null;
    usedSeconds: number;
    remainingSeconds: number | null;
  };
}

/**
 * Polar-backed billing. Checkout and the customer portal are hosted by
 * Polar (they are the merchant of record); this service only creates the
 * redirect sessions and mirrors subscription state from webhooks into
 * `user_subscriptions`.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(ProcessedWebhookEvent)
    private readonly webhookEvents: Repository<ProcessedWebhookEvent>,
    private readonly subscriptions: SubscriptionsService,
    private readonly credits: RecordingCreditsService,
  ) {}

  async getState(userId: string): Promise<BillingState> {
    const row = await this.subscriptions.findForUser(userId);
    const tier = SubscriptionTier.byId(row?.tierId);
    const balance = await this.credits.balance(userId);
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
      },
    };
  }

  /** Create a Polar checkout session and return its hosted URL. */
  async createCheckout(
    user: { id: string; email: string },
    tierId: PaidTierId,
    interval: BillingInterval,
  ): Promise<{ url: string }> {
    if (isBetaMode()) {
      throw new ForbiddenException(
        'Plans cannot be purchased during the beta — everyone is on the beta plan.',
      );
    }
    const polar = this.requirePolar();
    const productId = productIdFor(tierId, interval);
    if (!productId) {
      throw new BadRequestException(
        `The ${tierId} (${interval}) plan is not available yet.`,
      );
    }

    const checkout = await polar.checkouts.create({
      products: [productId],
      externalCustomerId: user.id,
      customerEmail: user.email,
      successUrl: `${this.webAppUrl()}/settings?checkout=success`,
      metadata: { userId: user.id },
    });
    return { url: checkout.url };
  }

  /** Hosted Polar customer portal (invoices, payment method, cancellation). */
  async createPortalSession(userId: string): Promise<{ url: string }> {
    const polar = this.requirePolar();
    const session = await polar.customerSessions.create({
      externalCustomerId: userId,
      returnUrl: `${this.webAppUrl()}/settings`,
    });
    return { url: session.customerPortalUrl };
  }

  /**
   * Switch an existing subscription to another product (tier or cadence).
   * Polar prorates the difference; the webhook confirms the final state.
   * Users without an active subscription go through checkout instead.
   */
  async changePlan(
    userId: string,
    tierId: PaidTierId,
    interval: BillingInterval,
  ): Promise<BillingState> {
    const polar = this.requirePolar();
    const row = await this.subscriptions.findForUser(userId);
    if (!row?.polarSubscriptionId) {
      throw new BadRequestException(
        'No active subscription to change — start a checkout instead.',
      );
    }
    const productId = productIdFor(tierId, interval);
    if (!productId) {
      throw new BadRequestException(
        `The ${tierId} (${interval}) plan is not available yet.`,
      );
    }
    await polar.subscriptions.update({
      id: row.polarSubscriptionId,
      subscriptionUpdate: { productId },
    });
    await this.subscriptions.upsert(userId, { tierId, polarProductId: productId });
    return this.getState(userId);
  }

  /** Schedule cancellation at period end (the plan stays active until then). */
  async cancelAtPeriodEnd(userId: string): Promise<BillingState> {
    return this.setCancellation(userId, true);
  }

  /** Undo a scheduled cancellation. */
  async resumeSubscription(userId: string): Promise<BillingState> {
    return this.setCancellation(userId, false);
  }

  private async setCancellation(
    userId: string,
    cancel: boolean,
  ): Promise<BillingState> {
    const polar = this.requirePolar();
    const row = await this.subscriptions.findForUser(userId);
    if (!row?.polarSubscriptionId) {
      throw new BadRequestException('No active subscription to change.');
    }
    await polar.subscriptions.update({
      id: row.polarSubscriptionId,
      subscriptionUpdate: { cancelAtPeriodEnd: cancel },
    });
    // Mirror immediately; the webhook confirms shortly after.
    await this.subscriptions.upsert(userId, { cancelAtPeriodEnd: cancel });
    return this.getState(userId);
  }

  /**
   * Validate and process a Polar webhook. Returns false when the delivery is
   * a duplicate (already processed). Throws WebhookVerificationError on bad
   * signatures — the controller maps that to a 403.
   */
  async handleWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): Promise<boolean> {
    const secret = process.env.POLAR_WEBHOOK_SECRET;
    if (!secret) {
      throw new WebhookVerificationError('POLAR_WEBHOOK_SECRET is not configured');
    }
    const event = validateEvent(rawBody, headers, secret);

    const deliveryId = headers['webhook-id'];
    if (deliveryId && !(await this.markProcessed(deliveryId))) {
      this.logger.log(`Skipping duplicate webhook delivery ${deliveryId}`);
      return false;
    }

    await this.applyEvent(event as { type: string; data: unknown });
    return true;
  }

  /** Insert the delivery id; false means we've already seen it. */
  private async markProcessed(deliveryId: string): Promise<boolean> {
    const result = await this.webhookEvents
      .createQueryBuilder()
      .insert()
      .values({ id: deliveryId })
      .orIgnore()
      .execute();
    return (result.identifiers?.length ?? 0) > 0;
  }

  private async applyEvent(event: { type: string; data: unknown }): Promise<void> {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated':
      case 'subscription.canceled':
      case 'subscription.uncanceled':
      case 'subscription.past_due':
      case 'subscription.revoked': {
        const sub = event.data as SubscriptionSnapshot & {
          customer?: { externalId?: string | null };
          metadata?: Record<string, unknown>;
        };
        const userId =
          sub.customer?.externalId ??
          (typeof sub.metadata?.userId === 'string' ? sub.metadata.userId : null);
        if (!userId) {
          this.logger.warn(
            `Webhook ${event.type} for subscription ${sub.id} has no external customer id — ignoring`,
          );
          return;
        }
        const patch = patchFromSubscription(sub, (p) => tierForProduct(p));
        if (!patch) {
          this.logger.warn(
            `Webhook ${event.type}: product ${sub.productId} is not mapped to a tier — ignoring`,
          );
          return;
        }
        await this.subscriptions.upsert(userId, patch);
        this.logger.log(
          `${event.type}: user ${userId} → tier ${patch.tierId} (status ${patch.status})`,
        );
        return;
      }

      case 'customer.state_changed': {
        const state = event.data as {
          id: string;
          externalId?: string | null;
          activeSubscriptions: SubscriptionSnapshot[];
        };
        if (!state.externalId) return;
        const row = await this.subscriptions.findForUser(state.externalId);
        const patch = patchFromCustomerState(
          state,
          (p) => tierForProduct(p),
          row?.tierId,
        );
        if (!patch) return;
        await this.subscriptions.upsert(state.externalId, patch);
        this.logger.log(
          `customer.state_changed: user ${state.externalId} → tier ${patch.tierId}`,
        );
        return;
      }

      default:
        // Orders, benefits, refunds… — nothing to mirror yet.
        this.logger.debug?.(`Ignoring webhook event ${event.type}`);
    }
  }

  /** Best-effort GDPR cleanup of the Polar customer when an account is purged. */
  async deletePolarCustomer(userId: string): Promise<void> {
    const polar = polarClient();
    if (!polar) return;
    try {
      await polar.customers.deleteExternal({ externalId: userId });
      this.logger.log(`Deleted Polar customer for purged account ${userId}`);
    } catch {
      // Customer may simply not exist (never checked out) — that's fine.
    }
  }

  private requirePolar() {
    const polar = polarClient();
    if (!polar) {
      throw new ServiceUnavailableException(
        'Billing is not configured on this environment.',
      );
    }
    return polar;
  }

  private webAppUrl(): string {
    return (
      process.env.WEB_APP_URL ??
      process.env.CORS_ORIGIN ??
      'http://localhost:3200'
    ).replace(/\/$/, '');
  }
}
