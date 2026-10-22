// The BACKGROUNDS/GOALS/REFERRAL_SOURCES keys are enum-validated by the API
// (apps/api/src/onboarding/dto/update-onboarding.dto.ts) — change both sides together.

/** One answer card: the key the API stores, and the copy the card shows. */
interface OnboardingOption {
    readonly key: string
    readonly title: string
    readonly body: string
}

export const BACKGROUNDS: readonly OnboardingOption[] = [
    { key: 'curious', title: 'Just curious', body: 'I tinker with melodies sometimes.' },
    { key: 'hobbyist', title: 'Hobbyist', body: 'I play for myself — a few years in.' },
    { key: 'student', title: 'Student', body: 'Studying music formally right now.' },
    { key: 'teacher', title: 'Teacher', body: 'I teach others to play or compose.' },
    { key: 'composer', title: 'Composer / arranger', body: 'I write or arrange music regularly.' },
    { key: 'professional', title: 'Performing musician', body: 'I gig, record, or perform for a living.' },
]

export const GOALS: readonly OnboardingOption[] = [
    { key: 'transcribe', title: 'Capture my playing', body: 'Record what I play or hum and turn it into notation.' },
    { key: 'compose', title: 'Write new music', body: 'Compose original pieces from scratch.' },
    { key: 'arrange', title: 'Arrange existing music', body: 'Adapt pieces for my instrument or ensemble.' },
    { key: 'teach', title: 'Make teaching materials', body: 'Create exercises and pieces for my students.' },
    { key: 'learn', title: 'Learn notation', body: 'Get comfortable reading and writing sheet music.' },
]

// The instruments themselves come from the shared model list (`Instrument.selectableByCategory()`),
// the same one the score pickers use. These are the survey-only escape hatches appended after it.
// "Other" still means the user plays something; only NO_INSTRUMENT_OPTION means they don't.
export const NO_INSTRUMENT_OPTION = "I don't play (yet)"
export const NON_INSTRUMENT_OPTIONS = ['Other', NO_INSTRUMENT_OPTION]

export const REFERRAL_SOURCES: readonly { readonly key: string; readonly label: string }[] = [
    { key: 'friend', label: 'A friend told me' },
    { key: 'search', label: 'Found it on a search engine' },
    { key: 'social', label: 'Saw it on social media' },
    { key: 'youtube', label: 'Saw it on YouTube' },
    { key: 'teacher', label: 'My teacher recommended it' },
    { key: 'blog', label: 'Read about it in an article' },
    { key: 'other', label: 'Somewhere else' },
]

// Steps in order: verify email, mic permission, name, background, goal, instruments, source, tier.
// The names are the `step` property on onboarding funnel events — keep them stable.
export const STEP_NAMES = ['verify', 'mic', 'name', 'background', 'goal', 'instruments', 'source', 'plan'] as const
export type StepName = (typeof STEP_NAMES)[number]
export const STEP_COUNT = STEP_NAMES.length
