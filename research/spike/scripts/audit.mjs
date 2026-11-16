// Run 5 (PLAN §17 M0, C-9): the production build through hermet's licence
// writer and dist audit, from the hermet checkout beside this repo (D-37),
// with no exceptions: no allowed hosts, three as the only expected package,
// and none of auditDist's app options. Every finding is printed, and the
// run exits 1 if there is any, as hermet's runAuditDist does.
//
//   npm run build && node scripts/audit.mjs [--app-options] [--json out.json]
//
// --app-options audits the same files a second time with the app options
// M0 found the build needs (APP_OPTIONS), to show they clear every finding;
// the exit code still follows the run with no exceptions.
//
// The licence writer turns Vite's dist/.license-npm.json into
// dist/THIRD-PARTY-LICENSES.txt and deletes the JSON, so this needs a fresh
// build each time.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLicenseNotices } from '../../../../hermet/licenses.mjs';
import { auditDist } from '../../../../hermet/audit-dist.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

export const OPTIONS = { allowedHosts: [], expectedLicensePackages: ['three'] };

/**
 * auditDist's existing app options that clear M0's findings (C-9):
 * - textFiles: the static host's _headers (D-35), as D-37 plans;
 * - ignoredPaths: the separator '/' in three's LoaderUtils.extractUrlBase,
 *   which ships with GLTFLoader and is never requested.
 */
export const APP_OPTIONS = { ...OPTIONS, textFiles: ['_headers'], ignoredPaths: ['/'] };

export async function audit({ appOptions = false } = {}) {
  if (!existsSync(join(dist, '.license-npm.json'))) {
    throw new Error('dist/.license-npm.json is missing: run `npm run build` first (the licence writer deletes it)');
  }
  await writeLicenseNotices({ product: 'terriest spike', dist });
  const strict = await auditDist(dist, OPTIONS);
  return { findings: strict.findings, withAppOptions: appOptions ? (await auditDist(dist, APP_OPTIONS)).findings : null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { findings, withAppOptions } = await audit({ appOptions: process.argv.includes('--app-options') });
  const line = (f) => `${f.file}: ${f.why}${f.detail ? ` (${f.detail})` : ''}`;
  for (const f of findings) console.error(`audit-dist: ${line(f)}`);
  if (withAppOptions) {
    const extra = Object.fromEntries(Object.entries(APP_OPTIONS).filter(([k]) => !(k in OPTIONS)));
    console.log(`audit-dist with the app options ${JSON.stringify(extra)}: ${withAppOptions.length === 0 ? 'clean' : withAppOptions.map(line).join('; ')}`);
  }
  const at = process.argv.indexOf('--json');
  if (at > 0 && process.argv[at + 1]) {
    const out = resolve(process.argv[at + 1]);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify({ options: OPTIONS, findings, appOptions: APP_OPTIONS, withAppOptions }, null, 2)}\n`);
  }
  if (findings.length > 0) {
    console.error(`audit-dist: ${findings.length} finding(s)`);
    process.exit(1);
  }
  console.log('audit-dist: dist/ is clean');
}
