import { BeamGroup } from './BeamGroup';
import { Glyph } from './Glyph';
import { NoteGroup } from './NoteGroup';
import { TimeSignature } from './TimeSignature';
import type { LayoutMeasure } from './types';

interface MeasureProps {
  layout: LayoutMeasure;
}

export function Measure({ layout }: MeasureProps) {
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
        <NoteGroup key={i} note={note} />
      ))}

      {layout.beams.map((segments, i) => (
        <BeamGroup key={i} segments={segments} />
      ))}
    </g>
  );
}
