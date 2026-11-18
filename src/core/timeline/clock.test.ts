import { describe, expect, it } from 'vitest';
import { type ClockConfig, PHASE_CAP, TickClock } from './clock';

// D-15's tick clock (design §1.6, §2.13, §4.12, §8.3): its samples, the cap
// phase ignored, the median, the jump, the rate and its limits, the
// rebalance period, pause, resume and set, each setting from configuration,
// all in virtual time.

/** Design §10's values: roslambo's D-11 as amended at its M0. */
const M3: ClockConfig = {
  tickMs: 1000 / 60,
  delay: 2,
  window: 12,
  settleMs: 2000,
  smoothing: 0.1,
  gainPerTick: 0.005,
  rateMax: 0.02,
  deadbandTicks: 1,
  rebalanceMs: 1000,
  sampleMaxTicks: 742, // netSettings': 1024 − (256 + 24 + 2)
};

/** The TICK fields a peer sends when its clock reads `reading` (design §2.4): t = n + d and the phase. */
function tickFor(reading: number, cfg: ClockConfig = M3): { t: number; phase: number } {
  const n = Math.floor(reading);
  return { t: n + cfg.delay, phase: reading - n };
}

/** A sample from a peer whose clock is `offset` ticks ahead of c's at now, its TICK sent oneWayMs ago. */
function sampleAhead(c: TickClock, peer: string, offset: number, now: number, oneWayMs = 0, cfg: ClockConfig = M3): boolean {
  const { t, phase } = tickFor(c.read(now) + offset - oneWayMs / cfg.tickMs, cfg);
  return c.sample(peer, t, phase, oneWayMs, now);
}

/** A clock at 0 when now is 0, with these peers' offsets settled by `at`. */
function withPeers(offsets: readonly number[], at = M3.settleMs, cfg: ClockConfig = M3): TickClock {
  const c = new TickClock(cfg);
  c.set(0, 0);
  offsets.forEach((o, k) => sampleAhead(c, `p${k}`, o, 0, 0, cfg));
  expect(c.read(at)).toBeCloseTo(at / cfg.tickMs, 9);
  return c;
}

describe('the reading (D-15)', () => {
  it('counts ticks at the base rate from where it was set', () => {
    const c = new TickClock(M3);
    c.set(1000, 5);
    expect(c.read(1000)).toBe(5);
    expect(c.read(2000)).toBeCloseTo(65, 9);
    expect(c.read(1050)).toBeCloseTo(8, 9);
    expect(Math.floor(c.read(1000 + 50 * 1000))).toBe(5 + 3000); // 60 a second, a tick boundary exact
    c.set(3000, 2.5);
    expect([c.read(3000), c.stats.rateAdj]).toEqual([2.5, 0]);
  });

  it('pauses frozen and resumes where it stopped, so nothing is caught up across a pause (D-22)', () => {
    const c = new TickClock(M3);
    c.set(0, 0);
    c.pause(500);
    expect([c.paused, c.read(500), c.read(60_000)]).toEqual([true, 30, 30]);
    c.pause(9000); // already paused: no change
    expect(c.read(9000)).toBe(30);
    c.resume(10_000);
    expect(c.paused).toBe(false);
    expect(c.read(10_000)).toBe(30);
    expect(c.read(11_000)).toBeCloseTo(90, 9);
    c.resume(12_000); // not paused: no change
    expect(c.read(12_000)).toBeCloseTo(150, 9);
  });

  it('is set while paused to read the new tick until resumed, as §4.12’s re-anchor does', () => {
    const c = new TickClock(M3);
    c.set(0, 0);
    c.pause(1000);
    c.set(5000, 40);
    expect([c.paused, c.read(5000), c.read(7000)]).toEqual([true, 40, 40]);
    c.resume(8000);
    expect(c.read(9000)).toBeCloseTo(100, 9);
  });

  it('keeps the rate it had through a pause, and set returns it to the base rate', () => {
    const c = withPeers([3]);
    expect(c.rebalance(2000)).toBe('rate');
    expect(c.stats.rateAdj).toBeCloseTo(0.015, 12);
    const at = c.read(2000);
    c.pause(2000);
    c.resume(5000);
    expect(c.read(6000) - at).toBeCloseTo(60 * 1.015, 9);
    c.set(6000, 100);
    expect([c.stats.rateAdj, c.read(7000)]).toEqual([0, expect.closeTo(160, 9)]);
  });
});

