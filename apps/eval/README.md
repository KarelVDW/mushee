# @mushee/eval — corpus & benchmarking workbench

A local-first UI over the script eval harness (`apps/api/scripts/eval`): browse
corpora and reports, inspect clips against the production pipeline, and —
the reason it exists — **create new corpora and record their clips** straight
into the fixtures tree the scripts read.

```sh
pnpm dev:db     # postgres :5632 (same instance as apps/api)
pnpm dev:eval   # http://localhost:3600
```

No auth, no deploy target. The API routes are Vercel-function-shaped Next
handlers, but they do local work by design: they read/write
`apps/api/scripts/fixtures/**` and spawn the harness with `cwd=apps/api` so the
TF models resolve. Running this anywhere but this machine's checkout is a
non-goal for now.

## What lives where

| Concern                                           | Home                                                                                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus/clip metadata, expected notes, run history | Postgres, schema **`eval`** — own tables, own `eval.migrations` ledger (`src/server/db.ts`); never touches the API's `public` schema                                                           |
| Recorded audio + ground truth + manifest          | `apps/api/scripts/fixtures/eval-real/<tier>/<corpus>/` — materialized on every save (`src/server/fixtures.ts`), so `run-eval.ts` and the agents see UI-created corpora with **no export step** |
| Transcription (“derived notes”, retry)            | `apps/api/scripts/eval/transcribe-worker.ts`, a long-lived child process managed by `src/server/transcriber.ts`; loads the production ProviderRegistry once, then each take/retry is fast      |
| Harness runs (“Score with harness”)               | spawns `run-eval.ts` with `EVAL_REAL=1 EVAL_ADAPTIVE=1`, scoped via `EVAL_SCENARIOS`; the report JSON lands next to the others and the summary is kept in `eval.run`                           |
| Reports & comparison                              | `/reports` lists every `report*.json` under `fixtures/eval{,-real}`; pick two for per-dataset paired bars + deltas                                                                             |

## Corpus creation & recording

`/corpora/new` generates N seeded clips (`src/lib/generator.ts`: diatonic,
spelled per key, measures filled exactly; same seed + params ⇒ same clips).
The recording session (`/corpora/<id>/record`) plays the expected notes and a
metronome, records with a one-measure count-in (mic constraints copied from the
product: voice processing off), trims the count-in server-side so the wav's
t=0 is beat 0, transcodes to 48 kHz mono wav, and transcribes in place before
you move to the next clip.

Truth for these corpora is **prescribed**: the generated melody is the ground
truth and you perform it to the click. A sloppy take therefore lies — the clip
page's expected/derived overlay is how you catch and re-record it. New corpora
default to the `context/` tier; put one in `benchmark/` only when you'd let its
numbers gate decisions (see `apps/api/scripts/eval/CORPORA.md`).

## Playback stack

`MidiPlayer`, `Ticker`, `ScoreScheduler` and `Metronome` live in
**`packages/playback`** (`@mushee/playback`), shared with `apps/web`.
`src/lib/playback/` holds only this app's own transport on top of them:
`EvalPlayer` (replay + metronome-guided takes) and `TakeRecorder` (mic
capture, no WebSocket).
