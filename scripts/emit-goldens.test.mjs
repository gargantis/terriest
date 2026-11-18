import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// PLAN §15, design §7.4: `npm run emit-goldens` refuses without
// TERRIEST_EMIT_GOLDENS=1, and the golden test refuses that variable alone,
// which only the script pairs with TERRIEST_EMIT_GOLDENS_BY_SCRIPT=1. No run
// here sets both, so none rewrites the goldens.
const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('./emit-goldens.mjs', import.meta.url));
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const goldens = fileURLToPath(new URL('../src/core/sim/goldens.json', import.meta.url));
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** This process's environment without the emit variables or vitest's own, plus `over`. */
function env(over = {}) {
  const e = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('TERRIEST_EMIT_GOLDENS') && !k.startsWith('VITEST') && k !== 'NODE_OPTIONS'),
  );
  return { ...e, ...over };
}

describe('emit-goldens', () => {
  it('is the npm script', () => {
    expect(scripts['emit-goldens']).toBe('node scripts/emit-goldens.mjs');
  });

  it('refuses without TERRIEST_EMIT_GOLDENS=1, and exits 1', () => {
    for (const value of [undefined, '', '0', 'true', 'yes']) {
      const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: env(value === undefined ? {} : { TERRIEST_EMIT_GOLDENS: value }) });
      expect(r.status, `TERRIEST_EMIT_GOLDENS=${value}`).toBe(1);
      expect(r.stderr).toContain('Refusing to rewrite src/core/sim/goldens.json: set TERRIEST_EMIT_GOLDENS=1 to re-emit it on purpose');
      expect(r.stdout).toBe('');
    }
  });

  it('leaves the golden test failing, and the file as it was, with the variable alone', () => {
    const before = readFileSync(goldens);
    const r = spawnSync(process.execPath, [vitest, 'run', 'src/core/sim/golden.test.ts'], {
      cwd: root, encoding: 'utf8', env: env({ TERRIEST_EMIT_GOLDENS: '1' }), timeout: 60_000,
    });
    const after = readFileSync(goldens);
    if (!after.equals(before)) writeFileSync(goldens, before);
    expect(after.equals(before), 'goldens.json unchanged').toBe(true);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('npm run emit-goldens');
  }, 90_000);
});
