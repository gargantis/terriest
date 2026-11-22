import type { Browser, Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { personId } from '../../src/core/bot/bot-id';
import type { NetReport } from '../../src/nettest-params';
import { DEFAULT_SETTINGS, PROFILE_KEY, SETTINGS_KEY } from '../../src/storage/schema';
import { type AppPageOptions, type Engine, expectClosedAtUnload, type NetPage, openAppPage, type UnloadLook, waitFor, watchUnload } from './browsers';

// The networked specs' wait (e2e/lib/browsers.ts's waitFor; M4's design
// §9.1): a look at each page's report every poll until what's waited for
// holds, its deadline on the monotonic clock, as e2e/lib/page.ts's waits,
// so the machine's clock, which phase 1c measured stepping a second ahead
// every 32 s, never ends a wait early. New at M4, by phase 2b's Wire step.
// And openAppPage (M4's design §5.12, §9.1, §9.4, M4-Q3, M4-Q4): a normal
// page in a browser a test launched, its init scripts run against a page's
// globals as a load runs them, so what it stores, the hook it sets and the
// pad it stubs are read back as the page would read them. By phase 2d's
// match builder. And watchUnload, its init script run against a page's
// globals, Node's own EventTarget for the window, the document and each
// connection, and expectClosedAtUnload, which judges the first look.

/** A #test=net page whose reports' final tick counts its looks; the machine's clock steps a minute ahead
 *  each time it's read, while the monotonic clock keeps its time. */
function netPage(): { readonly page: NetPage; looks(): number } {
  let looks = 0;
  let wall = 1.8e12;
  vi.spyOn(Date, 'now').mockImplementation(() => (wall += 60_000));
  const report = (): NetReport => ({
    me: '0'.repeat(32), role: 'player', phase: 0, overtime: false, score: [0, 0], clock: 0, finalTick: ++looks, peers: 1, stall: 'none',
    refused: null, refusedBy: null, duplicates: [],
  }) as unknown as NetReport;
  const page = { evaluate: async () => report() } as unknown as Page;
  return { page: { page, engine: 'chromium' } as unknown as NetPage, looks: () => looks };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the networked specs' wait (§9.1)", () => {
  it("goes by the monotonic clock: the machine's clock stepping ahead ends it none early", async () => {
    const p = netPage();
    const [r] = await waitFor([p.page], ([x]) => x!.finalTick >= 3, { timeoutMs: 5_000 });
    expect([r!.finalTick, p.looks()]).toEqual([3, 3]);
  });

  it('fails once the monotonic clock passes its deadline, saying where each page is', async () => {
    const p = netPage();
    const from = performance.now();
    await expect(waitFor([p.page], () => false, { timeoutMs: 300 })).rejects.toThrow(/^not reached within 300 ms\n {2}chromium 0000 \(player\): phase 0/);
    expect(performance.now() - from).toBeGreaterThanOrEqual(300);
  });
});

// ---- openAppPage ----

const BASE = 'http://127.0.0.1:4341/';
const RELAY = 'ws://127.0.0.1:45678';

/** A page's globals, as its init scripts and evaluates see them: storage, the window's hook, the canvas,
 *  html[data-boot] and the navigator. */
interface PageGlobals {
  readonly storage: Map<string, string>;
  readonly window: { terriestTest?: unknown };
  readonly navigator: { getGamepads?: () => readonly unknown[] };
}

/** What the fake browser saw: the context's options, each step in order, and each URL loaded. */
interface Seen {
  contextOptions: unknown;
  readonly steps: string[];
  readonly gotos: string[];
  /** html[data-boot] read. */
  looks: number;
}

/**
 * A browser of `engine` whose one context's page runs each init script against `g` at every load, in the
 * order added, as a browser does; whose evaluates run against g too, the canvas drawing WebGL 2 unless
 * `webgl2` is false; and whose html[data-boot] reads `boots` in turn once loaded, the last again once they run
 * out. Its waits move the monotonic clock by their length, while the machine's steps a minute at each read.
 */
