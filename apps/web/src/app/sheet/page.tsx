import { Score, type ScoreInput } from '@/components/notation';

const scoreData: ScoreInput = {
  staves: [
    {
      clef: 'treble',
      timeSignature: '4/4',
      voices: [
        {
          notes: [
            { keys: ['C#/5'], duration: 'w' },
            { keys: ['B/4'], duration: 'h' },
            { keys: ['A/4'], duration: 'q' },
            { keys: ['G#/4'], duration: 'q' },
            { keys: ['G#/4'], duration: '8' },
            { keys: ['G#/4'], duration: '16' },
            { keys: ['G#/4'], duration: '16' },
          ],
        },
      ],
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
