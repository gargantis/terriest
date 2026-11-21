import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { fakePage } from './clock-testing';
import { cssDeclarations, fake, installDom, only } from './dom-testing';
import { browserPhone, browserWakeLock, isPhone, type PhonePage, type TurnInspection, turnPromptLayer, UPRIGHT_HINT_MS, WakeLock, type WakeLockSentinelLike } from './phone';
import { FakeControls, FakeStage, FakeView, StateMatch, stateWith, testHost } from './pitch-testing';

// Phones (PLAN D-30, L170, C-37; M4's design §1.48, §5.13, §9.1's guard): a
// phone by its pointer and its screen's shorter side; the screen wake lock
// held while wanted, asked for again each time the page shows, let go when
// not; the turn prompt on a phone held upright, players' and spectators',
// with the rotation lock's line and, on Android, Play full screen once it
// stays upright; and every refusal, the wake lock's, fullscreen's and the
// orientation lock's, caught and reported through the prompt's inspect(),
// never a console error or an unhandled rejection.

const ME = 'a'.repeat(32);
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => {
  unhandled.push(e);
};
let dom: ReturnType<typeof installDom>;

beforeEach(() => {
  dom = installDom();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.restoreAllMocks();
  dom.restore();
});

/** Promises settled and a task run, so Node has said whether any rejection went unhandled. */
const settle = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

const refused = (name: string): DOMException => new DOMException('refused', name);

/** A held wake lock, released by the page or by the browser, as when the page is hidden. */
class Sentinel implements WakeLockSentinelLike {
  released = false;
  private readonly fns: (() => void)[] = [];

  release(): Promise<void> {
    if (!this.released) {
      this.released = true;
      for (const fn of this.fns) fn();
    }
    return Promise.resolve();
  }

  addEventListener(_type: 'release', fn: () => void): void {
    this.fns.push(fn);
  }
}

type Answer = (grant: () => Promise<WakeLockSentinelLike>) => Promise<WakeLockSentinelLike>;

/** A wake lock on a fake page, each request answered in turn, granted once the answers run out. */
function wakeRig(o: { answers?: readonly Answer[]; hidden?: boolean } = {}) {
  const page = fakePage(o.hidden ?? false);
  const sentinels: Sentinel[] = [];
  const grant = (): Promise<WakeLockSentinelLike> => {
    const s = new Sentinel();
    sentinels.push(s);
    return Promise.resolve(s);
  };
  let asked = 0;
  const lock = new WakeLock({
    page,
    request: () => {
      const answer = o.answers?.[asked] ?? ((g: () => Promise<WakeLockSentinelLike>) => g());
      asked++;
      return answer(grant);
    },
  });
  return { page, lock, sentinels, asked: () => asked };
}

describe('a phone (D-30)', () => {
  const win = (coarse: boolean, width: number, height: number) => ({
    matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' && coarse }),
    screen: { width, height },
  });

  it("is a coarse pointer and a shorter side under phoneShortSideCssPx, either way up", () => {
    const short = config.phoneShortSideCssPx - 1;
    expect(isPhone(win(true, short, 915))).toBe(true);
    expect(isPhone(win(true, 915, short))).toBe(true);
    expect(isPhone(win(true, config.phoneShortSideCssPx, 1024))).toBe(false);
    expect(isPhone(win(false, 412, 915))).toBe(false);
  });

  it('is never one, and asks for nothing, where the page has no window', async () => {
    const page = browserPhone(null);
    expect([page.phone(), page.upright(), page.android()]).toEqual([false, false, false]);
    await expect(page.enterFullscreen()).rejects.toThrow();
    expect(page.wakeLock().inspect().state).toBe('off');
  });
});

