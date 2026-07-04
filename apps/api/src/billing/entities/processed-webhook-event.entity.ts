import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Dedupe ledger for incoming Polar webhooks (standard-webhooks `webhook-id`
 * header). Polar retries deliveries; inserting the id first and skipping on
 * conflict makes processing idempotent across replicas.
 */
@Entity('processed_webhook_events')
export class ProcessedWebhookEvent {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;
}
