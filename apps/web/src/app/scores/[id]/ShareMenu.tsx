'use client'

import { ChipToggle, Eyebrow, Icon, PrimaryButton, SecondaryButton, showToast, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import { useShareScore, useUnshareScore } from '@/lib/queries'
import { useDismissablePopover } from '@/lib/useDismissablePopover'

/** The public address of a shared score, on whatever host the app is served from. */
export function shareLinkFor(token: string): string {
    return `${window.location.origin}/s/${token}`
}

interface ShareMenuProps {
    scoreId: string
    /** The current token (from the score meta); null when sharing is off. */
    shareToken: string | null
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
}

/**
 * Read-only share link for the score: turn it on (one link per score, stable
 * until turned off), copy it, turn it off. Sits in the editor header next to
 * Takes and Export, same glass-panel pattern.
 */
export function ShareMenu({ scoreId, shareToken, compact = false }: ShareMenuProps) {
    const { open, setOpen, anchorRef, popRef } = useDismissablePopover()
    const share = useShareScore(scoreId)
    const unshare = useUnshareScore(scoreId)
    const link = shareToken ? shareLinkFor(shareToken) : null

    const copy = async () => {
        if (!link) return
        try {
            await navigator.clipboard.writeText(link)
            track('share_link_copied')
            showToast('Link copied.', 'info')
        } catch {
            showToast("Couldn't copy — select the link and copy it yourself.")
        }
    }

    return (
        <div ref={anchorRef} className="relative shrink-0">
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel="Share score">
                <span className="inline-flex items-center gap-1.5">
                    <Icon name={shareToken ? 'link' : 'share-2'} size={14} />
                    {!compact && 'Share'}
                </span>
            </ChipToggle>
            {open && (
                <div
                    ref={popRef}
                    role="dialog"
                    aria-label="Share score"
                    className="glass-panel tonal-layer-glow absolute z-50 flex flex-col gap-3 p-4 rounded-lg right-0 top-[calc(100%+0.5rem)] w-80 max-w-[calc(100vw-1.5rem)]"
                    onMouseDown={(e) => e.stopPropagation()}>
                    <Eyebrow>Share a read-only link</Eyebrow>
                    {link ? (
                        <>
                            <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                                Anyone with this link can view the score and download it as PDF, MusicXML or MIDI. They can&apos;t edit it,
                                and they don&apos;t need an account.
                            </p>
                            <div className="flex items-center gap-2">
                                <input
                                    readOnly
                                    aria-label="Share link"
                                    value={link}
                                    onFocus={(e) => e.currentTarget.select()}
                                    className="flex-1 min-w-0 rounded-sm bg-surface-container-low px-3 py-2 border-0 font-mono text-[12px] text-on-surface"
                                />
                                <SecondaryButton onClick={() => void copy()}>Copy</SecondaryButton>
                            </div>
                            <div className="flex justify-end">
                                <TertiaryButton
                                    danger
                                    onClick={() => unshare.mutate(undefined, { onSuccess: () => track('share_link_removed') })}>
                                    {unshare.isPending ? 'Turning off…' : 'Turn off link'}
                                </TertiaryButton>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                                Create a link anyone can open to view and download this score — no account needed, no editing. You can turn
                                it off any time.
                            </p>
                            <PrimaryButton
                                onClick={() => share.mutate(undefined, { onSuccess: () => track('share_link_created') })}
                                fullWidth>
                                {share.isPending ? 'Creating link…' : 'Turn on link'}
                            </PrimaryButton>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
