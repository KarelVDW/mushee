'use client'

import Link from 'next/link'
import { useState } from 'react'

import { DialogPanel, Icon, isAcceptablePassword, NewPasswordFields, PasswordField, PrimaryButton, TertiaryButton } from '@/components/ui'
import { changePassword } from '@/lib/auth-client'
import { AuthErrorCopy } from '@/lib/AuthErrorCopy'

/**
 * What a failed change says. A wrong current password — by far the likeliest failure — gets
 * its own line; anything else goes through the shared auth copy, so the auth library's own
 * message is never shown.
 */
function changeErrorMessage(error: unknown): string {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (code === 'INVALID_PASSWORD') return "That isn't your current password. Try again, or send yourself a reset link below."
    return AuthErrorCopy.for(error).message
}

interface ChangePasswordDialogProps {
    /** Cancel, or Done after the password changed — the caller just closes the dialog. */
    onClose: () => void
}

export function ChangePasswordDialog({ onClose }: ChangePasswordDialogProps) {
    const [current, setCurrent] = useState('')
    const [next, setNext] = useState('')
    const [confirm, setConfirm] = useState('')
    const [showPw, setShowPw] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [saved, setSaved] = useState(false)

    const sameAsCurrent = next.length > 0 && next === current
    const canSubmit = !submitting && current.length > 0 && isAcceptablePassword(next, confirm) && !sameAsCurrent

    const submit = async () => {
        if (!canSubmit) return
        setSubmitting(true)
        setError(null)
        // revokeOtherSessions: sign the user out of every other browser as a
        // precaution — the success state below says so ("We've signed you out
        // everywhere else"), as in the design kit's design/ui_kits/web/Settings.jsx.
        const { error: err } = await changePassword({
            currentPassword: current,
            newPassword: next,
            revokeOtherSessions: true,
        })
        setSubmitting(false)
        if (err) {
            setError(changeErrorMessage(err))
            return
        }
        setSaved(true)
    }

    return (
        <DialogPanel
            title={saved ? 'Password updated.' : 'Change password'}
            subtitle={saved ? 'Use your new password next time you sign in.' : 'Confirm your current password, then pick a new one.'}
            onClose={saved ? undefined : onClose}
            width={480}
            footer={
                saved ? (
                    <PrimaryButton onClick={onClose}>Done</PrimaryButton>
                ) : (
                    <>
                        <TertiaryButton onClick={onClose}>Cancel</TertiaryButton>
                        <PrimaryButton disabled={!canSubmit} onClick={() => void submit()}>
                            {submitting ? 'Updating…' : 'Update password'}
                        </PrimaryButton>
                    </>
                )
            }>
            {saved ? (
                <div className="flex items-center gap-3.5 pb-4">
                    <span className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center shrink-0">
                        <Icon name="check" size={20} />
                    </span>
                    <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                        We&apos;ve signed you out everywhere else as a precaution.
                    </span>
                </div>
            ) : (
                <div className="flex flex-col gap-4 pb-4">
                    {/* One eye button (on New password) reveals all three fields. */}
                    <PasswordField label="Current password" value={current} onChange={setCurrent} shown={showPw} autoFocus />
                    <NewPasswordFields
                        value={next}
                        onChange={setNext}
                        confirm={confirm}
                        onConfirmChange={setConfirm}
                        confirmLabel="Confirm new password"
                        shown={showPw}
                        onToggleShown={() => setShowPw(!showPw)}
                        confirmError={sameAsCurrent ? 'Pick something different from your current password.' : undefined}
                    />
                    {error && <span className="font-body font-medium text-[12px] leading-[1.4] text-error">{error}</span>}
                    <span className="font-body font-normal text-[12px] leading-normal text-on-surface-variant">
                        Forgot your current password?{' '}
                        <Link href="/reset-password" className="text-primary">
                            Send a reset link by email
                        </Link>{' '}
                        instead.
                    </span>
                </div>
            )}
        </DialogPanel>
    )
}
