#!/usr/bin/env bash
# Run one voice-onset experiment through the PRODUCTION path on both the realistic
# synthetic voices (4 conditions) and the real singing corpora, in parallel.
#   scripts/eval/voice-exp.sh <label> [ENV=VALUE ...]      → <outdir>/<label>-*.json
set -euo pipefail
label=$1; shift
out=${VOICE_EXP_OUT:-/tmp/voice-exp}
mkdir -p "$out"
cd "$(dirname "$0")/../.."
envs=("$@")
synth_ds=$(ls scripts/fixtures/eval-synth | grep synth-voice | paste -sd, -)
pids=()
for c in studio room home-phone noisy-phone; do
    env "${envs[@]}" EVAL_SYNTH=1 EVAL_ADAPTIVE=1 EVAL_SCENARIOS="$synth_ds" EVAL_CONDITIONS=$c EVAL_OUT="$out/$label-synth-$c.json" \
        pnpm exec tsx scripts/eval/run-eval.ts > "$out/$label-synth-$c.log" 2>&1 & pids+=($!)
done
for grp in ${VOICE_EXP_REAL:-"vocadito,hust-solfege,csd" "n20emv2" "annotated-vocalset"}; do
    env "${envs[@]}" EVAL_REAL=1 EVAL_ADAPTIVE=1 EVAL_SCENARIOS="$grp" EVAL_CONDITIONS=real EVAL_OUT="$out/$label-real-${grp%%,*}.json" \
        pnpm exec tsx scripts/eval/run-eval.ts > "$out/$label-real-${grp%%,*}.log" 2>&1 & pids+=($!)
done
wait "${pids[@]}"
echo "done $label"
