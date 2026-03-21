import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import { addPitchBendsToNoteEvents, BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import Fastify from 'fastify'
import fs from 'fs'
import path from 'path'
import { Server } from 'socket.io'
import { AudioBuffer, AudioContext } from 'web-audio-api'

const fastify = Fastify({
    logger: true,
})

await fastify.register(multipart)
await fastify.register(websocket)

const io = new Server(fastify.server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
})

io.on('connection', (socket) => {
    fastify.log.info(`Socket connected: ${socket.id}`)

    socket.on('audio-chunk', (chunk: Buffer) => {
        fastify.log.info(`Received audio chunk of size: ${chunk.length} bytes from socket: ${socket.id}`)
        // Here you can handle the incoming audio chunk as needed
    })

    socket.on('disconnect', () => {
        fastify.log.info(`Socket disconnected: ${socket.id}`)
    })
})

fastify.get('/', async (request, reply) => {
    return { hello: 'world' }
})

fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() }
})

fastify.post('/convert', async (request, reply) => {
    console.log('Received /convert request')
    try {
        const data = await request.file()

        if (!data) {
            return reply.code(400).send({ error: 'No file provided' })
        }

        const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/flac', 'audio/ogg']
        if (!allowedTypes.includes(data.mimetype)) {
            return reply.code(400).send({
                error: 'Invalid file type. Supported formats: WAV, MP3, FLAC, OGG',
            })
        }

        const buffer = await data.toBuffer()
        const tempDir = path.join(import.meta.dirname, '../temp')

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true })
        }

        const tempFilePath = path.join(tempDir, `${Date.now()}_${data.filename}`)
        fs.writeFileSync(tempFilePath, buffer)

        fastify.log.info(`Processing audio file: ${data.filename}`)

        // Create AudioContext and decode audio data
        const audioCtx = new AudioContext()
        let audioBuffer: AudioBuffer | undefined = undefined

        // Load model - using BasicPitch model URL
        const modelUrl = 'https://storage.googleapis.com/basic-pitch-models/model.json'
        const basicPitch = new BasicPitch(modelUrl)

        // Decode audio data
        await new Promise<void>((resolve, reject) => {
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
            audioCtx.decodeAudioData(
                arrayBuffer,
                (_audioBuffer: AudioBuffer) => {
                    audioBuffer = _audioBuffer
                    resolve()
                },
                (error: any) => {
                    reject(new Error(`Failed to decode audio: ${error}`))
                },
            )
        })

        if (!audioBuffer) {
            throw new Error('Failed to decode audio buffer')
        }

        fastify.log.info(`Audio decoded: ${(audioBuffer as any).duration}s, ${(audioBuffer as any).sampleRate}Hz`)

        // Process audio with BasicPitch
        const frames: number[][] = []
        const onsets: number[][] = []
        const contours: number[][] = []
        let progress = 0

        await basicPitch.evaluateModel(
            audioBuffer,
            (f: number[][], o: number[][], c: number[][]) => {
                frames.push(...f)
                onsets.push(...o)
                contours.push(...c)
            },
            (p: number) => {
                progress = p
                fastify.log.info(`Processing: ${Math.round(p * 100)}%`)
                io.emit('conversion-progress', {
                    filename: data.filename,
                    progress: p,
                })
            },
        )

        // Convert to notes
        const rawNotes = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)
        const notesWithPitchBends = addPitchBendsToNoteEvents(contours, rawNotes)
        const notes = noteFramesToTime(notesWithPitchBends)

        const result = {
            success: true,
            filename: data.filename,
            duration: (audioBuffer as any).duration,
            sampleRate: (audioBuffer as any).sampleRate,
            noteCount: notes.length,
            notes: notes.slice(0, 10), // Return first 10 notes as sample
            totalNotes: notes.length,
            frames: frames.length,
            onsets: onsets.length,
            contours: contours.length,
        }

        fs.unlinkSync(tempFilePath)

        io.emit('conversion-complete', {
            filename: data.filename,
            result: result,
            timestamp: new Date().toISOString(),
        })

        return reply.send({
            ...result,
            message: 'Audio converted to MIDI notes successfully',
        })
    } catch (error) {
        fastify.log.error(`Conversion error: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return reply.code(500).send({
            error: 'Failed to convert audio file',
            details: error instanceof Error ? error.message : 'Unknown error',
        })
    }
})

const start = async () => {
    try {
        await fastify.listen({ port: 3001, host: '0.0.0.0' })
        console.log('Server is running on http://localhost:3001')
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()
