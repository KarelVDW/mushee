import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the API's pure logic (billing state machine, tier catalog,
 * beta switches). Modules with Nest/TypeORM decorators are exercised via the
 * integration scripts in scripts/ instead — keep test imports decorator-free.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
