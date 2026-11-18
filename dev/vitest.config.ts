import { defineConfig } from 'vitest/config';

// The tuning metrics only (design §9.6), never part of the gate:
//   TERRIEST_TUNING_OUT=research/tuning/results.json npx vitest run --config dev/vitest.config.ts
// dev/tuning.metrics.ts says what it runs, where it writes and how to
// choose. The sections run one after another in one file, and the sweeps
// take minutes.
export default defineConfig({
  test: {
    include: ['dev/**/*.metrics.ts'],
    environment: 'node',
    testTimeout: 3_600_000,
    hookTimeout: 60_000,
  },
});
