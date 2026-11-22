// The #test=net page's edges, in each engine (M3's design §1.35, §6.7,
// §8.4, R-15; PLAN §16):
// - a normal page loads no test page's chunk, nor a chunk they share, nor
//   Trystero's: its scripts are boot.js, its module and the chunks that
//   imports statically, none of them a test page's, the bench's and its
//   witness's worker among them, each of which the build has (M4's design
//   §1.53, §9.3); it has no window.terriestTest without a spec's hook, and
//   with it inspect() and hashAt() but no net; and its module holds no
//   Trystero code;
// - #test=net without a relay, with a malformed room, or with a wss: relay
//   third-party.json doesn't list shows its message and starts, and
//   contacts nothing: the guard allows only the preview's own origin, and
//   the Trystero chunk is never requested;
// - the build hash the page carries is the one Node computes from the
//   configuration and the checkout's build inputs (design §1.31), so the
//   bundle holds the hash of the sources it was built from. Practice gives
//   it here, since it contacts nothing (P10).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { buildInputs } from '../scripts/build-inputs.mjs';
import { config } from '../src/config';
import { buildHash } from '../src/core/session/build';
import { freshRoom, report } from './lib/browsers';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, installHook, moduleScript, moduleScripts } from './lib/page';
import { DIST } from './lib/serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The chunks of dist/assets whose names start with name. */
const chunks = (name: string): string[] => readdirSync(join(DIST, 'assets')).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.js'));
/** Trystero's own handshake marker (@trystero-p2p/core's handshake.mjs): Trystero's code, wherever it's bundled. */
const TRYSTERO_CODE = '__trystero';

test.beforeEach(async ({ page }) => {
  await expectWebGL2(page);
});

/** The page starts its net page: one main landmark, the net page's, with its heading. */
async function expectNetPage(page: Page): Promise<void> {
  await expectStarted(page);
  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main).toHaveAttribute('id', 'net');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Network test');
  await expect(page.locator('canvas')).toHaveCount(0);
}

test('a normal page loads no test page and no Trystero, and has no net hook', async ({ page, guard, baseURL }) => {
  await page.goto('./');
  await expectStarted(page);
  await expect(page.getByRole('main')).toHaveAttribute('id', 'app');
  expect(await page.evaluate(() => window.terriestTest === undefined), 'window.terriestTest without a spec').toBe(true);
  // With a spec's hook, the normal page adds inspect() and hashAt(), and no net (CLAUDE.md's test hook).
  await installHook(page);
  await page.reload();
  await expectStarted(page);
  const hook = await page.evaluate(() => [typeof window.terriestTest?.inspect, typeof window.terriestTest?.hashAt, typeof window.terriestTest?.net]);
  expect(hook).toEqual(['function', 'function', 'undefined']);
  // Its scripts are boot.js, its module and the chunks that imports statically, both times: no test
  // page's chunk, no chunk the two share and no Trystero (R-15, L238).
  const module = await moduleScript();
  const statics = await moduleScripts();
  const own = [new URL('boot.js', baseURL).href, ...statics.map((s) => new URL(s, baseURL).href)].sort();
  const scripts = [...new Set(guard.requests.filter((u) => new URL(u).pathname.endsWith('.js')))].sort();
  expect(scripts, "the normal page's scripts").toEqual(own);
  for (const s of statics) expect(s, "a chunk the normal page imports statically").not.toMatch(/\/(nettest|determinism|trystero|golden|frames|witness|setups)-[\w-]+\.js$/);
  // The build has the chunks the normal page leaves alone, so none of those names is a check of nothing:
  // the test pages' (M4's bench and its witness's worker among them, §1.53), and its module holds no
  // Trystero code, which the Trystero chunk shows the marker finds.
  expect(chunks('nettest'), 'the net page chunk').toHaveLength(1);
  expect(chunks('frames'), "the bench's chunk").toHaveLength(1);
  expect(chunks('witness'), "the bench witness's worker").toHaveLength(1);
  const trystero = chunks('trystero');
  expect(trystero, 'the Trystero chunk').toHaveLength(1);
  expect(readFileSync(join(DIST, 'assets', trystero[0]!), 'utf8')).toContain(TRYSTERO_CODE);
  for (const s of [module, ...statics]) expect(readFileSync(join(DIST, s), 'utf8').includes(TRYSTERO_CODE), `Trystero's code in ${s}`).toBe(false);
});

// Each refusal with the start of parseNetParams' words for it in a production build, which `vite
// preview` serves, in a room nobody uses, with a relay where one is given that nothing answers: port 9,
// and a reserved name that never resolves. (A spec can't import parseNetParams: its relays come from
// third-party.json, which Node imports only with an import attribute.)
const ROOM = freshRoom();
const REFUSED = [
  ['without a relay', `test=net&room=${ROOM}&k=0&role=keeper&pack=0`, 'relay: none given'],
  ['with a malformed room', 'test=net&room=%&relay=ws%3A%2F%2F127.0.0.1%3A9&k=0&role=keeper&pack=0', 'room: not a match ID'],
  [
    "with a wss: relay third-party.json doesn't list",
    `test=net&room=${ROOM}&relay=wss%3A%2F%2Frelay.invalid&k=0&role=keeper&pack=0`,
    "relay: this build takes only third-party.json's relays",
  ],
] as const;
const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [why, fragment, error] of REFUSED) {
  test(`#test=net ${why} says so, starts, and contacts nothing`, async ({ page, guard, baseURL }) => {
    await installHook(page);
    await page.goto(`./#${fragment}`);
    await expectNetPage(page);
    const said = new RegExp(`^The network test didn't start, and contacted nothing: ${escaped(error)}[^]*\\.$`);
    await expect(page.getByRole('main').locator('pre')).toHaveText(said);
    // Nothing more is coming: no request for half a second, the page's chunks loaded.
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => window.terriestTest?.net === undefined), 'the net hook of a page that never opened a match').toBe(true);
    expect(guard.requests.filter((u) => /^wss?:/.test(u)), 'WebSockets').toEqual([]);
    expect(guard.requests.filter((u) => /\/trystero-[\w-]+\.js$/.test(u)), 'the Trystero chunk').toEqual([]);
    expect(guard.requests.filter((u) => /\/nettest-[\w-]+\.js$/.test(u)), 'the net page chunk').toHaveLength(1);
    // And, as the test ends, the guard checks that nothing outside the preview's origin was requested.
    expect(guard.allowed).toEqual([baseURL]);
  });
}

test("the page's build hash is Node's, from the configuration and the checkout's build inputs", async ({ page }) => {
  // Without a spec's hook, a net page whose match is open adds no window.terriestTest (M3-Q7).
  await page.goto('./#test=net&mode=practice&packSize=1&minutes=1');
  await expectNetPage(page);
  await expect(page.getByRole('main').locator('pre')).toContainText('Timeline ');
  expect(await page.evaluate(() => window.terriestTest === undefined), 'window.terriestTest without a spec').toBe(true);
  await installHook(page);
  await page.reload();
  await expectNetPage(page);
  await page.waitForFunction(() => window.terriestTest?.net !== undefined, null, { timeout: 30_000 });
  const r = await report(page);
  expect([r.mode, r.started, r.peers]).toEqual(['practice', true, 0]);
  expect(r.build, 'buildHash(config, buildInputs(the checkout))').toBe(buildHash(config, buildInputs(ROOT)));
});
