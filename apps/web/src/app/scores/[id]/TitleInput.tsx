'use client'

const TITLE_TYPE = 'font-display font-medium text-[17px] leading-none tracking-[-0.01em]'

// Sizes to its text via an invisible mirror span, so the instrument chip sits right next to
// the title instead of a full-width input pushing it across the header.
export function TitleInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="relative min-w-16 max-w-[40%] shrink-0">
            <span aria-hidden className={`${TITLE_TYPE} invisible block overflow-hidden whitespace-pre px-2 py-2`}>
                {value || ' '}
            </span>
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-label="Score title"
                className={[
                    TITLE_TYPE,
                    'absolute inset-0 w-full bg-transparent border-0 outline-0 text-on-surface px-2 py-2 rounded-sm',
                    'hover:bg-surface-container focus:bg-surface-container transition-colors duration-150 ease-sheemu',
                ].join(' ')}
            />
        </div>
    )
}
