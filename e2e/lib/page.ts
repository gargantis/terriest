// What the specs that load the page share (PLAN §16, D-30; M4's design,
// research/m4/DESIGN.md, §1.62, §9.1): the test hook, set before load
// (window.terriestTest, which never changes what a normal page does but by
// the fields the plan allows); the storage a player would have, seeded once
// per context and only where absent (M4-Q4); the gate's small viewport;
// waiting for the app to start, and for a screen; Practice opened through
// the real screens; a key held and let go by the hook's state, polled every
// 50 ms, never on animation frames (C-6); the leave prompt accepted; a boot
// failure's message, checked with axe; the page captured at a steady
// drawing buffer, with the inspection read just before; how names lay out
// in a copy of one of the page's own rows, and how each row marks a bot,
// seen and heard; and the built page
// answered from dist/ by request interception, at an address no server here
// answers: an insecure host, or a subpath of the preview's origin (§16).
// Every wait's
// deadline goes by the monotonic clock: the machine's, Date.now(), can step
// a second ahead (phase 1c's measurements), which would end a wait early.

import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, posix } from 'node:path';
import type { Page } from '@playwright/test';
import type { TouchInspection } from '../../src/input/touch';
import type { Inspection, TerriestTest } from '../../src/main';
import { DEFAULT_SETTINGS, type Profile, PROFILE_KEY, SETTINGS_KEY, type StoredSettings } from '../../src/storage/schema';
import type { HudInspection, OverlayInspection, ScreenName } from '../../src/ui/inspect';
import type { HintsInspection } from '../../src/ui/layers/devices';
import type { TurnInspection } from '../../src/ui/phone';
import { expect } from './guards';
import { decodePng, type Image } from './png';
import { DIST, headersFor, parseHeadersFile } from './serve.mjs';

/** The boot failures' codes (D-30): file://, insecure context, no WebGL 2, the load timeout. */
export type BootCode = 'F' | 'S' | 'W' | 'L';

/** The gate's window for every spec that plays (C-6, §9.1): a real window's size, a quarter of
 *  Playwright's 1280 × 720 to fill in software GL. */
export const smallViewport = { width: 640, height: 360 } as const;

/** How often the specs read the hook: never on animation frames (C-6, §9.1). */
export const POLL_MS = 50;

/** The monotonic clock, in ms, which every wait's deadline goes by: Date.now() can step (phase 1c's runs saw
 *  WSL2's step a second ahead every 32 s), and a step would end a wait early. */
export const monotonicMs = (): number => performance.now();

/** The fields a spec may set on the hook before load (CLAUDE.md's test hook): modelUrl (D-27), and from
 *  phase 2 relay and ice (M4-Q3). */
export type HookFields = Pick<TerriestTest, 'modelUrl' | 'relay' | 'ice'>;

/** Sets window.terriestTest before the page's scripts run, with any fields the plan allows; the page adds
 *  inspect() and hashAt() once it has started. */
export async function installHook(page: Page, fields: HookFields = {}): Promise<void> {
  await page.addInitScript((f) => {
    window.terriestTest = { ...f };
  }, fields);
}

/** What a spec seeds: a profile's fields over a fresh one's, and settings over the defaults. */
export interface Seed {
  readonly profile?: Partial<Profile> & Pick<Profile, 'playerId'>;
  readonly settings?: Partial<StoredSettings>;
}

/** A.3's records written before the page's scripts run, each only while its key is absent, so a reload
 *  reads what the page stored and never the seed again, as a player's own stored choices would be
 *  (§1.62, M4-Q4): the gate's low quality, and a fixed player ID, so a setup's bots are the validated
 *  ones (§6). Once per context: localStorage is the origin's. */
