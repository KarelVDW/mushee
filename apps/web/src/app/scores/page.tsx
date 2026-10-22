'use client'

import { Glyph } from '@mushee/notation/components'
import { Instrument, Score } from '@mushee/notation/model'
import { ScoreSerializer } from '@mushee/notation/model/io/ScoreSerializer'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type ScoreAllowance, ScoreLimitDialog, useScoreAllowance } from '@/components/ScoreLimitDialog'
import {
    Alert,
    ErrorScreen,
    Footer,
    Icon,
    LoadingStatus,
    PageHeader,
    Popover,
    PrimaryButton,
    SecondaryButton,
    showToast,
    TertiaryButton,
    TextField,
    Tooltip,
    TopNav,
} from '@/components/ui'
import { ApiError, NetworkError, type ScoreMeta } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { formatRelativeTime, formatShortDate } from '@/lib/dates'
import { withPlan } from '@/lib/plans'
import { useBillingState, useCreateScore, useDeleteScore, useDuplicateScore, useOnboarding, useRenameScore, useScores } from '@/lib/queries'
import { type ImportedScoreFile, ScoreFileImporter } from '@/lib/ScoreFileImporter'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

import { settingsTabPath } from '../settings/settingsTabs'
import { DeleteScoreDialog } from './DeleteScoreDialog'
import { ImportScoreDialog } from './ImportScoreDialog'
import { defaultScoreTitle, NewScoreDialog } from './NewScoreDialog'
import { RenameScoreDialog } from './RenameScoreDialog'

/** On a phone the search field waits until the library holds more scores than this (or a search is active). */
const PHONE_SEARCH_FROM = 5

