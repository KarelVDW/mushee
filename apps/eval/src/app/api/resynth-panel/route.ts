import { readFileSync } from 'fs'

import { Corpus } from '@/server/Corpus'
import { ResynthStore } from '@/server/ResynthStore'

export const dynamic = 'force-dynamic'

/**
 * GET /api/resynth-panel?ds=<dataset>&clip=<clip>&file=p<k>.png — one comparison panel of the
 * resynth loop's latest report (the picture the judge sees). Only a `p<k>.png` the clip's work
 * directory lists is served.
 */
export function GET(request: Request): Response {
    const params = new URL(request.url).searchParams
    const ds = params.get('ds') ?? ''
    const clip = params.get('clip') ?? ''
    if (!Corpus.dataset(ds)?.hasClip(clip)) return Response.json({ error: 'No such clip.' }, { status: 404 })
    const path = ResynthStore.clip(ds, clip).panelFile(params.get('file') ?? '')
    if (!path) return Response.json({ error: 'No such panel.' }, { status: 404 })
    return new Response(new Uint8Array(readFileSync(path)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' } })
}
