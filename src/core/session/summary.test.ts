import { describe, expect, it, vi } from 'vitest';
import { botId, personId } from '../bot/bot-id';
import {
  cloneState, defaultParams, genesis, HALF_TURN, JOIN, type MatchState, newTerrier, type Pack, QUARTER_TURN, READY, TURN,
} from '../sim';
import { chasey } from '../sim/scenes';
import { at, expectAgreement, inside, Pump, type PumpNode, senderInput, tickOf } from '../timeline/testing';
import { type Correction, Timeline, type TimelineStats } from '../timeline/timeline';
import { netSettings } from './settings';
import { correctionSizes, LogBins, type Quantiles, SummaryBuilder } from './summary';

// The match summary (design §1.16, §9.3, §9.4, M3-Q24): a correction's
// sizes as the measurement defines them; p50, p95 and max from fixed
// log-spaced bins, each within a bin's width of the exact nearest rank, the
// zeros apart and the maximum exact; a repair's corrections kept out of the
// figures and reported apart, a count and their sizes; the timeline's
// counts, the inputs received counted as late counts them (M3 phase 4's
// fixes, reviewer SUM-1); memory that doesn't grow; and the corrections a
// pumped match fires, a repair's among them, summarised live as they come.

// A pumped match in virtual time: CPU-bound, as the network suites are.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const NET = netSettings();
/** Half a bin's width: 20 bins a decade, each percentile its bin's geometric middle, so within this
 *  factor of the exact one (with a rounding's margin). */
const HALF_BIN = 10 ** (1 / 40) * (1 + 1e-12);
const ME = personId(4, 0);
const [R1, R2, R3] = [personId(4, 1), personId(4, 2), personId(4, 3)];

function state(ids: readonly string[]): MatchState {
  const s = genesis({ packSize: 2, matchMinutes: 1 }, P);
  ids.forEach((id, k) => s.terriers.push(newTerrier(id, '', (k % 2) as Pack, k, 1, P)));
  return s;
}

const correction = (before: MatchState, after: MatchState, repair = false): Correction => ({ tick: 400, from: 395, before, after, repair });

/** A correction whose only change is the ball, moved by d along x. */
function ballMoved(d: number, repair = false): Correction {
  const before = state([ME, R1]);
  const after = cloneState(before);
  after.ball.x += d;
  return correction(before, after, repair);
}

/** The exact pct-th percentile of the positive values, by nearest rank. */
function exact(values: readonly number[], pct: number): number {
  const moved = values.filter((v) => v > 0).sort((a, b) => a - b);
  return moved[Math.max(1, Math.ceil((moved.length * pct) / 100)) - 1] ?? 0;
}

/** q's figures against the exact ones from the samples: counts and the maximum exactly, p50 and p95
 *  within half a bin's width. */
function expectNear(q: Quantiles, samples: readonly number[]): void {
  expect([q.count, q.zero, q.max]).toEqual([samples.length, samples.filter((v) => v === 0).length, Math.max(0, ...samples)]);
  for (const [got, pct] of [[q.p50, 50], [q.p95, 95]] as const) {
    const want = exact(samples, pct);
    if (want === 0) expect(got).toBe(0);
    else {
      expect(got / want, `p${pct}`).toBeLessThanOrEqual(HALF_BIN);
      expect(want / got, `p${pct}`).toBeLessThanOrEqual(HALF_BIN);
    }
  }
}

