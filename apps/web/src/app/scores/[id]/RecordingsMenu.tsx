'use client'

import { useEffect, useRef, useState } from 'react'

import { Alert, ChipToggle, Eyebrow, Icon, showToast, TertiaryButton } from '@/components/ui'
import { recordingAudioUrl, type RecordingSummary } from '@/lib/api'
import { useDeleteRecording, useRecordings } from '@/lib/queries'

/** 42 → "0:42", 3725 → "1:02:05" */
export function formatTakeDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.round(seconds % 60)
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

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

interface RecordingsMenuProps {
    scoreId: string
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
}

/**
 * The score's takes: every recording made into it, newest first, with replay of
 * the archived audio and deletion. Lives in the editor header next to Export;
 * opens downward as a glass panel like the export menu. Deletion is the
 * user-facing half of the privacy policy's "recordings are yours, delete them
 * any time" — the audio object goes first, then the row.
 */
export function RecordingsMenu({ scoreId, compact = false }: RecordingsMenuProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const popRef = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const takes = useRecordings(scoreId, { enabled: open })
    const remove = useDeleteRecording()
    const [confirming, setConfirming] = useState<string | null>(null)
    const [playing, setPlaying] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const stopAudio = () => {
        audioRef.current?.pause()
        audioRef.current = null
        setPlaying(null)
    }

    useEffect(() => {
        if (!open) {
            stopAudio()
            setConfirming(null)
            return
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
            }
            e.stopPropagation()
        }
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node
            if (popRef.current && !popRef.current.contains(target) && !anchorRef.current?.contains(target)) setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        const t = setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0)
        return () => {
            window.removeEventListener('keydown', onKey)
            clearTimeout(t)
            document.removeEventListener('mousedown', onMouseDown)
        }
    }, [open])

    // A take's audio outlives nothing: leaving the editor stops it.
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
                showToast('Take deleted.', 'info')
            },
        })
    }

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
                    {takes.data && takes.data.length > 0 && (
                        <ul role="list" aria-label="Takes" className="list-none m-0 p-0 flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                            {takes.data.map((take) => (
                                <li key={take.id} className="flex items-center gap-2 rounded-md bg-surface-container-low px-3 py-2">
                                    <button
                                        type="button"
                                        onClick={() => togglePlay(take)}
                                        disabled={!take.hasAudio}
                                        aria-label={playing === take.id ? 'Pause take' : 'Play take'}
                                        title={take.hasAudio ? undefined : 'No audio was kept for this take'}
                                        className={[
                                            'shrink-0 w-8 h-8 rounded-full border-0 inline-flex items-center justify-center cursor-pointer',
                                            'bg-surface-container-lowest text-on-surface disabled:opacity-40 disabled:cursor-not-allowed',
                                            'hover:bg-surface-container-high transition-colors duration-150 ease-solkey',
                                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                                        ].join(' ')}>
                                        <Icon name={playing === take.id ? 'pause' : 'play'} size={14} />
                                    </button>
                                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                        <span className="font-body font-medium text-[13px] leading-none text-on-surface truncate">
                                            {formatTakeDate(take.startedAt)}
                                        </span>
                                        <span className="font-mono font-normal text-[11px] leading-none text-on-surface-variant">
                                            {formatTakeDuration(take.seconds)}
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
                                        <button
                                            type="button"
                                            onClick={() => setConfirming(take.id)}
                                            aria-label="Delete take"
                                            className={[
                                                'shrink-0 w-8 h-8 rounded-full border-0 inline-flex items-center justify-center cursor-pointer',
                                                'bg-transparent text-on-surface-variant hover:text-error hover:bg-surface-container-high',
                                                'transition-colors duration-150 ease-solkey',
                                                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                                            ].join(' ')}>
                                            <Icon name="trash-2" size={14} />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="m-0 font-body font-normal text-[11px] leading-normal text-on-surface-variant">
                        Takes are private to your account and deleted with it.
                    </p>
                </div>
            )}
        </div>
    )
}
