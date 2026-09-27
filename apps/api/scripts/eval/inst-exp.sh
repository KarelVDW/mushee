#!/usr/bin/env bash
# Instrument-side A/B through the PRODUCTION path: synthetic instruments (room, home-phone)
# + the real instrument corpora (URMP, GuitarSet) as the guard.
#   scripts/eval/inst-exp.sh <label> [ENV=VALUE ...]
set -euo pipefail
label=$1; shift
out=${INST_EXP_OUT:-/tmp/inst-exp}
mkdir -p "$out"
cd "$(dirname "$0")/../.."
envs=("$@")
synth_ds=$(ls scripts/fixtures/eval-synth | grep -v synth-voice | paste -sd, -)
real_ds=$(ls scripts/fixtures/eval-real/benchmark | grep -E '^urmp-|guitarset' | paste -sd, -)
pids=()
for c in room home-phone; do
    env "${envs[@]}" EVAL_SYNTH=1 EVAL_ADAPTIVE=1 EVAL_SCENARIOS="$synth_ds" EVAL_CONDITIONS=$c EVAL_OUT="$out/$label-synth-$c.json" \
        pnpm exec tsx scripts/eval/run-eval.ts > "$out/$label-synth-$c.log" 2>&1 & pids+=($!)
done
env "${envs[@]}" EVAL_REAL=1 EVAL_ADAPTIVE=1 EVAL_SCENARIOS="$real_ds" EVAL_CONDITIONS=real EVAL_OUT="$out/$label-real-inst.json" \
    pnpm exec tsx scripts/eval/run-eval.ts > "$out/$label-real-inst.log" 2>&1 & pids+=($!)
wait "${pids[@]}"
echo "done $label"
