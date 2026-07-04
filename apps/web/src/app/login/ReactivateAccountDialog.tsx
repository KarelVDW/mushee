'use client'

import { useState } from 'react'

import { DialogPanel, DialogScrim, PrimaryButton, TertiaryButton } from '@/components/ui'
import { signOut } from '@/lib/auth-client'
import { useReactivateAccount } from '@/lib/queries'

interface ReactivateAccountDialogProps {
    /** End of the grace period (ISO timestamp), when known. */
    purgeAfter?: string
    /** The user reactivated — continue into the app. */
    onReactivated: () => void
    /** The user let the deletion stand — they're signed out again. */
    onDecline: () => void
}

/**
 * Shown right after a successful sign-in when the account is soft-deleted.
 * The user must explicitly choose: reactivate, or stay on track for deletion
 * (which signs them back out). No dismiss — half-states would be confusing.
 */
export function ReactivateAccountDialog({ purgeAfter, onReactivated, onDecline }: ReactivateAccountDialogProps) {
    const reactivation = useReactivateAccount()
    const [declining, setDeclining] = useState(false)

    const purgeDate = purgeAfter
        ? new Date(purgeAfter).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
        : 'soon'

    const decline = async () => {
        if (declining || reactivation.isPending) return
        setDeclining(true)
        await signOut()
        onDecline()
    }

    return (
        <DialogScrim>
            <DialogPanel
                title="Your account is set to be deleted."
                subtitle={`Everything will be permanently deleted on ${purgeDate}.`}
                width={520}
                footer={
                    <>
                        <TertiaryButton danger onClick={() => void decline()}>
                            {declining ? 'Signing out…' : 'Continue deletion'}
                        </TertiaryButton>
                        <PrimaryButton
                            emphasis="pop"
                            disabled={declining || reactivation.isPending}
                            onClick={() => reactivation.mutate(undefined, { onSuccess: onReactivated })}>
                            {reactivation.isPending ? 'Reactivating…' : 'Reactivate my account'}
                        </PrimaryButton>
                    </>
                }>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant m-0 pb-4">
                    You asked us to delete this account, and nothing is gone yet. Reactivate now and your scores,
                    recordings, and settings will be exactly where you left them.
                </p>
            </DialogPanel>
        </DialogScrim>
    )
}
