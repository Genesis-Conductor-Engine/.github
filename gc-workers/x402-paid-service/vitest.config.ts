import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120000,
    pool: 'forks',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { lines: 70, functions: 70, branches: 55 }
    }
  }
});
