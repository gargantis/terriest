import { defineConfig } from 'vitest/config';

// Unit tests run in Node: the simulation's (Node is run 1's fourth engine),
// the contract's and the lint config's. Playwright's specs live in e2e/.
// test/solver-setup.ts applies TERRIEST_SPIKE_SOLVER, when it's set, to every
// test file's configurations (M0's cost revisit).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.{ts,mjs}'],
    environment: 'node',
    setupFiles: ['test/solver-setup.ts'],
  },
});
