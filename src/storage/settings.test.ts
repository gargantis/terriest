import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, type RenderQuality } from '../config';
import { MemoryStorage } from './kv';
import { DEFAULT_SETTINGS, type Settings, SETTINGS_KEY, type StoredSettings, type TurnServer } from './schema';
import {
  browserEnv, parseSettings, RELAYS_MAX, relayProblem, relaysProblem, type SettingsEnv, SettingsStore, turnProblem, turnProblemAt,
} from './settings';

// The settings (M4's design §1.33, §6, §9.2; PLAN §10, §11, A.3): A.3's
// shape and PLAN §11's defaults; calmCamera and quality null until chosen,
// following prefers-reduced-motion and the device's default meanwhile, a
// change of the system's preference included, which subscribers hear
// while the calmer camera follows it; relays and TURN servers checked as
// typed, by the checks the Settings screen runs as they're typed, a
// failing change storing nothing; every change one write of the whole
// object, A.3's fields alone, heard by each subscriber, one that throws
// keeping no other from hearing; a stored field that doesn't read taking
// its default; and a refused write losing that write only.

const env = (reduced: { on: boolean }, quality: RenderQuality = 'high'): SettingsEnv => ({ reducedMotion: () => reduced.on, qualityDefault: () => quality });
const stored = (kv: MemoryStorage): unknown => JSON.parse(kv.data.get(SETTINGS_KEY) ?? 'null');

