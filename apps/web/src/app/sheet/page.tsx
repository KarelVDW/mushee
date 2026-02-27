'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Score, type ScoreInput } from '@/components/notation';

const scoreData: ScoreInput = {
  measures: [
    {
      clef: 'treble',
      timeSignature: '4/4',
      voices: [
        {
          notes: [
            { keys: ['C#/5'], duration: '8' },
            { keys: ['B/4'], duration: '8' },
            { keys: ['E/4'], duration: '8' },
            { keys: ['C/5/r'], duration: '16' },
            { keys: ['G#/4'], duration: 'q' },
            { keys: ['G#/4'], duration: 'q' },
            { keys: ['G#/4'], duration: '8' },
            { keys: ['G#/4'], duration: '8' },
          ],
          tuplets: [{ startIndex: 0, count: 3, notesOccupied: 2 }],
        },
      ],
    },
    {
      voices: [
        {
          notes: [
            { keys: ['D/5'], duration: 'q', dots: 1 },
            { keys: ['C/5'], duration: '8' },
            { keys: ['E/5'], duration: 'q' },
            { keys: ['B/4'], duration: '8' },
            { keys: ['F/5'], duration: '16' },
            { keys: ['F/5'], duration: '16' },
          ],
        },
      ],
      endBarline: 'end',
    },
  ],
};

function countNoteEvents(input: ScoreInput): number {
  return input.measures.reduce(
    (sum, m) => sum + m.voices.reduce((vSum, v) => vSum + v.notes.length, 0),
    0,
  );
}

export default function Sheet() {
  const [cursorIndex, setCursorIndex] = useState(0);
  const totalNotes = useMemo(() => countNoteEvents(scoreData), []);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCursorIndex((i) => Math.min(i + 1, totalNotes - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCursorIndex((i) => Math.max(i - 1, 0));
      }
    },
    [totalNotes],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown);
    el.focus();
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="flex items-center justify-center min-h-screen outline-none"
    >
      <Score input={scoreData} width={600} height={160} selectedNoteIndex={cursorIndex} />
    </div>
  );
}