export async function seedStorage(page: Page, seed: Seed): Promise<void> {
  const records: [string, string][] = [];
  if (seed.profile) {
    const p: Profile = { v: 1, name: '', coat: 0, hints: { keyboard: 0, touch: 0, gamepad: 0 }, ...seed.profile };
    records.push([PROFILE_KEY, JSON.stringify(p)]);
  }
  if (seed.settings) records.push([SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...seed.settings, v: 1 })]);
  await page.addInitScript((all) => {
    try {
      for (const [key, value] of all) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    } catch {
      // Storage blocked: the page plays from memory, as a player's would (PLAN §10).
    }
  }, records);
}

/** What the page reports through the hook. */
export function inspect(page: Page): Promise<Inspection> {
  return page.evaluate(() => {
    const read = window.terriestTest?.inspect;
    if (!read) throw new Error('no window.terriestTest.inspect(): the hook goes in before load, and the page adds it once started');
    return read();
  });
}

/** The pitch screen's layers as the hook reports them, by name (§1.40): null off the pitch screens. */
export const hudOf = (i: Inspection): HudInspection | null => (i.layers['hud'] as HudInspection | undefined) ?? null;
export const overlayOf = (i: Inspection): OverlayInspection | null => (i.layers['overlay'] as OverlayInspection | undefined) ?? null;
export const menuOf = (i: Inspection): { readonly shown: boolean; readonly buttons: readonly string[] } | null =>
  (i.layers['menu'] as { shown: boolean; buttons: string[] } | undefined) ?? null;
/** The devices' layers (src/ui/layers/devices.ts): the control layer, the control hints and the turn prompt. */
export const touchOf = (i: Inspection): TouchInspection | null => (i.layers['touch'] as TouchInspection | undefined) ?? null;
export const hintsOf = (i: Inspection): HintsInspection | null => (i.layers['hints'] as HintsInspection | undefined) ?? null;
export const turnOf = (i: Inspection): TurnInspection | null => (i.layers['turn'] as TurnInspection | undefined) ?? null;

/** The held timeline's final hash at t, '' if not held (P1, P2). */
export function hashAt(page: Page, t: number): Promise<string> {
  return page.evaluate((tick) => window.terriestTest?.hashAt?.(tick) ?? '', t);
}

/** Polls the hook every 50 ms until `until` holds of it, and returns that inspection; on a timeout, fails
 *  with `what` and the match's figures, never waiting on animation frames (§9.1). */
export async function waitForInspection(page: Page, until: (i: Inspection) => boolean, o: { what: string; timeoutMs?: number }): Promise<Inspection> {
  const deadline = monotonicMs() + (o.timeoutMs ?? 30_000);
  let last = await inspect(page);
  while (!until(last)) {
    if (monotonicMs() > deadline) {
      const m = last.match;
      const at = m === null ? 'no match' : `tick ${m.localTick}, phase ${m.phase}, score ${m.score.join('–')}, clock ${m.clock}, timer ${JSON.stringify(m.timer)}`;
      throw new Error(`${o.what}: not reached within ${o.timeoutMs ?? 30_000} ms (screen ${last.screen}, ${at})`);
    }
    await page.waitForTimeout(POLL_MS);
    last = await inspect(page);
  }
  return last;
}

/** Waits for the hook to report a screen. */
export function waitForScreen(page: Page, name: ScreenName, timeoutMs = 30_000): Promise<Inspection> {
  return waitForInspection(page, (i) => i.screen === name, { what: `the ${name} screen`, timeoutMs });
}

/** Waits for the app to start: boot.js's message gone, the first screen shown. Software GL compiles slowly,
 *  but the compile comes after the start now (M4-Q38). */
export async function expectStarted(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-boot', 'started', { timeout: 30_000 });
  await expect(page.locator('#fallback')).toHaveCount(0);
}

/**
 * From Home through Practice's setup to its Pre-match, by keys on the real screens: Practice focused and
 * Enter pressed, the pack size and the length chosen, Start focused and Enter pressed, the browser's own
 * activation on those screens (§4.9). Returns Pre-match's first inspection.
 */
