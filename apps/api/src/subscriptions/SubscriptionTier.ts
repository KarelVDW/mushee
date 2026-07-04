/**
 * Catalog of subscription tiers. Mirrors the web app's plan catalogue
 * (apps/web/src/lib/plans.ts) — keep the two in sync.
 *
 * Paid tiers are sold through Polar (see src/billing); every user without an
 * explicit `user_subscription` row is on the free tier. The beta tier is
 * assigned automatically at signup while BETA_MODE=true and is never sold.
 */
export class SubscriptionTier {
  private constructor(
    readonly id: 'free' | 'pro' | 'studio' | 'beta',
    readonly name: string,
    /** Daily recording budget in credits (1 credit = 1 second). `null` = unlimited. */
    readonly dailyRecordingCredits: number | null,
  ) {}

  static readonly Free = new SubscriptionTier('free', 'Sketch', 30);
  static readonly Pro = new SubscriptionTier('pro', 'Composer', 600);
  static readonly Studio = new SubscriptionTier('studio', 'Studio', null);
  /** Closed-beta plan: free, 5 minutes of recording per day. */
  static readonly Beta = new SubscriptionTier('beta', 'Beta', 300);

  static readonly all = [
    SubscriptionTier.Free,
    SubscriptionTier.Pro,
    SubscriptionTier.Studio,
    SubscriptionTier.Beta,
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
