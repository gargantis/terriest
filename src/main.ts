// The page's entry (PLAN §6): wiring. public/boot.js runs its checks first
// and defines window.terriestBoot only if they pass (D-30). Then the
// renderer starts, the empty pitch draws its first frame, and boot.js is
// told the app has started, which takes its message down. Without WebGL 2,
// boot.js shows that message instead, and nothing else runs. Settings
// arrive at M4; until then the render quality comes from the URL (D-33).
// The fragment's #test=determinism opens the determinism page instead,
// from a chunk of its own and with no canvas (§16; design §7.5), and
// #test=net, from M3, the network test page, likewise (M3's design §1.28,
// §7); M4's frames page hangs off the same parse. Without one, nothing here
// changes.

import type { NetHook } from './nettest-params';
import { qualityFrom } from './render/quality';
import { createPitchView, type RenderInfo } from './render/scene';

/** What public/boot.js offers the module (D-30). */
export interface Boot {
  /** The app has started: cancels the load timeout and takes the message down. */
  started(): void;
  /** No WebGL 2 at load: its message shows, and stays. */
  noWebGL2(): void;
}

/** What the end-to-end tests read, through window.terriestTest. */
export interface Inspection {
  render: RenderInfo;
}

/** Set by an end-to-end test before the page loads, and never by a normal
 *  page, whose behaviour it never changes: the page only adds inspect()
 *  to it once it has started, and the #test=net page net, once its match
 *  is open (M3-Q7). M4 extends it (§16, D-27). */
export interface TerriestTest {
  inspect?: () => Inspection;
  net?: NetHook;
}

declare global {
  interface Window {
    terriestBoot?: Boot;
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
  const canvas = document.createElement('canvas');
  const view = createPitchView(canvas, qualityFrom(location.search));
  if (!view) {
    boot.noWebGL2();
    return;
  }
  // The pitch is an image in the page's main landmark, as roslambo's arena
  // is. index.html hides the landmark until boot.js takes its own down, so
  // the page never shows two.
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The pitch');
  const main = document.createElement('main');
  main.id = 'pitch';
  main.append(canvas);
  document.body.append(main);
  await view.start();
  const test = window.terriestTest;
  if (test) test.inspect = () => ({ render: view.info() });
  boot.started();
}

const boot = window.terriestBoot;
if (boot) void start(boot);
