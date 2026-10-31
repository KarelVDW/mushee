/**
 * The one entry point the pages and routes read through: it joins the benchmark results, the
 * timeline, the corpus on disk and the resynth records into the DTOs of `@/lib/dto`. Server-only
 * (it reads the filesystem); every page that uses it renders per request.
 */

import type {
    AudioSourceDto,
    ClipCompareDto,
    DatasetDetailDto,
    DatasetDto,
    MaterialRowDto,
    NoteLayerDto,
    ResynthProgressDto,
    RunSummaryDto,
    SynthGroupDto,
    TimelineDto,
    TruthSource,
} from '@/lib/dto'

import { type BenchmarkRun, BenchmarkStore } from './BenchmarkStore'
import { Corpus, type Dataset } from './Corpus'
import { PipelineNotes } from './PipelineNotes'
import { ResynthStore } from './ResynthStore'
import { TimelineStore } from './TimelineStore'

export interface OverviewDto {
    latest: { summary: RunSummaryDto; materials: MaterialRowDto[] } | null
    synth: SynthGroupDto | null
    timeline: TimelineDto
    truthSources: Array<{ source: TruthSource; datasets: number; clips: number; pooledDatasets: number }>
    resynth: Omit<ResynthProgressDto, 'calibration'> & { datasets: number; calibrationClips: number }
    datasetCount: number
}

/** Latest scores per dataset and per clip: the newest real run, or the newest synth group's mean over its conditions. */
class LatestScores {
    private readonly real = BenchmarkStore.latest('real')
    private readonly synth: BenchmarkRun[]

    constructor() {
        const group = BenchmarkStore.synthGroups()[0]
        const ids = new Set(group?.runs.map((r) => r.id) ?? [])
        this.synth = BenchmarkStore.list('synth').filter((r) => ids.has(r.id))
    }

    runFor(dataset: Dataset): { id: string; label: string } | null {
        if (dataset.tier !== 'synthetic') return this.real ? { id: this.real.id, label: this.real.label } : null
        const first = this.synth[0]
        return first ? { id: first.id, label: `${first.labelStem} (mean of ${this.synth.length} conditions)` } : null
    }

    dataset(dataset: Dataset): number | null {
        if (dataset.tier !== 'synthetic') return this.real?.scenario(dataset.id)?.f1 ?? null
        return LatestScores.mean(this.synth.map((r) => r.scenario(dataset.id)?.f1 ?? null))
    }

    clip(dataset: Dataset, clip: string): { f1: number; onF1: number | null } | null {
        if (dataset.tier !== 'synthetic') {
            const s = this.real?.clipScore(dataset.id, clip, 'real')
            return s ? { f1: s.f1, onF1: s.onF1 } : null
        }
        const scores = this.synth.flatMap((r) => r.clipScoresFor(dataset.id, clip))
        const f1 = LatestScores.mean(scores.map((s) => s.f1))
        return f1 === null ? null : { f1, onF1: LatestScores.mean(scores.map((s) => s.onF1)) }
    }

    private static mean(values: Array<number | null>): number | null {
        const v = values.filter((x): x is number => x !== null)
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
    }
}

export class EvalData {
    static overview(): OverviewDto {
        const latest = BenchmarkStore.latest('real')
        const datasets = EvalData.datasets().filter((d) => d.tier !== 'synthetic')
        const bySource = new Map<TruthSource, { datasets: number; clips: number; pooledDatasets: number }>()
        const resynth = { passed: 0, unresolved: 0, inProgress: 0, pending: 0, total: 0, datasets: 0, calibrationClips: 0 }
        for (const d of datasets) {
            const row = bySource.get(d.truthSource) ?? { datasets: 0, clips: 0, pooledDatasets: 0 }
            row.datasets++
            row.clips += d.clips
            if (d.pooled) row.pooledDatasets++
            bySource.set(d.truthSource, row)
            if (!d.resynth) continue
            if (d.resynth.calibration) {
                // Finished blind runs only: a canary still queued or in the loop calibrates nothing yet.
                resynth.calibrationClips += d.resynth.passed + d.resynth.unresolved
                continue
            }
            resynth.datasets++
            resynth.passed += d.resynth.passed
            resynth.unresolved += d.resynth.unresolved
            resynth.inProgress += d.resynth.inProgress
            resynth.pending += d.resynth.pending
            resynth.total += d.resynth.total
        }
        return {
            latest: latest ? { summary: latest.summary(), materials: latest.materials() } : null,
            synth: BenchmarkStore.synthGroups()[0] ?? null,
            timeline: TimelineStore.read(),
            truthSources: [...bySource.entries()].map(([source, row]) => ({ source, ...row })),
            resynth,
            datasetCount: datasets.length,
        }
    }

    static datasets(): DatasetDto[] {
        const latest = new LatestScores()
        return Corpus.datasets().map((d) => d.toDto({ latestF1: latest.dataset(d), latestRunId: latest.runFor(d)?.id ?? null }))
    }

    static datasetDetail(id: string): DatasetDetailDto | null {
        const dataset = Corpus.dataset(id)
        if (!dataset) return null
        const latest = new LatestScores()
        const resynth = ResynthStore.clips(id)
        return {
            dataset: dataset.toDto({ latestF1: latest.dataset(dataset), latestRunId: latest.runFor(dataset)?.id ?? null }),
            clips: dataset.clipNames().map((clip) => dataset.clipRow(clip, resynth.get(clip), latest.clip(dataset, clip))),
            latestRun: latest.runFor(dataset),
        }
    }

