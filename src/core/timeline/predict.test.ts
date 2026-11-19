import { describe, expect, it, vi } from 'vitest';
import { botId } from '../bot/bot-id';
import { decode, type Message, NO_TICK, T, type Tick, wireLimits, ZERO_HASH } from '../protocol/messages';
import { netSettings } from '../session/settings';
import {
  barkCount, cloneState, defaultParams, encodeInput, findTerrier, FRAME_PITCH, hash64, hashState, IN_PLAY, JOIN, KEPT_BITS,
  type MatchState, NEVER, READY, type TickInput,
} from '../sim';
import { Timeline, type TimelineConfig, type TimelineOut } from './timeline';

// Prediction (design §2.2, §2.5, §8.3; PLAN D-10, D-11, M3-Q12): silent
// terriers predicted absent, and sitting in the predicted state; a press
// acted once, a TICK lost and filled from a later TICK's history included;
// the marks; barks never forcing a rollback; own inputs and bots recorded
// when sent. Each scenario runs twice, incremental and as a full replay,
// with every chain verified after every advance and the drawn head's
// contract checked after each.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const WIRE = wireLimits();
const D = NET.timeline.delay;
const W = NET.timeline.window;
const MATCH = '0123456789abcdef';

const playerId = (k: number): string => (0xb0 + k).toString(16).padStart(32, '0');

// --- A pump: timelines in virtual time over FIFO links with latency and jitter ---

type Mode = 'incremental' | 'fullReplay';

interface Node {
  readonly k: number;
  readonly id: string;
  readonly peer: string;
  readonly t: Timeline;
  next: number;
  frozen: boolean;
  lastHeadTick: number;
  held: [Readonly<MatchState>, string][];
  /** Each advance's head, with its tick, outside a repair. */
  readonly heads: { readonly tick: number; readonly state: MatchState }[];
}

type Rule = (from: Node, to: Node, m: Message) => number | null;

interface Post {
  readonly at: number;
  readonly from: Node;
  readonly to: Node;
  readonly bytes: Uint8Array;
}

class Pump {
  now = 0;
  readonly mode: Mode;
  readonly nodes: Node[] = [];
  readonly trace: string[] = [];
  readonly problems: string[] = [];
  latency = 70;
  jitter = 20;
  rules: Rule[] = [];
  private queue: Post[] = [];
  private seq = 0;
  private readonly lastAt = new Map<string, number>();

  constructor(mode: Mode) {
    this.mode = mode;
  }

  add(over: Partial<TimelineConfig> = {}): Node {
    const k = this.nodes.length;
    const self: { node: Node | null } = { node: null };
    const out: TimelineOut = {
      broadcast: (bytes) => {
        for (const to of this.nodes) if (to !== self.node) this.post(self.node!, to, bytes);
      },
      sendToPlayer: (player, bytes) => {
        const to = this.nodes.find((n) => n.id === player);
        if (to !== undefined) this.post(self.node!, to, bytes);
        return to !== undefined;
      },
      sendToPeer: (peer, bytes) => {
        const to = this.nodes.find((n) => n.peer === peer);
        if (to !== undefined) this.post(self.node!, to, bytes);
      },
    };
    const t = new Timeline({ ...NET.timeline, P, me: playerId(k), mode: this.mode, verify: 1, ...over }, out);
    const node: Node = { k, id: playerId(k), peer: `peer-${k}`, t, next: 0, frozen: false, lastHeadTick: -1, held: [], heads: [] };
    self.node = node;
    this.nodes.push(node);
    return node;
  }

