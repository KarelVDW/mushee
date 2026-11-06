import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, type Locator, type Page, type Request, type Route, test as base } from '@playwright/test'

import { CONSENT_VERSION } from '../src/lib/consent'

/**
 * Shared Playwright fixtures for the mocked-API editor suite.
 *
 * Every backend call (scores REST + better-auth session) is intercepted with
 * `page.route` and answered locally, so the suite needs no API or Postgres.
 * External traffic (font CDNs, smplr soundfont samples) is aborted to keep runs
 * hermetic and offline-friendly.
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

// The stored-score DTO the load endpoint serves: two 4/4 bars (C5 D5 E5 F5 | four quarter
// rests), serialized by @mushee/notation's ScoreSerializer. It is maintained by hand — when the
// stored format changes, re-serialize the same score, e.g.
// `JSON.stringify(new ScoreSerializer(score).toInput())`, and keep the specs' note counts true.
// Playwright runs with cwd = apps/web, so resolve the fixture from there.
const SCORE_PARTWISE = JSON.parse(readFileSync(resolve(process.cwd(), 'e2e/fixtures/score.partwise.json'), 'utf8')) as Record<
    string,
    unknown
>

/**
 * A stored document the API could not read as JSON (the raw MusicXML text of a file), served
 * instead of SCORE_PARTWISE under the `rawDocument` option. Neither the editor nor the share
 * page may deserialize it: an editor autosave would write the reconstruction back over it.
 */
const RAW_DOCUMENT = { raw: '<score-partwise/>' }

/** The account's billing state: Sketch, with billing not configured (nothing can be bought). See {@link mockBilling}. */
const BILLING_STATE = {
    tierId: 'free',
    tierName: 'Sketch',
    status: null,
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    billingConfigured: false,
    betaMode: false,
    credits: { limitSeconds: 180, usedSeconds: 0, remainingSeconds: 180, packSeconds: 0 },
}

/** Records the requests the app makes to the mocked API, for assertions. */
export interface ApiMock {
    /** Bodies of every PATCH /scores/:id (autosave) the app sent. */
    readonly patches: Array<Record<string, unknown>>
    /** Bodies of every POST /scores (create) the app sent. */
    readonly creates: Array<Record<string, unknown>>
    /** IDs the app requested via DELETE /scores/:id. */
    readonly deletes: string[]
    /** IDs the app requested via POST /scores/:id/duplicate. */
    readonly duplicates: string[]
    /** Share-link state of the mock score: token while on, null while off. */
    shareToken: string | null
}

/** The token the mock mints for the score's share link. */
export const MOCK_SHARE_TOKEN = 'e2eShareToken0001'

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

async function installApiMocks(page: Page, mock: ApiMock, { rawDocument }: { rawDocument: boolean }): Promise<void> {
    const storedDocument = rawDocument ? RAW_DOCUMENT : SCORE_PARTWISE
    // Deleted scores must stay gone: the app refetches the list after a delete,
    // and a stateless mock would resurrect the row.
    const deletedIds = new Set<string>()
    // Likewise, duplicated scores must show up in the refetched list.
    const copies: Array<typeof SCORE_META> = []

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

        if (path === '/billing/subscription') return json(BILLING_STATE)

        if (path === '/beta/status') return json({ betaMode: false, status: null })

        // The database tier catalogue, mirroring the seed migrations.
        if (path === '/plans') {
            return json([
                { id: 'free', name: 'Sketch', dailyRecordingCredits: 180, maxScores: 5, sellable: true },
                { id: 'pro', name: 'Songwriter', dailyRecordingCredits: 1200, maxScores: null, sellable: true },
                { id: 'studio', name: 'Studio', dailyRecordingCredits: 10800, maxScores: null, sellable: true },
                { id: 'arranger', name: 'Arranger', dailyRecordingCredits: 28800, maxScores: null, sellable: true },
            ])
        }

        if (/\/scores\/[^/]+\/load$/.test(path)) return json(storedDocument)

        // Read-only share link: mint/revoke on the score, resolve publicly.
        const shareMatch = path.match(/\/scores\/([^/]+)\/share$/)
        if (shareMatch) {
            if (method === 'POST') {
                mock.shareToken = MOCK_SHARE_TOKEN
                return json({ token: MOCK_SHARE_TOKEN })
            }
            mock.shareToken = null
            return json({})
        }
        const sharedMatch = path.match(/\/shared\/([^/]+)$/)
        if (sharedMatch) {
            if (sharedMatch[1] !== MOCK_SHARE_TOKEN) return json({ message: 'Score not found' }, 404)
            return json({ id: MOCK_SCORE_ID, title: MOCK_TITLE, updatedAt: NOW, document: storedDocument })
        }

        const duplicateMatch = path.match(/\/scores\/([^/]+)\/duplicate$/)
        if (duplicateMatch && method === 'POST') {
            mock.duplicates.push(duplicateMatch[1])
            const copy = { ...SCORE_META, id: `e2e-copy-${mock.duplicates.length}`, title: `${MOCK_TITLE} (copy)` }
            copies.push(copy)
            return json(copy)
        }

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
            return json({ ...SCORE_META, shareToken: mock.shareToken }) // GET meta
        }

        if (path.endsWith('/scores')) {
            if (method === 'POST') {
                const body = readJson(route)
                mock.creates.push(body)
                const { title } = body as { title?: string }
                return json({ ...SCORE_META, id: 'e2e-created-1', title: title ?? MOCK_TITLE })
            }
            return json([SCORE_META, ...copies].filter((s) => !deletedIds.has(s.id))) // list
        }

        return json({})
    })
}

