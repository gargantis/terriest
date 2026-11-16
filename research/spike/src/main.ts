// The spike's page (PLAN §17 M0). By default the scene (src/scene) draws the
// spike's simulation (src/sim), which it reads only through src/contract.ts:
// a SimSource from createSimSource, advanced by the clock and drawn on
// animation frames. URL parameters:
// - script, pack, slipOut: which simulation (src/source-choice.ts); the
//   default is the showcase, a 4-a-side kickoff that plays on;
// - quality, seconds, warmup, camera: the scene's (src/scene/page.ts);
// - frameWork=N: N ms of busy work in every animation frame, to hold the
//   frame rate down and show the ticks still follow the clock (run 4);
// - test=determinism: replay the goldens instead (src/determinism.ts, run 1);
// - test=cost: time the replay bench instead (src/cost-page.ts, run 3).
// `test` is also read from the fragment (#test=determinism), as roslambo's
// page reads it. The test modes are chunks of their own.

import { pageOptions, runPage } from './scene/page';
import { createSimSource } from './sim/source.ts';
import { sourceChoice } from './source-choice.ts';

export interface SpikePage {
  script: string;
  packSize: number;
  slipOut: string;
  frameWork: number;
}

declare global {
  interface Window {
    spikePage?: SpikePage;
  }
}

function fail(root: HTMLElement, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  document.documentElement.dataset.failed = message;
  const r = window.spikeResult;
  if (r) {
    r.state = 'failed';
    r.error = message;
  }
  const p = document.createElement('p');
  p.textContent = `The M0 spike failed: ${message}`;
  root.append(p);
  console.error(e);
}

/** Busy work in every animation frame, beside the scene's own. */
function holdFramesDown(ms: number): void {
  const burn = (): void => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      // the work
    }
    requestAnimationFrame(burn);
  };
  requestAnimationFrame(burn);
}

async function start(root: HTMLElement): Promise<void> {
  const q = new URLSearchParams(location.search);
  const test = q.get('test') ?? new URLSearchParams(location.hash.slice(1)).get('test');
  if (test === 'determinism') {
    (await import('./determinism.ts')).run(root);
    return;
  }
  if (test === 'cost') {
    await (await import('./cost-page.ts')).run(root, q, { runPage, pageOptions });
    return;
  }
  const choice = sourceChoice(q);
  const frameWork = Math.max(0, Number(q.get('frameWork') ?? '0') || 0);
  window.spikePage = { script: choice.script, packSize: choice.packSize, slipOut: choice.slipOut, frameWork };
  const source = createSimSource(choice.options);
  const running = runPage(pageOptions(root, source));
  const label = document.createElement('pre');
  label.dataset.test = 'script';
  label.style.cssText = 'position:fixed;right:8px;bottom:8px;margin:0;padding:4px 6px;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#fff;background:rgba(0,0,0,.55);border-radius:4px;pointer-events:none';
  label.textContent = `${choice.script}, slip-out ${choice.slipOut}${frameWork ? `, ${frameWork} ms of extra work a frame` : ''}`;
  document.body.append(label);
  if (frameWork > 0) holdFramesDown(frameWork);
  await running;
}

const root = document.querySelector<HTMLElement>('#app');
if (root) start(root).catch((e: unknown) => fail(root, e));