describe('the samples (roslambo D-11, M0 and 2026-10-25)', () => {
  it('reads the sender’s t − d + phase, plus the one-way delay, against mine', () => {
    const c = new TickClock(M3);
    c.set(0, 10);
    // At now 0 mine reads 10; the sender's t − d + phase is 12 − 2 + 0.25, and 50 ms is 3 ticks.
    expect(c.sample('p', 12, 0.25, 50, 0)).toBe(true);
    expect(c.rebalance(M3.settleMs)).toBe('rate');
    expect(c.stats.medianOffset).toBeCloseTo(3.25, 12);
  });

  it('smooths each peer’s offset by the configured weight of each sample', () => {
    const c = new TickClock(M3);
    c.set(0, 0);
    sampleAhead(c, 'p', 3, 0);
    sampleAhead(c, 'p', 13, 0);
    sampleAhead(c, 'p', 13, 0);
    c.rebalance(M3.settleMs);
    expect(c.stats.medianOffset).toBeCloseTo(3 + 0.1 * 10 + 0.1 * 9, 12); // 4, then 4.9
  });

  it('takes no sample from a phase at its cap, sent catching up after the sender’s timers slept', () => {
    const c = new TickClock(M3);
    c.set(0, 0);
    for (const phase of [65535 / 65536, 65534 / 65536, 0.99998, PHASE_CAP, 1, Number.NaN]) expect(c.sample('p', 2, phase, 0, 0)).toBe(false);
    for (const oneWayMs of [Number.NaN, Infinity]) expect(c.sample('p', 2, 0.5, oneWayMs, 0)).toBe(false);
    c.heard('p', 0);
    expect(c.rebalance(M3.settleMs)).toBeNull(); // heard, but never sampled
    expect(c.sample('p', 2, 0.9998, 0, 0)).toBe(true);
    expect(c.sample('p', 2, 0, 0, 0)).toBe(true);
  });

  it('takes no sample further off than the stores’ rings reach, so one forged TICK can’t run the clock past a u32', () => {
    const c = new TickClock(M3);
    c.set(0, 1000);
    // A TICK for the wire's last tick but one: never a sample, nor a heard peer.
    expect(c.sample('forger', 0xfffffffe, 0.5, 0, 0)).toBe(false);
    expect(c.sample('forger', 0, 0.5, 0, 0)).toBe(false);
    expect(c.rebalance(M3.settleMs)).toBeNull();
    expect(c.read(M3.settleMs)).toBeCloseTo(1000 + M3.settleMs / M3.tickMs, 9);
    // At the bound either way, a sample; a tick past it, none.
    const at = (offset: number): boolean => sampleAhead(new TickClock(M3), 'p', offset, 0);
    expect([at(742), at(-742), at(742.5), at(-743)]).toEqual([true, true, false, false]);
    // With one honest peer in step beside it, the median would have jumped half the forger's offset.
    const d = withPeers([0]);
    sampleAhead(d, 'forger', 4e9, 0);
    expect([d.rebalance(2000), d.stats.jumps]).toEqual(['rate', 0]);
  });

  it('takes no sample while paused, against a reading that doesn’t move', () => {
    const c = new TickClock(M3);
    c.set(0, 0);
    c.pause(0);
    expect(c.sample('p', 900, 0.5, 0, 3000)).toBe(false);
    c.resume(3000);
    c.heard('p', 0);
    expect(c.rebalance(5000)).toBeNull();
  });

  it('keeps the clock from being dragged by a woken sender’s burst (roslambo 2026-10-25)', () => {
    // In step with mine, the sender sleeps 1 s at a time and then sends its
    // last three ticks at once: the older two capped, the newest true.
    const c = new TickClock(M3);
    c.set(0, 0);
    for (let wake = 1000; wake <= 10_000; wake += 1000) {
      const reading = c.read(wake);
      const n = Math.floor(reading);
      c.sample('p', n - 2 + M3.delay, Math.min(PHASE_CAP + 0.00009, reading - (n - 2)), 0, wake);
      c.sample('p', n - 1 + M3.delay, Math.min(PHASE_CAP + 0.00009, reading - (n - 1)), 0, wake);
      c.sample('p', n + M3.delay, reading - n, 0, wake);
      c.rebalance(wake);
    }
    expect(c.stats.medianOffset).toBeCloseTo(0, 9);
    expect([c.stats.rateAdj, c.stats.jumps]).toEqual([0, 0]);
  });
});