export async function openPractice(page: Page, o: { packSize: number; minutes: number }): Promise<Inspection> {
  await waitForScreen(page, 'home');
  const practice = page.locator('[data-test="practice"]');
  await practice.focus();
  await page.keyboard.press('Enter');
  await waitForScreen(page, 'practice');
  await page.locator('[data-test="pack-size"]').selectOption(String(o.packSize));
  await page.locator('[data-test="match-length"]').selectOption(String(o.minutes));
  await page.locator('[data-test="start"]').focus();
  await page.keyboard.press('Enter');
  return waitForScreen(page, 'prematch');
}

/** The page captured, and the inspection read just before, at a steady drawing buffer: after a frame drawn at
 *  the size first read, and again if the size changed across the capture, since WebKit's capture just after a
 *  reallocation, by a resize or the governor's step (§8.2), reads the canvas black (phase 2b's Wire step, at 4
 *  a side: 14 of 30 captures at once after a resize read black, none of 30 taken this way). With `still`, again
 *  too until it holds of the inspections read before and after the capture, so the capture shows what the
 *  inspection reports: a spec's terrier and camera at rest (C-57). */
export async function steadyCapture(
  page: Page, still: (before: Inspection, after: Inspection) => boolean = () => true,
): Promise<{ readonly image: Image; readonly shown: Inspection }> {
  const size = (i: Inspection): string => `${i.render.width}×${i.render.height}`;
  for (let k = 1; ; k++) {
    const before = await inspect(page);
    const shown = await waitForInspection(page, (i) => i.render.frames > before.render.frames, { what: 'a frame drawn before the capture' });
    const png = await page.screenshot();
    const after = await inspect(page);
    const steady = size(before) === size(shown) && size(shown) === size(after);
    if (steady && still(before, after)) return { image: decodePng(png), shown };
    if (k === 5) {
      const why = steady ? 'what it shows moved across the last' : `the drawing buffer changed size across the last, ${size(before)}, ${size(shown)}, ${size(after)}`;
      throw new Error(`no steady capture in ${k}: ${why}`);
    }
  }
}

/** How one name laid out in a copy of a page's row (namesInRow). */
export interface NameFit {
  readonly name: string;
  /** The line boxes its text took: 1 when it keeps to one line. */
  readonly lines: number;
  /** Its text ran past its own box, cut off or ended with an ellipsis. */
  readonly clipped: boolean;
  /** The copy's box, and each of its `within` elements', inside the `inside` element's content box, left to
   *  right. */
  readonly inside: boolean;
}

/** How each of `names` lays out in one of the page's own rows (the bots' names, the owner, 2026-11-22): in a
 *  copy of the first element `row` matches, set beside it, its `name` element's text the name, measured,
 *  and taken out again, so the page's own rows are never touched while the copy takes their styles, fonts
 *  and widths. `inside`: the row's nearest container that matches it, whose content box the copy, and
 *  its `within` elements, must keep inside; none for a row that scrolls. */
export function namesInRow(
  page: Page, o: { readonly row: string; readonly name: string; readonly inside?: string; readonly within?: string }, names: readonly string[],
): Promise<NameFit[]> {
  return page.evaluate(({ o, names }) => {
    const row = document.querySelector(o.row);
    const box = o.inside === undefined ? null : (row?.closest(o.inside) ?? null);
    if (row === null || (o.inside !== undefined && box === null)) throw new Error(row === null ? `no ${o.row}` : `no ${o.inside} round ${o.row}`);
    let edge: { left: number; right: number } | null = null;
    if (box !== null) {
      const r = box.getBoundingClientRect();
      const css = getComputedStyle(box);
      const side = (k: 'Left' | 'Right'): number => (parseFloat(css[`padding${k}`]) || 0) + (parseFloat(css[`border${k}Width`]) || 0);
      edge = { left: r.left + side('Left'), right: r.right - side('Right') };
    }
    const inBox = (r: DOMRect): boolean => edge === null || (r.left >= edge.left - 0.5 && r.right <= edge.right + 0.5);
    return names.map((name) => {
      const copy = row.cloneNode(true) as HTMLElement;
      copy.setAttribute('aria-hidden', 'true');
      row.after(copy);
      try {
        const el = copy.querySelector<HTMLElement>(o.name);
        if (el === null) throw new Error(`no ${o.name} in ${o.row}`);
        el.textContent = name;
        const text = document.createRange();
        text.selectNodeContents(el);
        const lines = new Set(Array.from(text.getClientRects(), (r) => Math.round(r.top))).size;
        const within = o.within === undefined ? [] : Array.from(copy.querySelectorAll(o.within), (x) => x.getBoundingClientRect());
        // A pixel's slack: the two widths round a fractional box apart.
        return { name, lines, clipped: el.scrollWidth > el.clientWidth + 1, inside: inBox(copy.getBoundingClientRect()) && within.every(inBox) };
      } finally {
        copy.remove();
      }
    });
  }, { o, names });
}

