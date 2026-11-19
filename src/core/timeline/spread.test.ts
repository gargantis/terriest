import { describe, expect, it, vi } from 'vitest';
import { botId } from '../bot/bot-id';
import { decode, type Message, NO_TICK, T, wireLimits } from '../protocol/messages';
import { netSettings } from '../session/settings';
import { defaultParams, encodeInput, FRAME_PITCH, hash64, hashState, IN_PLAY, type InputParts, JOIN, type MatchState, READY } from '../sim';
import { Timeline, type TimelineConfig, type TimelineOut } from './timeline';

// The spread (design §2.8, §3.4, §8.3; PLAN D-11, M0): a changed base far
// back, a late-vote repair from 2 s back, re-simulated at spreadCap steps a
// tick. While it runs: each advance's steps within the budget, the drawn
// head held, never moved back and never F, nothing confirmed and no vote
// sent; after it, the chain equal to a full replay's and every hash equal.
// At a cap of w + 1, an ordinary resync spreads too; a hidden page's
// catch-up never does, its budget growing with the ticks its clock moved.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const WIRE = wireLimits();
const W = NET.timeline.window;
const CAP = NET.timeline.spreadCap;
const MATCH = '89abcdef01234567';

const playerId = (k: number): string => (0xd0 + k).toString(16).padStart(32, '0');

type Mode = 'incremental' | 'fullReplay';

