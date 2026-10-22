import { BETA_MODE, isPaidTier, type PlanTier } from '@/lib/plans'

// The BACKGROUNDS/GOALS/REFERRAL_SOURCES keys are enum-validated by the API
// (apps/api/src/onboarding/dto/update-onboarding.dto.ts), and the admin console reads them —
// change both sides together.

/** One answer chip: the key the API stores, and the words the chip shows. */
interface OnboardingOption {
    readonly key: string
    readonly label: string
}

export const BACKGROUNDS: readonly OnboardingOption[] = [
    { key: 'curious', label: 'Just curious' },
    { key: 'hobbyist', label: 'Hobbyist' },
    { key: 'student', label: 'Student' },
    { key: 'teacher', label: 'Teacher' },
    { key: 'composer', label: 'Composer / arranger' },
    { key: 'professional', label: 'Performing musician' },
]

export const GOALS: readonly OnboardingOption[] = [
    { key: 'transcribe', label: 'Capture my playing' },
    { key: 'compose', label: 'Write new music' },
    { key: 'arrange', label: 'Arrange existing music' },
    { key: 'teach', label: 'Make teaching materials' },
    { key: 'learn', label: 'Learn notation' },
]

/** A source chip, and the one follow-up question its optional detail field asks (the field's label). */
interface ReferralSource extends OnboardingOption {
    readonly detailQuestion: string
}

export const REFERRAL_SOURCES: readonly ReferralSource[] = [
    { key: 'friend', label: 'A friend told me', detailQuestion: 'Who told you?' },
    { key: 'search', label: 'Found it on a search engine', detailQuestion: 'What did you search for?' },
    { key: 'social', label: 'Saw it on social media', detailQuestion: 'Where?' },
    { key: 'youtube', label: 'Saw it on YouTube', detailQuestion: 'Which channel?' },
    { key: 'teacher', label: 'My teacher recommended it', detailQuestion: 'Who told you?' },
    { key: 'blog', label: 'Read about it in an article', detailQuestion: 'Where?' },
    { key: 'other', label: 'Somewhere else', detailQuestion: 'Where?' },
]

/**
 * The onboarding steps. The names are the `step` property on the funnel events
 * (onboarding_step_completed, onboarding_skipped) — keep them stable:
 * - verify — the emailed 6-digit code;
 * - instruments — "What will you record?" (its instruments start the first score);
 * - mic — microphone access (and, on iPhones, the Wide Spectrum setting);
 * - about — the optional survey: background, goal and source on one screen;
 * - plan — only for a visitor who picked a paid plan on the pricing page.
 */
export type StepName = 'verify' | 'instruments' | 'mic' | 'about' | 'plan'

/**
 * Before 2026-10 onboarding had eight steps; the funnel events of that flow carry these step
 * names. Each maps to the step that asks the same thing now, so old and new funnels can be
 * stitched together: the name step is gone (signup asks for the name), and the three survey
 * screens merged into 'about', whose completed event carries the background, goal and source.
 */
export const LEGACY_STEP_NAMES: Readonly<Record<string, StepName | null>> = {
    verify: 'verify',
    mic: 'mic',
    name: null,
    background: 'about',
    goal: 'about',
    instruments: 'instruments',
    source: 'about',
    plan: 'plan',
}

const BASE_STEPS: readonly StepName[] = ['verify', 'instruments', 'mic', 'about']

/**
 * The steps this visitor sees, in order — and so what the progress bar counts. Everyone
 * starts on the free plan with nothing to pick; only a visitor who arrived from a paid
 * pricing card (?plan=<paid tier>) gets the plan step, with that tier chosen. The closed
 * beta sells nothing, so it never shows one (the done screen names the Beta plan instead).
 */
export function onboardingSteps(requestedPlan: PlanTier['id'] | null, betaMode: boolean = BETA_MODE): readonly StepName[] {
    return !betaMode && requestedPlan !== null && isPaidTier(requestedPlan) ? [...BASE_STEPS, 'plan'] : BASE_STEPS
}
