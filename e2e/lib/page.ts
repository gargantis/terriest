// What the specs that load the page share (PLAN §16, D-30): the test hook,
// set before load (window.terriestTest, which never changes what a normal
// page does); waiting for the app to start; a boot failure's message,
// checked with axe; and the built page answered from dist/ by request
// interception, at an address no server here answers: an insecure host,
// or a subpath of the preview's origin (§16).

import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { Page } from '@playwright/test';
import type { Inspection } from '../../src/main';
import { expect } from './guards';
import { DIST, headersFor, parseHeadersFile } from './serve.mjs';

/** The boot failures' codes (D-30): file://, insecure context, no WebGL 2, the load timeout. */
export type BootCode = 'F' | 'S' | 'W' | 'L';

/** Sets window.terriestTest before the page's scripts run; the page adds inspect() once it has started. */
export async function installHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.terriestTest = {};
  });
}

/** What the page reports through the hook. */
export function inspect(page: Page): Promise<Inspection> {
  return page.evaluate(() => {
    const read = window.terriestTest?.inspect;
    if (!read) throw new Error('no window.terriestTest.inspect(): the hook goes in before load, and the page adds it once started');
    return read();
  });
}

/** Waits for the app to start: its first frame drawn, and boot.js's message gone. Software GL compiles slowly. */
export async function expectStarted(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-boot', 'started', { timeout: 30_000 });
  await expect(page.locator('#fallback')).toHaveCount(0);
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

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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
