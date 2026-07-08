import { Logger } from '@nestjs/common';

import { CompositeModelBackend } from './composite-model-backend';
import { LocalModelBackend } from './local-model-backend';
import type { ModelBackend, ProviderModelDirs } from './model-backend';
import { RemoteModelBackend } from './remote-model-backend';

const logger = new Logger('ModelBackend');

/**
 * Choose the forward-pass backend from env. Each model independently runs
 * locally (TF.js, the default) or against its own remote inference service:
 *
 *   CREPE_INFERENCE_URL        e.g. crepe-inference:50051
 *   BASIC_PITCH_INFERENCE_URL  e.g. basic-pitch-inference:50051
 *
 * With neither set, returns the all-local backend (dev + the eval harness). With
 * one set, that model goes remote while the other stays local — which is how the
 * CREPE service ships ahead of basic-pitch.
 */
export function createModelBackend(dirs: ProviderModelDirs): ModelBackend {
  const crepeUrl = process.env.CREPE_INFERENCE_URL;
  const basicPitchUrl = process.env.BASIC_PITCH_INFERENCE_URL;
  if (!crepeUrl && !basicPitchUrl) return new LocalModelBackend(dirs);

  const local = new LocalModelBackend(dirs);
  const backend = new CompositeModelBackend({
    'crepe-tiny': crepeUrl
      ? new RemoteModelBackend('crepe-tiny', crepeUrl)
      : local,
    'basic-pitch': basicPitchUrl
      ? new RemoteModelBackend('basic-pitch', basicPitchUrl)
      : local,
  });
  logger.log(
    `Inference backends — crepe-tiny: ${crepeUrl ? `remote(${crepeUrl})` : 'local'}, ` +
      `basic-pitch: ${basicPitchUrl ? `remote(${basicPitchUrl})` : 'local'}`,
  );
  return backend;
}
