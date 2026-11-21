import { describe, expect, it } from 'vitest';
import { config, type RenderQuality } from '../config';
import { MemoryStorage } from './kv';
import { DEFAULT_SETTINGS, type Settings, SETTINGS_KEY, type StoredSettings } from './schema';
import { parseSettings, relayProblem, type SettingsEnv, SettingsStore, turnProblem } from './settings';

// The settings (M4's design §1.33, §6, §9.2; PLAN §10, §11, A.3): A.3's
// shape and PLAN §11's defaults; calmCamera and quality null until chosen,
// following prefers-reduced-motion and the device's default meanwhile, a
// change of the system's preference included; relays and TURN servers
// checked as typed, a failing change storing nothing; every change one
// write of the whole object, heard by each subscriber; a stored field that
// doesn't read taking its default; and a refused write losing that write
// only.

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
