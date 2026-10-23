'use client'

import { Skeleton } from '@mushee/ui'

import { TakesList } from '@/components/TakesList'
import { Alert, HeaderMenu } from '@/components/ui'
import { useRecordings } from '@/lib/queries'

interface RecordingsMenuProps {
    scoreId: string
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
    /** The phone header's form: the panel opens as the full-width header card (HeaderMenu `sheet`). */
    sheet?: boolean
}

/**
 * The score's recordings: every one made into it, newest first and numbered by age, with
 * replay of the archived audio and deletion. Lives in the editor header next to Export;
 * opens downward as a glass panel like the export menu. Closing the panel unmounts the list,
 * which stops any playback. Deletion is the user-facing half of the privacy policy's
 * "recordings are yours, delete them any time".
 */
export function RecordingsMenu({ scoreId, compact = false, sheet = false }: RecordingsMenuProps) {
    return (
        <HeaderMenu
            icon="audio-lines"
            label="Recordings"
            compact={compact}
            sheet={sheet}
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
            {/* A recording row's shape while the list loads, on the slow pulse: the real row's padding,
                its 36px play well (40px on touch) and a bar on each of its two lines, each line at the
                row's own line height — so the panel doesn't move when the list arrives. */}
            {recordings.isPending && (
                <div aria-hidden className="rounded-md bg-surface-container-low flex items-center gap-3 px-3 py-2.5">
                    <Skeleton className="size-9 pointer-coarse:size-10 shrink-0 rounded-full" />
                    <span className="flex flex-col gap-1">
                        <span className="flex h-[calc(14px*1.3)] items-center">
                            <Skeleton className="h-3 w-24 rounded-sm" />
                        </span>
                        <span className="flex h-[calc(12px*1.35)] items-center">
                            <Skeleton className="h-2.5 w-36 rounded-sm" />
                        </span>
                    </span>
                </div>
            )}
            {recordings.isError && <Alert onRetry={() => void recordings.refetch()}>Couldn&apos;t load your recordings.</Alert>}
            {recordings.data && recordings.data.length === 0 && (
                <p className="m-0 font-body font-normal text-[13px] max-sm:text-[15px] leading-normal text-on-surface-variant text-pretty">
                    Nothing recorded yet. Each time you record, the audio is kept here so you can listen back.
                </p>
            )}
            {recordings.data && recordings.data.length > 0 && <TakesList takes={recordings.data} numbered />}
            <p className="m-0 font-body font-normal text-[11px] leading-normal text-on-surface-variant text-pretty">
                Only you can hear these. Deleting this score deletes them too.
            </p>
        </>
    )
}