describe('the rebalance (roslambo D-11, M0)', () => {
  it('counts a peer’s offset once it has been heard for settleMs', () => {
    expect(withPeers([3]).rebalance(M3.settleMs - 1)).toBeNull();
    expect(withPeers([3]).rebalance(M3.settleMs)).toBe('rate');
    // Heard first well before its first sample: it counts from then.
    const c = new TickClock(M3);
    c.set(0, 0);
    c.heard('p', -5000);
    sampleAhead(c, 'p', 3, 0);
    expect(c.rebalance(0)).toBe('rate');
    expect(c.stats.medianOffset).toBeCloseTo(3, 9);
  });

  it('takes the true median of the settled peers, and ignores those still settling', () => {
    const odd = withPeers([5, 1.5, 2]);
    sampleAhead(odd, 'late', -4, 1500); // heard at 1.5 s: not settled at 2 s
    odd.rebalance(2000);
    expect([odd.stats.medianOffset, odd.stats.rateAdj]).toEqual([expect.closeTo(2, 9), expect.closeTo(0.01, 12)]);
    const even = withPeers([1.5, 5, 2, 4]);
    even.rebalance(2000);
    expect([even.stats.medianOffset, even.stats.rateAdj]).toEqual([expect.closeTo(3, 9), expect.closeTo(0.015, 12)]);
    // Sorted as numbers: as strings, −2 would sort after −1.5 and be the median.
    const signed = withPeers([-1.5, -2, 3]);
    signed.rebalance(2000);
    expect(signed.stats.medianOffset).toBeCloseTo(-1.5, 9);
  });

  it('runs fast or slow in proportion, with a deadband and a limit either way', () => {
    const adj = (offset: number): number => {
      const c = withPeers([offset]);
      expect(c.rebalance(2000)).toBe('rate');
      return c.stats.rateAdj;
    };
    expect([adj(1), adj(-1), adj(0.4)]).toEqual([0, 0, 0]);
    expect(adj(1.5)).toBeCloseTo(0.0075, 12);
    expect(adj(-2)).toBeCloseTo(-0.01, 12);
    expect([adj(5), adj(-5), adj(6)]).toEqual([0.02, -0.02, 0.02]);
  });

  it('changes the rate without moving the reading', () => {
    const c = withPeers([2]);
    const at = c.read(2000);
    c.rebalance(2000);
    expect(c.read(2000)).toBe(at);
    expect(c.read(3000) - at).toBeCloseTo(60 * 1.01, 9);
  });

  it('jumps past the late window’s middle, either way, and the offsets jump with it', () => {
    for (const offset of [6.5, -7]) {
      const c = withPeers([offset]);
      const at = c.read(2000);
      expect(c.rebalance(2000)).toBe('jump');
      expect(c.read(2000)).toBeCloseTo(at + offset, 9);
      expect([c.stats.jumps, c.stats.rateAdj]).toEqual([1, 0]);
      expect(c.read(3000) - c.read(2000)).toBeCloseTo(60, 9); // at the base rate
      // The peer's offset moved with the jump: in step now.
      expect(c.rebalance(3000)).toBe('rate');
      expect([c.stats.medianOffset, c.stats.rateAdj]).toEqual([expect.closeTo(0, 9), 0]);
    }
    // At the middle itself, a rate.
    expect(withPeers([6]).rebalance(2000)).toBe('rate');
  });

  it('jumps back to the base rate from a rate it had set', () => {
    const c = withPeers([3]);
    expect(c.rebalance(2000)).toBe('rate');
    expect(c.stats.rateAdj).toBeCloseTo(0.015, 12);
    // Then a sample 60 ticks ahead smooths the peer's offset to 3 + 0.1 × 57 = 8.7, past the
    // middle: a jump, at the base rate after it.
    sampleAhead(c, 'p0', 60, 2500);
    expect(c.rebalance(3000)).toBe('jump');
    expect(c.stats.medianOffset).toBeCloseTo(8.7, 9);
    expect([c.stats.jumps, c.stats.rateAdj]).toEqual([1, 0]);
    expect(c.read(4000) - c.read(3000)).toBeCloseTo(60, 9);
  });

  it('takes the median once every rebalanceMs, and not while paused', () => {
    const c = withPeers([2]);
    expect([c.rebalance(2000), c.rebalance(2999), c.rebalance(3000), c.rebalance(3500)]).toEqual(['rate', null, 'rate', null]);
    c.pause(3600);
    expect(c.rebalance(9000)).toBeNull();
    c.resume(9000);
    expect(c.rebalance(9000)).toBe('rate');
    // With no settled peer, the period still runs.
    const lone = new TickClock(M3);
    expect([lone.rebalance(0), lone.rebalance(500)]).toEqual([null, null]);
  });

  it('forgets a peer that left, which settles again if it comes back, from its new offset', () => {
    const c = withPeers([3]);
    c.forget('p0');
    expect(c.rebalance(2000)).toBeNull();
    // Back 3 ticks behind: smoothed from its old +3, it would read 3 + 0.1 × (−6) = 2.4.
    sampleAhead(c, 'p0', -3, 2500);
    expect(c.rebalance(4499)).toBeNull();
    expect(c.rebalance(5500)).toBe('rate');
    expect(c.stats.medianOffset).toBeCloseTo(-3, 9);
  });

  it('takes every gain, limit and period from its configuration', () => {
    const cfg: ClockConfig = { tickMs: 10, delay: 3, window: 20, settleMs: 500, smoothing: 0.5, gainPerTick: 0.01, rateMax: 0.05, deadbandTicks: 2, rebalanceMs: 250, sampleMaxTicks: 30 };
    const c = new TickClock(cfg);
    c.set(0, 0);
    expect(c.read(1000)).toBeCloseTo(100, 9); // tickMs
    // t − delay + phase, and 20 ms of one-way delay is 2 ticks.
    c.sample('p', 8, 0.5, 20, 0);
    c.sample('p', 10, 0.5, 20, 0); // smoothing 0.5: 7.5, then 8.5
    expect(c.rebalance(499)).toBeNull(); // settleMs
    expect(c.rebalance(748)).toBeNull(); // rebalanceMs from 499
    expect(c.rebalance(749)).toBe('rate');
    expect([c.stats.medianOffset, c.stats.rateAdj]).toEqual([expect.closeTo(8.5, 9), 0.05]); // rateMax
    const adj = (offset: number): number => {
      const d = withPeers([offset], 500, cfg);
      expect(d.rebalance(500)).toBe('rate');
      return d.stats.rateAdj;
    };
    expect([adj(2), adj(-2)]).toEqual([0, 0]); // deadbandTicks
    expect(adj(3)).toBeCloseTo(0.03, 12); // gainPerTick
    expect(withPeers([9.9], 500, cfg).rebalance(500)).toBe('rate');
    expect(withPeers([10.1], 500, cfg).rebalance(500)).toBe('jump'); // window / 2
    expect([sampleAhead(new TickClock(cfg), 'p', 30, 0, 0, cfg), sampleAhead(new TickClock(cfg), 'p', 31, 0, 0, cfg)]).toEqual([true, false]); // sampleMaxTicks
  });
});

