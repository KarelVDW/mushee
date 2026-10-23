'use client'

import { ScoreView } from '@mushee/notation/components'
import type { Score } from '@mushee/notation/model'
import { ScoreDeserializer } from '@mushee/notation/model/io/ScoreDeserializer'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { settingsTabPath } from '@/app/settings/settingsTabs'
import { ExportMenu } from '@/components/ExportMenu'
import { GetStartedButton } from '@/components/marketing/GetStartedButton'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { ScoreLimitDialog } from '@/components/ScoreLimitDialog'
import { Container, Eyebrow, Footer, Icon, LoadingStatus, PrimaryButton, SecondaryButton, showToast, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import { ApiError } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { LIBRARY_PATH } from '@/lib/nextPath'
import { BETA_MODE, withPlan } from '@/lib/plans'
import { useCreateScore, useSharedScore } from '@/lib/queries'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useTransport } from '@/lib/useTransport'

/**
 * What a share link opens — the top of the funnel, so a finished landing: the
 * marketing bar with one flat CTA, the score's title, a labelled player bar of
 * 44px controls — Play/Pause, Stop once playing, Download (the recipient can
 * take the chart home as PDF/MIDI/MusicXML) and, signed in, Save a copy — the
 * score engraved view-only (nothing hovers), and for a stranger a closing card
 * that invites them in. No editing surface, no selection, no recording.
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

    // The server names the tab when it reaches the API (generateMetadata); when it couldn't, its
    // generic title is streamed in — possibly after the token resolved here. The hook keeps the
    // score's name on top either way, so the tab's final title is the score's.
    useDocumentTitle(shared.data?.title ? `${shared.data.title} — Solkey` : null)

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

    // Stop leaves the bar the moment playback stops, and the focus it held would fall to <body>. A keyboard
    // or screen-reader user lands back on Play instead, whose name says playback is over: Stop hands focus
    // over itself, and when the score plays out with Stop focused, the effect does (only if focus did fall
    // to <body>, so a user who has moved on stays put). PrimaryButton takes no ref, so its group is the handle.
    const transportGroupRef = useRef<HTMLDivElement>(null)
    const stopHasFocus = useRef(false)
    const focusPlay = useCallback(() => transportGroupRef.current?.querySelector('button')?.focus(), [])
    useEffect(() => {
        if (playback.state !== 'stopped' || !stopHasFocus.current) return
        stopHasFocus.current = false
        if (!document.activeElement || document.activeElement === document.body) focusPlay()
    }, [playback.state, focusPlay])

    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            {/* One flat CTA. Signing up from a shared score leads back to it (and its "Save a copy") once onboarding is done. */}
            <MarketingNav>
                {authed ? (
                    <TertiaryButton href={LIBRARY_PATH}>Open library</TertiaryButton>
                ) : (
                    <GetStartedButton location="shared-score" next={backHere} />
                )}
            </MarketingNav>

            <main id="content" className="flex-1 w-full py-6 sm:py-10">
                <Container width="marketing" className="flex flex-col gap-6">
                    {shared.data && (
                        <h1 className="type-title leading-[1.1] text-on-surface m-0 w-full max-w-240 mx-auto">{shared.data.title}</h1>
                    )}
                    {/* Loading: a white card the score's shape, with the system's staff skeleton and its status line. */}
                    {shared.isPending && (
                        <div className="h-48 w-full max-w-240 mx-auto rounded-lg bg-surface-container-lowest flex items-center justify-center px-6">
                            <LoadingStatus message="Opening the score…" />
                        </div>
                    )}
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
                                <div ref={transportGroupRef} className="flex items-center gap-2">
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
                                    {playback.state !== 'stopped' && (
                                        <span className="contents" onFocus={() => (stopHasFocus.current = true)}>
                                            <SecondaryButton
                                                tone="raised"
                                                size="lg"
                                                onClick={() => {
                                                    playback.stop()
                                                    focusPlay()
                                                }}>
                                                Stop
                                            </SecondaryButton>
                                        </span>
                                    )}
                                </div>
                                <span className="flex-1" />
                                <div className="flex items-center gap-2">
                                    <ExportMenu
                                        score={score}
                                        title={shared.data.title}
                                        getSvg={() => scoreAreaRef.current?.querySelector('svg') ?? null}
                                        label="Download"
                                        ariaLabel="Download score"
                                        size="lg"
                                    />
                                    {authed && (
                                        <SecondaryButton tone="raised" size="lg" onClick={saveCopy}>
                                            {create.isPending ? 'Saving…' : 'Save a copy'}
                                        </SecondaryButton>
                                    )}
                                </div>
                            </div>
                            <div
                                ref={scoreAreaRef}
                                className="bg-surface-container-lowest rounded-lg tonal-layer-glow p-4 sm:p-8 overflow-hidden w-full max-w-240 mx-auto"
                                data-testid="shared-score">
                                {/* View-only: nothing hovers or selects. The viewBox stays uncropped: Download exports this live SVG. */}
                                <ScoreView
                                    score={score}
                                    layoutId={score.layout.id}
                                    playbackCursorRef={playback.playbackCursorRef}
                                    interactive={false}
                                />
                            </div>
                            {authed ? (
                                <p className="m-0 text-center font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                                    Want to change it? Save a copy to your library.
                                </p>
                            ) : (
                                // The page's one pop: what made this, and the way in (back to this score once signed up).
                                <div className="max-w-240 mx-auto w-full rounded-xl bg-surface-container-lowest tonal-layer-glow p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                                    <div className="flex flex-col gap-3">
                                        <Eyebrow className="text-primary">Made with Solkey</Eyebrow>
                                        <p className="m-0 font-display font-bold text-[22px] sm:text-[28px] leading-[1.1] text-on-surface text-balance">
                                            Hum, sing or play a melody and get sheet music like this.
                                        </p>
                                    </div>
                                    <GetStartedButton size="lg" emphasis="pop" location="shared-score-footer" next={backHere}>
                                        {BETA_MODE ? 'Request access' : 'Try it free'}
                                    </GetStartedButton>
                                </div>
                            )}
                        </>
                    )}
                </Container>
            </main>

            <Footer width="marketing" />
            {limitDialogOpen && (
                <ScoreLimitDialog
                    // Every upgrade CTA lands on the plan tab with the next tier picked (C9, S1).
                    onUpgrade={(planId) => router.push(withPlan(settingsTabPath('plan'), planId))}
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
            <Heading className="font-display font-bold text-[28px] sm:text-[36px] leading-[1.1] tracking-[-0.03em] text-on-surface m-0">
                {notFound ? 'This link doesn’t open anything.' : 'The score couldn’t be loaded.'}
            </Heading>
            <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant m-0">
                {notFound
                    ? 'The owner may have turned sharing off, or the address is incomplete. Ask them for a fresh link.'
                    : 'Something went wrong on our side. Try again in a moment.'}
            </p>
            {/* Secondary: the header's Start free stays the page's one loud cyan. */}
            {notFound && <SecondaryButton href="/">See what Solkey does</SecondaryButton>}
            {onRetry && <TertiaryButton onClick={onRetry}>Try again</TertiaryButton>}
        </section>
    )
}
