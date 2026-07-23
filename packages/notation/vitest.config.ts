import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            // Tests import the package by its public name; point it at the
            // source so vite's normal resolution (extensions, indexes) applies.
            '@mushee/notation': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'happy-dom',
        include: ['tests/**/*.test.ts'],
        globals: false,
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/index.ts',
                'src/components/fonts/**', // generated Bravura font data
                'src/testing/**', // test builders, exercised by the suites themselves
            ],
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: './coverage',
            thresholds: {
                // The model is the foundation of the editor and must stay fully
                // covered — the same gate it had inside apps/web.
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
