import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@test': fileURLToPath(new URL('./tests', import.meta.url)),
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'happy-dom',
        include: ['tests/**/*.test.ts'],
        globals: false,
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            provider: 'v8',
            // The score model + renderer (and their 100% gate) live in
            // packages/notation now; this reports on the app itself.
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/index.ts',
                'src/app/**', // Next.js pages/route components — covered via e2e
                'src/proxy.ts', // Next.js middleware — covered via e2e
            ],
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: './coverage',
        },
    },
})