describe("a correction's sizes (design §9.3)", () => {
  it('measures the ball in 3D and flat, each terrier in metres and degrees the shorter way round, its own apart', () => {
    const before = state([ME, R1, R2]);
    const [me, r1] = before.terriers as [MatchState['terriers'][number], MatchState['terriers'][number]];
    me.heading = TURN - 2 ** 27; // 11.25° below the axis
    r1.heading = 1000;
    const after = cloneState(before);
    after.ball.x += 3;
    after.ball.y += 4;
    after.ball.z += 12;
    const [me2, r12, r22] = after.terriers as [typeof me, typeof me, typeof me];
    me2.y += 0.6;
    me2.z += 0.8;
    me2.heading = 2 ** 27; // through the axis: 22.5°, not 337.5°
    r12.x -= 0.3;
    r12.y += 0.4;
    r12.heading = (r1.heading + HALF_TURN) >>> 0;
    r22.heading = (r22.heading - QUARTER_TURN) >>> 0;
    const s = correctionSizes(correction(before, after), ME);
    expect([s.ball, s.ballFlat]).toEqual([13, 5]);
    expect(s.own!.metres).toBeCloseTo(1, 12);
    expect(s.own!.degrees).toBe(22.5);
    expect(s.remote.length).toBe(2);
    expect(s.remote[0]!.metres).toBeCloseTo(0.5, 12);
    expect(s.remote.map((r) => r.degrees)).toEqual([180, 90]);
    // Nothing moved: zeros, exactly.
    const still = correctionSizes(correction(before, cloneState(before)), ME);
    expect(still).toEqual({ ball: 0, ballFlat: 0, remote: [{ metres: 0, degrees: 0 }, { metres: 0, degrees: 0 }], own: { metres: 0, degrees: 0 } });
  });

  it("counts a bot this browser hosts as remote: own is its player's terrier alone", () => {
    const bot = botId(ME, 0);
    const before = state([ME, bot]);
    const after = cloneState(before);
    for (const T of after.terriers) T.x += T.id === bot ? 2 : 0.5;
    const s = correctionSizes(correction(before, after), ME);
    expect(s.own!.metres).toBeCloseTo(0.5, 12);
    expect(s.remote.map((r) => r.metres)).toEqual([2]);
  });

  it('has no size for a terrier in one state only, and no own for a browser without a terrier', () => {
    const before = state([ME, R1, R2]);
    const after = state([R1, R3]);
    const s = correctionSizes(correction(before, after), ME);
    expect([s.own, s.remote.length]).toEqual([null, 1]);
    expect(correctionSizes(correction(before, before), personId(4, 9)).own).toBe(null);
  });
});

describe('the bins (M3-Q24)', () => {
  it('give each percentile within a bin of the exact nearest rank, the zeros apart and the maximum exact', () => {
    const samples: number[] = [];
    // Log-uniform from 1 mm to 100 m, out of order, and a run of zeros.
    for (let i = 0; i < 10_000; i++) samples.push(10 ** (-3 + (5 * ((i * 7919) % 10_000)) / 9999));
    for (let i = 0; i < 700; i++) samples.push(0);
    const bins = new LogBins();
    for (const v of samples) bins.add(v);
    expectNear(bins.quantiles(), samples);
    // Skewed, as corrections are: most tiny, a few large.
    const skewed = Array.from({ length: 3000 }, (_, i) => (i % 50 === 0 ? 4 + i / 1000 : 0.002 * (1 + (i % 17))));
    const b2 = new LogBins();
    for (const v of skewed) b2.add(v);
    expectNear(b2.quantiles(), skewed);
  });

  it('keep a percentile inside the smallest and largest samples, and ignore what is not a size', () => {
    const one = new LogBins();
    one.add(0.123);
    expect(one.quantiles()).toEqual({ count: 1, zero: 0, p50: 0.123, p95: 0.123, max: 0.123 });
    // Below the bins' range, all in its open bin, and above it.
    const tiny = new LogBins();
    for (const v of [1e-9, 2e-9, 3e-9]) tiny.add(v);
    const t = tiny.quantiles();
    expect([t.count, t.max, t.p95]).toEqual([3, 3e-9, 3e-9]);
    expect(t.p50).toBeGreaterThanOrEqual(1e-9);
    expect(t.p50).toBeLessThanOrEqual(3e-9);
    const huge = new LogBins();
    huge.add(5e4);
    expect(huge.quantiles()).toMatchObject({ p50: 5e4, max: 5e4 });
    const none = new LogBins();
    for (const v of [Number.NaN, -1, -Infinity]) none.add(v);
    expect(none.quantiles()).toEqual({ count: 0, zero: 0, p50: 0, p95: 0, max: 0 });
    none.add(0);
    expect(none.quantiles()).toEqual({ count: 1, zero: 1, p50: 0, p95: 0, max: 0 });
  });
});