describe('the screen wake lock (D-30, §5.13)', () => {
  it('is asked for once wanted, and held', async () => {
    const w = wakeRig();
    w.lock.want(true);
    w.lock.want(true);
    await settle();
    expect(w.asked()).toBe(1);
    expect(w.lock.inspect()).toMatchObject({ wanted: true, state: 'held', requests: 1, refusals: 0 });
  });

  it("catches a refusal, reports it, and asks again when the page next shows, never a console error or an unhandled rejection", async () => {
    const error = vi.spyOn(console, 'error');
    const w = wakeRig({ answers: [() => Promise.reject(refused('NotAllowedError'))] });
    w.lock.want(true);
    await settle();
    expect(w.lock.inspect()).toMatchObject({ state: 'refused', refusals: 1, lastRefusal: 'NotAllowedError' });
    w.page.hide();
    w.page.show();
    await settle();
    expect(w.lock.inspect()).toMatchObject({ state: 'held', requests: 2, refusals: 1 });
    expect(w.sentinels).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it('catches a request that throws at once, as a refusal', async () => {
    const w = wakeRig({
      answers: [() => {
        throw new TypeError('no lock here');
      }],
    });
    w.lock.want(true);
    await settle();
    expect(w.lock.inspect()).toMatchObject({ state: 'refused', lastRefusal: 'TypeError' });
    expect(unhandled).toEqual([]);
  });

  it('is asked for again at each visibilitychange to visible, since the browser drops it when hidden', async () => {
    const w = wakeRig();
    w.lock.want(true);
    await settle();
    expect(w.sentinels).toHaveLength(1);
    w.page.hide();
    await w.sentinels[0]!.release();
    expect(w.lock.inspect().state).toBe('released');
    w.page.show();
    await settle();
    expect(w.sentinels).toHaveLength(2);
    expect(w.lock.inspect()).toMatchObject({ state: 'held', requests: 2 });
  });

  it('waits for the page to show before asking, as a hidden page is always refused', async () => {
    const w = wakeRig({ hidden: true });
    w.lock.want(true);
    await settle();
    expect(w.asked()).toBe(0);
    w.page.show();
    await settle();
    expect(w.sentinels).toHaveLength(1);
  });

  it('lets go when no longer wanted, and asks for nothing after', async () => {
    const w = wakeRig();
    w.lock.want(true);
    await settle();
    w.lock.want(false);
    expect(w.sentinels[0]!.released).toBe(true);
    expect(w.lock.inspect()).toMatchObject({ wanted: false, state: 'off' });
    expect(w.page.listeners).toBe(0);
    w.page.hide();
    w.page.show();
    await settle();
    expect(w.asked()).toBe(1);
  });

  it('lets go of a lock that comes after it stopped being wanted', async () => {
    let grant: (s: Sentinel) => void = () => {};
    const s = new Sentinel();
    const lock = new WakeLock({ page: fakePage(), request: () => new Promise((ok) => (grant = ok)) });
    lock.want(true);
    lock.want(false);
    grant(s);
    await settle();
    expect(s.released).toBe(true);
    expect(lock.inspect().state).toBe('off');
  });

  it("says unsupported where the browser offers none, and watches nothing", () => {
    const page = fakePage();
    const lock = new WakeLock({ page, request: null });
    lock.want(true);
    expect(lock.inspect().state).toBe('unsupported');
    expect(page.listeners).toBe(0);
    expect(browserWakeLock({})).toBeNull();
    expect(browserWakeLock(undefined)).toBeNull();
  });

  it("asks the browser's own wake lock for the screen's", async () => {
    const asked: unknown[] = [];
    const wl = {
      request(this: unknown, type: string) {
        asked.push([this, type]);
        return Promise.resolve(new Sentinel());
      },
    };
    await browserWakeLock({ wakeLock: wl })!();
    expect(asked).toEqual([[wl, 'screen']]);
  });
});

// --- The turn prompt ---

function phoneRig(o: { phone?: boolean; upright?: boolean; android?: boolean; fullscreen?: () => Promise<void>; lock?: () => Promise<void>; player?: boolean } = {}) {
  const v = { phone: o.phone ?? true, upright: o.upright ?? true, android: o.android ?? false };
  const fns = new Set<() => void>();
  const calls: string[] = [];
  const wake = new WakeLock({ page: fakePage(), request: () => Promise.resolve(new Sentinel()) });
  const page: PhonePage = {
    phone: () => v.phone, upright: () => v.upright, android: () => v.android,
    onChange: (fn) => {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    enterFullscreen: () => {
      calls.push('fullscreen');
      return (o.fullscreen ?? (() => Promise.resolve()))();
    },
    lockLandscape: () => {
      calls.push('lock');
      return (o.lock ?? (() => Promise.resolve()))();
    },
    wakeLock: () => wake,
  };
  const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }]));
  const host = testHost({ match, view: new FakeView([], match), stage: new FakeStage([]), controls: o.player === true ? new FakeControls([]) : null });
  const layer = turnPromptLayer(host, page);
  const el = fake(layer.el);
  dom.document.body.append(el);
  return {
    v, calls, layer, el, clock: match.clock, wake, listeners: () => fns.size,
    turn: (x: Partial<typeof v>) => {
      Object.assign(v, x);
      for (const fn of [...fns]) fn();
    },
    look: () => layer.inspect!() as TurnInspection,
    button: () => only(el, '[data-test="turn-fullscreen"]'),
  };
}

