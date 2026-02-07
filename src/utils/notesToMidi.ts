import { NoteEventTime } from '@spotify/basic-pitch'
import { MidiData, MidiEvent, writeMidi } from 'midi-file'

export function notesToMidi(
    notes: Pick<NoteEventTime, 'startTimeSeconds' | 'durationSeconds' | 'pitchMidi'>[],
    options: {
        ticksPerBeat: number
        bpm: number
    },
) {
    // Create MIDI events from notes
    const trackEvents: Array<{
        time: number
        type: 'noteOn' | 'noteOff'
        noteNumber: number
        velocity: number
    }> = []

    const { ticksPerBeat, bpm } = options
    const tempo = 60_000_000 / bpm
    const secondsPerTick = tempo / 1_000_000 / ticksPerBeat

    for (const note of notes) {
        const startTick = Math.round(note.startTimeSeconds / secondsPerTick)
        const endTick = Math.round((note.startTimeSeconds + note.durationSeconds) / secondsPerTick)

        trackEvents.push({
            time: startTick,
            type: 'noteOn',
            noteNumber: note.pitchMidi,
            velocity: 64,
        })
        trackEvents.push({
            time: endTick,
            type: 'noteOff',
            noteNumber: note.pitchMidi,
            velocity: 0,
        })
    }

    // Sort events by time
    trackEvents.sort((a, b) => a.time - b.time)

    // Convert to delta times
    let lastTime = 0
    const midiTrackEvents: MidiEvent[] = [{ deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: tempo }]

    for (const event of trackEvents) {
        const deltaTime = event.time - lastTime
        lastTime = event.time

        midiTrackEvents.push({
            deltaTime,
            channel: 0,
            type: event.type,
            noteNumber: event.noteNumber,
            velocity: event.velocity,
        })
    }

    midiTrackEvents.push({ deltaTime: 0, meta: true, type: 'endOfTrack' })

    const midiData: MidiData = {
        header: {
            format: 0,
            numTracks: 1,
            ticksPerBeat,
        },
        tracks: [midiTrackEvents],
    }

    const midiBytes = writeMidi(midiData)
    return Buffer.from(midiBytes)
}
