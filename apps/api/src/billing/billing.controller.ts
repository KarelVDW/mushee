import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@Controller('billing')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /** Current tier + Polar subscription state + today's recording credits. */
  @Get('subscription')
  subscription(@CurrentUser() user: { id: string }) {
    return this.billingService.getState(user.id);
  }

  /** Start a Polar-hosted checkout; the client redirects to the returned URL. */
  @Post('checkout')
  checkout(
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billingService.createCheckout(user, dto.tierId, dto.interval);
  }

  /** Polar-hosted customer portal (invoices, payment methods, cancellation). */
  @Post('portal')
  portal(@CurrentUser() user: { id: string }) {
    return this.billingService.createPortalSession(user.id);
  }

  /** Switch tier/cadence on an existing subscription (prorated by Polar). */
  @Post('change')
  change(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billingService.changePlan(user.id, dto.tierId, dto.interval);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: { id: string }) {
    return this.billingService.cancelAtPeriodEnd(user.id);
  }

  @Post('resume')
  resume(@CurrentUser() user: { id: string }) {
    return this.billingService.resumeSubscription(user.id);
  }
}
