import { Logger } from '@nestjs/common';

import { CrepePitchdownProvider } from './crepe-pitchdown-provider';
import { CrepeProvider } from './crepe-provider';
import { LocalModelBackend } from './local-model-backend';
import type { ModelBackend, ProviderModelDirs } from './model-backend';
import type { PitchProvider } from './pitch-provider';

export type { ProviderModelDirs } from './model-backend';

/**
 * Owns one instance of each available pitch provider, loaded once. The adaptive
 * pipeline picks a provider per recording (via the resolved `PipelineProfile`),
 * so they all need to be ready — but the underlying models are heavy, hence a
 * shared registry rather than per-session construction.
 *
 * Both providers ride the same crepe-tiny checkpoint: `crepe-tiny` analyses at
 * pitch, `crepe-tiny-down1` an octave down for the `very-high` band (basic-pitch
 * and its inference service were removed 2026-08-22 after the consolidation
 * measurements — see the eval README's provider-consolidation logs).
 *
 * The forward pass runs through a `ModelBackend` — `LocalModelBackend` (TF.js,
 * the default, used by dev + the eval harness) or a remote inference service.
 * Pass `dirs` for local; pass a `backend` to override (e.g. remote).
 */
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<string, PitchProvider>();

  constructor(dirs: ProviderModelDirs, backend?: ModelBackend) {
    const modelBackend = backend ?? new LocalModelBackend(dirs);
    if (!modelBackend.available('crepe-tiny')) {
      throw new Error('ProviderRegistry: crepe-tiny model unavailable from backend');
    }
    this.providers.set('crepe-tiny', new CrepeProvider(modelBackend, 'crepe-tiny'));
    this.providers.set('crepe-tiny-down1', new CrepePitchdownProvider(modelBackend));
    this.logger.log(`Registered providers: ${[...this.providers.keys()].join(', ')}`);
  }

  /**
   * Pre-load provider models. Pass the provider names a profile can actually
   * select to avoid warming models nothing will use; omit to warm all. Any
   * provider not pre-warmed still loads lazily on first `transcribe`.
   */
  async initAll(names?: string[]): Promise<void> {
    const targets = names
      ? [...new Set(names)].map((n) => this.providers.get(n)).filter(Boolean)
      : [...this.providers.values()];
    await Promise.all(
      (targets as PitchProvider[]).map((p) =>
        p.init().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to init provider "${p.name}": ${msg}`);
        }),
      ),
    );
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** Get a provider by name, falling back to crepe-tiny if absent. */
  get(name: string): PitchProvider {
    const provider = this.providers.get(name) ?? this.providers.get('crepe-tiny');
    if (!provider) throw new Error('ProviderRegistry has no crepe-tiny fallback');
    return provider;
  }
}
