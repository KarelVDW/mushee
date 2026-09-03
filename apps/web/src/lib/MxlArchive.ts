/**
 * A compressed MusicXML container (.mxl): a zip whose META-INF/container.xml names
 * the score file inside. Reads just what those containers use — the central
 * directory, and entries that are stored or deflated — and inflates with the
 * browser's DecompressionStream, so there is no zip dependency to ship.
 */
export class MxlArchive {
    private readonly view: DataView

    constructor(private readonly bytes: Uint8Array<ArrayBuffer>) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    }

    /** Whether the bytes start with a zip local-file header. */
    static isZip(bytes: Uint8Array): boolean {
        return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
    }

    /** The MusicXML document the container points at (falling back to the first score file outside META-INF). */
    async rootFile(): Promise<string> {
        const entries = this.entries()
        const container = entries.find((entry) => entry.name === 'META-INF/container.xml')
        const rootPath = container ? /<rootfile\b[^>]*\bfull-path="([^"]+)"/.exec(await this.extract(container))?.[1] : undefined
        const root =
            (rootPath && entries.find((entry) => entry.name === rootPath)) ??
            entries.find((entry) => !entry.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(entry.name))
        if (!root) throw new Error('The archive contains no MusicXML score.')
        return this.extract(root)
    }

    private entries(): ZipEntry[] {
        // The end-of-central-directory record sits in the last 64KB + 22 bytes (it may trail a comment).
        let eocd = -1
        for (let i = this.bytes.length - 22; i >= Math.max(0, this.bytes.length - 65_557); i--) {
            if (this.view.getUint32(i, true) === 0x06054b50) {
                eocd = i
                break
            }
        }
        if (eocd < 0) throw new Error('The archive is not a valid zip file.')
        const count = this.view.getUint16(eocd + 10, true)
        let offset = this.view.getUint32(eocd + 16, true)

        const entries: ZipEntry[] = []
        for (let i = 0; i < count; i++) {
            if (offset + 46 > this.bytes.length || this.view.getUint32(offset, true) !== 0x02014b50)
                throw new Error('The archive is not a valid zip file.')
            const nameLength = this.view.getUint16(offset + 28, true)
            const extraLength = this.view.getUint16(offset + 30, true)
            const commentLength = this.view.getUint16(offset + 32, true)
            entries.push({
                name: new TextDecoder().decode(this.bytes.subarray(offset + 46, offset + 46 + nameLength)),
                method: this.view.getUint16(offset + 10, true),
                compressedSize: this.view.getUint32(offset + 20, true),
                localHeaderOffset: this.view.getUint32(offset + 42, true),
            })
            offset += 46 + nameLength + extraLength + commentLength
        }
        return entries
    }

    private async extract(entry: ZipEntry): Promise<string> {
        const header = entry.localHeaderOffset
        if (header + 30 > this.bytes.length || this.view.getUint32(header, true) !== 0x04034b50)
            throw new Error('The archive is not a valid zip file.')
        const start = header + 30 + this.view.getUint16(header + 26, true) + this.view.getUint16(header + 28, true)
        const data = this.bytes.subarray(start, start + entry.compressedSize)
        if (entry.method === 0) return new TextDecoder().decode(data)
        if (entry.method !== 8) throw new Error('The archive uses an unsupported compression method.')
        return new TextDecoder().decode(await MxlArchive.inflate(data))
    }

    private static async inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
        const stream: ReadableStream<Uint8Array> = new ReadableStream<BufferSource>({
            start(controller) {
                controller.enqueue(data)
                controller.close()
            },
        }).pipeThrough(new DecompressionStream('deflate-raw'))
        const chunks: Uint8Array[] = []
        const reader = stream.getReader()
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
        }
        const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
        let offset = 0
        for (const chunk of chunks) {
            result.set(chunk, offset)
            offset += chunk.length
        }
        return result
    }
}

interface ZipEntry {
    name: string
    method: number
    compressedSize: number
    localHeaderOffset: number
}
