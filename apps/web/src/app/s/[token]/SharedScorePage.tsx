'use client'

import { ScoreView } from '@mushee/notation/components'
import type { Score } from '@mushee/notation/model'
import { ScoreDeserializer } from '@mushee/notation/model/io/ScoreDeserializer'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { settingsTabPath } from '@/app/settings/settingsTabs'
import { ExportMenu } from '@/components/ExportMenu'
import { GetStartedButton } from '@/components/marketing/GetStartedButton'
import { ScoreLimitDialog } from '@/components/ScoreLimitDialog'
import { Footer, Icon, PrimaryButton, SecondaryButton, showToast, SkipLink, TertiaryButton, Wordmark } from '@/components/ui'
import { track } from '@/lib/analytics'
import { ApiError } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { LIBRARY_PATH, withNext } from '@/lib/nextPath'
import { BETA_MODE, type PlanTier, withPlan } from '@/lib/plans'
import { useCreateScore, useSharedScore } from '@/lib/queries'
import { useTransport } from '@/lib/useTransport'

/**
 * What a share link opens: the score, engraved read-only, with its title, a
 * labelled player bar above it — Play/Pause, Stop once playing, Download (the
 * recipient can take the chart home as PDF/MIDI/MusicXML) and, signed in, Save
 * a copy — and a quiet path into Solkey. The header holds only the wordmark and
 * one CTA. No editing surface, no selection, no recording.
 */
