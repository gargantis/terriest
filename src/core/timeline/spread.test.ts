import { describe, expect, it, vi } from 'vitest';
import { botId } from '../bot/bot-id';
import { NO_TICK, T } from '../protocol/messages';
import { netSettings } from '../session/settings';
import { encodeInput, FRAME_PITCH, IN_PLAY, type InputParts, JOIN, READY } from '../sim';
import { inside, type Mode, Pump, type PumpNode, twin } from './testing';
import { Timeline, type TimelineConfig } from './timeline';

// The spread (design §2.8, §3.4, §8.3; PLAN D-11, M0): a changed base far
// back, a late-vote repair from 2 s back, re-simulated at spreadCap steps a
// tick. While it runs: each advance's steps within the budget, the drawn
// head held, never moved back and never F, nothing confirmed and no vote
// sent; after it, the chain equal to a full replay's and every hash equal.
// At a cap of w + 1, an ordinary resync spreads too; a hidden page's
// catch-up never does, its budget growing with the ticks its clock moved.
// The pump checks the budget and the head after each advance and message
// (testing.ts).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const W = NET.timeline.window;
const CAP = NET.timeline.spreadCap;
const MATCH = '89abcdef01234567';

const playerId = (k: number): string => (0xd0 + k).toString(16).padStart(32, '0');

type Node = PumpNode;

/** A pump of this file's players. */
const pump = (mode: Mode): Pump => new Pump({ mode, ids: playerId });

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
  const spreading = (): boolean => inside(b.t).repair !== null;
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
    const p = twin(pump, (q) => {
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
    const p = twin(pump, (q) => {
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
    const p = twin(pump, (q) => {
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
    const p = twin(pump, (q) => {
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
