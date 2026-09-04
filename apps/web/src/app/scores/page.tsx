'use client'

import { Glyph } from '@mushee/notation/components'
import { Instrument, Score } from '@mushee/notation/model'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import {
    Alert,
    DialogPanel,
    DialogScrim,
    ErrorScreen,
    Footer,
    Icon,
    IconButton,
    PageHeader,
    PrimaryButton,
    SecondaryButton,
    showToast,
    TertiaryButton,
    TextField,
    TopNav,
} from '@/components/ui'
import { ApiError, NetworkError, type ScoreMeta } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { useCreateScore, useDeleteScore, useDuplicateScore, useScores } from '@/lib/queries'
import { type ImportedScoreFile, ScoreFileImporter } from '@/lib/ScoreFileImporter'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

import { CreateScoreDialog } from './CreateScoreDialog'
import { ImportScoreDialog } from './ImportScoreDialog'
import { ScoreLimitDialog } from './ScoreLimitDialog'

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60_000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 7) return formatDate(iso)
    if (days > 1) return `${days} days ago`
    if (days === 1) return 'Yesterday'
    if (hours >= 1) return `${hours}h ago`
    if (minutes >= 1) return `${minutes}m ago`
    return 'Just now'
}

export default function ScoresPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const [search, setSearch] = useState('')
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [limitDialogOpen, setLimitDialogOpen] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<ScoreMeta | null>(null)
    const [importedFile, setImportedFile] = useState<ImportedScoreFile | null>(null)
    const [readingFile, setReadingFile] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const debouncedSearch = useDebouncedValue(search, 300)
    const { data: scores, isPending, error, refetch } = useScores(debouncedSearch || undefined)
    const createMutation = useCreateScore()
    const deleteMutation = useDeleteScore()
    const duplicateMutation = useDuplicateScore()

    function handleCreate(title: string, instrument: Instrument) {
        // Build the starting score through the model so a new score opens with the
        // same default measure as completing one in the editor (e.g. four quarter
        // rests in 4/4, six eighth rests in 6/8).
        const score = new Score()
        score.seedInstrument(instrument)
        const measure = score.addMeasure().complete()
        score.setTempo(measure?.firstNote, 120)
        createFromScore(title, score)
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
        const document = new ScoreSerializer(score).toInput() as unknown as Record<string, unknown>

        createMutation.mutate(
            { title, score: document },
            {
                onSuccess: (created) => router.push(`/scores/${created.id}`),
                onError: (err) => {
                    // The server refuses the create when the plan's score cap is
                    // reached — that's an upgrade conversation, not a failure toast.
                    if (err instanceof ApiError && err.code === 'score-limit') setLimitDialogOpen(true)
                    else showToast('Could not create the score. Please try again.')
                },
            },
        )
    }

    function handleDuplicate(score: ScoreMeta) {
        duplicateMutation.mutate(score.id, {
            onSuccess: (copy) => showToast(`Created “${copy.title}”.`, 'info', 'check'),
            onError: (err) => {
                // A copy is a new score, so it hits the same plan cap as a create.
                if (err instanceof ApiError && err.code === 'score-limit') setLimitDialogOpen(true)
                else showToast('Could not duplicate the score. Please try again.')
            },
        })
    }

    function handleDeleteConfirmed(score: ScoreMeta) {
        deleteMutation.mutate(score.id)
        setDeleteTarget(null)
    }

    // Worst case: the very first load can't even reach the server — there is
    // nothing useful to show, so explain it on a full page.
    if (error instanceof NetworkError && scores === undefined) {
        return (
            <ErrorScreen
                title="Can't reach the server"
                message="Solkey could not connect to its server, so your library can't be shown right now. Check your internet connection, or try again in a moment."
                onRetry={() => void refetch()}
            />
        )
    }

    return (
        <div className="bg-surface text-on-surface min-h-dvh flex flex-col">
            <TopNav user={session?.user?.name ?? undefined} onCreate={() => setCreateDialogOpen(true)} />

            <main className="flex-1 max-w-384 mx-auto px-4 sm:px-8 py-6 sm:py-10 flex flex-col gap-6 w-full box-border">
                <PageHeader
                    title="Your scores"
                    right={
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto">
                            <SecondaryButton onClick={() => fileInputRef.current?.click()} disabled={readingFile}>
                                {readingFile ? 'Reading file…' : 'Import file'}
                            </SecondaryButton>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={ScoreFileImporter.ACCEPT}
                                aria-label="Import a score file"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0]
                                    if (file) void handleImportFile(file)
                                }}
                            />
                            <div className="w-full sm:w-64">
                                <TextField value={search} onChange={setSearch} leftIcon="search" placeholder="Find a score…" />
                            </div>
                        </div>
                    }
                />

                {/* Stale results may still be on screen below (keepPreviousData) — say so rather than fail silently. */}
                {error && <Alert onRetry={() => void refetch()}>Your scores couldn&apos;t be loaded.</Alert>}
                {isPending && !error ? (
                    <EmptyCard>
                        <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                            Loading your scores…
                        </span>
                    </EmptyCard>
                ) : scores === undefined ? null : scores.length === 0 ? (
                    search ? (
                        <EmptyCard>
                            <span className="text-outline-variant">
                                <Icon name="search" size={32} />
                            </span>
                            <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                                No scores match &ldquo;{search}&rdquo;.
                            </span>
                        </EmptyCard>
                    ) : (
                        <FirstScoreEmpty onCreate={() => setCreateDialogOpen(true)} onImport={() => fileInputRef.current?.click()} />
                    )
                ) : (
                    <div role="table" aria-label="Your scores" className="flex flex-col gap-4">
                        <div role="rowgroup">
                            <div
                                role="row"
                                className="grid grid-cols-[1fr_auto] md:grid-cols-[5fr_2fr_2fr_1fr] gap-4 px-4 sm:px-6 py-2 font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
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
                                    onOpen={() => router.push(`/scores/${score.id}`)}
                                    onDuplicate={() => handleDuplicate(score)}
                                    onDelete={() => setDeleteTarget(score)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </main>

            <CreateScoreDialog
                open={createDialogOpen}
                onCancel={() => setCreateDialogOpen(false)}
                onCreate={(title, instrument) => {
                    setCreateDialogOpen(false)
                    handleCreate(title, instrument)
                }}
            />

            {importedFile && (
                <ImportScoreDialog
                    imported={importedFile}
                    onCancel={() => setImportedFile(null)}
                    onCreate={(title, score) => {
                        setImportedFile(null)
                        createFromScore(title, score)
                    }}
                />
            )}

            {limitDialogOpen && <ScoreLimitDialog onUpgrade={() => router.push('/settings')} onClose={() => setLimitDialogOpen(false)} />}

            {deleteTarget && (
                <DialogScrim onDismiss={() => setDeleteTarget(null)}>
                    <DialogPanel
                        title="Delete this score?"
                        subtitle={`“${deleteTarget.title}” will be gone for good — there's no undo.`}
                        width={440}
                        onClose={() => setDeleteTarget(null)}
                        footer={
                            <>
                                <TertiaryButton onClick={() => setDeleteTarget(null)}>Keep it</TertiaryButton>
                                <PrimaryButton danger onClick={() => handleDeleteConfirmed(deleteTarget)}>
                                    Delete score
                                </PrimaryButton>
                            </>
                        }
                    />
                </DialogScrim>
            )}

            <Footer />
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

function FirstScoreEmpty({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
    return (
        <div className="bg-surface-container-lowest rounded-md px-6 sm:px-8 py-8 sm:py-10 editorial-shadow flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-7">
            <svg viewBox="0 0 120 80" width="96" height="64" aria-hidden className="shrink-0">
                {[0, 1, 2, 3, 4].map((i) => (
                    <line key={i} x1={8} x2={112} y1={20 + i * 10} y2={20 + i * 10} stroke="var(--color-outline-variant)" strokeWidth={1} />
                ))}
                {/* Real Bravura clef — the staff spacing above matches the notation grid (10px). */}
                <Glyph name="gClef" x={16} y={50} fill="var(--color-outline)" />
            </svg>
            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                <span className="font-body font-semibold text-[16px] leading-[1.3] text-on-surface">No scores yet.</span>
                <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                    Compose your first one, or bring in a MusicXML or MIDI file.
                </span>
            </div>
            <div className="flex items-center gap-4">
                <TertiaryButton onClick={onImport}>Import a file</TertiaryButton>
                <PrimaryButton icon="plus" onClick={onCreate}>
                    New score
                </PrimaryButton>
            </div>
        </div>
    )
}

function ScoreRow({
    score,
    onOpen,
    onDuplicate,
    onDelete,
}: {
    score: ScoreMeta
    onOpen: () => void
    onDuplicate: () => void
    onDelete: () => void
}) {
    return (
        <div
            role="row"
            className={[
                'group relative overflow-hidden',
                'bg-surface-container-lowest hover:bg-surface-container-high',
                'rounded-md px-4 sm:px-6 py-4.5 editorial-shadow',
                'grid grid-cols-[1fr_auto] md:grid-cols-[5fr_2fr_2fr_1fr] gap-3 md:gap-4 items-center',
                'transition-colors duration-150 ease-solkey',
            ].join(' ')}>
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-container opacity-0 -translate-x-full group-hover:opacity-100 group-hover:translate-x-0 transition-[opacity,transform] duration-150 ease-solkey" />
            <div role="cell" className="min-w-0 flex flex-col gap-1">
                <button
                    onClick={onOpen}
                    type="button"
                    className={[
                        'text-left bg-transparent border-0 p-0 cursor-pointer',
                        'font-body font-medium text-[16px] leading-[1.3]',
                        'text-on-surface group-hover:text-primary',
                        'transition-colors duration-150 ease-solkey',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded-sm',
                    ].join(' ')}>
                    {score.title}
                </button>
                <span className="md:hidden font-body font-normal text-[12px] leading-none text-on-surface-variant">
                    {relativeTime(score.updatedAt)}
                </span>
            </div>
            <span role="cell" className="max-md:hidden font-body font-normal text-[13px] leading-none text-on-surface-variant">
                {formatDate(score.createdAt)}
            </span>
            <span role="cell" className="max-md:hidden font-body font-normal text-[13px] leading-none text-on-surface-variant">
                {relativeTime(score.updatedAt)}
            </span>
            <div role="cell" className="flex gap-2 justify-end">
                <IconButton
                    icon="pencil"
                    ariaLabel={`Edit ${score.title}`}
                    size={32}
                    idleClassName="bg-surface-container group-hover:bg-surface-container-lowest"
                    onClick={onOpen}
                />
                <IconButton
                    icon="copy"
                    ariaLabel={`Duplicate ${score.title}`}
                    size={32}
                    idleClassName="bg-surface-container group-hover:bg-surface-container-lowest"
                    onClick={onDuplicate}
                />
                <IconButton
                    icon="trash-2"
                    ariaLabel={`Delete ${score.title}`}
                    size={32}
                    hoverTone="magenta"
                    idleClassName="bg-surface-container group-hover:bg-surface-container-lowest"
                    onClick={onDelete}
                />
            </div>
        </div>
    )
}
