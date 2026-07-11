import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, type Page, type Route,test as base } from '@playwright/test'

import { CONSENT_VERSION } from '../src/lib/consent'

/**
 * Shared Playwright fixtures for the mocked-API editor suite.
 *
 * Every backend call (scores REST + better-auth session) is intercepted with
 * `page.route` and answered locally, so the suite needs no API, Postgres, or
 * Mongo. External traffic (font CDNs, smplr soundfont samples) is aborted to
 * keep runs hermetic and offline-friendly.
 */

export const MOCK_SCORE_ID = 'e2e-score-1'
export const MOCK_TITLE = 'Untitled e2e score'

const NOW = '2026-01-01T00:00:00.000Z'

export const SCORE_META = {
    id: MOCK_SCORE_ID,
    title: MOCK_TITLE,
    createdAt: NOW,
    updatedAt: NOW,
}

const SESSION = {
    user: {
        id: 'e2e-user-1',
        name: 'E2E Tester',
        email: 'e2e@example.com',
        emailVerified: true,
        createdAt: NOW,
        updatedAt: NOW,
    },
    session: {
        id: 'e2e-session-1',
        userId: 'e2e-user-1',
        token: 'e2e-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
    },
}

// Generated from the real ScoreSerializer — see tests/_genfixture (throwaway).
// Playwright runs with cwd = apps/web, so resolve the fixture from there.
const SCORE_PARTWISE = JSON.parse(
    readFileSync(resolve(process.cwd(), 'e2e/fixtures/score.partwise.json'), 'utf8'),
) as Record<string, unknown>

/** Records the requests the app makes to the mocked API, for assertions. */
export interface ApiMock {
    /** Bodies of every PATCH /scores/:id (autosave) the app sent. */
    readonly patches: Array<Record<string, unknown>>
    /** Bodies of every POST /scores (create) the app sent. */
    readonly creates: Array<Record<string, unknown>>
    /** IDs the app requested via DELETE /scores/:id. */
    readonly deletes: string[]
}

function corsHeaders(route: Route): Record<string, string> {
    const origin = route.request().headers()['origin'] ?? '*'
    return {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type',
    }
}

function readJson(route: Route): Record<string, unknown> {
    try {
        return (route.request().postDataJSON() as Record<string, unknown>) ?? {}
    } catch {
        return {}
    }
}

async function installApiMocks(page: Page, mock: ApiMock): Promise<void> {
    // Deleted scores must stay gone: the app refetches the list after a delete,
    // and a stateless mock would resurrect the row.
    const deletedIds = new Set<string>()

    // http(s) only: intercepting `**/*` would also catch blob: URLs, which
    // WebKit cannot route — it blocks them outright, breaking e.g. the PDF
    // exporter's SVG rasterization. blob:/data: are local anyway, so letting
    // them bypass the mock keeps the suite just as hermetic.
    await page.route(/^https?:\/\//, async (route) => {
        const req = route.request()
        const url = new URL(req.url())
        const isMockApi = url.hostname === 'localhost' && url.port === '4999'

        if (!isMockApi) {
            // Same-origin app + Next assets: let them through. Everything else
            // (Google Fonts, soundfont CDNs) is aborted to stay hermetic.
            if (url.hostname === 'localhost') return route.continue()
            return route.abort()
        }

        const json = (body: unknown, status = 200) =>
            route.fulfill({ status, contentType: 'application/json', headers: corsHeaders(route), body: JSON.stringify(body) })

        const method = req.method()
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(route), body: '' })

        const path = url.pathname

        // better-auth session lookup (path varies by client version).
        if (path.includes('get-session') || path.startsWith('/api/auth')) return json(SESSION)

        if (path === '/billing/subscription') {
            return json({
                tierId: 'free',
                tierName: 'Sketch',
                status: null,
                interval: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                billingConfigured: false,
                betaMode: false,
                credits: { limitSeconds: 180, usedSeconds: 0, remainingSeconds: 180, packSeconds: 0 },
            })
        }

        if (path === '/beta/status') return json({ betaMode: false, status: null, role: 'user' })

        if (/\/scores\/[^/]+\/load$/.test(path)) return json(SCORE_PARTWISE)

        const idMatch = path.match(/\/scores\/([^/]+)$/)
        if (idMatch) {
            if (method === 'PATCH') {
                mock.patches.push(readJson(route))
                return json({ ...SCORE_META, updatedAt: new Date(0).toISOString() })
            }
            if (method === 'DELETE') {
                mock.deletes.push(idMatch[1])
                deletedIds.add(idMatch[1])
                return json({})
            }
            return json(SCORE_META) // GET meta
        }

        if (path.endsWith('/scores')) {
            if (method === 'POST') {
                const body = readJson(route)
                mock.creates.push(body)
                const { title } = body as { title?: string }
                return json({ ...SCORE_META, id: 'e2e-created-1', title: title ?? MOCK_TITLE })
            }
            return json([SCORE_META].filter((s) => !deletedIds.has(s.id))) // list
        }

        return json({})
    })
}

export const test = base.extend<{ apiMock: ApiMock }>({
    apiMock: async ({ page, context }, use) => {
        const mock: ApiMock = { patches: [], creates: [], deletes: [] }
        // Satisfy the Next.js middleware cookie gate for protected routes.
        await context.addCookies([{ name: 'better-auth.session_token', value: 'e2e', domain: 'localhost', path: '/' }])
        // Pre-answer the GDPR consent banner so it never overlays the UI under test.
        // Seed the live CONSENT_VERSION — a stale record re-prompts and the banner
        // then swallows clicks aimed at the bottom dock.
        await context.addInitScript(
            ([version]) => {
                window.localStorage.setItem(
                    'sheemu:consent',
                    JSON.stringify({ version, analytics: false, decidedAt: '2026-01-01T00:00:00.000Z' }),
                )
            },
            [CONSENT_VERSION] as const,
        )
        // Next's dev-overlay portal intercepts taps aimed at the bottom-left of the
        // viewport (the mobile dock's note navigator). Dev-server-only; hide it.
        await context.addInitScript(() => {
            const hide = () => {
                const style = document.createElement('style')
                style.textContent = 'nextjs-portal { display: none !important; }'
                document.head?.appendChild(style)
            }
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide)
            else hide()
        })
        await installApiMocks(page, mock)
        await use(mock)
    },
})

export { expect }
