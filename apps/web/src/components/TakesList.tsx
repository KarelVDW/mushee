'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { focusWithoutTooltip, Icon, IconButton, showToast, TertiaryButton, Tooltip } from '@/components/ui'
import { track } from '@/lib/analytics'
import { recordingAudioUrl, type RecordingSummary } from '@/lib/api'
import { formatTakeDate } from '@/lib/dates'
import { useDeleteRecording } from '@/lib/queries'
import { formatRecordingTime } from '@/lib/recordingTime'

/** Why a recording's play button can't act: the reason its tooltip gives. */
const NO_AUDIO_REASON = 'No audio was kept for this recording'

interface TakePlayer {
    /** Id of the take whose audio is playing, if any. */
    playing: string | null
    /** How far through the playing take's audio it is, 0–1 (0 when nothing plays). */
    progress: number
    /** Seconds of the playing take heard so far (0 when nothing plays). */
    elapsed: number
    /** Plays `take`, or stops it when it is the one playing. */
    toggle(take: RecordingSummary): void
    stop(): void
}

const AT_START = { progress: 0, elapsed: 0 }

/**
 * One Audio element for the whole list (the cookie rides same-site). Every async
 * callback first checks that its element is still the current one: a replaced
 * take's late `error`, or the AbortError its pending `play()` rejects with when
 * paused, must not clear the row now playing or raise a false toast. Unmounting
 * stops whatever was playing.
 *
 * While the audio actually plays, one animation-frame loop reads its clock into `progress`
 * and `elapsed`, so a replay visibly moves; the loop is cancelled on pause, end, stop and
 * unmount — it never runs while nothing plays.
 */
function useTakePlayer(): TakePlayer {
    const [playing, setPlaying] = useState<string | null>(null)
    const [clock, setClock] = useState(AT_START)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const frame = useRef<number | null>(null)

    const cancelFrame = () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = null
    }

    useEffect(
        () => () => {
            cancelFrame()
            audioRef.current?.pause()
        },
        [],
    )

    const stop = () => {
        cancelFrame()
        const audio = audioRef.current
        if (audio) {
            audio.onended = audio.onerror = audio.onplaying = audio.onpause = null
            audio.pause()
        }
        audioRef.current = null
        setPlaying(null)
        setClock(AT_START)
    }

    const toggle = (take: RecordingSummary) => {
        if (playing === take.id) return stop()
        stop()
        const audio = new Audio(recordingAudioUrl(take.id))
        const isCurrent = () => audioRef.current === audio
        const finish = () => {
            cancelFrame()
            setPlaying(null)
            setClock(AT_START)
        }
        // The take's own length until the element knows its duration (a streamed file may not say).
        const duration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : take.seconds)
        const tick = () => {
            if (!isCurrent()) return
            const elapsed = audio.currentTime
            setClock({ progress: Math.min(1, Math.max(0, elapsed / Math.max(duration(), 0.001))), elapsed })
            frame.current = requestAnimationFrame(tick)
        }
        audio.onplaying = () => {
            if (!isCurrent()) return
            cancelFrame()
            tick()
        }
        audio.onpause = cancelFrame
        audio.onended = () => {
            if (isCurrent()) finish()
        }
        audio.onerror = () => {
            if (!isCurrent()) return
            finish()
            showToast("This recording's audio couldn't be loaded.")
        }
        audioRef.current = audio
        setPlaying(take.id)
        setClock(AT_START)
        track('take_played', { seconds: take.seconds })
        void audio.play().catch((err: unknown) => {
            if (!isCurrent() || (err instanceof DOMException && err.name === 'AbortError')) return
            finish()
            showToast("This recording's audio couldn't be played.")
        })
    }

    return { playing, progress: clock.progress, elapsed: clock.elapsed, toggle, stop }
}

interface PlayButtonProps {
    take: RecordingSummary
    playing: boolean
    onToggle: () => void
}

/**
 * A recording's 36px play / pause well, with its tooltip. A recording with no audio kept stays
 * focusable (aria-disabled, its click ignored) so hover and keyboard focus still reach the
 * tooltip, which says why it can't play. The playing well takes the soft primary fill.
 */
