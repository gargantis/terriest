// What every end-to-end spec checks (PLAN §16): WebGL 2 in the engine before
// anything else (C-6), and "Everywhere": no console error, and no request
// outside the servers the spec loads from. The gate contacts no public host
// (§16), so a request to any other host fails, third-party.json's relays
// and STUN hosts included: Practice contacts none (§20), and the relay
// check is outside the gate. third-party.json drives the runtime and the
// dist audit instead.

import { test as base, expect, type Page } from '@playwright/test';

export { expect };

/** Fails at once if the engine draws no WebGL 2: Firefox has it only with a display (C-6). */
export async function expectWebGL2(page: Page): Promise<void> {
  const webgl2 = await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
  expect(webgl2, 'WebGL 2 in this engine; Firefox needs DISPLAY or WAYLAND_DISPLAY (C-6)').toBe(true);
}

export interface PageWatch {
  errors: string[];
  requests: string[];
  /** URL prefixes the page may request: a server's base URL, the local relay's ws:// URL. */
  allowed: string[];
}

/** Records console errors, page errors and every request, WebSockets included. */
export async function watchPage(page: Page, allowed: string[] = []): Promise<PageWatch> {
  const w: PageWatch = { errors: [], requests: [], allowed };
  page.on('console', (m) => {
    if (m.type() === 'error') w.errors.push(m.text());
  });
  page.on('pageerror', (e) => w.errors.push(String(e)));
  page.on('request', (r) => w.requests.push(r.url()));
  // A WebSocket raises no 'request', and a relay is one.
  page.on('websocket', (ws) => w.requests.push(ws.url()));
  // Each engine reports a refusal by the content security policy in its own
  // way, so every refusal is logged as an error too (D-35).
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`refused by ${e.effectiveDirective}: ${e.blockedURI}`);
    });
  });
  return w;
}

/**
 * The requests under none of the allowed prefixes, matched as prefixes, so
 * a page served from a subpath can't leave it (L232). A data: URL is no
 * request; a blob: URL is checked by the URL it was made under.
 */
export function outsideRequests(w: PageWatch): string[] {
  return w.requests.filter((u) => {
    if (u.startsWith('data:')) return false;
    const url = u.startsWith('blob:') ? u.slice('blob:'.length) : u;
    return !w.allowed.some((prefix) => url.startsWith(prefix));
  });
}

/** Fails unless the page logged no error and requested nothing outside. */
export function expectEverywhere(w: PageWatch): void {
  expect(w.errors, 'console errors (PLAN §16, Everywhere)').toEqual([]);
  expect(outsideRequests(w), `requests outside ${w.allowed.join(', ')} (PLAN §16, Everywhere)`).toEqual([]);
}

/**
 * Playwright's test, with "Everywhere" checked as each test ends rather
 * than where it last reads the page, so an error the page raises after
 * that still fails it. `guard` watches the test's page from before its
 * first load, allowing the configured base URL; a test that serves the page
 * from elsewhere sets `guard.allowed`. A spec that launches its own
 * browsers (a *.net.spec.ts) watches each page and calls expectEverywhere.
 */
export const test = base.extend<{ guard: PageWatch }>({
  guard: [
    async ({ page, baseURL }, use) => {
      const w = await watchPage(page, baseURL ? [baseURL] : []);
      await use(w);
      expectEverywhere(w);
    },
    { auto: true },
  ],
});
