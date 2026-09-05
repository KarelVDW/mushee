'use client'

import { useEffect, useState } from 'react'

import { AdminShell, PageHeading } from '@/components/AdminShell'
import { Alert, Eyebrow, Pill, PrimaryButton, SecondaryButton, TertiaryButton, TextArea, TextField } from '@/components/ui'
import { audienceCsvUrl, type AudienceFilter, type BetaStatusFilter } from '@/lib/api'
import { formatCount, formatDateTime } from '@/lib/format'
import { useAnnouncementPreview, useAnnouncements, useAudience, useSendAnnouncement, useTiers } from '@/lib/queries'

const BETA_OPTIONS: Array<{ value: BetaStatusFilter; label: string }> = [
    { value: 'any', label: 'Any' },
    { value: 'pending', label: 'Waitlisted' },
    { value: 'approved', label: 'Approved beta' },
    { value: 'none', label: 'Never in beta' },
]

/**
 * Service announcements to filtered accounts ("the beta ends on …", terms
 * changes, planned downtime): pick the audience, write the message, send one
 * test copy to yourself, then send for real — every send lands in the history
 * below. Marketing-shaped mail (newsletters, promos) is deliberately NOT sent
 * from here: export the same audience as CSV and run it through SendGrid
 * Marketing Campaigns, where contact lists, unsubscribe groups and stats live.
 */
