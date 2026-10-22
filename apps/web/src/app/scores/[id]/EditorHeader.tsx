'use client'

import { useRouter } from 'next/navigation'

import type { PitchScope } from '@/components/editor/pitchScope'
import { ExportMenu } from '@/components/ExportMenu'
import { ChipToggle, Icon, Wordmark } from '@/components/ui'

import { HistoryTools } from './HistoryTools'
import { PitchTools } from './PitchTools'
import { RecordingsMenu } from './RecordingsMenu'
import type { ScoreManipulator } from './ScoreManipulator'
import { ShareMenu } from './ShareMenu'
import { TransportControls, type TransportControlsProps } from './TransportControls'

interface EditorHeaderProps {
    scoreId: string
    shareToken: string | null
    manipulator: ScoreManipulator
    title: string
    onTitleChange: (title: string) => void
    onChangeInstrument: () => void
    /**
     * Phone chrome: the transport and the pitch / history tools move into the dock, the
     * keyboard-shortcuts entry point goes, and the score-level chips turn icon-only.
     */
    compact: boolean
    transport: TransportControlsProps
    /** The transpose popover's state, kept by the page (the transpose shortcut opens it too). */
    transposeOpen: boolean
    onTransposeOpenChange: (open: boolean) => void
    onTransposeAim: (scope: PitchScope | null) => void
    shortcutsOpen: boolean
    onOpenShortcuts: () => void
    /** The rendered score SVG, resolved at export time (the PDF's visual snapshot). */
    getSvg: () => SVGSVGElement | null
}

/**
 * The editor's slim header: back to the library, the title and instrument chip; the
 * transport centred; then the document-level chrome — pitch and history tools, keyboard
 * shortcuts, and the Share / Takes / Export chips.
 */
export function EditorHeader({
    scoreId,
    shareToken,
    manipulator,
    title,
    onTitleChange,
    onChangeInstrument,
    compact,
    transport,
    transposeOpen,
    onTransposeOpenChange,
    onTransposeAim,
    shortcutsOpen,
    onOpenShortcuts,
    getSvg,
}: EditorHeaderProps) {
    const router = useRouter()
    const score = manipulator.score
    if (!score) return null

    return (
        <header className="flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-2 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow z-10">
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
                <button
                    onClick={() => router.push('/scores')}
                    aria-label="Back to library"
                    className={[
                        'bg-transparent border-0 cursor-pointer text-on-surface-variant p-1.5 -ml-1.5 inline-flex rounded-full',
                        'hover:text-on-surface transition-colors duration-150 ease-solkey',
                        'focus-ring',
                    ].join(' ')}>
                    <Icon name="arrow-left" size={20} />
                </button>
                <Wordmark size={19} className="max-[52rem]:hidden" />
                <div className="w-px h-5 bg-outline-variant/15 max-[52rem]:hidden" />
                <TitleInput value={title} onChange={onTitleChange} />
                <button
                    type="button"
                    onClick={onChangeInstrument}
                    aria-label={`Change instrument (current: ${score.instrument.displayName})`}
                    className={[
                        'shrink-0 inline-flex items-center gap-1 border-0 rounded-full px-2.5 py-1.5 cursor-pointer',
                        'font-label font-semibold text-[11px] leading-none whitespace-nowrap',
                        'max-md:max-w-28 min-w-0',
                        'bg-secondary-soft/70 text-on-secondary-soft hover:bg-secondary-soft',
                        'transition-colors duration-150 ease-solkey',
                        'focus-ring',
                    ].join(' ')}>
                    <span className="truncate">{score.instrument.displayName}</span>
                    <Icon name="sliders-horizontal" size={11} />
                </button>
            </div>
            {!compact && <TransportControls {...transport} />}
            <div className="flex items-center gap-2 shrink-0 sm:flex-1 justify-end">
                {/* Pitch and history tools are document-level chrome (see PitchTools /
                    HistoryTools); on phones they move into the dock instead. */}
                {!compact && (
                    <PitchTools
                        manipulator={manipulator}
                        transposeOpen={transposeOpen}
                        onTransposeOpenChange={onTransposeOpenChange}
                        onTransposeAim={onTransposeAim}
                    />
                )}
                {!compact && <HistoryTools manipulator={manipulator} />}
                {!compact && (
                    <ChipToggle active={shortcutsOpen} onClick={onOpenShortcuts} ariaLabel="Keyboard shortcuts">
                        <Icon name="keyboard" size={16} />
                    </ChipToggle>
                )}
                <ShareMenu scoreId={scoreId} shareToken={shareToken} compact={compact} />
                <RecordingsMenu scoreId={scoreId} compact={compact} />
                <ExportMenu score={score} title={title} compact={compact} getSvg={getSvg} />
            </div>
        </header>
    )
}

const TITLE_TYPE = 'font-display font-medium text-[17px] leading-none tracking-[-0.01em]'

// Sizes to its text via an invisible mirror span, so the instrument chip sits right next to
// the title instead of a full-width input pushing it across the header.
function TitleInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
                    'hover:bg-surface-container focus:bg-surface-container transition-colors duration-150 ease-solkey',
                ].join(' ')}
            />
        </div>
    )
}
