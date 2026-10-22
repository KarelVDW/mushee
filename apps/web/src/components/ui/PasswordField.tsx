'use client'

import { Icon, TextField, type TextFieldProps } from '@mushee/ui'
import { useState } from 'react'

import { PasswordStrength } from './Password'

const MASK_PLACEHOLDER = '••••••••••••'

interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'rightSlot'> {
    /**
     * Controlled reveal state, so one toggle can drive several fields. Left out, the
     * field keeps its own. Passed without `onToggleShown`, the field follows a
     * sibling's toggle and shows no eye button of its own.
     */
    shown?: boolean
    onToggleShown?: () => void
}

/** The reveal state a field (or group) shows: the caller's when controlled, else its own. */
function useReveal(shown: boolean | undefined, onToggleShown: (() => void) | undefined) {
    const [ownShown, setOwnShown] = useState(false)
    return shown !== undefined ? { revealed: shown, toggle: onToggleShown } : { revealed: ownShown, toggle: () => setOwnShown((v) => !v) }
}

/** A TextField for a password, with the eye button that reveals it. */
export function PasswordField({ shown, onToggleShown, placeholder = MASK_PLACEHOLDER, ...field }: PasswordFieldProps) {
    const { revealed, toggle } = useReveal(shown, onToggleShown)
    return (
        <TextField
            {...field}
            type={revealed ? 'text' : 'password'}
            placeholder={placeholder}
            rightSlot={toggle && <RevealButton revealed={revealed} onToggle={toggle} />}
        />
    )
}

// One fixed name with the state in aria-pressed: a label that flipped to "Hide password"
// would rename the control under a screen-reader user's cursor.
function RevealButton({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-label="Show password"
            aria-pressed={revealed}
            className="bg-transparent border-0 text-outline cursor-pointer p-1 inline-flex rounded-sm focus-ring">
            <Icon name={revealed ? 'eye-off' : 'eye'} size={18} />
        </button>
    )
}

interface NewPasswordFieldsProps {
    value: string
    onChange: (v: string) => void
    confirm: string
    onConfirmChange: (v: string) => void
    confirmLabel: string
    /** Controlled reveal state (see PasswordField), for a form whose other fields follow the same toggle. */
    shown?: boolean
    onToggleShown?: () => void
    autoFocus?: boolean
    /** A further error for the confirmation field, on its own line after the mismatch hint. */
    confirmError?: string
}

/**
 * A new password asked for twice: the field with the eye toggle (which reveals
 * both), the strength meter, and the confirmation with its mismatch hint. Fully
 * controlled — the form decides validity with isAcceptablePassword plus its own
 * rules. Renders siblings for a `flex-col gap-4` form.
 */
export function NewPasswordFields({
    value,
    onChange,
    confirm,
    onConfirmChange,
    confirmLabel,
    shown,
    onToggleShown,
    autoFocus,
    confirmError,
}: NewPasswordFieldsProps) {
    const { revealed, toggle } = useReveal(shown, onToggleShown)
    const mismatch = confirm.length > 0 && value !== confirm
    // A mismatch and the caller's error can both apply; each keeps its own line.
    const errors = [mismatch && "Passwords don't match yet.", confirmError].filter((e): e is string => !!e)
    return (
        <>
            <PasswordField
                label="New password"
                value={value}
                onChange={onChange}
                shown={revealed}
                onToggleShown={toggle}
                autoFocus={autoFocus}
            />
            <div className="-mt-2">
                <PasswordStrength password={value} />
            </div>
            <PasswordField
                label={confirmLabel}
                value={confirm}
                onChange={onConfirmChange}
                shown={revealed}
                error={
                    errors.length > 0
                        ? errors.map((e) => (
                              <span key={e} className="block">
                                  {e}
                              </span>
                          ))
                        : undefined
                }
            />
        </>
    )
}
