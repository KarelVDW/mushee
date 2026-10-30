/**
 * The timeline's fixed clip set → timeline/clipset.json (git-tracked).
 *
 *   pnpm exec tsx scripts/eval/timeline/clipset.ts [--check]
 *
 * Every historical pipeline is run on exactly these clips, so the per-commit
 * numbers pair clip-for-clip. The rule, deterministic on the corpus on disk:
 *
 *   - every pitched REAL dataset in fixtures/eval-real (benchmark and context
 *     tiers), INCLUDING the ones whose truth is still being made (resynth,
 *     meta/test-data-2026-10.md) — the notes are cached, the scoring re-runs
 *     whenever the truth changes;
 *   - plus jacrc-students: pitchless as a dataset (human syllable onsets), but
 *     its audio gets note truth in the new jacrc-notes (timeline.ts aliases);
 *   - minus the `-aligned` siblings (`derivedFrom`: byte-identical audio, their
 *     clips are already in via the source dataset), datasets that only re-home
 *     an included dataset's audio (alias targets: jacrc-notes) and avp
 *     (beatboxing, no pitch);
 *   - the `real` recording only, TEST half only (lib/split.ts `splitOf`, by
 *     performer): every threshold since 2026-07 was tuned looking at dev;
 *   - at most 40 clips per dataset, the first 40 in sha1(`<dataset>/<clip>`)
 *     order — stable under re-fetches, independent of the split hash, and it
 *     keeps esmuc-choir (145 test minutes) from dominating the run time.
 *
 * `--check` regenerates in memory and fails if the file differs: the corpus
 * gained or lost clips under the set. The committed set stays authoritative —
 * rewriting it breaks the clip-for-clip pairing with every cached notes file,
 * so do that only before a full re-run. The header records counts, not tiers or
 * truth sources, so the 2026-10 reorganisation alone does not change the file.
 */

import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

import { REAL_ROOT } from '../lib/evalRun'
import { discoverRealDatasets, listRealClips } from '../lib/realCorpus'
import { splitOf } from '../lib/split'
import { type ClipRef, CLIPSET_JSON, DATASET_ALIASES, REPO_ROOT } from './timeline'

const CAP = 40
/** Pitchless datasets whose audio is in anyway, and why. */
const PITCHLESS_INCLUDED: Record<string, string> = {
    'jacrc-students': 'note truth in jacrc-notes (resynth, 2026-10)',
}

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex')

function build(): string {
    const datasets = discoverRealDatasets(REAL_ROOT)
    const perDataset: Record<string, { clips: number; test: number; selected: number }> = {}
    const skipped: Record<string, string> = {}
    const clips: ClipRef[] = []
    const skip = (d: (typeof datasets)[number]): string | undefined => {
        if (d.derivedFrom) return `derived from ${d.derivedFrom} (same audio)`
        if (d.pitchless && !PITCHLESS_INCLUDED[d.id]) return 'pitchless'
        return undefined
    }
    // Datasets that hold an included dataset's audio under its new truth (jacrc-notes).
    const rehomed = new Map(
        datasets.filter((d) => !skip(d)).flatMap((d) => (DATASET_ALIASES[d.id] ?? []).map((target) => [target, d.id] as const)),
    )
    for (const d of datasets) {
        const why = skip(d) ?? (rehomed.has(d.id) ? `audio already in as ${rehomed.get(d.id)} (timeline.ts DATASET_ALIASES)` : undefined)
        if (why) {
            skipped[d.id] = why
            continue
        }
        const all = listRealClips(d.dir).filter((c) => existsSync(join(d.dir, `${c}__real.wav`)))
        const test = all.filter((c) => splitOf(d.id, c) === 'test')
        const chosen = test
            .map((c) => ({ c, h: sha1(`${d.id}/${c}`) }))
            .sort((a, b) => a.h.localeCompare(b.h))
            .slice(0, CAP)
            .map((x) => x.c)
            .sort()
        perDataset[d.id] = { clips: all.length, test: test.length, selected: chosen.length }
        for (const c of chosen) clips.push({ d: d.id, c })
    }
    const hash = sha1(clips.map((r) => `${r.d}/${r.c}\n`).join(''))
    const header = {
        about:
            'The fixed clip set every timeline commit is run on (timeline/clipset.ts writes it; timeline/README.md). ' +
            'Clips are named by the dataset their audio was in when the set was drawn; timeline.ts DATASET_ALIASES maps them to where their truth lives now.',
        rule: {
            corpus: relative(REPO_ROOT, REAL_ROOT),
            datasets:
                "every pitched real dataset (benchmark + context) plus pitchlessIncluded; minus derivedFrom siblings and datasets that re-home an included one's audio (timeline.ts DATASET_ALIASES targets)",
            pitchlessIncluded: PITCHLESS_INCLUDED,
            condition: 'real',
            split: 'test (lib/split.ts splitOf, performer-grouped)',
            capPerDataset: CAP,
            order: 'sha1("<dataset>/<clip>") ascending, first capPerDataset',
        },
        hash,
        size: clips.length,
        datasets: perDataset,
        skipped,
    }
    // Hand-laid so prettier leaves the file alone: header pretty, one clip per line.
    const head = JSON.stringify(header, null, 4).replace(/\n}$/, '')
    return `${head},\n    "clips": [\n${clips.map((r) => `        { "d": ${JSON.stringify(r.d)}, "c": ${JSON.stringify(r.c)} }`).join(',\n')}\n    ]\n}\n`
}

function main(): void {
    const next = build()
    const parsed = JSON.parse(next) as { size: number; hash: string; datasets: Record<string, { test: number; selected: number }> }
    for (const [id, s] of Object.entries(parsed.datasets))
        console.log(`  ${id.padEnd(32)} test ${String(s.test).padStart(4)}  selected ${s.selected}`)
    console.log(`clip set: ${parsed.size} clips, hash ${parsed.hash.slice(0, 12)}`)
    if (process.argv.includes('--check')) {
        const prev = existsSync(CLIPSET_JSON) ? readFileSync(CLIPSET_JSON, 'utf8') : ''
        if (prev !== next) {
            console.error(`${relative(REPO_ROOT, CLIPSET_JSON)} differs from the corpus on disk`)
            process.exit(1)
        }
        console.log('clipset.json matches the corpus')
        return
    }
    writeFileSync(CLIPSET_JSON, next)
    console.log(`written ${relative(REPO_ROOT, CLIPSET_JSON)}`)
}

main()
