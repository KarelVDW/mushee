import { describe, expect, it } from 'vitest'

import { positiveIntSetting } from '../../src/config/env'

/** The API's one parser for numeric settings (rate limits, body size, recording caps). */

describe('positiveIntSetting', () => {
    it('reads a positive integer, and uses the default when unset', () => {
        expect(positiveIntSetting(undefined, 30)).toBe(30)
        expect(positiveIntSetting('45', 30)).toBe(45)
    })

    it('falls back to the default on a malformed or non-positive setting instead of disabling the limiter', () => {
        expect(positiveIntSetting('abc', 30)).toBe(30)
        expect(positiveIntSetting('0', 30)).toBe(30)
        expect(positiveIntSetting('-5', 30)).toBe(30)
        expect(positiveIntSetting('', 60_000)).toBe(60_000)
    })
})
