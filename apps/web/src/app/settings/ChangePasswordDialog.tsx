'use client'

import Link from 'next/link'
import { useState } from 'react'

import { DialogPanel, DialogScrim, Icon, PasswordStrength, PrimaryButton, scorePassword, TertiaryButton, TextField } from '@/components/ui'
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

    const pwScore = scorePassword(next)
    const pwMatch = next.length > 0 && next === confirm
    const sameAsCurrent = next.length > 0 && next === current
    const canSubmit = !submitting && current.length > 0 && pwScore >= 2 && pwMatch && !sameAsCurrent

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

    const eye = (
        <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            aria-label="Toggle password visibility"
            className="bg-transparent border-0 text-outline cursor-pointer p-1 inline-flex">
            <Icon name={showPw ? 'eye-off' : 'eye'} size={18} />
        </button>
    )

    return (
        <DialogScrim onDismiss={onCancel}>
            <DialogPanel
                title={saved ? 'Password updated.' : 'Change password'}
                subtitle={
                    saved ? 'Use your new password next time you sign in.' : 'At least 8 characters, with a mix of letters and numbers.'
                }
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
                        <TextField
                            label="Current password"
                            value={current}
                            onChange={setCurrent}
                            type={showPw ? 'text' : 'password'}
                            placeholder="••••••••••••"
                            autoFocus
                        />
                        <TextField
                            label="New password"
                            value={next}
                            onChange={setNext}
                            type={showPw ? 'text' : 'password'}
                            placeholder="••••••••••••"
                            rightSlot={eye}
                        />
                        <div className="-mt-2">
                            <PasswordStrength password={next} />
                        </div>
                        <TextField
                            label="Confirm new password"
                            value={confirm}
                            onChange={setConfirm}
                            type={showPw ? 'text' : 'password'}
                            placeholder="••••••••••••"
                        />
                        {confirm.length > 0 && !pwMatch && (
                            <span className="font-body font-medium text-[12px] leading-[1.4] text-error -mt-2">
                                Passwords don&apos;t match yet.
                            </span>
                        )}
                        {sameAsCurrent && (
                            <span className="font-body font-medium text-[12px] leading-[1.4] text-error -mt-2">
                                Pick something different from your current password.
                            </span>
                        )}
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
        </DialogScrim>
    )
}
