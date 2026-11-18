// The #test=determinism page (PLAN §16 Determinism, Q-12; design §1.20,
// §7.5), from the M0 spike's and roslambo's: the production bundle replays
// every golden run and the canary, compares them with the goldens.json it
// was built with, which Node emitted, counters, coverage and checks
// included, and shows the verdict, so any browser can be checked by hand.
// It publishes the result on window.terriestDeterminism and
// html[data-determinism] for e2e/determinism.spec.ts. A chunk of its own,
// loaded only on this page: it makes no WebGL context and requests nothing
// beyond the chunk.

import { CODEC_VERSION } from './core/sim/codec';
import { CHECKPOINT_EVERY, coverageProblems, goldenSuite, type GoldenResult, type Goldens, replay } from './core/sim/golden';
import goldensFile from './core/sim/goldens.json';
import { CANARY_SCRIPT, GOLDEN_SCRIPTS } from './core/sim/scripts';
import type { Boot } from './main';

export interface DeterminismReport {
  /** Milliseconds for the suite and the canary. */
  ms: number;
  canary: string;
  runs: GoldenResult[];
  checkpointEvery: number;
  /** Against goldens.json, each run's coverage included: the first difference, or ''. */
  firstDifference: string;
  verdict: 'PASS' | 'FAIL';
  userAgent: string;
}

declare global {
  interface Window {
    /** This page's alone (design §14 Q-16): a normal page never has it. */
    terriestDeterminism?: DeterminismReport;
  }
}

// A JSON import types the score's pair as number[], so the cast goes
// through unknown; golden.test.ts checks the file's shape against replay's.
const goldens = goldensFile as unknown as Goldens;

/** The first field of a run that differs from goldens.json's, or ''. */
function runDifference(got: GoldenResult, want: GoldenResult): string {
  const k = want.checkpoints.findIndex((h, j) => h !== got.checkpoints[j]);
  if (k >= 0) return `${want.name}: checkpoint ${k + 1}, at tick ${(k + 1) * CHECKPOINT_EVERY}, is ${got.checkpoints[k] ?? 'missing'}, not ${want.checkpoints[k]}`;
  const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])] as (keyof GoldenResult)[];
  for (const key of keys) {
    const a = JSON.stringify(got[key]);
    const b = JSON.stringify(want[key]);
    if (a !== b) return `${want.name}: ${key} is ${a ?? 'missing'}, not ${b ?? 'missing'}`;
  }
  return '';
}

/** The first difference from goldens.json, or a run's or the canary's
 *  coverage problem; '' when there is none. */
function firstDifference(runs: readonly GoldenResult[], canary: GoldenResult): string {
  if (goldens.codec !== CODEC_VERSION) return `goldens.json is for codec ${goldens.codec}, not ${CODEC_VERSION}`;
  if (goldens.checkpointEvery !== CHECKPOINT_EVERY) return `goldens.json checkpoints every ${goldens.checkpointEvery} ticks, not ${CHECKPOINT_EVERY}`;
  if (runs.length !== goldens.runs.length) return `${runs.length} runs, against ${goldens.runs.length} in goldens.json`;
  for (let i = 0; i < runs.length; i++) {
    const got = runs[i]!;
    const want = goldens.runs[i]!;
    if (got.name !== want.name) return `run ${i + 1} is ${got.name}, not ${want.name}`;
    const diff = runDifference(got, want);
    if (diff !== '') return diff;
    const [problem] = coverageProblems(GOLDEN_SCRIPTS[i]!, got);
    if (problem !== undefined) return `${got.name}: ${problem}`;
  }
  if (canary.final !== goldens.canary) return `the canary is ${canary.final}, not ${goldens.canary}`;
  const [problem] = coverageProblems(CANARY_SCRIPT, canary);
  return problem === undefined ? '' : `the canary: ${problem}`;
}

/** Shows the page, tells boot.js the app has started, and replays once the
 *  message has painted. */
export function run(boot: Boot): void {
  const main = document.createElement('main');
  main.id = 'determinism';
  main.style.cssText = 'max-width: 48rem; padding: 1rem 1.5rem';
  const heading = document.createElement('h1');
  heading.textContent = 'Determinism';
  const out = document.createElement('pre');
  out.style.cssText = 'white-space: pre-wrap; font: 0.9em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  out.textContent = `Replaying ${GOLDEN_SCRIPTS.length} golden runs and the canary…`;
  main.append(heading, out);
  document.body.append(main);
  // The loading message goes, so one main landmark shows (D-30).
  boot.started();
  // Let the message paint before the suite holds the main thread.
  setTimeout(() => {
    const t0 = performance.now();
    let runs: GoldenResult[] = [];
    let diff: string;
    let canary = '';
    try {
      runs = goldenSuite();
      const c = replay(CANARY_SCRIPT);
      canary = c.final;
      diff = firstDifference(runs, c);
    } catch (e) {
      diff = `the replay threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    const ms = performance.now() - t0;
    const report: DeterminismReport = {
      ms, canary, runs, checkpointEvery: CHECKPOINT_EVERY, firstDifference: diff,
      verdict: diff === '' ? 'PASS' : 'FAIL', userAgent: navigator.userAgent,
    };
    window.terriestDeterminism = report;
    document.documentElement.dataset.determinism = diff === '' ? 'pass' : 'fail';
    const checkpoints = runs.reduce((n, r) => n + r.checkpoints.length, 0);
    out.textContent = [
      `Determinism: ${report.verdict}`,
      `${runs.length} golden runs, ${checkpoints} checkpoints every ${CHECKPOINT_EVERY} ticks, and the canary (${canary}), in ${(ms / 1000).toFixed(2)} s.`,
      diff === '' ? 'Every hash, counter and check equals goldens.json, which Node emitted.' : `The first difference from goldens.json: ${diff}`,
      navigator.userAgent,
    ].join('\n');
  }, 50);
}
