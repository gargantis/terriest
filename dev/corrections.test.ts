import { describe, expect, it } from 'vitest';
import { config, type Config } from '../src/config';
import { PROTOCOL_VERSION, ROLE, T, TIMELINE_KIND, ZERO_HASH, type Hello } from '../src/core/protocol/messages';
import type { CorrectionSizes } from '../src/core/session/summary';
import {
  cloneState, defaultParams, genesis, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, newTerrier, START_COUNTDOWN, WARM_UP,
} from '../src/core/sim/index';
import type { Accepted, RoomPeer } from '../src/core/session/room-peer';
import type { Correction } from '../src/core/timeline/timeline';
import { type LinkSpec, LoopbackNet, mulberry32, type LoopNode } from '../src/net/loopback';
import type { Transport } from '../src/net/transport';
import {
  addBins, BODIES, type Body, BODY_GLIDES_MS, bootstrapPercentile, binCounts, type BrowserFigures, CAP_RUNS, capRule, crossesPhase, dropsNote, fallInterval,
  intervalOf, JITTER_MS, linkSpec, LOSSES, LOSS_FREE_SEEDS, LOSSY_SEEDS, median, OWN_GLIDES_MS, PACK_SIZES, percentile, pick, type Played,
  pooledPercentile, pooledSizes, type Profile, profileName, profileProblems, profiles, reachesOf, reachMs, reportOf, RESAMPLES, resampleCounts, Rig,
  roundTrip, type RuleFigures, ruleD, ruleGlide, ruleW, seedOf, seedsWanted, Sizes, sizesByKind, sortCorrection, sortedUnion,
} from './corrections.measure';
import { configWith } from './tuning/model';

// M3's design §8.3 and §9: the correction measurement's arithmetic, in the
// gate, on synthetic data, so the figures research/corrections/REPORT.md
// decides by are computed as its method says: §9.2's profiles; M3-Q13's
// loss model as the harness lays it on LoopbackNet's links, a message
// waiting an extra round trip with the profile's chance and FIFO holding
// the messages behind it; the percentiles by nearest rank, a resample's
// pooled percentile, the bins and the bootstrap over matches (§9.4); and
// §9.5's three rules, the reach and §9.6's cap rule. The measurement
// itself runs off the gate (dev/corrections.vitest.config.ts).

// --- The profiles (§9.2) ---

describe("§9.2's profiles", () => {
  it('are 72, of 336 matches, and the partial mesh 4 more, each named once', () => {
    const all = profiles();
    const main = all.filter((p) => p.decides);
    expect([main.length, main.reduce((n, p) => n + p.seeds, 0)]).toEqual([72, 336]);
    expect(new Set(all.map((p) => p.name)).size).toBe(all.length);
    expect(main.filter((p) => p.loss === 0).every((p) => p.seeds === LOSS_FREE_SEEDS)).toBe(true);
    expect(main.filter((p) => p.loss > 0).every((p) => p.seeds === LOSSY_SEEDS)).toBe(true);
    const mesh = all.filter((p) => !p.decides);
    expect(mesh.map((p) => [p.name, p.blocked.length])).toEqual([
      ['pack4-30ms-d2-blocked1', 1], ['pack4-30ms-d2-blocked2', 2], ['pack4-80ms-d2-blocked1', 1], ['pack4-80ms-d2-blocked2', 2],
    ]);
    expect(profileName(2, 80, 3, 0.005)).toBe('pack2-80ms-d3-loss0.5');
    expect(profileName(1, 30, 2, 0.001)).toBe('pack1-30ms-d2-loss0.1');
  });

  it('are picked by name, a * for any characters, and a name that picks nothing is an error', () => {
    const names = [...profiles().map((p) => p.name), 'cap'];
    expect(pick(names, 'pack1-30ms-d2-loss0')).toEqual(['pack1-30ms-d2-loss0']);
    expect(pick(names, 'pack4-*-blocked*,cap')).toEqual(['pack4-30ms-d2-blocked1', 'pack4-30ms-d2-blocked2', 'pack4-80ms-d2-blocked1', 'pack4-80ms-d2-blocked2', 'cap']);
    expect(pick(names, 'pack2-*-loss0.5')).toHaveLength(6);
    expect(pick(names, '')).toEqual(names);
    expect(() => pick(names, 'pack5-*')).toThrow(/pack5-\* picks nothing/);
  });
});

// --- The loss model (M3-Q13, §8.2) ---

const BUILD = '0123456789abcdef';
const INTERVAL_MS = 30; // one message each, longer than the jitter, so only a loss holds a message back
const START_MS = 3000; // after the handshake and its ping
const SENT = 20_000;

/** A room peer that sends `count` numbered messages, one each timer run from START_MS, or records
 *  the arrival of each, by the network's virtual time. */
class Wire implements RoomPeer {
  readonly sent: number[] = [];
  readonly got: { readonly seq: number; readonly at: number }[] = [];
  private readonly link: Transport;
  private readonly me: string;
  private readonly count: number;
  private readonly clock: () => number;
  private peer: string | null = null;

  constructor(link: Transport, me: string, count: number, clock: () => number) {
    this.link = link;
    this.me = me;
    this.count = count;
    this.clock = clock;
  }

  hello(): Hello {
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: BUILD, player: this.me, role: ROLE.PLAYER,
      timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: '',
    };
  }

  checkHello(hello: Hello): Accepted {
    return { ok: true, hello };
  }

  onPeerJoin(peer: string): void {
    this.peer = peer;
  }

  onHandshakeFailed(): void {}
  onPeerLeave(): void {}
  onRtt(): void {}

  onMessage(_peer: string, bytes: Uint8Array): void {
    this.got.push({ seq: new DataView(bytes.buffer, bytes.byteOffset).getUint32(0), at: this.clock() });
  }

  advance(): void {
    const now = this.clock();
    if (this.peer === null || now < START_MS || this.sent.length >= this.count) return;
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, this.sent.length);
    this.sent.push(now);
    this.link.send(this.peer, bytes);
  }
}

