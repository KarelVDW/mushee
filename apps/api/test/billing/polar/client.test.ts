import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real SDK client against a stubbed fetch: asserts what goes on the wire,
// above all the pinned Polar-Version header (without it Polar answers with its
// moving "current" version).

const ENV_KEYS = ['POLAR_ACCESS_TOKEN', 'POLAR_SERVER']
const savedEnv: Record<string, string | undefined> = {}

const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(
        new Response(JSON.stringify({ id: 'co_1', url: 'https://polar.sh/checkout/co_1' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
        }),
    ),
)

/** A fresh module instance: polarClient() caches its client per process. */
async function loadClient() {
    vi.resetModules()
    return import('../../../src/billing/polar/client')
}

/** The configured client; fails the test when there is none. */
async function configuredClient() {
    const client = (await loadClient()).polarClient()
    if (!client) throw new Error('expected a configured Polar client')
    return client
}

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key]
        delete process.env[key]
    }
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key]
        else process.env[key] = savedEnv[key]
    }
})

describe('polarClient', () => {
    it('is null without an access token', async () => {
        const { polarClient, isBillingConfigured } = await loadClient()
        expect(polarClient()).toBeNull()
        expect(isBillingConfigured()).toBe(false)
    })

    it('calls production with the pinned Polar-Version and the access token', async () => {
        process.env.POLAR_ACCESS_TOKEN = 'polar_oat_test'
        const checkout = await (await configuredClient()).checkouts.create({ products: ['prod_1'] })

        expect(checkout.url).toBe('https://polar.sh/checkout/co_1')
        const [url, init] = fetchMock.mock.calls[0]
        expect(url.startsWith('https://api.polar.sh/')).toBe(true)
        const headers = new Headers(init.headers)
        expect(headers.get('Polar-Version')).toBe('2026-10')
        expect(headers.get('Authorization')).toBe('Bearer polar_oat_test')
        expect(JSON.parse(init.body as string)).toEqual({ products: ['prod_1'] })
    })

    it('targets the sandbox with POLAR_SERVER=sandbox', async () => {
        process.env.POLAR_ACCESS_TOKEN = 'polar_oat_test'
        process.env.POLAR_SERVER = 'sandbox'
        await (await configuredClient()).checkouts.create({ products: ['prod_1'] })

        const [url, init] = fetchMock.mock.calls[0]
        expect(url.startsWith('https://sandbox-api.polar.sh/')).toBe(true)
        expect(new Headers(init.headers).get('Polar-Version')).toBe('2026-10')
    })
})
