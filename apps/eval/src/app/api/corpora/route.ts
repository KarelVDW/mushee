import { NextResponse } from 'next/server'

import { generateClips, type GeneratorParams } from '@/lib/generator'
import { createCorpus, getCorpus, listCorpora } from '@/server/repo'

export async function GET() {
    return NextResponse.json(await listCorpora())
}

interface CreateBody {
    label: string
    kind: 'voice' | 'whistle' | 'instrument'
    instrumentId?: string
    tier: 'benchmark' | 'context'
    notes?: string
    params: GeneratorParams
}

function slugify(label: string): string {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

export async function POST(request: Request) {
    const body = (await request.json()) as CreateBody
    if (!body.label?.trim()) return NextResponse.json({ error: 'label is required' }, { status: 400 })
    const id = slugify(body.label)
    if (!id) return NextResponse.json({ error: 'label must contain letters or digits' }, { status: 400 })
    if (await getCorpus(id)) return NextResponse.json({ error: `corpus "${id}" already exists` }, { status: 409 })

    let clips
    try {
        clips = generateClips(body.params)
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 })
    }

    await createCorpus(
        {
            id,
            label: body.label.trim(),
            kind: body.kind,
            instrumentId: body.instrumentId ?? null,
            tier: body.tier,
            bpm: body.params.bpm,
            beatsPerMeasure: body.params.beatsPerMeasure,
            params: body.params,
            notes: body.notes?.trim() || null,
        },
        clips,
    )
    return NextResponse.json({ id }, { status: 201 })
}