/** SENT messages one way over a link of the profile's, one each INTERVAL_MS, as they arrived. */
function carried(p: Profile, seed: number): { readonly sent: readonly number[]; readonly got: readonly { readonly seq: number; readonly at: number }[] } {
  const net = new LoopbackNet(seed, () => linkSpec(p));
  const quiet = { pingEveryMs: Infinity };
  const a: LoopNode<Wire> = net.add('a', (link) => new Wire(link, (1).toString(16).padStart(32, '0'), SENT, () => net.now), quiet);
  const b: LoopNode<Wire> = net.add('b', (link) => new Wire(link, (2).toString(16).padStart(32, '0'), 0, () => net.now), quiet);
  net.join(a, 0);
  net.join(b, 0);
  net.pace(a, 0, INTERVAL_MS);
  net.pace(b, 0, 1000);
  net.run(START_MS + SENT * INTERVAL_MS + 10 * p.oneWayMs);
  return { sent: a.session.sent, got: b.session.got };
}

/** Each message's fate, in sending order (§8.2): on time; lost and sent again, an extra round trip
 *  late; or held behind a loss, arriving with it. */
function fates(p: Profile, seed: number): { lost: number; held: number; onTime: number[]; lostTransit: number[]; problems: string[] } {
  const { sent, got } = carried(p, seed);
  const problems: string[] = [];
  if (got.length !== sent.length) problems.push(`${got.length} of ${sent.length} arrived`);
  got.forEach((g, i) => {
    if (g.seq !== i) problems.push(`message ${g.seq} arrived ${i}th`);
  });
  const onTime: number[] = [];
  const lostTransit: number[] = [];
  let lost = 0;
  let held = 0;
  let lastLost = -Infinity;
  for (let i = 0; i < got.length; i++) {
    const at = got[i]!.at;
    const transit = at - sent[i]!;
    const before = i > 0 ? got[i - 1]!.at : -Infinity;
    if (at < before) problems.push(`message ${i} arrived before ${i - 1}`);
    if (transit >= 3 * p.oneWayMs && at > before) {
      lost++;
      lostTransit.push(transit);
      lastLost = at;
    } else if (transit > p.oneWayMs + p.jitterMs) {
      held++;
      if (at !== lastLost || sent[i]! >= lastLost) problems.push(`message ${i}, ${transit} ms, isn't held behind a loss`);
    } else {
      onTime.push(transit);
    }
  }
  return { lost, held, onTime, lostTransit, problems };
}

describe("M3-Q13's loss model on LoopbackNet's links (§8.2, §9.2)", () => {
  const all = profiles();
  const named = (name: string): Profile => all.find((p) => p.name === name)!;

  it("gives every link of a profile its one-way latency, §9.2's jitter and its loss chance", () => {
    for (const p of all) expect(linkSpec(p), p.name).toEqual({ base: p.oneWayMs, jitter: JITTER_MS, loss: p.loss });
    expect(new Set(all.map((p) => p.loss))).toEqual(new Set(LOSSES));
  });

  for (const name of ['pack2-30ms-d2-loss0.5', 'pack1-150ms-d3-loss0.1', 'pack3-80ms-d2-loss0']) {
    it(`${name}: a message, with the chance, arrives an extra 2 × base late, FIFO holding those behind it`, () => {
      const p = named(name);
      const f = fates(p, 11);
      expect(f.problems).toEqual([]);
      // The losses: the binomial's count within 4 standard deviations.
      const expected = SENT * p.loss;
      expect(Math.abs(f.lost - expected)).toBeLessThanOrEqual(4 * Math.sqrt(expected * (1 - p.loss)) + 1);
      // A loss lands its retransmission a round trip late, within the jitter; the rest within the link's latency and jitter.
      for (const t of f.lostTransit) expect(t >= 3 * p.oneWayMs && t < 3 * p.oneWayMs + p.jitterMs, `${t} ms`).toBe(true);
      expect(Math.min(...f.onTime)).toBeGreaterThanOrEqual(p.oneWayMs);
      expect(Math.max(...f.onTime)).toBeLessThan(p.oneWayMs + p.jitterMs);
      expect(Math.max(...f.onTime) - Math.min(...f.onTime)).toBeGreaterThan(0.9 * p.jitterMs);
      // Head-of-line blocking: every loss holds the messages sent before it landed.
      if (p.loss > 0) expect(f.held).toBeGreaterThanOrEqual(f.lost);
      else expect([f.lost, f.held]).toEqual([0, 0]);
    });
  }
});

// --- Percentiles, bins and the bootstrap (§9.4) ---

const ramp = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => i + 1);

describe('the percentiles, by nearest rank as the match summary takes them', () => {
  it('take the ⌈n × pct / 100⌉-th smallest, 0 for none', () => {
    expect([50, 95, 100, 1].map((q) => percentile(ramp(100), q))).toEqual([50, 95, 100, 1]);
    expect([50, 95].map((q) => percentile(ramp(20), q))).toEqual([10, 19]);
    expect(percentile(ramp(7), 95)).toBe(7);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([4], 1)).toBe(4);
  });

  it('take the middle, or the mean of the middle two, for the cap rule', () => {
    expect([median([3, 1, 2]), median([4, 1, 3, 2]), median([]), median([5])]).toEqual([2, 2.5, 0, 5]);
  });

  it("pool a resample's matches, each as many times as drawn, without building the pool", () => {
    const rand = mulberry32(5);
    for (let n = 0; n < 300; n++) {
      const lists = Array.from({ length: 1 + Math.floor(rand() * 5) }, () =>
        Float64Array.from({ length: Math.floor(rand() * 30) }, () => Math.floor(rand() * 50) / 7).sort(),
      );
      const weights = lists.map(() => Math.floor(rand() * 4));
      const pool = Float64Array.from(lists.flatMap((l, j) => Array.from({ length: weights[j]! }, () => [...l]).flat())).sort();
      for (const q of [1, 5, 50, 95, 100]) expect(pooledPercentile(lists, weights, q, sortedUnion(lists)), `case ${n}, p${q}`).toBe(percentile(pool, q));
    }
  });
});

