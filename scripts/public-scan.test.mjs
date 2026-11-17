import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// PLAN §15, Q-1, D-37: public-scan says which scan it runs, since hermet
// prints the same line with or without the private denylist, and fails
// when TERRIEST_PRIVATE_TERMS names no file, rather than skip the list.
const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('./public-scan.mjs', import.meta.url));
const run = (terms) => {
  const env = { ...process.env };
  delete env.TERRIEST_PRIVATE_TERMS;
  if (terms !== undefined) env.TERRIEST_PRIVATE_TERMS = terms;
  return spawnSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8' });
};

let dir;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'terriest-public-scan-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('public-scan', () => {
  it('says it runs the built-in patterns only when TERRIEST_PRIVATE_TERMS is unset, as on CI', () => {
    const r = run(undefined);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^public-scan: TERRIEST_PRIVATE_TERMS is unset, so the built-in patterns only/);
    expect(r.stdout).toMatch(/tracked files clean/);
  });

  it('fails, before scanning, when TERRIEST_PRIVATE_TERMS names no file', () => {
    const r = run(join(dir, 'missing.txt'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/TERRIEST_PRIVATE_TERMS names no file/);
    expect(r.stderr).not.toContain(dir);
    expect(r.stdout).not.toMatch(/tracked files clean/);
  });

  it('says it reads the denylist when the variable names one', async () => {
    const list = join(dir, 'terms.txt');
    await writeFile(list, '# a comment, and no terms\n');
    const r = run(list);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^public-scan: the built-in patterns and the private denylist/);
  });
});
