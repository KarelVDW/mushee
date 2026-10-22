'use client'

/** The server's minimum (better-auth's default) — no password shorter than this is ever accepted. */
export const PASSWORD_MIN_LENGTH = 8

/** The rule a new password at signup must meet, as its always-visible field hint. */
export const SIGNUP_PASSWORD_HINT = 'At least 8 characters.'

/** The rule {@link isAcceptablePassword} applies where a new password is asked for twice (reset, change). */
export const NEW_PASSWORD_HINT = 'At least 8 characters, with a number, a symbol or both upper and lower case — or 12 characters or more.'

/** Meter labels by score; a password still under the minimum reads "Keep going" (see {@link PasswordStrength}). */
const PW_LABELS = ['Too short', 'Weak', 'OK', 'Strong', 'Strong'] as const

/**
 * Shared strength heuristic. Under the server's 8-character minimum a password scores 0, so
 * the meter never calls a too-short one OK; from 8 on, length (8, 12), mixed case, and
 * digits/symbols each add a bar.
 */
export function scorePassword(pw: string): number {
    if (pw.length < PASSWORD_MIN_LENGTH) return 0
    let s = 1
    if (pw.length >= 12) s++
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++
    return Math.min(s, 4)
}

/**
 * The rule a new password must pass where we ask for one twice (reset, change):
 * at least "OK" on the meter, and the confirmation matches. Signup shows no meter
 * and doesn't apply it — whether it should is an open product decision.
 */
export function isAcceptablePassword(pw: string, confirm: string): boolean {
    return scorePassword(pw) >= 2 && pw === confirm
}

/** What the meter says: nothing for an empty field, "Keep going" while it's under the minimum. */
export function strengthLabel(pw: string): string | null {
    if (!pw) return null
    if (pw.length < PASSWORD_MIN_LENGTH) return 'Keep going'
    return PW_LABELS[scorePassword(pw)]
}

/**
 * Four-bar password-strength meter with its label, driven by {@link scorePassword}. Hidden
 * until the first keystroke, so an empty field never reads as an error the user hasn't made;
 * the label is plain 12px sentence case, not an eyebrow.
 */
export function PasswordStrength({ password }: { password: string }) {
    const label = strengthLabel(password)
    if (!label) return null
    const score = scorePassword(password)
    return (
        <div className="flex items-center gap-2">
            {[0, 1, 2, 3].map((i) => {
                const filled = i < score
                const tone = !filled
                    ? 'bg-surface-container'
                    : score <= 1
                      ? 'bg-error-container'
                      : score === 2
                        ? 'bg-secondary-soft'
                        : 'bg-primary-container'
                return <div key={i} className={`h-0.75 flex-1 rounded-sm transition-colors duration-150 ease-solkey ${tone}`} />
            })}
            <span className="ml-1 font-body font-medium text-[12px] leading-none text-on-surface-variant whitespace-nowrap">{label}</span>
        </div>
    )
}
