import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDevRelay } from './dev-relay-audit.mjs';

// Design §1.33, §6.6: no dev relay ever reaches dist/. A dev-relay chunk
// fails, and so does an entry that imports one, or a file that names the
// dev server's variable; a clean folder passes. And scripts/audit-dist.mjs
// runs the check after hermet's audit, failing the build: it's run here on
// a planted folder, beside the files hermet's audit reads. The real
// build's dist/ passes at the integration step.
const root = fileURLToPath(new URL('..', import.meta.url));
const auditScript = fileURLToPath(new URL('./audit-dist.mjs', import.meta.url));

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'terriest-dev-relay-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ENTRY = 'const a=1;export{a};\n';
const LICENCES = 'Third-party notices.\n\n## three@0.187.0\n\nMIT\n\nThe MIT License, its text.\n';

/** A dist/ folder of the given files, under a fresh folder of dir. */
function dist(name, files) {
  const at = join(dir, name, 'dist');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  return at;
}
const clean = {
  'index.html': '<!doctype html><script type="module" src="./assets/index-a1b2c3.js"></script>\n',
  'boot.js': 'void 0;\n',
  'assets/index-a1b2c3.js': ENTRY,
  'THIRD-PARTY-LICENSES.txt': LICENCES,
};

describe('auditDevRelay', () => {
  it('passes a folder with no dev relay', () => {
    expect(auditDevRelay(dist('clean', clean))).toEqual([]);
  });

  it('fails a dev-relay chunk', () => {
    const at = dist('chunk', { ...clean, 'assets/dev-relay-d4e5f6.js': 'function r(e){return null}export{r as devRelay};\n' });
    expect(auditDevRelay(at)).toEqual(['assets/dev-relay-d4e5f6.js: a dev relay chunk ships']);
  });

  it('fails an entry that imports one, wherever it sits', () => {
    const at = dist('importer', { ...clean, 'assets/index-a1b2c3.js': `${ENTRY}const m=()=>import("./dev-relay-d4e5f6.js");\n` });
    expect(auditDevRelay(at)).toEqual(['assets/index-a1b2c3.js: names dev-relay']);
    const deep = dist('deep', { ...clean, 'assets/nested/x-1.js': 'import("../dev-relay-9.js");\n' });
    expect(auditDevRelay(deep)).toEqual(['assets/nested/x-1.js: names dev-relay']);
  });

  it("fails a file that names the dev server's variable", () => {
    const at = dist('variable', { ...clean, 'assets/index-a1b2c3.js': `${ENTRY}const p=import.meta.env.VITE_TERRIEST_LOCAL_RELAY_PORT;\n` });
    expect(auditDevRelay(at)).toEqual(['assets/index-a1b2c3.js: names VITE_TERRIEST']);
  });
});

describe('audit-dist.mjs', () => {
  /** Runs the build's audit in a folder that holds `files` as its dist/, with the repo's lists. */
  function audit(name, files) {
    const at = dirname(dist(name, files));
    cpSync(join(root, 'third-party.json'), join(at, 'third-party.json'));
    mkdirSync(join(at, 'scripts'), { recursive: true });
    cpSync(join(root, 'scripts', 'expected-licenses.json'), join(at, 'scripts', 'expected-licenses.json'));
    return spawnSync(process.execPath, [auditScript], { cwd: at, encoding: 'utf8' });
  }

  it("passes a clean dist/ after hermet's audit", () => {
    const r = audit('script-clean', clean);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('audit-dist: dist/ is clean');
    expect(r.stdout).toContain('audit-dist: no dev relay in dist/');
  });

  it('fails the build on a dev relay that passes every other check', () => {
    const r = audit('script-chunk', { ...clean, 'assets/dev-relay-d4e5f6.js': 'export{};\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('audit-dist: assets/dev-relay-d4e5f6.js: a dev relay chunk ships');
  });
});
