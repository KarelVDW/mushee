'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { AdminShell, PageHeading } from '@/components/AdminShell'
import { Alert, Pill, SecondaryButton, TextField } from '@/components/ui'
import { formatCount, formatDate } from '@/lib/format'
import { useUsers } from '@/lib/queries'

export default function UsersPage() {
    const router = useRouter()
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const users = useUsers(search, page)

    const totalPages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.pageSize)) : 1

    return (
        <AdminShell>
            <PageHeading eyebrow="Accounts" title="Users">
                {users.data && (
                    <span className="font-mono text-[13px] leading-none text-on-surface-variant">
                        {formatCount(users.data.total)} total
                    </span>
                )}
            </PageHeading>

            <div className="max-w-md mb-6">
                <TextField
                    value={search}
                    onChange={(value) => {
                        setSearch(value)
                        setPage(1)
                    }}
                    placeholder="Search by name or email…"
                    leftIcon="search"
                />
            </div>

            {users.isError && <Alert onRetry={() => void users.refetch()}>Couldn&apos;t load users.</Alert>}

            {users.data && users.data.users.length === 0 && (
                <p className="font-body text-[14px] text-on-surface-variant">No users match &ldquo;{search}&rdquo;.</p>
            )}

            {users.data && users.data.users.length > 0 && (
                <div className="bg-surface-container-lowest rounded-lg tonal-layer-glow overflow-x-auto">
                    <table className="w-full border-collapse min-w-180">
                        <thead>
                            <tr className="text-left">
                                {['User', 'Plan', 'Scores', 'Signed up', 'Last active', 'Status'].map((heading) => (
                                    <th
                                        key={heading}
                                        className="bg-surface-container-low font-label font-semibold text-[11px] tracking-[0.12em] uppercase text-on-surface-variant px-4 py-3">
                                        {heading}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {users.data.users.map((user) => (
                                <tr
                                    key={user.id}
                                    onClick={() => router.push(`/users/${user.id}`)}
                                    className="cursor-pointer hover:bg-surface-container-high transition-colors duration-150 ease-solkey">
                                    <td className="px-4 py-3">
                                        <span className="block font-body font-medium text-[14px] leading-tight text-on-surface">
                                            {user.name || '—'}
                                        </span>
                                        <span className="block font-body text-[12px] leading-tight text-on-surface-variant">
                                            {user.email}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-body text-[13px] text-on-surface">{user.tierName}</td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-on-surface-variant">{user.scoreCount}</td>
                                    <td className="px-4 py-3 font-body text-[13px] text-on-surface-variant">{formatDate(user.createdAt)}</td>
                                    <td className="px-4 py-3 font-body text-[13px] text-on-surface-variant">
                                        {formatDate(user.lastActiveAt)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="inline-flex flex-wrap gap-1.5">
                                            {user.role === 'admin' && <Pill tone="magenta">Admin</Pill>}
                                            {user.betaStatus === 'pending' && <Pill>Waitlist</Pill>}
                                            {user.betaStatus === 'approved' && <Pill tone="cyan">Beta</Pill>}
                                            {user.deletionRequested && <Pill tone="magenta">Deleting</Pill>}
                                            {!user.emailVerified && <Pill>Unverified</Pill>}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {users.data && totalPages > 1 && (
                <div className="flex items-center justify-between mt-5">
                    <SecondaryButton disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        Previous
                    </SecondaryButton>
                    <span className="font-mono text-[13px] text-on-surface-variant">
                        Page {users.data.page} of {totalPages}
                    </span>
                    <SecondaryButton disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                        Next
                    </SecondaryButton>
                </div>
            )}
        </AdminShell>
    )
}
