// The verification page (built by scripts/verify/vite.config.mjs, driven by
// scripts/verify/driver.mjs; not part of the spike's page):
//   ?mode=cost&script=…&ticks=1200&warm=120&settle=120&runs=10&paced=0|1
//     run 3's harness (src/cost.ts) with every timed tick kept, a fixed busy
//     loop timed before and after (it scales with the CPU the main thread
//     gets, so it shows the throttle), and a paced mode: one unit of work per
//     60 Hz tick from a clock checked twice a tick, nothing drawn;
//   ?mode=det
//     the extra determinism runs (det-runs.ts).

import { CostRun, stats } from '../../../src/cost.ts';
import { runExtra } from './det-runs.ts';

declare global {
  interface Window { verify?: Record<string, unknown> }
}

const now = (): number => performance.now();
const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = Number(q.get(k) ?? '');
  return q.has(k) && Number.isFinite(v) && v >= 0 ? v : d;
};

let sink = 0;
/** A fixed integer busy loop, in ms. */
function probe(): number {
  const t0 = now();
  let x = 1;
  for (let i = 0; i < 4_000_000; i++) x = (Math.imul(x, 1664525) + 1013904223) | 0;
  sink ^= x;
  return now() - t0;
}
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function costMode(): void {
  const script = q.get('script') ?? 'scrum at the wall, flag42';
  const paced = q.get('paced') === '1';
  const run = new CostRun({ script, ticks: num('ticks', 1200), warmupTicks: num('warm', 120), settleTicks: num('settle', 120), burstRuns: num('runs', 10) });
  const before: number[] = [];
  for (let i = 0; i < 5; i++) before.push(probe());
  const result: Record<string, unknown> = {
    state: 'running', paced, script, probeMs: median(before), isolated: self.crossOriginIsolated === true,
    ua: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
  };
  window.verify = result;
  const finish = (dropped: number): void => {
    const after: number[] = [];
    for (let i = 0; i < 5; i++) after.push(probe());
    const tickMs = (run as unknown as { tickMs: number[] }).tickMs;
    Object.assign(result, {
      probeAfterMs: median(after), report: run.report(), tickMs, dropped, sink,
      blocks: [0, 1, 2, 3].map((b) => stats(tickMs.slice((b * tickMs.length) / 4, ((b + 1) * tickMs.length) / 4))),
      state: 'done',
    });
  };
  if (!paced) {
    const loop = (): void => {
      const until = now() + 10;
      let more = true;
      while (more && now() < until) more = run.step(now);
      if (more) setTimeout(loop, 0);
      else finish(0);
    };
    setTimeout(loop, 50);
    return;
  }
  const t0 = now();
  let done = 0;
  let dropped = 0;
  const timer = setInterval(() => {
    let due = Math.floor(((now() - t0) * 60) / 1000) - dropped - done;
    if (due > 44) {
      dropped += due - 44;
      due = 44;
    }
    for (let i = 0; i < due; i++) {
      done++;
      if (!run.step(now)) {
        clearInterval(timer);
        finish(dropped);
        return;
      }
    }
  }, 1000 / 120);
}

if (q.get('mode') === 'cost') costMode();
else if (q.get('mode') === 'det') {
  setTimeout(() => {
    const t0 = now();
    const runs = runExtra();
    window.verify = { state: 'done', ms: now() - t0, runs, ua: navigator.userAgent };
  }, 20);
}
