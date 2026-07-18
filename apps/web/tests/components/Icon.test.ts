import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Icon, iconNames } from '@/components/ui/Icon'

/**
 * Every icon name referenced by app call sites — static `name="…"` props,
 * dynamic ternaries, `icon:` fields in plan/feature data, and nav tuples.
 * A name missing from the registry renders the crossed-box fallback, so this
 * list keeps the registry in sync with usage.
 */
const USED_NAMES = [
    'arrow-left',
    'arrow-right',
    'audio-lines',
    'bell',
    'check',
    'circle',
    'cloud',
    'delete',
    'download',
    'error',
    'external-link',
    'eye',
    'eye-off',
    'feather',
    'gem',
    'info',
    'keyboard',
    'link',
    'mail',
    'mic',
    'mic-off',
    'music',
    'pause',
    'pencil',
    'play',
    'plus',
    'refresh-cw',
    'rotate-ccw',
    'search',
    'shield',
    'sliders-horizontal',
    'sparkles',
    'square',
    'trash-2',
    'user',
    'users',
    'x',
]

describe('Icon', () => {
    it('has a glyph for every name used in the app', () => {
        for (const name of USED_NAMES) {
            expect(iconNames, `missing glyph for "${name}"`).toContain(name)
        }
    })

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

    it('falls back to the crossed-box marker for unknown names', () => {
        const html = renderToStaticMarkup(createElement(Icon, { name: 'not-a-real-icon' }))
        expect(html).toContain('<rect x="6.5"')
    })
})
