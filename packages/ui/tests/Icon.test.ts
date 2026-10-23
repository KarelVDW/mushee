import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Icon, ICON_SIZES, type IconName, iconNames, strokeWidthFor } from '../src/Icon'

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

    it('draws a true 2px stroke from 16px up, thinning to 1.75px at 14px and 1.5px at 12px', () => {
        const stroke = (size: number) =>
            Number(/stroke-width="([^"]+)"/.exec(renderToStaticMarkup(createElement(Icon, { name: 'check', size })))?.[1])
        expect(stroke(12)).toBe(3)
        expect(stroke(16)).toBe(3)
        expect(stroke(24)).toBe(2)
        expect(stroke(32)).toBe(1.5)
        // Rendered width = viewBox units × size / 24.
        for (const [size, px] of [
            [12, 1.5],
            [14, 1.75],
            [16, 2],
            [20, 2],
            [24, 2],
            [32, 2],
        ] as const) {
            expect(strokeWidthFor(size) * (size / 24)).toBeCloseTo(px, 2)
        }
    })

    it('takes a named size from the scale and keeps 18px as the default', () => {
        expect(ICON_SIZES).toEqual({ xs: 12, sm: 16, md: 20, lg: 24, xl: 32 })
        const xs = renderToStaticMarkup(createElement(Icon, { name: 'check', size: 'xs' }))
        expect(xs).toContain('width="12"')
        expect(xs).toContain('style="width:12px;height:12px"')
        expect(renderToStaticMarkup(createElement(Icon, { name: 'check', size: 'xl' }))).toContain('width="32"')
        expect(renderToStaticMarkup(createElement(Icon, { name: 'check' }))).toContain('width="18"')
    })

    // Call sites are type-checked against the registry (IconName); the runtime
    // fallback only guards names that slip past the type, e.g. via casts.
    it('falls back to the crossed-box marker for unknown names', () => {
        const html = renderToStaticMarkup(createElement(Icon, { name: 'not-a-real-icon' as IconName }))
        expect(html).toContain('<rect x="6.5"')
    })
})