function fakeBrowser(o: { engine?: Engine; boots: readonly (string | null)[]; webgl2?: boolean; stored?: Readonly<Record<string, string>> }): {
  readonly browser: Browser; readonly g: PageGlobals; readonly seen: Seen;
} {
  const g: PageGlobals = { storage: new Map(Object.entries(o.stored ?? {})), window: {}, navigator: {} };
  const seen: Seen = { contextOptions: null, steps: [], gotos: [], looks: 0 };
  let mono = 0;
  let wall = 1.8e12;
  let loaded = false;
  vi.spyOn(performance, 'now').mockImplementation(() => mono);
  vi.spyOn(Date, 'now').mockImplementation(() => (wall += 60_000));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => g.storage.get(k) ?? null,
    setItem: (k: string, v: string) => void g.storage.set(k, v),
  });
  vi.stubGlobal('window', g.window);
  vi.stubGlobal('navigator', g.navigator);
  vi.stubGlobal('document', {
    addEventListener: () => {},
    createElement: () => ({ getContext: (kind: string) => (kind === 'webgl2' && o.webgl2 !== false ? {} : null) }),
    documentElement: {
      getAttribute: (name: string) => {
        if (name !== 'data-boot' || !loaded) return null;
        return o.boots[Math.min(seen.looks++, o.boots.length - 1)] ?? null;
      },
    },
  });
  const scripts: { readonly fn: (arg?: unknown) => void; readonly arg: unknown }[] = [];
  const page = {
    on: () => page,
    addInitScript: async (fn: (arg?: unknown) => void, arg?: unknown) => {
      seen.steps.push(`script ${scripts.length}`);
      scripts.push({ fn, arg });
    },
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
      seen.steps.push(loaded ? 'look' : 'evaluate before load');
      return fn(arg);
    },
    goto: async (url: string) => {
      seen.steps.push('goto');
      seen.gotos.push(url);
      for (const s of scripts) s.fn(s.arg);
      loaded = true;
      return null;
    },
    waitForTimeout: async (ms: number) => {
      mono += ms;
    },
  };
  const context = { newPage: async () => page };
  const browser = {
    browserType: () => ({ name: () => o.engine ?? 'chromium' }),
    newContext: async (options: unknown) => {
      seen.contextOptions = options;
      return context;
    },
  };
  return { browser: browser as unknown as Browser, g, seen };
}

const json = (g: PageGlobals, key: string): unknown => JSON.parse(g.storage.get(key) ?? 'null');

