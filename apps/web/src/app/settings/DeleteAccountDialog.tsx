'use client'

import { useState } from 'react'

import { DialogPanel, DialogScrim, Eyebrow, Icon, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'

interface DeleteAccountDialogProps {
    email?: string
    onCancel: () => void
    onConfirm: () => void
}

const PHRASE = 'delete my account'

const LOSS_ITEMS: [icon: string, text: string][] = [
    ['music', '12 scores, including 3 collaborations'],
    ['download', 'All MIDI and PDF exports'],
    ['link', "4 share links — they'll stop working immediately"],
]

export function DeleteAccountDialog({ email, onCancel, onConfirm }: DeleteAccountDialogProps) {
    const [stage, setStage] = useState<'confirm' | 'done'>('confirm')
    const [typed, setTyped] = useState('')
    const [pw, setPw] = useState('')
    const [ack, setAck] = useState(false)

    const phraseMatch = typed.trim().toLowerCase() === PHRASE
    const canSubmit = phraseMatch && pw.length > 0 && ack

    // Mock: production would POST /api/account/delete with the password as
    // re-auth, then sign out + redirect.
    const submit = () => {
        if (!canSubmit) return
        setStage('done')
        setTimeout(() => onConfirm(), 1400)
    }

    const labelEl = (
        <>
            Type <span className="font-mono font-medium text-[13px] leading-none text-on-surface">{PHRASE}</span> to confirm
        </>
    )

    return (
        <DialogScrim onDismiss={stage === 'done' ? undefined : onCancel}>
            <DialogPanel
                title={stage === 'done' ? 'Account deleted.' : 'Delete your account?'}
                eyebrow={
                    stage === 'done'
                        ? 'Signing you out…'
                        : 'This is permanent. Your scores, exports, and shared links will be removed within 24 hours.'
                }
                onClose={stage === 'done' ? undefined : onCancel}
                width={520}
                footer={
                    stage === 'done' ? null : (
                        <>
                            <TertiaryButton onClick={onCancel}>Keep my account</TertiaryButton>
                            <PrimaryButton danger disabled={!canSubmit} onClick={submit}>
                                Delete account
                            </PrimaryButton>
                        </>
                    )
                }>
                {stage === 'done' ? (
                    <div className="flex items-center gap-3.5 pb-4">
                        <span className="w-10 h-10 rounded-full bg-surface-container text-on-surface-variant inline-flex items-center justify-center shrink-0">
                            <Icon name="check" size={20} />
                        </span>
                        <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                            Thanks for being here. We&apos;ve sent a final confirmation to{' '}
                            <strong className="text-on-surface">{email ?? 'your email'}</strong>.
                        </span>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 pb-4">
                        <div className="bg-surface-container-low rounded-md p-4 flex flex-col gap-2.5">
                            <Eyebrow>You&apos;ll lose</Eyebrow>
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
                        <TextField label="Your password" value={pw} onChange={setPw} type="password" placeholder="••••••••••••" />

                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={ack}
                                onChange={(e) => setAck(e.target.checked)}
                                className="mt-0.75"
                                style={{ accentColor: 'var(--color-error)' }}
                            />
                            <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                                I understand this can&apos;t be undone, and that exporting my scores first is recommended.
                            </span>
                        </label>
                    </div>
                )}
            </DialogPanel>
        </DialogScrim>
    )
}