  private post(from: Node, to: Node, bytes: Uint8Array): void {
    const m = decode(bytes, P, WIRE)!;
    let extra = 0;
    for (const rule of this.rules) {
      const x = rule(from, to, m);
      if (x === null) {
        this.trace.push(`${this.now} ${from.k}>${to.k} dropped`);
        return;
      }
      extra += x;
    }
    const link = `${from.k}>${to.k}`;
    const seq = this.seq++;
    const jitter = ((seq * 2654435761) >>> 0) % (this.jitter + 1);
    const at = Math.max(this.now + this.latency + jitter + extra, this.lastAt.get(link) ?? 0);
    this.lastAt.set(link, at);
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.at > at) i--;
    this.queue.splice(i, 0, { at, from, to, bytes });
    this.trace.push(`${this.now} ${link} ${hash64(bytes)}`);
  }

  run(ms: number, each?: () => void): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now++;
      const keep: Post[] = [];
      while (this.queue.length > 0 && this.queue[0]!.at <= this.now) {
        const q = this.queue.shift()!;
        if (q.to.frozen) keep.push(q);
        else this.dispatch(q);
      }
      if (keep.length > 0) this.queue.unshift(...keep);
      for (const n of this.nodes) {
        if (n.frozen || this.now < n.next) continue;
        n.next = this.now + NET.timerMs;
        const steps = n.t.stats.steps;
        const calm = n.t.started && !n.t.repairing;
        n.t.advance(this.now);
        // The full replay recomputes its whole window from F each advance outside a repair (D-11).
        if (this.mode === 'fullReplay' && calm && !n.t.repairing && n.t.stats.steps - steps < n.t.localTick - n.t.finalTick) {
          this.problems.push(`${n.k} at ${this.now}: ${n.t.stats.steps - steps} steps, not the window's ${n.t.localTick - n.t.finalTick}`);
        }
        this.check(n);
      }
      each?.();
    }
  }

  private dispatch(q: Post): void {
    const m = decode(q.bytes, P, WIRE)!;
    if (m.type === T.TICK) q.to.t.onTick(q.from.id, m, this.now, true);
    else if (m.type === T.STATE_REQ) q.to.t.onStateReq(q.from.peer, m, this.now);
    else if (m.type === T.STATE) q.to.t.onState(q.from.peer, m, this.latency, this.now);
  }

  private check(n: Node): void {
    const t = n.t;
    if (!t.started) return;
    if (t.head === t.final || t.prevHead === t.final) this.problems.push(`${n.k} at ${this.now}: the drawn head is F`);
    if (t.headTick < n.lastHeadTick) this.problems.push(`${n.k} at ${this.now}: the head moved back`);
    // The state drawn is the head's tick's, and the one before it no later: never an older state swapped in.
    if (t.head.tick !== t.headTick || t.prevHead.tick > t.headTick) {
      this.problems.push(`${n.k} at ${this.now}: the head shows ${t.head.tick}, prevHead ${t.prevHead.tick}, at ${t.headTick}`);
    }
    n.lastHeadTick = t.headTick;
    const held: [Readonly<MatchState>, string][] = [];
    for (const s of [t.head, t.prevHead]) {
      const h = hashState(s);
      const seen = n.held.find(([o]) => o === s);
      if (seen !== undefined && seen[1] !== h) this.problems.push(`${n.k} at ${this.now}: a drawn state was written`);
      held.push([s, h]);
    }
    n.held = held;
    const last = n.heads[n.heads.length - 1];
    if (!t.repairing && (last === undefined || last.tick !== t.headTick || hashState(last.state) !== held[0]![1])) {
      n.heads.push({ tick: t.headTick, state: cloneState(t.head) });
    }
  }
}

/** The scenario in both modes: the same messages and heads, every chain verified, the head's contract kept. */
function twin(scenario: (p: Pump) => void): Pump {
  const inc = new Pump('incremental');
  scenario(inc);
  const full = new Pump('fullReplay');
  scenario(full);
  for (const p of [inc, full]) {
    expect(p.problems).toEqual([]);
    for (const n of p.nodes) expect(n.t.stats.verifyMismatches, `${p.mode} ${n.k}`).toBe(0);
  }
  // The full replay steps every final, reusing none (D-11).
  for (const n of full.nodes) expect([n.t.stats.reusedFinals, n.t.stats.steppedFinals > 0], `${n.k}`).toEqual([0, true]);
  expect(full.trace).toEqual(inc.trace);
  for (const n of inc.nodes) {
    const heads = (q: Pump): string[] => q.nodes[n.k]!.heads.map((h) => `${h.tick} ${hashState(h.state)}`);
    expect(heads(full)).toEqual(heads(inc));
    for (let g = n.t.finalTick - NET.timeline.history + 1; g <= n.t.finalTick; g++) {
      expect(full.nodes[n.k]!.t.hashAt(g)).toBe(n.t.hashAt(g));
    }
  }
  return inc;
}

