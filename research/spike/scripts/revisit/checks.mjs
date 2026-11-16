// M0's cost revisit: the checks after it, at the settings in force: lint
// (with hermet's exact-ops rule on src/sim), typecheck and the whole vitest
// suite, the golden hashes included, with no solver variant set. Each
// command's exit code, wall time and the load before it, with lint's and
// vitest's counts. Raw output goes to results/tmp/revisit/ (not tracked).
//
//   node scripts/revisit/checks.mjs   -> results/revisit/checks.json
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applySolverDefaults, solverLabel } from '../../src/solver-settings.ts';
import { load, uptime } from './load.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const at = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
mkdirSync(at('results/tmp/revisit'), { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('TERRIEST_SPIKE_')));

function run(cmd, argv) {
  const before = { ...load(), uptime: uptime() };
  const t0 = Date.now();
  const r = spawnSync(cmd, argv, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 256 << 20 });
  return { command: [cmd, ...argv].join(' '), exitCode: r.status, wallSeconds: +((Date.now() - t0) / 1000).toFixed(1), load1mBefore: before.l1, uptimeBefore: before.uptime, stdout: r.stdout, stderr: r.stderr };
}

const lint = run('npx', ['eslint', '.', '--max-warnings', '0', '-f', 'json', '-o', 'results/tmp/revisit/eslint.json']);
const lintFiles = JSON.parse(readFileSync(at('results/tmp/revisit/eslint.json'), 'utf8'));
const typecheck = run('npx', ['tsc', '--noEmit']);
const vitest = run('npx', ['vitest', 'run', '--reporter=default', '--reporter=json', '--outputFile.json=results/tmp/revisit/vitest-checks.json']);
const vt = JSON.parse(readFileSync(at('results/tmp/revisit/vitest-checks.json'), 'utf8'));
writeFileSync(at('results/tmp/revisit/vitest-checks.log'), `${vitest.stdout}\n${vitest.stderr}`);
const strip = ({ stdout, stderr, ...rest }) => ({ ...rest, ...(rest.exitCode !== 0 ? { output: `${stdout}\n${stderr}`.slice(-4000) } : {}) });

const out = {
  about: "M0's cost revisit: lint, typecheck and the whole vitest suite at the settings in force (scripts/revisit/checks.mjs)",
  utc: new Date().toISOString(), node: process.version, solver: solverLabel(applySolverDefaults(undefined)),
  lint: { ...strip(lint), files: lintFiles.length, errors: lintFiles.reduce((a, f) => a + f.errorCount, 0), warnings: lintFiles.reduce((a, f) => a + f.warningCount, 0) },
  typecheck: strip(typecheck),
  vitest: {
    ...strip(vitest), success: vt.success, files: vt.testResults.length,
    tests: { total: vt.numTotalTests, passed: vt.numPassedTests, failed: vt.numFailedTests, skipped: vt.numPendingTests },
    failed: vt.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName)),
  },
};
writeFileSync(at('results/revisit/checks.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${out.solver}: lint exit ${lint.exitCode} (${out.lint.files} files, ${out.lint.errors} errors, ${out.lint.warnings} warnings); typecheck exit ${typecheck.exitCode}; ` +
  `vitest exit ${vitest.exitCode}: ${out.vitest.tests.passed} passed, ${out.vitest.tests.failed} failed, ${out.vitest.tests.skipped} skipped in ${out.vitest.files} files`);
