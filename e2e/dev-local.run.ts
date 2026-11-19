// The provisional settle of the owner's desktop connection (M3's design,
// research/m3/DESIGN.md, §15 and M3-Q4; PLAN §17's rule for attended
// steps), off the gate, logged owner-pending in docs/acceptance.md until the
// owner's own run:
//
//   GALLIUM_DRIVER=d3d12 npx playwright test -c playwright.dev-local.config.ts
//
// The owner's check: two desktop browsers open the #test=net page through
// npm run dev:local, one the keeper and one a player, at 1 a side with
// script=brain, and the status shows them connected, ticking and in
// agreement through a match. Here the config starts npm run dev:local, and
// the run opens the page in headless Chromium, the keeper in pack A, and
// Firefox, the player in pack B, each launched as e2e/lib/browsers.ts
// launches them, on C-6's GPU path while GALLIUM_DRIVER is set. ice=none, so
// nothing public is contacted, and no relay is given, so the page takes
// dev:local's, as the owner's pages do. The guard allows the dev server's
// http:// base, its ws:// origin for Vite's HMR client, and the relay
// (M3-Q4). First a page in Chromium is opened and closed in a room of its
// own, so the dev server has transformed the page's modules, and Vite has
// optimised any dependency it found late, which reloads the page that found
// it, before the two pages load. Then, every few seconds through a 1-minute
// match to its confirmed end: both pages connected to each other, both
// ticking on, one hash at their common final tick, and no disagreement or
// resync on either; and the same confirmed end on both.

import { ENDED } from '../src/core/sim/state';
import type { NetReport } from '../src/nettest-params';
import { freshRoom, hashAt, launch, type NetPage, openNetPage, report, waitFor } from './lib/browsers';
import { expect, expectEverywhere, test } from './lib/guards';

const SEED = 7; // not a setting: the end-to-end setups' seed
/** The tick at which both press Ready, once in the roster: 10 s, by which the dev server's pages have
 *  loaded and joined. */
const READY_TICK = 600; // not a setting
const CHECK_EVERY_MS = 3000; // not a setting: how often the pair is checked
/** The player's page joining the keeper's through the relay, WebRTC on one machine with no ICE server. */
const CONNECT_MS = 60_000; // not a setting
/** Ready at 10 s, the countdown, a minute of play, its celebrations, and overtime's golden goal. */
const MATCH_MS = 8 * 60_000; // not a setting

type Engine = 'chromium' | 'firefox';

/** Why the pair isn't connected, ticking and in agreement at this check, or null. last: the reports
 *  of the check before. */
async function problem(pages: readonly NetPage[], rs: readonly NetReport[], last: readonly NetReport[] | null): Promise<string | null> {
  for (const [k, r] of rs.entries()) {
    const who = `${pages[k]!.engine} (${r.role})`;
    if (r.failed || r.refused !== null || r.spectatorsFull) return `${who}: failed ${r.failed}, refused ${r.refused}, spectators full ${r.spectatorsFull}`;
    if (!r.started) continue;
    if (r.peers !== 1) return `${who}: connected to ${r.peers} peers, not the other page`;
    if (r.stats.disagree > 0 || r.stats.resyncs > 0) return `${who}: ${r.stats.disagree} disagreements and ${r.stats.resyncs} resyncs`;
    const before = last?.[k];
    if (before?.started && r.phase !== ENDED && (r.localTick <= before.localTick || r.finalTick <= before.finalTick)) {
      return `${who}: not ticking, at local ${r.localTick} and final ${r.finalTick} after ${before.localTick} and ${before.finalTick}`;
    }
  }
  if (!rs.every((r) => r.started)) return null;
  const tick = Math.min(...rs.map((r) => r.finalTick));
  const hashes = await Promise.all(pages.map((p) => hashAt(p.page, tick)));
  return hashes.every((h) => h !== '' && h === hashes[0]) ? null : `hashes at tick ${tick}: ${hashes.join(', ')}`;
}

test('two desktop engines connect, tick and agree through a match over npm run dev:local (design §15)', async ({ baseURL }) => {
  test.setTimeout(CONNECT_MS + MATCH_MS + 3 * 60_000);
  const port = process.env.TERRIEST_DEV_RELAY_PORT;
  if (port === undefined) throw new Error('no TERRIEST_DEV_RELAY_PORT: run this with -c playwright.dev-local.config.ts, which reads it from npm run dev:local');
  const base = baseURL!;
  const relay = `ws://127.0.0.1:${port}`;
  const hmr = base.replace(/^http:/, 'ws:');
  const engines: readonly Engine[] = ['chromium', 'firefox'];
  const browsers = await Promise.all(engines.map((e) => launch(e)));
  try {
    // The dev server warmed up by a page that's then closed, in a room of its own.
    const warm = await openNetPage(browsers[0]!, 'chromium', base, null, { room: freshRoom(), ice: 'none', seed: SEED, k: 2, role: 'keeper', pack: 0, packSize: 1, minutes: 1 }, [relay, hmr]);
    await warm.page.context().close();

    const common = { room: freshRoom(), ice: 'none', seed: SEED, packSize: 1, minutes: 1, script: 'brain', ready: READY_TICK };
    const pages = [
      await openNetPage(browsers[0]!, 'chromium', base, null, { ...common, k: 0, role: 'keeper', pack: 0 }, [relay, hmr]),
      await openNetPage(browsers[1]!, 'firefox', base, null, { ...common, k: 1, role: 'player', pack: 1 }, [relay, hmr]),
    ];
    // Connected first: the keeper's page holds the match before the player's has opened.
    const failed = (rs: readonly NetReport[]): string | null => rs.map((r) => (r.failed || r.refused !== null ? `${r.role}: failed ${r.failed}, refused ${r.refused}` : null)).find((x) => x !== null) ?? null;
    await waitFor(pages, (rs) => rs.every((r) => r.started && r.peers === 1), { timeoutMs: CONNECT_MS, fail: failed });
    const deadline = Date.now() + MATCH_MS;
    let last: NetReport[] | null = null;
    let checks = 0;
    for (;;) {
      const rs = await Promise.all(pages.map((p) => report(p.page)));
      const why = await problem(pages, rs, last);
      expect(why, `check ${checks + 1}`).toBeNull();
      checks++;
      if (rs.every((r) => r.end !== null)) break;
      if (Date.now() > deadline) throw new Error(`no confirmed end within ${MATCH_MS} ms: ${rs.map((r) => `${r.role} phase ${r.phase}, score ${r.score.join('-')}, clock ${r.clock}`).join('; ')}`);
      last = rs;
      await new Promise((done) => setTimeout(done, CHECK_EVERY_MS));
    }
    const ends = await Promise.all(pages.map((p) => report(p.page)));
    const [a, b] = ends.map((r) => r.end!);
    console.log(`${checks} checks: both connected, ticking and in agreement; the end at tick ${a!.tick}, ${a!.score.join('–')}, on both`);
    expect([b!.tick, b!.score]).toEqual([a!.tick, a!.score]);
    for (const p of pages) expectEverywhere(p.watch);
  } finally {
    for (const b of browsers) await b.close();
  }
});
