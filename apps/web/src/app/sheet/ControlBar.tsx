import { type Duration, getGlyphWidth, Glyph, GLYPH_SCALE } from '@/components/notation'

const ACCIDENTALS: { label: string; value: string | undefined }[] = [
  { label: '\u266e', value: undefined },  // ♮
  { label: '\u266d', value: 'b' },        // ♭
  { label: '\u266f', value: '#' },        // ♯
]

const DURATIONS: Duration[] = ['w', 'h', 'q', '8', '16']

/** Stem height used in the duration icon (shorter than full score stems) */
const ICON_STEM_HEIGHT = 22

function DurationIcon({ dur, color }: { dur: Duration; color: string }) {
  const noteGlyph = dur === 'w' ? 'noteheadWhole' : dur === 'h' ? 'noteheadHalf' : 'noteheadBlack'
  const flagName = dur === '8' ? 'flag8thUp' : dur === '16' ? 'flag16thUp' : undefined
  const hasStem = dur !== 'w'
  const nhWidth = getGlyphWidth(noteGlyph, GLYPH_SCALE)

  const noteX = 1
  const noteY = 26
  const stemX = noteX + nhWidth
  const stemY2 = noteY - ICON_STEM_HEIGHT

  return (
    <svg width={8} height={15} viewBox="0 0 16 30">
      {hasStem && (
        <line x1={stemX} y1={noteY} x2={stemX} y2={stemY2} stroke={color} strokeWidth={1.2} />
      )}
      {flagName && (
        <Glyph name={flagName} x={stemX} y={stemY2} fill={color} />
      )}
      <Glyph name={noteGlyph} x={noteX} y={noteY} fill={color} />
    </svg>
  )
}

interface ControlBarProps {
  accidental: string | undefined
  duration: Duration | undefined
  accidentalDisabled: boolean
  onAccidentalChange: (accidental: string | undefined) => void
  onDurationChange: (duration: Duration) => void
}

export function ControlBar({ accidental, duration, accidentalDisabled, onAccidentalChange, onDurationChange }: ControlBarProps) {
  return (
    <div className="flex items-center gap-6 px-4 py-2 border-b border-gray-200 bg-white">
      {/* Accidentals */}
      <div className="flex">
        {ACCIDENTALS.map(({ label, value }) => {
          const isActive = accidental === value;
          return (
            <button
              key={label}
              type="button"
              disabled={accidentalDisabled}
              onClick={() => onAccidentalChange(value)}
              className={`px-3 py-1.5 text-lg font-medium first:rounded-l last:rounded-r border border-gray-300 -ml-px first:ml-0 transition-colors ${
                isActive
                  ? 'bg-blue-500 text-white border-blue-500 z-10'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              } ${accidentalDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Durations */}
      <div className="flex">
        {DURATIONS.map((dur) => {
          const isActive = duration === dur;
          return (
            <button
              key={dur}
              type="button"
              onClick={() => onDurationChange(dur)}
              className={`px-2 py-1 first:rounded-l last:rounded-r border border-gray-300 -ml-px first:ml-0 transition-colors cursor-pointer flex items-center justify-center ${
                isActive
                  ? 'bg-blue-500 border-blue-500 z-10'
                  : 'bg-white hover:bg-gray-100'
              }`}
            >
              <DurationIcon dur={dur} color={isActive ? '#fff' : '#374151'} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
