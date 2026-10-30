import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'

/**
 * A local audio file as an HTTP response with byte-range support. Safari will not seek in (and
 * sometimes not even start) an <audio> source that ignores `Range`, and every browser uses it to
 * jump around a long clip without downloading all of it. One range per request, as browsers ask;
 * `bytes=a-b`, `bytes=a-` and the suffix form `bytes=-n` are honoured.
 */
export class AudioResponse {
    private static readonly TYPES: Record<string, string> = { wav: 'audio/wav', flac: 'audio/flac' }

    constructor(
        private readonly path: string,
        private readonly request: Request,
    ) {}

    build(): Response {
        const stat = statSync(this.path)
        const size = stat.size
        const etag = `"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
        const headers = new Headers({
            'Content-Type': AudioResponse.TYPES[this.path.split('.').pop() ?? ''] ?? 'application/octet-stream',
            'Accept-Ranges': 'bytes',
            // Work copies are re-rendered in place every round: revalidate, never assume.
            'Cache-Control': 'no-cache',
            ETag: etag,
            'Last-Modified': stat.mtime.toUTCString(),
        })
        if (this.request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })

        const range = this.range(size)
        if (range === 'unsatisfiable') {
            headers.set('Content-Range', `bytes */${size}`)
            return new Response(null, { status: 416, headers })
        }
        const [start, end] = range ?? [0, size - 1]
        headers.set('Content-Length', String(end - start + 1))
        if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
        if (this.request.method === 'HEAD' || size === 0) return new Response(null, { status: range ? 206 : 200, headers })
        const body = Readable.toWeb(createReadStream(this.path, { start, end })) as ReadableStream<Uint8Array>
        return new Response(body, { status: range ? 206 : 200, headers })
    }

    private range(size: number): [number, number] | 'unsatisfiable' | null {
        const header = this.request.headers.get('range')
        const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
        if (!m || (m[1] === '' && m[2] === '')) return null
        let start: number
        let end: number
        if (m[1] === '') {
            // Suffix: the last n bytes.
            start = Math.max(0, size - Number(m[2]))
            end = size - 1
        } else {
            start = Number(m[1])
            end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
        }
        if (start >= size || start > end) return 'unsatisfiable'
        return [start, end]
    }
}