function starts(n: Node, packSize = 1): void {
  n.t.start(0, { packSize, matchMinutes: 1 }, MATCH);
}

/** n plays in pack, holding `input(localTick)`. */
function plays(n: Node, pack: number, input: (tick: number) => number, ready: boolean, packSize = 1): void {
  starts(n, packSize);
  n.t.sending = true;
  n.t.controls = () => input(n.t.localTick);
  n.t.queueEvent(n.id, { events: JOIN | (ready ? READY : 0), joinPack: pack, coat: n.k, name: `P${n.k}` });
}

/** What the inside of a timeline shows its tests: the chain's entries and their inputs (§2.1). */
interface Inside {
  validTo: number;
  entryAt(u: number): { readonly tick: number; readonly state: MatchState; readonly used: readonly TickInput[] } | null;
}
const inside = (t: Timeline): Inside => t as unknown as Inside;
const usedBy = (t: Timeline, u: number, id: string): TickInput | undefined => inside(t).entryAt(u)?.used.find((x) => x.id === id);

/** One sender's TICK for t with these inputs by tick, from its newest back through the history. */
function tickOf(inputs: ReadonlyMap<number, number>, t: number): Tick {
  let present = 0;
  const hist: number[] = [];
  for (let k = 0; k < NET.timeline.inputHistory; k++) {
    const v = inputs.get(t - 1 - k);
    if (v !== undefined) present |= 1 << k;
    hist.push(v ?? 0);
  }
  return { type: T.TICK, t, own: { input: inputs.get(t) ?? 0, present, hist, events: [] }, voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0, bots: [] };
}

const at = (n: number): number => n * NET.tickMs + 1;

const HELD = encodeInput({ step: 3, frame: FRAME_PITCH });

// --- Silent terriers (D-11) ---

describe('a silent terrier (D-11, D-16)', () => {
  it('is predicted absent once its newest tick is final, sits in the predicted state within the sit threshold plus w, and stands when it returns', () => {
    const watch: { last: number; sitAt: number; standsAt: number } = { last: -1, sitAt: -1, standsAt: -1 };
    const p = twin((q) => {
      const [a, b] = [q.add(), q.add()];
      plays(a, 0, () => HELD, true);
      plays(b, 1, () => HELD, true);
      q.run(7000);
      expect(a.t.final.phase).toBe(IN_PLAY);
      b.t.sending = false;
      q.run(150);
      const last = a.t.newestInput(b.id)!.tick;
      watch.last = last;
      let sitAt = -1;
      q.run(3000, () => {
        const k = findTerrier(a.t.head, b.id);
        const T = a.t.head.terriers[k]!;
        // Predicted absent from the tick after its newest once that's final: never a later input tick.
        if (a.t.finalTick >= last && T.lastInputTick !== last) q.problems.push(`b predicted present at ${a.t.headTick}`);
        if (sitAt < 0 && T.sitting) sitAt = a.t.headTick;
      });
      watch.sitAt = sitAt;
      b.t.sending = true;
      let standsAt = -1;
      q.run(1000, () => {
        const k = findTerrier(a.t.head, b.id);
        if (standsAt < 0 && !a.t.head.terriers[k]!.sitting) standsAt = a.t.headTick;
      });
      watch.standsAt = standsAt;
    });
    const a = p.nodes[0]!.t;
    expect(watch.sitAt).toBeGreaterThanOrEqual(watch.last + P.sitAfterTicks);
    expect(watch.sitAt).toBeLessThanOrEqual(watch.last + P.sitAfterTicks + W);
    expect(watch.standsAt).toBeGreaterThan(watch.sitAt);
    expect(a.final.terriers[findTerrier(a.final, p.nodes[1]!.id)]!.sitting).toBe(false);
    expect(a.stats.disagree).toBe(0);
  });
});

// --- Presses (D-10) ---

