import { type DurationType, getGlyphWidth, Glyph, GLYPH_SCALE } from '@/components/notation';

// --- Data ---

const ACCIDENTALS: { label: string; value: string | undefined }[] = [
  { label: '\u266e', value: undefined },  // ♮
  { label: '\u266d', value: 'b' },        // ♭
  { label: '\u266f', value: '#' },        // ♯
]

const DURATIONS: DurationType[] = ['w', 'h', 'q', '8', '16']

// --- Shared button styles ---

const BTN = 'flex items-center justify-center border transition-colors cursor-pointer'
const GROUP_BTN = `${BTN} border-gray-300 -ml-px first:ml-0 first:rounded-l last:rounded-r`
const TOGGLE_BTN = `${BTN} rounded border-gray-300`

function groupBtnClass(active: boolean, disabled?: boolean) {
  return `${GROUP_BTN} ${active ? 'bg-blue-500 text-white border-blue-500 z-10' : 'bg-white text-gray-700 hover:bg-gray-100'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`
}

function toggleBtnClass(active: boolean) {
  return `${TOGGLE_BTN} ${active ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-700 hover:bg-gray-100'}`
}

// --- Duration icon ---

const ICON_STEM_HEIGHT = 22

function DurationIcon({ dur, color }: { dur: DurationType; color: string }) {
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

// --- Separator ---

function Sep() {
  return <div className="w-px h-6 bg-gray-200" />
}

// --- ControlBar ---

interface ControlBarProps {
  accidental: string | undefined
  duration: DurationType | undefined
  accidentalDisabled: boolean
  onAccidentalChange: (accidental: string | undefined) => void
  onDurationChange: (duration: DurationType) => void
  dotted: boolean
  onDotToggle: () => void
  tie: boolean
  onTieToggle: () => void
  rest: boolean
  onRestToggle: () => void
  tempo: unknown
  onTempoToggle: () => void
  isPlaying: boolean
  onPlayToggle: () => void
  onBack?: () => void
}

export function ControlBar({
  accidental, duration, accidentalDisabled, onAccidentalChange, onDurationChange,
  dotted, onDotToggle, tie, onTieToggle, rest, onRestToggle, tempo, onTempoToggle,
  isPlaying, onPlayToggle, onBack,
}: ControlBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white">
      {onBack && (
        <>
          <button type="button" onClick={onBack} className={`${TOGGLE_BTN} border-gray-300 bg-white text-gray-700 hover:bg-gray-100 px-2.5 py-1 text-sm font-medium`}>
            &larr; Back
          </button>
          <Sep />
        </>
      )}
      {/* Note type: durations + dot + rest */}
      <div className="flex">
        {DURATIONS.map((dur) => {
          const isActive = duration === dur;
          return (
            <button key={dur} type="button" onClick={() => onDurationChange(dur)} className={`${groupBtnClass(isActive)} px-2 py-1`}>
              <DurationIcon dur={dur} color={isActive ? '#fff' : '#374151'} />
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onDotToggle} className={`${toggleBtnClass(dotted)} px-2.5 py-1 text-base font-bold`}>
        .
      </button>
      <button type="button" onClick={onRestToggle} className={`${toggleBtnClass(rest)} px-2 py-1`}>
        <svg width={8} height={15} viewBox="0 0 16 30">
          <Glyph name="restQuarter" x={1} y={20} fill={rest ? '#fff' : '#374151'} />
        </svg>
      </button>

      <Sep />

      {/* Pitch: accidentals */}
      <div className="flex">
        {ACCIDENTALS.map(({ label, value }) => {
          const isActive = accidental === value;
          return (
            <button
              key={label}
              type="button"
              disabled={accidentalDisabled}
              onClick={() => onAccidentalChange(value)}
              className={`${groupBtnClass(isActive, accidentalDisabled)} px-3 py-1.5 text-lg font-medium`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <Sep />

      {/* Modifiers: tie + tempo */}
      <button type="button" onClick={onTieToggle} className={`${toggleBtnClass(tie)} px-2.5 py-1 text-sm font-medium`}>
        Tie
      </button>
      <button type="button" onClick={onTempoToggle} className={`${toggleBtnClass(tempo !== undefined)} px-2.5 py-1 text-sm font-medium`}>
        Tempo
      </button>

      <Sep />

      {/* Playback */}
      <button type="button" onClick={onPlayToggle} className={`${toggleBtnClass(isPlaying)} px-2.5 py-1`}>
        {isPlaying ? (
          <svg width={12} height={14} viewBox="0 0 12 14">
            <rect x={1} y={1} width={3.5} height={12} rx={0.5} fill={isPlaying ? '#fff' : '#374151'} />
            <rect x={7.5} y={1} width={3.5} height={12} rx={0.5} fill={isPlaying ? '#fff' : '#374151'} />
          </svg>
        ) : (
          <svg width={12} height={14} viewBox="0 0 12 14">
            <path d="M1 1.5v11l10-5.5z" fill="#374151" />
          </svg>
        )}
      </button>
    </div>
  );
}
