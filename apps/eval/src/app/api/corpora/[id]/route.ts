import { NextResponse } from 'next/server'

import { deleteCorpusFixtures } from '@/server/fixtures'
import { deleteCorpus, getCorpus, latestMetricsByClip, listClips } from '@/server/repo'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
    const { id } = await params
    const corpus = await getCorpus(id)
    if (!corpus) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const [clips, metricsByClip] = await Promise.all([listClips(id), latestMetricsByClip(id)])
    return NextResponse.json({ corpus, clips, metricsByClip })
}

export async function DELETE(_request: Request, { params }: Params) {
    const { id } = await params
    const corpus = await getCorpus(id)
    if (!corpus) return NextResponse.json({ error: 'not found' }, { status: 404 })
    deleteCorpusFixtures(corpus)
    await deleteCorpus(id)
    return NextResponse.json({ ok: true })
}