describe("the corrections across a phase's start, reported apart", () => {
  it("are those whose head before and after differ in phase, or in its start", () => {
    const head = (phase: MatchState['phase'], phaseStart: number): MatchState => ({ ...genesis({ packSize: 1, matchMinutes: 1 }, defaultParams), phase, phaseStart });
    expect(crossesPhase({ before: head(WARM_UP, 0), after: head(START_COUNTDOWN, 363) })).toBe(true);
    expect(crossesPhase({ before: head(KICKOFF_COUNTDOWN, 900), after: head(KICKOFF_COUNTDOWN, 901) })).toBe(true);
    expect(crossesPhase({ before: head(IN_PLAY, 900), after: head(IN_PLAY, 900) })).toBe(false);
  });
});

describe("the sizes' and depths' bins", () => {
  it('count each value in the bin from its edge, the last open, and those under the first apart', () => {
    expect(binCounts([0.5, 1, 1.5, 2, 2.5, 3, 99], [1, 2, 3])).toEqual({ counts: [2, 2, 2], under: 1 });
    expect(binCounts([], [0, 1])).toEqual({ counts: [0, 0], under: 0 });
    expect(binCounts([0, 0.0001, 5], [0, 0.0001, 0.001, 5])).toEqual({ counts: [1, 1, 0, 1], under: 0 });
  });

  it("pool lateBy's bins over browsers, the shorter padded", () => {
    expect(addBins([1, 2, 3], [1, 1])).toEqual([2, 3, 3]);
    expect(addBins([], [0, 4])).toEqual([0, 4]);
  });
});

describe('the bootstrap over matches (1,000 resamples, seeded)', () => {
  it('draws each resample of n matches with replacement, the same from the same seed', () => {
    const draws = resampleCounts(6, 1000, 3);
    expect(draws).toHaveLength(1000);
    expect(draws.every((w) => w.length === 6 && w.reduce((a, b) => a + b, 0) === 6)).toBe(true);
    expect(draws.some((w) => w.some((x) => x > 1))).toBe(true);
    expect(resampleCounts(6, 1000, 3)).toEqual(draws);
    expect(resampleCounts(6, 1000, 4)).not.toEqual(draws);
    // Each match drawn once a resample on average.
    for (let j = 0; j < 6; j++) expect(Math.abs(draws.reduce((n, w) => n + w[j]!, 0) - 1000)).toBeLessThan(120);
  });

  it("takes the interval's ends at the 5th and 95th percentiles of the replicates", () => {
    expect(intervalOf([...ramp(1000)].reverse())).toEqual({ lo: 50, hi: 950 });
  });

  it('resamples matches, not samples: two matches of 1 m and of 10 m give replicates of both', () => {
    const ones = new Float64Array(100).fill(1);
    const tens = new Float64Array(100).fill(10);
    const draws = resampleCounts(2, 1000, 9);
    const b = bootstrapPercentile([ones, tens], 95, draws);
    // A resample of the 1 m match alone, a quarter of them, has its p95 at 1 m; any with the other, at 10.
    const share = b.replicates.filter((x) => x === 1).length / 1000;
    expect(Math.abs(share - 0.25)).toBeLessThan(0.05);
    expect([b.lo, b.hi, b.replicates.every((x) => x === 1 || x === 10)]).toEqual([1, 10, true]);
    // Matches alike give an interval of the one value.
    const same = bootstrapPercentile([ramp(40), ramp(40), ramp(40)], 95, resampleCounts(3, 1000, 1));
    expect([same.lo, same.hi]).toEqual([38, 38]);
  });

  it("seeds each profile's resamples by its name alone", () => {
    expect(seedOf('a')).toBe(0xe40c292c); // FNV-1a's published value for "a"
    expect(seedOf('pack1-30ms-d2-loss0')).not.toBe(seedOf('pack1-30ms-d3-loss0'));
  });
});

// --- The reach (§9.4) and the rules (§9.5, §9.6) ---

const TICK_MS = 1000 / config.ticksPerSecond;

describe("the model's reach (§9.4)", () => {
  const at = (d: number, w: number, legs: number, hops: number): number => reachMs({ d, w, tickMs: TICK_MS, residualMs: TICK_MS, jitterMs: JITTER_MS, legs, hops });

  it("lands a retransmission in time when 3 × one-way + its one link's jitter ≤ (d + w) ticks less the residual, and a forwarded TICK at 2 × one-way and each hop's jitter", () => {
    expect(at(2, 12, 3, 1)).toBeCloseTo((14 * TICK_MS - TICK_MS - 20) / 3, 9);
    expect(at(2, 12, 3, 1)).toBeCloseTo(65.56, 2); // design §9.5's "about 71 ms", less the residual
    expect(at(2, 14, 3, 1)).toBeCloseTo(76.67, 2);
    expect(at(3, 12, 3, 1)).toBeCloseTo(71.11, 2);
    // Two links, two jitters (LoopbackNet draws one a message a link): 88.3 ms, not 98.3; and with
    // the forwarded pair's two deadbands of residual, 80 ms (M3 phase 5a, mesh-F4).
    expect(at(2, 12, 2, 2)).toBeCloseTo((14 * TICK_MS - TICK_MS - 40) / 2, 9);
    expect(at(2, 12, 2, 2)).toBeCloseTo(88.33, 2);
    expect(reachMs({ d: 2, w: 12, tickMs: TICK_MS, residualMs: 2 * TICK_MS, jitterMs: JITTER_MS, legs: 2, hops: 2 })).toBeCloseTo(80, 9);
  });

  it('is reported beside each lossy profile, the forwarding reach beside each partial mesh, and none beside a loss-free full mesh', () => {
    const all = profiles();
    const named = (name: string): Profile => all.find((p) => p.name === name)!;
    // A forwarded pair's ends sample none of each other's clocks: two deadbands of residual (mesh-F4).
    const reach = (d: number, legs: number, hops: number, oneWayMs: number): { legs: number; hops: number; reachMs: number; inReach: boolean } => {
      const residual = (hops > 1 ? 2 : 1) * config.clockDeadbandTicks * TICK_MS;
      const ms = reachMs({ d, w: config.lateWindowTicks, tickMs: TICK_MS, residualMs: residual, jitterMs: JITTER_MS, legs, hops });
      return { legs, hops, reachMs: ms, inReach: oneWayMs <= ms };
    };
    expect(reachesOf(named('pack2-30ms-d2-loss0.5'), config)).toEqual({ loss: reach(2, 3, 1, 30) });
    expect(reachesOf(named('pack3-80ms-d3-loss0.1'), config)).toEqual({ loss: reach(3, 3, 1, 80) });
    expect(reachesOf(named('pack3-80ms-d3-loss0.1'), config).loss!.inReach).toBe(false);
    expect(reachesOf(named('pack4-80ms-d2-blocked2'), config)).toEqual({ forwarding: reach(2, 2, 2, 80) });
    expect(reachesOf(named('pack4-80ms-d2-blocked2'), config).forwarding!.reachMs).toBeCloseTo(80, 9);
    expect(reachesOf(named('pack1-80ms-d2-loss0'), config)).toEqual({});
  });
});

