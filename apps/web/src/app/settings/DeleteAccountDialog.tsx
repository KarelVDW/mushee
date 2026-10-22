'use client'

import { useState } from 'react'

import { DialogPanel, Eyebrow, Icon, type IconName, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { formatPurgeDate } from '@/lib/dates'
import { useRequestAccountDeletion } from '@/lib/queries'

interface DeleteAccountDialogProps {
    email?: string
    onCancel: () => void
    onConfirm: () => void
}

const PHRASE = 'delete my account'

const LOSS_ITEMS: [icon: IconName, text: string][] = [
    ['music', 'All your scores and recordings'],
    ['user', 'Your profile, settings and plan'],
    ['link', 'Share links — they stop working once deletion completes'],
]

export function DeleteAccountDialog({ email, onCancel, onConfirm }: DeleteAccountDialogProps) {
    const [typed, setTyped] = useState('')
    const [pw, setPw] = useState('')
    const [ack, setAck] = useState(false)
    const deletion = useRequestAccountDeletion()
    const done = deletion.isSuccess

    const phraseMatch = typed.trim().toLowerCase() === PHRASE
    const canSubmit = phraseMatch && pw.length > 0 && ack && !deletion.isPending

    const submit = () => {
        if (!canSubmit) return
        deletion.mutate(pw, {
            onSuccess: () => {
                // Give the goodbye note a beat to land; sessions are already
                // revoked server-side, so onConfirm just signs out + redirects.
                setTimeout(() => onConfirm(), 3000)
            },
        })
    }

    const errorMessage = !deletion.error
        ? null
        : deletion.error instanceof ApiError && deletion.error.status === 401
          ? "That password doesn't match your account. Try again."
          : "Couldn't schedule the deletion. Please try again."

    const labelEl = (
        <>
            Type <span className="font-mono font-medium text-[13px] leading-none text-on-surface">{PHRASE}</span> to confirm
        </>
    )

    return (
        <DialogPanel
            title={done ? 'Account scheduled for deletion.' : 'Delete your account?'}
            subtitle={
                done
                    ? 'Signing you out…'
                    : 'Your account is deactivated today and permanently deleted after 7 days. Signing back in before then undoes it.'
            }
            onClose={done ? undefined : onCancel}
            width={520}
            footer={
                done ? null : (
                    <>
                        <TertiaryButton onClick={onCancel}>Keep my account</TertiaryButton>
                        <PrimaryButton danger disabled={!canSubmit} onClick={submit}>
                            {deletion.isPending ? 'Scheduling…' : 'Delete account'}
                        </PrimaryButton>
                    </>
                )
            }>
            {done ? (
                <div className="flex items-center gap-3.5 pb-4">
                    <span className="w-10 h-10 rounded-full bg-surface-container text-on-surface-variant inline-flex items-center justify-center shrink-0">
                        <Icon name="check" size={20} />
                    </span>
                    <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                        Thanks for being here. Changed your mind? Sign back in with{' '}
                        <strong className="text-on-surface">{email ?? 'your email'}</strong> before{' '}
                        <strong className="text-on-surface">{formatPurgeDate(deletion.data?.purgeAfter, 'in 7 days')}</strong> and everything will be
                        right where you left it.
                    </span>
                </div>
            ) : (
                <div className="flex flex-col gap-4 pb-4">
                    <div className="bg-surface-container-low rounded-md p-4 flex flex-col gap-2.5">
                        <Eyebrow>After 7 days you&apos;ll lose</Eyebrow>
                        <div className="flex flex-col gap-1.5">
                            {LOSS_ITEMS.map(([icon, text]) => (
                                <div key={text} className="flex items-center gap-2.5">
                                    <Icon name={icon} size={16} />
                                    <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface">{text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <TextField label={labelEl} value={typed} onChange={setTyped} placeholder={PHRASE} autoFocus />
                    <TextField
                        label="Your password"
                        value={pw}
                        onChange={setPw}
                        type="password"
                        placeholder="••••••••••••"
                        error={errorMessage}
                    />

                    <label className="flex items-start gap-2.5 cursor-pointer">
                        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.75 accent-error" />
                        <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            I understand that after the 7-day grace period this can&apos;t be undone, and that exporting my scores first is
                            recommended.
                        </span>
                    </label>
                </div>
            )}
        </DialogPanel>
    )
}
