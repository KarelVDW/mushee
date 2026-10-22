'use client'

import { useState } from 'react'

import { DialogPanel, Eyebrow, Icon, type IconName, PasswordField, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { formatPurgeDate } from '@/lib/dates'
import { useRequestAccountDeletion } from '@/lib/queries'

interface DeleteAccountDialogProps {
    email?: string
    onCancel: () => void
    onConfirm: () => void
    /** Runs Settings' "Download my data" without closing the dialog, so the scores can be kept first. */
    onExport: () => void
    /** The download is being prepared. */
    exporting: boolean
}

const PHRASE = 'delete my account'

const LOSS_ITEMS: [icon: IconName, text: string][] = [
    ['music', 'All your scores and recordings'],
    ['user', 'Your profile, settings and plan'],
    ['link', 'Share links — they stop working once deletion completes'],
]

export function DeleteAccountDialog({ email, onCancel, onConfirm, onExport, exporting }: DeleteAccountDialogProps) {
    const [typed, setTyped] = useState('')
    const [pw, setPw] = useState('')
    const [ack, setAck] = useState(false)
    const deletion = useRequestAccountDeletion()
    const done = deletion.isSuccess
    const purgeDate = formatPurgeDate(deletion.data?.purgeAfter)

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

    // The field label is an uppercase eyebrow like every other; the phrase inside it keeps its own
    // case and quotes, so it reads exactly as it is typed.
    const labelEl = (
        <>
            Type{' '}
            <span className="normal-case tracking-normal font-body font-semibold text-[13px] leading-none text-on-surface">“{PHRASE}”</span>{' '}
            to confirm
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
                        <strong className="text-on-surface">{email ?? 'your email'}</strong> {purgeDate ? 'before' : 'within'}{' '}
                        <strong className="text-on-surface">{purgeDate ?? '7 days'}</strong> and everything will be right where you left it.
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
                        <div className="-mb-1">
                            <TertiaryButton onClick={onExport}>
                                {exporting ? 'Preparing your download…' : 'Download my data first'}
                            </TertiaryButton>
                        </div>
                    </div>

                    <TextField label={labelEl} value={typed} onChange={setTyped} placeholder={PHRASE} autoFocus />
                    <PasswordField label="Your password" value={pw} onChange={setPw} autoComplete="current-password" error={errorMessage} />

                    <label className="flex items-start gap-2.5 cursor-pointer pointer-coarse:min-h-10 pointer-coarse:items-center">
                        <input
                            type="checkbox"
                            checked={ack}
                            onChange={(e) => setAck(e.target.checked)}
                            className="mt-0.75 pointer-coarse:mt-0 size-4 pointer-coarse:size-5 shrink-0 accent-error cursor-pointer"
                        />
                        <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            I understand that after 7 days this can&apos;t be undone.
                        </span>
                    </label>
                </div>
            )}
        </DialogPanel>
    )
}
