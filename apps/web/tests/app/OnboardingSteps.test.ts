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
import {
    AboutStep,
    type DoneDestination,
    DoneStep,
    InstrumentsStep,
    MIC_GRANTED_ADVANCE_MS,
    type MicState,
    MicStep,
    VERIFIED_ADVANCE_MS,
    VerifyStep,
} from '@/app/onboarding/OnboardingSteps'

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

    it('reads a wrong code out as it lands, from a live region that was there before it', async () => {
        verifyEmail.mockResolvedValue({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' } })
        const host = renderVerify()
        // The region right under the code box, empty and already listening.
        const live = codeInput(host).parentElement?.nextElementSibling
        expect(live?.getAttribute('aria-live')).toBe('polite')
        expect(live?.textContent).toBe('')
        type(codeInput(host), '333333')
        await settle()
        expect(codeInput(host).parentElement?.nextElementSibling).toBe(live)
        expect(live?.textContent).toBe('Too many tries. Send a new code to start again.')
        // Asking for a new code clears the stale error, so the next one is read out afresh.
        sendVerificationOtp.mockResolvedValue({ error: null })
        click(buttonNamed(host, 'send a new code'))
        await settle()
        expect(live?.textContent).toBe('')
    })

    it('announces "Email verified." in a status region that was there before it', () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const root = createRoot(host)
        const show = (verified: boolean) =>
            act(() =>
                root.render(
                    createElement(VerifyStep, {
                        titleRef,
                        userEmail: 'robin@example.com',
                        sessionEmail: 'robin@example.com',
                        verified,
                        onVerified: () => {},
                        onAdvance: () => {},
                        onStartOver: () => {},
                    }),
                ),
            )
        unmount = () => {
            act(() => root.unmount())
            host.remove()
        }
        show(false)
        const status = host.querySelector('[role="status"]')
        expect(status?.textContent).toBe('')
        show(true)
        expect(host.querySelector('[role="status"]')).toBe(status)
        expect(status?.textContent).toBe('Email verified.')
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

    it('asks for more about the source only once one is picked, one question per source in its label', () => {
        const host = renderAbout()
        expect(host.querySelector('input')).toBeNull()
        const sources = radios(group(host, 'How did you find Solkey?'))
        const labelOf = (input: HTMLInputElement | null) => host.querySelector(`label[for="${CSS.escape(input?.id ?? '')}"]`)?.textContent

        click(sources.find((r) => r.textContent === 'A friend told me'))
        const input = host.querySelector('input')
        expect(labelOf(input)).toBe('Who told you? (optional)')
        // The label asks; no placeholder poses a second question that vanishes on typing.
        expect(input?.placeholder ?? '').toBe('')

        click(sources.find((r) => r.textContent === 'Somewhere else'))
        expect(labelOf(host.querySelector('input'))).toBe('Where? (optional)')
    })
})

describe('MicStep', () => {
    const stream = () => {
        const stop = vi.fn()
        return { stop, stream: { getTracks: () => [{ stop }] } as unknown as MediaStream }
    }
    function renderMic(onAdvance = vi.fn(), onContinueHeldChange = vi.fn(), initial: MicState = 'idle') {
        function Harness() {
            const [micState, setMicState] = useState<MicState>(initial)
            return createElement(MicStep, { titleRef, micState, setMicState, onContinueHeldChange, onAdvance })
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

    it('off an iPhone, lets go of the stream at once and moves on by itself after a beat, Continue held meanwhile', async () => {
        vi.useFakeTimers()
        const { stop, stream: granted } = stream()
        openMic.mockResolvedValue(granted)
        const onAdvance = vi.fn()
        const onContinueHeldChange = vi.fn()
        const host = renderMic(onAdvance, onContinueHeldChange)
        // Words for any device: no "tap" on a desktop.
        expect(host.textContent).toContain('Your browser will ask for permission next.')
        click(buttonNamed(host, 'Allow microphone'))
        await settle()

        expect(stop).toHaveBeenCalled()
        expect(host.textContent).toContain("You're ready to record.")
        expect(host.textContent).not.toContain('Tap Continue')
        expect(onContinueHeldChange).toHaveBeenLastCalledWith(true)
        act(() => {
            vi.advanceTimersByTime(MIC_GRANTED_ADVANCE_MS - 1)
        })
        expect(onAdvance).not.toHaveBeenCalled()
        act(() => {
            vi.advanceTimersByTime(1)
        })
        expect(onAdvance).toHaveBeenCalledTimes(1)
    })

    it('lets go of the hold, and stays, when the step closes during that beat (Back)', async () => {
        vi.useFakeTimers()
        openMic.mockResolvedValue(stream().stream)
        const onAdvance = vi.fn()
        const onContinueHeldChange = vi.fn()
        const host = renderMic(onAdvance, onContinueHeldChange)
        click(buttonNamed(host, 'Allow microphone'))
        await settle()
        unmount?.()
        unmount = undefined
        expect(onContinueHeldChange).toHaveBeenLastCalledWith(false)
        act(() => {
            vi.advanceTimersByTime(MIC_GRANTED_ADVANCE_MS)
        })
        expect(onAdvance).not.toHaveBeenCalled()
    })

    it('waits for Continue when the mic was granted on an earlier visit to the step', () => {
        vi.useFakeTimers()
        const onAdvance = vi.fn()
        const onContinueHeldChange = vi.fn()
        const host = renderMic(onAdvance, onContinueHeldChange, 'granted')
        expect(host.textContent).toContain('Microphone connected.')
        act(() => {
            vi.advanceTimersByTime(MIC_GRANTED_ADVANCE_MS * 2)
        })
        expect(onAdvance).not.toHaveBeenCalled()
        expect(onContinueHeldChange).not.toHaveBeenCalledWith(true)
    })

    it('walks an iPhone through Wide Spectrum over the open mic, then remembers it and lets go', async () => {
        vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
        const { stop, stream: granted } = stream()
        openMic.mockResolvedValue(granted)
        const onAdvance = vi.fn()
        const onContinueHeldChange = vi.fn()
        const host = renderMic(onAdvance, onContinueHeldChange)
        click(buttonNamed(host, 'Allow microphone'))
        await settle()

        expect(stop).not.toHaveBeenCalled()
        expect(onContinueHeldChange).toHaveBeenLastCalledWith(true)
        expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
            '1Swipe down from the top-right corner to open Control Center.',
            '2Tap Mic Mode.',
            '3Choose Wide Spectrum, then come back here.',
        ])
        click(buttonNamed(host, 'Done — Wide Spectrum is on'))
        expect(stop).toHaveBeenCalled()
        expect(endSession).toHaveBeenCalled()
        expect(onContinueHeldChange).toHaveBeenLastCalledWith(false)
        expect(onAdvance).toHaveBeenCalledTimes(1)
        expect(window.localStorage.getItem('solkey:mic-mode-guide')).not.toBeNull()
    })

    it('keeps a blocked mic quiet: Try again recedes, and the one fix this browser needs is said once', async () => {
        vi.stubGlobal('navigator', {
            ...navigator,
            userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        })
        openMic.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
        const host = renderMic()
        click(buttonNamed(host, 'Allow microphone'))
        await settle()

        expect(host.textContent).toContain('Microphone blocked.')
        expect(host.textContent).toContain('No problem — the editor works without a mic, and recording will ask again when you need it.')
        // The fix as numbered steps, one action each, after its lead line.
        expect(host.textContent).toContain('To allow it now:')
        expect([...host.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual([
            '1Click the icon left of the web address.',
            '2Set Microphone to Allow.',
        ])
        expect(host.textContent).not.toContain('site settings')
        // A block is a choice, not a fault: no red well.
        expect(host.innerHTML).not.toContain('bg-error-container')
        expect(host.textContent).not.toContain('or just Continue')
        // A text button, not a second capsule beside the footer's Continue.
        const retry = buttons(host).find((b) => b.textContent === 'Try again')
        expect(retry?.className).toContain('bg-transparent')
        expect(buttonNamed(host, 'Not now')).toBeUndefined()

        openMic.mockResolvedValue(stream().stream)
        click(retry)
        await settle()
        expect(openMic).toHaveBeenCalledTimes(2)
        expect(host.textContent).toContain('Microphone connected.')
    })

    it('falls back to the general site-settings line where no browser path can be named', async () => {
        vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' })
        openMic.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
        const host = renderMic()
        click(buttonNamed(host, 'Allow microphone'))
        await settle()

        expect(host.textContent).toContain('Microphone blocked.')
        expect(host.textContent).not.toContain('To allow it now')
        expect(host.textContent).toContain("You can change this any time in your browser's site settings.")
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

describe('DoneStep', () => {
    function renderDone(destination: DoneDestination) {
        return mount(
            createElement(DoneStep, {
                titleRef,
                name: 'Robin Vale',
                destination,
                betaPlanName: 'Beta',
                planLine: null,
                firstInstrument: Instrument.Violin,
                creating: false,
                onRecordFirstMelody: () => {},
                onFinish: () => {},
            }),
        )
    }

    it('ends on a preview of the score the button opens, on the instrument it starts on, under the page h1', () => {
        const host = renderDone('first-melody')
        expect(host.querySelector('h1')?.textContent).toBe("You're all set, Robin.")
        const preview = host.querySelector('[aria-hidden="true"]')
        expect(preview?.textContent).toContain('My first melody')
        expect(preview?.textContent).toContain('Violin')
        expect(preview?.textContent).toContain('Ready to record')
        expect(preview?.querySelectorAll('line')).toHaveLength(5)
        // Only the closing CTA pops.
        expect(buttonNamed(host, 'Record my first melody')?.className).toContain('shadow-(--shadow-offset-3)')
    })

    it('shows the quiet success mark, not the preview, for the other ways out', () => {
        const host = renderDone('next')
        expect(host.textContent).not.toContain('Ready to record')
        expect(host.querySelector('span.bg-primary-soft')).not.toBeNull()
    })
})
