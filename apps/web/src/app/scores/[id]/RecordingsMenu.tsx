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
 * The score's recordings: every one made into it, newest first and numbered by age, with
 * replay of the archived audio and deletion. Lives in the editor header next to Export;
 * opens downward as a glass panel like the export menu. Closing the panel unmounts the list,
 * which stops any playback. Deletion is the user-facing half of the privacy policy's
 * "recordings are yours, delete them any time".
 */
export function RecordingsMenu({ scoreId, compact = false }: RecordingsMenuProps) {
    return (
        <HeaderMenu
            icon="audio-lines"
            label="Recordings"
            compact={compact}
            ariaLabel="Recordings"
            title="Recordings of this score"
            className="gap-2 w-80 max-w-[calc(100vw-1.5rem)]">
            <RecordingsPanel scoreId={scoreId} />
        </HeaderMenu>
    )
}

/** The panel body. HeaderMenu mounts it only while open, so the recordings are fetched on first open, not with the editor. */
function RecordingsPanel({ scoreId }: { scoreId: string }) {
    const recordings = useRecordings(scoreId)

    return (
        <>
            {recordings.isPending && <div className="h-12 rounded-md bg-surface-container-low animate-pulse" />}
            {recordings.isError && <Alert onRetry={() => void recordings.refetch()}>Couldn&apos;t load your recordings.</Alert>}
            {recordings.data && recordings.data.length === 0 && (
                <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                    Nothing recorded yet. Each time you record, the audio is kept here so you can listen back.
                </p>
            )}
            {recordings.data && recordings.data.length > 0 && <TakesList takes={recordings.data} numbered noun="recording" />}
            <p className="m-0 font-body font-normal text-[11px] leading-normal text-on-surface-variant">
                Only you can hear these. Deleting this score deletes them too.
            </p>
        </>
    )
}