export default function ScoresPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const [search, setSearch] = useState('')
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [createRequested, setCreateRequested] = useState(false)
    const [limitDialogOpen, setLimitDialogOpen] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<ScoreMeta | null>(null)
    const [renameTarget, setRenameTarget] = useState<ScoreMeta | null>(null)
    const [importedFile, setImportedFile] = useState<ImportedScoreFile | null>(null)
    const [readingFile, setReadingFile] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)

    const debouncedSearch = useDebouncedValue(search, 300)
    const { data: scores, isPending, isPlaceholderData, isFetching, error, refetch } = useScores(debouncedSearch || undefined)
    // The whole library, whatever the search: what the cap counts and the empty state checks.
    // Without a search it is the same cached query as the list on screen.
    const library = useScores()
    const libraryCount = library.data?.length
    const allowance = useScoreAllowance(libraryCount)
    const billing = useBillingState()
    const createMutation = useCreateScore()
    const deleteMutation = useDeleteScore()
    const duplicateMutation = useDuplicateScore()
    const renameMutation = useRenameScore()

    // A new score starts on the first instrument picked in onboarding; the voice when there is none.
    const { data: onboarding } = useOnboarding()
    const defaultInstrument = useMemo(
        () =>
            onboarding?.instruments
                ?.map((name) => Instrument.findByDisplayName(name))
                .find((instrument): instrument is Instrument => instrument !== undefined && instrument.category !== 'Percussion') ??
            Instrument.VoiceLead,
        [onboarding],
    )

    // A truly empty library: the first-score card is the page, so the header drops Import and search.
    const emptyLibrary = libraryCount === 0 && !search && !debouncedSearch && !library.error
    const titlePlaceholder = defaultScoreTitle(libraryCount === 0)

    /** New score, from the nav, the empty card or ?new=1 — at the cap the limit dialog opens before any form. */
    const openCreate = useCallback(() => {
        if (allowance?.atCap) setLimitDialogOpen(true)
        else setCreateDialogOpen(true)
    }, [allowance])

    // "New score" on other pages lands here as /scores?new=1. The flag is read from
    // window.location in a mount effect, not useSearchParams, so the page needs no
    // Suspense boundary; dropping it right away keeps a reload from reopening the dialog.
    useEffect(() => {
        if (!new URLSearchParams(window.location.search).has('new')) return
        setCreateRequested(true)
        router.replace('/scores')
    }, [router])

    // …and opens once the library is counted, so a full one shows the limit dialog instead.
    const countSettled = !library.isPending && !billing.isPending
    useEffect(() => {
        if (!createRequested || !countSettled) return
        setCreateRequested(false)
        openCreate()
    }, [createRequested, countSettled, openCreate])

    /** Import, from the header or the empty card: at the cap the limit dialog opens before the file picker. */
    function openImport() {
        if (readingFile) return
        if (allowance?.atCap) setLimitDialogOpen(true)
        else fileInputRef.current?.click()
    }

    function handleCreate(title: string, instrument: Instrument) {
        createFromScore(title, Score.blank(instrument))
    }

    /** Read a picked MusicXML/MIDI file into a score; the import dialog then confirms title and instrument. */
    async function handleImportFile(file: File) {
        setReadingFile(true)
        try {
            setImportedFile(await new ScoreFileImporter(file).import())
        } catch (err) {
            console.error('Import failed', err)
            showToast(err instanceof Error ? err.message : 'Could not read the file.')
        } finally {
            setReadingFile(false)
            // Let the same file be picked again after a cancel.
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    function createFromScore(title: string, score: Score) {
        const document = new ScoreSerializer(score).toInput()

        createMutation.mutate(
            { title, score: document },
            {
                onSuccess: (created) => router.push(`/scores/${created.id}`),
                onError: (err) => {
                    // The server refuses the create when the plan's score cap is
                    // reached — that's an upgrade conversation, not a failure toast.
                    if (err instanceof ApiError && err.isScoreLimit) setLimitDialogOpen(true)
                    else showToast('Could not create the score. Please try again.')
                },
            },
        )
    }

    function handleDuplicate(score: ScoreMeta) {
        // A copy is a new score, so it hits the same plan cap as a create.
        if (allowance?.atCap) {
            setLimitDialogOpen(true)
            return
        }
        duplicateMutation.mutate(score.id, {
            onSuccess: (copy) => showToast(`Created “${copy.title}”.`, 'info', 'check'),
            onError: (err) => {
                if (err instanceof ApiError && err.isScoreLimit) setLimitDialogOpen(true)
                else showToast('Could not duplicate the score. Please try again.')
            },
        })
    }

    function handleDeleteConfirmed(score: ScoreMeta) {
        deleteMutation.mutate(score.id)
        setDeleteTarget(null)
    }

    function handleRename(score: ScoreMeta, title: string) {
        renameMutation.mutate({ id: score.id, title })
        setRenameTarget(null)
    }

    function clearSearch() {
        setSearch('')
        searchInputRef.current?.focus()
    }

    // Worst case: the very first load can't even reach the server — there is
    // nothing useful to show, so explain it on a full page. It keeps trying by
    // itself (useScores polls while unreachable, and coming back online retries).
    if (error instanceof NetworkError && scores === undefined) {
        return (
            <ErrorScreen
                tone="unreachable"
                title="Can't connect right now"
                message="Check your internet connection and try again. Your scores are safe."
                onRetry={() => void refetch()}
                retrying={isFetching}
                secondaryAction={<TertiaryButton href="/">Go home</TertiaryButton>}
            />
        )
    }

    // The phone's search field waits for a library worth searching.
    const phoneSearch = (libraryCount ?? 0) > PHONE_SEARCH_FROM || search !== ''

    return (
        <div className="bg-surface text-on-surface min-h-dvh flex flex-col">
            <TopNav user={session?.user?.name ?? undefined} onCreate={openCreate} />

            <main className="flex-1 max-w-384 mx-auto px-4 sm:px-8 py-6 sm:py-10 flex flex-col gap-6 w-full box-border">
                <PageHeader
                    title="Your scores"
                    subtitle={allowance?.line && <AllowanceLine allowance={allowance} />}
                    right={
                        !emptyLibrary && (
                            <div className="flex items-center gap-3 w-full md:w-auto">
                                <span className="max-md:hidden">
                                    <SecondaryButton onClick={openImport} disabled={readingFile}>
                                        {readingFile ? 'Reading file…' : 'Import file'}
                                    </SecondaryButton>
                                </span>
                                <div className={`flex-1 md:flex-none md:w-64 ${phoneSearch ? '' : 'max-md:hidden'}`}>
                                    <TextField
                                        value={search}
                                        onChange={setSearch}
                                        leftIcon="search"
                                        placeholder="Find a score…"
                                        ariaLabel="Search your scores"
                                        clearLabel="Clear search"
                                        inputRef={searchInputRef}
                                        enterKeyHint="search"
                                    />
                                </div>
                                <span className="md:hidden ml-auto">
                                    <TertiaryButton onClick={openImport}>{readingFile ? 'Reading file…' : 'Import a file'}</TertiaryButton>
                                </span>
                            </div>
                        )
                    }
                />
                {/* Outside the header: the empty card's import link still needs it once the header controls are gone. */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={ScoreFileImporter.ACCEPT}
                    aria-label="Import a score file"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void handleImportFile(file)
                    }}
                />

                {/* Stale results may still be on screen below (keepPreviousData) — say so rather than fail silently. */}
                {error && <Alert onRetry={() => void refetch()}>Your scores couldn&apos;t be loaded.</Alert>}
                <LibraryBody
                    scores={scores}
                    isPending={isPending}
                    error={error}
                    query={debouncedSearch}
                    isPlaceholderData={isPlaceholderData}
                    readingFile={readingFile}
                    onRetry={() => void refetch()}
                    onCreate={openCreate}
                    onImport={openImport}
                    onClearSearch={clearSearch}
                    onOpen={(score) => router.push(`/scores/${score.id}`)}
                    onRename={setRenameTarget}
                    onDuplicate={handleDuplicate}
                    onDelete={setDeleteTarget}
                />
            </main>

            {createDialogOpen && (
                <NewScoreDialog
                    title="New score"
                    subtitle="You can change both later."
                    initialInstrument={defaultInstrument}
                    titlePlaceholder={titlePlaceholder}
                    onCancel={() => setCreateDialogOpen(false)}
                    onCreate={(title, instrument) => {
                        setCreateDialogOpen(false)
                        handleCreate(title, instrument)
                    }}
                />
            )}

            {importedFile && (
                <ImportScoreDialog
                    imported={importedFile}
                    titlePlaceholder={titlePlaceholder}
                    onCancel={() => setImportedFile(null)}
                    onCreate={(title, score) => {
                        setImportedFile(null)
                        createFromScore(title, score)
                    }}
                />
            )}

            {limitDialogOpen && (
                <ScoreLimitDialog
                    onUpgrade={(planId) => router.push(withPlan(settingsTabPath('plan'), planId))}
                    onClose={() => setLimitDialogOpen(false)}
                />
            )}

            {renameTarget && (
                <RenameScoreDialog
                    score={renameTarget}
                    onCancel={() => setRenameTarget(null)}
                    onRename={(title) => handleRename(renameTarget, title)}
                />
            )}

            {deleteTarget && (
                <DeleteScoreDialog
                    score={deleteTarget}
                    onCancel={() => setDeleteTarget(null)}
                    onConfirm={() => handleDeleteConfirmed(deleteTarget)}
                />
            )}

            <Footer />
        </div>
    )
}

