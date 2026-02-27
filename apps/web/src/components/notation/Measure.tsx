import { BeamGroup } from './BeamGroup';
import { Glyph } from './Glyph';
import { NoteGroup } from './NoteGroup';
import { TimeSignature } from './TimeSignature';
import { TupletBracket } from './TupletBracket';
import type { LayoutMeasure } from './types';

const CURSOR_COLOR = '#1e90ff'

interface MeasureProps {
  layout: LayoutMeasure;
  selectedNoteIndex?: number;
}

export function Measure({ layout, selectedNoteIndex }: MeasureProps) {
  return (
    <g>
      {layout.clef && (
        <Glyph
          name={layout.clef.glyphName}
          x={layout.clef.x}
          y={layout.clef.y}
        />
      )}

      {layout.timeSignature && (
        <TimeSignature layout={layout.timeSignature} />
      )}

      {layout.notes.map((note, i) => (
        <NoteGroup key={i} note={note} color={note.noteEventIndex === selectedNoteIndex ? CURSOR_COLOR : undefined} />
      ))}

      {layout.beams.map((segments, i) => (
        <BeamGroup key={i} segments={segments} />
      ))}

      {layout.tuplets.map((tuplet, i) => (
        <TupletBracket key={i} layout={tuplet} />
      ))}
    </g>
  );
}