/** How a row names its terrier, as a player sees and hears it (the owner, 2026-11-23): the name it shows;
 *  whether its swatch is a bot's head, an SVG drawn in the swatch's own 18 × 18 box and filling it, the
 *  swatch painting no ring or colour of its own, which would cover the gap round the head's fill; and what
 *  a screen reader hears, by Playwright's ARIA snapshot of the row: 'as a bot', the word "bot" once in the
 *  row, right after the name; 'by name', no "bot" in it; or else "as" and the snapshot itself, quoted, its
 *  word doubled or out of place. */
export interface RowMark {
  readonly name: string;
  readonly head: boolean;
  readonly heard: string;
}

/** Each row `row` matches, in order, its name read from its `name` element (rowMarks). */
export async function rowMarks(page: Page, row: string, name: string): Promise<RowMark[]> {
  const rows = page.locator(row);
  const out: RowMark[] = [];
  for (let k = 0, n = await rows.count(); k < n; k++) {
    const r = rows.nth(k);
    const shown = (await r.locator(name).textContent()) ?? '';
    const head = await r.evaluate((el) => {
      const swatch = el.querySelector('.swatch');
      const svg = swatch?.querySelector(':scope > svg') ?? null;
      if (swatch === null || svg === null || !swatch.classList.contains('bot')) return false;
      const a = swatch.getBoundingClientRect();
      const b = svg.getBoundingClientRect();
      const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.5;
      const own = getComputedStyle(swatch);
      const paintsNothing = own.backgroundImage === 'none' && own.backgroundColor === 'rgba(0, 0, 0, 0)' &&
        ['top', 'right', 'bottom', 'left'].every((side) => own.getPropertyValue(`border-${side}-width`) === '0px');
      return near(a.width, 18) && near(a.height, 18) && near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height) &&
        getComputedStyle(svg).visibility === 'visible' && paintsNothing;
    });
    const snapshot = (await r.ariaSnapshot()).replace(/\s+/g, ' ');
    const bots = snapshot.match(/\bbot\b/g)?.length ?? 0;
    const heard = bots === 0 ? 'by name' : bots === 1 && snapshot.includes(`${shown} bot`) ? 'as a bot' : `as ${JSON.stringify(snapshot)}`;
    out.push({ name: shown, head, heard });
  }
  return out;
}

/** A row's mark in words, for a spec's comparison: "Sensor: a head, heard as a bot", "Ada: no head, heard by name". */
export const markText = (m: RowMark): string => `${m.name}: ${m.head ? 'a head' : 'no head'}, heard ${m.heard}`;

/** The mark a bot's row, or a person's, should have, in markText's words. */
export const markOf = (name: string, bot: boolean): string => markText({ name, head: bot, heard: bot ? 'as a bot' : 'by name' });

/** Every dialog accepted, the leave prompt among them (§5.11): a spec that reloads or leaves a match. */
export function acceptLeavePrompt(page: Page): void {
  page.on('dialog', (d) => void d.accept());
}