function PlayButton({ take, playing, onToggle }: PlayButtonProps) {
    const silent = !take.hasAudio
    const label = playing ? 'Pause recording' : 'Play recording'
    return (
        <Tooltip label={label} reason={silent ? NO_AUDIO_REASON : undefined}>
            <button
                type="button"
                aria-label={label}
                aria-disabled={silent || undefined}
                onClick={silent ? undefined : onToggle}
                className={[
                    'inline-flex size-9 shrink-0 items-center justify-center rounded-full border-0',
                    'pointer-coarse:min-h-10 pointer-coarse:min-w-10',
                    'transition-[transform,translate,scale,background-color,color,opacity] duration-(--t-press) ease-solkey',
                    'motion-safe:not-aria-disabled:active:scale-[0.97] focus-ring',
                    silent
                        ? 'cursor-not-allowed opacity-40 bg-surface-container-lowest text-on-surface'
                        : playing
                          ? 'cursor-pointer bg-primary-soft text-on-primary-soft'
                          : 'cursor-pointer bg-surface-container-lowest text-on-surface hover:bg-(--control-fill-hover) active:bg-(--control-fill-press)',
                ].join(' ')}>
                <Icon name={playing ? 'pause' : 'play'} size={16} />
            </button>
        </Tooltip>
    )
}

interface TakesListProps {
    takes: readonly RecordingSummary[]
    /**
     * Cross-score lists (Settings → Recordings): the title of each row's score, shown as a link
     * to it, or null once the score is gone — then the row says "Deleted score" in plain text.
     * Each row then leads with its number within its score ("Recording 2 · Today, 10:54 PM"), the
     * name the editor's panel gives it, so two from the same minute differ. Leave it out on a
     * per-score list, where every row shares one score.
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

/** Each recording's number within its score: 1 for the oldest, by when it started. */
function numbering(takes: readonly RecordingSummary[]): Map<string, number> {
    const byAge = [...takes].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    const counts = new Map<string, number>()
    return new Map(
        byAge.map((take) => {
            const number = (counts.get(take.scoreId) ?? 0) + 1
            counts.set(take.scoreId, number)
            return [take.id, number]
        }),
    )
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
    const numbers = numbered || scoreTitleFor ? numbering(takes) : null

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
                showToast('Recording deleted.', 'info', { icon: 'check' })
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
                const isPlaying = playing === take.id
                // The length, or while it plays how far it has got: '0:02 / 0:05'.
                const clock = (
                    <span className="font-mono font-normal text-[12px] tabular-nums shrink-0">
                        {isPlaying
                            ? `${formatRecordingTime(player.elapsed)} / ${formatRecordingTime(take.seconds)}`
                            : formatRecordingTime(take.seconds)}
                    </span>
                )
                return (
                    <li
                        key={take.id}
                        data-take={take.id}
                        className={[
                            'relative isolate flex items-center gap-3 rounded-md px-3 py-2.5',
                            isPlaying ? 'bg-surface-container' : 'bg-surface-container-low',
                        ].join(' ')}>
                        {/* The replay's progress, sweeping the row behind its content (read from the audio's
                            own clock every frame, so no transition). */}
                        {isPlaying && (
                            <span
                                aria-hidden
                                className="absolute inset-y-0 left-0 w-full origin-left rounded-md bg-primary-soft/35 -z-10"
                                style={{ transform: `scaleX(${player.progress})` }}
                            />
                        )}
                        <PlayButton take={take} playing={isPlaying} onToggle={() => player.toggle(take)} />
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
                                {/* Line heights with room for descenders: the title's 'g' is never clipped. */}
                                <div className="flex flex-col gap-1 flex-1 min-w-0">
                                    {numbered && number !== undefined ? (
                                        <>
                                            <span className="font-body font-medium text-[14px] leading-[1.3] text-on-surface truncate">
                                                Recording {number}
                                            </span>
                                            <span className="truncate font-body font-normal text-[12px] leading-[1.35] text-on-surface-variant">
                                                {clock}
                                                {' · '}
                                                {formatTakeDate(take.startedAt)}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="font-body font-medium text-[14px] leading-[1.3] text-on-surface truncate">
                                                {number !== undefined && `Recording ${number} · `}
                                                {formatTakeDate(take.startedAt)}
                                            </span>
                                            {/* The score name rides the length line, outside any clipping box, so the
                                                link's focus ring shows whole; the name truncates inside the link. */}
                                            <span className="flex items-baseline min-w-0 text-[12px] leading-[1.35] text-on-surface-variant">
                                                {clock}
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
                                    <Tooltip label="Delete recording">
                                        <IconButton
                                            icon="trash-2"
                                            size={32}
                                            onClick={() => setConfirming(take.id)}
                                            ariaLabel="Delete recording"
                                            hoverTone="magenta"
                                            idleClassName="bg-transparent text-on-surface-variant"
                                        />
                                    </Tooltip>
                                </span>
                            </>
                        )}
                    </li>
                )
            })}
        </ul>
    )
}
