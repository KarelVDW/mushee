import { captcha } from 'better-auth/plugins'

/**
 * Bot protection on signup (Cloudflare Turnstile via better-auth's captcha
 * plugin). While the closed beta ran, admin approval absorbed abuse; once the
 * doors open, signup is a free faucet with e-mail sending attached, so a
 * CAPTCHA gates it (end-of-beta runbook §1).
 *
 * Configured by TURNSTILE_SECRET_KEY. Unset → the plugin is not installed and
 * signup works as before (local dev, tests, the mocked e2e suite). Production
 * during the closed beta logs a warning at boot (admin approval still gates
 * accounts); production with BETA_MODE off refuses to boot — an open signup
 * without a CAPTCHA is exactly the launch-day mistake a runbook line cannot
 * prevent. The web app renders the
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
            if (env.BETA_MODE !== 'true') {
                throw new Error(
                    'TURNSTILE_SECRET_KEY is not set while BETA_MODE is off: public signup would run without a CAPTCHA. ' +
                        'Set the Turnstile secret (or BETA_MODE=true) before starting the API.',
                )
            }
            console.warn('TURNSTILE_SECRET_KEY is not set: signup runs without a CAPTCHA. Set it before opening signup to the public.')
        }
        return []
    }
    return [captcha({ provider: 'cloudflare-turnstile', secretKey: key, endpoints: [...CAPTCHA_ENDPOINTS] })]
}
