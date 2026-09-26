import { MusicXmlImporter } from '@mushee/notation/model/util/MusicXmlImporter'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { makeScore, pitched } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

import { AccountExport, ZipWriter } from '@/lib/AccountExport'
import { MxlArchive } from '@/lib/MxlArchive'

async function open(blob: Blob): Promise<MxlArchive> {
    return new MxlArchive(new Uint8Array(await blob.arrayBuffer()))
}

describe('ZipWriter', () => {
    it('writes an archive the MxlArchive reader (and any unzip) accepts, with exact contents', async () => {
        const zip = new ZipWriter(new Date(2026, 8, 5, 10, 30, 0))
            .add('META-INF/container.xml', '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>')
            .add('score.musicxml', '<score-partwise/>')
            .add('notes/ünïcödé.txt', 'héllo')
        const archive = await open(zip.toBlob())
        expect(MxlArchive.isZip(zip.toBytes())).toBe(true)
        expect(archive.names()).toEqual(['META-INF/container.xml', 'score.musicxml', 'notes/ünïcödé.txt'])
        expect(await archive.rootFile()).toBe('<score-partwise/>')
        expect(await archive.file('notes/ünïcödé.txt')).toBe('héllo')
        expect(await archive.file('missing')).toBeUndefined()
    })

    it('computes the standard CRC-32', () => {
        // Reference values: crc32("") = 0, crc32("123456789") = 0xCBF43926.
        expect(ZipWriter.crc32(new Uint8Array())).toBe(0)
        expect(ZipWriter.crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    })
})

describe('AccountExport', () => {
    const profile = { name: 'Ada', email: 'ada@example.com', createdAt: '2026-01-02T00:00:00.000Z' }
    const when = new Date('2026-09-05T01:02:03.000Z')

    function document() {
        const score = makeScore(1)
        score.replace([score.measures[0].notes[0]], [pitched('G', 4, 'h')])
        return JSON.parse(JSON.stringify(new ScoreSerializer(score).toInput())) as Record<string, unknown>
    }

    it('names the archive by export date', () => {
        expect(new AccountExport(profile, null, [], when).filename).toBe('solkey-export-2026-09-05.zip')
    })

    it('packs profile, settings and every score as MusicXML + JSON, with an index and a README', async () => {
        const meta = (id: string, title: string) => ({
            id,
            title,
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-03-01T00:00:00.000Z',
        })
        const exported = new AccountExport(
            profile,
            { keyboardShortcuts: { 'note.up': ['ArrowUp'] } as never },
            [
                { meta: meta('a', 'Étude No. 3 (draft)'), document: document() },
                { meta: meta('b', '   '), document: { raw: '<score-partwise version="4.0"/>' } },
            ],
            when,
        )
        const archive = await open(exported.toBlob())

        expect(archive.names()).toEqual([
            'scores/001-etude-no-3-draft.json',
            'scores/001-etude-no-3-draft.musicxml',
            'scores/002-untitled.json',
            'scores/002-untitled.musicxml',
            'README.txt',
            'profile.json',
            'settings.json',
            'scores/index.json',
        ])
        expect(JSON.parse((await archive.file('profile.json')) ?? '')).toEqual({ ...profile, exportedAt: when.toISOString() })
        expect(JSON.parse((await archive.file('settings.json')) ?? '')).toEqual({ keyboardShortcuts: { 'note.up': ['ArrowUp'] } })

        // The MusicXML is a real score the importer reads back — title and the note included.
        const imported = new MusicXmlImporter((await archive.file('scores/001-etude-no-3-draft.musicxml')) ?? '').toScore()
        expect(imported.title).toBe('Étude No. 3 (draft)')
        expect(imported.score.measures[0].notes[0].pitch?.name).toBe('G')
        // A stored raw MusicXML document is passed through untouched.
        expect(await archive.file('scores/002-untitled.musicxml')).toBe('<score-partwise version="4.0"/>')

        const index = JSON.parse((await archive.file('scores/index.json')) ?? '') as Array<{ id: string; files: string[] }>
        expect(index.map((entry) => entry.id)).toEqual(['a', 'b'])
        expect(index[0].files).toEqual(['scores/001-etude-no-3-draft.json', 'scores/001-etude-no-3-draft.musicxml'])
        expect(await archive.file('README.txt')).toContain('2 scores exported.')
    })

    it('keeps an unreadable score as JSON only and says so in the README', async () => {
        const meta = { id: 'x', title: 'Broken', createdAt: '', updatedAt: '' }
        const archive = await open(new AccountExport(profile, null, [{ meta, document: { parts: 'nonsense' } }], when).toBlob())
        expect(archive.names()).toContain('scores/001-broken.json')
        expect(archive.names()).not.toContain('scores/001-broken.musicxml')
        expect(await archive.file('README.txt')).toContain('included as JSON only:\n  - Broken')
        expect(await archive.file('settings.json')).toBe(JSON.stringify({ keyboardShortcuts: null }, null, 2))
    })

    it('slugs titles safely', () => {
        expect(AccountExport.slug('Für Elise — Op. 59!')).toBe('fur-elise-op-59')
        expect(AccountExport.slug('')).toBe('untitled')
        expect(AccountExport.slug('a'.repeat(80))).toHaveLength(60)
    })
})
