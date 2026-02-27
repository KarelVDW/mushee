const ACCIDENTALS: { label: string; value: string | undefined }[] = [
  { label: '\u266e', value: undefined },  // ♮
  { label: '\u266d', value: 'b' },        // ♭
  { label: '\u266f', value: '#' },        // ♯
]

interface ControlBarProps {
  accidental: string | undefined
  disabled: boolean
  onAccidentalChange: (accidental: string | undefined) => void
}

export function ControlBar({ accidental, disabled, onAccidentalChange }: ControlBarProps) {
  return (
    <div className="flex items-center gap-6 px-4 py-2 border-b border-gray-200">
      {/* Accidentals */}
      <div className="flex">
        {ACCIDENTALS.map(({ label, value }) => {
          const isActive = accidental === value;
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onAccidentalChange(value)}
              className={`px-3 py-1.5 text-lg font-medium first:rounded-l last:rounded-r border border-gray-300 -ml-px first:ml-0 transition-colors ${
                isActive
                  ? 'bg-blue-500 text-white border-blue-500 z-10'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