/** A key held down, by its code (KeyA, Space, ShiftLeft …), until released. */
export interface HeldKey {
  readonly code: string;
  /** The inspection read just after the key went down. */
  readonly at: Inspection;
  release(): Promise<Inspection>;
}

/** Presses `code` down and keeps it held, as a player's finger does: no repeats. */
export async function holdKey(page: Page, code: string): Promise<HeldKey> {
  await page.keyboard.down(code);
  const at = await inspect(page);
  let released = false;
  return {
    code,
    at,
    release: async () => {
      if (!released) {
        released = true;
        await page.keyboard.up(code);
      }
      return inspect(page);
    },
  };
}

/** Lets go of a held key at the first poll whose inspection satisfies `until`, polled every 50 ms;
 *  returns the inspection that released it. */
export async function releaseWhen(page: Page, held: HeldKey, until: (i: Inspection) => boolean, o: { what: string; timeoutMs?: number }): Promise<Inspection> {
  try {
    return await waitForInspection(page, until, o);
  } finally {
    await held.release();
  }
}

/**
 * A boot failure's message (D-30): its code, its heading in the main
 * landmark, focused, the app's canvas never made, so nothing else ran, and
 * no violation by axe.
 */
export async function expectBootMessage(page: Page, code: BootCode, title: RegExp): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-boot', code);
  const heading = page.getByRole('main').getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(title);
  await expect(heading).toBeFocused();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expectAxeClean(page);
}

/** No violation by axe, with its default rules. */
export async function expectAxeClean(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`), 'axe').toEqual([]);
}

/** The built page's module script, as dist/index.html names it. */
export async function moduleScript(): Promise<string> {
  const html = await readFile(join(DIST, 'index.html'), 'utf8');
  const src = /<script type="module"[^>]*\ssrc="([^"]+)"/.exec(html)?.[1];
  if (!src) throw new Error('dist/index.html names no module script');
  return src;
}

/** The page's module and every chunk it imports statically, transitively, each as dist/ names it
 *  ('./assets/…'): the scripts a normal page loads, which its dynamic imports never add to (§9.3). */
export async function moduleScripts(): Promise<string[]> {
  const first = posix.normalize(await moduleScript());
  const seen = new Set<string>([first]);
  const queue = [first];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const text = readFileSync(join(DIST, path), 'utf8');
    // A bundle's static imports and re-exports, `import … from "./x.js"` and `export … from "./x.js"`;
    // an import("./x.js") is dynamic, and left out.
    for (const m of text.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[\w*{}\s,$]+\s*from\s*)?["']([^"']+\.js)["']/g)) {
      const next = posix.normalize(posix.join(posix.dirname(path), m[1]!));
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen].map((p) => (p.startsWith('.') ? p : `./${p}`));
}

/** e2e/lib/serve.mjs's content types, so the interception serves each file as the strict server does: a
 *  stylesheet as text/css, never application/octet-stream under nosniff (§1.62). Keep the two in step. */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
};

/**
 * Answers every request under `base`, which ends in '/', from dist/, as a
 * static host serving the site there would: `base` itself is index.html, a
 * missing file is an empty 404, and dist/_headers applies, read from the
 * mount point.
 */
export async function mountDist(page: Page, base: string): Promise<void> {
  const rules = parseHeadersFile(await readFile(join(DIST, '_headers'), 'utf8'));
  const mount = new URL(base).pathname;
  await page.route(
    (url) => url.href.startsWith(base),
    async (route) => {
      const path = `/${decodeURIComponent(new URL(route.request().url()).pathname.slice(mount.length))}`;
      const file = normalize(path === '/' ? 'index.html' : path.slice(1));
      const body = file.startsWith('..') || file === '_headers' ? null : await readFile(join(DIST, file)).catch(() => null);
      if (!body) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      const headers = Object.fromEntries(headersFor(rules, path));
      await route.fulfill({ status: 200, body, headers: { ...headers, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } });
    },
  );
}
