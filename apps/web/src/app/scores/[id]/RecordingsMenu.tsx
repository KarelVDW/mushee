'use client'

import { TakesList } from '@/components/TakesList'
import { Alert, ChipToggle, Eyebrow, Icon } from '@/components/ui'
import { useRecordings } from '@/lib/queries'
import { useDismissablePopover } from '@/lib/useDismissablePopover'

interface RecordingsMenuProps {
    scoreId: string
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
}

/**
 * The score's takes: every recording made into it, newest first, with replay of
 * the archived audio and deletion. Lives in the editor header next to Export;
 * opens downward as a glass panel like the export menu. Closing the panel
 * unmounts the list, which stops any playback. Deletion is the user-facing
 * half of the privacy policy's "recordings are yours, delete them any time".
 */
export function RecordingsMenu({ scoreId, compact = false }: RecordingsMenuProps) {
    const { open, setOpen, anchorRef, popRef } = useDismissablePopover()
    const takes = useRecordings(scoreId, { enabled: open })

    return (
        <div ref={anchorRef} className="relative shrink-0">
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel="Takes">
                <span className="inline-flex items-center gap-1.5">
                    <Icon name="audio-lines" size={14} />
                    {!compact && 'Takes'}
                </span>
            </ChipToggle>
            {open && (
                <div
                    ref={popRef}
                    role="dialog"
                    aria-label="Takes"
                    className="glass-panel tonal-layer-glow absolute z-50 flex flex-col gap-2 p-4 rounded-lg right-0 top-[calc(100%+0.5rem)] w-80 max-w-[calc(100vw-1.5rem)]"
                    onMouseDown={(e) => e.stopPropagation()}>
                    <Eyebrow>Takes recorded into this score</Eyebrow>
                    {takes.isPending && <div className="h-12 rounded-md bg-surface-container-low animate-pulse" />}
                    {takes.isError && <Alert onRetry={() => void takes.refetch()}>Couldn&apos;t load your takes.</Alert>}
                    {takes.data && takes.data.length === 0 && (
                        <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            Nothing recorded yet. Press record and every take lands here, audio included.
                        </p>
                    )}
                    {takes.data && takes.data.length > 0 && <TakesList takes={takes.data} />}
                    <p className="m-0 font-body font-normal text-[11px] leading-normal text-on-surface-variant">
                        Takes are private to your account and deleted with it.
                    </p>
                </div>
            )}
        </div>
    )
}
