'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { beatsToDurations, type Duration, durationToBeats, effectiveBeats, lineToKey, type NoteInput, parseKey, pitchToLine, Score, type ScoreInput, setKeyAccidental } from '@/components/notation'

import { ControlBar } from './ControlBar'

const initialScoreData: ScoreInput = {
    measures: [
        {
            clef: 'treble',
            timeSignature: '4/4',
            voices: [
                {
                    notes: [
                        { keys: ['C#/5'], duration: '8' },
                        { keys: ['B/4'], duration: '8' },
                        { keys: ['E/4'], duration: '8' },
                        { keys: ['C/5'], duration: '16' },
                        { keys: ['C/5'], duration: '16' },
                        { keys: ['C/5'], duration: '16' },
                        { keys: ['C/5'], duration: '16' },
                        { keys: ['G#/4'], duration: 'q' },
                        { keys: ['G#/4'], duration: 'q' },
                    ],
                    tuplets: [{ startIndex: 0, count: 3, notesOccupied: 2 }],
                },
            ],
        },
        {
            voices: [
                {
                    notes: [{ keys: ['D/5'], duration: 'w', tie: true }],
                },
            ],
        },
        {
            voices: [
                {
                    notes: [{ keys: ['D/5'], duration: 'w'}],
                },
            ],
        },
        {
            voices: [
                {
                    notes: [
                        { keys: ['D/5'], duration: 'q', dots: 1 },
                        { keys: ['C/5'], duration: '8' },
                        { keys: ['E/5'], duration: 'q' },
                        { keys: ['B/4'], duration: '8' },
                        { keys: ['F/5'], duration: '16' },
                        { keys: ['F/5'], duration: '16' },
                    ],
                },
            ],
            endBarline: 'end',
        },
    ],
}

function countNoteEvents(input: ScoreInput): number {
    return input.measures.reduce((sum, m) => sum + m.voices.reduce((vSum, v) => vSum + v.notes.length, 0), 0)
}

/**
 * Map a noteEventIndex back to (measureIdx, voiceIdx, noteIdx) in the ScoreInput.
 */
function findNotePosition(input: ScoreInput, targetIndex: number): { mi: number; vi: number; ni: number } | null {
    let idx = 0
    for (let mi = 0; mi < input.measures.length; mi++) {
        for (let vi = 0; vi < input.measures[mi].voices.length; vi++) {
            for (let ni = 0; ni < input.measures[mi].voices[vi].notes.length; ni++) {
                if (idx === targetIndex) return { mi, vi, ni }
                idx++
            }
        }
    }
    return null
}

/**
 * Get the max beats for a measure by resolving the active time signature.
 */
function getMeasureMaxBeats(input: ScoreInput, mi: number): number {
    for (let i = mi; i >= 0; i--) {
        const ts = input.measures[i].timeSignature
        if (ts) {
            const [num, den] = ts.split('/').map(Number)
            return num * (4 / den)
        }
    }
    return 4 // default 4/4
}

/**
 * Check if a note is part of a tuplet.
 */
function isNoteInTuplet(input: ScoreInput, mi: number, vi: number, ni: number): boolean {
    const tuplets = input.measures[mi].voices[vi].tuplets
    if (!tuplets) return false
    return tuplets.some((t) => ni >= t.startIndex && ni < t.startIndex + t.count)
}

