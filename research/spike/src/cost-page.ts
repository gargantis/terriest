// The page's ?test=cost mode (PLAN §17 M0, run 3): src/cost.ts's harness in
// the browser, for e2e/cost.spec.ts to run in Chromium on the desktop and at
// the Pixel 8a's size, at 1× and 4× CPU throttle. A chunk of its own, loaded
// only in this mode.
//
//   ?test=cost&script=<a scrum>&ticks=1200&runs=30&draw=1|0&quality=low|high
//
// - draw=1 (the default) runs it as a match would: the scene's clock (D-31's
//   timers, not animation frames) does one unit of work per 60 Hz tick, one
//   13-step tick, or later one burst, while the scene draws the bench's base
//   state at the page's size. Ticks behind a long frame catch up, as a real
//   timeline's do; each is still timed alone.
// - draw=0 runs the same units back to back with nothing drawn, yielding
//   every 10 ms: the browser's figure to set beside Node's.
// Times come from performance.now(), whose step is 0.1 ms in Chromium unless
// the page is cross-origin isolated (5 µs); the spec's server isolates it,
// and the report says which it got.

import type { SimSource } from './contract';
import { clockResolution, CostRun, DEFAULT_COST, stats, type CostReport, type Stats } from './cost.ts';
import type { pageOptions, runPage } from './scene/page';
import { viewOf } from './sim/source.ts';

/** The scene's page, handed in by main.ts: importing it here would make the
 *  bundler split three's core out of the entry chunk into one it shares
 *  with this chunk and the model drawer's. */
export interface Scene {
  runPage: typeof runPage;
  pageOptions: typeof pageOptions;
}

export interface CostPageResult {
  state: 'running' | 'done' | 'failed';
  error: string;
  draw: boolean;
  report: CostReport | null;
  /** Wall time from the first unit of work to the last. */
  wallMs: number;
  /** Animation frames during the timed ticks (draw=1 only). */
  frames: { count: number; interval: Stats } | null;
  env: {
    userAgent: string; crossOriginIsolated: boolean; clockResolutionMs: number; devicePixelRatio: number;
    viewport: { width: number; height: number }; hardwareConcurrency: number;
  };
}

declare global {
  interface Window {
    spikeCost?: CostPageResult;
  }
}

const now = (): number => performance.now();

function positive(q: URLSearchParams, key: string, fallback: number): number {
  const v = Number(q.get(key) ?? '');
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

export async function run(root: HTMLElement, q: URLSearchParams, scene: Scene): Promise<void> {
  const draw = q.get('draw') !== '0';
  const result: CostPageResult = {
    state: 'running', error: '', draw, report: null, wallMs: 0, frames: null,
    env: {
      userAgent: navigator.userAgent, crossOriginIsolated: self.crossOriginIsolated === true, clockResolutionMs: clockResolution(now),
      devicePixelRatio, viewport: { width: innerWidth, height: innerHeight }, hardwareConcurrency: navigator.hardwareConcurrency,
    },
  };
  window.spikeCost = result;
  let cost: CostRun;
  try {
    cost = new CostRun({
      script: q.get('script') ?? DEFAULT_COST.script,
      ticks: positive(q, 'ticks', DEFAULT_COST.ticks),
      burstRuns: positive(q, 'runs', DEFAULT_COST.burstRuns),
    });
  } catch (e) {
    // An unknown script, say: fail where the spec is watching, not by its timeout.
    result.state = 'failed';
    result.error = e instanceof Error ? e.message : String(e);
    throw e;
  }

  const hud = document.createElement('pre');
  hud.dataset.test = 'cost';
  hud.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;max-width:calc(100% - 32px);white-space:pre-wrap;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#fff;background:rgba(0,0,0,.65);border-radius:4px;pointer-events:none;z-index:1';
  const f = (x: number): string => x.toFixed(3);
  const show = (): void => {
    const p = cost.progress();
    const lines = [`run 3: ${cost.bench.script.name}, ${draw ? 'drawn, on the clock' : 'not drawn, back to back'}`];
    const r = result.report;
    if (r) {
      lines.push(
        `13-step tick (ms): mean ${f(r.tick.mean)}  p95 ${f(r.tick.p95)}  max ${f(r.tick.max)}  over ${r.tick.n} ticks`,
        `per step (ms): mean ${f(r.step.mean)}  p95 ${f(r.step.p95)}`,
        `contacts per substep ${r.contacts.perSubstep.toFixed(2)} (${r.contacts.floorPerSubstep.toFixed(2)} floor), most ${r.contacts.maxInSubstep}`,
        ...r.bursts.map((b) => `${b.steps} steps in one tick: median ${f(b.ms.p50)}  max ${f(b.ms.max)} ms (${b.within ? 'within' : 'over'} ${b.limitMs} ms)`),
        `stop rule, p95 <= ${r.stopRule.p95LimitMs} ms: ${r.stopRule.within ? 'met' : 'exceeded'}`,
        `clock step ${result.env.clockResolutionMs.toFixed(3)} ms; isolated: ${result.env.crossOriginIsolated}`,
      );
    } else lines.push(`${p.phase}: ${p.done} of ${p.of}`);
    hud.textContent = lines.join('\n');
  };

  let first = -1;
  const finish = (): void => {
    if (result.state !== 'running') return;
    result.wallMs = now() - first;
    result.report = cost.report();
    result.frames = draw ? { count: frameIntervals.length, interval: stats(frameIntervals) } : null;
    result.state = 'done';
    show();
  };
  const unit = (): boolean => {
    if (first < 0) first = now();
    const more = cost.step(now);
    if (!more) finish();
    return more;
  };

  const frameIntervals: number[] = [];
  try {
    if (draw) {
      // The bench as a SimSource: the scene's clock advances it a tick at a
      // time, and it shows the base state.
      const source: SimSource = {
        packSize: cost.bench.script.packSize,
        view: () => viewOf(cost.bench.base),
        advance(ticks: number) {
          for (let i = 0; i < ticks && !cost.done; i++) unit();
        },
      };
      await scene.runPage({ ...scene.pageOptions(root, source), seconds: 3600, warmup: 1, modelUrl: '' });
      if (window.spikeResult?.state === 'failed') throw new Error(`the scene failed: ${window.spikeResult.error}`);
      document.body.append(hud);
      let last = -1;
      const frame = (t: number): void => {
        if (cost.progress().phase === 'timed' && last >= 0) frameIntervals.push(t - last);
        last = t;
        if (result.state === 'running') {
          show();
          requestAnimationFrame(frame);
        }
      };
      requestAnimationFrame(frame);
    } else {
      root.replaceChildren(hud);
      const loop = (): void => {
        const until = now() + 10;
        let more = true;
        while (more && now() < until) more = unit();
        show();
        if (!cost.done) setTimeout(loop, 0);
      };
      setTimeout(loop, 50);
    }
  } catch (e) {
    result.state = 'failed';
    result.error = e instanceof Error ? e.message : String(e);
    hud.textContent = `run 3 failed: ${result.error}`;
    throw e;
  }
}
