import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { buildInputs, canaryOf } from './scripts/build-inputs.mjs';

// PLAN §15: relative URLs, no source maps, and npm licence JSON for
// scripts/licenses.mjs, which turns it into THIRD-PARTY-LICENSES.txt (D-37).
// Only index.html is built; dev/ pages are served by `npm run dev` alone.
// The module-preload polyfill stays, as in the M0 spike: it fetches only
// same-origin URLs, which the policy's 'self' covers (D-35).
// The build inputs' hash goes in as a define, computed here at build time
// for src/build-info.ts, so goldens.json never enters the page's bundle
// (design §1.31, M3-Q3); and beside it, from M4, the canary's expected
// hash for src/canary-expected.ts, the one hash of the goldens the page
// holds (M4's design §1.54, §1.56, M4-Q5).
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  define: { __TERRIEST_BUILD_INPUTS__: JSON.stringify(buildInputs(root)), __TERRIEST_CANARY__: JSON.stringify(canaryOf(root)) },
  build: {
    target: 'es2022',
    sourcemap: false,
    license: { fileName: '.license-npm.json' },
  },
  preview: { host: '127.0.0.1', port: 4339, strictPort: true },
});
