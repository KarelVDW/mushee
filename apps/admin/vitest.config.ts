import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        // Pure logic and the API proxy's auth contract (session tokens, piano-roll
        // geometry, audience query mapping, the proxy handler against a stubbed
        // fetch; the login's next-path guard is tested in @mushee/ui) — pages
        // are exercised through the running app, not unit tests.
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globals: false,
    },
})
