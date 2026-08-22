import { existsSync, readFileSync } from 'fs'
import { NextResponse } from 'next/server'

import { transcodeToWav } from '@/server/audio'
import { clipWavPath, saveClipRecording } from '@/server/fixtures'
import { getClip, getCorpus, listClips, markClipRecorded } from '@/server/repo'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
    const { id } = await params
    const clip = await getClip(id)
    if (!clip) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const corpus = await getCorpus(clip.corpusId)
    if (!corpus) return NextResponse.json({ error: 'corpus not found' }, { status: 404 })
    const path = clipWavPath(corpus, clip.name)
    if (!existsSync(path)) return NextResponse.json({ error: 'no recording yet' }, { status: 404 })
    return new NextResponse(new Uint8Array(readFileSync(path)), {
        headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    })
}

/** Save a take: transcode whatever MediaRecorder produced to the corpus wav. */
export async function POST(request: Request, { params }: Params) {
    const { id } = await params
    const clip = await getClip(id)
    if (!clip) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const corpus = await getCorpus(clip.corpusId)
    if (!corpus) return NextResponse.json({ error: 'corpus not found' }, { status: 404 })

    const body = Buffer.from(await request.arrayBuffer())
    if (body.byteLength < 1000) return NextResponse.json({ error: 'take is empty' }, { status: 400 })

    const trimSec = Number(request.headers.get('x-trim-seconds') ?? '0') || 0
    const { wav, durationSec } = await transcodeToWav(body, trimSec)
    const allClips = await listClips(corpus.id)
    saveClipRecording(corpus, clip, allClips, wav)
    await markClipRecorded(id, durationSec)
    return NextResponse.json({ ok: true, durationSec })
}
