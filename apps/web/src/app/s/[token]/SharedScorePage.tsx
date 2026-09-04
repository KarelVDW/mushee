'use client'

import { Score as ScoreView } from '@mushee/notation/components'
import type { ScorePartwise } from '@mushee/notation/components/types'
import type { Score } from '@mushee/notation/model'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Footer, PrimaryButton, TertiaryButton, Wordmark } from '@/components/ui'
import { track } from '@/lib/analytics'
import { ApiError } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { BETA_MODE } from '@/lib/plans'
import { useSharedScore } from '@/lib/queries'

import { ExportMenu } from '../../scores/[id]/ExportMenu'

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
    const [score, setScore] = useState<Score | null>(null)
    useEffect(() => {
        if (!shared.data) return
        setScore(new ScoreDeserializer(shared.data.document as unknown as ScorePartwise).toScore(() => bump((n) => n + 1)))
    }, [shared.data])

    const onGetStarted = () => {
        track('landing_cta_clicked', { location: 'shared-score', beta: BETA_MODE })
        router.push(authed ? '/scores' : '/signup')
    }
    const notFound = shared.isError && shared.error instanceof ApiError && shared.error.isClientError

    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <header className="sticky top-0 z-50 bg-surface-container-low/85 backdrop-blur-xl">
                <div className="max-w-320 mx-auto px-4 sm:px-8 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
                    <Link href="/" className="no-underline shrink-0" aria-label="Solkey home">
                        <Wordmark size={24} />
                    </Link>
                    <h1 className="font-headline font-semibold text-[16px] sm:text-[18px] leading-none tracking-[-0.01em] text-on-surface m-0 truncate flex-1 min-w-0">
                        {shared.data?.title ?? (notFound ? 'Shared score' : '')}
                    </h1>
                    {score && shared.data && (
                        <ExportMenu
                            score={score}
                            title={shared.data.title}
                            getSvg={() => scoreAreaRef.current?.querySelector('svg') ?? null}
                            compact
                        />
                    )}
                    <PrimaryButton icon="arrow-right" onClick={onGetStarted}>
                        {authed ? 'Open library' : 'Start free'}
                    </PrimaryButton>
                </div>
            </header>

            <main className="flex-1 w-full max-w-320 mx-auto px-4 sm:px-8 py-6 sm:py-10 flex flex-col gap-6">
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
                            className="bg-white rounded-lg tonal-layer-glow p-4 sm:p-8 overflow-hidden"
                            data-testid="shared-score">
                            <ScoreView score={score} layoutId={score.layout.id} />
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
