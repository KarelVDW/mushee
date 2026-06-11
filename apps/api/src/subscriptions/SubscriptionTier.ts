/**
 * Catalog of subscription tiers. Mirrors the web app's plan catalogue
 * (apps/web/src/app/settings/ChangePlanDialog.tsx) — keep the two in sync.
 *
 * Payments are not wired up yet; every user without an explicit
 * `user_subscription` row is on the free tier.
 */
export class SubscriptionTier {
  private constructor(
    readonly id: 'free' | 'pro' | 'studio',
    readonly name: string,
    /** Daily recording budget in credits (1 credit = 1 second). `null` = unlimited. */
    readonly dailyRecordingCredits: number | null,
  ) {}

  static readonly Free = new SubscriptionTier('free', 'Sketch', 30);
  static readonly Pro = new SubscriptionTier('pro', 'Composer', 600);
  static readonly Studio = new SubscriptionTier('studio', 'Studio', null);

  static readonly all = [
    SubscriptionTier.Free,
    SubscriptionTier.Pro,
    SubscriptionTier.Studio,
  ];

  /** Unknown/legacy ids fall back to the free tier rather than throwing. */
  static byId(id: string | null | undefined): SubscriptionTier {
    return (
      SubscriptionTier.all.find((tier) => tier.id === id) ??
      SubscriptionTier.Free
    );
  }

  get hasUnlimitedRecording(): boolean {
    return this.dailyRecordingCredits === null;
  }
}
