import type { ScorePartwise } from '@mushee/notation/components/types'
import { MusicXmlExporter } from '@mushee/notation/model/util/MusicXmlExporter'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'

import { getSettings, listScores, loadScore, type ScoreMeta, type UserSettings } from './api'

/**
 * A minimal zip writer for the data export: stored (uncompressed) entries with
 * UTF-8 names, so the archive opens anywhere and needs no compression library —
 * the mirror image of `MxlArchive`, which reads such files. Scores are small,
 * so leaving them uncompressed costs nothing worth a dependency.
 */
export class ZipWriter {
    private static readonly CRC_TABLE = ZipWriter.buildCrcTable()
    private readonly locals: Uint8Array[] = []
    private readonly central: Uint8Array[] = []
    private offset = 0
    private readonly dosTime: number
    private readonly dosDate: number

    constructor(timestamp = new Date()) {
        // Zip stores local time in the DOS format (2-second resolution, years from 1980).
        this.dosTime = (timestamp.getHours() << 11) | (timestamp.getMinutes() << 5) | (timestamp.getSeconds() >> 1)
        this.dosDate = ((Math.max(1980, timestamp.getFullYear()) - 1980) << 9) | ((timestamp.getMonth() + 1) << 5) | timestamp.getDate()
    }

    /** Append one file. Text is encoded as UTF-8. Returns the writer for chaining. */
    add(name: string, content: string | Uint8Array): this {
        const data = typeof content === 'string' ? new TextEncoder().encode(content) : content
        const encodedName = new TextEncoder().encode(name)
        const crc = ZipWriter.crc32(data)

        const local = new Uint8Array(30 + encodedName.length + data.length)
        const localView = new DataView(local.buffer)
        localView.setUint32(0, 0x04034b50, true) // local file header
        localView.setUint16(4, 20, true) // version needed: 2.0
        localView.setUint16(6, 0x0800, true) // flags: UTF-8 names
        localView.setUint16(8, 0, true) // method: stored
        localView.setUint16(10, this.dosTime, true)
        localView.setUint16(12, this.dosDate, true)
        localView.setUint32(14, crc, true)
        localView.setUint32(18, data.length, true)
        localView.setUint32(22, data.length, true)
        localView.setUint16(26, encodedName.length, true)
        localView.setUint16(28, 0, true) // extra length
        local.set(encodedName, 30)
        local.set(data, 30 + encodedName.length)

        const entry = new Uint8Array(46 + encodedName.length)
        const entryView = new DataView(entry.buffer)
        entryView.setUint32(0, 0x02014b50, true) // central directory header
        entryView.setUint16(4, 20, true) // version made by
        entryView.setUint16(6, 20, true) // version needed
        entryView.setUint16(8, 0x0800, true)
        entryView.setUint16(10, 0, true)
        entryView.setUint16(12, this.dosTime, true)
        entryView.setUint16(14, this.dosDate, true)
        entryView.setUint32(16, crc, true)
        entryView.setUint32(20, data.length, true)
        entryView.setUint32(24, data.length, true)
        entryView.setUint16(28, encodedName.length, true)
        entryView.setUint16(30, 0, true) // extra length
        entryView.setUint16(32, 0, true) // comment length
        entryView.setUint16(34, 0, true) // disk number
        entryView.setUint16(36, 0, true) // internal attributes
        entryView.setUint32(38, 0, true) // external attributes
        entryView.setUint32(42, this.offset, true) // local header offset
        entry.set(encodedName, 46)

        this.locals.push(local)
        this.central.push(entry)
        this.offset += local.length
        return this
    }

    toBytes(): Uint8Array<ArrayBuffer> {
        const centralSize = this.central.reduce((sum, entry) => sum + entry.length, 0)
        const bytes = new Uint8Array(this.offset + centralSize + 22)
        let position = 0
        for (const chunk of [...this.locals, ...this.central]) {
            bytes.set(chunk, position)
            position += chunk.length
        }
        const end = new DataView(bytes.buffer, position)
        end.setUint32(0, 0x06054b50, true) // end of central directory
        end.setUint16(4, 0, true)
        end.setUint16(6, 0, true)
        end.setUint16(8, this.central.length, true)
        end.setUint16(10, this.central.length, true)
        end.setUint32(12, centralSize, true)
        end.setUint32(16, this.offset, true)
        end.setUint16(20, 0, true) // comment length
        return bytes
    }

    toBlob(): Blob {
        return new Blob([this.toBytes()], { type: 'application/zip' })
    }

    static crc32(data: Uint8Array): number {
        let crc = 0xffffffff
        for (const byte of data) crc = ZipWriter.CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
        return (crc ^ 0xffffffff) >>> 0
    }

