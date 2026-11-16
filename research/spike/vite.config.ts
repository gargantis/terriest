import { defineConfig } from 'vite';

// As PLAN §15 sets Vite for the product: relative URLs, no source maps, and
// npm licence JSON for hermet's licence writer, which turns it into
// dist/THIRD-PARTY-LICENSES.txt and deletes it (D-37).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    license: { fileName: '.license-npm.json' },
  },
  preview: { host: '127.0.0.1', port: 4329, strictPort: true },
});
