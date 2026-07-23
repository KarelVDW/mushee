'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'

import { AdminShell, PageHeading } from '@/components/AdminShell'
import { Alert, Eyebrow, Pill, PrimaryButton, SecondaryButton, showToast, TextField } from '@/components/ui'
import { formatCount, formatDate, formatDateTime, formatSeconds } from '@/lib/format'
import { useAdjustCredits, useRevokeSessions, useUser, useUserScores } from '@/lib/queries'

export default function UserDetailPage() {
    const { id } = useParams<{ id: string }>()
    const user = useUser(id)

    return (
        <AdminShell>
            <div className="mb-6">
                <Link
                    href="/users"
                    className="font-body font-medium text-[13px] no-underline text-on-surface-variant hover:text-primary transition-colors duration-150 ease-solkey">
                    ← All users
                </Link>
            </div>

            {user.isError && <Alert onRetry={() => void user.refetch()}>Couldn&apos;t load this user.</Alert>}

            {user.data && (
                <>
                    <PageHeading eyebrow="User" title={user.data.user.name || user.data.user.email}>
                        <span className="inline-flex flex-wrap gap-1.5">
                            {user.data.user.role === 'admin' && <Pill tone="magenta">Admin</Pill>}
                            {user.data.user.betaStatus === 'pending' && <Pill>Waitlist</Pill>}
                            {user.data.user.betaStatus === 'approved' && <Pill tone="cyan">Beta</Pill>}
                            {!user.data.user.emailVerified && <Pill>Unverified</Pill>}
                        </span>
                    </PageHeading>

                    {user.data.deletion && (
                        <div className="mb-6">
                            <Alert>
                                Account deletion requested {formatDateTime(user.data.deletion.requestedAt)} — data is purged after{' '}
                                {formatDateTime(user.data.deletion.purgeAfter)}.
                            </Alert>
                        </div>
                    )}

                    <div className="grid lg:grid-cols-2 gap-4 mb-4">
                        <Card title="Profile">
                            <FieldRow label="Email" value={user.data.user.email} />
                            <FieldRow label="User ID" value={user.data.user.id} mono />
                            <FieldRow label="Signed up" value={formatDateTime(user.data.user.createdAt)} />
                            <FieldRow
                                label="Onboarding"
                                value={
                                    user.data.onboarding
                                        ? [
                                              user.data.onboarding.background,
                                              user.data.onboarding.goal,
                                              user.data.onboarding.instruments?.join(', '),
                                              user.data.onboarding.source,
                                          ]
                                              .filter(Boolean)
                                              .join(' · ') || 'Started'
                                        : 'Not started'
                                }
                            />
                        </Card>

                        <Card title="Plan & billing">
                            <FieldRow label="Plan" value={user.data.credits.tierName} />
                            <FieldRow label="Subscription status" value={user.data.subscription?.status ?? 'No subscription row'} />
                            <FieldRow
                                label="Current period ends"
                                value={
                                    user.data.subscription?.currentPeriodEnd
                                        ? `${formatDate(user.data.subscription.currentPeriodEnd)}${user.data.subscription.cancelAtPeriodEnd ? ' (cancels)' : ''}`
                                        : '—'
                                }
                            />
                            <FieldRow label="Polar customer" value={user.data.subscription?.polarCustomerId ?? '—'} mono />
                        </Card>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-4 mb-4">
                        <Card title="Recording credits">
                            <FieldRow
                                label="Daily budget"
                                value={
                                    user.data.credits.dailyLimit === null
                                        ? 'Unlimited'
                                        : `${formatSeconds(user.data.credits.usedToday)} used of ${formatSeconds(user.data.credits.dailyLimit)} today`
                                }
                            />
                            <FieldRow label="Pack minutes left" value={formatSeconds(user.data.credits.packSeconds)} />
                            <FieldRow label="All-time recorded" value={formatSeconds(user.data.counts.recordingSeconds)} />
                            <GrantMinutes userId={id} />
                        </Card>

                        <Card title="Sessions">
                            {user.data.sessions.length === 0 && <p className="font-body text-[13px] text-on-surface-variant m-0">No active sessions.</p>}
                            {user.data.sessions.map((session) => (
                                <FieldRow
                                    key={session.id}
                                    label={formatDateTime(session.updatedAt)}
                                    value={`${session.ipAddress ?? 'unknown ip'} · ${shortAgent(session.userAgent)}`}
                                />
                            ))}
                            {user.data.sessions.length > 0 && <RevokeSessions userId={id} />}
                        </Card>
                    </div>

                    <UserScores userId={id} scoreCount={user.data.counts.scoreCount} />

                    <Card title={`Recent recordings (${formatCount(user.data.counts.recordingCount)} total)`}>
                        {user.data.recordings.length === 0 && (
                            <p className="font-body text-[13px] text-on-surface-variant m-0">No recordings yet.</p>
                        )}
                        {user.data.recordings.map((recording) => (
                            <FieldRow
                                key={recording.id}
                                label={formatDateTime(recording.createdAt)}
                                value={`${recording.scoreTitle ?? 'Deleted score'} · ${formatSeconds(recording.creditsSpent)}${recording.endedAt ? '' : ' · still open'}`}
                            />
                        ))}
                    </Card>
                </>
            )}
        </AdminShell>
    )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4">
            <Eyebrow className="block mb-3">{title}</Eyebrow>
            <div className="flex flex-col gap-2.5">{children}</div>
        </section>
    )
}

function FieldRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="grid grid-cols-[11rem_1fr] gap-3 items-baseline">
            <span className="font-body text-[12px] leading-snug text-on-surface-variant">{label}</span>
            <span className={`${mono ? 'font-mono text-[12px]' : 'font-body text-[13px]'} leading-snug text-on-surface break-all`}>
                {value}
            </span>
        </div>
    )
}

function shortAgent(userAgent: string | null): string {
    if (!userAgent) return 'unknown device'
    if (userAgent.includes('iPhone')) return 'iPhone'
    if (userAgent.includes('Android')) return 'Android'
    if (userAgent.includes('Macintosh')) return 'Mac'
    if (userAgent.includes('Windows')) return 'Windows'
    if (userAgent.includes('Linux')) return 'Linux'
    return userAgent.slice(0, 40)
}

/** Support action: top up (or claw back) pack minutes. */
function GrantMinutes({ userId }: { userId: string }) {
    const [minutes, setMinutes] = useState('')
    const adjust = useAdjustCredits(userId)
    const parsed = Number(minutes)
    const valid = Number.isInteger(parsed) && parsed !== 0

    const apply = () => {
        if (!valid) return
        adjust.mutate(parsed * 60, {
            onSuccess: () => {
                showToast(`${parsed > 0 ? 'Granted' : 'Removed'} ${Math.abs(parsed)} pack minutes.`, 'info')
                setMinutes('')
            },
        })
    }

    return (
        <div className="flex items-end gap-3 pt-2">
            <div className="w-40">
                <TextField
                    label="Adjust pack minutes"
                    value={minutes}
                    onChange={setMinutes}
                    placeholder="e.g. 30 or -30"
                    hint="Negative removes minutes"
                />
            </div>
            <div className="pb-6">
                <SecondaryButton onClick={apply} disabled={!valid || adjust.isPending}>
                    Apply
                </SecondaryButton>
            </div>
        </div>
    )
}

/** Support action: sign the user out everywhere. */
function RevokeSessions({ userId }: { userId: string }) {
    const revoke = useRevokeSessions(userId)
    const [confirming, setConfirming] = useState(false)

    if (!confirming) {
        return (
            <div className="pt-2">
                <SecondaryButton onClick={() => setConfirming(true)}>Sign out everywhere…</SecondaryButton>
            </div>
        )
    }
    return (
        <div className="flex items-center gap-3 pt-2">
            <PrimaryButton
                danger
                disabled={revoke.isPending}
                onClick={() =>
                    revoke.mutate(undefined, {
                        onSuccess: (result) => {
                            showToast(`Revoked ${result.revoked} session${result.revoked === 1 ? '' : 's'}.`, 'info')
                            setConfirming(false)
                        },
                    })
                }>
                Revoke all sessions
            </PrimaryButton>
            <SecondaryButton onClick={() => setConfirming(false)}>Cancel</SecondaryButton>
        </div>
    )
}

function UserScores({ userId, scoreCount }: { userId: string; scoreCount: number }) {
    const router = useRouter()
    const scores = useUserScores(userId)

    return (
        <div className="mb-4">
            <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4">
                <Eyebrow className="block mb-3">Scores ({formatCount(scoreCount)})</Eyebrow>
                {scores.isError && <Alert onRetry={() => void scores.refetch()}>Couldn&apos;t load the scores.</Alert>}
                {scores.data && scores.data.length === 0 && (
                    <p className="font-body text-[13px] text-on-surface-variant m-0">No scores yet.</p>
                )}
                {scores.data && scores.data.length > 0 && (
                    <div className="flex flex-col">
                        {scores.data.map((score) => (
                            <button
                                key={score.id}
                                type="button"
                                onClick={() => router.push(`/scores/${score.id}`)}
                                className={[
                                    'grid grid-cols-[1fr_auto_auto] items-center gap-4 text-left cursor-pointer',
                                    'border-0 bg-transparent rounded-md px-3 py-2.5 -mx-3',
                                    'hover:bg-surface-container-high transition-colors duration-150 ease-solkey',
                                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                                ].join(' ')}>
                                <span className="font-body font-medium text-[14px] leading-tight text-on-surface truncate">
                                    {score.title}
                                </span>
                                {score.hotEdits ? <Pill tone="cyan">Editing</Pill> : <span />}
                                <span className="font-body text-[12px] leading-none text-on-surface-variant">
                                    {formatDate(score.updatedAt)}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}
