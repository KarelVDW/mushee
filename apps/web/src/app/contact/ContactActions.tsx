'use client'

import Link from 'next/link'

import { settingsTabPath } from '@/app/settings/settingsTabs'
import { SecondaryButton, showToast } from '@/components/ui'
import { useSession } from '@/lib/auth-client'

/**
 * Copies an address for someone whose mailto: opens nothing (webmail, no mail app set up).
 * A toast confirms; where the clipboard is unavailable, the toast says the address instead.
 */
export function CopyAddressButton({ address }: { address: string }) {
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(address)
            showToast('Address copied.', 'info', { icon: 'check' })
        } catch {
            showToast(`Couldn't copy it — the address is ${address}.`)
        }
    }
    return <SecondaryButton onClick={() => void copy()}>Copy address</SecondaryButton>
}

/** For a signed-in visitor: the same help lives in the app, one link away. Renders nothing signed out. */
export function SettingsSupportLink() {
    const { data: session } = useSession()
    if (!session?.user) return null
    return (
        <Link href={settingsTabPath('account')} className="font-body font-normal text-[14px] text-primary underline">
            You&apos;ll also find these under Settings → Account
        </Link>
    )
}