/** A profile's figures as the rules read them: each body's p95, its interval and its replicates. */
function figures(name: string, bodies: Partial<Record<Body, { p95: number; lo?: number; hi?: number; replicates?: number[] }>>, late = 0, resyncs = 0): RuleFigures {
  const body: Partial<Record<Body, RuleFigures['bodies'][Body]>> = {};
  for (const b of BODIES) {
    const x = bodies[b] ?? { p95: 0 };
    body[b] = { p95: x.p95, p95Interval: { lo: x.lo ?? x.p95, hi: x.hi ?? x.p95 }, ...(x.replicates ? { replicates: x.replicates } : {}) };
  }
  return { profile: { name }, bodies: body as RuleFigures['bodies'], late: { lateAbsentShare: late }, resyncsPerBrowserMinute: resyncs };
}

/** Replicates spread evenly within ±spread of v. */
const around = (v: number, spread: number): number[] => Array.from({ length: 1000 }, (_, i) => v * (1 - spread + (2 * spread * i) / 999));

describe("§9.5's rules on synthetic figures", () => {
  /** The loss-free 80 ms profiles at d = 2 and 3, each pack size's ball p95 falling by falls[k], each
   *  profile's replicates within ±spread of it, the d = 3 ones in the other order, as two
   *  independent resamplings pair them. */
  const dProfiles = (falls: readonly number[], spread = 0.02): RuleFigures[] =>
    PACK_SIZES.flatMap((packSize, k) => [
      figures(profileName(packSize, 80, 2, 0), { ball: { p95: 0.2, replicates: around(0.2, spread) } }),
      figures(profileName(packSize, 80, 3, 0), { ball: { p95: 0.2 * (1 - falls[k]!), replicates: around(0.2 * (1 - falls[k]!), spread).reverse() } }),
    ]);

  it('rule 1: d = 3 only for a fall of at least 25% at every pack size, its interval wholly above it', () => {
    expect(ruleD(dProfiles([0.3, 0.3, 0.32, 0.4])).value).toBe(3);
    expect(ruleD(dProfiles([0.3, 0.24, 0.32, 0.4])).value).toBe(2);
    // A fall of 27% whose interval reaches below 25%: d stays 2.
    const wide = ruleD(dProfiles([0.27, 0.3, 0.32, 0.4], 0.05));
    expect(wide.value).toBe(2);
    expect((wide.figures[0]!.fallInterval as { lo: number }).lo).toBeLessThan(0.25);
    expect(ruleD(dProfiles([0.3, 0.3, 0.32, 0.4]).slice(1))).toMatchObject({ decided: false, value: null });
    // The fall's interval pairs the replicates by index: every pair here falls by half.
    const i = fallInterval(around(1, 0.1), around(0.5, 0.1))!;
    expect(i.lo).toBeCloseTo(0.5, 9);
    expect(i.hi).toBeCloseTo(0.5, 9);
    expect(fallInterval(around(1, 0.1), undefined)).toBeNull();
  });

  it('rule 2: the smallest glide over which each p95, at its upper end, keeps to half the run speed and half the turn rate', () => {
    const glide = (ball: number, remote: number, headings: number, own: number, ownHeadings: number): ReturnType<typeof ruleGlide> =>
      ruleGlide(
        PACK_SIZES.map((packSize) => figures(profileName(packSize, 80, 2, 0), {
          ball: { p95: ball / 2, hi: ball }, remote: { p95: remote / 2, hi: remote }, headings: { p95: headings / 2, hi: headings },
          own: { p95: own / 2, hi: own }, ownHeadings: { p95: ownHeadings / 2, hi: ownHeadings },
        })),
        2, config,
      );
    // Half the run speed, 3 m/s, and half the turn rate, 360°/s, over 50 ms: 0.15 m and 18°.
    expect([config.runSpeedMetresPerSecond / 2, config.turnRateTurnsPerSecond * 180]).toEqual([3, 360]);
    const a = glide(0.14, 0.1, 20, 0.07, 8);
    expect([a.bodies.value, a.own.value]).toEqual([100, 25]); // 20° over 50 ms is 400°/s
    const b = glide(0.149, 0.149, 17.9, 0.149, 8.9);
    expect([b.bodies.value, b.own.value]).toEqual([50, 50]); // 0.149 m over 25 ms is 5.96 m/s
    const none = glide(1, 0.1, 10, 1, 1);
    expect([none.bodies.value, none.own.value]).toEqual([BODY_GLIDES_MS[3], OWN_GLIDES_MS[2]]);
    expect(none.bodies.text).toMatch(/none of 50, 100, 150, 200 ms passes, so 200 ms, and the figures go to M4's check/);
    // At the interval's upper end, not the p95: a p95 that passes at 50 ms with an upper end that doesn't.
    const upper = ruleGlide(PACK_SIZES.map((packSize) => figures(profileName(packSize, 80, 2, 0), { ball: { p95: 0.1, hi: 0.2 } })), 2, config);
    expect(upper.bodies.value).toBe(100);
    expect(ruleGlide([], 2, config).bodies.decided).toBe(false);
  });

  it('rule 3: w confirmed at lateAbsent at most 0.5% and resyncs at most 1 a browser-minute, at every profile the reach covers', () => {
    const wProfiles = (late: number, resyncs: number, worst = ''): RuleFigures[] =>
      PACK_SIZES.flatMap((packSize) =>
        ([[30, 0], [80, 0], [30, 0.001], [30, 0.005], [150, 0], [80, 0.005]] as const).map(([ms, loss]) => {
          const name = profileName(packSize, ms, 2, loss);
          return name === worst ? figures(name, {}, 0.006, resyncs) : figures(name, {}, late, resyncs);
        }),
      );
    const c: Config = config;
    expect(ruleW(wProfiles(0.005, 1), 2, c)).toMatchObject({ decided: true, value: 12 });
    const fails = ruleW(wProfiles(0.001, 0.2, 'pack3-30ms-d2-loss0.5'), 2, c);
    expect(fails).toMatchObject({ decided: true, value: 14 });
    expect(fails.text).toMatch(/fails at pack3-30ms-d2-loss0\.5/);
    expect(ruleW(wProfiles(0.001, 1.1), 2, c).value).toBe(14);
    // The lossy 80 and 150 ms profiles decide nothing: past the reach.
    expect(ruleW(wProfiles(0.001, 0.2, 'pack3-80ms-d2-loss0.5'), 2, c).value).toBe(12);
    expect(ruleW(wProfiles(0.001, 0.2).slice(1), 2, c).decided).toBe(false);
  });

  it("rule 1: a fall of exactly 25% passes, and an interval reaching down to 25% doesn't", () => {
    // The p95 ball correction 1 m at d = 2 and 0.75 m at d = 3 at every pack size, a fall of exactly 25%;
    // `low` of the paired replicates fall by exactly 25% too, the rest by half.
    const exact = (low: number): RuleFigures[] =>
      PACK_SIZES.flatMap((packSize) => [
        figures(profileName(packSize, 80, 2, 0), { ball: { p95: 1, replicates: new Array<number>(1000).fill(1) } }),
        figures(profileName(packSize, 80, 3, 0), { ball: { p95: 0.75, replicates: Array.from({ length: 1000 }, (_, i) => (i < low ? 0.75 : 0.5)) } }),
      ]);
    expect(ruleD(exact(0))).toMatchObject({ decided: true, value: 3 });
    // A twentieth at 25%: the interval's lower end is 25%, not wholly above it.
    const edge = ruleD(exact(50));
    expect((edge.figures[0]!.fallInterval as { lo: number }).lo).toBe(0.25);
    expect(edge.value).toBe(2);
  });

  it("rule 2: each clause binds alone, the remote terriers' positions and headings, and your own terrier's heading", () => {
    const at = (b: Partial<Record<Body, number>>): ReturnType<typeof ruleGlide> =>
      ruleGlide(PACK_SIZES.map((packSize) => figures(profileName(packSize, 80, 2, 0), Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { p95: v / 2, hi: v }])))), 2, config);
    // The remote terriers' 0.4 m alone: 4 m/s over 100 ms, 2.67 over 150, half the run speed 3.
    expect(at({ ball: 0.01, remote: 0.4, headings: 1 }).bodies.value).toBe(150);
    // Their headings' 50° alone: 500°/s over 100 ms, 333 over 150, half the turn rate 360.
    expect(at({ ball: 0.01, remote: 0.01, headings: 50 }).bodies.value).toBe(150);
    // Your own terrier's heading, 30°, alone: 600°/s over 50 ms, 300 over 100; at the whole turn rate, 720, 50 ms would do.
    expect(at({ own: 0.01, ownHeadings: 30 }).own.value).toBe(100);
    // Your own terrier's position, 0.2 m, alone: 4 m/s over 50 ms, 2 over 100.
    expect(at({ own: 0.2, ownHeadings: 1 }).own.value).toBe(100);
  });

  /** Rule 3's profiles at d, every pack size, at lateAbsent 0.1% and 0.2 resyncs a browser-minute, but
   *  `bad`, at 0.6%: the four kinds it reads, and the five past the reach that it doesn't. */
  const W_KINDS = [[30, 0], [80, 0], [30, 0.001], [30, 0.005], [150, 0], [80, 0.001], [80, 0.005], [150, 0.001], [150, 0.005]] as const;
  const wAt = (d: number, bad = ''): RuleFigures[] =>
    PACK_SIZES.flatMap((packSize) => W_KINDS.map(([ms, loss]) => {
      const name = profileName(packSize, ms, d, loss);
      return figures(name, {}, name === bad ? 0.006 : 0.001, 0.2);
    }));

  it('rule 3: each kind it reads fails w alone, and none past the reach does', () => {
    for (const [ms, loss] of W_KINDS.slice(0, 4)) expect(ruleW(wAt(2, profileName(2, ms, 2, loss)), 2, config).value, `${ms} ms, loss ${loss}`).toBe(14);
    for (const [ms, loss] of W_KINDS.slice(4)) expect(ruleW(wAt(2, profileName(2, ms, 2, loss)), 2, config).value, `${ms} ms, loss ${loss}`).toBe(12);
    // A resync rate over 1 a browser-minute at one of them alone fails it too.
    const resyncs = wAt(2).map((r) => (r.profile.name === 'pack4-80ms-d2-loss0' ? { ...r, resyncsPerBrowserMinute: 1.1 } : r));
    expect(ruleW(resyncs, 2, config).value).toBe(14);
  });

  it("rules 2 and 3 read rule 1's d: fed d = 3's profiles alone, they decide at d = 3, and at d = 2 they're unmeasured", () => {
    expect(ruleW(wAt(3), 3, config)).toMatchObject({ decided: true, value: 12 });
    expect(ruleW(wAt(3), 2, config).decided).toBe(false);
    const glides = PACK_SIZES.map((packSize) => figures(profileName(packSize, 80, 3, 0), { ball: { p95: 0.1 } }));
    expect([ruleGlide(glides, 3, config).bodies.decided, ruleGlide(glides, 3, config).own.decided]).toEqual([true, true]);
    expect([ruleGlide(glides, 2, config).bodies.decided, ruleGlide(glides, 2, config).own.decided]).toEqual([false, false]);
    // Failing at d = 3, the next w, 14, takes protocol 2's 32-tick history there first (§9.5).
    const fails = ruleW(wAt(3, 'pack1-30ms-d3-loss0'), 3, config);
    expect(fails.value).toBe(14);
    expect(fails.text).toMatch(/; at w = 14, d = 3 take the TICK's 32-tick history first, protocol 2, without which those profiles aren't measured$/);
    expect(ruleW(wAt(2, 'pack1-30ms-d2-loss0'), 2, config).text).toMatch(/; at w = 14, d = 3 take the TICK's 32-tick history first/);
  });
});