/** What an object holds, however deep: each object's own keys, each array's and typed array's
 *  length, each Map's and Set's size and entries. Whatever kept a sample, in any container, changes
 *  it (reviewer SUM-2). */
function shape(x: unknown, seen = new Set<unknown>()): string[] {
  if (typeof x !== 'object' || x === null || seen.has(x)) return [];
  seen.add(x);
  if (ArrayBuffer.isView(x)) return [`view ${(x as unknown as { length: number }).length}`];
  if (x instanceof Map) return [`map ${x.size}`, ...[...x].flatMap(([k, v]) => [...shape(k, seen), ...shape(v, seen)])];
  if (x instanceof Set) return [`set ${x.size}`, ...[...x].flatMap((v) => shape(v, seen))];
  const own = Array.isArray(x) ? [`array ${x.length}`] : [`keys ${Object.keys(x).sort().join(',')}`];
  return [...own, ...Object.values(x).flatMap((v) => shape(v, seen))];
}

const STATS: TimelineStats = {
  sent: 900, received: 2700, receivedInputs: 3400, late: 6, lateBy: [3, 2, 0, 1], lateAbsent: 2, agree: 800, disagree: 1, split: 0, resyncs: 1, resyncMs: [180],
  resyncFailed: 1, lateVoteFlips: 0, statesSent: 0, statesTruncated: 0, statesRefused: 0, steps: 4000, maxStepsPerAdvance: 13,
  spreadTicks: 0, holds: 0, reusedFinals: 700, steppedFinals: 190, rollbacks: 120, corrections: 95, verifyMismatches: 0, jumps: 0,
  rateAdj: 0, medianOffset: 0, clockSamples: 0, clockSamplesDropped: 0, warmMs: 0, joinedAt: 0, log: [],
};

