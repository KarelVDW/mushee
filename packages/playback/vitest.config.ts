import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            // Tests import the package by its public name; point it at the
            // source so vite's normal resolution (extensions, indexes) applies.
            '@mushee/playback': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'happy-dom',
        include: ['tests/**/*.test.ts'],
        globals: false,
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/index.ts'],
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: './coverage',
        },
    },
})