describe('a smoke run decides nothing (M3 phase 5, harness-F5)', () => {
  it("wants §9.2's matches of each profile: 6 loss-free, the partial mesh's included, and 4 lossy", () => {
    const wanted = ['pack1-80ms-d2-loss0', 'pack1-30ms-d2-loss0.1', 'pack3-150ms-d3-loss0.5', 'pack4-30ms-d2-blocked1'].map(seedsWanted);
    expect(wanted).toEqual([LOSS_FREE_SEEDS, LOSSY_SEEDS, LOSSY_SEEDS, LOSS_FREE_SEEDS]);
    for (const p of profiles()) expect(seedsWanted(p.name), p.name).toBe(p.seeds);
  });

  it('leaves a rule undecided when a profile it reads had fewer, saying what the figures would decide', () => {
    const glides = (matches: number): RuleFigures[] =>
      PACK_SIZES.map((packSize) => ({ ...figures(profileName(packSize, 80, 2, 0), { ball: { p95: 0.1 } }), matches: new Array<number>(packSize === 3 ? matches : LOSS_FREE_SEEDS).fill(0) }));
    expect(ruleGlide(glides(LOSS_FREE_SEEDS), 2, config).bodies).toMatchObject({ decided: true, value: 50 });
    const smoke = ruleGlide(glides(1), 2, config).bodies;
    expect(smoke).toMatchObject({ decided: false, value: null });
    expect(smoke.text).toMatch(/^rule 2 \(the bodies, smoothingMs, at d = 2\): 50 ms, .*; a smoke run, so it decides nothing: matches pack3-80ms-d2-loss0 1 of 6$/);
    const w = wAt2WithMatches();
    expect(ruleW(w.full, 2, config)).toMatchObject({ decided: true, value: 12 });
    expect(ruleW(w.short, 2, config)).toMatchObject({ decided: false, value: null });
    expect(ruleD(dWithMatches(LOSS_FREE_SEEDS))).toMatchObject({ decided: true, value: 2 });
    expect(ruleD(dWithMatches(2))).toMatchObject({ decided: false, value: null });
  });

  it("leaves the cap check undecided with fewer runs than §9.6's", () => {
    const runs = (n: number): { worst: { ms: number; steps: number } }[] => Array.from({ length: n }, () => ({ worst: { ms: 3, steps: 42 } }));
    expect(capRule(runs(CAP_RUNS), 42, 12, CAP_RUNS)).toMatchObject({ decided: true, value: 42 });
    const smoke = capRule(runs(2), 42, 12, CAP_RUNS);
    expect(smoke).toMatchObject({ decided: false, value: null });
    expect(smoke.text).toMatch(/^the cap check \(§9\.6\): the cap of 42 stands: .*; a smoke run, so it decides nothing: 2 of 20 runs$/);
  });
});

