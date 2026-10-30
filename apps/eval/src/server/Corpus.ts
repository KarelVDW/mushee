/**
 * The corpus on this machine (gitignored fixtures, built by the harness's fetchers):
 *
 *   apps/api/scripts/fixtures/eval-real/{benchmark,context}/<ds>/   real recordings
 *       dataset.json · <clip>.truth.json · <clip>__real.wav · <clip>__<condition>.wav
 *       after a resynth export: <clip>__resynth.flac · <clip>.f0.json · <clip>.truth-derived.json
 *                               · <clip>.truth-unresolved.json
 *   apps/api/scripts/fixtures/eval-synth/<ds>/                      the realistic synthetic corpus
 *       dataset.json · <clip>.truth.json · <clip>__{dry,studio,room,home-phone,noisy-phone}.wav
 *
 * Discovery mirrors the harness's (`lib/realCorpus.ts`), and the pooling rule is the one decided
 * on 2026-10-30. Audio is only ever served from a path this module found by listing a dataset
 * directory, so a request can name a dataset, a clip and a source but never a path.
 */

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

import type { AudioSourceDto, ClipRowDto, CorpusTier, DatasetDto, Material, NoteDto, TruthSource } from '@/lib/dto'

import { BenchmarkRun } from './BenchmarkStore'
import { FileCache } from './FileCache'
import { EvalPaths } from './paths'
import { type ResynthClip, ResynthStore } from './ResynthStore'
import { WavInfo } from './WavInfo'

interface Manifest {
    id?: string
    label?: string
    kind?: string
    material?: Material
    instrumentId?: string
    license?: string
    licenses?: string[]
    licenceRestricted?: boolean
    tier?: CorpusTier
    noteTruthDerived?: boolean
    pitchless?: boolean
    constructedPerformance?: boolean
    pooled?: boolean
    truthSource?: TruthSource
    source?: string
    notes?: string
    note?: string
}

/** `<clip>.f0.json`, written by the resynth export: consensus f0 in MIDI at a fixed hop. */
interface ContourFile {
    hop?: number
    orig?: Array<number | null>
    synth?: Array<number | null>
}

interface TruthFile {
    bpm?: number
    notes?: NoteDto[]
    /** Further annotators' note lists (vocadito's A2), scored as the max over all (`GroundTruth.alternateNotes`). */
    alternateNotes?: NoteDto[][]
}

/** The audio of one clip by source key: `real`, `resynth`, `work`, or a condition name. */
interface AudioFile {
    key: string
    path: string
    role: AudioSourceDto['role']
    label: string
}

const SYNTH_VARIANTS = ['dry', 'studio', 'room', 'home-phone', 'noisy-phone']

export class Dataset {
    private static readonly manifests = FileCache.json<Manifest>()
    private static readonly truths = FileCache.json<TruthFile>()
    private static readonly contours = FileCache.json<ContourFile>()

    private files: string[] | null = null

    constructor(
        readonly id: string,
        readonly dir: string,
        readonly tier: CorpusTier,
    ) {}

    get manifest(): Manifest {
        return Dataset.manifests.read(join(this.dir, 'dataset.json')) ?? {}
    }

    get material(): Material {
        const m = this.manifest
        if (m.material) return m.material
        return m.kind === 'whistle' ? 'whistling' : m.kind === 'instrument' ? 'instrument' : 'singing'
    }

    get truthSource(): TruthSource {
        const m = this.manifest
        return m.truthSource ?? BenchmarkRun.truthSourceFromFlags({ ...m, tier: this.tier })
    }

    /** The pooling rule decided 2026-10-30 (meta/test-data-2026-10.md); synthetic sets pool only in the synth benchmark. */
    get unpooledReason(): string | null {
        const m = this.manifest
        if (this.tier === 'synthetic') return 'synthetic corpus — pooled in the synth benchmark only'
        if (m.pitchless) return 'onsets only, no pitch'
        if (m.constructedPerformance) return 'constructed performance'
        if (m.noteTruthDerived) return 'derived note truth'
        if (m.licenceRestricted) return 'licence-restricted'
        if (m.pooled === false) return 'opted out (pooled: false)'
        return null
    }

    /** Clip names, from every file that names one (truth, unresolved truth or audio). */
    clipNames(): string[] {
        const names = new Set<string>()
        for (const f of this.listing()) {
            if (f.endsWith('.truth.json')) names.add(f.slice(0, -'.truth.json'.length))
            else if (f.endsWith('.truth-unresolved.json')) names.add(f.slice(0, -'.truth-unresolved.json'.length))
            else if (f.endsWith('__real.wav')) names.add(f.slice(0, -'__real.wav'.length))
            else if (this.tier === 'synthetic' && f.endsWith('__dry.wav')) names.add(f.slice(0, -'__dry.wav'.length))
        }
        return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    }

    hasClip(clip: string): boolean {
        return this.clipNames().includes(clip)
    }

    truth(clip: string): TruthFile | null {
        return this.listing().includes(`${clip}.truth.json`) ? Dataset.truths.read(join(this.dir, `${clip}.truth.json`)) : null
    }

    /** A sibling truth file: `truth-derived` (the truth resynth replaced) or `truth-unresolved`. */
    sideTruth(clip: string, which: 'truth-derived' | 'truth-unresolved'): TruthFile | null {
        const name = `${clip}.${which}.json`
        return this.listing().includes(name) ? Dataset.truths.read(join(this.dir, name)) : null
    }

