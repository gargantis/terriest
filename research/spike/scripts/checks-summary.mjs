// Run 2's checks as a record (PLAN §17 M0): lint, typecheck and vitest, from
// the raw output scripts/m0-run.mjs kept in results/tmp/ (not tracked):
// - results/tmp/eslint.json: `eslint . --max-warnings 0 -f json`;
// - results/tmp/vitest.json and results/tmp/run2-vitest.log: `vitest run`
//   with the JSON reporter, and the lines the tests print ([slip-out], [hits]…);
// - results/runs-log.json: each command's exit code, wall time and load.
// Writes results/checks.json, with paths relative to this folder, and which
// simulation files ESLint applied hermet's exact-ops rule to.
//
//   node scripts/checks-summary.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const rel = (p) => relative(root, p).split('\\').join('/');
const runs = JSON.parse(read('results/runs-log.json')).runs;
const runOf = (name) => {
  const r = runs.filter((x) => x.name === name).at(-1);
  return r ? { exitCode: r.exitCode, utcStart: r.utcStart, wallSeconds: r.wallSeconds, load1mBefore: r.load.before.l1, command: r.command } : null;
};

// ESLint: every file, and the rule set on each simulation file.
const lint = JSON.parse(read('results/tmp/eslint.json'));
const eslint = new ESLint({ cwd: root });
const simFiles = lint.map((f) => rel(f.filePath)).filter((f) => f.startsWith('src/sim/'));
const exactOps = {};
for (const f of simFiles) {
  const c = await eslint.calculateConfigForFile(join(root, f));
  const rule = c.rules?.['hermet/exact-ops'];
  exactOps[f] = Array.isArray(rule) ? rule[0] === 2 || rule[0] === 'error' : rule === 2 || rule === 'error';
}

// vitest: every test, and what the tests print.
const vt = JSON.parse(read('results/tmp/vitest.json'));
const printed = read('results/tmp/run2-vitest.log').split('\n').filter((l) => /^\[[\w -]+\]/.test(l)).map((l) => l.trimEnd());

const out = {
  utc: new Date().toISOString(),
  about: "M0 run 2's checks: lint (with hermet's exact-ops rule on src/sim), typecheck and the vitest suite",
  lint: {
    ...runOf('run2-lint'),
    files: lint.length,
    errors: lint.reduce((a, f) => a + f.errorCount, 0),
    warnings: lint.reduce((a, f) => a + f.warningCount, 0),
    messages: lint.flatMap((f) => f.messages.map((m) => ({ file: rel(f.filePath), line: m.line, rule: m.ruleId, message: m.message }))),
    exactOpsOn: Object.entries(exactOps).filter(([, on]) => on).map(([f]) => f),
    exactOpsOff: Object.entries(exactOps).filter(([, on]) => !on).map(([f]) => f),
  },
  typecheck: runOf('run2-typecheck'),
  vitest: {
    ...runOf('run2-vitest'),
    success: vt.success,
    files: vt.testResults.length,
    tests: { total: vt.numTotalTests, passed: vt.numPassedTests, failed: vt.numFailedTests, skipped: vt.numPendingTests },
    byFile: vt.testResults.map((f) => ({
      file: rel(f.name), status: f.status, ms: Math.round(f.endTime - f.startTime),
      tests: f.assertionResults.map((a) => ({ name: a.fullName, status: a.status, ms: a.duration === null || a.duration === undefined ? null : Math.round(a.duration) })),
    })),
    printed,
  },
  measurements: { ...runOf('run2-measure'), file: 'results/sim.json' },
};
writeFileSync(join(root, 'results', 'checks.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`lint: ${out.lint.files} files, ${out.lint.errors} errors, ${out.lint.warnings} warnings; exact-ops on ${out.lint.exactOpsOn.length} simulation files (off on ${out.lint.exactOpsOff.length}: the tests)`);
console.log(`typecheck: exit ${out.typecheck?.exitCode}`);
console.log(`vitest: ${out.vitest.tests.passed} passed, ${out.vitest.tests.failed} failed, ${out.vitest.tests.skipped} skipped in ${out.vitest.files} files; ${printed.length} printed lines`);
