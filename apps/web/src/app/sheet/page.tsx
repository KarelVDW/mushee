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
            { keys: ['A/4'], duration: '8' },
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
            { keys: ['D/5'], duration: 'h' },
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

export default function Sheet() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Score input={scoreData} width={600} height={160} />
    </div>
  );
}