    f0(clip: string): ContourFile | null {
        const name = `${clip}.f0.json`
        return this.listing().includes(name) ? Dataset.contours.read(join(this.dir, name)) : null
    }

    /** The clip's playable files: the original, its synthetic copy, then the other conditions. */
    audio(clip: string, resynth: ResynthClip | null): AudioFile[] {
        const out: AudioFile[] = []
        const prefix = `${clip}__`
        const variants = this.listing().filter((f) => f.startsWith(prefix) && /\.(wav|flac)$/.test(f))
        const variantKey = (f: string) => f.slice(prefix.length).replace(/\.(wav|flac)$/, '')
        const original = this.tier === 'synthetic' ? 'dry' : 'real'
        for (const f of variants) {
            const key = variantKey(f)
            if (key === original)
                out.push({ key, path: join(this.dir, f), role: 'original', label: this.tier === 'synthetic' ? 'Dry render' : 'Original' })
        }
        const copy = variants.find((f) => variantKey(f) === 'resynth')
        if (copy) out.push({ key: 'resynth', path: join(this.dir, copy), role: 'copy', label: 'Synthetic copy' })
        const work = resynth?.workCopy()
        if (work) out.push({ key: 'work', path: work, role: 'copy', label: copy ? 'Copy (latest work)' : 'Synthetic copy (work)' })
        const rest = variants
            .map((f) => ({ f, key: variantKey(f) }))
            .filter(({ key }) => key !== original && key !== 'resynth')
            .sort((a, b) => Dataset.variantOrder(a.key) - Dataset.variantOrder(b.key) || a.key.localeCompare(b.key))
        for (const { f, key } of rest) out.push({ key, path: join(this.dir, f), role: 'variant', label: key.replace(/-/g, ' ') })
        return out
    }

    durationOf(clip: string): number | null {
        const name = this.tier === 'synthetic' ? `${clip}__dry.wav` : `${clip}__real.wav`
        return this.listing().includes(name) ? WavInfo.duration(join(this.dir, name)) : null
    }

    toDto(extra: { latestF1: number | null; latestRunId: string | null }): DatasetDto {
        const m = this.manifest
        const clips = this.clipNames()
        const truthSource = this.truthSource
        const calibration = truthSource === 'human' && this.tier !== 'synthetic'
        return {
            id: this.id,
            label: m.label ?? this.id,
            tier: this.tier,
            material: this.material,
            kind: m.kind ?? 'voice',
            instrumentId: m.instrumentId ?? null,
            truthSource,
            truthSourceInferred: m.truthSource == null,
            clips: clips.length,
            license: m.license ?? m.licenses?.join(', ') ?? null,
            licenceRestricted: m.licenceRestricted ?? false,
            pooled: this.unpooledReason === null,
            unpooledReason: this.unpooledReason,
            source: m.source ?? null,
            notes: m.notes ?? m.note ?? null,
            resynth: ResynthStore.touches(this.id) ? ResynthStore.progress(this.id, calibration ? [] : clips, calibration) : null,
            latestF1: extra.latestF1,
            latestRunId: extra.latestRunId,
        }
    }

    clipRow(clip: string, resynth: ResynthClip | undefined, score: { f1: number; onF1: number | null } | null): ClipRowDto {
        const truth = this.truth(clip) ?? this.sideTruth(clip, 'truth-unresolved')
        return {
            name: clip,
            durationSec: this.durationOf(clip),
            notes: truth?.notes?.length ?? null,
            status: resynth?.status ?? null,
            rounds: resynth?.rounds ?? null,
            f1: score?.f1 ?? null,
            onF1: score?.onF1 ?? null,
        }
    }

    /** The directory listing, once per instance (an instance lives for one request). */
    private listing(): string[] {
        this.files ??= readdirSync(this.dir)
        return this.files
    }

    private static variantOrder(key: string): number {
        const i = SYNTH_VARIANTS.indexOf(key)
        return i < 0 ? 100 : i
    }
}

export class Corpus {
    /** Every dataset on disk: the real corpus by tier, then the synthetic corpus. */
    static datasets(): Dataset[] {
        const out: Dataset[] = []
        for (const tier of ['benchmark', 'context'] as const) {
            const dir = join(EvalPaths.realCorpus, tier)
            for (const name of Corpus.subdirs(dir)) {
                if (Corpus.isDataset(join(dir, name))) out.push(new Dataset(name, join(dir, name), tier))
            }
        }
        for (const name of Corpus.subdirs(EvalPaths.synthCorpus)) {
            const dir = join(EvalPaths.synthCorpus, name)
            if (Corpus.isDataset(dir)) out.push(new Dataset(name, dir, 'synthetic'))
        }
        return out
    }

    static dataset(id: string): Dataset | null {
        return Corpus.datasets().find((d) => d.id === id) ?? null
    }

    private static subdirs(dir: string): string[] {
        if (!existsSync(dir)) return []
        return readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
            .map((e) => e.name)
            .sort()
    }

    /** As in the harness: a directory with a manifest or at least one truth file. */
    private static isDataset(dir: string): boolean {
        const files = readdirSync(dir)
        return files.includes('dataset.json') || files.some((f) => f.endsWith('.truth.json'))
    }
}
