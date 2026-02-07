import { Glyph } from './Glyph';
import type { LayoutTimeSignature } from './types';

interface TimeSignatureProps {
  layout: LayoutTimeSignature;
}

export function TimeSignature({ layout }: TimeSignatureProps) {
  return (
    <g>
      {layout.top.map((g, i) => (
        <Glyph key={`top-${i}`} name={g.glyphName} x={g.x} y={g.y} />
      ))}
      {layout.bottom.map((g, i) => (
        <Glyph key={`bot-${i}`} name={g.glyphName} x={g.x} y={g.y} />
      ))}
    </g>
  );
}
