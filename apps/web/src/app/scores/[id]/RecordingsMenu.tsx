'use client'

import { TakesList } from '@/components/TakesList'
import { Alert, HeaderMenu } from '@/components/ui'
import { useRecordings } from '@/lib/queries'

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
    return (
        <HeaderMenu
            icon="audio-lines"
            label="Takes"
            compact={compact}
            ariaLabel="Takes"
            title="Takes recorded into this score"
            className="gap-2 w-80 max-w-[calc(100vw-1.5rem)]">
            <TakesPanel scoreId={scoreId} />
        </HeaderMenu>
    )
}

/** The panel body. HeaderMenu mounts it only while open, so the takes are fetched on first open, not with the editor. */
function TakesPanel({ scoreId }: { scoreId: string }) {
    const takes = useRecordings(scoreId)

    return (
        <>
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
        </>
    )
}
