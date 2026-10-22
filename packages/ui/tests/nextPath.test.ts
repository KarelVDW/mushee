import { describe, expect, it } from 'vitest'

import { safeNextPath } from '../src/nextPath'

describe('safeNextPath', () => {
    it('keeps same-origin absolute paths', () => {
        expect(safeNextPath('/users/abc', '/')).toBe('/users/abc')
        expect(safeNextPath('/announcements?x=1', '/')).toBe('/announcements?x=1')
        expect(safeNextPath('/s/abc', '/scores')).toBe('/s/abc')
    })

    it('falls back when there is nothing to follow', () => {
        expect(safeNextPath(null, '/')).toBe('/')
        expect(safeNextPath(undefined, '/scores')).toBe('/scores')
        expect(safeNextPath('', '/beta')).toBe('/beta')
    })

    it('rejects everything that would leave the origin', () => {
        expect(safeNextPath('//evil.example', '/')).toBe('/')
        expect(safeNextPath('/\\evil.example', '/')).toBe('/')
        expect(safeNextPath('/\\/evil.example', '/')).toBe('/')
        expect(safeNextPath('https://evil.example/', '/')).toBe('/')
        expect(safeNextPath('javascript:alert(1)', '/')).toBe('/')
        for (const bad of ['/\\..\\//', '/\\\\x', '\\/x'])
            expect(new URL(safeNextPath(bad, '/'), 'https://a.test').origin).toBe('https://a.test')
    })
})
