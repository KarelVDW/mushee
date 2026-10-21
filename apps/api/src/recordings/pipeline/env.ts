/**
 * The pipeline's env overrides, one semantics for every tuning knob.
 *
 * Every reader falls back on an unset or empty variable and on anything that
 * is not a finite number, so a typo can never feed NaN into the pipeline.
 * Production leaves all of these unset; they exist for the eval harness's A/B
 * runs and for ops rollbacks without a deploy. Each module still reads its own
 * knobs at import time — only the switches shared by two modules live here.
 */

function readNumber(key: string): number | undefined {
    const raw = process.env[key]
    if (raw === undefined || raw === '') return undefined
    const v = Number(raw)
    return Number.isFinite(v) ? v : undefined
}

/** Numeric override; `0` is a legitimate value. */
export function envNumber(key: string, fallback: number): number {
    return readNumber(key) ?? fallback
}

/** Numeric override with no default: undefined unless set to a finite number. */
export function envOptionalNumber(key: string): number | undefined {
    return readNumber(key)
}

/**
 * Numeric override for a quantity that must stay positive (a timeout, a cadence,
 * a margin): `0` or a negative value keeps the default, so an explicit 0 can
 * never mean "no deadline" or "no margin".
 */
export function envPositiveNumber(key: string, fallback: number): number {
    const v = readNumber(key)
    return v !== undefined && v > 0 ? v : fallback
}

/**
 * Boolean switch. Default on (a kill-switch): only `'0'` turns it off. Default
 * off (an opt-in): only `'1'` turns it on. Any other value keeps the default.
 */
export function envFlag(key: string, defaultOn = true): boolean {
    const raw = process.env[key]
    return defaultOn ? raw !== '0' : raw === '1'
}

/**
 * A/B kill-switch for noise adaptation, read by both the pitch scan and the
 * resolver: `RECORDING_NOISE_ADAPT=0` restores the legacy scan (no whitening,
 * energy-only voicing gate) and skips the resolver's noisy-take overlay
 * (`applyNoise`). Default on.
 */
export const NOISE_ADAPT = envFlag('RECORDING_NOISE_ADAPT')

/**
 * Kill-switch for voice routing: `RECORDING_VOICE_DECODE=0` sends singing back
 * through the shared semitone-run segmenter.
 *
 * Two jobs. In the eval harness it is the only way to get a clean A/B of the
 * voice decode over the *production* path — `EVAL_NO_HINT` also removes the
 * frequency-window hint, so it cannot isolate this. In production it is the
 * rollback: the decode is a large behavioural change on the one input class the
 * product exists for, and reverting it should not need a deploy.
 */
export const VOICE_DECODE = envFlag('RECORDING_VOICE_DECODE')