/** The score renderer marks each selected note's highlight band with this attribute. */
export const SELECTION_BANDS = 'rect[data-selection-band]'

/**
 * The next autosave of the mock score: a PATCH to that score's own URL — filtered, so an
 * unrelated PATCH elsewhere can't satisfy the wait.
 */
export function waitForAutosave(page: Page): Promise<Request> {
    return page.waitForRequest((r) => r.method() === 'PATCH' && new RegExp(`/scores/${MOCK_SCORE_ID}$`).test(r.url()), {
        timeout: 8000,
    })
}

/**
 * The editor header fits the viewport at its current width (a phone's, or a desktop step's):
 * no horizontal page overflow, and every score-level chip inside the header's box (a flex row
 * that overflowed would keep the header at viewport width while its children spill out).
 */
export async function expectHeaderFitsViewport(page: Page): Promise<void> {
    const header = page.locator('header')
    const headerBox = await header.boundingBox()
    const viewport = page.viewportSize()
    expect(headerBox).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(headerBox?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect(headerBox?.width ?? Infinity).toBeLessThanOrEqual((viewport?.width ?? 0) + 1)
    for (const name of ['Share score', 'Export score']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox()
        expect(box, name).not.toBeNull()
        expect((box?.x ?? 0) + (box?.width ?? Infinity), name).toBeLessThanOrEqual((headerBox?.x ?? 0) + (headerBox?.width ?? 0) + 1)
    }
    const overflow = await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
}

/** Focus the editor container (where the editor's keydown listener sits) and return it. */
export async function focusEditor(page: Page): Promise<Locator> {
    const editor = page.locator('div[tabindex="0"]').first()
    await editor.focus()
    return editor
}

/**
 * Refuse the microphone: every getUserMedia call rejects as a denied permission. The refusal
 * goes on the prototype, not on navigator.mediaDevices: WebKit garbage-collects that wrapper
 * and hands out a fresh one, dropping an own-property stub, so a take would reach the real
 * permission request, which never settles under automation.
 */
export async function denyMicrophone(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
            configurable: true,
            value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
        })
    })
}

/**
 * Serve the billing state with `overrides` (e.g. `billingConfigured: true`, so plans can be
 * bought and an upgrade link opens Change plan). Registered after the fixture mock, so it wins.
 */
export async function mockBilling(page: Page, overrides: Record<string, unknown>): Promise<void> {
    await page.route(/localhost:4999\/billing\/subscription$/, (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(route), body: '' })
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: corsHeaders(route),
            body: JSON.stringify({ ...BILLING_STATE, ...overrides }),
        })
    })
}

/** Keep an unauthed page (no apiMock) hermetic: the app origin passes, everything else is cut. */
export async function stayLocal(page: Page): Promise<void> {
    await page.route(/^https?:\/\//, (route) => {
        const url = new URL(route.request().url())
        return url.hostname === 'localhost' ? route.continue() : route.abort()
    })
}

export const test = base.extend<{ apiMock: ApiMock; rawDocument: boolean }>({
    // `test.use({ rawDocument: true })`: the score's stored document (editor load and share
    // link alike) is RAW_DOCUMENT instead of the engraveable fixture score.
    rawDocument: [false, { option: true }],
    // Every navigation waits for React to hydrate before the test acts. Server-rendered
    // forms look ready before that, but a fill() into one is lost (state stays empty, the
    // submit stays disabled) — the flaky "button stays disabled" runs on a slow CI runner.
    // The marker is set by <HydrationMarker /> in the root layout.
    page: async ({ page }, use) => {
        const hydrated = () => page.waitForSelector('html[data-hydrated]', { state: 'attached' })
        const goto = page.goto.bind(page)
        page.goto = async (url, options) => {
            const response = await goto(url, options)
            await hydrated()
            return response
        }
        // Full document loads too: a reload or history move re-renders from the server.
        for (const method of ['reload', 'goBack', 'goForward'] as const) {
            const original = page[method].bind(page)
            page[method] = async (options) => {
                const response = await original(options)
                if (response) await hydrated()
                return response
            }
        }
        await use(page)
    },
    apiMock: async ({ page, context, rawDocument }, use) => {
        const mock: ApiMock = { patches: [], creates: [], deletes: [], duplicates: [], shareToken: null }
        // Satisfy the Next.js middleware cookie gate for protected routes.
        await context.addCookies([{ name: 'better-auth.session_token', value: 'e2e', domain: 'localhost', path: '/' }])
        // Pre-answer the GDPR consent banner so it never overlays the UI under test.
        // Seed the live CONSENT_VERSION — a stale record re-prompts and the banner
        // then swallows clicks aimed at the bottom dock.
        await context.addInitScript(
            ([version]) => {
                window.localStorage.setItem(
                    'solkey:consent',
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
        await installApiMocks(page, mock, { rawDocument })
        await use(mock)
    },
})

export { expect }
