'use client'

import { Chip, Eyebrow, IconButton, PrimaryButton, TertiaryButton } from '@mushee/ui'
import { requestJson } from '@mushee/ui/http'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { AudioSourceDto, ClipCompareDto, PipelineNotesDto } from '@/lib/dto'
import { Fmt } from '@/lib/format'
import type { Contour } from '@/lib/pianoRoll/PianoRollModel'
import { ABPlayer, type ABPlayerState, type Side } from '@/lib/playback/ABPlayer'

import { Card } from '../Card'
import { PianoRoll, type RollLayers, useZoomAnchor } from './PianoRoll'

type LayerKey = keyof RollLayers

const IDLE: ABPlayerState = { playing: false, side: 'a', duration: 0, error: null }
const MIN_PX_PER_SEC = 8
const MAX_PX_PER_SEC = 800

/**
 * The clip compare view: the original recording against its synthetic copy on one shared
 * playhead, over a piano roll of the copy's notes, the truth they replace, the pipeline's notes
 * and both pitch contours. Datasets without resynth get the original, its truth and the
 * pipeline; the copy's layers simply aren't offered.
 */
export function CompareView({
    dto,
    initialSource,
    initialNotes,
    prevHref,
    nextHref,
}: {
    dto: ClipCompareDto
    initialSource: string | null
    initialNotes: PipelineNotesDto | null
    prevHref: string | null
    nextHref: string | null
}) {
    const router = useRouter()
    const scrollRef = useRef<HTMLDivElement>(null)

    // ---- audio: side A is the original, side B the copy (or the next condition when there is none)
    const original = dto.audio.find((a) => a.role === 'original') ?? dto.audio[0] ?? null
    const [aKey, setAKey] = useState(original?.key ?? null)
    const [bKey, setBKey] = useState(
        dto.audio.find((a) => a.role === 'copy')?.key ?? dto.audio.find((a) => a.key !== original?.key)?.key ?? null,
    )
    const sourceA = dto.audio.find((a) => a.key === aKey) ?? null
    const sourceB = dto.audio.find((a) => a.key === bKey) ?? null
    const [player, setPlayer] = useState<ABPlayer | null>(null)
    // Choosing another pair of recordings keeps the moment and the side being heard.
    const resume = useRef<{ time: number; side: Side } | null>(null)

    useEffect(() => {
        if (!sourceA) return
        const next = new ABPlayer(sourceA.url, sourceB?.url ?? null)
        if (resume.current) {
            next.seek(resume.current.time)
            next.select(resume.current.side)
        }
        setPlayer(next)
        return () => {
            resume.current = { time: next.currentTime, side: next.state.side }
            next.dispose()
        }
    }, [sourceA, sourceB])

    const state = useSyncExternalStore(player?.subscribe ?? noopSubscribe, player?.getSnapshot ?? idle, idle)
    const currentTime = useCallback(() => player?.currentTime ?? 0, [player])
    const seek = useCallback((sec: number) => player?.seek(sec), [player])

    // ---- layers
    // Onset-only truth and no copy yet: nothing pitched to draw but the pipeline's notes.
    const pitchless = dto.dataset.truthSource === 'onsets' && !dto.primary
    const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
        primary: true,
        reference: true,
        pipeline: true,
        origPitch: true,
        copyPitch: true,
        diffs: true,
    })
    const [source, setSource] = useState(initialSource)
    const notes = useQuery({
        queryKey: ['pipeline-notes', dto.dataset.id, dto.clip, source],
        queryFn: () =>
            requestJson<PipelineNotesDto>(
                `/api/notes?ds=${encodeURIComponent(dto.dataset.id)}&clip=${encodeURIComponent(dto.clip)}&source=${encodeURIComponent(source ?? '')}`,
            ),
        enabled: source !== null,
        initialData: source === initialSource && initialNotes ? initialNotes : undefined,
        staleTime: Infinity,
    })
    const pipelineNotes = notes.data?.notes ?? null

    const contours = useMemo(() => {
        if (!dto.f0) return { orig: null, copy: null }
        const orig: Contour = { hopSec: dto.f0.hopSec, values: dto.f0.orig }
        const copy: Contour | null = dto.f0.copy.length ? { hopSec: dto.f0.hopSec, values: dto.f0.copy } : null
        return { orig, copy }
    }, [dto.f0])

    const layers: RollLayers = {
        primary: visible.primary ? (dto.primary?.notes ?? null) : null,
        reference: visible.reference ? (dto.reference?.notes ?? null) : null,
        pipeline: visible.pipeline ? pipelineNotes : null,
        origPitch: visible.origPitch ? contours.orig : null,
        copyPitch: visible.copyPitch ? contours.copy : null,
        diffs: visible.diffs ? (dto.resynth?.work?.diffs ?? null) : null,
    }
    const rangeNotes = useMemo(
        () => [dto.primary?.notes ?? [], dto.reference?.notes ?? [], pipelineNotes ?? []].filter((n) => n.length > 0),
        [dto.primary, dto.reference, pipelineNotes],
    )
    const rangeContours = useMemo(() => [contours.orig, contours.copy].filter((c): c is Contour => c !== null), [contours])
    const labels = useMemo(
        () => ({ primary: dto.primary?.label ?? 'Truth', reference: dto.reference?.label ?? 'Reference', pipeline: 'Pipeline' }),
        [dto.primary, dto.reference],
    )

    // ---- zoom: fit short clips, ~80 px/s for long ones; the time at the centre stays put
    const durationSec = Math.max(dto.durationSec ?? 0, state.duration, 1)
    const [pxPerSec, setPxPerSec] = useState(80)
    const fit = useCallback(() => {
        const width = scrollRef.current?.clientWidth ?? 800
        return Math.max(MIN_PX_PER_SEC, (width - 4) / durationSec)
    }, [durationSec])
    const fitted = useRef(false)
    useEffect(() => {
        // Wait for a real length (the WAV header's, else the audio's metadata) before fitting.
        if (fitted.current || !scrollRef.current || durationSec <= 1) return
        fitted.current = true
        setPxPerSec(durationSec <= 20 ? fit() : Math.max(fit(), 60))
    }, [durationSec, fit])
    useZoomAnchor(scrollRef, pxPerSec)
    const zoom = useCallback((factor: number) => setPxPerSec((p) => Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, p * factor))), [])

    // ---- keyboard: space plays, a / b pick the side, arrows seek, [ ] change clip, + − zoom
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null
            if (e.metaKey || e.ctrlKey || e.altKey) return
            if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
            if (!player) return
            switch (e.key) {
                case ' ':
                    e.preventDefault()
                    player.toggle()
                    break
                case 'a':
                case 'A':
                    player.select('a')
                    break
                case 'b':
                case 'B':
                    if (player.hasB) player.select('b')
                    break
                case 'ArrowLeft':
                case 'ArrowRight':
                    e.preventDefault()
                    player.seek(player.currentTime + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 2))
                    break
                case 'Home':
                    e.preventDefault()
                    player.seek(0)
                    break
                case '[':
                    if (prevHref) router.push(prevHref)
                    break
                case ']':
                    if (nextHref) router.push(nextHref)
                    break
                case '+':
                case '=':
                    zoom(1.5)
                    break
                case '-':
                    zoom(1 / 1.5)
                    break
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [player, prevHref, nextHref, router, zoom])

    const toggle = (key: LayerKey) => setVisible((v) => ({ ...v, [key]: !v[key] }))
    const missing: string[] = []
    // The copy and its contours only belong to clips the resynth loop has touched.
    if (dto.resynth && !dto.f0) missing.push('pitch contours (written by the resynth export)')
    if (dto.resynth && !dto.audio.some((a) => a.role === 'copy')) missing.push('a synthetic copy')
    if (dto.pipelineSources.length === 0) missing.push('pipeline notes (benchmark.ts caches them on its next run)')

    return (
        <div className="flex flex-col gap-4 min-w-0">
            <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                    <PrimaryButton
                        size="lg"
                        icon={state.playing ? 'pause' : 'play'}
                        ariaLabel={state.playing ? 'Pause' : 'Play'}
                        onClick={() => player?.toggle()}
                        disabled={!player || !sourceA}
                    />
                    <SideSwitch side={state.side} a={sourceA} b={sourceB} onSelect={(s) => player?.select(s)} />
                    <TimeReadout currentTime={currentTime} duration={durationSec} />
                    <div className="flex items-center gap-1.5 ml-auto">
                        <IconButton
                            icon="zoom-out"
                            ariaLabel="Zoom out"
                            title="Zoom out · −"
                            hoverTone="neutral"
                            onClick={() => zoom(1 / 1.5)}
                        />
                        <IconButton icon="zoom-in" ariaLabel="Zoom in" title="Zoom in · +" hoverTone="neutral" onClick={() => zoom(1.5)} />
                        <TertiaryButton onClick={() => setPxPerSec(fit())}>Fit</TertiaryButton>
                    </div>
                </div>
                {state.error && <p className="font-body text-[13px] text-error m-0">{state.error}</p>}
                {dto.audio.length > 2 && (
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                        <SourceSelect label="A" sources={dto.audio} value={aKey} onChange={setAKey} />
                        <SourceSelect label="B" sources={dto.audio} value={bKey} onChange={setBKey} />
                    </div>
                )}
                <p className="font-body text-[12px] text-on-surface-variant m-0">
                    <Key>Space</Key> play / pause · <Key>A</Key> <Key>B</Key> switch recording, same moment · <Key>←</Key> <Key>→</Key> 2 s
                    (with ⇧ 10 s) · <Key>[</Key> <Key>]</Key> previous / next clip · click the roll to jump
                </p>
            </Card>

            <Card flush className="pt-4 pb-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2 px-5 pb-3" role="group" aria-label="Layers">
                    {dto.primary && (
                        <Chip active={visible.primary} onClick={() => toggle('primary')}>
                            <Swatch className="bg-chart-cyan/40 border-l-2 border-chart-cyan" />
                            {dto.primary.label} · {dto.primary.notes.length}
                        </Chip>
                    )}
                    {dto.reference && (
                        <Chip active={visible.reference} onClick={() => toggle('reference')}>
                            <Swatch className="border-[1.5px] border-on-surface-variant" />
                            {dto.reference.label} · {dto.reference.notes.length}
                        </Chip>
                    )}
                    {dto.pipelineSources.length > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                            <Chip active={visible.pipeline} onClick={() => toggle('pipeline')}>
                                <Swatch className="bg-chart-magenta h-1.5" />
                                Pipeline{pipelineNotes ? ` · ${pipelineNotes.length}` : ''}
                            </Chip>
                            <select
                                aria-label="Whose pipeline notes"
                                value={source ?? ''}
                                onChange={(e) => setSource(e.target.value || null)}
                                className="h-(--control-sm) max-w-64 rounded-full bg-(--control-fill) hover:bg-(--control-fill-hover) px-3 font-label font-semibold text-[11px] text-on-surface border-0 focus-ring cursor-pointer">
                                {dto.pipelineSources.map((s) => (
                                    <option key={s.key} value={s.key}>
                                        {s.label}
                                    </option>
                                ))}
                            </select>
                        </span>
                    )}
                    {!!dto.resynth?.work?.diffs.length && (
                        <Chip active={visible.diffs} onClick={() => toggle('diffs')}>
                            <Swatch className="bg-on-surface/10" />
                            Open differences · {dto.resynth.work.diffs.length}
                        </Chip>
                    )}
                    {contours.orig && (
                        <Chip active={visible.origPitch} onClick={() => toggle('origPitch')}>
                            <Swatch className="bg-outline-variant h-1.5 rounded-full" />
                            Original pitch
                        </Chip>
                    )}
                    {contours.copy && (
                        <Chip active={visible.copyPitch} onClick={() => toggle('copyPitch')}>
                            <Swatch className="bg-on-surface h-0.5 rounded-full" />
                            Copy pitch
                        </Chip>
                    )}
                </div>
                {pitchless && (
                    <p className="font-body text-[13px] text-on-surface-variant m-0 px-5 pb-3">
                        This dataset&apos;s truth is onsets only — there are no pitches to draw. Listen, and compare the onset F1 per run.
                    </p>
                )}
                <PianoRoll
                    layers={layers}
                    rangeNotes={rangeNotes}
                    rangeContours={rangeContours}
                    durationSec={durationSec}
                    pxPerSec={pxPerSec}
                    labels={labels}
                    currentTime={currentTime}
                    playing={state.playing}
                    onSeek={seek}
                    scrollRef={scrollRef}
                />
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-1 pb-2 font-body text-[12px] text-on-surface-variant">
                    {dto.primary && <span>{dto.primary.detail}</span>}
                    {source && notes.data && notes.data.notes === null && <span>The chosen run has no notes for this clip.</span>}
                    {notes.data?.from && <span>Pipeline notes cached under {notes.data.from}, which shares this audio.</span>}
                    {notes.data?.error && <span className="text-error">Pipeline error: {notes.data.error}</span>}
                    {dto.primary?.notes.some((n) => n.flags?.length) && (
                        <span className="inline-flex items-center gap-1">
                            <Swatch className="bg-[repeating-linear-gradient(45deg,var(--color-chart-cyan)_0_2px,transparent_2px_5px)]" />{' '}
                            hatched + ? = flagged uncertain
                        </span>
                    )}
                    {missing.length > 0 && <span>Not available yet: {missing.join(', ')}.</span>}
                </div>
            </Card>
        </div>
    )
}

