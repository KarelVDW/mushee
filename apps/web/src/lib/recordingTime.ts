/**
 * Recording time as a clock reading — the one way the product writes seconds of
 * recording (takes list, daily budget meter, limit dialog): 42 → "0:42",
 * 125 → "2:05", 3725 → "1:02:05". Whole seconds, rounded down like a stopwatch.
 */
export function formatRecordingTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const mmss = `${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`
    return h ? `${h}:${mmss}` : mmss
}