describe('the turn prompt (D-30, §5.13)', () => {
  it("asks a phone held upright to turn sideways, a spectator's too, and clears once it does", () => {
    expect(phoneRig({ player: true }).el.hidden).toBe(false);
    const r = phoneRig();
    expect(r.layer.name).toBe('turn');
    expect(r.el.hidden).toBe(false);
    expect(r.el.getAttribute('role')).toBe('alert');
    expect(only(r.el, 'h2').textContent).toBe('Turn your phone sideways to play');
    r.turn({ upright: false });
    expect(r.el.hidden).toBe(true);
    expect(r.look()).toMatchObject({ phone: true, upright: false, shown: false });
    r.turn({ upright: true });
    expect(r.look().shown).toBe(true);
  });

  it('never shows on a desktop, a tablet, or a phone held sideways', () => {
    expect(phoneRig({ phone: false }).el.hidden).toBe(true);
    expect(phoneRig({ upright: false }).el.hidden).toBe(true);
  });

  it("adds the rotation lock's line once it stays upright, and on Android Play full screen", () => {
    const r = phoneRig({ android: true });
    r.clock.advance(UPRIGHT_HINT_MS - 1);
    expect(only(r.el, '[data-test="turn-still"]').hidden).toBe(true);
    expect(r.button().hidden).toBe(true);
    r.clock.advance(1);
    expect(only(r.el, '[data-test="turn-still"]').hidden).toBe(false);
    expect(r.button().hidden).toBe(false);
    expect(r.look()).toMatchObject({ still: true, fullscreenOffered: true });
  });

  it('offers no Play full screen off Android', () => {
    const r = phoneRig();
    r.clock.advance(UPRIGHT_HINT_MS);
    expect(r.look()).toMatchObject({ still: true, fullscreenOffered: false });
    expect(r.button().hidden).toBe(true);
  });

  it('starts its wait again each time the phone is turned upright', () => {
    const r = phoneRig({ android: true });
    r.clock.advance(UPRIGHT_HINT_MS - 10);
    r.turn({ upright: false });
    r.turn({ upright: true });
    r.clock.advance(20);
    expect(r.look().still).toBe(false);
    r.clock.advance(UPRIGHT_HINT_MS);
    expect(r.look().still).toBe(true);
    r.turn({ upright: false });
    expect(r.look()).toMatchObject({ shown: false, still: false });
    expect(r.button().hidden).toBe(true);
  });

  it('enters fullscreen, then locks landscape, on Play full screen', async () => {
    const r = phoneRig({ android: true });
    r.clock.advance(UPRIGHT_HINT_MS);
    r.button().click();
    await settle();
    expect(r.calls).toEqual(['fullscreen', 'lock']);
    expect(r.look()).toMatchObject({ presses: 1, fullscreen: 'entered', orientation: 'locked' });
  });

  it("catches fullscreen's refusal and the orientation lock's, reporting each, never a console error or an unhandled rejection", async () => {
    const error = vi.spyOn(console, 'error');
    const noFullscreen = phoneRig({ android: true, fullscreen: () => Promise.reject(refused('NotAllowedError')) });
    noFullscreen.clock.advance(UPRIGHT_HINT_MS);
    noFullscreen.button().click();
    const noLock = phoneRig({ android: true, lock: () => Promise.reject(refused('NotSupportedError')) });
    noLock.clock.advance(UPRIGHT_HINT_MS);
    noLock.button().click();
    await settle();
    expect(noFullscreen.calls).toEqual(['fullscreen']);
    expect(noFullscreen.look()).toMatchObject({ fullscreen: 'NotAllowedError', orientation: null });
    expect(noLock.look()).toMatchObject({ fullscreen: 'entered', orientation: 'NotSupportedError' });
    expect(error).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it('holds the wake lock while it shows the pitch, and lets go of it and its listeners when it goes', async () => {
    const r = phoneRig({ upright: false });
    await settle();
    expect(r.look().wakeLock).toMatchObject({ wanted: true, state: 'held' });
    r.layer.dispose!();
    expect(r.wake.inspect()).toMatchObject({ wanted: false, state: 'off' });
    expect(r.listeners()).toBe(0);
    r.turn({ upright: true });
    expect(r.el.hidden).toBe(true);
  });

  it('cancels its wait when it goes', () => {
    const r = phoneRig();
    expect(r.clock.pending).toBe(1);
    r.layer.dispose!();
    expect(r.clock.pending).toBe(0);
  });
});

describe("the page's safe areas (D-30, §5.13)", () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;

  it('opts in to the whole screen, and keeps the boot messages inside the insets', () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*\bviewport-fit=cover\b/);
    for (const side of ['top', 'right', 'bottom', 'left']) expect(cssDeclarations(style, '#fallback').padding).toContain(`env(safe-area-inset-${side}`);
    // Over the pitch no thumb pans or zooms the page.
    expect(cssDeclarations(style, '#app.pitch #screen')).toMatchObject({ position: 'fixed', inset: '0', 'touch-action': 'none' });
  });

  it("keeps the boot page's contract: its message and noscript until the app starts, boot.js before the module, no #app", () => {
    expect(html).toContain('<main id="fallback">');
    expect(html).toMatch(/<noscript>[\s\S]*<\/noscript>/);
    expect(html.indexOf('src="./boot.js"')).toBeGreaterThan(0);
    expect(html.indexOf('src="./boot.js"')).toBeLessThan(html.indexOf('src="./src/main.ts"'));
    // No element of its own named #app: src/main.ts makes it, on the normal page only (M4-Q1).
    const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/, '');
    expect(markup).not.toMatch(/\sid="app"/);
    expect(cssDeclarations(style, 'html:not([data-boot="started"]) #app').visibility).toBe('hidden');
  });
});
