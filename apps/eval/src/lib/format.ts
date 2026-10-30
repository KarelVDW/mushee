import type { TruthSource } from './dto'

/** A number never breaks from its unit (DESIGN.md §2). */
const NBSP = '\u00a0'

/** How this app writes numbers, dates and labels — one voice on every page. */
export class Fmt {
    /** A score on the 0–1 scale (COnP, COnPOff, onset F1…), three decimals as RESULTS.md prints them. */
    static score(v: number | null | undefined, digits = 3): string {
        return v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits)
    }

    /** A signed difference of two scores. */
    static delta(v: number | null | undefined, digits = 3): string {
        if (v == null || !Number.isFinite(v)) return '—'
        const rounded = Number(v.toFixed(digits))
        return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded).toFixed(digits)}`
    }

    static percent(v: number | null | undefined): string {
        return v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`
    }

    static count(v: number | null | undefined): string {
        return v == null ? '—' : v.toLocaleString('en-US')
    }

    /** 2026-09-27 06:23 — the harness writes UTC; this app is read on the machine that ran it. */
    static dateTime(iso: string | null | undefined): string {
        if (!iso) return '—'
        const d = new Date(iso)
        if (Number.isNaN(d.getTime())) return iso
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    static date(iso: string | null | undefined): string {
        return Fmt.dateTime(iso).slice(0, 10)
    }

    /** 1:05 for clips, 2 h 48 min for runs. */
    static clock(sec: number | null | undefined): string {
        if (sec == null || !Number.isFinite(sec)) return '—'
        const s = Math.max(0, sec)
        return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
    }

    static clockPrecise(sec: number): string {
        const s = Math.max(0, sec)
        return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
    }

    static duration(sec: number | null | undefined): string {
        if (sec == null || !Number.isFinite(sec)) return '—'
        if (sec < 90) return `${Math.round(sec)}${NBSP}s`
        const minutes = Math.round(sec / 60)
        return minutes < 90 ? `${minutes}${NBSP}min` : `${Math.floor(minutes / 60)}${NBSP}h ${minutes % 60}${NBSP}min`
    }

    static truthSource(source: TruthSource): string {
        return TRUTH_SOURCE_LABELS[source]
    }
}

const TRUTH_SOURCE_LABELS: Record<TruthSource, string> = {
    human: 'human',
    resynth: 'resynth',
    derived: 'derived',
    constructed: 'constructed',
    onsets: 'onsets only',
}
