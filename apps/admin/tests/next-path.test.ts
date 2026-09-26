import { describe, expect, it } from 'vitest'

import { safeNextPath } from '../src/lib/nextPath'

describe('safeNextPath', () => {
    it('keeps same-origin paths and rejects everything that would leave the console', () => {
        expect(safeNextPath('/users/abc')).toBe('/users/abc')
        expect(safeNextPath('/announcements?x=1')).toBe('/announcements?x=1')
        expect(safeNextPath(null)).toBe('/')
        expect(safeNextPath('')).toBe('/')
        expect(safeNextPath('//evil.example')).toBe('/')
        expect(safeNextPath('/\\evil.example')).toBe('/')
        expect(safeNextPath('/\\/evil.example')).toBe('/')
        expect(safeNextPath('https://evil.example/')).toBe('/')
        expect(safeNextPath('javascript:alert(1)')).toBe('/')
        for (const bad of ['/\\..\\//', '/\\\\x', '\\/x'])
            expect(new URL(safeNextPath(bad), 'https://a.test').origin).toBe('https://a.test')
    })
})
