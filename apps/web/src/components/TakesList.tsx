'use client'

import { useEffect, useRef, useState } from 'react'

import { IconButton, showToast, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import { recordingAudioUrl, type RecordingSummary } from '@/lib/api'
import { useDeleteRecording } from '@/lib/queries'
import { formatRecordingTime } from '@/lib/recordingTime'

/** "Today, 14:02" / "Yesterday, 09:10" / "3 Sep, 14:02" / "3 Sep 2025, 14:02" */
export function formatTakeDate(iso: string, now = new Date()): string {
    const date = new Date(iso)
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (sameDay(date, now)) return `Today, ${time}`
    if (sameDay(date, yesterday)) return `Yesterday, ${time}`
    const day = date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    })
    return `${day}, ${time}`
}

interface TakesListProps {
    takes: readonly RecordingSummary[]
    /** A second line per row (the score's title on cross-score lists). */
    subtitleFor?: (take: RecordingSummary) => string | undefined
    /** Constrain the list's height and scroll inside (panels); pages let it grow. */
    scroll?: boolean
}

/**
 * Rows of takes with replay (one Audio element for the list; the cookie rides
 * same-site) and a two-step inline delete. Shared by the editor's Takes panel
 * and Settings → Your data. Unmounting stops whatever was playing.
 */
export function TakesList({ takes, subtitleFor, scroll = true }: TakesListProps) {
    const remove = useDeleteRecording()
    const [confirming, setConfirming] = useState<string | null>(null)
    const [playing, setPlaying] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const stopAudio = () => {
        audioRef.current?.pause()
        audioRef.current = null
        setPlaying(null)
    }
    useEffect(() => () => audioRef.current?.pause(), [])

    const togglePlay = (take: RecordingSummary) => {
        if (playing === take.id) return stopAudio()
        stopAudio()
        const audio = new Audio(recordingAudioUrl(take.id))
        audio.onended = () => setPlaying((current) => (current === take.id ? null : current))
        audio.onerror = () => {
            setPlaying(null)
            showToast("This take's audio couldn't be loaded.")
        }
        audioRef.current = audio
        setPlaying(take.id)
        track('take_played', { seconds: take.seconds })
        void audio.play().catch(() => {
            setPlaying(null)
            showToast("This take's audio couldn't be played.")
        })
    }

    const confirmDelete = (take: RecordingSummary) => {
        if (remove.isPending) return
        if (playing === take.id) stopAudio()
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
                const subtitle = subtitleFor?.(take)
                return (
                    <li key={take.id} className="flex items-center gap-2 rounded-md bg-surface-container-low px-3 py-2">
                        <IconButton
                            icon={playing === take.id ? 'pause' : 'play'}
                            size={32}
                            onClick={() => togglePlay(take)}
                            disabled={!take.hasAudio}
                            ariaLabel={playing === take.id ? 'Pause take' : 'Play take'}
                            title={take.hasAudio ? undefined : 'No audio was kept for this take'}
                            hoverTone="neutral"
                            idleClassName="bg-surface-container-lowest"
                        />
                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="font-body font-medium text-[13px] leading-none text-on-surface truncate">
                                {formatTakeDate(take.startedAt)}
                                {subtitle && <span className="font-normal text-on-surface-variant"> · {subtitle}</span>}
                            </span>
                            <span className="font-mono font-normal text-[11px] leading-none text-on-surface-variant">
                                {formatRecordingTime(take.seconds)}
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
