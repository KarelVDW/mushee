import { NextResponse } from 'next/server'

import { getClip, getCorpus, latestTranscription, listClips } from '@/server/repo'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
    const { id } = await params
    const clip = await getClip(id)
    if (!clip) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const [corpus, transcription, siblings] = await Promise.all([
        getCorpus(clip.corpusId),
        latestTranscription(id),
        listClips(clip.corpusId),
    ])
    // Prev/next hand the clip page and the recording flow their navigation.
    const index = siblings.findIndex((c) => c.id === id)
    return NextResponse.json({
        clip,
        corpus,
        transcription,
        prevClipId: siblings[index - 1]?.id ?? null,
        nextClipId: siblings[index + 1]?.id ?? null,
        clipIndex: index,
        clipTotal: siblings.length,
    })
}
