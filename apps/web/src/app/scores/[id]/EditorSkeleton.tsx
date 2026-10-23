'use client'

import { NUM_STAFF_LINES, ROW_GAP, ROW_HEIGHT, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@mushee/notation/engraving/constants'
import { Skeleton } from '@mushee/ui'
import Link from 'next/link'
import { type CSSProperties, useEffect, useRef } from 'react'

import { Icon, LoadingStatus, SecondaryButton, Wordmark } from '@/components/ui'

import { DOCK_WELL_MIN_WIDTHS } from './NoteToolDock'

/** The header and dock chrome's own tone, on a layer of its own (as the real bars draw it). */
const CHROME_BACKDROP = 'pointer-events-none absolute inset-0 -z-10 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow'
/** An empty white well or circle: the card lift, no ring, no accent. */
const WELL = 'block bg-surface-container-lowest tonal-layer-glow'

/**
 * The skeleton score's vertical rhythm, in the layout's own units (ScoreLayout and Staff): the
 * first staff's top line, the staff's height, and where the second row's staff starts.
 */
const STAFF_TOP = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
const STAFF_HEIGHT = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
const SECOND_STAFF_TOP = ROW_HEIGHT + ROW_GAP + STAFF_TOP

/** `units` layout units as a CSS length (`--u` is one unit in pixels; see EditorSkeleton). */
const units = (n: number) => `calc(var(--u) * ${n})`

/**
 * One staff of the skeleton score: five 1px `outline_variant` lines, STAVE_LINE_DISTANCE apart,
 * where the real row's staff will be drawn — on the slow pulse.
 */
function StaffRow({ className, style }: { className: string; style?: CSSProperties }) {
    return (
        <span
            aria-hidden
            className={`flex flex-col animate-solkey-pulse motion-reduce:animate-none ${className}`}
            style={{ ...style, gap: `calc(${units(STAVE_LINE_DISTANCE)} - 1px)` }}>
            {Array.from({ length: NUM_STAFF_LINES }, (_, i) => (
                <span key={i} className="block h-px bg-outline-variant" />
            ))}
        </span>
    )
}

interface EditorSkeletonProps {
    /** Which wait it is: 'Opening your score…', then the instrument's sound. */
    message: string
    /** The slow-stage way out. */
    onRetry: () => void
}

/**
 * The editor's own shape while a score and its sounds load, so nothing snaps in around a
 * splash when it arrives: the header bar (a working back link, the wordmark where the header
 * shows it, a title bar and the transport's three circles), the paper with two staff rows laid
 * out by the notation layout's own constants, and the dock with its empty wells (two rows on
 * phones, the record circle in the second). The loading status sits under the first staff:
 * what is happening (announced politely), and after a while the slow-connection line and
 * Try again. Only the title bar and the staves pulse — and nothing under reduced motion.
 * Everything but the back link and the status is hidden from assistive tech.
 *
 * Its bars' heights go on the document as the loaded editor's do (`--app-header-h`, `--dock-h`),
 * so the app-wide surfaces mounted outside it (the browser-support banner) keep clear of the
 * skeleton's bars as they will of the real ones; the editor takes the variables over when it
 * replaces the skeleton.
 */
export function EditorSkeleton({ message, onRetry }: EditorSkeletonProps) {
    const headerRef = useRef<HTMLElement>(null)
    const dockRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const header = headerRef.current
        const dock = dockRef.current
        if (!header || !dock) return
        const page = document.documentElement.style
        const measure = () => {
            page.setProperty('--app-header-h', `${header.offsetHeight}px`)
            page.setProperty('--dock-h', `${dock.offsetHeight}px`)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(header)
        observer.observe(dock)
        return () => {
            observer.disconnect()
            for (const name of ['--app-header-h', '--dock-h']) page.removeProperty(name)
        }
    }, [])

    return (
        <div data-testid="editor-loading" className="relative flex flex-col h-dvh bg-surface text-on-surface">
            <header ref={headerRef} className="relative z-10 flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-2">
                <span aria-hidden className={CHROME_BACKDROP} />
                <div className="flex items-center gap-1.5 sm:gap-2.5 flex-1 min-w-0">
                    <Link
                        href="/scores"
                        aria-label="Back to library"
                        className={[
                            'text-on-surface-variant size-10 -ml-2.5 shrink-0 no-underline',
                            'inline-flex items-center justify-center rounded-full',
                            'hover:text-on-surface transition-colors duration-150 ease-solkey',
                            'focus-ring',
                        ].join(' ')}>
                        <Icon name="arrow-left" size={20} />
                    </Link>
                    <span aria-hidden className="contents">
                        <Wordmark size={19} className="max-[80rem]:hidden" />
                        <span className="w-px h-5 bg-outline-variant/15 max-[80rem]:hidden" />
                    </span>
                    <Skeleton className="h-4 w-44 rounded-sm" />
                </div>
                {/* The transport's circles where the real ones land (Stop's slot stays empty, as at rest). */}
                <div aria-hidden className="max-md:hidden flex items-center shrink-0 gap-2.5">
                    <span className="size-9" />
                    <span className={`${WELL} size-10 rounded-full`} />
                    <span className={`${WELL} size-12 rounded-full`} />
                    <span className={`${WELL} size-9 rounded-full`} />
                </div>
                <div className="max-md:hidden flex-1" />
            </header>
            <div className="flex-1 overflow-hidden min-h-0 px-2 sm:px-8 bg-surface flex flex-col">
                <div className="mx-auto w-full max-w-240 grow bg-surface-container-lowest p-3 pt-6 sm:p-10 tonal-layer-glow manuscript-canvas">
                    {/* One layout unit (--u) in pixels, as ScoreView scales the score: a wide sheet fits its
                        SCORE_WIDTH-unit layout to the width (0.1cqw a unit), a narrow one reflows at full size. */}
                    <div className="@container">
                        <div className="flex flex-col [--u:1px] @min-[768px]:[--u:0.1cqw]">
                            <StaffRow className="w-full" style={{ marginTop: units(STAFF_TOP) }} />
                            {/* The status under the first staff, a staff space below it. Its box fills the room
                                down to the second staff, which it only pushes on (the slow stage on a
                                narrow sheet) rather than overlap. */}
                            <div
                                className="flex justify-center"
                                style={{
                                    paddingBlock: units(STAVE_LINE_DISTANCE),
                                    minHeight: units(SECOND_STAFF_TOP - STAFF_TOP - STAFF_HEIGHT),
                                }}>
                                <div className="w-full max-w-md">
                                    <LoadingStatus
                                        message={message}
                                        skeleton={null}
                                        slowAction={<SecondaryButton onClick={onRetry}>Try again</SecondaryButton>}
                                    />
                                </div>
                            </div>
                            <StaffRow className="w-3/5" />
                        </div>
                    </div>
                </div>
            </div>
            <div
                ref={dockRef}
                aria-hidden
                className="relative z-20 shrink-0 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] px-2 md:px-4">
                <span className={CHROME_BACKDROP} />
                {/* Desktop: one row of empty wells at the tools' least widths. */}
                <div className="max-md:hidden mx-auto flex items-center justify-center flex-wrap gap-y-2 gap-x-6">
                    {Object.values(DOCK_WELL_MIN_WIDTHS).map((width) => (
                        <span key={width} className={`${WELL} ${width} h-11.5 rounded-full`} />
                    ))}
                </div>
                {/* Phones: the tool row (Undo, the note lengths, More) over the action row (the Note and
                    Pitch wells, then record). */}
                <div className="md:hidden flex flex-col">
                    <div className="flex h-13.5 items-center justify-center gap-x-2">
                        <span className={`${WELL} size-10 rounded-full`} />
                        <span className={`${WELL} h-13.5 w-full max-w-59 rounded-full`} />
                        <span className={`${WELL} h-12 w-11 rounded-xl`} />
                    </div>
                    <div className="flex h-17.75 items-center justify-between pt-2">
                        {/* The two wells as the real ones size them: two 40px buttons, 44px from 400px wide. */}
                        <div className="flex items-center gap-1.5 self-start">
                            <span className={`${WELL} h-11.5 w-22 min-[400px]:h-12.5 min-[400px]:w-24 rounded-full`} />
                            <span className={`${WELL} h-11.5 w-22 min-[400px]:h-12.5 min-[400px]:w-24 rounded-full`} />
                        </div>
                        <span className={`${WELL} size-14 rounded-full`} />
                    </div>
                </div>
            </div>
        </div>
    )
}