/** The A/B switch: an inset track with a raised thumb on the side being heard; each side says which recording it is. */
function SideSwitch({
    side,
    a,
    b,
    onSelect,
}: {
    side: Side
    a: AudioSourceDto | null
    b: AudioSourceDto | null
    onSelect: (s: Side) => void
}) {
    const option = (key: Side, src: AudioSourceDto | null) => {
        const on = side === key
        return (
            <button
                type="button"
                aria-pressed={on}
                disabled={!src}
                title={src ? `${src.label} · ${key.toUpperCase()}` : 'No second recording for this clip'}
                onClick={() => onSelect(key)}
                className={[
                    'inline-flex items-center gap-2 rounded-full px-4 h-(--control-md) border-0 cursor-pointer focus-ring',
                    'font-label font-semibold text-[13px] leading-none whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ease-solkey',
                    on
                        ? 'bg-surface-container-lowest tonal-layer-glow text-on-surface'
                        : 'bg-transparent text-on-surface-variant hover:text-on-surface',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                ].join(' ')}>
                <span className="font-mono text-[12px] text-on-surface-variant">{key.toUpperCase()}</span>
                {src?.label ?? 'No copy yet'}
            </button>
        )
    }
    return (
        <div
            role="group"
            aria-label="Which recording you hear"
            className="inline-flex rounded-full bg-surface-container-low p-0.75 gap-0.5">
            {option('a', a)}
            {option('b', b)}
        </div>
    )
}

