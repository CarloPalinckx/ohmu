import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      include: ['src/framework/**'],
      thresholds: {
        statements: 95,
        functions: 95,
        lines: 95,
        branches: 90,
      },
    },
  },
});
