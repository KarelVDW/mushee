import { captcha } from 'better-auth/plugins'

/**
 * Bot protection on signup (Cloudflare Turnstile via better-auth's captcha
 * plugin). While the closed beta ran, admin approval absorbed abuse; once the
 * doors open, signup is a free faucet with e-mail sending attached, so a
 * CAPTCHA gates it (end-of-beta runbook §1).
 *
 * Configured by TURNSTILE_SECRET_KEY. Unset → the plugin is not installed and
 * signup works as before (local dev, tests, the mocked e2e suite); production
 * logs a warning at boot so the gap is never silent. The web app renders the
 * widget when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set and sends the token in the
 * `x-captcha-response` header the plugin reads.
 *
 * Only signup is protected: the plugin's other defaults (sign-in, password
 * reset) would need the widget on those forms too, and both are already
 * rate-limited and cost nothing but a request. Extend CAPTCHA_ENDPOINTS
 * together with the pages if that changes.
 */
export const CAPTCHA_ENDPOINTS = ['/sign-up/email'] as const

/** The better-auth plugins to install for signup bot protection: one when configured, none otherwise. */
export function signupCaptchaPlugins(env: NodeJS.ProcessEnv = process.env): ReturnType<typeof captcha>[] {
    const key = env.TURNSTILE_SECRET_KEY?.trim()
    if (!key) {
        if (env.NODE_ENV === 'production') {
            console.warn('TURNSTILE_SECRET_KEY is not set: signup runs without a CAPTCHA. Set it before opening signup to the public.')
        }
        return []
    }
    return [captcha({ provider: 'cloudflare-turnstile', secretKey: key, endpoints: [...CAPTCHA_ENDPOINTS] })]
}