function SourceSelect({
    label,
    sources,
    value,
    onChange,
}: {
    label: string
    sources: AudioSourceDto[]
    value: string | null
    onChange: (key: string) => void
}) {
    return (
        <label className="inline-flex items-center gap-2">
            <Eyebrow>{label}</Eyebrow>
            <select
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                className="h-(--control-sm) rounded-full bg-(--control-fill) hover:bg-(--control-fill-hover) px-3 font-label font-semibold text-[12px] text-on-surface border-0 focus-ring cursor-pointer">
                {sources.map((s) => (
                    <option key={s.key} value={s.key}>
                        {s.label}
                    </option>
                ))}
            </select>
        </label>
    )
}

/** The playhead's time, written straight to the DOM every frame (no re-render). */
function TimeReadout({ currentTime, duration }: { currentTime: () => number; duration: number }) {
    const ref = useRef<HTMLSpanElement>(null)
    useEffect(() => {
        let frame = 0
        const tick = () => {
            if (ref.current) ref.current.textContent = Fmt.clockPrecise(currentTime())
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [currentTime])
    return (
        <span className="font-mono tabular-nums text-[15px] text-on-surface">
            <span ref={ref}>0:00.0</span>
            <span className="text-on-surface-variant"> / {Fmt.clockPrecise(duration)}</span>
        </span>
    )
}

function Swatch({ className }: { className: string }) {
    return <span aria-hidden="true" className={`inline-block w-3.5 h-2.5 rounded-xs shrink-0 ${className}`} />
}

function Key({ children }: { children: string }) {
    return (
        <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-sm bg-surface-container font-mono text-[11px] text-on-surface align-[1px]">
            {children}
        </kbd>
    )
}

const noopSubscribe = () => () => {}
const idle = (): ABPlayerState => IDLE