interface Node {
  readonly k: number;
  readonly id: string;
  readonly peer: string;
  readonly t: Timeline;
  pace: number;
  next: number;
  lastHeadTick: number;
  held: [Readonly<MatchState>, string][];
  readonly heads: string[];
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
    const node: Node = { k, id: playerId(k), peer: `peer-${k}`, t, pace: NET.timerMs, next: 0, lastHeadTick: -1, held: [], heads: [] };
    self.node = node;
    this.nodes.push(node);
    return node;
  }

  private post(from: Node, to: Node, bytes: Uint8Array): void {
    const m = decode(bytes, P, WIRE)!;
    let extra = 0;
    for (const rule of this.rules) {
      const x = rule(from, to, m);
      if (x === null) return;
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
      while (this.queue.length > 0 && this.queue[0]!.at <= this.now) this.dispatch(this.queue.shift()!);
      for (const n of this.nodes) {
        if (this.now < n.next) continue;
        n.next = this.now + n.pace;
        const steps = n.t.stats.steps;
        const local = n.t.localTick;
        const calm = n.t.started && !n.t.repairing;
        n.t.advance(this.now);
        // The budget: spreadCap for each tick the clock moved, at least one tick's (§2.8).
        const budget = n.t.cfg.spreadCap * Math.max(1, n.t.localTick - local);
        if (n.t.stats.steps - steps > budget) this.problems.push(`${n.k} at ${this.now}: ${n.t.stats.steps - steps} steps over ${budget}`);
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
    const t = q.to.t;
    const steps = t.stats.steps;
    if (m.type === T.TICK) t.onTick(q.from.id, m, this.now, true);
    else if (m.type === T.STATE_REQ) t.onStateReq(q.from.peer, m, this.now);
    else if (m.type === T.STATE) t.onState(q.from.peer, m, this.latency, this.now);
    // Adopting a STATE runs under one tick's budget too.
    if (t.stats.steps - steps > t.cfg.spreadCap) this.problems.push(`${q.to.k} at ${this.now}: a message's ${t.stats.steps - steps} steps`);
  }

  private check(n: Node): void {
    const t = n.t;
    if (!t.started) return;
    if (t.head === t.final || t.prevHead === t.final) this.problems.push(`${n.k} at ${this.now}: the drawn head is F`);
    if (t.headTick < n.lastHeadTick) this.problems.push(`${n.k} at ${this.now}: the head moved back from ${n.lastHeadTick} to ${t.headTick}`);
    // The state drawn is the head's tick's, and the one before it no later: never an older state swapped in.
    if (t.head.tick !== t.headTick || t.prevHead.tick > t.headTick) {
      this.problems.push(`${n.k} at ${this.now}: the head shows ${t.head.tick}, prevHead ${t.prevHead.tick}, at ${t.headTick}`);
    }
    n.lastHeadTick = t.headTick;
    const held: [Readonly<MatchState>, string][] = [];
    for (const s of [t.head, t.prevHead]) {
      const h = hashState(s);
      if (n.held.some(([o, x]) => o === s && x !== h)) this.problems.push(`${n.k} at ${this.now}: a drawn state was written`);
      held.push([s, h]);
    }
    n.held = held;
    if (!t.repairing) {
      const h = `${t.headTick} ${held[0]![1]}`;
      if (n.heads[n.heads.length - 1] !== h) n.heads.push(h);
    }
  }
}

function twin(scenario: (p: Pump) => void): Pump {
  const inc = new Pump('incremental');
  scenario(inc);
  const full = new Pump('fullReplay');
  scenario(full);
  for (const p of [inc, full]) {
    expect(p.problems).toEqual([]);
    for (const n of p.nodes) expect(n.t.stats.verifyMismatches, `${p.mode} ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-6))}`).toBe(0);
  }
  // The full replay steps every final, reusing none (D-11).
  for (const n of full.nodes) expect([n.t.stats.reusedFinals, n.t.stats.steppedFinals > 0], `${n.k}`).toEqual([0, true]);
  expect(full.trace).toEqual(inc.trace);
  for (const n of inc.nodes) {
    expect(full.nodes[n.k]!.heads).toEqual(n.heads);
    for (let g = n.t.finalTick - NET.timeline.history + 1; g <= n.t.finalTick; g++) expect(full.nodes[n.k]!.t.hashAt(g)).toBe(n.t.hashAt(g));
  }
  return inc;
}

function wander(k: number, t: Timeline): () => number {
  return () => {
    const n = t.localTick;
    const p: InputParts = { frame: FRAME_PITCH, zoomies: ((n >> 6) + k) % 3 === 0, jump: (n >> 7) & 3, bark: (n >> 3) & 3 };
    if (((n >> 5) + k) % 4 !== 0) p.step = ((n >> 4) * 7 + k * 9) & 31;
    return encodeInput(p);
  };
}

function plays(n: Node, pack: number, ready: boolean): void {
  n.t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
  n.t.sending = true;
  n.t.controls = wander(n.k, n.t);
  n.t.queueEvent(n.id, { events: JOIN | (ready ? READY : 0), joinPack: pack, coat: n.k, name: `P${n.k}` });
}

/** Three players and a bot their third hosts, at 2 a side: the packs fill, so with READY the match
 *  starts. b, the second, verifies its chain after every advance, the others after every 8th. */
function match(q: Pump, over: Partial<TimelineConfig> = {}, ready = true): Node[] {
  const nodes = [q.add({ verify: 8, ...over }), q.add({ verify: 1, ...over }), q.add({ verify: 8, ...over })];
  nodes.forEach((n, k) => plays(n, k % 2, ready));
  const host = nodes[2]!;
  const bot = botId(host.id, 0);
  host.t.bots.set(bot, () => encodeInput({ step: (host.t.headTick >> 5) & 31, frame: FRAME_PITCH }));
  host.t.queueEvent(bot, { events: JOIN | (ready ? READY : 0), joinPack: 1, coat: 7, name: 'Bot' });
  return nodes;
}

function expectAgreement(nodes: readonly Node[]): void {
  const lo = Math.max(...nodes.map((n) => n.t.finalTick - NET.timeline.history + 1));
  const hi = Math.min(...nodes.map((n) => n.t.finalTick));
  expect(hi - lo).toBeGreaterThan(100);
  for (let g = lo; g <= hi; g++) expect(new Set(nodes.map((n) => n.t.hashAt(g))).size, `tick ${g}`).toBe(1);
}

/** What b showed while repairing: its resync outstanding, then its STATE's steps spread. */
interface During {
  repairingMs: number;
  spreadMs: number;
  heldAt: number[];
  confirmed: number;
  voted: number;
  alphaBelow1: number;
}

const during = (): During => ({ repairingMs: 0, spreadMs: 0, heldAt: [], confirmed: 0, voted: 0, alphaBelow1: 0 });

/** Three players in play; then every TICK from a and c to b is held back by `delayMs` once, FIFO
 *  holding the rest behind it: b finalises their inputs absent, votes alone, and once the burst lands
 *  their late votes flip its tallies and it repairs from far back. b's timer runs every paceB ms. */
function lateFlip(q: Pump, delayMs: number, seen: During, over: Partial<TimelineConfig> = {}, inPlay = true, paceB: number = NET.timerMs): void {
  const nodes = match(q, over, inPlay);
  // Play begins once the start countdown ends, 5 s after the last READY.
  q.run(inPlay ? 5500 : 1500);
  expect(nodes[0]!.t.final.phase === IN_PLAY).toBe(inPlay);
  const b = nodes[1]!;
  b.pace = paceB;
  const delayed = new Set<number>();
  q.rules.push((from, to, m) => {
    if (to === b && from !== b && m.type === T.TICK && !delayed.has(from.k)) {
      delayed.add(from.k);
      return delayMs;
    }
    return 0;
  });
  q.rules.push((from, _to, m) => {
    if (from === b && m.type === T.TICK && m.voteTick !== NO_TICK && b.t.repairing) seen.voted++;
    return 0;
  });
  // The repair under way: a STATE adopted, its re-finalisation not caught up (§3.4's steps 3 and 4).
  const spreading = (): boolean => (b.t as unknown as { repair: object | null }).repair !== null;
  q.run(delayMs + 1500, () => {
    const t = b.t;
    if (!t.repairing) return;
    seen.repairingMs++;
    if (t.isConfirmed(t.finalTick) || t.isConfirmed(0)) seen.confirmed++;
    if (!spreading()) return;
    seen.spreadMs++;
    if (seen.heldAt[seen.heldAt.length - 1] !== t.headTick) seen.heldAt.push(t.headTick);
    // The drawing pauses on the held head: alpha is 1 once the clock is past it.
    if (t.headTick < t.localTick && t.alpha(q.now) < 1) seen.alphaBelow1++;
  });
}

describe('a late-vote repair from 2 s back (§2.8, §3.4)', () => {
  it('runs at the cap: within each advance\'s budget, the head held and never F, nothing confirmed and no vote sent, then equal to a full replay', () => {
    const runs: During[] = [];
    const p = twin((q) => {
      runs.push(during());
      lateFlip(q, 2000, runs[runs.length - 1]!);
    });
    expect(runs[1]).toEqual(runs[0]);
    const seen = runs[0]!;
    const [a, b, c] = p.nodes as [Node, Node, Node];
    const st = b.t.stats;
    expect(st.lateVoteFlips).toBeGreaterThan(0);
    expect(st.resyncs).toBe(1);
    // About 2 s of ticks re-finalised: well past one tick's budget, so spread over several advances.
    expect(st.spreadTicks).toBeGreaterThanOrEqual(2);
    expect(st.maxStepsPerAdvance).toBe(CAP);
    expect(seen.repairingMs).toBeGreaterThan(seen.spreadMs);
    expect(seen.spreadMs).toBeGreaterThan(0);
    // The drawn head held at one tick throughout the spread, then moved on, forward.
    expect(seen.heldAt.length).toBe(1);
    expect([seen.confirmed, seen.voted, seen.alphaBelow1]).toEqual([0, 0, 0]);
    // The repair's correction, from the STATE's tick.
    expect(st.corrections).toBeGreaterThan(0);
    expect([a.t.stats.resyncs, c.t.stats.resyncs, a.t.stats.disagree, c.t.stats.disagree]).toEqual([0, 0, 0, 0]);
    expectAgreement(p.nodes);
    expect(b.t.isConfirmed(b.t.finalTick - NET.timeline.voteWindow)).toBe(true);
  });
});

describe('the cap (§2.8, §10)', () => {
  it('at w + 1 spreads an ordinary resync too, here in warm-up, and the chain after it is a full replay\'s', () => {
    const runs: During[] = [];
    const p = twin((q) => {
      runs.push(during());
      lateFlip(q, 600, runs[runs.length - 1]!, { spreadCap: W + 1 }, false);
    });
    expect(runs[1]).toEqual(runs[0]);
    const b = p.nodes[1]!.t;
    expect(b.stats.resyncs).toBe(1);
    expect(b.stats.spreadTicks).toBeGreaterThanOrEqual(2);
    expect(b.stats.maxStepsPerAdvance).toBe(W + 1);
    expect([runs[0]!.confirmed, runs[0]!.voted, runs[0]!.heldAt.length]).toEqual([0, 0, 1]);
    expectAgreement(p.nodes);
  });

  it('holds the head across ticks on a page whose timer runs once a tick, and counts those advances in holds', () => {
    const runs: During[] = [];
    const p = twin((q) => {
      runs.push(during());
      lateFlip(q, 600, runs[runs.length - 1]!, { spreadCap: W + 1 }, false, NET.tickMs);
    });
    expect(runs[1]).toEqual(runs[0]);
    const [a, b, c] = p.nodes.map((n) => n.t) as [Timeline, Timeline, Timeline];
    expect(b.stats.resyncs).toBe(1);
    // A few ticks of the cap's steps, the clock moving each advance while the head held: never back, never F.
    expect([runs[0]!.heldAt.length, runs[0]!.voted, runs[0]!.alphaBelow1]).toEqual([1, 0, 0]);
    expect([b.stats.holds >= 2, a.stats.holds, c.stats.holds]).toEqual([true, 0, 0]);
    expectAgreement(p.nodes);
  });
});

describe('a hidden page (§2.8, D-31)', () => {
  it("catches up in one advance a second: its budget grows with the ticks its clock moved, so it's never spread", () => {
    const p = twin((q) => {
      const nodes = match(q, {}, false);
      q.run(1500);
      nodes[2]!.pace = 1000;
      q.run(4000);
      nodes[2]!.pace = NET.timerMs;
      q.run(500);
    });
    const h = p.nodes[2]!.t;
    expect(h.stats.spreadTicks).toBe(0);
    expect(h.stats.maxStepsPerAdvance).toBeGreaterThan(CAP);
    expect(h.stats.maxStepsPerAdvance).toBeLessThanOrEqual(CAP * 61);
    for (const n of p.nodes) expect([n.t.stats.disagree, n.t.stats.resyncs]).toEqual([0, 0]);
    expectAgreement(p.nodes);
  });
});
