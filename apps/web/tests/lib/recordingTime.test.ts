import { describe, expect, it } from 'vitest'

import {
    formatAllowance,
    formatAllowanceShort,
    formatRecordingTime,
    formatResetTime,
    formatResetWhen,
    formatTimeLeftToday,
    nextBudgetReset,
} from '@/lib/recordingTime'

/** The unbreakable space the formatters keep before AM/PM. */
const NBSP = '\u00a0'

describe('formatRecordingTime', () => {
    it('writes seconds as a stopwatch reading, minutes unpadded, hours when needed', () => {
        expect(formatRecordingTime(0)).toBe('0:00')
        expect(formatRecordingTime(7)).toBe('0:07')
        expect(formatRecordingTime(42)).toBe('0:42')
        expect(formatRecordingTime(125)).toBe('2:05')
        expect(formatRecordingTime(3600)).toBe('1:00:00')
        expect(formatRecordingTime(3725)).toBe('1:02:05')
    })

    it('rounds down and never goes negative', () => {
        expect(formatRecordingTime(41.6)).toBe('0:41')
        expect(formatRecordingTime(-3)).toBe('0:00')
    })
})

describe('formatAllowance', () => {
    it('names whole minutes and hours in words, never as a clock', () => {
        expect(formatAllowance(180)).toBe('3\u00a0minutes')
        expect(formatAllowance(1200)).toBe('20\u00a0minutes')
        expect(formatAllowance(1800)).toBe('30\u00a0minutes')
        expect(formatAllowance(10800)).toBe('3\u00a0hours')
        expect(formatAllowance(28800)).toBe('8\u00a0hours')
    })

    it('uses the singular for one unit, and seconds below a minute', () => {
        expect(formatAllowance(60)).toBe('1\u00a0minute')
        expect(formatAllowance(3600)).toBe('1\u00a0hour')
        expect(formatAllowance(1)).toBe('1\u00a0second')
        expect(formatAllowance(30)).toBe('30\u00a0seconds')
        expect(formatAllowance(0)).toBe('0\u00a0seconds')
    })

    it('falls back to the short form for amounts between whole units', () => {
        expect(formatAllowance(160)).toBe('2\u00a0min 40\u00a0sec')
        expect(formatAllowance(5400)).toBe('1\u00a0h 30\u00a0min')
    })

    it('rounds down and never goes negative', () => {
        expect(formatAllowance(180.9)).toBe('3\u00a0minutes')
        expect(formatAllowance(-5)).toBe('0\u00a0seconds')
    })
})

describe('formatAllowanceShort', () => {
    it('counts minutes and seconds below an hour, dropping empty parts', () => {
        expect(formatAllowanceShort(180)).toBe('3\u00a0min')
        expect(formatAllowanceShort(156)).toBe('2\u00a0min 36\u00a0sec')
        expect(formatAllowanceShort(45)).toBe('45\u00a0sec')
        expect(formatAllowanceShort(3599)).toBe('59\u00a0min 59\u00a0sec')
    })

    it('counts hours and minutes from an hour on', () => {
        expect(formatAllowanceShort(10800)).toBe('3\u00a0h')
        expect(formatAllowanceShort(10740)).toBe('2\u00a0h 59\u00a0min')
        expect(formatAllowanceShort(3661)).toBe('1\u00a0h 1\u00a0min')
    })

    it('says zero plainly and rounds down', () => {
        expect(formatAllowanceShort(0)).toBe('0\u00a0sec')
        expect(formatAllowanceShort(0.9)).toBe('0\u00a0sec')
        expect(formatAllowanceShort(-1)).toBe('0\u00a0sec')
        expect(formatAllowanceShort(59.99)).toBe('59\u00a0sec')
    })
})

describe('formatTimeLeftToday', () => {
    it("says what is left of today's recording", () => {
        expect(formatTimeLeftToday(60)).toBe('1\u00a0min left today')
        expect(formatTimeLeftToday(30)).toBe('30\u00a0sec left today')
        expect(formatTimeLeftToday(160)).toBe('2\u00a0min 40\u00a0sec left today')
        expect(formatTimeLeftToday(10740)).toBe('2\u00a0h 59\u00a0min left today')
    })
})

