// A browser of every engine for the *.net.spec.ts files (M3's design §1.34,
// §8.4, §8.5; PLAN §16), which launch their own and so run once, in the
// `net` project (playwright.config.ts). roslambo's e2e/lib/browsers.ts, with
// the design's changes:
// - WebRTC between pages on one machine: Chromium without mDNS host
//   candidates, Firefox with host addresses and loopback, and Trystero's
//   ice=local rewrite of the rest to loopback (src/net/room-config.ts).
//   Chromium also takes the gate's GL flags while GALLIUM_DRIVER is set, as
//   every Chromium the gate launches does (e2e/lib/gl.ts, C-6);
// - each page in a context of its own, WebGL 2 asserted first, so a run
//   without a display fails at once (C-6); the hook installed before load
//   (installHook), which never changes what a normal page does; and the
//   page watched, with only its base URL, its relay and the prefixes a spec
//   adds allowed, for the spec's expectEverywhere (CLAUDE.md's "Everywhere");
// - the report's shape from src/nettest-params.ts, the page's own;
// - waitFor, which polls the pages' reports for logical state rather than
//   sleeping, and fails at once when the spec's fail() names a reason, such
//   as an overtime (§8.4);
// - freshRoom from src/core/match-id.ts, and a count of the page's
//   RTCPeerConnections for Practice's spec (P10);
// - from M4, openAppPage: a normal page of the built app, its screens and
//   not a #test= page, in a browser a test launched (M4's design §5.12,
//   §9.1, §9.4, M4-Q3, M4-Q4): its storage seeded as a player's would be,
//   the hook's relay the local one and its ICE local, the gate's 640 × 360
//   unless given, the gamepad's stub if asked, watched as openNetPage's
//   pages are, and loaded until boot.js says it started. New at M4, by
//   phase 2d's match builder.

import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { config } from '../../src/config';
import { personId } from '../../src/core/bot/bot-id';
import { generateMatchId } from '../../src/core/match-id';
import type { NetReport } from '../../src/nettest-params';
import { installGamepad } from './gamepad';
import { CHROMIUM_GL_ARGS } from './gl';
import { expectWebGL2, type PageWatch, watchPage } from './guards';
import { installHook, monotonicMs, POLL_MS as LOOK_MS, seedStorage, smallViewport } from './page';

export type Engine = 'chromium' | 'firefox' | 'webkit';

/** How long the net page takes to start and add its hook: no WebGL to compile, but three engines at once. */
const OPEN_TIMEOUT_MS = 30_000;
/** Between two looks at the pages' reports. */
const POLL_MS = 250;
/** The specs' seed: an app page's profile holds personId(SPEC_SEED, k), so it plays the setup the Node
 *  replays validated (M4's design §9.1, src/net/setups-testing.ts' SCREENS_SEED). */
export const SPEC_SEED = 7; // not a setting: the specs' seed
/** From the load to boot.js's verdict: its own load timeout, L, shows at 20 s (D-30), so a page that never
 *  starts says so inside this, as e2e/lib/page.ts' expectStarted waits. */
const START_TIMEOUT_MS = 30_000;

/** WebRTC between pages on one machine: Chromium without mDNS host candidates, Firefox with host
 *  addresses and loopback; Chromium also takes CHROMIUM_GL_ARGS (e2e/lib/gl.ts). */
export function launch(engine: Engine): Promise<Browser> {
  if (engine === 'chromium') return chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', ...CHROMIUM_GL_ARGS] });
  if (engine === 'firefox') {
    return firefox.launch({
      firefoxUserPrefs: { 'media.peerconnection.ice.obfuscate_host_addresses': false, 'media.peerconnection.ice.loopback': true },
    });
  }
  return webkit.launch();
}

export interface NetPage {
  readonly page: Page;
  readonly watch: PageWatch;
  readonly engine: Engine;
}

/** A context and page: WebGL 2 asserted first, the hook installed, the page watched with only the
 *  base URL and the relay allowed (and extra prefixes, such as a dev server's ws:// origin), #test=net&…
 *  opened, with the relay among its parameters when there is one, and window.terriestTest.net awaited. */
export async function openNetPage(
  b: Browser, engine: Engine, base: string, relay: string | null, params: Readonly<Record<string, string | number>>,
  allowed: readonly string[] = [],
): Promise<NetPage> {
  const context = await b.newContext();
  const page = await context.newPage();
  const watch = await watchPage(page, [base, ...(relay === null ? [] : [relay]), ...allowed]);
  await expectWebGL2(page);
  await installHook(page);
  const query = new URLSearchParams([['test', 'net']]);
  if (relay !== null) query.set('relay', relay);
  for (const [k, v] of Object.entries(params)) query.set(k, String(v));
  await page.goto(`${base}#${query.toString()}`);
  await page.waitForFunction(() => window.terriestTest?.net !== undefined, null, { timeout: OPEN_TIMEOUT_MS });
  return { page, watch, engine };
}

/** A normal page of the built app that openAppPage opened, with what watchPage records of it for the spec's
 *  expectEverywhere (CLAUDE.md's "Everywhere"). */
export interface AppPage {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly engine: Engine;
  readonly watch: PageWatch;
}

export interface AppPageOptions {
  /** The profile's player ID is personId(SPEC_SEED, k). */
  readonly k: number;
  /** The profile's display name; none by default, as a first visit has. */
  readonly name?: string;
  /** The profile's coat; k's own by default, k mod the coat count, as the #test=net page's and the Node
   *  replays' pages take (src/nettest-params.ts, src/net/setups-testing.ts). */
  readonly coat?: number;
  /** The local relay, a ws: URL on the loopback: the hook's relay, and every room's only one (M4-Q3). */
  readonly relay: string;
  /** '#join=…' or none: loaded at base + fragment. */
  readonly fragment?: string;
  /** The gate's 640 × 360 by default (§9.1). */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** e2e/lib/gamepad.ts' stub, before load. */
  readonly gamepad?: boolean;
  /** The spec's own init scripts or routes, after the others and before the load. */
  readonly beforeLoad?: (page: Page) => Promise<void>;
}

