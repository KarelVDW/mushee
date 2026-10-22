import type { MidiPlayer, ScheduledNote } from '@mushee/playback/MidiPlayer'

/** The MidiPlayer surface the schedulers use: a settable clock and a `schedule` that logs every note. */
export function fakePlayer() {
    const scheduled: ScheduledNote[] = []
    const player = {
        currentTime: 0,
        schedule(note: ScheduledNote) {
            scheduled.push(note)
        },
    } satisfies Pick<MidiPlayer, 'currentTime' | 'schedule'>
    return { player, scheduled }
}
