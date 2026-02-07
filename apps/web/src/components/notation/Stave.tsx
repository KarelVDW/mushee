import { Glyph } from './Glyph';
import { StaffLines } from './StaffLines';
import { TimeSignature } from './TimeSignature';
import { NoteGroup } from './NoteGroup';
import type { LayoutStave } from './types';

interface StaveProps {
  layout: LayoutStave;
}

export function Stave({ layout }: StaveProps) {
  return (
    <g>
      <StaffLines lines={layout.staffLines} />

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
    </g>
  );
}
