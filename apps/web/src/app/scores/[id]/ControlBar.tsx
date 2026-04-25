import { type DurationType, getGlyphWidth, Glyph, GLYPH_SCALE } from '@/components/notation';

// --- Data ---

const ACCIDENTALS: { label: string; value: string | undefined }[] = [
  { label: '♮', value: undefined },  // ♮
  { label: '♭', value: 'b' },        // ♭
  { label: '♯', value: '#' },        // ♯
]

const DURATIONS: DurationType[] = ['w', 'h', 'q', '8', '16']

// --- Shared button styles ---

const BTN = 'flex items-center justify-center transition-colors cursor-pointer'
const GROUP_BTN = `${BTN} -ml-px first:ml-0 first:rounded-l last:rounded-r`
const TOGGLE_BTN = `${BTN} rounded`

function groupBtnClass(active: boolean, disabled?: boolean) {
  return `${GROUP_BTN} ${active ? 'bg-primary-container text-on-primary-container z-10' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`
}

function toggleBtnClass(active: boolean) {
  return `${TOGGLE_BTN} ${active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}`
}

// --- Duration icon ---

const ICON_STEM_HEIGHT = 22

function DurationIcon({ dur }: { dur: DurationType }) {
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
        <line x1={stemX} y1={noteY} x2={stemX} y2={stemY2} stroke="currentColor" strokeWidth={1.2} />
      )}
      {flagName && (
        <Glyph name={flagName} x={stemX} y={stemY2} fill="currentColor" />
      )}
      <Glyph name={noteGlyph} x={noteX} y={noteY} fill="currentColor" />
    </svg>
  )
}

// --- Separator ---

function Sep() {
  return <div className="w-px h-6 bg-outline-variant/30" />
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
  playbackState: 'stopped' | 'playing' | 'paused'
  onPlayToggle: () => void
  onStop: () => void
  recordingState: 'idle' | 'countoff' | 'recording'
  onRecordToggle: () => void
  metronome: boolean
  onMetronomeToggle: () => void
}

export function ControlBar({
  accidental, duration, accidentalDisabled, onAccidentalChange, onDurationChange,
  dotted, onDotToggle, tie, onTieToggle, rest, onRestToggle, tempo, onTempoToggle,
  playbackState, onPlayToggle, onStop, recordingState, onRecordToggle, metronome, onMetronomeToggle,
}: ControlBarProps) {
  const isRecording = recordingState !== 'idle'
  const isPlaying = playbackState === 'playing'
  const canStop = playbackState !== 'stopped' || isRecording
  const playDisabled = isRecording
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-surface-container-lowest tonal-layer-glow">
      {/* Note type: durations + dot + rest */}
      <div className="flex">
        {DURATIONS.map((dur) => {
          const isActive = duration === dur;
          return (
            <button key={dur} type="button" onClick={() => onDurationChange(dur)} className={`${groupBtnClass(isActive)} px-2 py-1`}>
              <DurationIcon dur={dur} />
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onDotToggle} className={`${toggleBtnClass(dotted)} px-2.5 py-1 text-base font-bold`}>
        .
      </button>
      <button type="button" onClick={onRestToggle} className={`${toggleBtnClass(rest)} px-2 py-1`}>
        <svg width={8} height={15} viewBox="0 0 16 30">
          <Glyph name="restQuarter" x={1} y={20} fill="currentColor" />
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
      <button
        type="button"
        onClick={onTieToggle}
        className={`${toggleBtnClass(tie)} px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-widest`}>
        Tie
      </button>
      <button
        type="button"
        onClick={onTempoToggle}
        className={`${toggleBtnClass(tempo !== undefined)} px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-widest`}>
        Tempo
      </button>

      <Sep />

      {/* Playback */}
      <button
        type="button"
        onClick={onPlayToggle}
        disabled={playDisabled}
        className={`${toggleBtnClass(isPlaying)} px-2.5 py-1 ${playDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        {isPlaying ? (
          <svg width={12} height={14} viewBox="0 0 12 14">
            <rect x={1} y={1} width={3.5} height={12} rx={0.5} fill="currentColor" />
            <rect x={7.5} y={1} width={3.5} height={12} rx={0.5} fill="currentColor" />
          </svg>
        ) : (
          <svg width={12} height={14} viewBox="0 0 12 14">
            <path d="M1 1.5v11l10-5.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={!canStop}
        className={`${TOGGLE_BTN} bg-surface-container-low text-on-surface px-2.5 py-1 ${canStop ? 'hover:bg-surface-container' : 'opacity-40 cursor-not-allowed'}`}
      >
        <svg width={12} height={14} viewBox="0 0 12 14">
          <rect x={1} y={2} width={10} height={10} rx={0.5} fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onRecordToggle}
        className={`${TOGGLE_BTN} px-2.5 py-1 ${isRecording ? 'bg-error text-on-error' : 'bg-surface-container-low text-error hover:bg-surface-container'}`}
        title={isRecording ? 'Stop recording' : 'Record'}
      >
        <svg width={12} height={14} viewBox="0 0 12 14">
          <circle cx={6} cy={7} r={5} fill="currentColor" />
        </svg>
      </button>
      <button type="button" onClick={onMetronomeToggle} className={`${toggleBtnClass(metronome)} px-2.5 py-1`}>
        <svg width={12} height={14} viewBox="0 0 12 16">
          <path d="M3 15L6 1l3 14" stroke="currentColor" strokeWidth={1.5} fill="none" />
          <line x1={3} y1={6} x2={9} y2={6} stroke="currentColor" strokeWidth={1.2} />
        </svg>
      </button>
    </div>
  );
}
