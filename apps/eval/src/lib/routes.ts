/** Every in-app address, built in one place so a dataset or clip name is always encoded the same way. */
export class Route {
    static run(id: string): string {
        return `/runs/${encodeURIComponent(id)}`
    }

    static runs(kind: string): string {
        return `/runs?kind=${encodeURIComponent(kind)}`
    }

    static compare(a: string, b: string): string {
        return `/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
    }

    static dataset(id: string): string {
        return `/datasets/${encodeURIComponent(id)}`
    }

    /** A clip's compare view; `source` preselects whose pipeline notes to overlay (`run:<id>`). */
    static clip(dataset: string, clip: string, source?: string): string {
        const base = `/datasets/${encodeURIComponent(dataset)}/${encodeURIComponent(clip)}`
        return source ? `${base}?source=${encodeURIComponent(source)}` : base
    }

    /** A dynamic route segment as written on disk. Next hands segments over still percent-encoded in some cases. */
    static param(segment: string): string {
        try {
            return /%[0-9a-f]{2}/i.test(segment) ? decodeURIComponent(segment) : segment
        } catch {
            return segment
        }
    }
}
