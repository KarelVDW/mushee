import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        // The kit renders through react-dom/server and the guard/HTTP core are
        // plain functions, so no DOM is needed.
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globals: false,
    },
})
