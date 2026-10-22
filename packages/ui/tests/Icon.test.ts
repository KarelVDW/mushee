import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Icon, type IconName, iconNames } from '../src/Icon'

describe('Icon', () => {
    it('renders an svg sized to the requested box', () => {
        const html = renderToStaticMarkup(createElement(Icon, { name: 'check', size: 24 }))
        expect(html).toContain('<svg')
        expect(html).toContain('viewBox="0 0 24 24"')
        expect(html).toContain('width="24"')
        expect(html).toContain('height="24"')
    })

    it('renders drawable shapes for every registered glyph', () => {
        for (const name of iconNames) {
            const html = renderToStaticMarkup(createElement(Icon, { name }))
            expect(html, `empty glyph for "${name}"`).toMatch(/<(path|circle|rect)[ /]/)
        }
    })

    // One glyph, one meaning: the later UX packages pull these from the registry (metronome
    // ≠ audio-lines for recordings; square = stop; globe = can't reach Solkey; wifi-off = offline).
    it('carries every glyph the editor, library and error screens need', () => {
        const needed: IconName[] = [
            'metronome',
            'audio-lines',
            'square',
            'more-horizontal',
            'pencil',
            'check',
            'chevron-up',
            'chevron-down',
            'info',
            'globe',
            'wifi-off',
            'plus',
            'minus',
            'refresh-cw',
        ]
        for (const name of needed) expect(iconNames, name).toContain(name)
    })

    // Call sites are type-checked against the registry (IconName); the runtime
    // fallback only guards names that slip past the type, e.g. via casts.
    it('falls back to the crossed-box marker for unknown names', () => {
        const html = renderToStaticMarkup(createElement(Icon, { name: 'not-a-real-icon' as IconName }))
        expect(html).toContain('<rect x="6.5"')
    })
})
