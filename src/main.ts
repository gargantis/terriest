// The page's entry (PLAN §6; M4's design, research/m4/DESIGN.md, §1.52,
// §5.1, M4-Q1, M4-Q38): wiring. public/boot.js runs its checks first and
// defines window.terriestBoot only if they pass (D-30). The fragment's
// #test=determinism opens the determinism page, from a chunk of its own and
// with no canvas (M2's design §7.5), and #test=net the network test page
// likewise (M3's design §1.28, §7); each makes its own landmark and no
// #app. Otherwise, in this order:
// - the settings store, whose render quality the stage is made at (A.3,
//   D-33, M4-Q4: M1's ?quality= is gone);
// - the stage, the page's one WebGL 2 context, with the code-built drawer,
//   whose chunk this imports statically (D-27); without WebGL 2, boot.js's
//   message shows, and nothing else runs, no canvas in the page;
// - <main id="app"> holding #stage and #screen, on the normal page only, so
//   a test page never shows a second main landmark (M4-Q1);
// - the profile store, which a first visit writes at once (PLAN §10);
// - the App, whose start() shows the first screen, adds inspect() and
//   hashAt() to a spec's hook, calls boot.started(), and starts the
//   compile behind the screen (M4-Q38).
// The hook's types are src/ui/inspect.ts's, re-exported here, where the
// specs import them.

import { BUILD_INPUTS } from './build-info';
import { config, type RenderQuality } from './config';
import { buildHash } from './core/session/index';
import { createCodeDrawer } from './render/drawers/code';
import { PLACEHOLDER_LOOK } from './render/look';
import { createStage } from './render/scene';
import type { Stage } from './render/stage-types';
import { ProfileStore } from './storage/profile';
import { SettingsStore } from './storage/settings';
import { App, appRoot } from './ui/app';
import { browserClock, browserPage } from './ui/clock';
import type { TerriestTest } from './ui/inspect';

export type { Inspection, TerriestTest } from './ui/inspect';

/** What public/boot.js offers the module (D-30). */
export interface Boot {
  /** The app has started: cancels the load timeout and takes the message down. */
  started(): void;
  /** No WebGL 2 at load: its message shows, and stays. */
  noWebGL2(): void;
}

declare global {
  interface Window {
    terriestBoot?: Boot;
    /** Set by an end-to-end test before the page loads, never by a normal page, whose behaviour it never
     *  changes but by the plan's leave: modelUrl (D-27), and from phase 2 relay and ice (M4-Q3). */
    terriestTest?: TerriestTest;
  }
}

/** The #test= page the fragment names, or null for a normal page. */
function testPage(): string | null {
  return new URLSearchParams(location.hash.slice(1)).get('test');
}

async function start(boot: Boot): Promise<void> {
  const which = testPage();
  if (which === 'determinism') {
    (await import('./determinism')).run(boot);
    return;
  }
  if (which === 'net') {
    (await import('./nettest')).run(boot);
    return;
  }
  const test = window.terriestTest ?? null;
  const settings = new SettingsStore();
  // A model's URL only from a spec's hook, as a shipped model's would load (D-27); '' in the MVP.
  const modelUrl = typeof test?.modelUrl === 'string' ? test.modelUrl : config.terrierModelUrl;
  const makeStage = (quality: RenderQuality): Stage | null =>
    createStage({ quality, look: PLACEHOLDER_LOOK, drawer: createCodeDrawer, capacity: 2 * config.packSizeMax, modelUrl });
  const stage = makeStage(settings.get().quality);
  if (stage === null) {
    boot.noWebGL2();
    return;
  }
  // index.html hides the landmark until boot.js takes its own down, so the page never shows two.
  const root = appRoot();
  document.body.append(root);
  const app = new App({
    root, stage, makeStage, profile: new ProfileStore(), settings, test,
    build: buildHash(config, BUILD_INPUTS), clock: browserClock, page: browserPage, boot,
  });
  await app.start();
}

const boot = window.terriestBoot;
if (boot) void start(boot);
