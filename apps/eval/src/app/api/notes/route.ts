import { Corpus } from '@/server/Corpus'
import { PipelineNotes } from '@/server/PipelineNotes'

export const dynamic = 'force-dynamic'

/** GET /api/notes?ds=<dataset>&clip=<clip>&source=<run:<id>|timeline:<short>> — one clip's cached pipeline notes. */
export function GET(request: Request): Response {
    const params = new URL(request.url).searchParams
    const ds = params.get('ds') ?? ''
    const clip = params.get('clip') ?? ''
    const source = params.get('source') ?? ''
    if (!Corpus.dataset(ds)?.hasClip(clip)) return Response.json({ error: 'No such clip.' }, { status: 404 })
    return Response.json(PipelineNotes.read(source, ds, clip))
}
