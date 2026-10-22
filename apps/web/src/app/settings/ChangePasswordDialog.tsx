'use client'

import Link from 'next/link'
import { useState } from 'react'

import { DialogPanel, Icon, isAcceptablePassword, NewPasswordFields, PasswordField, PrimaryButton, TertiaryButton } from '@/components/ui'
import { changePassword } from '@/lib/auth-client'

interface ChangePasswordDialogProps {
    onCancel: () => void
    onSuccess: () => void
}

export function ChangePasswordDialog({ onCancel, onSuccess }: ChangePasswordDialogProps) {
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
        // precaution after a password change — matches the mockup's hint copy.
        const { error: err } = await changePassword({
            currentPassword: current,
            newPassword: next,
            revokeOtherSessions: true,
        })
        setSubmitting(false)
        if (err) {
            setError(err.message ?? 'Couldn’t change your password. Check your current password and try again.')
            return
        }
        setSaved(true)
    }

    return (
        <DialogPanel
            title={saved ? 'Password updated.' : 'Change password'}
            subtitle={saved ? 'Use your new password next time you sign in.' : 'At least 8 characters, with a mix of letters and numbers.'}
            onClose={saved ? undefined : onCancel}
            width={480}
            footer={
                saved ? (
                    <PrimaryButton onClick={onSuccess}>Done</PrimaryButton>
                ) : (
                    <>
                        <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
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
