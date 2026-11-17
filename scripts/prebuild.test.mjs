import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// PLAN §15: `npm run build` stops at prebuild, naming the command that
// fetches the submodule, when vendor/hermet is empty, as in a fresh clone;
// `npm run check` stops there too.
const script = fileURLToPath(new URL('./prebuild.mjs', import.meta.url));
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

let dir;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'terriest-prebuild-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('prebuild', () => {
  it('runs before the build and before the gate', () => {
    expect(scripts.prebuild).toBe('node scripts/prebuild.mjs');
    expect(scripts.precheck).toBe('node scripts/prebuild.mjs');
  });

  it('stops, naming git submodule update --init, when the folder is empty or missing', async () => {
    const empty = join(dir, 'empty');
    await mkdir(empty);
    for (const folder of [empty, join(dir, 'missing')]) {
      const r = run(folder);
      expect(r.status, folder).toBe(1);
      expect(r.stderr).toContain('git submodule update --init');
    }
  });

  it('passes once the folder has files', async () => {
    const full = join(dir, 'full');
    await mkdir(full);
    await writeFile(join(full, 'audit-dist.mjs'), '');
    expect(run(full).status).toBe(0);
  });

  it('passes on this checkout, whose vendor/hermet is fetched', () => {
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});
