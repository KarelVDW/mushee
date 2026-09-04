import { afterEach, describe, expect, it, vi } from 'vitest'

import { CAPTCHA_ENDPOINTS, captchaSecretKey, signupCaptchaPlugins } from '../../src/auth/captcha-config'

describe('signup CAPTCHA configuration', () => {
    afterEach(() => vi.restoreAllMocks())

    it('installs no plugin without a secret, and stays quiet outside production', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(signupCaptchaPlugins({ NODE_ENV: 'development' })).toEqual([])
        expect(signupCaptchaPlugins({ NODE_ENV: 'development', TURNSTILE_SECRET_KEY: '   ' })).toEqual([])
        expect(warn).not.toHaveBeenCalled()
    })

    it('warns at production boot when the secret is missing — an open signup must never go unnoticed', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(signupCaptchaPlugins({ NODE_ENV: 'production' })).toEqual([])
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('TURNSTILE_SECRET_KEY'))
    })

    it('installs the Turnstile captcha plugin on the signup endpoint only when a secret is set', () => {
        const [plugin, ...rest] = signupCaptchaPlugins({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: ' 0x-secret ' })
        expect(rest).toEqual([])
        expect(plugin.id).toBe('captcha')
        expect(plugin.options).toMatchObject({ provider: 'cloudflare-turnstile', secretKey: '0x-secret', endpoints: ['/sign-up/email'] })
        expect(CAPTCHA_ENDPOINTS).toEqual(['/sign-up/email'])
    })

    it('reads the secret from the process environment, trimmed', () => {
        vi.stubEnv('TURNSTILE_SECRET_KEY', '  key  ')
        expect(captchaSecretKey()).toBe('key')
        vi.stubEnv('TURNSTILE_SECRET_KEY', '')
        expect(captchaSecretKey()).toBeUndefined()
        vi.unstubAllEnvs()
    })
})
