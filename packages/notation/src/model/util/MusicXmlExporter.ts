import type {
    MxmlAttributes,
    MxmlBarline,
    MxmlDirection,
    MxmlMeasure,
    MxmlMeasureEntry,
    MxmlNote,
    ScorePartwise,
} from '../../components/types'
import type { Score } from '../Score'
import { ScoreSerializer } from './ScoreSerializer'

/**
 * Renders the score as a standalone MusicXML 4.0 document (score-partwise).
 * Builds on ScoreSerializer's JSON form — the same shape the API stores — and
 * writes it out as XML, so anything that round-trips through save/load also
 * round-trips through export.
 */
export class MusicXmlExporter {
    constructor(readonly score: Score) {}

    toXml(title: string): string {
        const input = new ScoreSerializer(this.score).toInput()
        const lines: string[] = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
            '<score-partwise version="4.0">',
            '  <work>',
            `    <work-title>${MusicXmlExporter.escape(title)}</work-title>`,
            '  </work>',
            ...this.partListXml(input),
        ]
        for (const part of input.parts) {
            lines.push(`  <part id="${MusicXmlExporter.escape(part.id)}">`)
            for (const measure of part.measures) lines.push(...this.measureXml(measure))
            lines.push('  </part>')
        }
        lines.push('</score-partwise>')
        return lines.join('\n') + '\n'
    }

    private partListXml(input: ScorePartwise): string[] {
        const lines: string[] = ['  <part-list>']
        for (const part of input.partList.scoreParts) {
            lines.push(`    <score-part id="${MusicXmlExporter.escape(part.id)}">`)
            lines.push(`      <part-name>${MusicXmlExporter.escape(part.partName)}</part-name>`)
            /* v8 ignore next -- ScoreSerializer always provides scoreInstrument; the guard is for the optional MusicXML field */
            if (part.scoreInstrument) {
                lines.push(`      <score-instrument id="${MusicXmlExporter.escape(part.scoreInstrument.id)}">`)
                lines.push(`        <instrument-name>${MusicXmlExporter.escape(part.scoreInstrument.instrumentName)}</instrument-name>`)
                lines.push('      </score-instrument>')
            }
            /* v8 ignore next -- ScoreSerializer always provides midiInstrument; the guard is for the optional MusicXML field */
            if (part.midiInstrument) {
                lines.push(`      <midi-instrument id="${MusicXmlExporter.escape(part.midiInstrument.id)}">`)
                lines.push(`        <midi-program>${part.midiInstrument.midiProgram}</midi-program>`)
                lines.push('      </midi-instrument>')
            }
            lines.push('    </score-part>')
        }
        lines.push('  </part-list>')
        return lines
    }

    private measureXml(measure: MxmlMeasure): string[] {
        const lines: string[] = [`    <measure number="${MusicXmlExporter.escape(measure.number)}">`]
        for (const entry of measure.entries) lines.push(...this.entryXml(entry))
        lines.push('    </measure>')
        return lines
    }

    private entryXml(entry: MxmlMeasureEntry): string[] {
        switch (entry._type) {
            case 'note':
                return this.noteXml(entry)
            case 'attributes':
                return this.attributesXml(entry)
            case 'direction':
                return this.directionXml(entry)
            case 'barline':
                return this.barlineXml(entry)
            /* v8 ignore next 2 -- ScoreSerializer never emits backup entries; handled for type completeness */
            case 'backup':
                return ['      <backup>', `        <duration>${entry.duration}</duration>`, '      </backup>']
            /* v8 ignore next 2 -- ScoreSerializer never emits forward entries; handled for type completeness */
            case 'forward':
                return ['      <forward>', `        <duration>${entry.duration}</duration>`, '      </forward>']
        }
    }

    // Child order follows the MusicXML note schema: pitch/rest, duration, tie, voice, type, dot, time-modification, notations.
    private noteXml(note: MxmlNote): string[] {
        const lines: string[] = ['      <note>']
        if (note.pitch) {
            lines.push('        <pitch>')
            lines.push(`          <step>${note.pitch.step}</step>`)
            if (note.pitch.alter !== undefined) lines.push(`          <alter>${note.pitch.alter}</alter>`)
            lines.push(`          <octave>${note.pitch.octave}</octave>`)
            lines.push('        </pitch>')
        } else {
            lines.push('        <rest/>')
        }
        lines.push(`        <duration>${note.duration}</duration>`)
        for (const tie of note.tie ?? []) lines.push(`        <tie type="${tie.type}"/>`)
        /* v8 ignore next -- ScoreSerializer always sets voice='1'; the guard is for the optional MusicXML field */
        if (note.voice) lines.push(`        <voice>${MusicXmlExporter.escape(note.voice)}</voice>`)
        /* v8 ignore next -- ScoreSerializer always sets a note type; the guard is for the optional MusicXML field */
        if (note.type) lines.push(`        <type>${note.type}</type>`)
        for (let i = 0; i < (note.dot ?? 0); i++) lines.push('        <dot/>')
        if (note.timeModification) {
            lines.push('        <time-modification>')
            lines.push(`          <actual-notes>${note.timeModification.actualNotes}</actual-notes>`)
            lines.push(`          <normal-notes>${note.timeModification.normalNotes}</normal-notes>`)
            lines.push('        </time-modification>')
        }
        if (note.tie?.length) {
            lines.push('        <notations>')
            for (const tie of note.tie) lines.push(`          <tied type="${tie.type}"/>`)
            lines.push('        </notations>')
        }
        lines.push('      </note>')
        return lines
    }

    // Child order follows the MusicXML attributes schema: divisions, key, time, clef, transpose.
    private attributesXml(attributes: MxmlAttributes): string[] {
        const lines: string[] = ['      <attributes>']
        /* v8 ignore next -- ScoreSerializer always sets divisions; the guard is for the optional MusicXML field */
        if (attributes.divisions !== undefined) lines.push(`        <divisions>${attributes.divisions}</divisions>`)
        for (const key of attributes.key ?? []) {
            lines.push('        <key>')
            lines.push(`          <fifths>${key.fifths}</fifths>`)
            if (key.mode) lines.push(`          <mode>${MusicXmlExporter.escape(key.mode)}</mode>`)
            lines.push('        </key>')
        }
        for (const time of attributes.time ?? []) {
            lines.push('        <time>')
            lines.push(`          <beats>${MusicXmlExporter.escape(time.beats)}</beats>`)
            lines.push(`          <beat-type>${MusicXmlExporter.escape(time.beatType)}</beat-type>`)
            lines.push('        </time>')
        }
        for (const clef of attributes.clef ?? []) {
            lines.push('        <clef>')
            lines.push(`          <sign>${clef.sign}</sign>`)
            /* v8 ignore next -- ScoreSerializer always sets a clef line; the guard is for the optional MusicXML field */
            if (clef.line !== undefined) lines.push(`          <line>${clef.line}</line>`)
            if (clef.clefOctaveChange) lines.push(`          <clef-octave-change>${clef.clefOctaveChange}</clef-octave-change>`)
            lines.push('        </clef>')
        }
        if (attributes.transpose) {
            lines.push('        <transpose>')
            /* v8 ignore next -- ScoreSerializer always sets diatonic on a transpose; the guard is for the optional MusicXML field */
            if (attributes.transpose.diatonic !== undefined) lines.push(`          <diatonic>${attributes.transpose.diatonic}</diatonic>`)
            lines.push(`          <chromatic>${attributes.transpose.chromatic}</chromatic>`)
            /* v8 ignore next -- ScoreSerializer never sets a transpose octave-change; the field is part of the MusicXML schema */
            if (attributes.transpose.octaveChange) lines.push(`          <octave-change>${attributes.transpose.octaveChange}</octave-change>`)
            lines.push('        </transpose>')
        }
        lines.push('      </attributes>')
        return lines
    }

    // A direction requires a direction-type, so the tempo is written as the metronome
    // marking the editor draws, with the machine-readable <sound tempo> alongside.
    private directionXml(direction: MxmlDirection): string[] {
        const tempo = direction.sound?.tempo
        /* v8 ignore next -- ScoreSerializer only emits a direction when a tempo is present, so tempo is always defined */
        if (tempo === undefined) return []
        return [
            '      <direction placement="above">',
            '        <direction-type>',
            '          <metronome>',
            '            <beat-unit>quarter</beat-unit>',
            `            <per-minute>${tempo}</per-minute>`,
            '          </metronome>',
            '        </direction-type>',
            `        <sound tempo="${tempo}"/>`,
            '      </direction>',
        ]
    }

    private barlineXml(barline: MxmlBarline): string[] {
        /* v8 ignore next -- ScoreSerializer always sets location='right'; the empty fallback is for the optional MusicXML field */
        const lines: string[] = [`      <barline${barline.location ? ` location="${barline.location}"` : ''}>`]
        /* v8 ignore next -- ScoreSerializer always sets a bar-style; the guard is for the optional MusicXML field */
        if (barline.barStyle) lines.push(`        <bar-style>${barline.barStyle}</bar-style>`)
        lines.push('      </barline>')
        return lines
    }

    private static escape(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')
    }
}
