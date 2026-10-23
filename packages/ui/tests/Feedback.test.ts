import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ModalTitle } from '../src/Brand'
import { Alert, ErrorScreen, LoadingScreen, LoadingStatus, Skeleton, StaffSkeleton, StepProgress, SuccessMark } from '../src/Feedback'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const noop = () => {}

describe('Alert', () => {
    it('keeps the loud error_container slab for real faults', () => {
        const markup = html(createElement(Alert, { children: "Couldn't load your plan." }))
        expect(markup).toMatch(/^<div class="bg-error-container text-on-error-container rounded-md px-3\.5 py-3 [^"]*" role="alert">/)
    })

    it('has a quiet form tone: error_soft, on_surface text, the icon and inline links in error', () => {
        const markup = html(
            createElement(Alert, { tone: 'form', children: createElement('a', { href: '/reset-password' }, 'reset your password') }),
        )
        expect(markup).toMatch(/^<div class="bg-error-soft text-on-surface rounded-md px-4 py-3 [^"]*" role="alert">/)
        expect(markup).toContain('[&amp;_a]:text-error [&amp;_a]:font-medium [&amp;_a]:underline')
        expect(markup).toMatch(/<span class="[^"]*shrink-0 text-error"/)
        expect(markup).not.toContain('bg-error-container')
    })
})