/** The header's quiet count once the cap is near: '3 of 5 free scores', and at the cap a way to more room. */
function AllowanceLine({ allowance }: { allowance: ScoreAllowance }) {
    const { next } = allowance
    return (
        <span className="inline-flex flex-wrap items-center gap-x-2 text-[14px]">
            {allowance.line}
            {allowance.atCap && next && <TertiaryButton href={withPlan(settingsTabPath('plan'), next.id)}>See plans</TertiaryButton>}
        </span>
    )
}

interface LibraryBodyProps {
    scores: ScoreMeta[] | undefined
    isPending: boolean
    error: Error | null
    /** The search the results were asked for — the debounced text, not the live field. */
    query: string
    /** The list on screen is still the previous search's (keepPreviousData) while this one loads. */
    isPlaceholderData: boolean
    readingFile: boolean
    onRetry: () => void
    onCreate: () => void
    onImport: () => void
    onClearSearch: () => void
    onOpen: (score: ScoreMeta) => void
    onRename: (score: ScoreMeta) => void
    onDuplicate: (score: ScoreMeta) => void
    onDelete: (score: ScoreMeta) => void
}

/** The library under the header: loading, nothing, an empty result, or the score table. */
function LibraryBody({
    scores,
    isPending,
    error,
    query,
    isPlaceholderData,
    readingFile,
    onRetry,
    onCreate,
    onImport,
    onClearSearch,
    onOpen,
    onRename,
    onDuplicate,
    onDelete,
}: LibraryBodyProps) {
    if (isPending && !error) {
        return (
            <LoadingStatus
                skeleton={<LibrarySkeleton />}
                message={<span className="sr-only">Loading your scores…</span>}
                slowAction={<TertiaryButton onClick={onRetry}>Try again</TertiaryButton>}
            />
        )
    }
    if (scores === undefined) return null
    if (scores.length === 0) {
        // An empty placeholder is a previous search's miss, not an empty library — keep
        // the onboarding card away until the unfiltered list has actually come back.
        if (!query && !isPlaceholderData) return <FirstScoreEmpty readingFile={readingFile} onCreate={onCreate} onImport={onImport} />
        return (
            <EmptyCard>
                <span className="text-outline-variant">
                    <Icon name="search" size={32} />
                </span>
                <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                    No scores match{query && <> &ldquo;{query}&rdquo;</>}.
                </span>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-1">
                    <TertiaryButton onClick={onClearSearch}>Clear search</TertiaryButton>
                    <SecondaryButton onClick={onCreate}>New score</SecondaryButton>
                </div>
            </EmptyCard>
        )
    }
    return (
        <div role="table" aria-label="Your scores" className="flex flex-col md:gap-4">
            <div role="rowgroup">
                {/* Phones show cards: the column headers stay for screen readers only. */}
                <div
                    role="row"
                    className="max-md:sr-only grid grid-cols-[1fr_auto] md:grid-cols-[5fr_2fr_2fr_1fr] gap-4 px-4 sm:px-6 py-2 font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                    <span role="columnheader">Title</span>
                    <span role="columnheader" className="max-md:hidden">
                        Created
                    </span>
                    <span role="columnheader" className="max-md:hidden">
                        Updated
                    </span>
                    <span role="columnheader" aria-label="Actions" />
                </div>
            </div>
            <div role="rowgroup" className="flex flex-col gap-3">
                {scores.map((score) => (
                    <ScoreRow
                        key={score.id}
                        score={score}
                        onOpen={() => onOpen(score)}
                        onRename={() => onRename(score)}
                        onDuplicate={() => onDuplicate(score)}
                        onDelete={() => onDelete(score)}
                    />
                ))}
            </div>
        </div>
    )
}

function EmptyCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-surface-container-lowest rounded-md p-8 sm:p-14 editorial-shadow text-center flex flex-col gap-3 items-center">
            {children}
        </div>
    )
}

const SKELETON_BAR = 'block h-3.5 rounded-sm bg-surface-container-low animate-solkey-pulse motion-reduce:animate-none'

/** Three placeholder rows in the shape of the score table, breathing slowly while the list loads. */
function LibrarySkeleton() {
    return (
        <div aria-hidden="true" className="w-full flex flex-col gap-3 pt-10">
            {[0, 1, 2].map((row) => (
                <div
                    key={row}
                    className="bg-surface-container-lowest rounded-md px-4 sm:px-6 py-5.5 editorial-shadow flex items-center justify-between gap-4">
                    <span className={`${SKELETON_BAR} w-2/5`} />
                    <span className={`${SKELETON_BAR} w-[15%]`} />
                </div>
            ))}
        </div>
    )
}

function FirstScoreEmpty({ readingFile, onCreate, onImport }: { readingFile: boolean; onCreate: () => void; onImport: () => void }) {
    return (
        <div className="bg-surface-container-lowest rounded-md px-6 sm:px-8 py-8 sm:py-10 editorial-shadow flex flex-col sm:flex-row items-start gap-5 sm:gap-7">
            <svg viewBox="0 0 120 80" width="96" height="64" aria-hidden className="shrink-0">
                {[0, 1, 2, 3, 4].map((i) => (
                    <line key={i} x1={8} x2={112} y1={20 + i * 10} y2={20 + i * 10} stroke="var(--color-outline-variant)" strokeWidth={1} />
                ))}
                {/* Real Bravura clef — the staff spacing above matches the notation grid (10px). */}
                <Glyph name="gClef" x={16} y={50} fill="var(--color-outline)" />
            </svg>
            <div className="flex-1 flex flex-col gap-5 min-w-0 w-full">
                <div className="flex flex-col gap-1.5">
                    <h2 className="m-0 font-body font-semibold text-[18px] leading-[1.3] text-on-surface">No scores yet.</h2>
                    <p className="m-0 font-body font-normal text-[15px] leading-normal text-on-surface-variant">
                        Start a score, press record, and hum, sing or play — Solkey writes your melody down.
                    </p>
                </div>
                <div className="flex flex-col items-start gap-1.5">
                    <div className="w-full sm:w-auto">
                        <PrimaryButton size="lg" icon="plus" fullWidth onClick={onCreate}>
                            New score
                        </PrimaryButton>
                    </div>
                    <TertiaryButton onClick={onImport}>
                        {readingFile ? 'Reading file…' : 'Or import a MusicXML or MIDI file'}
                    </TertiaryButton>
                </div>
            </div>
        </div>
    )
}

