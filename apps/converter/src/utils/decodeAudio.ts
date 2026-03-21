import { addPitchBendsToNoteEvents, BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import { io, loadGraphModel } from '@tensorflow/tfjs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { AudioBuffer, AudioContext } from 'web-audio-api'

async function getModel() {
    const modelBuffer = await readFile('./data/model.json')
    const modelJson = JSON.parse(modelBuffer.toString()) as io.ModelJSON
    const weightData = await readFile(join('./data', modelJson.weightsManifest[0].paths[0]))
    return loadGraphModel(io.fromMemory(modelJson.modelTopology, modelJson.weightsManifest[0].weights, weightData.buffer))
}

export async function decodeAudio(buffer: Buffer) {
    const basicPitch = new BasicPitch(getModel())
    const audioCtx = new AudioContext({ numberOfChannels: 1 })
    let audioBuffer: AudioBuffer | undefined = undefined

    // Decode audio data
    await new Promise<void>((resolve, reject) => {
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
        audioCtx.decodeAudioData(
            arrayBuffer,
            (_audioBuffer: AudioBuffer) => {
                audioBuffer = _audioBuffer
                resolve()
            },
            (error) => {
                reject(new Error(`Failed to decode audio: ${error}`))
            },
        )
    })

    if (!audioBuffer) throw new Error('Failed to decode audio buffer')

    const frames: number[][] = []
    const onsets: number[][] = []
    const contours: number[][] = []

    await basicPitch.evaluateModel(
        audioBuffer,
        (f: number[][], o: number[][], c: number[][]) => {
            frames.push(...f)
            onsets.push(...o)
            contours.push(...c)
        },
        (p: number) => console.log(`Processing: ${Math.round(p * 100)}%`),
    )

    // Convert to notes
    const rawNotes = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)
    const notesWithPitchBends = addPitchBendsToNoteEvents(contours, rawNotes)
    return noteFramesToTime(notesWithPitchBends)
}