describe('a press (D-10)', () => {
  /** b jumps once, at its local tick 150, and holds the counter; a watches. With drop, b's TICK for
   *  the press's tick never reaches a: the next TICK's history fills it. */
  function jumpOnce(q: Pump, drop: boolean): { a: Node; b: Node; press: number } {
    const [a, b] = [q.add(), q.add()];
    const jumped = encodeInput({ jump: 1 });
    starts(a);
    plays(b, 1, (n) => (n >= 150 ? jumped : 0), false);
    const press = 150 + D;
    if (drop) q.rules.push((from, _to, m) => (from.k === 1 && m.type === T.TICK && m.t === press ? null : 0));
    q.run(5000);
    return { a, b, press };
  }

  for (const drop of [false, true]) {
    it(drop ? 'acts once when its TICK is lost and filled from a later TICK\'s history: newest stays at the newer input' : 'acts once under prediction and re-simulation', () => {
      const p = twin((q) => {
        jumpOnce(q, drop);
      });
      const [a, b] = p.nodes as [Node, Node];
      const press = 150 + D;
      // Final: one take-off, at the press's tick.
      const final = a.t.final.terriers[findTerrier(a.t.final, b.id)]!;
      expect(final.takeOffTick).toBe(press);
      expect(a.t.receivedInput(b.id, press)).toBe(encodeInput({ jump: 1 }));
      expect(a.t.newestInput(b.id)!.input).toBe(encodeInput({ jump: 1 }));
      // Every head a drew shows no take-off but the press's: a repeated press would show another.
      const offs = new Set(a.heads.map((h) => h.state.terriers[findTerrier(h.state, b.id)]?.takeOffTick ?? NEVER));
      expect([...offs].sort()).toEqual([press, NEVER].sort());
      // And from the tick b's press reached a on, every head equals the final state at its tick.
      const known = a.heads.filter((h) => h.tick >= press + W && h.tick <= a.t.finalTick && h.tick > a.t.finalTick - NET.timeline.history);
      expect(known.length).toBeGreaterThan(50);
      for (const h of known) expect(hashState(h.state), `head ${h.tick}`).toBe(a.t.hashAt(h.tick));
    });
  }
});

// --- Marks (§2.2) ---

describe('the marks (§2.2)', () => {
  it("predict a catch-up's skipped ticks absent, as finalisation will make them, from the TICK's clear present bits", () => {
    const seen: string[] = [];
    twin((q) => {
      const [a, b] = [q.add(), q.add()];
      starts(a);
      plays(b, 1, () => HELD, false);
      q.run(2000);
      // b's timers stop for 120 ms: on waking it sends its newest 3 ticks, and the rest are absent for good.
      const before = b.t.localTick;
      b.frozen = true;
      q.run(120);
      b.frozen = false;
      q.run(1);
      const after = b.t.localTick;
      const skipped: number[] = [];
      for (let n = before + 1; n <= after - NET.timeline.stallSendTicks; n++) skipped.push(n + D);
      expect(skipped.length).toBeGreaterThanOrEqual(3);
      // Before the burst lands, a predicts those ticks from b's newest input.
      for (const u of skipped) seen.push(`before ${u - before}: ${usedBy(a.t, u, b.id)?.input ?? 'absent'}`);
      const top = after + D;
      while (a.t.newestInput(b.id)!.tick < top) q.run(1);
      // The burst marked them; a's next advance recomputes them without b, while none is final yet.
      q.run(NET.timerMs);
      for (const u of skipped) {
        expect(u).toBeGreaterThan(a.t.finalTick);
        expect(u).toBeLessThanOrEqual(inside(a.t).validTo);
        seen.push(`after ${u - before}: ${usedBy(a.t, u, b.id)?.input ?? 'absent'} ${a.t.receivedInput(b.id, u) ?? 'none'}`);
      }
      q.run(1000);
      for (const u of skipped) expect(a.t.receivedInput(b.id, u)).toBe(undefined);
    });
    // Both runs saw the same: each skipped tick predicted from b's newest input before, and absent after.
    const half = seen.length / 2;
    const n = half / 2;
    expect(seen.slice(half)).toEqual(seen.slice(0, half));
    for (const run of [seen.slice(0, half), seen.slice(half)]) {
      expect(run.slice(0, n).every((x) => x.endsWith(`: ${HELD}`))).toBe(true);
      expect(run.slice(n).every((x) => x.endsWith(': absent none'))).toBe(true);
    }
  });
});

// --- Barks (M3-Q12) ---