/** Rule 3's profiles at d = 2, every one passing, with its full matches, and with one lossy one short. */
function wAt2WithMatches(): { full: RuleFigures[]; short: RuleFigures[] } {
  const full = PACK_SIZES.flatMap((packSize) =>
    ([[30, 0], [80, 0], [30, 0.001], [30, 0.005]] as const).map(([ms, loss]) => {
      const name = profileName(packSize, ms, 2, loss);
      return { ...figures(name, {}, 0.001, 0.2), matches: new Array<number>(seedsWanted(name)).fill(0) };
    }),
  );
  return { full, short: full.map((r) => (r.profile.name === 'pack2-30ms-d2-loss0.1' ? { ...r, matches: [0, 0, 0] } : r)) };
}

/** Rule 1's profiles, the p95 ball correction falling 10% at every pack size, the d = 3 ones with this many matches. */
function dWithMatches(matches: number): RuleFigures[] {
  return PACK_SIZES.flatMap((packSize) => [
    { ...figures(profileName(packSize, 80, 2, 0), { ball: { p95: 1, replicates: new Array<number>(1000).fill(1) } }), matches: new Array<number>(LOSS_FREE_SEEDS).fill(0) },
    { ...figures(profileName(packSize, 80, 3, 0), { ball: { p95: 0.9, replicates: new Array<number>(1000).fill(0.9) } }), matches: new Array<number>(matches).fill(0) },
  ]);
}

describe("a profile's configuration (M3 phase 5, harness-F6)", () => {
  it("refuses one whose TICK history doesn't cover d + w, past TICK's masks, or whose spread cap is under w + 1", () => {
    expect([profileProblems({ d: 2 }, config), profileProblems({ d: 3 }, config)]).toEqual([[], []]);
    // §9.5: w = 14 fits at d = 2, and at d = 3 takes protocol 2's 32-tick history first.
    const w14 = configWith({ lateWindowTicks: 14 });
    expect(profileProblems({ d: 2 }, w14)).toEqual([]);
    expect(profileProblems({ d: 3 }, w14)).toEqual([expect.stringMatching(/^a TICK's 16-tick input history doesn't cover d \+ w = 17 ticks/)]);
    expect(profileProblems({ d: 2 }, configWith({ inputHistoryTicks: 32, lateWindowTicks: 18 }))).toEqual([expect.stringMatching(/doesn't fit TICK's 16-bit masks/)]);
    expect(profileProblems({ d: 2 }, configWith({ spreadMaxStepsPerTick: 12 }))).toEqual([
      "the spread's cap, 12 steps a tick, is under a normal tick's worst, w + 1 = 13",
    ]);
  });
});