    static clipCompare(id: string, clip: string): ClipCompareDto | null {
        const dataset = Corpus.dataset(id)
        if (!dataset?.hasClip(clip)) return null
        const names = dataset.clipNames()
        const index = names.indexOf(clip)
        const resynthRecord = ResynthStore.clips(id).get(clip) ?? null
        const dto = dataset.toDto({ latestF1: null, latestRunId: null })
        const truth = dataset.truth(clip)
        const resynthNotes = resynthRecord?.notes() ?? null
        const unresolved = dataset.sideTruth(clip, 'truth-unresolved')
        const derived = dataset.sideTruth(clip, 'truth-derived')
        // Onset-only truth carries placeholder pitches: never drawn as notes.
        const truthLayer = (label: string, detail: string): NoteLayerDto | null =>
            truth?.notes && dto.truthSource !== 'onsets' ? { label, detail, notes: truth.notes } : null

        // The primary layer is the copy's notes whenever resynth has any; the reference layer is the
        // truth those notes are measured against: the truth the export moved aside, else the clip's
        // own truth file — unless that file is the export itself (a resynth-truth dataset), which
        // would only repeat the copy's notes. A dataset switches to `truthSource: resynth` only once
        // every clip is exported, so an exported clip of a dataset still marked derived has its
        // previous truth in `.truth-derived.json`, never in `.truth.json`.
        let primary: NoteLayerDto | null
        let reference: NoteLayerDto | null
        if (resynthNotes) {
            primary = { label: 'Copy notes', detail: resynthNotes.detail, notes: resynthNotes.notes }
            reference = derived?.notes
                ? { label: 'Previous derived truth', detail: 'replaced by the resynth truth', notes: derived.notes }
                : dto.truthSource === 'resynth'
                  ? null
                  : truthLayer(dto.truthSource === 'human' ? 'Human truth' : 'Current truth', `${dto.truthSource} truth`)
        } else if (unresolved?.notes) {
            primary = { label: 'Copy notes', detail: 'unresolved — not scored', notes: unresolved.notes }
            reference = derived?.notes
                ? { label: 'Previous derived truth', detail: 'kept for unresolved clips', notes: derived.notes }
                : truthLayer('Current truth', 'derived')
        } else {
            primary = truthLayer('Truth', `${dto.truthSource} truth${dto.truthSourceInferred ? ' (from the flags)' : ''}`)
            // Without a replaced truth, a second annotator's notes (vocadito's A2) are the natural reference.
            const second = truth?.alternateNotes?.find((alt) => Array.isArray(alt) && alt.length > 0)
            reference = derived?.notes
                ? { label: 'Previous derived truth', detail: 'replaced', notes: derived.notes }
                : second && dto.truthSource !== 'onsets'
                  ? { label: 'Second annotator', detail: 'alternate annotation (scored as max over both)', notes: second }
                  : null
        }

        const f0 = dataset.f0(clip)
        const audio: AudioSourceDto[] = dataset.audio(clip, resynthRecord).map((a) => ({
            key: a.key,
            label: a.label,
            role: a.role,
            url: `/api/audio?ds=${encodeURIComponent(id)}&clip=${encodeURIComponent(clip)}&src=${encodeURIComponent(a.key)}`,
        }))
        const runs = dataset.tier === 'synthetic' ? BenchmarkStore.list('synth') : BenchmarkStore.list('real')
        return {
            dataset: { id, label: dto.label, tier: dto.tier, material: dto.material, truthSource: dto.truthSource, pooled: dto.pooled },
            clip,
            index,
            total: names.length,
            prev: index > 0 ? names[index - 1] : null,
            next: index < names.length - 1 ? names[index + 1] : null,
            durationSec: dataset.durationOf(clip),
            audio,
            primary: EvalData.drawable(primary),
            reference: EvalData.drawable(reference),
            f0: f0?.orig ? { hopSec: f0.hop ?? 0.02, orig: f0.orig, copy: f0.synth ?? [] } : null,
            resynth: resynthRecord ? resynthRecord.panel() : null,
            pipelineSources: PipelineNotes.sources(),
            scores: runs.flatMap((run) =>
                run.clipScoresFor(id, clip).map((s) => ({
                    runId: run.id,
                    label: run.label,
                    date: run.date,
                    cond: s.cond,
                    f1: s.f1,
                    f1Off: s.f1Off,
                    onF1: s.onF1,
                })),
            ),
        }
    }

    /** A layer with only the notes the roll can place: a malformed note in a hand-edited file is skipped, never drawn at NaN. */
    private static drawable(layer: NoteLayerDto | null): NoteLayerDto | null {
        if (!layer) return null
        const notes = layer.notes.filter((n) => n && Number.isFinite(n.onsetSec) && Number.isFinite(n.durSec) && Number.isFinite(n.midi))
        return notes.length === layer.notes.length ? layer : { ...layer, notes }
    }

    /** The file behind one audio source of one clip — only ever a path found by listing the dataset. */
    static audioFile(id: string, clip: string, key: string): string | null {
        const dataset = Corpus.dataset(id)
        if (!dataset?.hasClip(clip)) return null
        const record = ResynthStore.clips(id).get(clip) ?? null
        return dataset.audio(clip, record).find((a) => a.key === key)?.path ?? null
    }
}
