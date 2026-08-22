import { Logger } from '@nestjs/common';

import { LocalModelBackend } from './local-model-backend';
import type { ModelBackend, ProviderModelDirs } from './model-backend';
import { RemoteModelBackend } from './remote-model-backend';

const logger = new Logger('ModelBackend');

/**
 * Choose the forward-pass backend from env:
 *
 *   CREPE_INFERENCE_URL  e.g. crepe-inference:50051
 *
 * Unset, returns the in-process TF.js backend (dev + the eval harness).
 */
export function createModelBackend(dirs: ProviderModelDirs): ModelBackend {
  const crepeUrl = process.env.CREPE_INFERENCE_URL;
  if (!crepeUrl) return new LocalModelBackend(dirs);
  logger.log(`Inference backend — crepe-tiny: remote(${crepeUrl})`);
  return new RemoteModelBackend('crepe-tiny', crepeUrl);
}