function ScoreRow({
    score,
    onOpen,
    onRename,
    onDuplicate,
    onDelete,
}: {
    score: ScoreMeta
    onOpen: () => void
    onRename: () => void
    onDuplicate: () => void
    onDelete: () => void
}) {
    return (
        <div
            role="row"
            className={[
                'group relative',
                'bg-surface-container-lowest hover:bg-surface-container-high',
                'rounded-md px-4 sm:px-6 py-4.5 editorial-shadow',
                'grid grid-cols-[1fr_auto] md:grid-cols-[5fr_2fr_2fr_1fr] gap-3 md:gap-4 items-center',
                'transition-colors duration-150 ease-solkey',
            ].join(' ')}>
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md bg-primary-container origin-left scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-100 transition-[opacity,transform] duration-150 ease-solkey motion-reduce:transition-none" />
            <div role="cell" className="min-w-0 flex flex-col gap-1">
                {/* The title is the row's link: its ::after stretches over the whole row, so a click anywhere opens the score. */}
                <button
                    onClick={onOpen}
                    type="button"
                    className={[
                        'text-left bg-transparent border-0 p-0 cursor-pointer',
                        "after:absolute after:inset-0 after:rounded-md after:content-['']",
                        'font-body font-medium text-[16px] leading-[1.3]',
                        'text-on-surface group-hover:text-primary',
                        'transition-colors duration-150 ease-solkey',
                        'focus-ring rounded-sm',
                    ].join(' ')}>
                    {score.title}
                    {score.shareToken && (
                        <span
                            className="inline-flex align-middle ml-2 text-on-surface-variant"
                            title="Shared with a read-only link"
                            aria-label="Shared with a read-only link">
                            <Icon name="link" size={13} />
                        </span>
                    )}
                </button>
                <span className="md:hidden font-body font-normal text-[12px] leading-none text-on-surface-variant">
                    {formatRelativeTime(score.updatedAt)}
                </span>
            </div>
            <span role="cell" className="max-md:hidden font-body font-normal text-[13px] leading-none text-on-surface-variant">
                {formatShortDate(score.createdAt)}
            </span>
            <span role="cell" className="max-md:hidden font-body font-normal text-[13px] leading-none text-on-surface-variant">
                {formatRelativeTime(score.updatedAt)}
            </span>
            {/* Positioned after the title, so it sits above the stretched link; its empty space lets clicks through to it. */}
            <div role="cell" className="relative flex justify-end pointer-events-none">
                <ScoreRowMenu score={score} onRename={onRename} onDuplicate={onDuplicate} onDelete={onDelete} />
            </div>
        </div>
    )
}

const MENU_ITEM_CLASS =
    'flex items-center w-full min-h-10 px-3 rounded-md border-0 bg-transparent cursor-pointer text-left font-label font-semibold text-[14px] leading-none hover:bg-surface-container-high transition-colors duration-150 ease-solkey focus-ring'

/** A row's secondary actions behind one labelled 'More' button: rename, duplicate, delete (still confirmed). */
function ScoreRowMenu({
    score,
    onRename,
    onDuplicate,
    onDelete,
}: {
    score: ScoreMeta
    onRename: () => void
    onDuplicate: () => void
    onDelete: () => void
}) {
    const [open, setOpen] = useState(false)
    const anchorRef = useRef<HTMLDivElement>(null)
    const close = useCallback(() => setOpen(false), [])
    const name = `More actions for ${score.title}`
    const act = (action: () => void) => () => {
        close()
        action()
    }

    return (
        <div ref={anchorRef} className="relative pointer-events-auto">
            <Tooltip label="More" side="bottom">
                <button
                    type="button"
                    aria-label={name}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={() => setOpen((o) => !o)}
                    className={[
                        'inline-flex items-center justify-center size-10 shrink-0 rounded-full border-0 cursor-pointer',
                        open
                            ? 'bg-primary-container text-on-primary-container'
                            : 'bg-surface-container group-hover:bg-surface-container-lowest text-on-surface',
                        'hover:bg-primary-container hover:text-on-primary-container',
                        'transition-colors duration-150 ease-solkey focus-ring',
                    ].join(' ')}>
                    <Icon name="more-horizontal" size={18} />
                </button>
            </Tooltip>
            {open && (
                <Popover
                    ariaLabel={name}
                    title={<span className="block max-w-48 truncate">{score.title}</span>}
                    anchorRef={anchorRef}
                    onDismiss={close}
                    manageFocus
                    viewportGutter={16}
                    className="right-0 top-[calc(100%+0.5rem)] w-56 max-w-[calc(100vw-2rem)] gap-2">
                    <div className="flex flex-col -mx-1.5">
                        <button type="button" onClick={act(onRename)} className={`${MENU_ITEM_CLASS} text-on-surface`}>
                            Rename…
                        </button>
                        <button type="button" onClick={act(onDuplicate)} className={`${MENU_ITEM_CLASS} text-on-surface`}>
                            Duplicate
                        </button>
                        <button type="button" onClick={act(onDelete)} className={`${MENU_ITEM_CLASS} text-secondary`}>
                            Delete…
                        </button>
                    </div>
                </Popover>
            )}
        </div>
    )
}
