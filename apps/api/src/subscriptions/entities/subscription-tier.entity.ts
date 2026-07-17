import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A subscription tier and its entitlements. Database-driven: the rows are
 * seeded by migration (free / pro / studio / beta) and can be re-tuned in
 * production without a deploy. Paid tiers are sold through Polar
 * (src/billing); the beta tier is assigned automatically at signup while
 * BETA_MODE=true and is never sold. Every user without a `user_subscription`
 * row is on the free tier.
 *
 * The web landing page keeps its own static marketing catalogue
 * (apps/web/src/lib/plans.ts); everything inside the app reads these rows
 * via GET /plans.
 */
@Entity('subscription_tiers')
export class SubscriptionTier {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  /** Daily recording budget in credits (1 credit = 1 second). `null` = unlimited. */
  @Column({ type: 'int', nullable: true })
  dailyRecordingCredits: number | null;

  /** Maximum saved scores. `null` = no cap. */
  @Column({ type: 'int', nullable: true })
  maxScores: number | null;

  /** Position in plan pickers (ascending = cheaper first). */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  /** Whether the tier appears in plan pickers; beta is assigned, never sold. */
  @Column({ type: 'boolean', default: true })
  sellable: boolean;

  get hasUnlimitedRecording(): boolean {
    return this.dailyRecordingCredits === null;
  }
}
