'use client';

import { useMemo } from 'react';

import { GLYPH_SCALE } from './constants';
import { outlineToSvgPath } from './glyph-utils';
import { GLYPHS } from './glyphs';

interface GlyphProps {
  name: string;
  x: number;
  y: number;
  scale?: number;
  fill?: string;
}

export function Glyph({
  name,
  x,
  y,
  scale = GLYPH_SCALE,
  fill = '#000',
}: GlyphProps) {
  const d = useMemo(() => {
    const glyph = GLYPHS[name];
    if (!glyph) return '';
    return outlineToSvgPath(glyph.o, scale);
  }, [name, scale]);

  if (!d) return null;

  return <path d={d} transform={`translate(${x},${y})`} fill={fill} />;
}
