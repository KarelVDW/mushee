import { describe, expect, it, vi } from 'vitest'

// The client object that createAuthClient returns — every export is destructured from this.
const fakeClient = {
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    useSession: vi.fn(),
    changePassword: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    changeEmail: vi.fn(),
    emailOtp: vi.fn(),
}

const createAuthClient = vi.fn((_options?: { baseURL?: string; plugins?: unknown[] }) => fakeClient)
const emailOTPClient = vi.fn(() => ({ id: 'email-otp' }))

vi.mock('better-auth/react', () => ({ createAuthClient }))
vi.mock('better-auth/client/plugins', () => ({ emailOTPClient }))

describe('auth-client', () => {
    it('constructs the auth client with the API base URL and the email-OTP plugin', async () => {
        const mod = await import('@/lib/auth-client')

        expect(createAuthClient).toHaveBeenCalledTimes(1)
        const config = createAuthClient.mock.calls[0][0] as { baseURL?: string; plugins?: unknown[] }
        expect(config.baseURL).toBe(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000')
        expect(emailOTPClient).toHaveBeenCalled()
        expect(config.plugins).toContainEqual({ id: 'email-otp' })

        // Every documented hook/method is re-exported from the constructed client.
        expect(mod.signIn).toBe(fakeClient.signIn)
        expect(mod.signUp).toBe(fakeClient.signUp)
        expect(mod.signOut).toBe(fakeClient.signOut)
        expect(mod.useSession).toBe(fakeClient.useSession)
        expect(mod.changePassword).toBe(fakeClient.changePassword)
        expect(mod.requestPasswordReset).toBe(fakeClient.requestPasswordReset)
        expect(mod.resetPassword).toBe(fakeClient.resetPassword)
        expect(mod.changeEmail).toBe(fakeClient.changeEmail)
        expect(mod.emailOtp).toBe(fakeClient.emailOtp)
    })
})