export default function Sheet() {
    const [scoreData, setScoreData] = useState<ScoreInput>(initialScoreData)
    const [cursorIndex, setCursorIndex] = useState(0)
    const totalNotes = useMemo(() => countNoteEvents(scoreData), [scoreData])
    const containerRef = useRef<HTMLDivElement>(null)

    const selectedNoteInfo = useMemo(() => {
        const pos = findNotePosition(scoreData, cursorIndex)
        if (!pos) return { isRest: true, accidental: undefined, duration: undefined, inTuplet: false, tempo: undefined }
        const note = scoreData.measures[pos.mi].voices[pos.vi].notes[pos.ni]
        const parsed = parseKey(note.keys[0])
        return {
            isRest: parsed.isRest,
            accidental: parsed.accidental,
            duration: note.duration,
            inTuplet: isNoteInTuplet(scoreData, pos.mi, pos.vi, pos.ni),
            tempo: note.tempo,
        }
    }, [scoreData, cursorIndex])

    const handleNoteChange = useCallback(
        (noteEventIndex: number, newKey: string) => {
            const pos = findNotePosition(scoreData, noteEventIndex)
            if (!pos) return
            setScoreData((prev) => {
                const next = structuredClone(prev)
                next.measures[pos.mi].voices[pos.vi].notes[pos.ni].keys = [newKey]
                return next
            })
        },
        [scoreData],
    )

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') {
                e.preventDefault()
                setCursorIndex((i) => Math.min(i + 1, totalNotes - 1))
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                setCursorIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const pos = findNotePosition(scoreData, cursorIndex)
                if (!pos) return
                const note = scoreData.measures[pos.mi].voices[pos.vi].notes[pos.ni]
                const { isRest } = parseKey(note.keys[0])
                if (isRest) return
                const step = e.key === 'ArrowUp' ? 0.5 : -0.5
                const currentLine = pitchToLine(note.keys[0])
                const newKey = lineToKey(currentLine + step)
                handleNoteChange(cursorIndex, newKey)
            } else if (e.key === 'Backspace') {
                e.preventDefault()
                const pos = findNotePosition(scoreData, cursorIndex)
                if (!pos) return
                const note = scoreData.measures[pos.mi].voices[pos.vi].notes[pos.ni]
                const { isRest } = parseKey(note.keys[0])
                if (isRest) return
                handleNoteChange(cursorIndex, 'C/5/r')
            }
        },
        [totalNotes, scoreData, cursorIndex, handleNoteChange],
    )

    const handleAccidentalChange = useCallback(
        (acc: string | undefined) => {
            const pos = findNotePosition(scoreData, cursorIndex)
            if (!pos) return
            const key = scoreData.measures[pos.mi].voices[pos.vi].notes[pos.ni].keys[0]
            handleNoteChange(cursorIndex, setKeyAccidental(key, acc))
        },
        [scoreData, cursorIndex, handleNoteChange],
    )

    const handleDurationChange = useCallback(
        (newDuration: Duration) => {
            const pos = findNotePosition(scoreData, cursorIndex)
            if (!pos) return
            if (isNoteInTuplet(scoreData, pos.mi, pos.vi, pos.ni)) return

            const voice = scoreData.measures[pos.mi].voices[pos.vi]
            const note = voice.notes[pos.ni]
            const oldBeats = effectiveBeats(note.duration, note.dots, undefined)
            const newBeats = durationToBeats(newDuration)
            if (Math.abs(newBeats - oldBeats) < 0.001) return

            const measureMaxBeats = getMeasureMaxBeats(scoreData, pos.mi)

            // Compute beats before the selected note
            let beatsBeforeNote = 0
            for (let i = 0; i < pos.ni; i++) {
                beatsBeforeNote += effectiveBeats(voice.notes[i].duration, voice.notes[i].dots, undefined)
            }
            const beatsAvailable = measureMaxBeats - beatsBeforeNote

            setScoreData((prev) => {
                const next = structuredClone(prev)
                const v = next.measures[pos.mi].voices[pos.vi]

                if (newBeats < oldBeats) {
                    // Shortening: change duration, insert rests for the gap
                    v.notes[pos.ni] = { ...v.notes[pos.ni], duration: newDuration, dots: undefined, tie: undefined }
                    const gapBeats = oldBeats - newBeats
                    const rests = beatsToDurations(gapBeats).map(
                        (d): NoteInput => ({ keys: ['C/5/r'], duration: d.duration, dots: d.dots }),
                    )
                    v.notes.splice(pos.ni + 1, 0, ...rests)
                } else if (newBeats <= beatsAvailable) {
                    // Lengthening, fits in measure: consume consecutive notes
                    const extraNeeded = newBeats - oldBeats
                    let consumed = 0
                    let removeCount = 0
                    for (let i = pos.ni + 1; i < v.notes.length && consumed < extraNeeded - 0.001; i++) {
                        consumed += effectiveBeats(v.notes[i].duration, v.notes[i].dots, undefined)
                        removeCount++
                    }
                    v.notes.splice(pos.ni + 1, removeCount)
                    v.notes[pos.ni] = { ...v.notes[pos.ni], duration: newDuration, dots: undefined }
                    // If we over-consumed, insert rests for the excess
                    const excess = consumed - extraNeeded
                    if (excess > 0.001) {
                        const rests = beatsToDurations(excess).map(
                            (d): NoteInput => ({ keys: ['C/5/r'], duration: d.duration, dots: d.dots }),
                        )
                        v.notes.splice(pos.ni + 1, 0, ...rests)
                    }
                } else {
                    // Lengthening, overflows into next measure
                    // Consume all remaining notes after selected in this measure
                    v.notes.splice(pos.ni + 1)
                    // Set this note to fill the remaining space, with a tie
                    const fillDurations = beatsToDurations(beatsAvailable)
                    v.notes[pos.ni] = {
                        ...v.notes[pos.ni],
                        duration: fillDurations[0].duration,
                        dots: fillDurations[0].dots,
                        tie: true,
                    }
                    // Insert additional fill notes if beatsAvailable needs multiple durations
                    for (let i = 1; i < fillDurations.length; i++) {
                        const fd = fillDurations[i]
                        const tieNote: NoteInput = {
                            keys: [...note.keys],
                            duration: fd.duration,
                            dots: fd.dots,
                            tie: i < fillDurations.length - 1 ? true : true, // all tied to next
                        }
                        v.notes.push(tieNote)
                    }

                    // Handle next measure
                    const overflowBeats = newBeats - beatsAvailable
                    const overflowDurations = beatsToDurations(overflowBeats)
                    const nextMi = pos.mi + 1

                    // Create next measure if it doesn't exist
                    if (nextMi >= next.measures.length) {
                        const lastIdx = next.measures.length - 1
                        const lastBarline = next.measures[lastIdx].endBarline
                        delete next.measures[lastIdx].endBarline
                        next.measures.push({
                            voices: [{ notes: [{ keys: ['C/5/r'], duration: 'w' }] }],
                            endBarline: lastBarline,
                        })
                    }

                    const nextVoice = next.measures[nextMi].voices[pos.vi] ?? next.measures[nextMi].voices[0]
                    // Consume notes in next measure to make room for overflow
                    let nextConsumed = 0
                    let nextRemoveCount = 0
                    for (let i = 0; i < nextVoice.notes.length && nextConsumed < overflowBeats - 0.001; i++) {
                        nextConsumed += effectiveBeats(nextVoice.notes[i].duration, nextVoice.notes[i].dots, undefined)
                        nextRemoveCount++
                    }
                    nextVoice.notes.splice(0, nextRemoveCount)

                    // Insert overflow notes at the start
                    const overflowNotes: NoteInput[] = overflowDurations.map((d, i) => ({
                        keys: [...note.keys],
                        duration: d.duration,
                        dots: d.dots,
                        tie: i < overflowDurations.length - 1 ? true : undefined,
                    }))
                    nextVoice.notes.unshift(...overflowNotes)

                    // If we over-consumed in next measure, add rests
                    const nextExcess = nextConsumed - overflowBeats
                    if (nextExcess > 0.001) {
                        const rests = beatsToDurations(nextExcess).map(
                            (d): NoteInput => ({ keys: ['C/5/r'], duration: d.duration, dots: d.dots }),
                        )
                        nextVoice.notes.splice(overflowNotes.length, 0, ...rests)
                    }
                }

                return next
            })
        },
        [scoreData, cursorIndex],
    )

    const handleTempoToggle = useCallback(() => {
        const pos = findNotePosition(scoreData, cursorIndex)
        if (!pos) return
        setScoreData((prev) => {
            const next = structuredClone(prev)
            const note = next.measures[pos.mi].voices[pos.vi].notes[pos.ni]
            if (note.tempo !== undefined) {
                delete note.tempo
            } else {
                note.tempo = 120
            }
            return next
        })
    }, [scoreData, cursorIndex])

    const handleTempoChange = useCallback((noteEventIndex: number, bpm: number) => {
        const pos = findNotePosition(scoreData, noteEventIndex)
        if (!pos) return
        setScoreData((prev) => {
            const next = structuredClone(prev)
            next.measures[pos.mi].voices[pos.vi].notes[pos.ni].tempo = bpm
            return next
        })
    }, [scoreData])

    const handleAddMeasure = useCallback(() => {
        setScoreData((prev) => {
            const next = structuredClone(prev)
            const lastIdx = next.measures.length - 1
            const lastBarline = next.measures[lastIdx].endBarline
            // Remove end barline from current last measure
            delete next.measures[lastIdx].endBarline
            // Add new measure with a whole rest
            next.measures.push({
                voices: [{ notes: [{ keys: ['C/5/r'], duration: 'w' }] }],
                endBarline: lastBarline,
            })
            return next
        })
    }, [])

    const handleRemoveMeasure = useCallback(() => {
        setScoreData((prev) => {
            if (prev.measures.length <= 1) return prev
            const next = structuredClone(prev)
            const removed = next.measures.pop()
            // Transfer end barline to new last measure
            const newLastIdx = next.measures.length - 1
            if (removed) next.measures[newLastIdx].endBarline = removed.endBarline
            return next
        })
        // Clamp cursor if it's now out of bounds
        setCursorIndex((i) => Math.min(i, countNoteEvents(scoreData) - 2))
    }, [scoreData])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        el.addEventListener('keydown', handleKeyDown)
        el.focus()
        return () => el.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])

    return (
        <div ref={containerRef} tabIndex={0} className="flex flex-col min-h-screen max-h-screen bg-gray-100 outline-none">
            <ControlBar
                accidental={selectedNoteInfo.accidental}
                duration={selectedNoteInfo.duration}
                accidentalDisabled={selectedNoteInfo.isRest}
                onAccidentalChange={handleAccidentalChange}
                onDurationChange={handleDurationChange}
                tempo={selectedNoteInfo.tempo}
                onTempoToggle={handleTempoToggle}
            />
            <div className="flex-1 overflow-y-auto min-h-full px-8">
                <div className="mx-auto max-w-4xl min-h-full bg-white shadow p-6">
                    <Score
                        input={scoreData}
                        selectedNoteIndex={cursorIndex}
                        onNoteSelect={setCursorIndex}
                        onNoteChange={handleNoteChange}
                        onAddMeasure={handleAddMeasure}
                        onRemoveMeasure={handleRemoveMeasure}
                        canRemoveMeasure={scoreData.measures.length > 1}
                        onTempoChange={handleTempoChange}
                    />
                </div>
            </div>
        </div>
    )
}
