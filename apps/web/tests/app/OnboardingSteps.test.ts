import { Instrument } from '@mushee/notation/model'
import { act, createElement, type ReactElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyEmail, sendVerificationOtp, openMic, endSession } = vi.hoisted(() => ({
    verifyEmail: vi.fn(),
    sendVerificationOtp: vi.fn(),
    openMic: vi.fn(),
    endSession: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ emailOtp: { verifyEmail, sendVerificationOtp } }))
vi.mock('@/lib/Microphone', () => ({ Microphone: { open: openMic, endSession } }))

import { LEGACY_STEP_NAMES, onboardingSteps } from '@/app/onboarding/onboarding-data'
import { AboutStep, InstrumentsStep, type MicState, MicStep, VERIFIED_ADVANCE_MS, VerifyStep } from '@/app/onboarding/OnboardingSteps'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount: (() => void) | undefined

beforeEach(() => {
    verifyEmail.mockReset()
    sendVerificationOtp.mockReset()
    openMic.mockReset()
    endSession.mockReset()
})

afterEach(() => {
    unmount?.()
    unmount = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
})

function mount(element: ReactElement): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(element))
    unmount = () => {
        act(() => root.unmount())
        host.remove()
    }
    return host
}

/** Let pending promise callbacks (the mocked auth calls) and their state updates land. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve()
    })
}

/** Type into a React-controlled input the way a user (or an autofill) does. */
function type(input: HTMLInputElement, value: string) {
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

const buttons = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('button')]
const buttonNamed = (host: HTMLElement, name: string) => buttons(host).find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)
function click(element: Element | undefined | null) {
    if (!element) throw new Error('nothing to click')
    act(() => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
}

const titleRef = { current: null }

describe('onboardingSteps', () => {
    it('gives an organic signup four steps, with no plan to pick', () => {
        expect(onboardingSteps(null, false)).toEqual(['verify', 'instruments', 'mic', 'about'])
        expect(onboardingSteps('free', false)).toEqual(['verify', 'instruments', 'mic', 'about'])
    })

    it('adds the plan step only for a paid pricing card, and never in the beta', () => {
        expect(onboardingSteps('pro', false)).toEqual(['verify', 'instruments', 'mic', 'about', 'plan'])
        expect(onboardingSteps('arranger', false)).toHaveLength(5)
        expect(onboardingSteps('pro', true)).toEqual(['verify', 'instruments', 'mic', 'about'])
    })

    it('maps every step name the old eight-step funnel used onto the step that asks it now', () => {
        expect(Object.keys(LEGACY_STEP_NAMES).sort()).toEqual([
            'background',
            'goal',
            'instruments',
            'mic',
            'name',
            'plan',
            'source',
            'verify',
        ])
        expect(LEGACY_STEP_NAMES.background).toBe('about')
        expect(LEGACY_STEP_NAMES.goal).toBe('about')
        expect(LEGACY_STEP_NAMES.source).toBe('about')
        expect(LEGACY_STEP_NAMES.name).toBeNull()
    })
})

describe('VerifyStep', () => {
    function renderVerify(props: { verified?: boolean; onAdvance?: () => void; onVerified?: () => void } = {}) {
        return mount(
            createElement(VerifyStep, {
                titleRef,
                userEmail: 'robin@example.com',
                sessionEmail: 'robin@example.com',
                verified: props.verified ?? false,
                onVerified: props.onVerified ?? (() => {}),
                onAdvance: props.onAdvance ?? (() => {}),
                onStartOver: () => {},
            }),
        )
    }
    const codeInput = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input') as HTMLInputElement

    it('asks for the code on a numeric keypad with one-time-code autofill, and has no Verify button', () => {
        const host = renderVerify()
        const input = codeInput(host)
        expect(host.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent).toBe('6-digit code')
        expect(input.inputMode).toBe('numeric')
        expect(input.autocomplete).toBe('one-time-code')
        expect(buttonNamed(host, 'Verify')).toBeUndefined()
    })

    it('submits on the sixth digit — not before — keeping digits only', async () => {
        verifyEmail.mockResolvedValue({ error: null })
        const onVerified = vi.fn()
        const host = renderVerify({ onVerified })
        type(codeInput(host), '12345')
        expect(verifyEmail).not.toHaveBeenCalled()
        type(codeInput(host), '123 456')
        await settle()
        expect(verifyEmail).toHaveBeenCalledWith({ email: 'robin@example.com', otp: '123456' })
        expect(onVerified).toHaveBeenCalled()
    })

    it('says a wrong code in plain words under the field, never the library message', async () => {
        verifyEmail.mockResolvedValue({ error: { code: 'INVALID_OTP', message: 'Invalid OTP' } })
        const host = renderVerify()
        type(codeInput(host), '111111')
        await settle()
        const input = codeInput(host)
        expect(input.getAttribute('aria-invalid')).toBe('true')
        const describedBy = input.getAttribute('aria-describedby') ?? ''
        expect(host.querySelector(`#${CSS.escape(describedBy)}`)?.textContent).toBe(
            "That code doesn't match. Check the newest email from us, or send a new code.",
        )
        expect(host.textContent).not.toContain('Invalid OTP')
    })

    it('sends a fresh code by itself when the old one has expired', async () => {
        verifyEmail.mockResolvedValue({ error: { code: 'OTP_EXPIRED', message: 'OTP expired' } })
        sendVerificationOtp.mockResolvedValue({ error: null })
        const host = renderVerify()
        type(codeInput(host), '222222')
        await settle()
        expect(sendVerificationOtp).toHaveBeenCalledWith({ email: 'robin@example.com', type: 'email-verification' })
        expect(host.textContent).toContain("That code has expired, so we've sent you a new one.")
        expect(codeInput(host).value).toBe('')
    })

    it('shows the verified row, then moves on by itself after a moment', () => {
        vi.useFakeTimers()
        const onAdvance = vi.fn()
        const host = renderVerify({ verified: true, onAdvance })
        expect(host.querySelector('[role="status"]')?.textContent).toBe('Email verified.')
        act(() => {
            vi.advanceTimersByTime(VERIFIED_ADVANCE_MS - 1)
        })
        expect(onAdvance).not.toHaveBeenCalled()
        act(() => {
            vi.advanceTimersByTime(1)
        })
        expect(onAdvance).toHaveBeenCalledTimes(1)
    })

    it('offers a new code and a way back from a mistyped email', async () => {
        sendVerificationOtp.mockResolvedValue({ error: null })
        const host = renderVerify()
        expect(host.textContent).toContain("Can't find it? Check your spam folder, or send a new code.")
        expect(buttonNamed(host, 'Start over')).toBeDefined()
        click(buttonNamed(host, 'send a new code'))
        await settle()
        expect(buttonNamed(host, 'new code sent')).toBeDefined()
    })
})

describe('InstrumentsStep', () => {
    function renderInstruments(initial: Instrument[] = []) {
        function Harness() {
            const [value, setValue] = useState<Instrument[]>(initial)
            return createElement(InstrumentsStep, { titleRef, value, onChange: setValue })
        }
        return mount(createElement(Harness))
    }
    const chordLine = /play the tune one note at a time — Solkey writes melodies\./

    it('allows no pick at all, and adds the melody line only once a chordal instrument is picked', () => {
        const host = renderInstruments()
        expect(host.textContent).not.toMatch(chordLine)
        click(buttonNamed(host, 'Pick Voice'))
        expect(host.textContent).not.toMatch(chordLine)
        click(buttonNamed(host, 'Pick Guitar'))
        expect(host.textContent).toContain('On guitar, play the tune one note at a time — Solkey writes melodies.')
        click(buttonNamed(host, 'Pick Guitar'))
        expect(host.textContent).not.toMatch(chordLine)
    })

    it('keeps every other instrument behind "All instruments", opened already when one of them is picked', () => {
        const closed = renderInstruments()
        expect(buttonNamed(closed, 'Pick Cello')).toBeUndefined()
        click(buttons(closed).find((b) => b.textContent === 'All instruments'))
        click(buttonNamed(closed, 'Pick Cello'))
        expect(buttonNamed(closed, 'Pick Cello')?.getAttribute('aria-pressed')).toBe('true')
        unmount?.()

        const open = renderInstruments([Instrument.Cello])
        expect(buttonNamed(open, 'Pick Cello')?.getAttribute('aria-pressed')).toBe('true')
    })
})

describe('AboutStep', () => {
    function renderAbout() {
        function Harness() {
            const [background, setBackground] = useState<string | null>(null)
            const [goal, setGoal] = useState<string | null>(null)
            const [source, setSource] = useState<string | null>(null)
            const [detail, setDetail] = useState('')
            return createElement(AboutStep, {
                titleRef,
                background,
                onBackgroundChange: setBackground,
                goal,
                onGoalChange: setGoal,
                source,
                onSourceChange: setSource,
                sourceDetail: detail,
                onSourceDetailChange: setDetail,
            })
        }
        return mount(createElement(Harness))
    }
    const group = (host: HTMLElement, question: string) => {
        const label = [...host.querySelectorAll('span')].find((s) => s.textContent === question)
        return host.querySelector<HTMLElement>(`[role="radiogroup"][aria-labelledby="${CSS.escape(label?.id ?? '')}"]`)
    }
    const radios = (el: HTMLElement | null) => [...(el?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]

    it('asks three optional questions as radio groups named by the question, nothing chosen up front', () => {
        const host = renderAbout()
        for (const question of ['Where are you with music?', 'What do you want to do first?', 'How did you find Solkey?']) {
            const answers = radios(group(host, question))
            expect(answers.length).toBeGreaterThan(0)
            expect(answers.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
        }
    })

    it('checks an answer with a check mark as well as the fill, and moves with the arrow keys', () => {
        const host = renderAbout()
        const background = group(host, 'Where are you with music?')
        click(radios(background).find((r) => r.textContent === 'Hobbyist'))
        const hobbyist = radios(background).find((r) => r.textContent === 'Hobbyist')
        expect(hobbyist?.getAttribute('aria-checked')).toBe('true')
        expect(hobbyist?.querySelector('svg')).not.toBeNull()
        act(() => {
            hobbyist?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        })
        expect(radios(background).find((r) => r.getAttribute('aria-checked') === 'true')?.textContent).toBe('Student')
    })

    it('asks for more about the source only once one is picked', () => {
        const host = renderAbout()
        expect(host.querySelector('input')).toBeNull()
        click(radios(group(host, 'How did you find Solkey?'))[0])
        expect(host.querySelector('input')).not.toBeNull()
    })
})

describe('MicStep', () => {
    const stream = () => {
        const stop = vi.fn()
        return { stop, stream: { getTracks: () => [{ stop }] } as unknown as MediaStream }
    }
    function renderMic(onAdvance = vi.fn(), onGuideOpenChange = vi.fn()) {
        function Harness() {
            const [micState, setMicState] = useState<MicState>('idle')
            return createElement(MicStep, { titleRef, micState, setMicState, onGuideOpenChange, onAdvance })
        }
        return mount(createElement(Harness))
    }

    it("lets 'Not now' skip the mic and only the mic", () => {
        const onAdvance = vi.fn()
        const host = renderMic(onAdvance)
        click(buttonNamed(host, 'Not now'))
        expect(onAdvance).toHaveBeenCalledTimes(1)
        expect(openMic).not.toHaveBeenCalled()
    })

    it('releases the permission stream at once off an iPhone', async () => {
        const { stop, stream: granted } = stream()
        openMic.mockResolvedValue(granted)
        const host = renderMic()
        click(buttonNamed(host, 'Allow microphone'))
        await settle()
        expect(stop).toHaveBeenCalled()
        expect(host.textContent).toContain("You're ready to record. Tap Continue.")
    })

    it('walks an iPhone through Wide Spectrum over the open mic, then remembers it and lets go', async () => {
        vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
        const { stop, stream: granted } = stream()
        openMic.mockResolvedValue(granted)
        const onAdvance = vi.fn()
        const onGuideOpenChange = vi.fn()
        const host = renderMic(onAdvance, onGuideOpenChange)
        click(buttonNamed(host, 'Allow microphone'))
        await settle()

        expect(stop).not.toHaveBeenCalled()
        expect(onGuideOpenChange).toHaveBeenLastCalledWith(true)
        expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
            '1Swipe down from the top-right corner to open Control Center.',
            '2Tap Mic Mode.',
            '3Choose Wide Spectrum, then come back here.',
        ])
        click(buttonNamed(host, 'Done — Wide Spectrum is on'))
        expect(stop).toHaveBeenCalled()
        expect(endSession).toHaveBeenCalled()
        expect(onGuideOpenChange).toHaveBeenLastCalledWith(false)
        expect(onAdvance).toHaveBeenCalledTimes(1)
        expect(window.localStorage.getItem('solkey:mic-mode-guide')).not.toBeNull()
    })

    it("lets go of the iPhone's open mic when the step closes another way", async () => {
        vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
        const { stop, stream: granted } = stream()
        openMic.mockResolvedValue(granted)
        const host = renderMic()
        click(buttonNamed(host, 'Allow microphone'))
        await settle()
        expect(stop).not.toHaveBeenCalled()
        unmount?.()
        unmount = undefined
        expect(stop).toHaveBeenCalled()
        expect(host.isConnected).toBe(false)
        expect(window.localStorage.getItem('solkey:mic-mode-guide')).toBeNull()
    })
})
