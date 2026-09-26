import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { MxlArchive } from '@/lib/MxlArchive'

// --- A minimal zip writer: local headers, central directory, end record ---

interface ZipFile {
    name: string
    content: string
    method?: number
}

const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
const ascii = (s: string) => Array.from(new TextEncoder().encode(s))

function zip(files: ZipFile[], { comment = '' } = {}): Uint8Array<ArrayBuffer> {
    const body: number[] = []
    const central: number[] = []
    for (const file of files) {
        const method = file.method ?? 8
        const raw = new TextEncoder().encode(file.content)
        const data = method === 8 ? Array.from(deflateRawSync(raw)) : Array.from(raw)
        const name = ascii(file.name)
        const offset = body.length
        body.push(...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0), ...le32(0))
        body.push(...le32(data.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...name, ...data)
        central.push(...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0), ...le32(0))
        central.push(
            ...le32(data.length),
            ...le32(raw.length),
            ...le16(name.length),
            ...le16(0),
            ...le16(0),
            ...le16(0),
            ...le16(0),
            ...le32(0),
        )
        central.push(...le32(offset), ...name)
    }
    const commentBytes = ascii(comment)
    const eocd = [
        ...le32(0x06054b50),
        ...le16(0),
        ...le16(0),
        ...le16(files.length),
        ...le16(files.length),
        ...le32(central.length),
        ...le32(body.length),
        ...le16(commentBytes.length),
        ...commentBytes,
    ]
    return new Uint8Array([...body, ...central, ...eocd])
}

const SCORE = '<?xml version="1.0"?><score-partwise><part-list/><part id="P1"><measure/></part></score-partwise>'
const CONTAINER = (path: string) =>
    `<?xml version="1.0"?><container><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`

describe('MxlArchive', () => {
    it('recognizes a zip by its local-file signature', () => {
        expect(MxlArchive.isZip(zip([{ name: 'a.xml', content: '<a/>' }]))).toBe(true)
        expect(MxlArchive.isZip(new Uint8Array([0x50, 0x4b]))).toBe(false)
        expect(MxlArchive.isZip(new TextEncoder().encode('<score-partwise/>'))).toBe(false)
    })

    it('returns the score the container points at, inflating deflated entries', async () => {
        const archive = zip([
            { name: 'META-INF/container.xml', content: CONTAINER('nested/song.xml') },
            { name: 'decoy.xml', content: '<decoy/>' },
            { name: 'nested/song.xml', content: SCORE },
        ])
        await expect(new MxlArchive(archive).rootFile()).resolves.toBe(SCORE)
    })

    it('falls back to the first score file outside META-INF when the container is missing or points nowhere', async () => {
        const noContainer = zip(
            [
                { name: 'META-INF/manifest.xml', content: '<m/>' },
                { name: 'Song.MusicXML', content: SCORE, method: 0 },
            ],
            {
                comment: 'made by hand',
            },
        )
        await expect(new MxlArchive(noContainer).rootFile()).resolves.toBe(SCORE)

        const dangling = zip([
            { name: 'META-INF/container.xml', content: CONTAINER('gone.xml') },
            { name: 'here.xml', content: SCORE },
        ])
        await expect(new MxlArchive(dangling).rootFile()).resolves.toBe(SCORE)
    })

    it('rejects archives without a score, with unsupported compression, or that are not zips at all', async () => {
        await expect(new MxlArchive(zip([{ name: 'readme.txt', content: 'hi' }])).rootFile()).rejects.toThrow('no MusicXML score')
        await expect(new MxlArchive(zip([{ name: 'a.xml', content: SCORE, method: 12 }])).rootFile()).rejects.toThrow(
            'unsupported compression',
        )
        await expect(new MxlArchive(new TextEncoder().encode('PK\x03\x04 not really a zip at all')).rootFile()).rejects.toThrow(
            'not a valid zip',
        )

        // A central directory offset that points into garbage, and a local header that does too.
        const broken = zip([{ name: 'a.xml', content: SCORE }])
        broken[broken.length - 6] = 0xff
        await expect(new MxlArchive(broken).rootFile()).rejects.toThrow('not a valid zip')
        const badLocal = zip([{ name: 'a.xml', content: SCORE }])
        badLocal[0] = 0x00
        await expect(new MxlArchive(badLocal).rootFile()).rejects.toThrow('not a valid zip')
    })
})
