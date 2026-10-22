import type { ScorePartwise } from '@mushee/notation/model/io/MusicXml'
import { MusicXmlExporter } from '@mushee/notation/model/io/MusicXmlExporter'
import { ScoreDeserializer } from '@mushee/notation/model/io/ScoreDeserializer'

import { getSettings, listScores, loadScore, type ScoreDocument, type UserSettings } from './api'
import { ZipWriter } from './ZipWriter'

export interface ExportProfile {
    name: string
    email: string
    /** ISO timestamp of account creation, when the session exposes it. */
    createdAt?: string
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
        readonly scores: readonly ScoreDocument[],
        readonly exportedAt = new Date(),
    ) {}

    /** How many score documents load at once — well under the API's per-user rate limit even for large libraries. */
    static readonly CONCURRENCY = 4

    /** Fetch everything the export needs. Settings are optional — a failure there must not block the scores. */
    static async collect(profile: ExportProfile): Promise<AccountExport> {
        const [metas, settings] = await Promise.all([listScores(), getSettings().catch(() => null)])
        const scores: ScoreDocument[] = new Array<ScoreDocument>(metas.length)
        let next = 0
        const worker = async () => {
            for (let i = next++; i < metas.length; i = next++) scores[i] = { meta: metas[i], document: await loadScore(metas[i].id) }
        }
        await Promise.all(Array.from({ length: Math.min(AccountExport.CONCURRENCY, metas.length) }, worker))
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
            index.push({
                id: meta.id,
                title: meta.title,
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
                files: [`${base}.json`, ...(xml ? [`${base}.musicxml`] : [])],
            })
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
