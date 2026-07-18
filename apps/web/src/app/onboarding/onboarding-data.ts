// The BACKGROUNDS/GOALS/REFERRAL_SOURCES keys are enum-validated by the API
// (apps/api/src/onboarding/dto/update-onboarding.dto.ts) — change both sides together.
export const BACKGROUNDS: [string, string, string][] = [
    ['curious', 'Just curious', 'I tinker with melodies sometimes.'],
    ['hobbyist', 'Hobbyist', 'I play for myself — a few years in.'],
    ['student', 'Student', 'Studying music formally right now.'],
    ['teacher', 'Teacher', 'I teach others to play or compose.'],
    ['composer', 'Composer / arranger', 'I write or arrange music regularly.'],
    ['professional', 'Performing musician', 'I gig, record, or perform for a living.'],
]

export const GOALS: [string, string, string][] = [
    ['transcribe', 'Capture my playing', 'Record what I play or hum and turn it into notation.'],
    ['compose', 'Write new music', 'Compose original pieces from scratch.'],
    ['arrange', 'Arrange existing music', 'Adapt pieces for my instrument or ensemble.'],
    ['teach', 'Make teaching materials', 'Create exercises and pieces for my students.'],
    ['learn', 'Learn notation', 'Get comfortable reading and writing sheet music.'],
]

// The instruments themselves come from the shared model list (`Instrument.selectableByCategory()`),
// the same one the score pickers use. These are the survey-only escape hatches appended after it.
// "Other" still means the user plays something; only NO_INSTRUMENT_OPTION means they don't.
export const NO_INSTRUMENT_OPTION = "I don't play (yet)"
export const NON_INSTRUMENT_OPTIONS = ['Other', NO_INSTRUMENT_OPTION]

export const REFERRAL_SOURCES: [string, string][] = [
    ['friend', 'A friend told me'],
    ['search', 'Found it on a search engine'],
    ['social', 'Saw it on social media'],
    ['youtube', 'Saw it on YouTube'],
    ['teacher', 'My teacher recommended it'],
    ['blog', 'Read about it in an article'],
    ['other', 'Somewhere else'],
]

// Steps in order: verify email, mic permission, name, background, goal, instruments, source, tier.
// The names are the `step` property on onboarding funnel events — keep them stable.
export const STEP_NAMES = ['verify', 'mic', 'name', 'background', 'goal', 'instruments', 'source', 'plan'] as const
export const STEP_COUNT = STEP_NAMES.length
