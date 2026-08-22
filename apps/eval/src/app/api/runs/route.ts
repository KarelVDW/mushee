import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import { NextResponse } from 'next/server'
import { join } from 'path'
import { promisify } from 'util'

import { API_DIR, API_TSX_BIN, REAL_ROOT } from '@/server/paths'
import { getCorpus, insertRun, listRuns } from '@/server/repo'

const execFileAsync = promisify(execFile)

export async function GET() {
    return NextResponse.json(await listRuns())
}

interface RunBody {
    /** Scope the run to one corpus, or omit for the full real corpus. */
    corpusId?: string
}

/**
 * Score with the real harness: EVAL_REAL + EVAL_ADAPTIVE run-eval.ts, scoped
 * to one dataset when asked. Synchronous by design — the client shows a
 * spinner; a full-corpus run is minutes, a one-corpus run tens of seconds.
 */
export async function POST(request: Request) {
    const body = (await request.json().catch(() => ({}))) as RunBody
    const scope = body.corpusId ?? 'all'
    if (body.corpusId && !(await getCorpus(body.corpusId))) {
        return NextResponse.json({ error: 'corpus not found' }, { status: 404 })
    }
    const label = body.corpusId ? `eval-app ${body.corpusId}` : 'eval-app full real corpus'
    const reportFile = body.corpusId ? `report-eval-app-${body.corpusId}.json` : 'report-eval-app-all.json'
    const outPath = join(REAL_ROOT, reportFile)

    try {
        await execFileAsync(API_TSX_BIN, ['scripts/eval/run-eval.ts'], {
            cwd: API_DIR,
            timeout: 30 * 60 * 1000,
            maxBuffer: 64 * 1024 * 1024,
            env: {
                ...process.env,
                EVAL_REAL: '1',
                EVAL_ADAPTIVE: '1',
                ...(body.corpusId ? { EVAL_SCENARIOS: body.corpusId, EVAL_CONDITIONS: 'real' } : {}),
                EVAL_LABEL: label,
                EVAL_OUT: outPath,
            },
        })
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 })
    }

    const report = JSON.parse(readFileSync(outPath, 'utf8')) as {
        overallF1: number
        mode: string
        perScenario: Array<{ scenario: string; f1: number; onsetF1: number; clips: number; pooled: boolean }>
    }
    await insertRun({
        label,
        scope,
        reportPath: outPath,
        summary: {
            overallF1: report.overallF1,
            mode: report.mode,
            perScenario: report.perScenario.map((s) => ({
                scenario: s.scenario,
                f1: s.f1,
                onsetF1: s.onsetF1,
                clips: s.clips,
                pooled: s.pooled,
            })),
        },
    })
    const runs = await listRuns(1)
    return NextResponse.json({ run: runs[0], reportFile })
}
