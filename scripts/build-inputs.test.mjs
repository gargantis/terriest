import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { buildInputFiles, buildInputs } from './build-inputs.mjs';

// Design §1.31, R-9, M3-Q3: the build inputs' hash changes when a source
// that decides what peers agree on changes (the simulation, its goldens,
// the timeline, the protocol, the bot IDs, the session), and not for the
// tests or the files peers may run in different versions (brain.ts,
// marks.ts, setups.ts), nor with the checkout's line endings or the
// machine's locale. Each edit is made in a temporary copy of src/core, and
// undone after. vite.config.ts and vitest.config.ts define it; that the
// page's bundle carries the checkout's hash is e2e/nettest.spec.ts's.
const root = fileURLToPath(new URL('..', import.meta.url));

let copy;
let base;
beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), 'terriest-build-inputs-'));
  cpSync(join(root, 'src', 'core'), join(copy, 'src', 'core'), { recursive: true });
  base = buildInputs(copy);
});
afterAll(() => {
  rmSync(copy, { recursive: true, force: true });
});

/** The hash with `edit` made to the copy, which is then put back. */
function withEdit(path, edit) {
  const file = join(copy, path);
  let before;
  try {
    before = readFileSync(file);
  } catch {
    before = null;
  }
  try {
    edit(file);
    return buildInputs(copy);
  } finally {
    if (before === null) rmSync(file, { force: true });
    else writeFileSync(file, before);
  }
}
const appended = (path) => withEdit(path, (file) => appendFileSync(file, '\n// edited\n'));

describe('buildInputs', () => {
  it('is 16 hex digits, the same for a copy of the sources as for the checkout', () => {
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(buildInputs(root)).toBe(base);
    expect(buildInputs(copy)).toBe(base);
  });

  it('changes with a simulation source, the goldens, a timeline, protocol, bot-ID or session source', () => {
    const paths = [
      'src/core/sim/step.ts', 'src/core/sim/goldens.json', 'src/core/timeline/clock.ts', 'src/core/protocol/messages.ts',
      'src/core/bot/bot-id.ts', 'src/core/session/settings.ts', 'src/core/match-id.ts',
    ];
    const hashes = paths.map(appended);
    for (const [i, h] of hashes.entries()) expect(h, paths[i]).not.toBe(base);
    expect(new Set(hashes).size).toBe(paths.length);
    expect(buildInputs(copy)).toBe(base);
  });

  it('changes with a new source, and with a file renamed', () => {
    expect(withEdit('src/core/sim/extra.ts', (file) => writeFileSync(file, 'export const x = 1;\n'))).not.toBe(base);
    const from = join(copy, 'src/core/sim/hash.ts');
    const to = join(copy, 'src/core/sim/hash2.ts');
    renameSync(from, to);
    try {
      expect(buildInputs(copy)).not.toBe(base);
    } finally {
      renameSync(to, from);
    }
    expect(buildInputs(copy)).toBe(base);
  });

  it('ignores the tests, and the brain, the marks and the setups, which peers may run in different versions', () => {
    for (const path of ['src/core/sim/step.test.ts', 'src/core/bot/brain.ts', 'src/core/bot/marks.ts', 'src/core/bot/setups.ts']) {
      expect(withEdit(path, (file) => appendFileSync(file, '\n// edited\n')), path).toBe(base);
    }
    expect(withEdit('src/core/timeline/new.test.ts', (file) => writeFileSync(file, 'export {};\n'))).toBe(base);
  });

  it('hashes src/core alone, with the goldens, in path order', () => {
    const files = buildInputFiles(root);
    expect(files.every((p) => p.startsWith('src/core/'))).toBe(true);
    expect(files).toContain('src/core/sim/goldens.json');
    expect(files).toContain('src/core/sim/step.ts');
    expect(files).toContain('src/core/bot/bot-id.ts');
    expect(files.filter((p) => p.endsWith('.json'))).toEqual(['src/core/sim/goldens.json']);
    expect(files.filter((p) => /\.test\.|\/(?:brain|marks|setups)\.ts$/.test(p))).toEqual([]);
    expect([...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(files);
  });

  it('orders paths by code unit, never by locale: an upper-case name before a lower-case one', () => {
    const added = ['src/core/sim/B.ts', 'src/core/sim/a.ts', 'src/core/sim/b-c.ts', 'src/core/sim/bc.ts'];
    for (const path of added) writeFileSync(join(copy, path), 'export {};\n');
    try {
      // A locale's collation would give a.ts, b-c.ts, B.ts, bc.ts, as ICU orders them.
      expect(buildInputFiles(copy).filter((p) => added.includes(p))).toEqual(added);
    } finally {
      for (const path of added) rmSync(join(copy, path), { force: true });
    }
    expect(buildInputs(copy)).toBe(base);
  });

  it('is the same for a checkout whose line endings are CRLF, as Git for Windows writes by default (R-9)', () => {
    const files = buildInputFiles(copy);
    const before = files.map((path) => readFileSync(join(copy, path)));
    try {
      files.forEach((path, k) => writeFileSync(join(copy, path), before[k].toString('latin1').replaceAll('\n', '\r\n'), 'latin1'));
      expect(readFileSync(join(copy, 'src/core/sim/step.ts'), 'latin1')).toContain('\r\n');
      expect(buildInputs(copy)).toBe(base);
      // A lone CR is a byte like any other.
      appendFileSync(join(copy, 'src/core/sim/step.ts'), '\r');
      expect(buildInputs(copy)).not.toBe(base);
    } finally {
      files.forEach((path, k) => writeFileSync(join(copy, path), before[k]));
    }
    expect(buildInputs(copy)).toBe(base);
  });

  it('is what vite.config.ts defines for the page, and vitest.config.ts for the tests, as src/build-info.ts reads it', async () => {
    const want = JSON.stringify(buildInputs(root));
    for (const file of ['vite.config.ts', 'vitest.config.ts']) {
      const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(root, file), root, 'silent');
      expect(loaded?.config.define?.__TERRIEST_BUILD_INPUTS__, file).toBe(want);
    }
    const { BUILD_INPUTS } = await import('../src/build-info');
    expect(BUILD_INPUTS).toBe(buildInputs(root));
  });
});
