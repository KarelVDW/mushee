'use client';

import { useMemo } from 'react';

import { BravuraFont } from '../../origin/fonts/bravura_glyphs';
import { GLYPH_SCALE } from './constants';
import { outlineToSvgPath } from './glyph-utils';

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
    const glyph = BravuraFont.glyphs[name as keyof typeof BravuraFont.glyphs];
    if (!glyph) return '';
    return outlineToSvgPath(glyph.o, scale);
  }, [name, scale]);

  if (!d) return null;

  return <path d={d} transform={`translate(${x},${y})`} fill={fill} />;
}