describe("§9.6's cap rule", () => {
  const runs = (ms: readonly number[], steps = 42): { worst: { ms: number; steps: number } }[] => ms.map((x) => ({ worst: { ms: x, steps } }));

  it("keeps the cap if the median run's worst spread advance, × 6.3, is at most 25 ms", () => {
    expect(capRule(runs([3, 3.9, 5]), 42, 12)).toMatchObject({ decided: true, value: 42 });
    // The median, not the mean: one run's tail doesn't move it.
    const tail = capRule(runs([3.9, 3.9, 3.95, 9]), 42, 12);
    expect(tail.text).toMatch(/^the cap check \(§9\.6\): the cap of 42 stands: .* 3\.92 ms in Node, × 6\.3 = 24\.7 ms against 25 ms; their maximum 9\.00 ms$/);
    expect(tail.figures[0]!.medianWorstMs).toBeCloseTo(3.925, 12);
  });

  it('otherwise takes the largest cap that meets it, by the median ms a step, never under w + 1', () => {
    // 4 ms for 42 steps: 25 / 6.3 / (4 / 42) is 41.7.
    expect(capRule(runs([3, 4, 5]), 42, 12).value).toBe(41);
    expect(capRule(runs([10, 10]), 42, 12).value).toBe(16);
    const floor = capRule(runs([84, 84]), 42, 12);
    expect(floor.value).toBe(13);
    expect(floor.text).toMatch(/even w \+ 1 = 13 fails/);
    expect(capRule([], 42, 12).decided).toBe(false);
  });

  it('keeps the cap at exactly 25 ms, and takes the median ms a step where the runs differ', () => {
    const edge = capRule(runs([25 / 6.3, 25 / 6.3]), 42, 12);
    expect(edge).toMatchObject({ decided: true, value: 42 });
    expect(edge.text).toMatch(/^the cap check \(§9\.6\): the cap of 42 stands: .* = 25\.0 ms against 25 ms/);
    // ms a step 4/42, 10/42 and 5/21: the median 0.238 gives 16; their mean, 0.190, would give 20.
    const mixed = capRule([{ worst: { ms: 4, steps: 42 } }, { worst: { ms: 10, steps: 42 } }, { worst: { ms: 5, steps: 21 } }], 42, 12);
    expect(mixed.value).toBe(16);
  });

  it('says beside its decision which runs closed connections, which no honest run does (harness-F1)', () => {
    expect(dropsNote([{ drops: [] }, { drops: [] }, {}])).toBe('');
    const note = dropsNote([{ drops: [{ by: 3, peer: 'n6', at: 21_040 }, { by: 3, peer: 'n1', at: 21_041 }] }, { drops: [] }]);
    expect(note).toMatch(/^; in 1 of 2 runs browser 3 closed connections, up to 2 a run, so those runs' worst normal advances stop at the dissenter's first close/);
  });
});

// --- From a match's corrections to the figures the rules read (§9.3, §9.4; harness-F4) ---

const ME = (1).toString(16).padStart(32, '0');
const YOU = (2).toString(16).padStart(32, '0');

/** A head in play: the ball, this browser's terrier and another. */
function head(phaseStart = 900): MatchState {
  const s = genesis({ packSize: 1, matchMinutes: 1 }, defaultParams);
  s.terriers.push(newTerrier(ME, 'Me', 0, 0, 0, defaultParams), newTerrier(YOU, 'You', 1, 1, 0, defaultParams));
  s.phase = IN_PLAY;
  s.phaseStart = phaseStart;
  return s;
}

/** before with the ball, the other terrier and this browser's moved along x by these metres. */
function moved(before: MatchState, ball: number, you: number, me = 0): MatchState {
  const after = cloneState(before);
  after.ball.x += ball;
  after.terriers.find((T) => T.id === YOU)!.x += you;
  after.terriers.find((T) => T.id === ME)!.x += me;
  return after;
}

describe("a correction's sizes, by kind (§9.3, §9.4)", () => {
  it('puts a repair\'s apart, and the rest by whether it crossed a phase\'s start, each with its depth H − from + 1', () => {
    const into = sizesByKind();
    const at = head();
    const c = (o: Omit<Correction, 'before'>): Correction => ({ before: at, ...o });
    sortCorrection(into, c({ tick: 950, from: 947, after: moved(at, 0.5, 0.25), repair: false }), ME);
    sortCorrection(into, c({ tick: 950, from: 941, after: { ...moved(at, 0.125, 0), phaseStart: 901 }, repair: false }), ME);
    sortCorrection(into, c({ tick: 960, from: 700, after: moved(at, 2, 0, 1), repair: true }), ME);
    sortCorrection(into, c({ tick: 961, from: 961, after: cloneState(at), repair: false }), ME);
    expect([into.predicted.count, into.steady.count, into.placed.count, into.repair.count]).toEqual([3, 2, 1, 1]);
    expect([into.predicted.depths, into.repair.depths]).toEqual([[4, 10, 1], [261]]);
    expect([into.predicted.moved.ball, into.steady.moved.ball, into.placed.moved.ball, into.repair.moved.ball]).toEqual([[0.5, 0.125], [0.5], [0.125], [2]]);
    // The other terrier is remote, this browser's its own: moved only in the repair.
    expect([into.predicted.moved.remote, into.predicted.moved.own, into.repair.moved.own]).toEqual([[0.25], [], [1]]);
  });

  it("counts a body's zeros apart from its moved samples, and a correction that moved nothing as still", () => {
    const s = new Sizes();
    const sizes = (ball: number, remote: number, degrees = 0): CorrectionSizes => ({ ball, ballFlat: ball, remote: [{ metres: remote, degrees }], own: { metres: 0, degrees: 0 } });
    s.add(sizes(0.5, 0), 3);
    s.add(sizes(0, 0), 1);
    s.add(sizes(0, 0.25, 10), 2);
    expect([s.count, s.still, s.depths]).toEqual([3, 1, [3, 1, 2]]);
    expect([s.moved.ball, s.zero.ball, s.moved.remote, s.zero.remote, s.moved.headings, s.zero.headings]).toEqual([[0.5], 2, [0.25], 2, [10], 2]);
    expect([s.moved.own, s.zero.own, s.moved.ownHeadings, s.zero.ownHeadings]).toEqual([[], 3, [], 3]);
  });
});