export function SharedScorePage({ token }: { token: string }) {
    const router = useRouter()
    const shared = useSharedScore(token)
    const { data: session } = useSession()
    const authed = !!session?.user
    const scoreAreaRef = useRef<HTMLDivElement>(null)

    // The score is immutable here, but its layout reflows with the container width
    // (ScoreView observes it and calls setLayoutWidth), so re-render on change. A raw
    // (non-JSON) stored document can't be engraved; it shows the load-error state instead.
    const [, bump] = useState(0)
    const stored = shared.data?.document
    const partwise = stored && !('raw' in stored) ? stored : null
    const unreadable = stored !== undefined && partwise === null
    const score = useMemo<Score | null>(
        () => (partwise ? new ScoreDeserializer(partwise).toScore(() => bump((n) => n + 1)) : null),
        [partwise],
    )

    // One view event per resolved link — the growth loop's top-of-funnel number.
    useEffect(() => {
        if (shared.data) track('shared_score_viewed', { authed })
    }, [shared.data, authed])

    // The server may not have reached the API when it rendered the <title> (generateMetadata
    // falls back to a generic one); once the token resolves here, the tab carries the score's name.
    useEffect(() => {
        if (shared.data?.title) document.title = `${shared.data.title} — Solkey`
    }, [shared.data?.title])

    // A signed-in visitor can take the shared score home as an editable copy of their own.
    // A copy counts against the plan's score cap like any create, so a refusal gets the
    // library's upgrade dialog rather than a failure toast.
    const create = useCreateScore()
    const [limitDialogOpen, setLimitDialogOpen] = useState(false)
    const saveCopy = () => {
        if (!shared.data || !partwise || create.isPending) return
        create.mutate(
            { title: shared.data.title, score: partwise },
            {
                onSuccess: (created) => {
                    track('shared_score_copied')
                    router.push(`/scores/${created.id}`)
                },
                onError: (err) => {
                    if (err instanceof ApiError && err.isScoreLimit) setLimitDialogOpen(true)
                    else showToast('Could not save a copy. Please try again.')
                },
            },
        )
    }
    const notFound = shared.isError && shared.error instanceof ApiError && shared.error.isClientError
    // The editor's transport binding, minus selection, recording and the metronome (so no
    // click samples to fetch). There is no selected note, so playback starts at the top.
    const playback = useTransport(score, { metronome: false })
    const playing = playback.state === 'playing'
    const backHere = `/s/${token}`

    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <header className="sticky top-0 z-(--z-sticky) bg-surface-container-low/85 backdrop-blur-xl">
                <SkipLink />
                <div className="max-w-320 mx-auto px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-4">
                    <Link
                        href="/"
                        className="no-underline shrink-0 inline-flex items-center pointer-coarse:min-h-10"
                        aria-label="Solkey home">
                        <Wordmark size={24} />
                    </Link>
                    {/* One CTA. Signing up from a shared score leads back to it (and its "Save a copy") once onboarding is done. */}
                    {authed ? (
                        <TertiaryButton href={LIBRARY_PATH}>Open library</TertiaryButton>
                    ) : (
                        <GetStartedButton location="shared-score" next={backHere} />
                    )}
                </div>
            </header>

            <main id="content" className="flex-1 w-full max-w-320 mx-auto px-4 sm:px-8 py-6 sm:py-10 flex flex-col gap-6">
                {shared.data && (
                    <h1 className="font-display font-bold text-[26px] sm:text-[34px] leading-[1.05] tracking-[-0.03em] text-on-surface m-0 w-full max-w-240 mx-auto">
                        {shared.data.title}
                    </h1>
                )}
                {shared.isPending && <div className="h-64 rounded-lg bg-surface-container-low animate-pulse" aria-label="Loading score" />}
                {(shared.isError || unreadable) && (
                    <LoadProblem
                        notFound={notFound}
                        headingLevel={shared.data ? 2 : 1}
                        onRetry={notFound ? undefined : () => void shared.refetch()}
                    />
                )}
                {score && shared.data && (
                    <>
                        {/* The recipient's main actions, labelled, above the score; on phones the bar wraps and keeps every label. */}
                        <div className="w-full max-w-240 mx-auto flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                                <PrimaryButton
                                    size="lg"
                                    onClick={() => {
                                        if (playback.state === 'stopped') track('shared_score_played')
                                        playback.toggle(null)
                                    }}
                                    disabled={!playback.ready}>
                                    <span className="inline-flex items-center gap-2">
                                        <Icon name={playing ? 'pause' : 'play'} size={18} />
                                        {playing ? 'Pause' : 'Play'}
                                    </span>
                                </PrimaryButton>
                                {playback.state !== 'stopped' && <SecondaryButton onClick={playback.stop}>Stop</SecondaryButton>}
                            </div>
                            <span className="flex-1" />
                            <div className="flex items-center gap-2">
                                <ExportMenu
                                    score={score}
                                    title={shared.data.title}
                                    getSvg={() => scoreAreaRef.current?.querySelector('svg') ?? null}
                                    label="Download"
                                    ariaLabel="Download score"
                                />
                                {authed && (
                                    <SecondaryButton onClick={saveCopy}>{create.isPending ? 'Saving…' : 'Save a copy'}</SecondaryButton>
                                )}
                            </div>
                        </div>
                        <div
                            ref={scoreAreaRef}
                            className="bg-white rounded-lg tonal-layer-glow p-4 sm:p-8 overflow-hidden w-full max-w-240 mx-auto"
                            data-testid="shared-score">
                            <ScoreView score={score} layoutId={score.layout.id} playbackCursorRef={playback.playbackCursorRef} />
                        </div>
                        <p className="m-0 text-center font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            {authed ? (
                                'Want to change it? Save a copy to your library.'
                            ) : (
                                <>
                                    Made with Solkey — hum, sing or play a melody and get sheet music like this.{' '}
                                    <Link
                                        href={withNext('/signup', backHere)}
                                        onClick={() => track('landing_cta_clicked', { location: 'shared-score-footer', beta: BETA_MODE })}
                                        className="text-primary underline">
                                        {BETA_MODE ? 'Request access' : 'Try it free'}
                                    </Link>
                                </>
                            )}
                        </p>
                    </>
                )}
            </main>

            <Footer width="marketing" />
            {limitDialogOpen && (
                <ScoreLimitDialog
                    // The plan tab, with the next tier's change-plan dialog open when the dialog names one.
                    onUpgrade={(planId?: PlanTier['id']) => router.push(withPlan(settingsTabPath('plan'), planId))}
                    onClose={() => setLimitDialogOpen(false)}
                />
            )}
        </div>
    )
}

/** Why the link shows no score: gone (a revoked or mistyped link) or a load that failed. */
function LoadProblem({ notFound, headingLevel, onRetry }: { notFound: boolean; headingLevel: 1 | 2; onRetry?: () => void }) {
    const Heading = headingLevel === 1 ? 'h1' : 'h2'
    return (
        <section className="max-w-130 mx-auto text-center flex flex-col gap-4 items-center py-16">
            <Heading className="font-display font-bold text-[28px] sm:text-[36px] leading-none tracking-[-0.03em] text-on-surface m-0">
                {notFound ? 'This link doesn’t open anything.' : 'The score couldn’t be loaded.'}
            </Heading>
            <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant m-0">
                {notFound
                    ? 'The owner may have turned sharing off, or the address is incomplete. Ask them for a fresh link.'
                    : 'Something went wrong on our side. Try again in a moment.'}
            </p>
            {notFound && <PrimaryButton href="/">See what Solkey does</PrimaryButton>}
            {onRetry && <TertiaryButton onClick={onRetry}>Try again</TertiaryButton>}
        </section>
    )
}