describe('ErrorScreen', () => {
    it('keeps the red well for real faults', () => {
        const markup = html(createElement(ErrorScreen, { title: "This score couldn't be loaded", message: 'Try again.' }))
        expect(markup).toContain('size-14 rounded-full inline-flex items-center justify-center bg-error-container')
        expect(markup.match(/<h1 /g)).toHaveLength(1)
    })

    it('puts the wordmark top-left, linking home, and centres one stack under it', () => {
        const markup = html(createElement(ErrorScreen, { title: 'Score not found', message: 'It may have been deleted.' }))
        expect(markup).toMatch(
            /^<div class="min-h-dvh bg-surface"><div class="h-16 px-5 sm:px-8 flex items-center"><a [^>]*aria-label="Solkey home"[^>]*href="\/"/,
        )
        expect(markup).toContain('style="font-size:24px"')
        expect(markup).toContain('grid place-items-center min-h-[calc(100dvh-4rem)] pb-[8vh]')
        expect(markup).toMatch(/<h1 class="[^"]*text-\[28px\] leading-\[1\.15\][^"]*">Score not found<\/h1>/)
        expect(markup).toMatch(/<p class="mt-3 [^"]*text-\[15px\][^"]*text-pretty max-w-\[36ch\][^"]*">/)
        // The stack holds the slot, the title, the body and the actions — no wordmark of its own.
        const stack = markup.slice(markup.indexOf('grid place-items-center'))
        expect(stack).not.toContain('Solkey</span>')
    })

    it('shows no well for a missing page, only the illustration it is given', () => {
        const plain = html(createElement(ErrorScreen, { tone: 'missing', title: 'Score not found', message: 'y' }))
        expect(plain).not.toContain('bg-error-container')
        expect(plain).not.toContain('size-14')
        const drawn = html(
            createElement(ErrorScreen, {
                tone: 'missing',
                title: 'Score not found',
                message: 'y',
                illustration: createElement('svg', { 'data-mark': 'rest' }),
            }),
        )
        expect(drawn).toContain('<div class="h-16 mb-6 flex items-center justify-center"><svg data-mark="rest"></svg></div>')
    })

    it('renders a described second action as a SecondaryButton, a link with href', () => {
        const markup = html(
            createElement(ErrorScreen, {
                tone: 'missing',
                title: "This page doesn't exist",
                message: 'y',
                backHref: '/',
                backLabel: 'Go to the home page',
                secondaryAction: { label: 'Sign in', href: '/login' },
            }),
        )
        expect(markup).toMatch(
            /<a [^>]*class="[^"]*bg-\(--control-fill\)[^"]*"[^>]*href="\/login"[^>]*>Sign in<\/a>|<a [^>]*href="\/login"[^>]*class="[^"]*bg-\(--control-fill\)[^"]*"[^>]*>Sign in<\/a>/,
        )
        const button = html(
            createElement(ErrorScreen, { title: 'x', message: 'y', secondaryAction: { label: 'Back to library', onClick: noop } }),
        )
        expect(button).toMatch(/<button type="button" class="[^"]*bg-\(--control-fill\)[^"]*">Back to library<\/button>/)
    })

    it('shows a neutral globe well for unreachable states, with the caller copy while online', () => {
        const markup = html(
            createElement(ErrorScreen, {
                tone: 'unreachable',
                title: "Solkey isn't answering",
                message: "We can't reach Solkey right now.",
                onRetry: noop,
            }),
        )
        expect(markup).toContain('bg-surface-container-high text-on-surface-variant')
        expect(markup).not.toContain('bg-error-container')
        expect(markup).toContain('Solkey isn&#x27;t answering')
    })

    it('says "Trying again…" in an always-mounted status line while a retry runs', () => {
        const idle = html(createElement(ErrorScreen, { title: 'x', message: 'y', onRetry: noop }))
        expect(idle).toMatch(/<p role="status"[^>]*><\/p>/)
        const busy = html(createElement(ErrorScreen, { title: 'x', message: 'y', onRetry: noop, retrying: true }))
        expect(busy).toMatch(/<p role="status"[^>]*>Trying again…<\/p>/)
        expect(html(createElement(ErrorScreen, { title: 'x', message: 'y' }))).not.toContain('role="status"')
    })

    it('makes the way back primary when there is nothing to retry, secondary next to a retry', () => {
        const alone = html(
            createElement(ErrorScreen, { title: 'Score not found', message: 'y', onBack: noop, backLabel: 'Back to library' }),
        )
        expect(alone).toContain('bg-primary-container')
        expect(alone).toContain('Back to library')
        const withRetry = html(
            createElement(ErrorScreen, { title: 'x', message: 'y', onRetry: noop, onBack: noop, backLabel: 'Back to library' }),
        )
        expect(withRetry).toMatch(/bg-\(--control-fill\)[^"]*">Back to library<\/button>/)
    })

    it('renders the way back as a link and takes an extra quiet action', () => {
        const markup = html(
            createElement(ErrorScreen, {
                title: "This page doesn't exist",
                message: 'The link may be old, or the address was mistyped.',
                backHref: '/',
                backLabel: 'Go to the home page',
                secondaryAction: createElement('a', { href: '/login' }, 'Sign in'),
            }),
        )
        expect(markup).toMatch(/<a [^>]*href="\/"[^>]*>.*Go to the home page/)
        expect(markup).toContain('<a href="/login">Sign in</a>')
    })
})

describe('loading', () => {
    it('announces the stage politely over a pulsing, reduced-motion-safe staff skeleton', () => {
        const markup = html(createElement(LoadingStatus, { message: 'Opening your score…' }))
        expect(markup).toContain('<div role="status" aria-live="polite"')
        expect(markup).toContain('Opening your score…')
        expect(markup).toContain('animate-solkey-pulse motion-reduce:animate-none')
        expect(markup).not.toContain('Still loading')
    })

    it('draws five staff lines, hidden from assistive tech', () => {
        const markup = html(createElement(StaffSkeleton))
        expect(markup).toContain('aria-hidden="true"')
        expect(markup.match(/h-px bg-outline-variant/g)).toHaveLength(5)
    })

    it('takes the caller skeleton and puts a test id on the full-page screen', () => {
        const markup = html(
            createElement(LoadingScreen, {
                testId: 'editor-loading',
                message: 'Opening your score…',
                skeleton: createElement('i', null, 'rows'),
            }),
        )
        expect(markup).toContain('data-testid="editor-loading"')
        expect(markup).toContain('<i>rows</i>')
        expect(markup).not.toContain('h-px bg-outline-variant')
        expect(markup).toContain('Solkey')
    })
})

describe('StepProgress', () => {
    it('is a progressbar that names the step', () => {
        const markup = html(createElement(StepProgress, { step: 2, total: 8 }))
        expect(markup).toContain('role="progressbar"')
        expect(markup).toContain('aria-valuenow="3"')
        expect(markup).toContain('aria-valuemax="8"')
        expect(markup).toContain('aria-valuetext="Step 3 of 8"')
    })

    it('fills each reached segment with a bar that sweeps in from the left', () => {
        const markup = html(createElement(StepProgress, { step: 1, total: 4 }))
        expect(markup.match(/overflow-hidden bg-surface-container/g)).toHaveLength(4)
        const bars = [
            ...markup.matchAll(
                /bg-primary-container h-full origin-left transition-transform duration-\(--t-flow\) ease-solkey (scale-x-\d+)/g,
            ),
        ].map((m) => m[1])
        expect(bars).toEqual(['scale-x-100', 'scale-x-100', 'scale-x-0', 'scale-x-0'])
    })
})

describe('SuccessMark', () => {
    it('is a quiet primary_soft disc with a check at half its size', () => {
        const big = html(createElement(SuccessMark, { size: 56 }))
        expect(big).toMatch(/^<span aria-hidden="true" class="size-14 [^"]*rounded-full bg-primary-soft text-on-primary-soft/)
        expect(big).toContain('width="28"')
        const small = html(createElement(SuccessMark, { size: 40 }))
        expect(small).toContain('size-10')
        expect(small).toContain('width="20"')
        expect(big).not.toContain('bg-primary-container')
    })
})

describe('Skeleton', () => {
    it('is a hidden, pulsing surface_container block, static under reduced motion', () => {
        expect(html(createElement(Skeleton, { className: 'h-3 w-40' }))).toBe(
            '<span aria-hidden="true" class="block animate-solkey-pulse motion-reduce:animate-none rounded-md bg-surface-container h-3 w-40"></span>',
        )
    })

    it('lets the caller set its own corner and fill', () => {
        const circle = html(createElement(Skeleton, { className: 'size-11 rounded-full bg-surface-container-low' }))
        expect(circle).not.toContain('rounded-md')
        expect(circle).not.toContain('bg-surface-container ')
        expect(circle).toContain('size-11 rounded-full bg-surface-container-low')
    })
})

describe('ModalTitle', () => {
    it('can take programmatic focus without drawing a ring', () => {
        const markup = html(createElement(ModalTitle, { tabIndex: -1, children: 'What do you play?' }))
        expect(markup).toMatch(/^<h2 tabindex="-1" class="[^"]*outline-none/)
    })
})
