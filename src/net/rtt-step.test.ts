import { describe, expect, it, vi } from 'vitest';
import { NET, Rig } from './freezes-testing';

// A genuine change of latency is still followed (PLAN D-15; M3's design,
// research/m3/DESIGN.md, §1.6; M3 phase 5a, clock-F1, rtt-clock5a-F1): the
// round trips a freeze held are no samples now, but a link whose one-way
// delay steps from 50 to 150 ms and stays, and back, is followed both ways
// within two pings and a round trip, as the smaller of the last two round
// trips was. Its TICKs' gap at the step, about 117 ms, is no silence.
// Measured: 1.3 to 2.3 s up, 0.2 to 1.2 s down, at these seeds. Each page's
// estimate lags for those seconds, and both clocks may half-jump at each
// step, as they did before (M3 phase 5a's report). At 2 a side a page jumps
// by its whole median, and a step from 30 to 250 ms jumps the clocks back
// by up to 20 ticks, each page's TICKs then pausing past d + w ticks until
// its clock catches up: a silence its clock explains, ending in its next
// tick, whose round trips are taken, so the estimates follow as fast.

vi.setConfig({ testTimeout: 120_000 });

const LOW = 50; // not a setting: the link's one-way delay, ms
const HIGH = 150; // not a setting: after the step
const HOLD_MS = 20_000; // not a setting: the step's length
/** Two pings and the slower round trip, with the timer's granularity on top. */
const followMs = (high: number): number => 2 * NET.transport.pingEveryMs + 2 * high + 4 * NET.timerMs;
const FOLLOW_MS = followMs(HIGH);

describe('a step in latency is followed (clock-F1)', () => {
  it('from 50 to 150 ms one way and back, within two pings and a round trip, at both ends', () => {
    for (const seed of [1, 4, 6]) {
      const X = 12_000 + seed * 37;
      const Y = X + HOLD_MS;
      const rig = new Rig({ seed, packSize: 1, latency: (_a, _b, now) => ({ base: now >= X && now < Y ? HIGH : LOW, jitter: 0 }) });
      const oneWay = (k: number): number | null =>
        (rig.nodes[k]!.session as unknown as { peers: Map<string, { oneWayMs: number | null }> }).peers.get(`n${1 - k}`)?.oneWayMs ?? null;
      const up = [-1, -1];
      const down = [-1, -1];
      const look = (): void => {
        for (const k of [0, 1]) {
          const v = oneWay(k) ?? 0;
          if (rig.net.now < Y && up[k]! < 0 && v >= HIGH) up[k] = rig.net.now - X;
          if (rig.net.now >= Y && down[k]! < 0 && v <= LOW) down[k] = rig.net.now - Y;
        }
        rig.net.at(rig.net.now + 5, look);
      };
      rig.runTo(X);
      expect([oneWay(0), oneWay(1)], `seed ${seed}`).toEqual([LOW, LOW]);
      look();
      rig.runTo(Y + 2 * FOLLOW_MS);
      const label = `seed ${seed}: up ${up}, down ${down}`;
      for (const k of [0, 1]) {
        expect(up[k], label).toBeGreaterThan(0);
        expect(up[k], label).toBeLessThanOrEqual(FOLLOW_MS);
        expect(down[k], label).toBeGreaterThanOrEqual(0);
        expect(down[k], label).toBeLessThanOrEqual(FOLLOW_MS);
      }
      rig.expectClean(label);
    }
  });
});

describe('a step in latency at 2 a side is followed (rtt-clock5a-F1)', () => {
  it('from 30 to 250 ms one way and back, within two pings and a round trip, at every page for every peer', () => {
    const [low, high] = [30, 250]; // not a setting: the step, in ms one way
    const follow = followMs(high);
    for (const seed of [1, 2, 7]) {
      const X = 12_000 + seed * 37;
      const Y = X + HOLD_MS;
      const rig = new Rig({ seed, packSize: 2, latency: (_a, _b, now) => ({ base: now >= X && now < Y ? high : low, jitter: 0 }) });
      const n = rig.nodes.length;
      const oneWay = (k: number, j: number): number | null =>
        (rig.nodes[k]!.session as unknown as { peers: Map<string, { oneWayMs: number | null }> }).peers.get(`n${j}`)?.oneWayMs ?? null;
      const up = new Map<string, number>();
      const down = new Map<string, number>();
      const look = (): void => {
        for (let k = 0; k < n; k++) {
          for (let j = 0; j < n; j++) {
            if (j === k) continue;
            const v = oneWay(k, j) ?? 0;
            const key = `${k}>${j}`;
            if (rig.net.now < Y && !up.has(key) && v >= high) up.set(key, rig.net.now - X);
            if (rig.net.now >= Y && !down.has(key) && v <= low) down.set(key, rig.net.now - Y);
          }
        }
        rig.net.at(rig.net.now + 5, look);
      };
      rig.runTo(X);
      look();
      rig.runTo(Y + 2 * follow);
      const late: string[] = [];
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < n; j++) {
          if (j === k) continue;
          const key = `${k}>${j}`;
          if (!((up.get(key) ?? Infinity) <= follow)) late.push(`${key} up ${up.get(key)}`);
          if (!((down.get(key) ?? Infinity) <= follow)) late.push(`${key} down ${down.get(key)}`);
        }
      }
      const label = `seed ${seed}: ${late.join(', ')}`;
      expect(late, label).toEqual([]);
      // 250 ms one way is past the late window's reach, and the pages repair as they can; once the
      // step's ticks have left the final history, they hold one hash again.
      rig.runTo(rig.net.now + 6000);
      rig.expectClean(label);
    }
  });
});