describe('barks (D-16, M3-Q12)', () => {
  it('never force a rollback: the simulation takes inputs masked to the kept bits, and receivedInput keeps the counter', () => {
    const counts: { rollbacks: number; corrections: number } = { rollbacks: -1, corrections: -1 };
    const p = twin((q) => {
      const [a, b] = [q.add(), q.add()];
      starts(a);
      // Held, with a bark every 16 ticks.
      plays(b, 1, (n) => HELD | encodeInput({ bark: (n >> 4) & 3 }), false);
      q.run(1500);
      const r = a.t.stats.rollbacks;
      const c = a.t.stats.corrections;
      q.run(4000);
      // The full replay recomputes, and so replaces, its whole window every advance.
      if (q.mode === 'incremental') {
        counts.rollbacks = a.t.stats.rollbacks - r;
        counts.corrections = a.t.stats.corrections - c;
      }
    });
    expect(counts).toEqual({ rollbacks: 0, corrections: 0 });
    const [a, b] = p.nodes as [Node, Node];
    const barks = new Set<number>();
    for (let u = a.t.finalTick - 100; u <= a.t.finalTick; u++) {
      const x = a.t.receivedInput(b.id, u)!;
      expect(x & KEPT_BITS).toBe(HELD);
      barks.add(barkCount(x));
    }
    expect(barks.size).toBe(4);
  });
});

// --- Own inputs (§2.2, §2.4) ---

describe('own inputs and hosted bots (§2.2, §2.4)', () => {
  it('are recorded when sent, for tick n + d, and never predicted', () => {
    const problems: string[] = [];
    twin((q) => {
      const a = q.add();
      plays(a, 0, (n) => encodeInput({ step: n & 31, bark: n & 3 }), false, 2);
      const bot = botId(a.id, 0);
      a.t.bots.set(bot, () => encodeInput({ step: a.t.headTick & 31 }));
      a.t.queueEvent(bot, { events: JOIN, joinPack: 1, coat: 3, name: 'Bot' });
      q.run(2000, () => {
        const t = a.t;
        if (t.localTick === 0) return;
        const top = t.localTick + D;
        if (t.receivedInput(a.id, top) !== encodeInput({ step: t.localTick & 31, bark: t.localTick & 3 })) problems.push(`own ${top}`);
        if (t.receivedInput(bot, top) === undefined) problems.push(`bot ${top}`);
        // Every predicted tick took the own inputs as recorded, masked.
        for (let u = t.finalTick + 1; u <= inside(t).validTo; u++) {
          const x = usedBy(t, u, a.id);
          if (findTerrier(t.final, a.id) >= 0 && x?.input !== (t.receivedInput(a.id, u)! & KEPT_BITS)) problems.push(`predicted own ${u}`);
        }
      });
      expect(a.t.final.terriers.length).toBe(2);
    });
    expect(problems).toEqual([]);
  });

  it('repeat the newest input in a prediction with no events (§2.2)', () => {
    const t = new Timeline({ ...NET.timeline, P, me: playerId(0), verify: 1 }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    const b = playerId(1);
    const inputs = new Map<number, number>();
    const send = (n: number, events: number): void => {
      inputs.set(n, HELD);
      const m = tickOf(inputs, n);
      if (events !== 0) m.own!.events.push({ back: 0, events, ...(events & JOIN ? { joinPack: 1, coat: 0, name: 'b' } : {}) });
      t.onTick(b, m, at(n - D), true);
    };
    for (let n = 1; n <= 30; n++) {
      t.advance(at(n));
      send(n + D, n === 1 ? JOIN : 0);
    }
    // b's newest input, for 33, carries READY; a has predicted 31 and 32 and goes on to 36.
    send(33, READY);
    for (let n = 31; n <= 36; n++) t.advance(at(n));
    expect(t.newestInput(b)).toEqual({ tick: 33, input: HELD });
    expect([usedBy(t, 33, b)?.input, usedBy(t, 33, b)?.events]).toEqual([HELD, READY]);
    for (let u = 34; u <= 36; u++) expect([usedBy(t, u, b)?.input, usedBy(t, u, b)?.events]).toEqual([HELD, 0]);
    expect(t.stats.verifyMismatches).toBe(0);
  });
});
