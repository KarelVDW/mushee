import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the API's decision logic (billing state machine, tier
 * catalog, beta switches). Nest wiring and the database are exercised via the
 * integration scripts in scripts/ instead — services under test here get
 * hand-rolled fakes, and TypeORM entities must be mocked (their decorators
 * need emitDecoratorMetadata, which esbuild does not emit).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
