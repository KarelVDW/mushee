'use client'

import { useEffect, useRef, useState } from 'react'

import { HeaderMenu, Icon, PrimaryButton, SecondaryButton, showToast, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import { useShareScore, useUnshareScore } from '@/lib/queries'

/** How long Copy reads 'Copied' after a copy. */
const COPIED_MS = 2000

/** The public address of a shared score, on whatever host the app is served from. */
function shareLinkFor(token: string): string {
    return `${window.location.origin}/s/${token}`
}

/**
 * Puts a link on the clipboard that may not exist yet. Where the browser takes a promised
 * ClipboardItem, the write starts inside the click — Safari refuses a clipboard write once
 * the click's user activation is spent on a network round trip — and fills in when the link
 * arrives; elsewhere the link is written once it is known. Resolves whether it worked.
 */
async function copyToClipboard(link: string | Promise<string>): Promise<boolean> {
    try {
        if (typeof link !== 'string' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            const blob = link.then((text) => new Blob([text], { type: 'text/plain' }))
            await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
        } else {
            await navigator.clipboard.writeText(await link)
        }
        return true
    } catch {
        return false
    }
}

interface ShareMenuProps {
    scoreId: string
    /** The current token (from the score meta); null when sharing is off. */
    shareToken: string | null
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
}

/**
 * Read-only share link for the score: create it and copy it in one press (one link per score,
 * stable until turned off), copy it again, turn it off — after a confirm, since a link turned
 * off is gone for everyone who has it, and turning sharing back on mints a new one. Sits in
 * the editor header next to Recordings and Export, same panel pattern.
 */
export function ShareMenu({ scoreId, shareToken, compact = false }: ShareMenuProps) {
    return (
        <HeaderMenu
            icon={shareToken ? 'link' : 'share-2'}
            label="Share"
            compact={compact}
            ariaLabel="Share score"
            title="Share a read-only link"
            className="gap-3 w-80 max-w-[calc(100vw-1.5rem)]">
            <SharePanel scoreId={scoreId} shareToken={shareToken} />
        </HeaderMenu>
    )
}

/** The panel body — mounted while the menu is open, so a half-made confirm never outlives it. */
function SharePanel({ scoreId, shareToken }: { scoreId: string; shareToken: string | null }) {
    const share = useShareScore(scoreId)
    const unshare = useUnshareScore(scoreId)
    const link = shareToken ? shareLinkFor(shareToken) : null
    const panelRef = useRef<HTMLDivElement>(null)
    const [copied, setCopied] = useState(false)
    // The link was made but couldn't reach the clipboard (a browser that said no): Copy is right there.
    const [copyMissed, setCopyMissed] = useState(false)
    const [confirmingOff, setConfirmingOff] = useState(false)
    // Where focus goes once the panel's state swap has rendered (the control pressed is gone by then).
    const focusNext = useRef<string | null>(null)
    const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

    useEffect(() => () => clearTimeout(copiedTimer.current), [])
    useEffect(() => {
        const target = focusNext.current
        if (!target) return
        focusNext.current = null
        panelRef.current?.querySelector<HTMLElement>(`[data-share-focus="${target}"] button`)?.focus()
    })

    const showCopied = () => {
        setCopied(true)
        setCopyMissed(false)
        clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS)
    }

    const createAndCopy = () => {
        if (share.isPending) return
        const created = share.mutateAsync()
        // Started inside the click, before the request: see copyToClipboard.
        const copying = copyToClipboard(created.then(({ token }) => shareLinkFor(token)))
        void created.then(
            async () => {
                track('share_link_created')
                focusNext.current = 'copy'
                if (await copying) {
                    track('share_link_copied')
                    showCopied()
                } else {
                    setCopyMissed(true)
                }
            },
            // The request's own failure toast says what happened; the panel stays as it was.
            () => undefined,
        )
    }

    const copy = async () => {
        if (!link) return
        if (await copyToClipboard(link)) {
            track('share_link_copied')
            showCopied()
        } else {
            showToast("Couldn't copy — select the link and copy it yourself.")
        }
    }

    const turnOff = () =>
        unshare.mutate(undefined, {
            onSuccess: () => {
                track('share_link_removed')
                setConfirmingOff(false)
                setCopied(false)
                setCopyMissed(false)
                focusNext.current = 'create'
            },
        })

    return (
        <div ref={panelRef} className="contents">
            {link ? (
                <>
                    <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                        Anyone with this link can see the score, play it and download it as PDF, MusicXML or MIDI. They can&apos;t change
                        it, and they don&apos;t need an account.
                    </p>
                    <div className="flex items-center gap-2">
                        <input
                            readOnly
                            aria-label="Share link"
                            value={link}
                            onFocus={(e) => e.currentTarget.select()}
                            className="flex-1 min-w-0 rounded-sm bg-surface-container-low px-3 py-2 border-0 font-mono text-[12px] text-on-surface"
                        />
                        <span data-share-focus="copy" className="contents">
                            <SecondaryButton onClick={() => void copy()}>
                                {copied ? (
                                    <span className="inline-flex items-center gap-1.5 motion-safe:animate-[tooltip-in_150ms_var(--ease-solkey)]">
                                        <Icon name="check" size={14} />
                                        Copied
                                    </span>
                                ) : (
                                    'Copy'
                                )}
                            </SecondaryButton>
                        </span>
                    </div>
                    {copyMissed && (
                        <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            Link ready — press Copy.
                        </p>
                    )}
                    {confirmingOff ? (
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <span className="font-body font-medium text-[13px] leading-snug text-on-surface">
                                Turn off? The link stops working for everyone who has it.
                            </span>
                            <span className="inline-flex items-center gap-3">
                                <TertiaryButton danger onClick={turnOff}>
                                    {unshare.isPending ? 'Turning off…' : 'Turn off'}
                                </TertiaryButton>
                                <span data-share-focus="keep" className="contents">
                                    <TertiaryButton
                                        onClick={() => {
                                            setConfirmingOff(false)
                                            focusNext.current = 'off'
                                        }}>
                                        Keep it on
                                    </TertiaryButton>
                                </span>
                            </span>
                        </div>
                    ) : (
                        <div className="flex justify-end">
                            <span data-share-focus="off" className="contents">
                                <TertiaryButton
                                    danger
                                    onClick={() => {
                                        setConfirmingOff(true)
                                        focusNext.current = 'keep'
                                    }}>
                                    Turn off link
                                </TertiaryButton>
                            </span>
                        </div>
                    )}
                </>
            ) : (
                <>
                    <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                        Anyone with the link can see, play and download this score. They can&apos;t change it.
                    </p>
                    <span data-share-focus="create" className="contents">
                        <PrimaryButton onClick={createAndCopy} fullWidth>
                            {share.isPending ? 'Creating link…' : 'Create link and copy'}
                        </PrimaryButton>
                    </span>
                </>
            )}
        </div>
    )
}
