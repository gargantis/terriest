import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { buildInputs, canaryOf } from './scripts/build-inputs.mjs';

// PLAN §16. vendor/hermet's tests too: the shared tooling must pass under
// terriest's own versions of ESLint, ws and vitest (D-37). research/ keeps
// its own toolchain and is never included (D-36). A test of any script
// extension runs, as the lint reaches every one (D-38, M0). dev/'s tests
// are the tuning page's model (M2, design §9.5); its *.metrics.ts aren't
// tests, and run off the gate with dev/vitest.config.ts. The build inputs'
// hash is defined as vite.config.ts defines it (design §1.31), and so is
// the canary's expected hash (M4's design §1.54).
const EXT = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  define: { __TERRIEST_BUILD_INPUTS__: JSON.stringify(buildInputs(root)), __TERRIEST_CANARY__: JSON.stringify(canaryOf(root)) },
  test: {
    include: ['src', 'scripts', 'e2e/lib', 'vendor/hermet', 'dev'].map((dir) => `${dir}/**/*.test.${EXT}`),
    environment: 'node',
  },
});
