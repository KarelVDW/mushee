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
            // Report on the whole app, but only the model layer is held to 100%.
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/index.ts',
                'src/components/notation/fonts/**', // generated Bravura font data
                'src/app/**', // Next.js pages/route components — covered via e2e
                'src/proxy.ts', // Next.js middleware — covered via e2e
            ],
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: './coverage',
            thresholds: {
                // The model layer is the foundation of the editor and must stay fully covered.
                'src/model/**/*.ts': {
                    statements: 100,
                    branches: 100,
                    functions: 100,
                    lines: 100,
                },
            },
        },
    },
})