/** A browser's figures as a match gives them: what reportOf pools over (§9.3). */
function browserFigures(k: number): BrowserFigures {
  return {
    k, pack: k % 2, minutes: 1, corrections: { count: 0, still: 0, repair: 0, timeline: 0 }, depth: { p50: 0, p95: 0, max: 0 },
    rollbacks: 30, rollbacksPerSecond: 0.5, stepsPerAdvance: { mean: 1, p95: 1, max: 1, advances: 1 }, stepsPerTick: 1, spreadTicks: 0,
    resyncs: 1, resyncFailed: 0, disagree: 0, lateVoteFlips: 0, jumps: 0,
    late: { remoteInputs: 1000, count: 2, share: 0.002, lateBy: [2], lateAbsent: 1, lateAbsentShare: 0.001 },
    traffic: { sentPerSecond: 60, sentBytesPerSecond: 2000, receivedPerSecond: 60, receivedBytesPerSecond: 2000, fwdSent: 0 },
    summaryP95: { ball: 0, remote: 0, own: 0, headings: 0 },
  };
}

/** A match whose browsers' ball corrections are these, each list a browser's, at this depth, with
 *  repairs apart. */
function played(seed: number, browsers: readonly { balls: readonly number[]; repairs: readonly number[]; depth: number }[]): Played {
  const kinds = browsers.map(({ balls, repairs, depth }) => {
    const k = sizesByKind();
    const sizes = (ball: number): CorrectionSizes => ({ ball, ballFlat: ball, remote: [], own: null });
    for (const b of balls) {
      k.predicted.add(sizes(b), depth);
      k.steady.add(sizes(b), depth);
    }
    for (const b of repairs) k.repair.add(sizes(b), 200);
    return k;
  });
  return {
    figures: { seed, ended: true, endTick: 3600, endSeconds: 70, score: [1, 0], overtime: false, wallSeconds: 1, browsers: browsers.map((_, k) => browserFigures(k)) },
    predicted: pooledSizes(kinds.map((x) => x.predicted)), placed: pooledSizes(kinds.map((x) => x.placed)),
    steady: pooledSizes(kinds.map((x) => x.steady)), repair: pooledSizes(kinds.map((x) => x.repair)),
    stepping: new Map([[1, 100]]), byPhase: [0, 0, 0, 3, 0, 0], logs: [],
  };
}

describe("a profile's report from its matches (§9.4)", () => {
  it('pools the moved samples over its matches, zeros and repairs apart, each p95 with its bootstrap over the matches', () => {
    const matches = [
      played(1, [{ balls: [0.01, 0.02, 0.03, 0], repairs: [1], depth: 3 }]),
      played(2, [{ balls: [0.1, 0.2, 0.3, 0.4], repairs: [], depth: 4 }]),
      played(3, [{ balls: [1, 2], repairs: [5, 6], depth: 5 }, { balls: [3], repairs: [], depth: 2 }]),
    ];
    const p = profiles().find((x) => x.name === 'pack1-80ms-d2-loss0')!;
    const r = reportOf(p, matches, config);
    expect(r.corrections).toMatchObject({ count: 14, still: 1, repair: 3 });
    const ball = r.bodies.ball;
    expect([ball.samples, ball.zero, ball.p50, ball.p95, ball.max]).toEqual([10, 1, 0.2, 3, 3]);
    // §9.4's bootstrap: RESAMPLES resamples of the 3 matches, seeded by the profile's name, of the p95.
    const byMatch = [[0.01, 0.02, 0.03], [0.1, 0.2, 0.3, 0.4], [1, 2, 3]].map((x) => Float64Array.from(x));
    const boot = bootstrapPercentile(byMatch, 95, resampleCounts(3, RESAMPLES, seedOf(p.name)));
    expect(new Set(boot.replicates).size).toBeGreaterThan(1);
    expect(ball.p95Interval).toEqual(roundTrip({ lo: boot.lo, hi: boot.hi }));
    expect(ball.replicates).toEqual(roundTrip(boot.replicates));
    expect(r.steady.bodies.ball.replicates).toEqual(roundTrip(boot.replicates));
    // The repairs' corrections apart, with their own figures.
    expect([r.repair.count, r.repair.bodies.ball.samples, r.repair.bodies.ball.max]).toEqual([3, 3, 6]);
    expect([r.depth.p50, r.depth.p95, r.depth.max]).toEqual([4, 5, 5]);
    expect(r.late).toMatchObject({ remoteInputs: 4000, count: 8, lateAbsent: 4, lateAbsentShare: 0.001 });
    expect([r.resyncs, r.browserMinutes, r.resyncsPerBrowserMinute]).toEqual([4, 4, 1]);
    expect(r.reach).toEqual({});
  });

  it('carries the reach beside a lossy profile, and the forwarding reach beside a partial mesh', () => {
    const match = played(1, [{ balls: [0.1], repairs: [], depth: 2 }]);
    for (const name of ['pack2-30ms-d2-loss0.5', 'pack4-80ms-d2-blocked1']) {
      const p = profiles().find((x) => x.name === name)!;
      expect(reportOf(p, [match], config).reach, name).toEqual(roundTrip(reachesOf(p, config)));
    }
  });
});

describe("a match's network (§9.2)", () => {
  it("gives every link the profile's latency, jitter and loss, and every browser a clock of its own within ±30 ms and ±0.1%", () => {
    for (const name of ['pack2-30ms-d2-loss0.5', 'pack4-80ms-d2-blocked2']) {
      const p = profiles().find((x) => x.name === name)!;
      const rig = new Rig(p, 3, config);
      expect(rig.nodes, name).toHaveLength(2 * p.packSize);
      // LoopbackNet's link function, private: what each message is carried by.
      const latency = (rig.net as unknown as { latency: (a: string, b: string, now: number) => LinkSpec }).latency;
      for (const a of rig.nodes) for (const b of rig.nodes) if (a !== b) expect(latency(a.id, b.id, 0), `${name}: ${a.id} to ${b.id}`).toEqual(linkSpec(p));
      const clocks = rig.nodes.map((n) => ({ offset: n.local(0), drift: (n.local(1e6) - n.local(0)) / 1e6 - 1 }));
      for (const c of clocks) expect([Math.abs(c.offset) <= 30, Math.abs(c.drift) <= 0.001 + 1e-12], `${name}: ${JSON.stringify(c)}`).toEqual([true, true]);
      expect(new Set(clocks.map((c) => c.offset)).size, `${name}: the offsets`).toBe(clocks.length);
      expect(clocks.every((c) => c.drift !== 0), `${name}: the drifts`).toBe(true);
    }
  });
});
