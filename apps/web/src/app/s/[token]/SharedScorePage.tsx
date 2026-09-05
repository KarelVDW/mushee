'use client'

import { Score as ScoreView } from '@mushee/notation/components'
import type { ScorePartwise } from '@mushee/notation/components/types'
import type { Score } from '@mushee/notation/model'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
    Footer,
    Icon,
    IconButton,
    PrimaryButton,
    SecondaryButton,
    showToast,
    TertiaryButton,
    TransportBtn,
    Wordmark,
} from '@/components/ui'
import { track } from '@/lib/analytics'
import { ApiError } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { BETA_MODE } from '@/lib/plans'
import { useCreateScore, useSharedScore } from '@/lib/queries'

import { ExportMenu } from '../../scores/[id]/ExportMenu'
import { useSharedPlayback } from './useSharedPlayback'

/**
 * What a share link opens: the score, engraved read-only, with its title, an
 * export menu (the recipient can take the chart home as PDF/MusicXML/MIDI) and
 * a quiet path into Solkey. No editing surface, no selection, no recording.
 */
export function SharedScorePage({ token }: { token: string }) {
    const router = useRouter()
    const shared = useSharedScore(token)
    const { data: session } = useSession()
    const authed = !!session?.user
    const scoreAreaRef = useRef<HTMLDivElement>(null)

    // The score is immutable here, but its layout reflows with the container width
    // (ScoreView observes it and calls setLayoutWidth), so re-render on change.
    const [, bump] = useState(0)
    const score = useMemo<Score | null>(
        () =>
            shared.data ? new ScoreDeserializer(shared.data.document as unknown as ScorePartwise).toScore(() => bump((n) => n + 1)) : null,
        [shared.data],
    )

    // One view event per resolved link — the growth loop's top-of-funnel number.
    useEffect(() => {
        if (shared.data) track('shared_score_viewed', { authed })
    }, [shared.data, authed])

    const onGetStarted = () => {
        track('landing_cta_clicked', { location: 'shared-score', beta: BETA_MODE })
        router.push(authed ? '/scores' : '/signup')
    }

    // A signed-in visitor can take the shared score home as an editable copy of their own.
    const create = useCreateScore()
    const saveCopy = () => {
        if (!shared.data || create.isPending) return
        create.mutate(
            { title: shared.data.title, score: shared.data.document },
            {
                onSuccess: (created) => {
                    track('shared_score_copied')
                    router.push(`/scores/${created.id}`)
                },
                onError: (err) =>
                    showToast(
                        err instanceof ApiError && err.code === 'score-limit' ? err.message : 'Could not save a copy. Please try again.',
                    ),
            },
        )
    }
    const notFound = shared.isError && shared.error instanceof ApiError && shared.error.isClientError
    const playback = useSharedPlayback(score)

    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <header className="sticky top-0 z-50 bg-surface-container-low/85 backdrop-blur-xl">
                <div className="max-w-320 mx-auto px-4 sm:px-8 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
                    <Link href="/" className="no-underline shrink-0" aria-label="Solkey home">
                        <Wordmark size={24} />
                    </Link>
                    <span className="flex-1" />
                    {score && (
                        <span className="inline-flex items-center gap-1.5">
                            <TransportBtn size={32} onClick={playback.stop} ariaLabel="Stop" disabled={playback.state === 'stopped'}>
                                <Icon name="square" size={12} />
                            </TransportBtn>
                            <TransportBtn
                                size={40}
                                tone="play"
                                active={playback.state === 'playing'}
                                onClick={() => {
                                    if (playback.state === 'stopped') track('shared_score_played')
                                    playback.toggle()
                                }}
                                ariaLabel={playback.state === 'playing' ? 'Pause' : 'Play'}
                                disabled={!playback.ready}>
                                <Icon name={playback.state === 'playing' ? 'pause' : 'play'} size={16} />
                            </TransportBtn>
                        </span>
                    )}
                    {score && shared.data && (
                        <ExportMenu
                            score={score}
                            title={shared.data.title}
                            getSvg={() => scoreAreaRef.current?.querySelector('svg') ?? null}
                            compact
                        />
                    )}
                    {authed && score && (
                        <>
                            <span className="max-sm:hidden">
                                <SecondaryButton onClick={saveCopy}>{create.isPending ? 'Saving…' : 'Save a copy'}</SecondaryButton>
                            </span>
                            <span className="sm:hidden">
                                <IconButton icon="copy" ariaLabel="Save a copy" onClick={saveCopy} />
                            </span>
                        </>
                    )}
                    <PrimaryButton icon="arrow-right" onClick={onGetStarted}>
                        {authed ? 'Library' : 'Start free'}
                    </PrimaryButton>
                </div>
            </header>

            <main className="flex-1 w-full max-w-320 mx-auto px-4 sm:px-8 py-6 sm:py-10 flex flex-col gap-6">
                {(shared.data || notFound) && (
                    <h1 className="font-display font-bold text-[26px] sm:text-[34px] leading-[1.05] tracking-[-0.03em] text-on-surface m-0 w-full max-w-240 mx-auto">
                        {shared.data?.title ?? 'Shared score'}
                    </h1>
                )}
                {shared.isPending && <div className="h-64 rounded-lg bg-surface-container-low animate-pulse" aria-label="Loading score" />}
                {shared.isError && (
                    <section className="max-w-130 mx-auto text-center flex flex-col gap-4 items-center py-16">
                        <h2 className="font-display font-bold text-[28px] sm:text-[36px] leading-none tracking-[-0.03em] text-on-surface m-0">
                            {notFound ? 'This link doesn’t open anything.' : 'The score couldn’t be loaded.'}
                        </h2>
                        <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant m-0">
                            {notFound
                                ? 'The owner may have turned sharing off, or the address is incomplete. Ask them for a fresh link.'
                                : 'Something went wrong on our side. Try again in a moment.'}
                        </p>
                        {!notFound && <TertiaryButton onClick={() => void shared.refetch()}>Try again</TertiaryButton>}
                    </section>
                )}
                {score && (
                    <>
                        <div
                            ref={scoreAreaRef}
                            className="bg-white rounded-lg tonal-layer-glow p-4 sm:p-8 overflow-hidden w-full max-w-240 mx-auto"
                            data-testid="shared-score">
                            <ScoreView score={score} layoutId={score.layout.id} playbackCursorRef={playback.playbackCursorRef} />
                        </div>
                        <p className="m-0 text-center font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            Shared read-only from Solkey —{' '}
                            {authed ? 'open your library to write your own.' : 'sing or play a melody and get sheet music like this, live.'}
                        </p>
                    </>
                )}
            </main>

            <Footer width="marketing" />
        </div>
    )
}
