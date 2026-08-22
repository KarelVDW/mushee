import { existsSync } from 'fs'
import { NextResponse } from 'next/server'

import { melodyToTruth } from '@/lib/melody'
import { clipWavPath, pipelineInstrumentId } from '@/server/fixtures'
import { getClip, getCorpus, insertTranscription, latestTranscription } from '@/server/repo'
import { transcribeClip } from '@/server/transcriber'

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: Params) {
    const { id } = await params
    const clip = await getClip(id)
    if (!clip) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const corpus = await getCorpus(clip.corpusId)
    if (!corpus) return NextResponse.json({ error: 'corpus not found' }, { status: 404 })
    const wavPath = clipWavPath(corpus, clip.name)
    if (!existsSync(wavPath)) return NextResponse.json({ error: 'no recording to transcribe yet' }, { status: 409 })

    const instrumentId = pipelineInstrumentId(corpus.kind, corpus.instrumentId)
    try {
        const result = await transcribeClip({
            wavPath,
            bpm: corpus.bpm,
            beatsPerMeasure: corpus.beatsPerMeasure,
            instrumentId,
            truth: melodyToTruth(clip.melody),
        })
        await insertTranscription(id, {
            notes: result.notes,
            measures: result.measures,
            metrics: { ...result.metrics, seg: result.seg, onsetOnly: result.onsetOnly },
            config: { mode: 'pipeline', instrumentId },
        })
        const transcription = await latestTranscription(id)
        return NextResponse.json({ transcription })
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 })
    }
}