describe('against a peer’s clock, in virtual time', () => {
  /** Runs c beside a peer clock `ahead` ticks ahead at the base rate, the peer sending a TICK on each
   *  of its ticks that reaches c after oneWayMs, c's timer every 4 ms, for `ms`. Returns the peer's
   *  lead over c at the end. */
  function run(ahead: number, ms: number, oneWayMs = 0): { c: TickClock; lead: number } {
    const c = new TickClock(M3);
    c.set(0, 0);
    const peer = (now: number): number => ahead + now / M3.tickMs;
    let sent = Math.floor(peer(0));
    const inFlight: { at: number; t: number; phase: number }[] = [];
    for (let now = 0; now <= ms; now += 4) {
      // The peer's timer runs every 4 ms too: a TICK for each tick it passes, the newest with its phase.
      const n = Math.floor(peer(now));
      for (let k = sent + 1; k <= n; k++) inFlight.push({ at: now + oneWayMs, t: k + M3.delay, phase: Math.min(PHASE_CAP + 0.00009, peer(now) - k) });
      sent = n;
      while (inFlight.length > 0 && inFlight[0]!.at <= now) {
        const m = inFlight.shift()!;
        c.heard('peer', now);
        c.sample('peer', m.t, m.phase, oneWayMs, now);
      }
      c.rebalance(now);
    }
    return { c, lead: peer(ms) - c.read(ms) };
  }

  it('catches up a peer ahead, and falls back to one behind, within the deadband and without a jump', () => {
    for (const ahead of [3, -3, 5.5]) {
      const { c, lead } = run(ahead, 30_000, 40);
      expect(c.stats.jumps).toBe(0);
      expect(Math.abs(lead)).toBeLessThanOrEqual(M3.deadbandTicks + 0.1);
      expect(Math.sign(lead)).toBe(Math.sign(ahead)); // proportional: it never overshoots
      expect(c.stats.rateAdj).toBe(0);
    }
  });

  it('jumps once to a peer past the late window’s middle, then stays in step', () => {
    const { c, lead } = run(9, 10_000, 40);
    expect(c.stats.jumps).toBe(1);
    expect(Math.abs(lead)).toBeLessThanOrEqual(M3.deadbandTicks + 0.1);
  });
});