describe('nextBudgetReset', () => {
    it('is the coming midnight UTC', () => {
        expect(nextBudgetReset(new Date('2026-10-22T15:30:00Z')).toISOString()).toBe('2026-10-23T00:00:00.000Z')
        expect(nextBudgetReset(new Date('2026-10-22T23:59:59Z')).toISOString()).toBe('2026-10-23T00:00:00.000Z')
        expect(nextBudgetReset(new Date('2026-12-31T08:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z')
    })

    it('moves on to the next day exactly at midnight UTC', () => {
        expect(nextBudgetReset(new Date('2026-10-22T00:00:00Z')).toISOString()).toBe('2026-10-23T00:00:00.000Z')
    })
})

describe('formatResetTime', () => {
    const now = new Date('2026-10-22T15:00:00Z')

    it("shows midnight UTC in the viewer's clock, 12- or 24-hour by locale", () => {
        expect(formatResetTime(undefined, now, 'en-US', 'America/New_York')).toBe(`8:00${NBSP}PM`)
        expect(formatResetTime(undefined, now, 'en-US', 'Europe/Brussels')).toBe(`2:00${NBSP}AM`)
        expect(formatResetTime(undefined, now, 'nl-BE', 'Europe/Brussels')).toBe('02:00')
        expect(formatResetTime(undefined, now, 'en-GB', 'Europe/London')).toBe('01:00')
    })

    it('prefers the API timestamp when it sends one', () => {
        expect(formatResetTime('2026-10-23T04:30:00Z', now, 'en-US', 'UTC')).toBe(`4:30${NBSP}AM`)
        expect(formatResetTime(new Date('2026-10-23T04:30:00Z'), now, 'nl-BE', 'UTC')).toBe('04:30')
    })
})

describe('formatResetWhen', () => {
    it('says tonight when the reset falls later the same evening (the Americas)', () => {
        // 11:00 in New York (EDT), midnight UTC is 20:00 local.
        const now = new Date('2026-10-22T15:00:00Z')
        expect(formatResetWhen(undefined, now, 'en-US', 'America/New_York')).toBe(`tonight at 8:00${NBSP}PM`)
        expect(formatResetWhen(undefined, now, 'en-US', 'America/Los_Angeles')).toBe(`tonight at 5:00${NBSP}PM`)
    })

    it('says tomorrow when the reset falls on the next local day (Europe)', () => {
        // 17:00 in Brussels (CEST), midnight UTC is 02:00 tomorrow.
        const now = new Date('2026-10-22T15:00:00Z')
        expect(formatResetWhen(undefined, now, 'en-US', 'Europe/Brussels')).toBe(`tomorrow at 2:00${NBSP}AM`)
        expect(formatResetWhen(undefined, now, 'nl-BE', 'Europe/Brussels')).toBe('tomorrow at 02:00')
        // In winter (CET) the same reset is 01:00.
        expect(formatResetWhen(undefined, new Date('2026-12-01T15:00:00Z'), 'en-US', 'Europe/Brussels')).toBe(`tomorrow at 1:00${NBSP}AM`)
        expect(formatResetWhen(undefined, new Date('2026-12-01T15:00:00Z'), 'nl-BE', 'Europe/Brussels')).toBe('tomorrow at 01:00')
    })

    it('says tonight for a small-hours reset after local midnight but before the UTC one', () => {
        // 00:30 in Brussels (CET) is 23:30 UTC the day before: the reset is 01:00, later tonight.
        const now = new Date('2026-11-30T23:30:00Z')
        expect(formatResetWhen(undefined, now, 'nl-BE', 'Europe/Brussels')).toBe('tonight at 01:00')
    })

    it('says today for a daytime reset later the same day (East Asia)', () => {
        // 03:00 in Tokyo, midnight UTC is 09:00 local.
        const now = new Date('2026-10-21T18:00:00Z')
        expect(formatResetWhen(undefined, now, 'en-US', 'Asia/Tokyo')).toBe(`today at 9:00${NBSP}AM`)
        // 10:00 in Tokyo: today's reset has passed, the next is tomorrow morning.
        expect(formatResetWhen(undefined, new Date('2026-10-22T01:00:00Z'), 'en-US', 'Asia/Tokyo')).toBe(`tomorrow at 9:00${NBSP}AM`)
    })

    it('treats the exact UTC boundary as the start of a new day', () => {
        // Midnight UTC itself: the allowance just refilled, the next reset is a day away.
        const now = new Date('2026-10-23T00:00:00Z')
        expect(formatResetWhen(undefined, now, 'en-US', 'UTC')).toBe(`tomorrow at 12:00${NBSP}AM`)
        expect(formatResetWhen(undefined, now, 'nl-BE', 'UTC')).toBe('tomorrow at 00:00')
        expect(formatResetWhen(undefined, new Date('2026-10-22T23:59:59Z'), 'nl-BE', 'UTC')).toBe('tomorrow at 00:00')
    })

    it("uses the API's resetsAt when it is still ahead", () => {
        const now = new Date('2026-10-22T15:00:00Z')
        expect(formatResetWhen('2026-10-22T22:00:00Z', now, 'en-US', 'UTC')).toBe(`tonight at 10:00${NBSP}PM`)
        expect(formatResetWhen(new Date('2026-10-23T06:00:00Z'), now, 'nl-BE', 'UTC')).toBe('tomorrow at 06:00')
        expect(formatResetWhen('2026-10-25T06:00:00Z', now, 'en-US', 'UTC')).toBe(`on Sunday at 6:00${NBSP}AM`)
    })

    it('falls back to the next midnight UTC for a missing, past or unreadable resetsAt', () => {
        const now = new Date('2026-10-22T15:00:00Z')
        const expected = `tonight at 8:00${NBSP}PM`
        expect(formatResetWhen(null, now, 'en-US', 'America/New_York')).toBe(expected)
        expect(formatResetWhen('2026-10-22T10:00:00Z', now, 'en-US', 'America/New_York')).toBe(expected)
        expect(formatResetWhen('not a date', now, 'en-US', 'America/New_York')).toBe(expected)
    })

    it("defaults to the viewer's locale, time zone and clock", () => {
        expect(formatResetWhen()).toMatch(/^(tonight|today|tomorrow) at \S+/)
        expect(formatResetTime()).toMatch(/\d/)
    })
})
