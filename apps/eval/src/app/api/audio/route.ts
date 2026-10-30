import { AudioResponse } from '@/server/AudioResponse'
import { EvalData } from '@/server/EvalData'

export const dynamic = 'force-dynamic'

/**
 * GET /api/audio?ds=<dataset>&clip=<clip>&src=<real|resynth|work|condition> — one clip's audio,
 * Range-aware. The file is looked up among the clip's discovered sources, so no part of the
 * request is ever joined into a path.
 */
function handle(request: Request): Response {
    const params = new URL(request.url).searchParams
    const path = EvalData.audioFile(params.get('ds') ?? '', params.get('clip') ?? '', params.get('src') ?? '')
    if (!path) return Response.json({ error: 'No such audio.' }, { status: 404 })
    return new AudioResponse(path, request).build()
}

export function GET(request: Request): Response {
    return handle(request)
}

export function HEAD(request: Request): Response {
    return handle(request)
}
