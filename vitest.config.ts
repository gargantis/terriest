import { defineConfig } from 'vitest/config';

// PLAN §16. vendor/hermet's tests too: the shared tooling must pass under
// terriest's own versions of ESLint, ws and vitest (D-37). research/ keeps
// its own toolchain and is never included (D-36). A test of any script
// extension runs, as the lint reaches every one (D-38, M0). dev/'s tests
// are the tuning page's model (M2, design §9.5); its *.metrics.ts aren't
// tests, and run off the gate with dev/vitest.config.ts.
const EXT = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

export default defineConfig({
  test: {
    include: ['src', 'scripts', 'e2e/lib', 'vendor/hermet', 'dev'].map((dir) => `${dir}/**/*.test.${EXT}`),
    environment: 'node',
  },
});
