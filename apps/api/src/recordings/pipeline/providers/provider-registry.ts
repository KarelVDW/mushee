import { Logger } from '@nestjs/common'

import { describeError } from '../describe-error'
import { AT_PITCH_PROVIDER_NAME, PITCHDOWN_PROVIDER_NAME, type ProviderName } from '../profiles/pipeline-profile'
import { CrepePitchdownProvider } from './crepe-pitchdown-provider'
import { CrepeProvider } from './crepe-provider'
import { LocalModelBackend } from './local-model-backend'
import type { ModelBackend, ProviderModelDirs } from './model-backend'
import type { PitchProvider } from './pitch-provider'

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
    private readonly logger = new Logger(ProviderRegistry.name)
    private readonly providers = new Map<ProviderName, PitchProvider>()

    constructor(dirs: ProviderModelDirs, backend?: ModelBackend) {
        const modelBackend = backend ?? new LocalModelBackend(dirs)
        if (!modelBackend.available('crepe-tiny')) {
            throw new Error('ProviderRegistry: crepe-tiny model unavailable from backend')
        }
        this.providers.set(AT_PITCH_PROVIDER_NAME, new CrepeProvider(modelBackend, AT_PITCH_PROVIDER_NAME))
        this.providers.set(PITCHDOWN_PROVIDER_NAME, new CrepePitchdownProvider(modelBackend))
        this.logger.log(`Registered providers: ${[...this.providers.keys()].join(', ')}`)
    }

    /**
     * Pre-load provider models. Pass the provider names a profile can actually
     * select to avoid warming models nothing will use; omit to warm all. Any
     * provider not pre-warmed still loads lazily on first `transcribe`.
     */
    async initAll(names?: ProviderName[]): Promise<void> {
        const targets = names
            ? [...new Set(names)].map((n) => this.providers.get(n)).filter((p): p is PitchProvider => p !== undefined)
            : [...this.providers.values()]
        await Promise.all(
            targets.map((p) =>
                p.init().catch((err: unknown) => {
                    this.logger.error(`Failed to init provider "${p.name}": ${describeError(err)}`)
                }),
            ),
        )
    }

    /** The provider registered under `name`. Every `ProviderName` is registered, so a miss is a bug, not a fallback. */
    get(name: ProviderName): PitchProvider {
        const provider = this.providers.get(name)
        if (!provider) throw new Error(`ProviderRegistry has no provider "${name}"`)
        return provider
    }
}
