import { Score, type ScoreInput } from '@/components/notation';

const scoreData: ScoreInput = {
  staves: [
    {
      clef: 'treble',
      timeSignature: '4/4',
      voices: [
        {
          notes: [
            { keys: ['C#/5'], duration: 'q' },
            { keys: ['B/4'], duration: 'q' },
            { keys: ['A/4'], duration: 'q' },
            { keys: ['G#/4'], duration: 'q' },
            { keys: ['G#/4'], duration: 'w' },
            { keys: ['G#/4'], duration: 'q' },
            { keys: ['G#/4'], duration: 'q' },
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
