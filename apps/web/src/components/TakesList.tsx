'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { IconButton, showToast, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import { recordingAudioUrl, type RecordingSummary } from '@/lib/api'
import { formatTakeDate } from '@/lib/dates'
import { useDeleteRecording } from '@/lib/queries'
import { formatRecordingTime } from '@/lib/recordingTime'

interface TakePlayer {
    /** Id of the take whose audio is playing, if any. */
    playing: string | null
    /** Plays `take`, or stops it when it is the one playing. */
    toggle(take: RecordingSummary): void
    stop(): void
}

/**
 * One Audio element for the whole list (the cookie rides same-site). Every async
 * callback first checks that its element is still the current one: a replaced
 * take's late `error`, or the AbortError its pending `play()` rejects with when
 * paused, must not clear the row now playing or raise a false toast. Unmounting
 * stops whatever was playing.
 */
function useTakePlayer(): TakePlayer {
    const [playing, setPlaying] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => () => audioRef.current?.pause(), [])

    const stop = () => {
        const audio = audioRef.current
        if (audio) {
            audio.onended = audio.onerror = null
            audio.pause()
        }
        audioRef.current = null
        setPlaying(null)
    }

    const toggle = (take: RecordingSummary) => {
        if (playing === take.id) return stop()
        stop()
        const audio = new Audio(recordingAudioUrl(take.id))
        const isCurrent = () => audioRef.current === audio
        audio.onended = () => {
            if (isCurrent()) setPlaying(null)
        }
        audio.onerror = () => {
            if (!isCurrent()) return
            setPlaying(null)
            showToast("This take's audio couldn't be loaded.")
        }
        audioRef.current = audio
        setPlaying(take.id)
        track('take_played', { seconds: take.seconds })
        void audio.play().catch((err: unknown) => {
            if (!isCurrent() || (err instanceof DOMException && err.name === 'AbortError')) return
            setPlaying(null)
            showToast("This take's audio couldn't be played.")
        })
    }

    return { playing, toggle, stop }
}

interface TakesListProps {
    takes: readonly RecordingSummary[]
    /**
     * Cross-score lists (Settings → Recordings): the title of each row's score, shown as a link
     * to it, or null once the score is gone — then the row says "Deleted score" in plain text.
     * Leave it out on a per-score list, where every row shares one score.
     */
    scoreTitleFor?: (take: RecordingSummary) => string | null
    /** Constrain the list's height and scroll inside (panels); pages let it grow. */
    scroll?: boolean
}

/**
 * Rows of takes with replay (useTakePlayer) and a two-step inline delete.
 * Shared by the editor's Takes panel and Settings → Recordings.
 */
export function TakesList({ takes, scoreTitleFor, scroll = true }: TakesListProps) {
    const remove = useDeleteRecording()
    const player = useTakePlayer()
    const [confirming, setConfirming] = useState<string | null>(null)
    const { playing } = player

    const confirmDelete = (take: RecordingSummary) => {
        if (remove.isPending) return
        if (playing === take.id) player.stop()
        remove.mutate(take.id, {
            onSuccess: () => {
                setConfirming(null)
                track('take_deleted')
                showToast('Take deleted.', 'info')
            },
        })
    }

    return (
        <ul
            role="list"
            aria-label="Takes"
            className={['list-none m-0 p-0 flex flex-col gap-1.5', scroll ? 'max-h-72 overflow-y-auto' : ''].join(' ')}>
            {takes.map((take) => {
                const scoreTitle = scoreTitleFor?.(take)
                return (
                    <li key={take.id} className="flex items-center gap-2 rounded-md bg-surface-container-low px-3 py-2">
                        <IconButton
                            icon={playing === take.id ? 'pause' : 'play'}
                            size={32}
                            onClick={() => player.toggle(take)}
                            disabled={!take.hasAudio}
                            ariaLabel={playing === take.id ? 'Pause take' : 'Play take'}
                            title={take.hasAudio ? undefined : 'No audio was kept for this take'}
                            hoverTone="neutral"
                            idleClassName="bg-surface-container-lowest"
                        />
                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="font-body font-medium text-[13px] leading-none text-on-surface truncate">
                                {formatTakeDate(take.startedAt)}
                            </span>
                            {/* The score name rides the length line, outside any clipping box, so the
                                link's focus ring shows whole; the name truncates inside the link. */}
                            <span className="flex items-baseline min-w-0 leading-none text-on-surface-variant">
                                <span className="font-mono font-normal text-[11px] shrink-0">{formatRecordingTime(take.seconds)}</span>
                                {scoreTitle !== undefined && (
                                    <>
                                        <span className="font-body text-[12px] whitespace-pre shrink-0"> · </span>
                                        {scoreTitle === null ? (
                                            <span className="font-body text-[12px] truncate">Deleted score</span>
                                        ) : (
                                            <Link
                                                href={`/scores/${take.scoreId}`}
                                                className={[
                                                    'flex min-w-0 font-body text-[12px] text-primary underline-offset-2 hover:underline rounded-sm focus-ring',
                                                    // A 40px hit area on touch without growing the row: the pseudo-element grows, the text doesn't.
                                                    'relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3.5 pointer-coarse:after:content-[""]',
                                                ].join(' ')}>
                                                <span className="truncate">{scoreTitle}</span>
                                            </Link>
                                        )}
                                    </>
                                )}
                            </span>
                        </div>
                        {confirming === take.id ? (
                            <span className="inline-flex items-center gap-1">
                                <TertiaryButton danger onClick={() => confirmDelete(take)}>
                                    {remove.isPending ? 'Deleting…' : 'Delete'}
                                </TertiaryButton>
                                <TertiaryButton onClick={() => setConfirming(null)}>Keep</TertiaryButton>
                            </span>
                        ) : (
                            <IconButton
                                icon="trash-2"
                                size={32}
                                onClick={() => setConfirming(take.id)}
                                ariaLabel="Delete take"
                                hoverTone="magenta"
                                idleClassName="bg-transparent text-on-surface-variant"
                            />
                        )}
                    </li>
                )
            })}
        </ul>
    )
}