describe('openAppPage: a normal page of the built app in a launched browser (§9.4, M4-Q3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { terriestPadStub?: unknown }).terriestPadStub;
  });

  it('seeds a player of personId(7, k), its name, its coat and low quality, sets the local relay with local ICE, at 640 × 360, watched, loaded at base + fragment and started', async () => {
    const { browser, g, seen } = fakeBrowser({ engine: 'webkit', boots: ['loading', 'loading', 'started'] });
    const o: AppPageOptions = { k: 2, name: 'WebKit', relay: RELAY, fragment: '#join=K7QM2XDP4TR8WHZN3VBC7' };
    const app = await openAppPage(browser, BASE, o);
    expect(seen.contextOptions, 'the gate’s window (§9.1)').toEqual({ viewport: { width: 640, height: 360 } });
    expect(json(g, PROFILE_KEY), 'the profile, as a player’s stored one (M4-Q4)').toEqual({
      v: 1, playerId: personId(7, 2), name: 'WebKit', coat: 2, hints: { keyboard: 0, touch: 0, gamepad: 0 },
    });
    expect(json(g, SETTINGS_KEY), 'the settings: the gate’s low quality (D-33)').toEqual({ ...DEFAULT_SETTINGS, quality: 'low' });
    expect(g.window.terriestTest, 'the hook: the local relay alone, ICE local (M4-Q3)').toEqual({ relay: RELAY, ice: 'local' });
    expect(g.navigator.getGamepads, 'no pad unless asked').toBeUndefined();
    expect(seen.gotos, 'loaded at base + fragment').toEqual([`${BASE}#join=K7QM2XDP4TR8WHZN3VBC7`]);
    expect([app.engine, app.watch.allowed], 'the engine, and watched with the base URL and the relay allowed').toEqual(['webkit', [BASE, RELAY]]);
    // WebGL 2 asserted in the new page before anything loads (C-6), then boot.js's verdict awaited.
    expect([seen.steps.indexOf('evaluate before load') < seen.steps.indexOf('goto'), seen.looks], 'WebGL 2 first, then three looks').toEqual([true, 3]);
  });

  it('takes a viewport, a coat and the gamepad’s stub when given, and keeps what the page stored', async () => {
    const stored = { [PROFILE_KEY]: JSON.stringify({ v: 1, playerId: personId(7, 9), name: 'Kept', coat: 3, hints: { keyboard: 1, touch: 0, gamepad: 0 } }) };
    const { browser, g, seen } = fakeBrowser({ boots: ['started'], stored });
    const order: string[] = [];
    const app = await openAppPage(browser, BASE, {
      k: 1, coat: 5, relay: RELAY, viewport: { width: 915, height: 412 }, gamepad: true,
      beforeLoad: async () => {
        order.push(`before load, ${seen.gotos.length} loads`);
      },
    });
    expect([seen.contextOptions, app.engine, seen.gotos]).toEqual([{ viewport: { width: 915, height: 412 } }, 'chromium', [BASE]]);
    expect([order, seen.steps.at(-2)], "the spec's own step before the load").toEqual([['before load, 0 loads'], 'goto']);
    // The seed only where the key is absent, as a reload finds what the page stored (M4-Q4).
    expect([json(g, PROFILE_KEY), json(g, SETTINGS_KEY)]).toEqual([JSON.parse(stored[PROFILE_KEY]!), { ...DEFAULT_SETTINGS, quality: 'low' }]);
    const pads = g.navigator.getGamepads?.() as readonly ({ mapping: string; buttons: unknown[] } | null)[] | undefined;
    expect([pads?.length, pads?.[0]?.mapping, pads?.[0]?.buttons.length], "the stub's one standard pad").toEqual([4, 'standard', 17]);
    // Without a name, a first visit's empty one; the coat as given.
    const fresh = fakeBrowser({ boots: ['started'] });
    await openAppPage(fresh.browser, BASE, { k: 3, coat: 5, relay: RELAY });
    expect(json(fresh.g, PROFILE_KEY)).toEqual({ v: 1, playerId: personId(7, 3), name: '', coat: 5, hints: { keyboard: 0, touch: 0, gamepad: 0 } });
  });

  it("fails at once on boot.js's failure code, and by its deadline on the monotonic clock on a page that never starts", async () => {
    await expect(openAppPage(fakeBrowser({ boots: ['loading', 'W'] }).browser, BASE, { k: 0, relay: RELAY }))
      .rejects.toThrow(/^the page didn't start: boot\.js shows its failure W \(D-30\)$/);
    vi.unstubAllGlobals();
    const never = fakeBrowser({ boots: [null] });
    await expect(openAppPage(never.browser, BASE, { k: 0, relay: RELAY })).rejects.toThrow(/^the page didn't start within 30000 ms: data-boot is absent$/);
    // A look at 0, 50, …, 30,000 ms, and the one past the deadline: the machine's clock, stepping a minute at
    // each read, ended it none early.
    expect(never.seen.looks).toBe(30_000 / 50 + 2);
  });

  it('asserts WebGL 2 before loading anything, so a run without a display fails at once (C-6)', async () => {
    const { browser, seen } = fakeBrowser({ boots: ['started'], webgl2: false });
    await expect(openAppPage(browser, BASE, { k: 0, relay: RELAY })).rejects.toThrow(/WebGL 2 in this engine/);
    expect(seen.gotos).toEqual([]);
  });
});

// ---- watchUnload ----