    private static buildCrcTable(): Uint32Array {
        const table = new Uint32Array(256)
        for (let n = 0; n < 256; n++) {
            let c = n
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            table[n] = c >>> 0
        }
        return table
    }
}

export interface ExportProfile {
    name: string
    email: string
    /** ISO timestamp of account creation, when the session exposes it. */
    createdAt?: string
}

export interface ExportedScore {
    meta: ScoreMeta
    document: Record<string, unknown>
}

/**
 * The GDPR "download my data" archive: everything Solkey holds for an account
 * that the account holder can carry elsewhere — profile, settings, and every
 * score both as MusicXML (portable, opens in any notation app) and as the
 * stored JSON (lossless). Assembled in the browser from the same endpoints
 * the app already uses, so no server-side export pipeline is needed.
 * Recordings audio is not included: it is raw microphone input tied to the
 * account, deleted with it, and offered nowhere else in the product.
 */
export class AccountExport {
    constructor(
        readonly profile: ExportProfile,
        readonly settings: UserSettings | null,
        readonly scores: readonly ExportedScore[],
        readonly exportedAt = new Date(),
    ) {}

    /** Fetch everything the export needs. Settings are optional — a failure there must not block the scores. */
    static async collect(profile: ExportProfile): Promise<AccountExport> {
        const metas = await listScores()
        const scores = await Promise.all(metas.map(async (meta) => ({ meta, document: await loadScore(meta.id) })))
        const settings = await getSettings().catch(() => null)
        return new AccountExport(profile, settings, scores)
    }

    /** `solkey-export-2026-09-05.zip` */
    get filename(): string {
        return `solkey-export-${this.exportedAt.toISOString().slice(0, 10)}.zip`
    }

    toBlob(): Blob {
        const zip = new ZipWriter(this.exportedAt)
        const failures: string[] = []
        const index: Array<Record<string, unknown>> = []

        this.scores.forEach(({ meta, document }, i) => {
            const base = `scores/${String(i + 1).padStart(3, '0')}-${AccountExport.slug(meta.title)}`
            zip.add(`${base}.json`, JSON.stringify(document, null, 2))
            const xml = this.toMusicXml(meta.title, document)
            if (xml) zip.add(`${base}.musicxml`, xml)
            else failures.push(meta.title)
            index.push({ id: meta.id, title: meta.title, createdAt: meta.createdAt, updatedAt: meta.updatedAt, files: [`${base}.json`, ...(xml ? [`${base}.musicxml`] : [])] })
        })

        zip.add('README.txt', this.readme(failures))
        zip.add('profile.json', JSON.stringify({ ...this.profile, exportedAt: this.exportedAt.toISOString() }, null, 2))
        zip.add('settings.json', JSON.stringify(this.settings ?? { keyboardShortcuts: null }, null, 2))
        zip.add('scores/index.json', JSON.stringify(index, null, 2))
        return zip.toBlob()
    }

    /** The stored document rendered as MusicXML; undefined when it cannot be read as a score. */
    private toMusicXml(title: string, document: Record<string, unknown>): string | undefined {
        if (typeof document.raw === 'string') return document.raw
        try {
            return new MusicXmlExporter(new ScoreDeserializer(document as unknown as ScorePartwise).toScore()).toXml(title)
        } catch {
            return undefined
        }
    }

    private readme(failures: string[]): string {
        const lines = [
            `Solkey data export for ${this.profile.email}`,
            `Exported ${this.exportedAt.toISOString()}`,
            '',
            'profile.json      Your account profile.',
            'settings.json     Your in-app settings (keyboard shortcuts).',
            'scores/           Every score in your library, twice:',
            '                  .musicxml opens in any notation program (MuseScore, Dorico, Finale, Sibelius, ...);',
            '                  .json is the exact document Solkey stores.',
            'scores/index.json Titles, ids and timestamps of every score.',
            '',
            `${this.scores.length} ${this.scores.length === 1 ? 'score' : 'scores'} exported.`,
        ]
        if (failures.length) {
            lines.push('', 'These scores could not be converted to MusicXML and are included as JSON only:')
            lines.push(...failures.map((title) => `  - ${title}`))
        }
        lines.push('', 'Recording audio is not part of this export; it is deleted with your account.', 'Questions: privacy@solkey.io')
        return lines.join('\n') + '\n'
    }

    /** A file-system-safe stem: "Étude No. 3 (draft)" → "etude-no-3-draft". */
    static slug(title: string): string {
        const slug = title
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60)
            .replace(/-+$/, '')
        return slug || 'untitled'
    }
}
