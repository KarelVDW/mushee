import type { Note } from '@/model/Note'
import type { Score } from '@/model/Score'

import type { ScheduledNote } from './MidiPlayer'

const DEFAULT_BPM = 90

export interface PlaybackPosition {
    measureIndex: number
    beat: number
}

export interface TimelineEntry {
    startTime: number
    duration: number
    beatSpan: number
    midi?: number
    audioDuration?: number
    measureIndex: number
    beat: number
}

export interface ScoreTimeline {
    entries: TimelineEntry[]
    notes: ScheduledNote[]
    totalDuration: number
}

/**
 * Transforms a Score into a timeline of entries for playback and a list of
 * MIDI notes to be scheduled on a MidiPlayer.
 */
export class ScoreTransformer {
    transform(score: Score): ScoreTimeline {
        const entries = this.buildTimeline(score)
        const notes = this.extractNotes(entries)
        const last = entries[entries.length - 1]
        const totalDuration = last ? last.startTime + last.duration : 0
        return { entries, notes, totalDuration }
    }

    private buildTimeline(score: Score): TimelineEntry[] {
        const entries: TimelineEntry[] = []
        let time = 0
        let bpm = DEFAULT_BPM

        for (const measure of score.measures) {
            const tempoAtStart = measure.tempoAtBeat(0)
            if (tempoAtStart) bpm = tempoAtStart.bpm

            for (const note of measure.notes) {
                const beat = measure.beatOffsetOf(note)

                if (beat > 0) {
                    const tempo = measure.tempoAtBeat(beat)
                    if (tempo) bpm = tempo.bpm
                }

                const beatSpan = note.duration.effectiveBeats
                const durationSecs = (beatSpan * 60) / bpm

                let midi: number | undefined
                if (note.pitch && !note.tiesBack) {
                    midi = note.pitch.toMidi()
                }

                let audioDuration: number | undefined
                if (midi !== undefined && note.tiesForward) {
                    audioDuration = this.getTiedAudioDuration(note, durationSecs, bpm)
                }

                entries.push({
                    startTime: time,
                    duration: durationSecs,
                    beatSpan,
                    midi,
                    audioDuration,
                    measureIndex: measure.index,
                    beat,
                })

                time += durationSecs
            }
        }

        return entries
    }

    private extractNotes(entries: TimelineEntry[]): ScheduledNote[] {
        const notes: ScheduledNote[] = []
        for (const entry of entries) {
            if (entry.midi !== undefined) {
                notes.push({
                    startTime: entry.startTime,
                    duration: entry.audioDuration ?? entry.duration,
                    midi: entry.midi,
                })
            }
        }
        return notes
    }

    private getTiedAudioDuration(note: Note, baseDuration: number, bpm: number): number {
        let total = baseDuration
        let current: Note | null = note
        while (current?.tiesForward) {
            const next = current.getNext()
            if (!next) break
            total += (next.duration.effectiveBeats * 60) / bpm
            current = next
        }
        return total
    }
}
