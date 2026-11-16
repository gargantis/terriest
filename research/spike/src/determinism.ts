// The page's determinism check (PLAN §16 Determinism, M0 run 1), as
// roslambo's src/determinism.ts: opened as ?test=determinism (or
// #test=determinism), the production bundle replays every golden script and
// the canary, and publishes the hashes on window.spikeDeterminism for
// e2e/determinism.spec.ts to compare with src/sim/goldens.json, which Node
// emitted. It also compares them itself and shows the verdict, so the page
// can be opened by hand in any browser. It's a chunk of its own, loaded only
// in this mode, so the goldens never weigh on the scene's download.

import { canaryHash, CHECKPOINT_EVERY, goldenSuite, type GoldenResult } from './sim/golden.ts';
import goldens from './sim/goldens.json';

export interface DeterminismReport {
  /** Milliseconds for the whole suite and the canary. */
  ms: number;
  canary: string;
  runs: GoldenResult[];
  checkpointEvery: number;
  /** Against the goldens bundled with the page: the first difference, or ''. */
  firstDifference: string;
  verdict: 'PASS' | 'FAIL';
  userAgent: string;
}

declare global {
  interface Window {
    spikeDeterminism?: DeterminismReport;
  }
}

function firstDifference(runs: readonly GoldenResult[], canary: string): string {
  const want = goldens.runs as GoldenResult[];
  if (runs.length !== want.length) return `${runs.length} runs, against ${want.length} in goldens.json`;
  for (let i = 0; i < want.length; i++) {
    const got = runs[i]!;
    const w = want[i]!;
    if (got.name !== w.name) return `run ${i} is ${got.name}, not ${w.name}`;
    const k = w.checkpoints.findIndex((h, j) => h !== got.checkpoints[j]);
    if (k >= 0) return `${w.name}: checkpoint ${k} (tick ${(k + 1) * CHECKPOINT_EVERY}) is ${got.checkpoints[k] ?? 'missing'}, not ${w.checkpoints[k]}`;
    if (got.final !== w.final) return `${w.name}: final ${got.final}, not ${w.final}`;
    if (JSON.stringify(got) !== JSON.stringify(w)) return `${w.name}: counters differ`;
  }
  return canary === goldens.canary ? '' : `canary ${canary}, not ${goldens.canary}`;
}

export function run(root: HTMLElement): void {
  const out = document.createElement('pre');
  out.dataset.test = 'determinism';
  out.style.cssText = 'margin:16px;white-space:pre-wrap;font:14px/1.4 ui-monospace,Menlo,Consolas,monospace';
  out.textContent = `Determinism: replaying ${goldens.runs.length} golden scripts and the canary…`;
  root.replaceChildren(out);
  // Let the message paint before the suite holds the main thread.
  setTimeout(() => {
    const t0 = performance.now();
    const runs = goldenSuite();
    const canary = canaryHash();
    const ms = performance.now() - t0;
    const diff = firstDifference(runs, canary);
    const report: DeterminismReport = {
      ms, canary, runs, checkpointEvery: CHECKPOINT_EVERY, firstDifference: diff,
      verdict: diff === '' ? 'PASS' : 'FAIL', userAgent: navigator.userAgent,
    };
    window.spikeDeterminism = report;
    document.documentElement.dataset.determinism = diff === '' ? 'pass' : 'fail';
    const checkpoints = runs.reduce((n, r) => n + r.checkpoints.length, 0);
    out.textContent = [
      `Determinism: ${report.verdict}`,
      `${runs.length} golden scripts, ${checkpoints} checkpoints every ${CHECKPOINT_EVERY} ticks, and the canary (${canary}), in ${(ms / 1000).toFixed(2)} s`,
      diff === '' ? 'Every hash equals goldens.json, which Node emitted.' : `First difference from goldens.json: ${diff}`,
      navigator.userAgent,
    ].join('\n');
  }, 50);
}