export default function AnnouncementsPage() {
    const [filters, setFilters] = useState<AudienceFilter>({ betaStatus: 'any' })
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [testTo, setTestTo] = useState('')
    const [confirming, setConfirming] = useState(false)
    const [lastSent, setLastSent] = useState<string | null>(null)
    const [partial, setPartial] = useState<string | null>(null)

    // Preview lags the keystrokes by 400 ms so the API renders once per pause, not per character.
    const [draft, setDraft] = useState({ subject: '', body: '' })
    useEffect(() => {
        const t = setTimeout(() => setDraft({ subject, body }), 400)
        return () => clearTimeout(t)
    }, [subject, body])
    const preview = useAnnouncementPreview(draft.subject, draft.body)
    const [previewMode, setPreviewMode] = useState<'html' | 'text'>('html')

    const tiers = useTiers()
    const audience = useAudience(filters)
    const history = useAnnouncements()
    const send = useSendAnnouncement()

    const total = audience.data?.total ?? 0
    const ready = subject.trim().length >= 3 && body.trim().length >= 10
    const toggleTier = (id: string) => {
        const current = filters.tiers ?? []
        setFilters({ ...filters, tiers: current.includes(id) ? current.filter((t) => t !== id) : [...current, id] })
    }

    const sendTest = () => send.mutate({ subject, body, filters, testTo }, { onSuccess: () => setLastSent(`Test copy sent to ${testTo}.`) })
    const sendReal = () =>
        send.mutate(
            { subject, body, filters },
            {
                onSuccess: (result) => {
                    setConfirming(false)
                    setLastSent(`Sent to ${formatCount(result.recipientCount)} ${result.recipientCount === 1 ? 'account' : 'accounts'}.`)
                    setPartial(
                        result.failedCount > 0
                            ? `SendGrid rejected ${formatCount(result.failedCount)} of them — those accounts did not get the mail (${result.errors.join('; ')}). The ${formatCount(result.recipientCount)} above already have it, so check SendGrid before re-sending.`
                            : null,
                    )
                },
            },
        )

    return (
        <AdminShell>
            <PageHeading eyebrow="Communication" title="Announcements" />

            <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start">
                <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 flex flex-col gap-4">
                    <Eyebrow>Audience</Eyebrow>
                    <div className="flex flex-col gap-2">
                        <span className="font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                            Plans
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {(tiers.data ?? []).map((tier) => {
                                const active = filters.tiers?.includes(tier.id) ?? false
                                return (
                                    <button
                                        key={tier.id}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => toggleTier(tier.id)}
                                        className={[
                                            'rounded-full px-3 py-1.5 border-0 cursor-pointer font-label font-semibold text-[12px] leading-none',
                                            'transition-colors duration-150 ease-solkey',
                                            active
                                                ? 'bg-secondary-soft text-on-secondary-soft'
                                                : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high',
                                        ].join(' ')}>
                                        {tier.name}
                                    </button>
                                )
                            })}
                            {!filters.tiers?.length && (
                                <span className="font-body text-[12px] text-on-surface-variant self-center">all plans</span>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <span className="font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                            Beta status
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {BETA_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={(filters.betaStatus ?? 'any') === option.value}
                                    onClick={() => setFilters({ ...filters, betaStatus: option.value })}
                                    className={[
                                        'rounded-full px-3 py-1.5 border-0 cursor-pointer font-label font-semibold text-[12px] leading-none transition-colors duration-150 ease-solkey',
                                        (filters.betaStatus ?? 'any') === option.value
                                            ? 'bg-secondary-soft text-on-secondary-soft'
                                            : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high',
                                    ].join(' ')}>
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <TextField
                            label="Signed up after"
                            type="date"
                            value={filters.signedUpAfter?.slice(0, 10) ?? ''}
                            onChange={(v) => setFilters({ ...filters, signedUpAfter: v ? `${v}T00:00:00.000Z` : undefined })}
                        />
                        <TextField
                            label="Signed up before"
                            type="date"
                            value={filters.signedUpBefore?.slice(0, 10) ?? ''}
                            onChange={(v) => setFilters({ ...filters, signedUpBefore: v ? `${v}T00:00:00.000Z` : undefined })}
                        />
                        <TextField
                            label="Active in the last N days"
                            type="number"
                            value={filters.activeWithinDays ? String(filters.activeWithinDays) : ''}
                            onChange={(v) =>
                                setFilters({ ...filters, activeWithinDays: Number(v) > 0 ? Math.floor(Number(v)) : undefined })
                            }
                            placeholder="any"
                        />
                        <label className="flex items-center gap-2 self-end font-body text-[13px] text-on-surface cursor-pointer">
                            <input
                                type="checkbox"
                                checked={filters.verifiedOnly ?? false}
                                onChange={(e) => setFilters({ ...filters, verifiedOnly: e.target.checked })}
                            />
                            Verified e-mail only
                        </label>
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
                        <div className="flex flex-col gap-1">
                            <span className="font-mono text-[22px] leading-none text-on-surface">
                                {audience.isPending ? '…' : formatCount(total)}
                            </span>
                            <span className="font-body text-[12px] text-on-surface-variant">
                                {total === 1 ? 'account' : 'accounts'} match
                                {audience.data?.sample.length ? ` · e.g. ${audience.data.sample.map((s) => s.email).join(', ')}` : ''}
                            </span>
                        </div>
                        <a href={audienceCsvUrl(filters)} className="no-underline">
                            <SecondaryButton onClick={() => undefined}>Export CSV</SecondaryButton>
                        </a>
                    </div>
                    {audience.isError && <Alert onRetry={() => void audience.refetch()}>Couldn&apos;t count the audience.</Alert>}
                    <p className="m-0 font-body text-[12px] leading-normal text-on-surface-variant">
                        Announcements are service e-mail (no unsubscribe link). For newsletters or promotions, export the CSV and use
                        SendGrid Marketing Campaigns, which handles consent, unsubscribes and stats.
                    </p>
                </section>

                <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 flex flex-col gap-4">
                    <Eyebrow>Message</Eyebrow>
                    <TextField label="Subject" value={subject} onChange={setSubject} placeholder="The Solkey beta ends on 1 October" />
                    <TextArea
                        label="Body — blank lines separate paragraphs; {{name}} = first name; **bold** and [label](https://link) work"
                        value={body}
                        onChange={setBody}
                        rows={10}
                        placeholder={'Hi {{name}},\n\nOn 1 October the closed beta ends and Solkey opens to everyone…'}
                    />
                    {preview.data && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <Eyebrow>Preview · as Ada will see it</Eyebrow>
                                <div className="flex gap-1">
                                    {(['html', 'text'] as const).map((mode) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            aria-pressed={previewMode === mode}
                                            onClick={() => setPreviewMode(mode)}
                                            className={[
                                                'rounded-full px-3 py-1 border-0 cursor-pointer font-label font-semibold text-[11px] leading-none transition-colors duration-150 ease-solkey',
                                                previewMode === mode
                                                    ? 'bg-secondary-soft text-on-secondary-soft'
                                                    : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high',
                                            ].join(' ')}>
                                            {mode === 'html' ? 'E-mail' : 'Plain text'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="font-body font-medium text-[13px] text-on-surface">Subject: {preview.data.subject}</div>
                            {previewMode === 'html' ? (
                                // The rendered mail in a sandboxed frame: nothing in it can run or reach the console.
                                <iframe
                                    title="E-mail preview"
                                    sandbox=""
                                    srcDoc={preview.data.html}
                                    className="w-full h-105 rounded-md border-0 bg-white"
                                />
                            ) : (
                                <pre className="m-0 whitespace-pre-wrap rounded-md bg-surface-container-low p-4 font-mono text-[12px] leading-relaxed text-on-surface">
                                    {preview.data.text}
                                </pre>
                            )}
                        </div>
                    )}
                    <div className="flex items-end gap-3 flex-wrap">
                        <div className="flex-1 min-w-60">
                            <TextField
                                label="Send a test copy to"
                                type="email"
                                value={testTo}
                                onChange={setTestTo}
                                placeholder="you@solkey.io"
                            />
                        </div>
                        <SecondaryButton onClick={sendTest} disabled={!ready || !testTo.includes('@') || send.isPending}>
                            {send.isPending ? 'Sending…' : 'Send test'}
                        </SecondaryButton>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap pt-2">
                        {confirming ? (
                            <>
                                <span className="font-body text-[13px] text-on-surface">
                                    Send &ldquo;{subject}&rdquo; to <strong>{formatCount(total)}</strong>{' '}
                                    {total === 1 ? 'account' : 'accounts'}? This cannot be undone.
                                </span>
                                <PrimaryButton onClick={sendReal} disabled={send.isPending}>
                                    {send.isPending ? 'Sending…' : `Yes, send to ${formatCount(total)}`}
                                </PrimaryButton>
                                <TertiaryButton onClick={() => setConfirming(false)}>Cancel</TertiaryButton>
                            </>
                        ) : (
                            <PrimaryButton onClick={() => setConfirming(true)} disabled={!ready || total === 0 || send.isPending}>
                                Send to {formatCount(total)} {total === 1 ? 'account' : 'accounts'}…
                            </PrimaryButton>
                        )}
                        {lastSent && <Pill tone="neutral">{lastSent}</Pill>}
                    </div>
                    {partial && <Alert>{partial}</Alert>}
                </section>
            </div>

            <section className="mt-8">
                <Eyebrow className="block mb-3">History</Eyebrow>
                {history.isError && <Alert onRetry={() => void history.refetch()}>Couldn&apos;t load past announcements.</Alert>}
                {history.data && history.data.length === 0 && (
                    <p className="m-0 font-body text-[13px] text-on-surface-variant">Nothing sent yet.</p>
                )}
                {history.data && history.data.length > 0 && (
                    <ul role="list" className="list-none m-0 p-0 flex flex-col gap-2">
                        {history.data.map((item) => (
                            <li
                                key={item.id}
                                className="bg-surface-container-lowest rounded-md px-4 py-3 flex items-center gap-4 flex-wrap">
                                <div className="flex flex-col gap-1 flex-1 min-w-60">
                                    <span className="font-body font-medium text-[14px] text-on-surface">{item.subject}</span>
                                    <span className="font-body text-[12px] text-on-surface-variant">
                                        {formatDateTime(item.sentAt)} ·{' '}
                                        {item.testTo ? `test copy to ${item.testTo}` : `${formatCount(item.recipientCount)} recipients`}
                                        {item.failedCount > 0 && (
                                            <span className="text-error"> · {formatCount(item.failedCount)} not delivered</span>
                                        )}{' '}
                                        · filter {JSON.stringify(item.filters)}
                                    </span>
                                </div>
                                <TertiaryButton
                                    onClick={() => {
                                        setSubject(item.subject)
                                        setBody(item.body)
                                        setFilters(item.filters)
                                    }}>
                                    Reuse
                                </TertiaryButton>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </AdminShell>
    )
}
