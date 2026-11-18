import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { config, type Config } from '../../config';
import { netSettings, practiceSettings } from './settings';

// Design §1.13: the configuration in the timeline's, the room's and the
// transports' units, from the configuration it's given and no other, every
// M3 setting of design §10 among what it reads.

/** Every setting's key path, a group's keys under its name, as
 *  src/config.test.ts reads them. */
function settingPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) => settingPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

const valueAt = (c: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), c);

function withValue<T>(c: T, path: string, v: unknown): T {
  const [head, ...rest] = path.split('.');
  const o = c as Record<string, unknown>;
  return { ...o, [head!]: rest.length === 0 ? v : withValue(o[head!], rest.join('.'), v) } as T;
}

/** A different value of the same kind. */
function changed(v: unknown): unknown {
  if (typeof v === 'number') return v === 0 ? 1 : v * 1.5 + 1;
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'string') return `${v}, changed`;
  return JSON.parse(JSON.stringify(v).replace(/-?\d+(\.\d+)?/, (n) => String(Number(n) + 0.5)));
}

/** What netSettings gives, or the error it throws. */
function settingsOf(c: Config): unknown {
  try {
    return netSettings(c);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const planted = (over: Partial<Config>): Config => ({ ...config, ...over });

/** Design §10's 19 keys. */
const M3_KEYS = [
  'joinWarmupSeconds', 'clockSettleSeconds', 'clockSmoothing', 'clockGainPerTick', 'clockRateMax', 'clockDeadbandTicks',
  'clockRebalanceSeconds', 'resyncRetrySeconds', 'stateRequestRetrySeconds', 'eventRetryTicks', 'peersEverySeconds',
  'pingEverySeconds', 'floodTicksPerTick', 'floodSeconds', 'invalidMessagesMax', 'stallSendTicks', 'timelineTimerMs',
  'leaveGraceSeconds', 'botReadyRenewSeconds',
];

describe('netSettings (design §1.13)', () => {
  it("gives A.4's values in milliseconds, ticks and the clock's fractions", () => {
    const n = netSettings();
    expect(n).toEqual({
      tickMs: 1000 / 60,
      timerMs: 4,
      stallMs: 2000,
      timeline: {
        delay: 2, window: 12, voteWindow: 12, history: 256, inputHistory: 16, spreadCap: 42, inputSpan: 1024,
        warmupMs: 500, resyncRetryMs: 500, stallSendTicks: 3,
        clock: { tickMs: 1000 / 60, settleMs: 2000, smoothing: 0.1, gainPerTick: 0.005, rateMax: 0.02, deadbandTicks: 1, rebalanceMs: 1000, sampleMaxTicks: 742 },
      },
      room: {
        spectatorsMax: 4, meshPlayersMax: 8, duplicateSilentMs: 2000, peersEveryMs: 5000, stateRequestRetryMs: 1000,
        eventRetryTicks: 30, floodTicksPerTick: 3, floodMs: 2000, floodTicksMax: 360, invalidMessagesMax: 20, abandonedMs: 30000,
        connectionFailureMs: 20000, handshakeTimeoutMs: 10000, botReadyRenewTicks: 600, leaveGraceMs: 400, resyncRetryMs: 500,
      },
      transport: { maxReceiveBytes: 1048576, handshakeTimeoutMs: 10000, pingEveryMs: 1000 },
    });
    expect(netSettings(config)).toEqual(n);
    // As TimelineSettings' comment on tickMs says: divide by it, and a second
    // isn't quite 60 ticks; multiply by its reciprocal, and it is.
    expect(1000 / n.timeline.clock.tickMs).toBeLessThan(60);
    expect(1000 * (1 / n.timeline.clock.tickMs)).toBe(60);
  });

  it('reads exactly its settings, every M3 setting among them, from the configuration it is given', () => {
    const base = settingsOf(config);
    const read = settingPaths(config).filter((k) => !isDeepStrictEqual(settingsOf(withValue(config, k, changed(valueAt(config, k)))), base));
    expect(read.sort()).toEqual([
      ...M3_KEYS,
      'ticksPerSecond', 'inputDelayTicks', 'lateWindowTicks', 'voteWindowTicks', 'stateHistoryTicks', 'inputHistoryTicks',
      'spreadMaxStepsPerTick', 'timerStallSeconds', 'spectatorsMax', 'meshPlayersMax', 'duplicateIdSilentSeconds',
      'abandonedSeconds', 'connectionFailureSeconds', 'handshakeTimeoutSeconds', 'maxReceiveBytes',
    ].sort());
    // And each M3 setting is the configuration's (design §10).
    for (const key of M3_KEYS) expect(settingPaths(config), key).toContain(key);
  });

  it('converts each time into its unit from the configuration given, not the default', () => {
    const n = netSettings(planted({ leaveGraceSeconds: 0.25, pingEverySeconds: 0.5, clockRebalanceSeconds: 2, botReadyRenewSeconds: 5, ticksPerSecond: 120 }));
    expect([n.room.leaveGraceMs, n.transport.pingEveryMs, n.timeline.clock.rebalanceMs, n.room.botReadyRenewTicks]).toEqual([250, 500, 2000, 600]);
    expect([n.tickMs, n.timeline.clock.tickMs]).toEqual([1000 / 120, 1000 / 120]);
    // One setting, read in two places, moves both.
    const r = netSettings(planted({ resyncRetrySeconds: 0.75, handshakeTimeoutSeconds: 4 }));
    expect([r.timeline.resyncRetryMs, r.room.resyncRetryMs, r.room.handshakeTimeoutMs, r.transport.handshakeTimeoutMs]).toEqual([750, 750, 4000, 4000]);
  });

  it("throws on a bot's Ready renewal that isn't a whole number of ticks, as derive() does", () => {
    expect(() => netSettings(planted({ botReadyRenewSeconds: 10.001 }))).toThrow(/^a bot's Ready renewal: 10.001 s is .* ticks, not a whole number$/);
    expect(() => netSettings(planted({ botReadyRenewSeconds: NaN }))).toThrow(/a bot's Ready renewal: NaN s/);
    expect(() => netSettings(planted({ botReadyRenewSeconds: Infinity }))).toThrow(/a bot's Ready renewal: Infinity s/);
    // 10 s at 7 ticks a second is 70 ticks, and 1/6 s at 60 is 10.
    expect(netSettings(planted({ ticksPerSecond: 7 })).room.botReadyRenewTicks).toBe(70);
    expect(netSettings(planted({ botReadyRenewSeconds: 1 / 6 })).room.botReadyRenewTicks).toBe(10);
  });

  it('spans the input store and the vote book with the smallest power of two at least twice history + 2w + d (design §2.12)', () => {
    const span = (over: Partial<Config>): number => netSettings(planted(over)).timeline.inputSpan;
    expect(span({})).toBe(1024); // 2 × (256 + 24 + 2) = 564
    expect(span({ stateHistoryTicks: 230 })).toBe(512); // 2 × 256, exactly a power of two
    expect(span({ stateHistoryTicks: 231 })).toBe(1024);
    expect(span({ stateHistoryTicks: 512 })).toBe(2048);
    expect(span({ lateWindowTicks: 14, inputDelayTicks: 3 })).toBe(1024); // 2 × 287
    expect(span({ lateWindowTicks: 128 })).toBe(2048); // 2 × 514
    expect(() => span({ stateHistoryTicks: Infinity })).toThrow(/^the input span: Infinity ticks/);
    expect(() => span({ stateHistoryTicks: NaN })).toThrow(/^the input span: NaN ticks/);
  });

  it("bounds a clock sample by the ticks the stores' rings hold past their window (design §2.12)", () => {
    const sample = (over: Partial<Config>): number => netSettings(planted(over)).timeline.clock.sampleMaxTicks;
    expect(sample({})).toBe(1024 - (256 + 24 + 2));
    expect(sample({ stateHistoryTicks: 230 })).toBe(512 - 256);
    expect(sample({ lateWindowTicks: 14, inputDelayTicks: 3 })).toBe(1024 - 287);
  });

  it('gives the flood limit as a whole count, where dividing by tickMs falls short of it (design §4.10)', () => {
    const n = netSettings();
    expect(n.room.floodTicksMax).toBe(360);
    expect(n.room.floodTicksPerTick * (n.room.floodMs / n.tickMs)).toBeLessThan(360);
    expect(netSettings(planted({ floodTicksPerTick: 2, floodSeconds: 0.5 })).room.floodTicksMax).toBe(60);
    expect(netSettings(planted({ ticksPerSecond: 120 })).room.floodTicksMax).toBe(720);
    expect(() => netSettings(planted({ floodSeconds: 2.001 }))).toThrow(/^the flood window: 2.001 s is .* ticks, not a whole number$/);
  });

  it('is frozen, so no caller changes the settings another reads', () => {
    const n = netSettings();
    for (const o of [n, n.timeline, n.timeline.clock, n.room, n.transport]) expect(Object.isFrozen(o)).toBe(true);
  });
});

describe('practiceSettings (design §1.13, D-22)', () => {
  it("records every tick's local input in a catch-up, and changes nothing else", () => {
    const n = netSettings();
    const p = practiceSettings(n);
    expect(p.timeline.stallSendTicks).toBe(Infinity);
    expect({ ...p, timeline: { ...p.timeline, stallSendTicks: n.timeline.stallSendTicks } }).toEqual(n);
    // The tick a catch-up sends from, target − stallSendTicks, is before every tick it covers.
    for (const behind of [1, 3, 4, 60, 100000]) expect(behind - p.timeline.stallSendTicks).toBeLessThan(1);
    // Its input is untouched, and both are frozen.
    expect(n.timeline.stallSendTicks).toBe(3);
    for (const o of [p, p.timeline, p.timeline.clock, p.room, p.transport]) expect(Object.isFrozen(o)).toBe(true);
    // And it applies to any settings: a changed copy keeps its changes.
    const q = practiceSettings(netSettings(planted({ lateWindowTicks: 10 })));
    expect([q.timeline.window, q.timeline.stallSendTicks]).toEqual([10, Infinity]);
  });
});