describe('the summary builder (design §1.16)', () => {
  it("keeps a repair's corrections out of the figures and reports them apart, its own terrier apart, and copies the timeline's counts", () => {
    const b = new SummaryBuilder(ME);
    for (const d of [0, 0.5, 2]) b.add(ballMoved(d));
    b.add(ballMoved(10, true));
    b.add(ballMoved(0.25, true));
    const s = b.summary(STATS);
    expect(s.ball).toEqual({ count: 3, zero: 1, p50: 0.5, p95: 2, max: 2 });
    expect(s.remote).toEqual({ count: 3, zero: 3, p50: 0, p95: 0, max: 0 });
    expect(s.headings).toEqual(s.remote);
    expect(s.own).toEqual({ count: 3, zero: 3, p50: 0, p95: 0, max: 0 });
    // The repair's, apart: how many, and their sizes (SUM-1).
    const still = { count: 2, zero: 2, p50: 0, p95: 0, max: 0 };
    expect(s.repair).toEqual({ count: 2, ball: { count: 2, zero: 0, p50: 0.25, p95: 10, max: 10 }, remote: still, own: still, headings: still });
    expect(s).toMatchObject({
      ticks: 890, remoteInputs: 3400, late: 6, lateAbsent: 2, lateBy: [3, 2, 0, 1], rollbacks: 120, corrections: 95, resyncs: 1, resyncFailed: 1,
    });
    // A copy of the bins, not the timeline's array.
    STATS.lateBy[0] = 99;
    expect(s.lateBy[0]).toBe(3);
    STATS.lateBy[0] = 3;
    // A spectator's: no own terrier.
    const watching = new SummaryBuilder(personId(4, 9));
    watching.add(ballMoved(1));
    expect(watching.summary(STATS).own.count).toBe(0);
    expect(watching.summary(STATS).remote.count).toBe(2);
    // None repaired: a count of 0, and no sizes.
    const none = { count: 0, zero: 0, p50: 0, p95: 0, max: 0 };
    expect(watching.summary(STATS).repair).toEqual({ count: 0, ball: none, remote: none, own: none, headings: none });
  });

  it("counts the inputs received as late counts them: each TICK's own and each bot entry a started timeline takes (SUM-1)", () => {
    const t = new Timeline({ ...NET.timeline, P, me: ME }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    const mine = botId(ME, 0);
    const entry = (id: string, u: number, v: number) => ({ id, ...senderInput(new Map([[u, v]]), u) });
    // Before the start: a TICK received, no input taken.
    t.onTick(R1, tickOf(new Map([[8, 5]]), 8), at(5), true);
    expect([t.stats.received, t.stats.receivedInputs]).toEqual([1, 0]);
    t.start(0, { packSize: 2, matchMinutes: 1 }, '5a5a5a5a5a5a5a5a');
    t.bots.set(mine, () => 0);
    t.advance(at(5));
    // Never this browser's or its bot's.
    t.onTick(ME, tickOf(new Map([[8, 5]]), 8), at(5), true);
    t.onTick(mine, tickOf(new Map([[8, 5]]), 8), at(5), true);
    expect([t.stats.received, t.stats.receivedInputs]).toEqual([1, 0]);
    // R1's own and its bot's, forwarded; not another host's bot in it, nor this browser's.
    const m = tickOf(new Map([[8, 5]]), 8);
    m.bots.push(entry(botId(R1, 1), 8, 6), entry(botId(R2, 0), 8, 7), entry(mine, 8, 8));
    t.onTick(R1, m, at(5), false);
    // A host's TICK with no input of its own: its bot's alone.
    t.onTick(R2, { ...tickOf(new Map(), 8), own: null, bots: [entry(botId(R2, 0), 8, 7)] }, at(5), true);
    expect([t.stats.received, t.stats.receivedInputs]).toEqual([3, 3]);
    // Late ones count in both: R3's own and its bot's for tick 20, the late boundary at 40 − w.
    t.advance(at(40));
    const late = tickOf(new Map([[20, 1]]), 20);
    late.bots.push(entry(botId(R3, 0), 20, 2));
    t.onTick(R3, late, at(40), true);
    const s = new SummaryBuilder(ME).summary(t.stats);
    expect([t.stats.received, s.remoteInputs, s.late]).toEqual([4, 5, 2]);
  });

  it('keeps no list: its memory is the same after a hundred corrections or a hundred thousand', () => {
    const b = new SummaryBuilder(ME);
    for (let i = 0; i < 100; i++) b.add(ballMoved(i / 7));
    const small = shape(b);
    for (let i = 0; i < 100_000; i++) b.add(ballMoved((i % 991) / 13));
    expect(shape(b)).toEqual(small);
    expect(b.summary(STATS).ball.count).toBe(100_100);
    // The check sees samples kept in a Map, a Set or an object's keys, as well as in an array.
    const keeping = (keep: (v: number, n: number) => void): LogBins =>
      new (class extends LogBins {
        n = 0;
        override add(v: number): void {
          super.add(v);
          keep(v, this.n++);
        }
      })();
    const map = new Map<number, number>();
    const set = new Set<number>();
    const obj: Record<string, number> = {};
    for (const [bins, store] of [
      [keeping((v, n) => map.set(n, v)), map],
      [keeping((v) => set.add(v)), set],
      [keeping((v, n) => (obj[`s${n}`] = v)), obj],
    ] as const) {
      const holder = { bins, store };
      for (let i = 0; i < 100; i++) bins.add(i / 7);
      const before = shape(holder);
      for (let i = 0; i < 100; i++) bins.add((100 + i) / 7);
      expect(shape(holder)).not.toEqual(before);
    }
  });

  it("summarises a pumped match's corrections as they fire, within a bin of the exact figures", () => {
    // Four players at 2 a side over 90 ms links, in play, each running at the ball under the spike's
    // seeded play in ball view (scenes.ts's chasey), so prediction misses and the drawn head, the ball
    // included, is corrected.
    const q = new Pump({ ids: (k) => personId(4, k), corrections: true });
    q.latency = 90;
    const nodes = [0, 1, 2, 3].map((k) => q.add({ verify: k === 0 ? 8 : 0 }));
    const a = nodes[0]!;
    const live = new SummaryBuilder(a.id);
    const play = chasey(3, 'ball');
    const chase = (k: number, t: Timeline) => (): number => play((k % 2) as Pack, k >> 1, t.localTick, t.head) ?? 0;
    for (const n of nodes) {
      n.t.start(0, { packSize: 2, matchMinutes: 1 }, '0f1e2d3c4b5a6978');
      n.t.sending = true;
      n.t.controls = chase(n.k, n.t);
      n.t.queueEvent(n.id, { events: JOIN | READY, joinPack: n.k % 2, coat: n.k, name: `P${n.k}` });
    }
    // Fed live, from the timeline's own objects, beside the watch's copies.
    const was = a.t.onCorrection;
    a.t.onCorrection = (c) => {
      was?.(c);
      live.add(c);
    };
    q.run(15_000);
    expect(q.problems).toEqual([]);
    const fired = a.corrections;
    expect(fired.length).toBe(a.t.stats.corrections);
    expect(fired.length).toBeGreaterThan(20);
    const sizes = fired.filter((c) => !c.repair).map((c) => correctionSizes(c, a.id));
    const s = live.summary(a.t.stats);
    expectNear(s.ball, sizes.map((x) => x.ball));
    expectNear(s.remote, sizes.flatMap((x) => x.remote.map((r) => r.metres)));
    expectNear(s.headings, sizes.flatMap((x) => x.remote.map((r) => r.degrees)));
    expectNear(s.own, sizes.map((x) => x.own!.metres));
    for (const body of [s.ball, s.remote, s.own, s.headings]) expect(body.count - body.zero).toBeGreaterThan(0);
    expect(s.corrections).toBe(fired.length);
    // The same from the copies after the match: the builder kept nothing of the states it was handed.
    const after = new SummaryBuilder(a.id);
    for (const c of fired) after.add(c);
    expect(after.summary(a.t.stats)).toEqual(s);
  });

  it("reports a pumped match's repair apart, as it fires: how many corrections, and their sizes (SUM-1)", () => {
    // Three players over 40 ms links, each running at the ball as above. a's final state is spoiled
    // behind the timeline's back, its ball moved 0.5 m, and its chain recomputed from it, so its head
    // carries the spoil. Its votes lose, it resyncs, and the repair puts its head back: a repair's
    // correction.
    const q = new Pump({ ids: (k) => personId(4, k), corrections: true });
    q.latency = 40;
    const nodes = [0, 1, 2].map((k) => q.add({ verify: k === 0 ? 8 : 0 }));
    const a = nodes[0]!;
    const live = new SummaryBuilder(a.id);
    const play = chasey(3, 'ball');
    const chase = (n: PumpNode) => (): number => play((n.k % 2) as Pack, n.k >> 1, n.t.localTick, n.t.head) ?? 0;
    for (const n of nodes) {
      n.t.start(0, { packSize: 2, matchMinutes: 1 }, '0f1e2d3c4b5a6978');
      n.t.sending = true;
      n.t.controls = chase(n);
      n.t.queueEvent(n.id, { events: JOIN | READY, joinPack: n.k % 2, coat: n.k, name: `P${n.k}` });
    }
    const was = a.t.onCorrection;
    a.t.onCorrection = (c) => {
      was?.(c);
      live.add(c);
    };
    q.run(4000);
    const x = inside(a.t);
    x.F.ball.x += 0.5;
    x.validTo = a.t.finalTick;
    q.run(7000);
    expect(q.problems).toEqual([]);
    expect([a.t.stats.resyncs, a.t.stats.resyncFailed]).toEqual([1, 0]);
    const fired = a.corrections;
    const repaired = fired.filter((c) => c.repair).map((c) => correctionSizes(c, a.id));
    expect(repaired.length).toBeGreaterThan(0);
    const s = live.summary(a.t.stats);
    expect([s.repair.count, s.ball.count, s.corrections]).toEqual([repaired.length, fired.length - repaired.length, fired.length]);
    expectNear(s.repair.ball, repaired.map((r) => r.ball));
    expectNear(s.repair.remote, repaired.flatMap((r) => r.remote.map((b) => b.metres)));
    expectNear(s.repair.headings, repaired.flatMap((r) => r.remote.map((b) => b.degrees)));
    expectNear(s.repair.own, repaired.map((r) => r.own!.metres));
    // The repair put back what the spoil moved.
    expect(s.repair.ball.max).toBeCloseTo(0.5, 6);
    expectAgreement(nodes);
  });
});
