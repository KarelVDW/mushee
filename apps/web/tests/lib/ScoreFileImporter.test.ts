import { describe, expect, it } from 'vitest'

import { ScoreFileImporter } from '@/lib/ScoreFileImporter'

const XML = `<?xml version="1.0"?><score-partwise><work><work-title>From the file</work-title></work><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`
const UNTITLED_XML = XML.replace('<work><work-title>From the file</work-title></work>', '')

/** Format-0 file, 480 ticks per quarter, one C4 quarter note. */
const MIDI = new Uint8Array([
    ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0],
    ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12],
    ...[0, 0x90, 60, 80, 0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0],
])

function fileOf(content: Uint8Array<ArrayBuffer> | string, name: string): File {
    return new File([content], name)
}

describe('ScoreFileImporter', () => {
    it('imports MusicXML text and keeps the title the file carries', async () => {
        const imported = await new ScoreFileImporter(fileOf(XML, 'air.musicxml')).import()
        expect(imported.title).toBe('From the file')
        expect(imported.score.measures).toHaveLength(1)
        expect(imported.score.measures[0].notes[0].pitch?.name).toBe('C')
    })

    it('falls back to the file name for the title, and to a generic one when the name is only an extension', async () => {
        expect((await new ScoreFileImporter(fileOf(UNTITLED_XML, 'My Tune.xml')).import()).title).toBe('My Tune')
        expect((await new ScoreFileImporter(fileOf(UNTITLED_XML, '.xml')).import()).title).toBe('Imported score')
    })

    it('recognizes MIDI by its header regardless of the extension', async () => {
        const imported = await new ScoreFileImporter(fileOf(MIDI, 'take.bin')).import()
        expect(imported.title).toBe('take')
        expect(imported.score.measures[0].notes[0].pitch?.name).toBe('C')
    })

    it('offers the accepted extensions and rejects anything that is not a score file', async () => {
        expect(ScoreFileImporter.ACCEPT).toContain('.mxl')
        await expect(new ScoreFileImporter(fileOf('hello world', 'notes.txt')).import()).rejects.toThrow('not a score file')
    })
})
