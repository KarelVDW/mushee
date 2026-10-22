'use client'

import { Icon, TextField, type TextFieldProps } from '@mushee/ui'
import { useState } from 'react'

import { NEW_PASSWORD_HINT, PasswordStrength } from './Password'
import { Tooltip } from './Tooltip'

/** The autofill hint a password field gives password managers. */
type PasswordAutoComplete = 'current-password' | 'new-password' | 'off'

interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'rightSlot'> {
    /** `current-password` on sign-in and re-authentication, `new-password` wherever one is chosen. */
    autoComplete?: PasswordAutoComplete
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

/**
 * A TextField for a password, with the eye button that reveals it. Empty means empty: no
 * mask-dot placeholder that reads as "already filled in" (pass a worded one if it helps).
 */
export function PasswordField({ shown, onToggleShown, ...field }: PasswordFieldProps) {
    const { revealed, toggle } = useReveal(shown, onToggleShown)
    return (
        <TextField
            {...field}
            type={revealed ? 'text' : 'password'}
            rightSlot={toggle && <RevealButton revealed={revealed} onToggle={toggle} />}
        />
    )
}

// One fixed name with the state in aria-pressed: a label that flipped to "Hide password"
// would rename the control under a screen-reader user's cursor. The tooltip, which sighted
// users read, does say which way it goes. A 40px hit area (pulled in with negative margins so
// the field doesn't grow) around the 18px eye.
function RevealButton({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
    return (
        <Tooltip label={revealed ? 'Hide password' : 'Show password'}>
            <button
                type="button"
                onClick={onToggle}
                aria-label="Show password"
                aria-pressed={revealed}
                className="size-10 -my-2 -mr-2 bg-transparent border-0 text-outline cursor-pointer inline-flex items-center justify-center rounded-full focus-ring">
                <Icon name={revealed ? 'eye-off' : 'eye'} size={18} />
            </button>
        </Tooltip>
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
 * both) and the rule as its hint, the strength meter (once something is typed), and
 * the confirmation with its mismatch hint. Fully controlled — the form decides validity
 * with isAcceptablePassword plus its own rules. Renders siblings for a `flex-col gap-4` form.
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
                autoComplete="new-password"
                hint={NEW_PASSWORD_HINT}
            />
            {value && (
                <div className="-mt-2">
                    <PasswordStrength password={value} />
                </div>
            )}
            <PasswordField
                label={confirmLabel}
                value={confirm}
                onChange={onConfirmChange}
                shown={revealed}
                autoComplete="new-password"
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
