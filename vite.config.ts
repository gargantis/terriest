import { defineConfig } from 'vite';

// PLAN §15: relative URLs, no source maps, and npm licence JSON for
// scripts/licenses.mjs, which turns it into THIRD-PARTY-LICENSES.txt (D-37).
// Only index.html is built; dev/ pages are served by `npm run dev` alone.
// The module-preload polyfill stays, as in the M0 spike: it fetches only
// same-origin URLs, which the policy's 'self' covers (D-35).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    license: { fileName: '.license-npm.json' },
  },
  preview: { host: '127.0.0.1', port: 4339, strictPort: true },
});
