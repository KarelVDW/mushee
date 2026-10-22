'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { focusWithoutTooltip, IconButton, showToast, TertiaryButton } from '@/components/ui'
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
            showToast("This recording's audio couldn't be loaded.")
        }
        audioRef.current = audio
        setPlaying(take.id)
        track('take_played', { seconds: take.seconds })
        void audio.play().catch((err: unknown) => {
            if (!isCurrent() || (err instanceof DOMException && err.name === 'AbortError')) return
            setPlaying(null)
            showToast("This recording's audio couldn't be played.")
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
    /**
     * A per-score list (the editor's Recordings panel): rows are named "Recording 3", numbered
     * oldest-first by when they were made (the list itself stays newest-first), with the
     * length and the date on the line below — so two recordings from the same minute differ.
     */
    numbered?: boolean
}

/** Each recording's number in a per-score list: 1 for the oldest, by when it started. */
function numbering(takes: readonly RecordingSummary[]): Map<string, number> {
    const byAge = [...takes].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    return new Map(byAge.map((take, index) => [take.id, index + 1]))
}

/**
 * Rows of recordings with replay (useTakePlayer) and a two-step inline delete whose question
 * says the notes stay. Shared by the editor's Recordings panel and Settings → Recordings. Every
 * name says 'recording', the glossary's word ('Recordings', 'Play recording', 'Delete
 * recording') — never 'take', which stays a code-side word.
 */
export function TakesList({ takes, scoreTitleFor, scroll = true, numbered = false }: TakesListProps) {
    const remove = useDeleteRecording()
    const player = useTakePlayer()
    const [confirming, setConfirming] = useState<string | null>(null)
    const { playing } = player
    const numbers = numbered ? numbering(takes) : null

    // Focus follows the confirm: onto Keep when it opens, back onto the bin when Keep closes it.
    const listRef = useRef<HTMLUListElement>(null)
    const returnFocusTo = useRef<string | null>(null)
    useEffect(() => {
        const list = listRef.current
        if (!list) return
        if (confirming) {
            list.querySelector<HTMLElement>(`[data-take="${confirming}"] [data-keep] button`)?.focus()
        } else if (returnFocusTo.current) {
            focusWithoutTooltip(list.querySelector<HTMLElement>(`[data-take="${returnFocusTo.current}"] [data-delete] button`))
            returnFocusTo.current = null
        }
    }, [confirming])

    const confirmDelete = (take: RecordingSummary) => {
        if (remove.isPending) return
        if (playing === take.id) player.stop()
        remove.mutate(take.id, {
            onSuccess: () => {
                setConfirming(null)
                track('take_deleted')
                showToast('Recording deleted.', 'info')
            },
        })
    }

    const keep = (take: RecordingSummary) => {
        returnFocusTo.current = take.id
        setConfirming(null)
    }

    return (
        <ul
            ref={listRef}
            role="list"
            aria-label="Recordings"
            className={['list-none m-0 p-0 flex flex-col gap-1.5', scroll ? 'max-h-72 overflow-y-auto' : ''].join(' ')}>
            {takes.map((take) => {
                const scoreTitle = scoreTitleFor?.(take)
                const number = numbers?.get(take.id)
                return (
                    <li key={take.id} data-take={take.id} className="flex items-center gap-2 rounded-md bg-surface-container-low px-3 py-2">
                        <IconButton
                            icon={playing === take.id ? 'pause' : 'play'}
                            size={32}
                            onClick={() => player.toggle(take)}
                            disabled={!take.hasAudio}
                            ariaLabel={playing === take.id ? 'Pause recording' : 'Play recording'}
                            title={take.hasAudio ? undefined : 'No audio was kept for this recording'}
                            hoverTone="neutral"
                            idleClassName="bg-surface-container-lowest"
                        />
                        {confirming === take.id ? (
                            // The question takes the row's text over; on a narrow panel its buttons
                            // wrap under it rather than squeezing it.
                            <div className="flex flex-1 min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                <span className="font-body font-medium text-[13px] leading-snug text-on-surface">
                                    Delete this recording? Your notes stay.
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <TertiaryButton danger onClick={() => confirmDelete(take)}>
                                        {remove.isPending ? 'Deleting…' : 'Delete'}
                                    </TertiaryButton>
                                    <span data-keep className="contents">
                                        <TertiaryButton onClick={() => keep(take)}>Keep</TertiaryButton>
                                    </span>
                                </span>
                            </div>
                        ) : (
                            <>
                                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    {number !== undefined ? (
                                        <>
                                            <span className="font-body font-medium text-[13px] leading-none text-on-surface truncate">
                                                Recording {number}
                                            </span>
                                            <span className="truncate font-body font-normal text-[11px] leading-none text-on-surface-variant">
                                                <span className="font-mono">{formatRecordingTime(take.seconds)}</span>
                                                {' · '}
                                                {formatTakeDate(take.startedAt)}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="font-body font-medium text-[13px] leading-none text-on-surface truncate">
                                                {formatTakeDate(take.startedAt)}
                                            </span>
                                            {/* The score name rides the length line, outside any clipping box, so the
                                                link's focus ring shows whole; the name truncates inside the link. */}
                                            <span className="flex items-baseline min-w-0 leading-none text-on-surface-variant">
                                                <span className="font-mono font-normal text-[11px] shrink-0">
                                                    {formatRecordingTime(take.seconds)}
                                                </span>
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
                                        </>
                                    )}
                                </div>
                                <span data-delete className="contents">
                                    <IconButton
                                        icon="trash-2"
                                        size={32}
                                        onClick={() => setConfirming(take.id)}
                                        ariaLabel="Delete recording"
                                        hoverTone="magenta"
                                        idleClassName="bg-transparent text-on-surface-variant"
                                    />
                                </span>
                            </>
                        )}
                    </li>
                )
            })}
        </ul>
    )
}