describe('the settings (A.3, PLAN §11)', () => {
  it("starts at PLAN §11's defaults, the nulls resolved by their rules", () => {
    const s = new SettingsStore(new MemoryStorage(), env({ on: false }));
    expect(s.stored()).toEqual({ v: 1, relays: [], turn: [], names: false, ballView: true, calmCamera: null, mirrorTouch: false, sound: true, quality: null });
    expect(s.get()).toEqual({ v: 1, relays: [], turn: [], names: false, ballView: true, calmCamera: false, mirrorTouch: false, sound: true, quality: 'high' });
    expect(new SettingsStore(new MemoryStorage(), env({ on: true }, 'low')).get()).toMatchObject({ calmCamera: true, quality: 'low' });
    expect(config.renderQualityDefault).toBe('high');
  });

  it('follows the system preference while calmCamera is null, and the choice once made', () => {
    const reduced = { on: false };
    const s = new SettingsStore(new MemoryStorage(), env(reduced));
    expect(s.get().calmCamera).toBe(false);
    reduced.on = true; // the system's preference changes: it applies
    expect(s.get().calmCamera).toBe(true);
    expect(s.set({ calmCamera: false })).toBeNull();
    expect(s.get().calmCamera).toBe(false);
    expect(s.stored().calmCamera).toBe(false);
    expect(s.set({ quality: 'low' })).toBeNull();
    expect(s.get().quality).toBe('low');
  });

  it('writes the whole object once a change, which reads back as it was, and tells each subscriber', () => {
    const kv = new MemoryStorage();
    const s = new SettingsStore(kv, env({ on: false }));
    const heard: Settings[] = [];
    const stop = s.subscribe((x) => heard.push(x));
    expect(s.set({ ballView: false, quality: 'low' })).toBeNull();
    expect(stored(kv)).toEqual({ ...DEFAULT_SETTINGS, ballView: false, quality: 'low' });
    expect(heard.map((x) => [x.ballView, x.quality])).toEqual([[false, 'low']]);
    expect(new SettingsStore(kv, env({ on: false })).stored()).toEqual(s.stored());
    expect(s.set({ ballView: false })).toBeNull(); // no change: nothing written or told
    expect(heard).toHaveLength(1);
    stop();
    s.set({ sound: false });
    expect(heard).toHaveLength(1);
    expect((stored(kv) as StoredSettings).sound).toBe(false);
  });

  it('checks relays and TURN servers as typed, and stores nothing from a change that fails (roslambo\'s)', () => {
    const kv = new MemoryStorage();
    const s = new SettingsStore(kv, env({ on: false }));
    expect(s.set({ relays: ['wss://relay.example.org'], names: true })).toBeNull();
    for (const [change, problem] of [
      [{ relays: ['ws://relay.example.org'] }, /must start with wss:/],
      [{ relays: ['wss://user:pass@relay.example.org'] }, /user name or password/],
      [{ relays: ['not a url'] }, /isn’t a URL/],
      [{ relays: Array.from({ length: 11 }, (_, k) => `wss://r${k}.example.org`) }, /At most 10/],
      [{ turn: [{ urls: 'stun:x.example.org', username: 'u', credential: 'c' }] }, /turn: or turns:/],
      [{ turn: [{ urls: 'turns:x.example.org:443', username: '', credential: 'c' }] }, /user name and credential/],
      [{ quality: 'medium' as RenderQuality }, /high or low/],
      [{ calmCamera: 'yes' as unknown as boolean }, /calmer camera/],
    ] as const) {
      expect(s.set({ ...change, sound: false }), JSON.stringify(change)).toMatch(problem);
    }
    expect(s.stored()).toMatchObject({ relays: ['wss://relay.example.org'], names: true, sound: true });
    expect(s.set({ turn: [{ urls: 'turns:turn.example.org:443', username: 'u', credential: 'c' }] })).toBeNull();
    expect(relayProblem('wss://relay.example.org/path')).toBeNull();
    expect(turnProblem({ urls: 'turn:t.example.org:3478', username: 'u', credential: 'c' })).toBeNull();
  });

  it('reads a stored field that fails as its default, and drops a relay or TURN server that fails its check', () => {
    const raw = JSON.stringify({
      v: 1, relays: ['wss://ok.example.org', 'http://no.example.org', 7], turn: [{ urls: 'turn:ok', username: 'u', credential: 'c' }, { urls: 'x' }],
      names: 'yes', ballView: false, calmCamera: 'maybe', mirrorTouch: true, sound: null, quality: 'ultra',
    });
    expect(parseSettings(raw)).toEqual({
      v: 1, relays: ['wss://ok.example.org'], turn: [{ urls: 'turn:ok', username: 'u', credential: 'c' }],
      names: false, ballView: false, calmCamera: null, mirrorTouch: true, sound: true, quality: null,
    });
    for (const bad of [null, '{nope', '[]', JSON.stringify({ v: 2, sound: false })]) expect(parseSettings(bad), `${bad}`).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ v: 1, relays: Array.from({ length: 12 }, (_, k) => `wss://r${k}.example.org`) })).relays).toHaveLength(10);
  });

  it('loses a refused write only: the change in force, and persistent false until a later write lands', () => {
    const kv = new MemoryStorage();
    const s = new SettingsStore(kv, env({ on: false }));
    expect(s.persistent).toBe(true);
    kv.full = true;
    expect(s.set({ sound: false })).toBeNull();
    expect([s.get().sound, s.persistent, kv.data.has(SETTINGS_KEY)]).toEqual([false, false, false]);
    kv.full = false;
    expect(s.set({ names: true })).toBeNull();
    expect(s.persistent).toBe(true);
    expect(stored(kv)).toMatchObject({ sound: false, names: true });
    expect(new SettingsStore(null, env({ on: false })).persistent).toBe(false);
  });

  it('never writes to storage whose read failed, and plays from memory', () => {
    const kv = new MemoryStorage();
    kv.data.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, sound: false }));
    kv.getItem = () => {
      throw new Error('the read is refused');
    };
    const s = new SettingsStore(kv, env({ on: false }));
    expect([s.persistent, s.get().sound]).toEqual([false, true]);
    expect(s.set({ names: true })).toBeNull();
    expect([s.get().names, s.persistent]).toEqual([true, false]);
    expect(stored(kv)).toEqual({ ...DEFAULT_SETTINGS, sound: false });
  });
});