/** A connection as the page's RTCPeerConnection: its state moved by the test, connectionstatechange
 *  fired at each move, and close() moving it to 'closed' with no event, as the spec's close() does. */
class FakePeerConnection extends EventTarget {
  connectionState = 'new';

  to(state: string): void {
    this.connectionState = state;
    this.dispatchEvent(new Event('connectionstatechange'));
  }

  close(): void {
    this.connectionState = 'closed';
  }
}

/** A page whose init scripts run against fake globals when load() is called: the window's listeners and
 *  the document's on Node's own EventTargets, the document's visibilityState the test's, and its
 *  console.debug handed to the page's console listeners as a message, as Playwright hands them over. */
function unloadingPage(): { readonly page: Page; load(): void; readonly window: EventTarget; visibility(state: string): void } {
  const win = new EventTarget();
  const doc = new EventTarget();
  let visibilityState = 'visible';
  const listeners: ((m: { text(): string }) => void)[] = [];
  const scripts: { readonly fn: (arg?: unknown) => void; readonly arg: unknown }[] = [];
  vi.stubGlobal('window', { RTCPeerConnection: FakePeerConnection });
  vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
  vi.stubGlobal('document', { addEventListener: doc.addEventListener.bind(doc), get visibilityState() { return visibilityState; } });
  vi.spyOn(console, 'debug').mockImplementation((text: string) => {
    for (const f of listeners) f({ text: () => text });
  });
  const page = {
    on: (event: string, f: (m: { text(): string }) => void) => {
      if (event === 'console') listeners.push(f);
      return page;
    },
    addInitScript: async (fn: (arg?: unknown) => void, arg?: unknown) => {
      scripts.push({ fn, arg });
    },
  };
  return {
    page: page as unknown as Page,
    load: () => {
      for (const s of scripts) s.fn(s.arg);
    },
    window: win,
    visibility: (state) => {
      visibilityState = state;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

describe("watchUnload: a page's connections as it goes, after its pagehide", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('looks at visibilitychange to hidden and at unload once the page has had its pagehide, at each connection that connected', async () => {
    const p = unloadingPage();
    const looks: UnloadLook[] = [];
    await watchUnload(p.page, looks);
    p.load();
    const Made = (globalThis as unknown as { window: { RTCPeerConnection: new () => FakePeerConnection } }).window.RTCPeerConnection;
    const [joined, dropped] = [new Made(), new Made(), new Made()]; // the third an offer no one answered
    joined.to('connecting');
    joined.to('connected');
    dropped.to('connected');
    dropped.close();
    // Hidden in the background, with no pagehide: the page stays, and nothing is looked at.
    p.visibility('hidden');
    p.visibility('visible');
    expect(looks).toEqual([]);
    p.window.dispatchEvent(new Event('pagehide'));
    p.visibility('hidden');
    p.window.dispatchEvent(new Event('unload'));
    expect(looks).toEqual([{ event: 'visibilitychange', states: ['connected', 'closed'] }, { event: 'unload', states: ['connected', 'closed'] }]);
  });

  it('expectClosedAtUnload: the first look, every connection that connected closed and at least one; a look that never comes fails by its deadline', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(expectClosedAtUnload([{ event: 'visibilitychange', states: ['connected', 'closed'] }, { event: 'unload', states: ['closed', 'closed'] }], 'the page'))
      .rejects.toThrow(/the page: 1 of the 2 connections it had connected not closed at its visibilitychange/);
    await expect(expectClosedAtUnload([{ event: 'unload', states: ['closed', 'closed', 'closed'] }], 'the page')).resolves.toBeUndefined();
    await expect(expectClosedAtUnload([{ event: 'unload', states: [] }], 'the page')).rejects.toThrow(/the page: the connections it had connected, by its unload/);
    let mono = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (mono += 1_000));
    await expect(expectClosedAtUnload([], 'the page')).rejects.toThrow(/^the page: no look at its connections as it went, within 5000 ms of the check$/);
  });
});
