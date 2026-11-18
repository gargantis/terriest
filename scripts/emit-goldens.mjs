#!/usr/bin/env node
// Re-emits src/core/sim/goldens.json on purpose (PLAN §15, §16 Determinism;
// design §7.4). It refuses without TERRIEST_EMIT_GOLDENS=1. With it, it runs
// the golden test with a second variable, TERRIEST_EMIT_GOLDENS_BY_SCRIPT=1,
// which only this script sets: the test writes the file only with both, and
// only once every run covers its spec, and fails with the first alone, so a
// stray exported variable can't let the gate rewrite the goldens and pass.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.TERRIEST_EMIT_GOLDENS !== '1') {
  console.error('Refusing to rewrite src/core/sim/goldens.json: set TERRIEST_EMIT_GOLDENS=1 to re-emit it on purpose');
  process.exit(1);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const run = spawnSync(process.execPath, [vitest, 'run', 'src/core/sim/golden.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TERRIEST_EMIT_GOLDENS: '1', TERRIEST_EMIT_GOLDENS_BY_SCRIPT: '1' },
});
process.exit(run.status ?? 1);
