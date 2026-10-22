'use client'

import type { ReactNode } from 'react'

import { PrimaryButton, SecondaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import { useSession } from '@/lib/auth-client'
import { LIBRARY_PATH, withNext } from '@/lib/nextPath'
import { BETA_MODE, type PlanTier, withPlan } from '@/lib/plans'

/** The CTA's copy for each kind of visitor — one table, so the pages can't drift apart. */
const LABELS = {
    authed: 'Open library',
    beta: 'Request access',
    signedOut: 'Start free',
} as const

interface GetStartedButtonProps {
    /** Where on the page the CTA sits: the `location` of the landing_cta_clicked event. */
    location: string
    size?: 'md' | 'lg'
    emphasis?: 'flat' | 'pop'
    variant?: 'primary' | 'secondary'
    fullWidth?: boolean
    /** Where a visitor who signs up from here lands once onboarding is done (e.g. the score they were viewing). */
    next?: string
    /**
     * The tier this CTA names (a pricing card's): signup carries it into onboarding's plan
     * step, and a signed-in visitor goes to Settings' plan dialog instead of the library.
     */
    plan?: PlanTier['id']
    /** Replaces the label table (the tier cards name their tier instead), and drops the forward arrow with it. */
    children?: ReactNode
}

/**
 * The marketing pages' get-started CTA: a link into the library for a signed-in
 * visitor (or to the plan it names), into signup otherwise, tracked as
 * landing_cta_clicked on the way. A client island, so the pages around it
 * don't need the session themselves.
 */
export function GetStartedButton({
    location,
    size,
    emphasis,
    variant = 'primary',
    fullWidth,
    next,
    plan,
    children,
}: GetStartedButtonProps) {
    const { data: session } = useSession()
    const authed = !!session?.user

    const href = authed ? (plan ? withPlan('/settings', plan) : LIBRARY_PATH) : withPlan(withNext('/signup', next), plan)
    const onClick = () => track('landing_cta_clicked', { location, beta: BETA_MODE })
    const label = children ?? (authed ? LABELS.authed : BETA_MODE ? LABELS.beta : LABELS.signedOut)

    if (variant === 'secondary') {
        return (
            <SecondaryButton href={href} onClick={onClick} fullWidth={fullWidth}>
                {label}
            </SecondaryButton>
        )
    }
    return (
        <PrimaryButton
            href={href}
            onClick={onClick}
            size={size}
            emphasis={emphasis}
            fullWidth={fullWidth}
            icon={children == null ? 'arrow-right' : undefined}>
            {label}
        </PrimaryButton>
    )
}
