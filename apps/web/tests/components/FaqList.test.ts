import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FaqList } from '@/components/marketing/FaqList'

const ITEMS = [
    { question: 'Can Solkey write chords?', answer: 'Solkey writes melodies.' },
    { question: 'Do I need to read music?', answer: 'No.' },
    { question: 'Does it work on my phone?', answer: 'Yes.' },
]

function render(props: Parameters<typeof FaqList>[0]): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(createElement(FaqList, props))
    return host
}

describe('FaqList', () => {
    it('renders every question as a native disclosure, the first one open', () => {
        const host = render({ items: ITEMS })
        const rows = [...host.querySelectorAll('details')]
        expect(rows.map((row) => row.querySelector('summary')?.textContent)).toEqual(ITEMS.map((item) => item.question))
        expect(rows.map((row) => row.open)).toEqual([true, false, false])
        expect(rows[1].querySelector('p')?.textContent).toBe('No.')
    })

    it('keeps each question a 44px, focus-ringed target with a decorative chevron', () => {
        const summary = render({ items: ITEMS }).querySelector('summary')
        expect(summary?.className).toContain('min-h-11')
        expect(summary?.className).toContain('focus-ring')
        expect(summary?.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
    })

    it('turns the chevron with the row, and not under reduced motion', () => {
        const chevron = render({ items: ITEMS }).querySelector('summary [aria-hidden="true"]')
        expect(chevron?.className).toContain('group-open:rotate-180')
        expect(chevron?.className).toContain('duration-150')
        expect(chevron?.className).toContain('motion-reduce:transition-none')
    })

    it('fills its rows for the section it sits on', () => {
        expect(render({ items: ITEMS }).querySelector('details')?.className).toContain('bg-surface-container-lowest')
        expect(render({ items: ITEMS, tone: 'low' }).querySelector('details')?.className).toContain('bg-surface-container-low')
    })
})
