import { NoteEventTime } from '@spotify/basic-pitch'
import { readFile, writeFile } from 'fs/promises'
import { sortBy } from 'lodash-es'

import { decodeAudio } from './utils/decodeAudio'
import { notesToMidi } from './utils/notesToMidi'

async function convert() {
    const buffer = await readFile('./data/test.mp3')
    const notes = await decodeAudio(buffer)

    const ticksPerBeat = 480
    const bpm = 125

    // Sort notes by start time
    const sortedNotes = sortBy(
        notes,
        (note) => note.startTimeSeconds,
        (note) => note.pitchMidi,
    )

    const sixteenthNoteLength = ticksPerBeat / 4

    let activeNote: NoteEventTime | null = null
    const resultNotes: NoteEventTime[] = []
    for (const note of sortedNotes) {
        if (!activeNote) activeNote = note
        if (note.startTimeSeconds === activeNote.startTimeSeconds) {
            if (note.pitchMidi === activeNote.pitchMidi) {
                activeNote.durationSeconds = Math.max(activeNote.durationSeconds, note.durationSeconds)
            }
            continue
        }
        if (note.pitchMidi === activeNote.pitchMidi) {
            if (note.startTimeSeconds < activeNote.startTimeSeconds + activeNote.durationSeconds) {
                activeNote.durationSeconds = note.durationSeconds - activeNote.startTimeSeconds + note.startTimeSeconds
                continue
            }
        }
        if (Math.abs(note.pitchMidi - activeNote.pitchMidi) > 12 /* ignore jump of more than an octave */) {
            continue
        }
        resultNotes.push(activeNote)
        activeNote = note
    }

    const offset = resultNotes[0]?.startTimeSeconds ?? 0
    const roundedNotes = resultNotes
        .map(({ pitchBends: _, amplitude: __, ...note }) => ({
            ...note,
            startTimeSeconds: note.startTimeSeconds - offset,
        }))
        .map((note) => {
            const roundedStart = (Math.round((note.startTimeSeconds * 1000) / sixteenthNoteLength) * sixteenthNoteLength) / 1000
            const roundedEnd = (Math.round((note.durationSeconds * 1000) / sixteenthNoteLength) * sixteenthNoteLength) / 1000
            return {
                ...note,
                startTimeSeconds: roundedStart,
                startDiff: note.startTimeSeconds - roundedStart,
                durationSeconds: roundedEnd,
                endDiff: note.durationSeconds - roundedEnd,
            }
        })

    // Write notes to JSON file
    await writeFile('./data/notes.json', JSON.stringify(roundedNotes, null, 2))

    const midiBuffer = notesToMidi(resultNotes, { ticksPerBeat, bpm })
    await writeFile('./data/output.mid', midiBuffer)
}

convert()
    .then((result) => {
        console.log('Conversion complete', result)
    })
    .catch((error) => {
        console.error('Error during conversion:', error)
    })
