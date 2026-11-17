// What every end-to-end spec checks (PLAN §16): WebGL 2 in the engine before
// anything else (C-6), and "Everywhere": no console error, WebGL's errors
// included in every engine, and no request outside the servers the spec
// loads from. The gate contacts no public host (§16), so a request to any
// other host fails, third-party.json's relays and STUN hosts included:
// Practice contacts none (§20), and the relay check is outside the gate.
// third-party.json drives the runtime and the dist audit instead.

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
  /**
   * The browser's own console errors for something a test breaks on
   * purpose, such as a module script it refuses (§16): each pattern must
   * match an error's whole text.
   */
  allowedErrors: RegExp[];
}

/**
 * Whether a console message counts as an error: any error, and a WebGL
 * error that Chromium and Firefox log as a warning, where WebKit logs it as
 * an error. That's Chromium's "WebGL: INVALID_ENUM: …" and ANGLE's
 * "GL_INVALID_OPERATION: …", and any "WebGL warning: …" from Firefox, whose
 * text doesn't say which are errors. A driver's performance note, such as
 * Chromium's "GPU stall due to ReadPixels", isn't one.
 */
export function isConsoleError(type: string, text: string): boolean {
  if (type === 'error') return true;
  return type === 'warning' && /^WebGL: (?:INVALID_|OUT_OF_MEMORY|CONTEXT_LOST)|\bGL_(?:INVALID_[A-Z_]+|OUT_OF_MEMORY)\b|WebGL warning: /.test(text);
}

/** Records console errors (isConsoleError), page errors and every request, WebSockets included. */
export async function watchPage(page: Page, allowed: string[] = []): Promise<PageWatch> {
  const w: PageWatch = { errors: [], requests: [], allowed, allowedErrors: [] };
  page.on('console', (m) => {
    if (isConsoleError(m.type(), m.text())) w.errors.push(m.text());
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
 * request. A blob: URL names only the origin of the page that made it, not
 * its path, and never reaches the network, so it's allowed when that
 * origin is an allowed prefix's; one with an opaque origin isn't.
 */
export function outsideRequests(w: PageWatch): string[] {
  const originOf = (u: string): string => {
    try {
      return new URL(u).origin;
    } catch {
      return 'null';
    }
  };
  const origins = new Set(w.allowed.map(originOf).filter((o) => o !== 'null'));
  return w.requests.filter((u) => {
    if (u.startsWith('data:')) return false;
    if (u.startsWith('blob:')) return !origins.has(originOf(u));
    return !w.allowed.some((prefix) => u.startsWith(prefix));
  });
}

/** Fails unless the page logged no error but those allowed, and requested nothing outside. */
export function expectEverywhere(w: PageWatch): void {
  const whole = w.allowedErrors.map((re) => new RegExp(`^(?:${re.source})$`, re.flags.replace('g', '')));
  const errors = w.errors.filter((e) => !whole.some((re) => re.test(e)));
  expect(errors, 'console errors (PLAN §16, Everywhere)').toEqual([]);
  expect(outsideRequests(w), `requests outside ${w.allowed.join(', ')} (PLAN §16, Everywhere)`).toEqual([]);
}

/**
 * Playwright's test, with "Everywhere" checked as each test ends rather
 * than where it last reads the page, so an error the page raises after
 * that still fails it. `guard` watches the test's page from before its
 * first load, allowing the configured base URL; a test that serves the page
 * from elsewhere sets `guard.allowed`, and one that breaks a load on
 * purpose sets `guard.allowedErrors`. A spec that launches its own
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
