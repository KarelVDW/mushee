import { describe, expect, it, vi } from 'vitest'

// The module only destructures methods off the client, so an empty stand-in suffices.
const createAuthClient = vi.fn((_options?: { baseURL?: string; plugins?: unknown[] }) => ({}))
const emailOTPClient = vi.fn(() => ({ id: 'email-otp' }))

vi.mock('better-auth/react', () => ({ createAuthClient }))
vi.mock('better-auth/client/plugins', () => ({ emailOTPClient }))

describe('auth-client', () => {
    it('constructs the auth client with the API base URL and the email-OTP plugin', async () => {
        await import('@/lib/auth-client')

        expect(createAuthClient).toHaveBeenCalledTimes(1)
        const config = createAuthClient.mock.calls[0][0] as { baseURL?: string; plugins?: unknown[] }
        expect(config.baseURL).toBe(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4200')
        expect(emailOTPClient).toHaveBeenCalled()
        expect(config.plugins).toContainEqual({ id: 'email-otp' })
    })
})
