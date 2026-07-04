'use client'

import { Eyebrow } from './Brand'

const PW_LABELS = ['Too short', 'Weak', 'OK', 'Strong', 'Strong'] as const

/** Shared strength heuristic — length, mixed case, and digits/symbols each add a bar. */
export function scorePassword(pw: string): number {
    if (!pw) return 0
    let s = 0
    if (pw.length >= 8) s++
    if (pw.length >= 12) s++
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++
    return Math.min(s, 4)
}

/** Four-bar password-strength meter with its label, driven by {@link scorePassword}. */
export function PasswordStrength({ password }: { password: string }) {
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
                return <div key={i} className={`h-0.75 flex-1 rounded-sm transition-colors duration-150 ease-sheemu ${tone}`} />
            })}
            <Eyebrow className="ml-1">{PW_LABELS[score]}</Eyebrow>
        </div>
    )
}
