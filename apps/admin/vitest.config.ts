import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        // Pure logic only (session tokens, piano-roll geometry) — pages are
        // exercised through the running app, not unit tests.
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globals: false,
    },
})