/** A normal page of the built app (never a #test= page) in a browser a test launched: storage seeded (personId(7, k),
 *  the name, low quality), the hook installed with the local relay and ice 'local' (§5.12, M4-Q3), a 640 × 360 viewport
 *  unless given, e2e/lib/gamepad.ts's stub if asked, watched by watchPage with the base URL and the relay allowed,
 *  loaded at base + fragment and started (data-boot=started). WebGL 2 is asserted first, in a page of the new context,
 *  so a run without a display fails at once (C-6). The storage is seeded each key only while it's absent, so a reload
 *  reads what the page stored (M4-Q4). A page whose boot.js shows a failure's code instead fails here, naming it. */
export async function openAppPage(browser: Browser, base: string, o: AppPageOptions): Promise<AppPage> {
  const engine = browser.browserType().name() as Engine;
  const context = await browser.newContext({ viewport: o.viewport ?? smallViewport });
  const page = await context.newPage();
  const watch = await watchPage(page, [base, o.relay]);
  await expectWebGL2(page);
  await seedStorage(page, {
    profile: { playerId: personId(SPEC_SEED, o.k), name: o.name ?? '', coat: o.coat ?? o.k % config.coatCount },
    settings: { quality: 'low' },
  });
  await installHook(page, { relay: o.relay, ice: 'local' });
  if (o.gamepad === true) await installGamepad(page);
  await o.beforeLoad?.(page);
  await page.goto(`${base}${o.fragment ?? ''}`);
  await waitForStart(page);
  return { page, context, engine, watch };
}

/** html[data-boot] as boot.js leaves it: absent before it runs, 'loading', then 'started' or a failure's code. */
const bootOf = (page: Page): Promise<string | null> => page.evaluate(() => document.documentElement.getAttribute('data-boot'));

/** Looks at html[data-boot] every 50 ms, on the monotonic clock, until boot.js has a verdict: started, or a
 *  failure's code (D-30), which fails at once, by its code. */
export async function waitForStart(page: Page, timeoutMs = START_TIMEOUT_MS): Promise<void> {
  const deadline = monotonicMs() + timeoutMs;
  for (let boot = await bootOf(page); ; boot = await bootOf(page)) {
    if (boot === 'started') return;
    if (boot !== null && boot !== 'loading') throw new Error(`the page didn't start: boot.js shows its failure ${boot} (D-30)`);
    if (monotonicMs() > deadline) throw new Error(`the page didn't start within ${timeoutMs} ms: data-boot is ${boot ?? 'absent'}`);
    await page.waitForTimeout(LOOK_MS);
  }
}

export function report(p: Page): Promise<NetReport> {
  return p.evaluate(() => {
    const net = window.terriestTest?.net;
    if (net === undefined) throw new Error('no window.terriestTest.net: the hook goes in before load, and the page adds net once started');
    return net.report();
  });
}

export function hashAt(p: Page, t: number): Promise<string> {
  return p.evaluate((tick) => {
    const net = window.terriestTest?.net;
    if (net === undefined) throw new Error('no window.terriestTest.net');
    return net.hashAt(tick);
  }, t);
}

/** Each page's phase, score and clock, and what else says why it's where it is. */
function described(pages: readonly NetPage[], reports: readonly NetReport[]): string {
  return reports
    .map((r, k) => {
      const where = `${pages[k]?.engine ?? '?'} ${r.me.slice(-4)} (${r.role}): phase ${r.phase}${r.overtime ? ' overtime' : ''}, score ${r.score.join('-')}, clock ${r.clock}`;
      const more = `final ${r.finalTick}, peers ${r.peers}, stall ${r.stall}, refused ${r.refused ?? '-'} by ${r.refusedBy ?? '-'}`;
      const dups = r.duplicates.length > 0 ? `, duplicates ${JSON.stringify(r.duplicates)}` : '';
      return `  ${where}; ${more}${dups}`;
    })
    .join('\n');
}

/** Polls report() until test(r) holds, failing at once when fail(r) names a reason, and on timeout with each page's phase, score and clock. */
export async function waitFor(
  pages: readonly NetPage[],
  test: (r: readonly NetReport[]) => boolean,
  o: { timeoutMs: number; fail?: (r: readonly NetReport[]) => string | null },
): Promise<NetReport[]> {
  const deadline = monotonicMs() + o.timeoutMs;
  for (;;) {
    const reports = await Promise.all(pages.map((p) => report(p.page)));
    const why = o.fail?.(reports) ?? null;
    if (why !== null) throw new Error(`${why}\n${described(pages, reports)}`);
    if (test(reports)) return reports;
    if (monotonicMs() >= deadline) throw new Error(`not reached within ${o.timeoutMs} ms\n${described(pages, reports)}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** A fresh match ID for a room nobody else is in. */
export function freshRoom(): string {
  return generateMatchId();
}

/** An init script that counts RTCPeerConnection constructions as window.__rtcCount. */
export async function countPeerConnections(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    const w = window as unknown as { RTCPeerConnection?: typeof RTCPeerConnection; __rtcCount: number };
    w.__rtcCount = 0;
    const Native = w.RTCPeerConnection;
    if (Native === undefined) return;
    w.RTCPeerConnection = class extends Native {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        w.__rtcCount++;
      }
    };
  });
}