/** An env whose system preference the test changes, telling the store's watch as a browser would. */
function watchedEnv(): { readonly env: SettingsEnv; set(on: boolean): void; readonly watching: number } {
  const reduced = { on: false };
  const fns = new Set<() => void>();
  return {
    env: {
      reducedMotion: () => reduced.on,
      qualityDefault: () => 'high',
      watchReducedMotion: (fn) => {
        fns.add(fn);
        return () => {
          fns.delete(fn);
        };
      },
    },
    set(on) {
      reduced.on = on;
      for (const fn of [...fns]) fn();
    },
    get watching() {
      return fns.size;
    },
  };
}

describe("the settings' subscribers (PLAN §11: what applies at once)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hear the system's preference change while the calmer camera follows it, and not once it's chosen", () => {
    const sys = watchedEnv();
    const s = new SettingsStore(new MemoryStorage(), sys.env);
    expect(sys.watching).toBe(1);
    const heard: boolean[] = [];
    const stop = s.subscribe((x) => heard.push(x.calmCamera));
    sys.set(true);
    sys.set(false);
    expect(heard).toEqual([true, false]);
    expect(s.set({ calmCamera: true })).toBeNull(); // chosen: heard as any change is
    sys.set(true);
    sys.set(false);
    expect([heard, s.get().calmCamera]).toEqual([[true, false, true], true]);
    expect(s.set({ calmCamera: null })).toBeNull(); // following the system again
    sys.set(true);
    expect(heard).toEqual([true, false, true, false, true]);
    stop();
    sys.set(false);
    expect(heard).toHaveLength(5);
  });

  it('tell each in the order they came, but one removed meanwhile, and one that throws keeps no other from hearing', () => {
    const s = new SettingsStore(new MemoryStorage(), watchedEnv().env);
    const heard: string[] = [];
    let stopB = (): void => {};
    s.subscribe(() => {
      heard.push('a');
      stopB();
    });
    stopB = s.subscribe(() => heard.push('b'));
    s.subscribe(() => {
      heard.push('c');
      throw new Error('a subscriber’s bug');
    });
    s.subscribe(() => heard.push('d'));
    const reported: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => reported.push(fn));
    // The change stands and its caller hears no error: the subscriber's is reported apart, as an event
    // listener's is.
    expect(s.set({ sound: false })).toBeNull();
    expect([heard, s.stored().sound]).toEqual([['a', 'c', 'd'], false]);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toThrow('a subscriber’s bug');
  });

  it("write A.3's fields alone, whatever else a change carries, and take a null only where it means the rule", () => {
    const kv = new MemoryStorage();
    const s = new SettingsStore(kv, watchedEnv().env);
    const turn = { urls: 'turn:t.example.org:3478', username: 'u', credential: 'c' };
    const change = { sound: false, stray: 1, turn: [{ ...turn, note: 'kept nowhere' }] } as unknown as Partial<StoredSettings>;
    expect(s.set(change)).toBeNull();
    const written = stored(kv) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(['v', 'relays', 'turn', 'names', 'ballView', 'calmCamera', 'mirrorTouch', 'sound', 'quality']);
    expect(written['turn']).toEqual([turn]);
    expect(s.stored().turn).toEqual([turn]);
    // A flag is on or off: a null there is a mistake, said and stored nowhere, never read as "no change".
    for (const k of ['names', 'ballView', 'mirrorTouch', 'sound'] as const) {
      expect(s.set({ [k]: null } as unknown as Partial<StoredSettings>), k).toBe(`${k} is on or off.`);
    }
    expect(s.set({ quality: 'low', calmCamera: false })).toBeNull();
    expect(s.set({ quality: null, calmCamera: null })).toBeNull(); // back to their rules (A.3)
    expect([s.stored().quality, s.stored().calmCamera, (stored(kv) as StoredSettings).quality]).toEqual([null, null, null]);
    expect(s.set({ names: undefined } as unknown as Partial<StoredSettings>)).toBeNull(); // undefined: no change
    expect(s.stored()).toEqual({ ...DEFAULT_SETTINGS, turn: [turn], sound: false });
  });
});

