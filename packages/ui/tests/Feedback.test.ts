import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ModalTitle } from '../src/Brand'
import { ErrorScreen, LoadingScreen, LoadingStatus, StaffSkeleton, StepProgress } from '../src/Feedback'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const noop = () => {}

describe('ErrorScreen', () => {
    it('keeps the red well for real faults', () => {
        const markup = html(createElement(ErrorScreen, { title: "This score couldn't be loaded", message: 'Try again.' }))
        expect(markup).toContain('bg-error-container')
        expect(markup).toContain('<h1 ')
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
        expect(withRetry).toMatch(/bg-surface-container-low[^"]*">Back to library<\/button>/)
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
})

describe('ModalTitle', () => {
    it('can take programmatic focus without drawing a ring', () => {
        const markup = html(createElement(ModalTitle, { tabIndex: -1, children: 'What do you play?' }))
        expect(markup).toMatch(/^<h2 tabindex="-1" class="[^"]*outline-none/)
    })
})
