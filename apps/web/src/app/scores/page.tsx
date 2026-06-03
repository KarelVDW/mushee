'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { Footer, Icon, IconButton, PageHeader, PrimaryButton, TextField, TopNav } from '@/components/ui'
import { createScore, deleteScore, listScores, type ScoreMeta } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { Instrument, Score } from '@/model'
import { ScoreSerializer } from '@/model/util/ScoreSerializer'

import { CreateScoreDialog } from './CreateScoreDialog'

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
    const [scores, setScores] = useState<ScoreMeta[]>([])
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [createDialogOpen, setCreateDialogOpen] = useState(false)

    const fetchScores = useCallback(async (query?: string) => {
        setLoading(true)
        try {
            const data = await listScores(query)
            setScores(data)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void fetchScores()
    }, [fetchScores])

    useEffect(() => {
        const timeout = setTimeout(() => {
            void fetchScores(search || undefined)
        }, 300)
        return () => clearTimeout(timeout)
    }, [search, fetchScores])

    async function handleCreate(title: string, instrument: Instrument) {
        // Build the starting score through the model so a new score opens with the
        // same default measure as completing one in the editor (e.g. four quarter
        // rests in 4/4, six eighth rests in 6/8).
        const score = new Score()
        score.seedInstrument(instrument)
        const measure = score.addMeasure().complete()
        score.setTempo(measure?.firstNote, 120)
        const emptyScore = new ScoreSerializer(score).toInput() as unknown as Record<string, unknown>

        const created = await createScore(title, emptyScore)
        router.push(`/scores/${created.id}`)
    }

    async function handleDelete(id: string, title: string) {
        if (!confirm(`Delete "${title}"?`)) return
        await deleteScore(id)
        setScores((prev) => prev.filter((s) => s.id !== id))
    }

    return (
        <div className="bg-surface text-on-surface min-h-screen flex flex-col">
            <TopNav user={session?.user?.name ?? undefined} onCreate={() => setCreateDialogOpen(true)} />

            <main className="flex-1 max-w-7xl mx-auto px-8 py-10 flex flex-col gap-6 w-full box-border">
                <PageHeader
                    title="Your scores"
                    subtitle="A quiet shelf for everything you're working on."
                    right={
                        <div className="w-64">
                            <TextField value={search} onChange={setSearch} leftIcon="search" placeholder="Find a score…" />
                        </div>
                    }
                />

                {/* Column headers */}
                <div className="grid grid-cols-[5fr_2fr_2fr_1fr] gap-4 px-6 py-2 font-label font-semibold text-[11px] leading-none tracking-widest uppercase text-outline">
                    <span>Title</span>
                    <span>Created</span>
                    <span>Updated</span>
                    <span />
                </div>

                <div className="flex flex-col gap-3">
                    {loading ? (
                        <EmptyCard>
                            <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                                Loading your scores…
                            </span>
                        </EmptyCard>
                    ) : scores.length === 0 ? (
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
                            <FirstScoreEmpty onCreate={() => setCreateDialogOpen(true)} />
                        )
                    ) : (
                        scores.map((score) => (
                            <ScoreRow
                                key={score.id}
                                score={score}
                                onOpen={() => router.push(`/scores/${score.id}`)}
                                onDelete={() => void handleDelete(score.id, score.title)}
                            />
                        ))
                    )}
                </div>
            </main>

            <CreateScoreDialog
                open={createDialogOpen}
                onCancel={() => setCreateDialogOpen(false)}
                onCreate={(title, instrument) => {
                    setCreateDialogOpen(false)
                    void handleCreate(title, instrument)
                }}
            />

            <Footer />
        </div>
    )
}

function EmptyCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-surface-container-lowest rounded-md p-14 editorial-shadow text-center flex flex-col gap-3 items-center">
            {children}
        </div>
    )
}

function FirstScoreEmpty({ onCreate }: { onCreate: () => void }) {
    return (
        <div className="bg-surface-container-lowest rounded-md px-8 py-10 editorial-shadow flex items-center gap-7">
            <svg viewBox="0 0 120 80" width="96" height="64" aria-hidden className="shrink-0">
                {[0, 1, 2, 3, 4].map((i) => (
                    <line key={i} x1={8} x2={112} y1={20 + i * 10} y2={20 + i * 10} stroke="var(--color-outline-variant)" strokeWidth={1} />
                ))}
                <text x={12} y={56} fontFamily="serif" fontSize={42} fill="var(--color-outline)">
                    𝄞
                </text>
            </svg>
            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                <span className="font-body font-semibold text-[16px] leading-[1.3] text-on-surface">No scores yet.</span>
                <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                    Compose your first one — it&apos;ll show up on this shelf.
                </span>
            </div>
            <PrimaryButton icon="plus" onClick={onCreate}>
                New score
            </PrimaryButton>
        </div>
    )
}

function ScoreRow({ score, onOpen, onDelete }: { score: ScoreMeta; onOpen: () => void; onDelete: () => void }) {
    return (
        <div
            className={[
                'group relative overflow-hidden',
                'bg-surface-container-lowest hover:bg-surface-container-high',
                'rounded-md px-6 py-4.5 editorial-shadow',
                'grid grid-cols-[5fr_2fr_2fr_1fr] gap-4 items-center',
                'transition-colors duration-200 ease-sheemu',
            ].join(' ')}>
            <div className="absolute left-0 top-0 bottom-0 w-0.75 bg-primary-container opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-sheemu" />
            <button
                onClick={onOpen}
                type="button"
                className={[
                    'text-left bg-transparent border-0 p-0 cursor-pointer',
                    'font-body font-medium text-[16px] leading-[1.3]',
                    'text-on-surface group-hover:text-primary',
                    'transition-colors duration-200 ease-sheemu',
                ].join(' ')}>
                {score.title}
            </button>
            <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">{formatDate(score.createdAt)}</span>
            <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">{relativeTime(score.updatedAt)}</span>
            <div className="flex gap-2 justify-end">
                <IconButton
                    icon="pencil"
                    ariaLabel="Edit"
                    size={28}
                    idleClassName="bg-surface-container group-hover:bg-surface-container-lowest"
                    onClick={onOpen}
                />
                <IconButton
                    icon="trash-2"
                    ariaLabel="Delete"
                    size={28}
                    hoverTone="magenta"
                    idleClassName="bg-surface-container group-hover:bg-surface-container-lowest"
                    onClick={onDelete}
                />
            </div>
        </div>
    )
}
