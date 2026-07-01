import { Logger } from '@nestjs/common';

import { BasicPitchProvider } from './BasicPitchProvider';
import { CrepeProvider } from './CrepeProvider';
import { LocalModelBackend } from './LocalModelBackend';
import type { ModelBackend, ProviderModelDirs } from './ModelBackend';
import type { PitchProvider } from './PitchProvider';

export type { ProviderModelDirs } from './ModelBackend';

/**
 * Owns one instance of each available pitch provider, loaded once. The adaptive
 * pipeline picks a provider per recording (via the resolved `PipelineProfile`),
 * so they all need to be ready — but the underlying models are heavy, hence a
 * shared registry rather than per-session construction. Providers the backend
 * can't serve are skipped; `get` falls back to basic-pitch.
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
    if (modelBackend.available('basic-pitch')) {
      this.providers.set('basic-pitch', new BasicPitchProvider(modelBackend));
    }
    if (modelBackend.available('crepe-tiny')) {
      this.providers.set('crepe-tiny', new CrepeProvider(modelBackend, 'crepe-tiny'));
    }
    if (!this.providers.has('basic-pitch')) {
      throw new Error('ProviderRegistry: basic-pitch model unavailable from backend');
    }
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

  /** Get a provider by name, falling back to basic-pitch if absent. */
  get(name: string): PitchProvider {
    const provider = this.providers.get(name) ?? this.providers.get('basic-pitch');
    if (!provider) throw new Error('ProviderRegistry has no basic-pitch fallback');
    return provider;
  }
}
