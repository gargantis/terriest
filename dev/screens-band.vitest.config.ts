import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The screens match's setup at every Ready tick of M4's design §9.1's band,
// with e at 0, at 120 and drawn, never part of the gate, which plays §9.2's
// 13 runs (setups-F1):
//   npx vitest run --config dev/screens-band.vitest.config.ts
// src/net/screens-band-*.sweep.ts say what each plays: a file for each e,
// its 61 whole matches one after another, the three side by side. The
// verbose reporter shows each run as it goes; each file prints its runs'
// lines and its slowest end.
const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root,
  test: {
    include: ['src/net/screens-band-*.sweep.ts'],
    environment: 'node',
    reporters: ['verbose'],
    testTimeout: 120_000,
  },
});
