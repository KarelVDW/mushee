import {
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { BillingService } from './billing.service';
import { WebhookVerificationError } from './polar/webhook-verify';

/**
 * Polar webhook receiver. Signature verification (standard-webhooks) needs
 * the exact raw bytes Polar sent, which main.ts preserves on `req.rawBody`
 * via Nest's `rawBody` option.
 *
 * Configure in the Polar dashboard: <api-url>/billing/webhooks/polar with
 * the secret in POLAR_WEBHOOK_SECRET. Subscribe at least to the
 * subscription.* and customer.state_changed events.
 */
@Controller('billing/webhooks')
export class PolarWebhookController {
  private readonly logger = new Logger(PolarWebhookController.name);

  constructor(private readonly billingService: BillingService) {}

  @Post('polar')
  @HttpCode(202)
  async handle(@Req() req: FastifyRequest): Promise<{ received: boolean }> {
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    try {
      await this.billingService.handleWebhook(
        rawBody ?? JSON.stringify(req.body),
        this.headerMap(req),
      );
      return { received: true };
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        this.logger.warn(`Rejected webhook: ${err.message}`);
        throw new ForbiddenException('Invalid webhook signature');
      }
      throw err;
    }
  }

  private headerMap(req: FastifyRequest): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value[0];
    }
    return headers;
  }
}
