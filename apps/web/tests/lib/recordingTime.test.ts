import { describe, expect, it } from 'vitest'

import { formatRecordingTime } from '@/lib/recordingTime'

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
