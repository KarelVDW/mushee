import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            // Tests import the package by its public name; point it at the
            // source so vite's normal resolution (extension lookup) applies.
            '@mushee/playback': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'happy-dom',
        include: ['tests/**/*.test.ts'],
        globals: false,
        setupFiles: ['./tests/setup.ts'],
    },
})
