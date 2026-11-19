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
//   RTCPeerConnections for Practice's spec (P10).

import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { generateMatchId } from '../../src/core/match-id';
import type { NetHook, NetReport } from '../../src/nettest-params';
import { CHROMIUM_GL_ARGS } from './gl';
import { expectWebGL2, type PageWatch, watchPage } from './guards';
import { installHook } from './page';

export type Engine = 'chromium' | 'firefox' | 'webkit';

/** How long the net page takes to start and add its hook: no WebGL to compile, but three engines at once. */
const OPEN_TIMEOUT_MS = 30_000;
/** Between two looks at the pages' reports. */
const POLL_MS = 250;

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

/** The page's hook, as the page adds it (src/main.ts, at M3's phase 5). */
type Hooked = { terriestTest?: { net?: NetHook } };

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
  await page.waitForFunction(() => (window as unknown as Hooked).terriestTest?.net !== undefined, null, { timeout: OPEN_TIMEOUT_MS });
  return { page, watch, engine };
}

export function report(p: Page): Promise<NetReport> {
  return p.evaluate(() => {
    const net = (window as unknown as Hooked).terriestTest?.net;
    if (net === undefined) throw new Error('no window.terriestTest.net: the hook goes in before load, and the page adds net once started');
    return net.report();
  });
}

export function hashAt(p: Page, t: number): Promise<string> {
  return p.evaluate((tick) => {
    const net = (window as unknown as Hooked).terriestTest?.net;
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
  const deadline = Date.now() + o.timeoutMs;
  for (;;) {
    const reports = await Promise.all(pages.map((p) => report(p.page)));
    const why = o.fail?.(reports) ?? null;
    if (why !== null) throw new Error(`${why}\n${described(pages, reports)}`);
    if (test(reports)) return reports;
    if (Date.now() >= deadline) throw new Error(`not reached within ${o.timeoutMs} ms\n${described(pages, reports)}`);
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
