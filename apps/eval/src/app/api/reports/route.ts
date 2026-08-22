import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { NextResponse } from 'next/server'
import { join } from 'path'

import { REAL_ROOT, SYNTH_ROOT } from '@/server/paths'

const ROOTS: Record<string, string> = { eval: SYNTH_ROOT, 'eval-real': REAL_ROOT }

export interface ReportListing {
    root: string
    file: string
    label: string
    mode: string
    provider: string
    overallF1: number
    scenarios: number
    modifiedAt: string
}

/** Every report JSON the harness or this app has written, newest first. */
export async function GET() {
    const listings: ReportListing[] = []
    for (const [root, dir] of Object.entries(ROOTS)) {
        if (!existsSync(dir)) continue
        for (const file of readdirSync(dir)) {
            if (!file.startsWith('report') || !file.endsWith('.json')) continue
            try {
                const report = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
                    label?: string
                    mode?: string
                    provider?: string
                    overallF1?: number
                    perScenario?: unknown[]
                }
                listings.push({
                    root,
                    file,
                    label: report.label ?? file,
                    mode: report.mode ?? '?',
                    provider: report.provider ?? '?',
                    overallF1: report.overallF1 ?? 0,
                    scenarios: report.perScenario?.length ?? 0,
                    modifiedAt: statSync(join(dir, file)).mtime.toISOString(),
                })
            } catch {
                // Not a run-eval report; skip.
            }
        }
    }
    listings.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    return NextResponse.json(listings)
}
