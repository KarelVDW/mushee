'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { createScore, deleteScore, listScores, type ScoreMeta } from '@/lib/api'
import { signOut, useSession } from '@/lib/auth-client'

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
        <div className="min-h-screen bg-gray-50">
            <header className="border-b border-gray-200 bg-white px-6 py-3">
                <div className="mx-auto flex max-w-4xl items-center justify-between">
                    <h1 className="text-lg font-semibold text-gray-900">Mushee</h1>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">{session?.user?.name}</span>
                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="text-sm text-gray-500 hover:text-gray-700"
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-4xl px-6 py-8">
                <div className="mb-6 flex items-center gap-4">
                    <input
                        type="text"
                        placeholder="Search scores..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                        type="button"
                        onClick={handleCreate}
                        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                        New score
                    </button>
                </div>

                {loading ? (
                    <p className="text-sm text-gray-500">Loading...</p>
                ) : scores.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
                        <p className="text-gray-500">
                            {search ? 'No scores match your search.' : 'No scores yet. Create your first one!'}
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
                        {scores.map((score) => (
                            <li key={score.id} className="flex items-center justify-between px-4 py-3">
                                <button
                                    type="button"
                                    onClick={() => router.push(`/scores/${score.id}`)}
                                    className="flex-1 text-left"
                                >
                                    <span className="font-medium text-gray-900">{score.title}</span>
                                    <span className="ml-3 text-xs text-gray-400">
                                        {new Date(score.updatedAt).toLocaleDateString()}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(score.id, score.title)}
                                    className="ml-4 text-sm text-red-500 hover:text-red-700"
                                >
                                    Delete
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </main>
        </div>
    )
}
