// Builds the verification page into results/tmp/verify-page (not tracked),
// with public/_headers copied beside it, so e2e/serve.mjs can serve it:
//   npx vite build --config scripts/verify/vite.config.mjs
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export default {
  root: `${here}page`,
  publicDir: `${here}../../public`,
  base: './',
  logLevel: 'warn',
  build: { outDir: `${here}../../results/tmp/verify-page`, emptyOutDir: true, target: 'es2022', sourcemap: false },
};
