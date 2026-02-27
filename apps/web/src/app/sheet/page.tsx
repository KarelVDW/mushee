'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { lineToKey, parseKey, pitchToLine, Score, type ScoreInput, setKeyAccidental } from '@/components/notation';

import { ControlBar } from './ControlBar';

const initialScoreData: ScoreInput = {
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

/**
 * Map a noteEventIndex back to (measureIdx, voiceIdx, noteIdx) in the ScoreInput.
 */
function findNotePosition(input: ScoreInput, targetIndex: number): { mi: number; vi: number; ni: number } | null {
  let idx = 0;
  for (let mi = 0; mi < input.measures.length; mi++) {
    for (let vi = 0; vi < input.measures[mi].voices.length; vi++) {
      for (let ni = 0; ni < input.measures[mi].voices[vi].notes.length; ni++) {
        if (idx === targetIndex) return { mi, vi, ni };
        idx++;
      }
    }
  }
  return null;
}

export default function Sheet() {
  const [scoreData, setScoreData] = useState<ScoreInput>(initialScoreData);
  const [cursorIndex, setCursorIndex] = useState(0);
  const totalNotes = useMemo(() => countNoteEvents(scoreData), [scoreData]);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedNoteInfo = useMemo(() => {
    const pos = findNotePosition(scoreData, cursorIndex);
    if (!pos) return { isRest: true, accidental: undefined };
    const key = scoreData.measures[pos.mi].voices[pos.vi].notes[pos.ni].keys[0];
    const parsed = parseKey(key);
    return { isRest: parsed.isRest, accidental: parsed.accidental };
  }, [scoreData, cursorIndex]);

  const handleNoteChange = useCallback(
    (noteEventIndex: number, newKey: string) => {
      const pos = findNotePosition(scoreData, noteEventIndex);
      if (!pos) return;
      setScoreData((prev) => {
        const next = structuredClone(prev);
        next.measures[pos.mi].voices[pos.vi].notes[pos.ni].keys = [newKey];
        return next;
      });
    },
    [scoreData],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCursorIndex((i) => Math.min(i + 1, totalNotes - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCursorIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const pos = findNotePosition(scoreData, cursorIndex);
        if (!pos) return;
        const note = scoreData.measures[pos.mi].voices[pos.vi].notes[pos.ni];
        const { isRest } = parseKey(note.keys[0]);
        if (isRest) return;
        const step = e.key === 'ArrowUp' ? 0.5 : -0.5;
        const currentLine = pitchToLine(note.keys[0]);
        const newKey = lineToKey(currentLine + step);
        handleNoteChange(cursorIndex, newKey);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        const pos = findNotePosition(scoreData, cursorIndex);
        if (!pos) return;
        const note = scoreData.measures[pos.mi].voices[pos.vi].notes[pos.ni];
        const { isRest } = parseKey(note.keys[0]);
        if (isRest) return;
        handleNoteChange(cursorIndex, 'C/5/r');
      }
    },
    [totalNotes, scoreData, cursorIndex, handleNoteChange],
  );

  const handleAccidentalChange = useCallback(
    (acc: string | undefined) => {
      const pos = findNotePosition(scoreData, cursorIndex);
      if (!pos) return;
      const key = scoreData.measures[pos.mi].voices[pos.vi].notes[pos.ni].keys[0];
      handleNoteChange(cursorIndex, setKeyAccidental(key, acc));
    },
    [scoreData, cursorIndex, handleNoteChange],
  );

  const handleAddMeasure = useCallback(() => {
    setScoreData((prev) => {
      const next = structuredClone(prev);
      const lastIdx = next.measures.length - 1;
      const lastBarline = next.measures[lastIdx].endBarline;
      // Remove end barline from current last measure
      delete next.measures[lastIdx].endBarline;
      // Add new measure with a whole rest
      next.measures.push({
        voices: [{ notes: [{ keys: ['C/5/r'], duration: 'w' }] }],
        endBarline: lastBarline,
      });
      return next;
    });
  }, []);

  const handleRemoveMeasure = useCallback(() => {
    setScoreData((prev) => {
      if (prev.measures.length <= 1) return prev;
      const next = structuredClone(prev);
      const removed = next.measures.pop();
      // Transfer end barline to new last measure
      const newLastIdx = next.measures.length - 1;
      if (removed) next.measures[newLastIdx].endBarline = removed.endBarline;
      return next;
    });
    // Clamp cursor if it's now out of bounds
    setCursorIndex((i) => Math.min(i, countNoteEvents(scoreData) - 2));
  }, [scoreData]);

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
      className="flex flex-col min-h-screen outline-none"
    >
      <ControlBar
        accidental={selectedNoteInfo.accidental}
        disabled={selectedNoteInfo.isRest}
        onAccidentalChange={handleAccidentalChange}
      />
      <div className="flex flex-1 items-center justify-center gap-3">
        <Score input={scoreData} width={600} height={160} selectedNoteIndex={cursorIndex} onNoteChange={handleNoteChange} />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleAddMeasure}
            className="w-8 h-8 rounded border border-gray-300 bg-white text-gray-700 text-lg font-medium hover:bg-gray-100 cursor-pointer"
          >
            +
          </button>
          <button
            type="button"
            onClick={handleRemoveMeasure}
            disabled={scoreData.measures.length <= 1}
            className={`w-8 h-8 rounded border border-gray-300 bg-white text-gray-700 text-lg font-medium ${
              scoreData.measures.length <= 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100 cursor-pointer'
            }`}
          >
            -
          </button>
        </div>
      </div>
    </div>
  );
}
