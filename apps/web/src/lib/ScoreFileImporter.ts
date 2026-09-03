import type { ImportedScore } from '@mushee/notation/model/util/ImportedScore'
import { MidiImporter } from '@mushee/notation/model/util/MidiImporter'
import { MusicXmlImporter } from '@mushee/notation/model/util/MusicXmlImporter'

import { MxlArchive } from './MxlArchive'

/** An imported file always yields a title: the one the file carried, else its name. */
export interface ImportedScoreFile extends ImportedScore {
    title: string
}

/**
 * Turns a file the user picked into a Score, sniffing the format from its bytes
 * rather than its extension: a MIDI header, a zip (compressed MusicXML), or XML.
 */
export class ScoreFileImporter {
    /** The `accept` list for the file picker. */
    static readonly ACCEPT = '.musicxml,.xml,.mxl,.mid,.midi'

    constructor(readonly file: File) {}

    async import(): Promise<ImportedScoreFile> {
        const bytes = new Uint8Array(await this.file.arrayBuffer())
        const imported = await this.parse(bytes)
        return { ...imported, title: imported.title ?? this.basename }
    }

    private async parse(bytes: Uint8Array<ArrayBuffer>): Promise<ImportedScore> {
        if (ScoreFileImporter.isMidi(bytes)) return new MidiImporter(bytes).toScore()
        if (MxlArchive.isZip(bytes)) return new MusicXmlImporter(await new MxlArchive(bytes).rootFile()).toScore()
        const text = new TextDecoder().decode(bytes)
        if (text.trimStart().startsWith('<')) return new MusicXmlImporter(text).toScore()
        throw new Error('This is not a score file. Choose a MusicXML (.musicxml, .xml, .mxl) or MIDI (.mid) file.')
    }

    private static isMidi(bytes: Uint8Array): boolean {
        return bytes.length > 4 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64 // "MThd"
    }

    /** The file name without its extension. */
    private get basename(): string {
        return this.file.name.replace(/\.[^.]+$/, '').trim() || 'Imported score'
    }
}
