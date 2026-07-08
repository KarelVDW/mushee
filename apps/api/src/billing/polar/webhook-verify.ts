/**
 * Typed access to `@polar-sh/sdk/webhooks` (standard-webhooks signature
 * validation). The SDK publishes it as a package-exports subpath which Node
 * resolves fine at runtime, but this project's commonjs/node10 TypeScript
 * moduleResolution cannot type-resolve — so it is loaded via require with
 * the narrow surface we use typed here.
 */

export interface PolarWebhookEvent {
  type: string;
  data: unknown;
}

interface PolarWebhooksModule {
  validateEvent: (
    body: string | Buffer,
    headers: Record<string, string>,
    secret: string,
  ) => PolarWebhookEvent;
  WebhookVerificationError: new (message: string) => Error;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webhooks = require('@polar-sh/sdk/webhooks') as PolarWebhooksModule;

export const validateEvent = webhooks.validateEvent;
export const WebhookVerificationError = webhooks.WebhookVerificationError;
