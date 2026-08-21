/**
 * Materializes UI-created corpora into the harness's on-disk layout
 * (apps/api/scripts/fixtures/eval-real/<tier>/<id>/), continuously: every
 * recorded take updates the wav + truth + dataset.json in place, so
 * run-eval.ts and friends can score these corpora at any moment.
 *
 * Only RECORDED clips get a truth.json — a truth without its wav would make
 * the dataset look bigger than it is to the discovery code.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import { melodyNoteCount, melodyToTruth } from '@/lib/melody'

import { REAL_ROOT } from './paths'
import type { Clip, Corpus } from './repo'

export function corpusDir(corpus: Pick<Corpus, 'id' | 'tier'>): string {
    return join(REAL_ROOT, corpus.tier, corpus.id)
}

/**
 * The adaptive pipeline's instrument hint, mirroring what the fetchers write:
 * voice datasets hint voice-lead, whistle hints tin-whistle. Shared by the
 * dataset.json manifest (run-eval reads it) and the in-app transcribe route,
 * so the two score the same clip under the same profile.
 */
export function pipelineInstrumentId(kind: string, instrumentId: string | null): string | undefined {
    if (instrumentId) return instrumentId
    if (kind === 'voice') return 'voice-lead'
    if (kind === 'whistle') return 'tin-whistle'
    return undefined
}

export function clipWavPath(corpus: Pick<Corpus, 'id' | 'tier'>, clipName: string): string {
    return join(corpusDir(corpus), `${clipName}__real.wav`)
}

function writeDatasetJson(corpus: Corpus, recordedClips: Clip[]): void {
    const dir = corpusDir(corpus)
    mkdirSync(dir, { recursive: true })
    const manifest = {
        id: corpus.id,
        label: corpus.label,
        kind: corpus.kind,
        instrumentId: pipelineInstrumentId(corpus.kind, corpus.instrumentId),
        source: 'recorded in-house via apps/eval',
        license: 'internal — our own recordings',
        annotator: 'prescribed melody (generated, performed to a metronome)',
        bpmAssumed: false,
        clips: recordedClips.length,
        totalNotes: recordedClips.reduce((sum, clip) => sum + melodyNoteCount(clip.melody), 0),
    }
    writeFileSync(join(dir, 'dataset.json'), JSON.stringify(manifest, null, 2) + '\n')
}

/** Persist one recorded take: wav + derived truth, then refresh the manifest. */
export function saveClipRecording(corpus: Corpus, clip: Clip, allClips: Clip[], wav: Buffer): void {
    const dir = corpusDir(corpus)
    mkdirSync(dir, { recursive: true })
    writeFileSync(clipWavPath(corpus, clip.name), wav)
    writeFileSync(join(dir, `${clip.name}.truth.json`), JSON.stringify(melodyToTruth(clip.melody), null, 2) + '\n')
    const recorded = allClips.filter((c) => c.status === 'recorded' || c.id === clip.id)
    writeDatasetJson(corpus, recorded)
}

export function deleteCorpusFixtures(corpus: Pick<Corpus, 'id' | 'tier'>): void {
    const dir = corpusDir(corpus)
    // Refuse to remove anything that isn't shaped like one of our datasets.
    if (!existsSync(dir)) return
    const entries = readdirSync(dir)
    const foreign = entries.filter(
        (f) => !f.endsWith('__real.wav') && !f.endsWith('.truth.json') && f !== 'dataset.json',
    )
    if (foreign.length) throw new Error(`refusing to delete ${dir}: unexpected files ${foreign.join(', ')}`)
    rmSync(dir, { recursive: true })
}
