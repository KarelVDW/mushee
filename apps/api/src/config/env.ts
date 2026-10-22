/*
 * API-wide readers of numeric settings from process.env. config/ holds every
 * decorator-free, API-wide env reader (this and app-urls.ts), so the TypeORM
 * CLI, the seeder and tsx scripts can import them outside Nest DI. The
 * transcription pipeline's own tuning knobs are read in recordings/pipeline/env.ts.
 */

/**
 * A positive integer from the environment, or the default. A typo or a
 * non-positive value must not silently change behaviour: a bare parseInt turns
 * a typo into NaN, which disables a limiter (`count > NaN` is never true), and
 * a negative cap stops every take on its first tick.
 */
export function positiveIntSetting(raw: string | undefined, fallback: number): number {
    const n = parseInt(raw ?? '', 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
}