describe('the checks the Settings screen runs as typed (§6)', () => {
  it('take at most RELAYS_MAX relays, each a wss:// URL without credentials, the count first', () => {
    const ten = Array.from({ length: RELAYS_MAX }, (_, k) => `wss://r${k}.example.org`);
    expect([RELAYS_MAX, relaysProblem([]), relaysProblem(ten)]).toEqual([10, null, null]);
    expect(relaysProblem([...ten, 'wss://r10.example.org'])).toBe('At most 10 extra relays.');
    expect(relaysProblem([...ten, 'nope'])).toBe('At most 10 extra relays.');
    expect(relaysProblem(['wss://ok.example.org', 'ws://no.example.org', 'nope'])).toBe('“ws://no.example.org” must start with wss://.');
    expect(relaysProblem(['wss://a:b@x.example.org'])).toBe('“wss://a:b@x.example.org” mustn’t contain a user name or password.');
    expect(relaysProblem(['wss://'])).toBe('“wss://” isn’t a URL.');
  });

  it("say which of a TURN server's fields is at fault, the URL first, then the user name, then the credential", () => {
    const ok: TurnServer = { urls: 'turns:turn.example.org:443', username: 'u', credential: 'c' };
    expect(turnProblemAt(ok)).toBeNull();
    expect(turnProblemAt({ ...ok, urls: 'stun:x.example.org', username: '' })).toEqual({
      field: 'urls', problem: 'A TURN URL starts with turn: or turns:, for example turns:turn.example.com:443.',
    });
    expect(turnProblemAt({ ...ok, urls: 'turn: x' })?.field).toBe('urls');
    expect(turnProblemAt({ ...ok, username: '', credential: '' })).toEqual({ field: 'username', problem: 'A TURN server needs its user name and credential.' });
    expect(turnProblemAt({ ...ok, credential: '' })).toEqual({ field: 'credential', problem: 'A TURN server needs its user name and credential.' });
    for (const t of [ok, { ...ok, urls: 'nope' }, { ...ok, credential: '' }]) expect(turnProblem(t)).toBe(turnProblemAt(t)?.problem ?? null);
  });
});

describe("the page's preference (A.3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reads prefers-reduced-motion from one live query, and its watch tells the store of each change', async () => {
    const listeners: (() => void)[] = [];
    const query = {
      matches: false,
      addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.splice(listeners.indexOf(fn), 1),
    };
    const asked: string[] = [];
    vi.stubGlobal('matchMedia', (q: string) => {
      asked.push(q);
      return query;
    });
    vi.resetModules(); // a page's module, whose query is still to make
    const page = await import('./settings');
    const s = new page.SettingsStore(new MemoryStorage(), page.browserEnv);
    const heard: boolean[] = [];
    s.subscribe((x) => heard.push(x.calmCamera));
    expect(s.get().calmCamera).toBe(false);
    query.matches = true;
    for (const fn of [...listeners]) fn();
    expect([heard, s.get().calmCamera, s.get().quality]).toEqual([[true], true, config.renderQualityDefault]);
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)']); // made once, and read live
    const stop = page.browserEnv.watchReducedMotion!(() => {});
    expect(listeners).toHaveLength(2);
    stop();
    expect(listeners).toHaveLength(1);
  });

  it('follows no preference where the page has no matchMedia, and watches nothing', () => {
    expect(typeof globalThis.matchMedia).toBe('undefined');
    expect(browserEnv.reducedMotion()).toBe(false);
    expect(browserEnv.watchReducedMotion!(() => {})).toBeTypeOf('function');
    expect(new SettingsStore(new MemoryStorage()).get().calmCamera).toBe(false);
  });
});
