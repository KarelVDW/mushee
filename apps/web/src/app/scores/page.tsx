'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { createScore, deleteScore, listScores, type ScoreMeta } from '@/lib/api'
import { signOut, useSession } from '@/lib/auth-client'

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
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
        fetchScores()
    }, [fetchScores])

    useEffect(() => {
        const timeout = setTimeout(() => {
            fetchScores(search || undefined)
        }, 300)
        return () => clearTimeout(timeout)
    }, [search, fetchScores])

    async function handleCreate() {
        const title = prompt('Score title:')
        if (!title) return

        const emptyScore = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [{
                id: 'P1',
                measures: [{
                    number: '1',
                    entries: [
                        { _type: 'attributes', divisions: 12, clef: [{ sign: 'G', line: 2 }], time: [{ beats: '4', beatType: '4' }] },
                        { _type: 'note', duration: 48, voice: '1', type: 'whole' },
                    ],
                }],
            }],
        }

        const created = await createScore(title, emptyScore)
        router.push(`/scores/${created.id}`)
    }

    async function handleDelete(id: string, title: string) {
        if (!confirm(`Delete "${title}"?`)) return
        await deleteScore(id)
        setScores((prev) => prev.filter((s) => s.id !== id))
    }

    async function handleSignOut() {
        await signOut()
        router.push('/login')
    }

    return (
        <div className="bg-surface text-on-surface min-h-screen flex flex-col antialiased selection:bg-primary-container selection:text-on-primary-container">
            {/* Top Nav */}
            <nav className="sticky top-0 z-50 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow">
                <div className="flex justify-between items-center w-full px-8 py-[1.2rem] max-w-[1536px] mx-auto">
                    <div className="flex items-center gap-[1.6rem]">
                        <Link href="/scores" className="text-[1.8rem] font-black tracking-tighter text-on-surface italic">
                            Sheemu
                        </Link>
                    </div>

                    <div className="hidden md:flex items-center gap-[1.6rem] uppercase tracking-widest text-[0.6rem] font-bold">
                        <span className="text-on-surface-variant hover:text-secondary transition-colors cursor-not-allowed">Editor</span>
                        <span className="text-primary border-b-[3px] border-primary-container pb-[0.2rem]">Library</span>
                        <span className="text-on-surface-variant hover:text-secondary transition-colors cursor-not-allowed">Community</span>
                        <span className="text-on-surface-variant hover:text-secondary transition-colors cursor-not-allowed">Collaborate</span>
                    </div>

                    <div className="flex items-center gap-[0.8rem]">
                        {session?.user?.name && (
                            <span className="hidden md:inline text-[0.6rem] uppercase tracking-widest text-on-surface-variant font-bold">
                                {session.user.name}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => void handleSignOut()}
                            className="hidden md:block text-on-surface font-bold text-[0.6rem] uppercase tracking-widest hover:text-secondary transition-colors">
                            Sign Out
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleCreate()}
                            className="bg-primary-container text-white rounded-full px-[1.2rem] py-[0.4rem] font-bold text-[0.6rem] uppercase tracking-widest shadow-[3px_3px_0px_0px_var(--color-secondary-container)] hover:shadow-[5px_5px_0px_0px_var(--color-secondary-container)] hover:-translate-y-[2px] transition-all">
                            Create New
                        </button>
                    </div>
                </div>
            </nav>

            {/* Main */}
            <main className="flex-grow w-full max-w-[1536px] mx-auto px-[1.2rem] md:px-8 py-[2.4rem] flex flex-col gap-[1.6rem]">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-end gap-[1.2rem] pb-[1.2rem]">
                    <div>
                        <h1 className="text-[2.8rem] font-black leading-none tracking-[-0.04em] text-on-surface uppercase mb-[0.4rem]">My Scores</h1>
                        <p className="text-on-surface-variant text-[0.9rem]">Manage and edit your composed pieces.</p>
                    </div>
                    <div className="w-full md:w-auto flex gap-[0.8rem]">
                        <div className="input-field-container bg-surface-container-low rounded flex items-center w-full md:w-[16rem] relative">
                            <span className="material-symbols-outlined text-outline absolute left-[0.6rem] pointer-events-none" style={{ fontSize: '19px' }}>search</span>
                            <input
                                className="input-field bg-transparent text-on-surface text-[0.9rem] py-[0.6rem] pl-[2rem] pr-[0.8rem] w-full placeholder-on-surface-variant/50"
                                placeholder="Filter scores by name..."
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Scores List */}
                <div className="flex flex-col gap-[0.8rem]">
                    {/* List Header */}
                    <div className="hidden md:grid grid-cols-12 gap-[0.8rem] px-[1.2rem] py-[0.6rem] text-[0.6rem] uppercase tracking-widest text-outline-variant font-bold">
                        <div className="col-span-5">Name</div>
                        <div className="col-span-3">Created At</div>
                        <div className="col-span-2">Updated At</div>
                        <div className="col-span-2 text-right">Actions</div>
                    </div>

                    {loading ? (
                        <div className="bg-surface-container-lowest rounded-lg p-[1.2rem] tonal-layer-glow text-[0.7rem] text-on-surface-variant uppercase tracking-widest font-bold">
                            Loading…
                        </div>
                    ) : scores.length === 0 ? (
                        <div className="bg-surface-container-lowest rounded-lg p-[2.4rem] tonal-layer-glow text-center">
                            <p className="text-on-surface-variant text-[0.9rem]">
                                {search ? 'No scores match your filter.' : 'No scores yet. Compose your first one.'}
                            </p>
                        </div>
                    ) : (
                        scores.map((score) => (
                            <div
                                key={score.id}
                                className="group bg-surface-container-lowest rounded-lg p-[1.2rem] tonal-layer-glow hover:shadow-[0px_6px_26px_0px_rgba(45,47,47,0.12)] transition-all duration-300 grid grid-cols-1 md:grid-cols-12 gap-[0.8rem] items-center relative overflow-hidden">
                                {/* Hover accent indicator */}
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-container opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                <button
                                    type="button"
                                    onClick={() => router.push(`/scores/${score.id}`)}
                                    className="col-span-1 md:col-span-5 flex flex-col gap-[0.2rem] text-left">
                                    <span className="text-base font-bold text-on-surface group-hover:text-primary transition-colors">
                                        {score.title}
                                    </span>
                                </button>

                                <div className="col-span-1 md:col-span-3 flex flex-col md:block">
                                    <span className="md:hidden text-[0.6rem] uppercase text-outline-variant mb-[0.2rem]">Created At</span>
                                    <span className="text-on-surface-variant text-[0.7rem]">{formatDate(score.createdAt)}</span>
                                </div>

                                <div className="col-span-1 md:col-span-2 flex flex-col md:block">
                                    <span className="md:hidden text-[0.6rem] uppercase text-outline-variant mb-[0.2rem]">Updated At</span>
                                    <span className="text-on-surface-variant text-[0.7rem]">{relativeTime(score.updatedAt)}</span>
                                </div>

                                <div className="col-span-1 md:col-span-2 flex items-center justify-start md:justify-end gap-[0.4rem] mt-[0.8rem] md:mt-0">
                                    <button
                                        type="button"
                                        aria-label="Edit"
                                        onClick={() => router.push(`/scores/${score.id}`)}
                                        className="w-8 h-8 rounded-full bg-surface-container-high hover:bg-primary-container hover:text-on-primary-container text-on-surface flex items-center justify-center transition-all shadow-[3px_3px_0px_0px_var(--color-secondary)]">
                                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Delete"
                                        onClick={() => void handleDelete(score.id, score.title)}
                                        className="w-8 h-8 rounded-full bg-surface-container-high hover:bg-secondary-container hover:text-on-secondary text-on-surface flex items-center justify-center transition-all shadow-[3px_3px_0px_0px_var(--color-secondary)]">
                                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </main>

            {/* Footer */}
            <footer className="bg-surface w-full py-[2.4rem] ghost-border border-x-0 border-b-0">
                <div className="flex flex-col md:flex-row justify-between items-center px-[2.4rem] gap-[1.2rem] max-w-[1536px] mx-auto">
                    <div className="text-base font-bold text-on-surface">Sheemu</div>
                    <div className="text-[0.7rem] text-secondary font-medium uppercase tracking-widest">
                        © 2024 Sheemu. Boldly Composed.
                    </div>
                </div>
            </footer>
        </div>
    )
}
