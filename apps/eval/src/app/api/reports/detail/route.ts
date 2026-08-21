import { existsSync, readFileSync } from 'fs'
import { NextResponse } from 'next/server'
import { join } from 'path'

import { REAL_ROOT, SYNTH_ROOT } from '@/server/paths'

const ROOTS: Record<string, string> = { eval: SYNTH_ROOT, 'eval-real': REAL_ROOT }

export async function GET(request: Request) {
    const url = new URL(request.url)
    const root = url.searchParams.get('root') ?? ''
    const file = url.searchParams.get('file') ?? ''
    const dir = ROOTS[root]
    // The filename gate doubles as the traversal gate: no separators, no dots-only names.
    if (!dir || !/^report[\w.-]*\.json$/.test(file)) {
        return NextResponse.json({ error: 'invalid report reference' }, { status: 400 })
    }
    const path = join(dir, file)
    if (!existsSync(path)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(JSON.parse(readFileSync(path, 'utf8')))
}
