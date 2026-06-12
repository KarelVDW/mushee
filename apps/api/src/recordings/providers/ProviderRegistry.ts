import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';

import { BasicPitchProvider } from './BasicPitchProvider';
import { CrepeProvider } from './CrepeProvider';
import { PestoProvider } from './PestoProvider';
import type { PitchProvider } from './PitchProvider';

export interface ProviderModelDirs {
  basicPitch: string;
  crepeTiny: string;
  pesto: string;
}

/**
 * Owns one instance of each available pitch provider, loaded once. The adaptive
 * pipeline picks a provider per recording (via the resolved `PipelineProfile`),
 * so they all need to be ready — but the underlying models are heavy, hence a
 * shared registry rather than per-session construction. Providers whose model
 * directory is missing are skipped; `get` falls back to basic-pitch.
 */
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<string, PitchProvider>();

  constructor(dirs: ProviderModelDirs) {
    if (existsSync(dirs.basicPitch)) {
      this.providers.set('basic-pitch', new BasicPitchProvider(dirs.basicPitch));
    }
    if (existsSync(dirs.crepeTiny)) {
      this.providers.set('crepe-tiny', new CrepeProvider(dirs.crepeTiny, 'crepe-tiny'));
    }
    if (existsSync(dirs.pesto)) {
      this.providers.set('pesto', new PestoProvider(dirs.pesto));
    }
    if (!this.providers.has('basic-pitch')) {
      throw new Error(
        `ProviderRegistry: basic-pitch model dir not found at ${dirs.basicPitch}`,
      );
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
