import { describe, expect, it, vi } from 'vitest';
import { botId } from '../bot/bot-id';
import {
  decode, encodeState as encodeStateMessage, NO_TICK, type StateMsg, T, type Tick, wireLimits, ZERO_HASH,
} from '../protocol/messages';
import { netSettings } from '../session/settings';
import {
  decodeState, defaultParams, encodeInput, encodeState, findTerrier, FRAME_PITCH, genesis, hash64, hashState,
  type InputParts, JOIN, LEAVE, makeSim, type MatchState, READY, step, type TickInput,
} from '../sim';
import { sceneInputs, sceneStart, WALL_SCRUM } from '../sim/scenes';
import { GOLDEN_SCRIPTS, scriptTickInputs } from '../sim/scripts';
import { at, expectAgreement, inside, type Mode, Pump, type PumpNode, tickOf, twin } from './testing';
import { Timeline, type TimelineConfig } from './timeline';

// The timeline over the test pump, no transport (design §2, §3, §8.3): a
// decoded state stepping as its original; the joiner's warm-up; the late
// boundary on the clock; what a STATE_REQ is answered with; the votes a
// voter sent before it knew it lost; the LEAVE a STATE wiped out; pause,
// reanchor and the catch-up; and the correction observer.
// timeline-match.test.ts has three browsers and a bot in agreement, against
// a full replay, and a resync with its votes (design §13's 8 s a file). Every timeline verifies its chain after every
// advance (verify: 1), and the pump checks the drawn head's contract after
// each: never F, never moved back, never written while drawn (testing.ts).

// Whole matches in virtual time, twice each for the full replay: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const WIRE = wireLimits();
const D = NET.timeline.delay;
const W = NET.timeline.window;
const V = NET.timeline.voteWindow;
const MATCH = 'feedfacecafebeef';

const playerId = (k: number): string => (0xa0 + k).toString(16).padStart(32, '0');

// --- The pump (testing.ts): timelines in virtual time, with latency, jitter and FIFO links ---

type Node = PumpNode;

/** A pump of this file's players, keeping their corrections. */
const pump = (mode: Mode = 'incremental'): Pump => new Pump({ mode, ids: playerId, corrections: true });

/** A person's wandering input, from its node and local tick: a step that changes every 16 ticks,
 *  held most of the time, zoomies in spells, a jump and a pounce now and then, and a bark counter
 *  that turns every 8 ticks, which the simulation never reads. */
function wander(k: number, t: Timeline): () => number {
  return () => {
    const n = t.localTick;
    const p: InputParts = { frame: FRAME_PITCH, zoomies: ((n >> 7) + k) % 3 === 0, jump: (n >> 6) & 3, pounce: (n >> 8) & 3, bark: (n >> 3) & 3 };
    if (((n >> 5) + k) % 4 !== 0) p.step = ((n >> 4) * 7 + k * 5) & 31;
    return encodeInput(p);
  };
}

/** n starts from one genesis and plays in a pack: JOIN, and READY if asked. */
function plays(n: Node, pack: number, ready = true, packSize = 2): void {
  n.t.start(0, { packSize, matchMinutes: 1 }, MATCH);
  n.t.sending = true;
  n.t.controls = wander(n.k, n.t);
  n.t.queueEvent(n.id, { events: JOIN | (ready ? READY : 0), joinPack: pack, coat: n.k, name: `P${n.k}` });
}

// --- §2.9 ---

describe('snapshots kept and restored exactly (§2.9)', () => {
  it('steps a decoded state beside its original, hash by hash: the wall scrum and the kickoff scripts, 600 ticks', () => {
    const runs: { name: string; s: MatchState; inputs: (s: Readonly<MatchState>, t: number) => TickInput[] }[] = [
      { name: WALL_SCRUM.name, s: sceneStart(WALL_SCRUM, P), inputs: (s, t) => sceneInputs(WALL_SCRUM, s, t, []) },
      ...GOLDEN_SCRIPTS.filter((spec) => spec.name.startsWith('mirrored kickoff')).map((spec) => ({
        name: spec.name,
        s: genesis({ packSize: spec.packSize, matchMinutes: spec.matchMinutes }, P),
        inputs: (s: Readonly<MatchState>, t: number) => scriptTickInputs(spec, t, s, []),
      })),
    ];
    expect(runs.length).toBe(5);
    const mismatches: string[] = [];
    for (const run of runs) {
      const sim = makeSim(P, run.s.packSize);
      const original = run.s;
      let copy = decodeState(encodeState(original), P)!;
      for (let t = 1; t <= 600; t++) {
        const ins = run.inputs(original, t);
        step(sim, original, ins);
        step(sim, copy, ins);
        if (hashState(copy) !== hashState(original)) mismatches.push(`${run.name} at ${t}`);
        // A copy decoded mid-run, as a STATE's, steps on the same.
        if (t % 100 === 0) copy = decodeState(encodeState(original), P)!;
      }
      expect(encodeState(copy)).toEqual(encodeState(original));
    }
    expect(mismatches).toEqual([]);
  });
});

// --- Joining (§3.4) ---

describe("the joiner's warm-up (§3.4, roslambo M0)", () => {
  function joining(q: Pump): { a: Node; b: Node; c: Node } {
    const a = q.add();
    const b = q.add();
    plays(a, 0, false);
    plays(b, 1, false);
    q.run(2000);
    const c = q.add();
    c.t.requestState(a.peer);
    return { a, b, c };
  }

  it('holds finalisation until every active sender is heard, takes the inputs in flight, and votes once a tally agrees', () => {
    const p = twin(pump, (q) => {
      const { c } = joining(q);
      q.until(() => c.t.started, 1000);
      // In warm-up: final at the STATE's tick, nothing confirmed, no vote.
      expect(c.t.repairing).toBe(true);
      const g = c.t.finalTick;
      expect(c.t.localTick).toBeGreaterThan(g + W);
      // Its warm-up, then the spread of its catch-up, done within 1 s. The full replay steps every
      // final, so a catch-up over the spread's cap ends later there (twin): both runs wait the same.
      q.run(1000);
      expect(c.t.repairing).toBe(false);
      // Every active sender heard, well before warmupMs runs out.
      expect(c.t.stats.warmMs).toBeGreaterThan(0);
      expect(c.t.stats.warmMs).toBeLessThan(NET.timeline.warmupMs);
      c.t.sending = true;
      c.t.controls = wander(c.k, c.t);
      c.t.queueEvent(c.id, { events: JOIN, joinPack: 0, coat: 2, name: 'late' });
      q.run(3000);
    });
    const [a, , c] = p.nodes as [Node, Node, Node];
    expectAgreement(p.nodes);
    expect(findTerrier(c.t.final, c.id)).toBeGreaterThanOrEqual(0);
    expect(c.t.stats.agree).toBeGreaterThan(0);
    expect([c.t.stats.disagree, c.t.stats.resyncs, a.t.stats.statesSent]).toEqual([0, 0, 1]);
    // Its first vote came after a tally agreed: the other two counted it from then on.
    expect(c.t.isConfirmed(c.t.finalTick - V)).toBe(true);
  });

  it('never trusts a tally whose votes went out before it joined: a wrong joiner whose resyncs fail stays silent (§3.1, §3.4)', () => {
    const q = pump();
    const [a, b] = [q.add(), q.add()];
    plays(a, 0, false);
    plays(b, 1, false);
    q.run(2000);
    // a's timers wake once a second: asked just before it wakes, it gives a STATE a second old, so the
    // joiner's first tallies are for ticks whose votes went out before it held the timeline.
    a.pace = 1000;
    q.run(900);
    const c = q.add();
    // A wrong state adopted, a float off, and no STATE_REQ of c's reaching anyone once it holds one.
    const take = c.t.onState.bind(c.t);
    c.t.onState = (peer, m, oneWayMs, now) => {
      (m.decoded as MatchState).ball.vx += 1;
      return take(peer, m, oneWayMs, now);
    };
    let votes = 0;
    q.rules.push((from, _to, m) => {
      if (from !== c) return 0;
      if (m.type === T.STATE_REQ && c.t.started) return null;
      if (m.type === T.TICK && m.voteTick !== NO_TICK) votes++;
      return 0;
    });
    c.t.requestState(a.peer);
    q.until(() => c.t.started, 1000);
    const joinedAt = c.t.localTick;
    expect(c.t.finalTick).toBeLessThan(joinedAt - W - V);
    c.t.sending = true;
    c.t.controls = wander(c.k, c.t);
    c.t.queueEvent(c.id, { events: JOIN, joinPack: 0, coat: 2, name: 'late' });
    q.run(4000);
    expect(findTerrier(c.t.final, c.id)).toBeGreaterThanOrEqual(0);
    expect(c.t.stats.disagree).toBeGreaterThan(0);
    expect(c.t.stats.resyncFailed).toBeGreaterThan(0);
    expect([c.t.stats.agree, c.t.stats.resyncs, votes]).toEqual([0, 0, 0]);
  });

  it('trusts itself as the lone voter once its tallies reach ticks whose votes could all reach it (§3.2)', () => {
    const q = pump();
    const k = q.add();
    // The keeper watches: no terrier, so no vote.
    k.t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
    q.run(1000);
    const j = q.add();
    j.t.requestState(k.peer);
    q.until(() => j.t.started, 1000);
    j.t.sending = true;
    j.t.controls = wander(j.k, j.t);
    j.t.queueEvent(j.id, { events: JOIN, joinPack: 0, coat: 1, name: 'solo' });
    let votes = 0;
    q.rules.push((from, _to, m) => {
      if (from === j && m.type === T.TICK && m.voteTick !== NO_TICK) votes++;
      return 0;
    });
    q.run(3000);
    expect(votes).toBeGreaterThan(100);
    expect([j.t.isConfirmed(j.t.finalTick - V), j.t.stats.disagree]).toEqual([true, 0]);
    expect(k.t.stats.agree).toBeGreaterThan(100);
  });

  it('takes only a STATE it asked for (§4.10)', () => {
    const got: StateMsg[] = [];
    const giver = new Timeline({ ...NET.timeline, P, me: playerId(7) }, {
      broadcast: () => {}, sendToPlayer: () => false, sendToPeer: (_p, bytes) => got.push(decode(bytes, P, WIRE) as StateMsg),
    });
    expect(giver.onStateReq('x', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, 0)).toBe(false); // nothing to give yet
    giver.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
    giver.advance(500);
    expect(giver.onStateReq('x', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, 500)).toBe(true);
    const joiner = new Timeline({ ...NET.timeline, P, me: playerId(9) }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    expect(joiner.onState('giver', got[0]!, 0, 500)).toBe(false);
    joiner.requestState('giver');
    expect(joiner.onState('stranger', got[0]!, 0, 500)).toBe(false);
    expect(joiner.started).toBe(false);
    expect(joiner.onState('giver', got[0]!, 0, 500)).toBe(true);
    expect([joiner.started, joiner.id, joiner.finalTick, joiner.hashAt(joiner.finalTick)]).toEqual([true, MATCH, giver.finalTick, giver.hashAt(giver.finalTick)]);
    // A started timeline takes no STATE it didn't ask for.
    expect(joiner.onState('giver', got[0]!, 0, 600)).toBe(false);
  });
});

// --- Strings (§5.7) ---

describe("a sender's own JOIN (§2.4, §5.7)", () => {
  it('records its name as receivers decode it: a leading U+FEFF kept, a lone surrogate the empty name', () => {
    for (const name of ['\uFEFFRex', '\uD800ex', 'Ünïcödé 🐕']) {
      const q = pump();
      q.jitter = 0;
      const a = q.add();
      const b = q.add();
      a.t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
      b.t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
      a.t.sending = true;
      a.t.queueEvent(a.id, { events: JOIN, joinPack: 0, coat: 1, name });
      q.run(1500);
      const k = findTerrier(a.t.final, a.id);
      expect(k).toBe(0);
      expect(a.t.final.terriers[0]!.name).toBe(name.startsWith('\uD800') ? '' : name);
      expectAgreement(q.nodes);
      expect(b.t.final.terriers[0]!.name).toBe(a.t.final.terriers[0]!.name);
      // Its own record of the JOIN, ridden in tick 1 + d, holds what b's does, not only the terrier's name.
      const record = (n: Node): string | undefined => inside(n.t).store.get(a.id, 1 + D)?.name;
      expect([record(a), record(b)]).toEqual([a.t.final.terriers[0]!.name, a.t.final.terriers[0]!.name]);
    }
  });

  it('sends the later of two payloads of a kind queued before one input (§2.4)', () => {
    const sent: Tick[] = [];
    const me = playerId(0);
    const t = new Timeline({ ...NET.timeline, P, me, verify: 1 }, {
      broadcast: (bytes) => sent.push(decode(bytes, P, WIRE) as Tick), sendToPlayer: () => false, sendToPeer: () => {},
    });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    t.sending = true;
    t.queueEvent(me, { events: JOIN, joinPack: 0, coat: 1, name: 'first' });
    t.queueEvent(me, { events: JOIN | READY, joinPack: 1, coat: 2, name: 'second' });
    t.advance(at(1));
    expect(sent.map((m) => m.own!.events)).toEqual([[{ back: 0, events: JOIN | READY, joinPack: 1, coat: 2, name: 'second' }]]);
    t.advance(at(1 + D + W));
    expect(t.final.terriers.map((x) => [x.pack, x.coat, x.name])).toEqual([[1, 2, 'second']]);
  });
});

// --- The late boundary (§2.8) ---

describe('the late boundary (§2.8)', () => {
  it('is max(finalTick, ⌊clock⌋ − w) outside a warm-up: a page whose timers slept drops what every other peer finalised absent', () => {
    const t = new Timeline({ ...NET.timeline, P, me: playerId(0) }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    const b = playerId(1);
    t.advance(at(40));
    const f = t.finalTick;
    expect(f).toBe(40 - W);
    // The clock reads 100 now, but the page hasn't advanced: finalTick is still 28.
    const now = at(100);
    const inputs = new Map<number, number>([[60, 7], [61, 7]]);
    t.onTick(b, tickOf(inputs, 61), now, true);
    // Both at or before 100 − w: late here as everywhere, though after finalTick.
    expect([t.receivedInput(b, 60), t.receivedInput(b, 61)]).toEqual([undefined, undefined]);
    expect(t.stats.late).toBe(1);
    expect(t.stats.lateBy[Math.min(100 - W - 61, NET.timeline.inputHistory - 1)]).toBe(1);
    // Inside the window it's kept, and past 2w + d ahead of the clock it's dropped.
    t.onTick(b, tickOf(new Map([[100 - W + 1, 3]]), 100 - W + 1), now, true);
    expect(t.receivedInput(b, 100 - W + 1)).toBe(3);
    t.onTick(b, tickOf(new Map([[100 + 2 * W + D + 1, 3]]), 100 + 2 * W + D + 1), now, true);
    expect(t.receivedInput(b, 100 + 2 * W + D + 1)).toBe(undefined);
    expect(t.finalTick).toBe(f);
    // At the edges (§2.5, §2.12): an own input at lo itself is late, one tick late, and one at lo − 2
    // three; one at hi itself is kept.
    const lo = 100 - W;
    const hi = 100 + 2 * W + D;
    const [c, e, x, y, z] = [2, 3, 4, 5, 6].map(playerId) as [string, string, string, string, string];
    const late = t.stats.late;
    const lateBy = [...t.stats.lateBy];
    t.onTick(c, tickOf(new Map([[lo, 7]]), lo), now, true);
    t.onTick(e, tickOf(new Map([[lo - 2, 7]]), lo - 2), now, true);
    t.onTick(x, tickOf(new Map([[hi, 5]]), hi), now, true);
    expect([t.receivedInput(c, lo), t.receivedInput(e, lo - 2), t.receivedInput(x, hi), t.stats.late - late]).toEqual([undefined, undefined, 5, 2]);
    const bins = new Array<number>(NET.timeline.inputHistory).fill(0);
    bins[0] = 1;
    bins[2] = 1;
    expect(t.stats.lateBy.map((n, k) => n - lateBy[k]!)).toEqual(bins);
    // An event keeps to the same window: a JOIN riding 20 ticks back, past the history, for lo is
    // dropped, and one for lo + 1 makes a record events alone made, which joins at finalisation.
    for (const [id, u] of [[y, lo], [z, lo + 1]] as const) {
      const m = tickOf(new Map([[u + 20, 1]]), u + 20);
      m.own!.events.push({ back: 20, events: JOIN, joinPack: 0, coat: 0, name: 'j' });
      t.onTick(id, m, now, true);
    }
    t.advance(at(lo + 1 + W));
    expect(t.finalTick).toBe(lo + 1);
    expect([findTerrier(t.final, y), findTerrier(t.final, z)]).toEqual([-1, 0]);
  });

  it('stays finalTick in a warm-up, which takes the inputs in flight', () => {
    const giverOut: { state: StateMsg | null } = { state: null };
    const giver = new Timeline({ ...NET.timeline, P, me: playerId(0) }, {
      broadcast: () => {}, sendToPlayer: () => false, sendToPeer: (_p, bytes) => (giverOut.state = decode(bytes, P, WIRE) as StateMsg),
    });
    giver.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    const b = playerId(1);
    // b's JOIN at 35, after the STATE's tick, makes it an active sender there: the joiner warms up. A
    // sender outside the roster without one is in no STATE (H5).
    giver.advance(at(30));
    giver.onTick(b, tickOf(new Map([[35, 1]]), 35, [{ back: 0, events: JOIN, joinPack: 0, coat: 0, name: 'b' }]), at(30), true);
    giver.advance(at(40));
    giver.onStateReq('joiner', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, at(40));
    const j = new Timeline({ ...NET.timeline, P, me: playerId(2) }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    j.requestState('giver');
    // 200 ms on the way: the joiner's clock reads the giver's and 12 ticks more.
    expect(j.onState('giver', giverOut.state!, 200, at(40))).toBe(true);
    expect(j.repairing).toBe(true);
    const g = j.finalTick;
    expect(g).toBe(40 - W);
    const lo = Math.floor(j.clock(at(40))) - W;
    expect(lo).toBeGreaterThan(g + 1);
    // Past ⌊clock⌋ − w, which would make them late outside a warm-up, inputs for g + 1 and lo are taken.
    j.onTick(b, tickOf(new Map([[g + 1, 9], [lo, 9]]), lo), at(40), true);
    expect([j.receivedInput(b, g + 1), j.receivedInput(b, lo), j.stats.late]).toEqual([9, 9, 0]);
    // b heard, the warm-up ends at the next advance, which re-simulates from g + 1 at the spread's
    // cap, as do timer runs after it whose clock doesn't move, until the chain reaches the head
    // (§2.8); then the clock's boundary holds again.
    j.advance(at(40));
    expect(j.warming).toBe(false);
    const runs = Math.ceil((j.localTick - g) / NET.timeline.spreadCap);
    for (let k = 1; k < runs; k++) j.advance(at(40));
    expect(j.repairing).toBe(false);
    const f = j.finalTick;
    // Five ticks on, without an advance: f + 1 is at or before ⌊clock⌋ − w, and in the TICK's history.
    const now = at(45);
    const late = Math.floor(j.clock(now)) - W;
    expect([late > f + 1, late + 1 - (f + 1) <= NET.timeline.inputHistory]).toEqual([true, true]);
    j.onTick(b, tickOf(new Map([[f + 1, 4], [late + 1, 4]]), late + 1), now, true);
    expect([j.receivedInput(b, f + 1), j.receivedInput(b, late + 1), j.stats.late]).toEqual([undefined, 4, 0]);
  });
});

// --- Who may speak (§4.10), votes' window (§2.12) and late inputs (§9.3) ---

describe('what a TICK may say (§2.5, §2.12, §4.10)', () => {
  function watcher(): { t: Timeline; me: string; mine: string } {
    const me = playerId(0);
    const t = new Timeline({ ...NET.timeline, P, me }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
    const mine = botId(me, 0);
    t.bots.set(mine, () => 0);
    return { t, me, mine };
  }

  it('is never about this browser or its bots, and speaks for a bot only from its host', () => {
    const { t, me, mine } = watcher();
    const [b, c] = [playerId(1), playerId(2)];
    t.advance(at(5));
    const inputs = new Map([[8, 5]]);
    t.onTick(me, tickOf(inputs, 8), at(5), true);
    t.onTick(mine, tickOf(inputs, 8), at(5), true);
    expect([t.stats.received, t.receivedInput(me, 8), t.receivedInput(mine, 8)]).toEqual([0, undefined, undefined]);
    const m = tickOf(inputs, 8);
    const entry = (id: string, input: number) => ({ id, input, present: 0, hist: new Array<number>(NET.timeline.inputHistory).fill(0), events: [] });
    m.bots.push(entry(botId(b, 1), 6), entry(botId(c, 0), 7), entry(mine, 8));
    t.onTick(b, m, at(5), true);
    expect([t.receivedInput(b, 8), t.receivedInput(botId(b, 1), 8), t.receivedInput(botId(c, 0), 8), t.receivedInput(mine, 8)]).toEqual([5, 6, undefined, undefined]);
    expect(t.heardAt(b)).toBe(at(5));
    // The last arrival, not the first.
    t.onTick(b, tickOf(inputs, 9), at(6), false);
    expect([t.heardAt(b), t.heardAt(c)]).toEqual([at(6), undefined]);
  });

  it('books a vote only inside (finalTick − history, ⌊clock⌋ + w]', () => {
    const { t } = watcher();
    const b = playerId(1);
    t.advance(at(300));
    const f = t.finalTick;
    const book = inside(t).book;
    const h = 'aaaaaaaaaaaaaaaa';
    for (const g of [f - NET.timeline.history, f - NET.timeline.history + 1, f + 1, 300 + W, 300 + W + 1]) t.onTick(b, tickOf(new Map(), 300 + D, [], g, h), at(300), true);
    expect([f - NET.timeline.history, f - NET.timeline.history + 1, f + 1, 300 + W, 300 + W + 1].map((g) => book.voters(g, h, '').length)).toEqual([0, 1, 1, 1, 0]);
  });

  it('counts an input that came after its tick was finalised absent, once for each (sender, tick) (§9.3)', () => {
    const { t } = watcher();
    const b = playerId(1);
    const inputs = new Map<number, number>();
    const send = (u: number, n: number): void => {
      const m = tickOf(inputs, u);
      if (u === 3) m.own!.events.push({ back: 0, events: JOIN, joinPack: 1, coat: 0, name: 'b' });
      t.onTick(b, m, at(n), true);
    };
    for (let n = 1; n <= 28; n++) {
      t.advance(at(n));
      inputs.set(n + D, 1);
      send(n + D, n);
    }
    // b's TICKs for 31 and 32 are held up: both are finalised absent here.
    inputs.set(31, 1);
    inputs.set(32, 1);
    inputs.set(33, 1);
    inputs.set(34, 1);
    for (let n = 29; n <= 44; n++) t.advance(at(n));
    expect([t.finalTick, t.receivedInput(b, 31)]).toEqual([32, undefined]);
    send(33, 44);
    send(34, 44);
    expect([t.stats.lateAbsent, t.stats.late]).toEqual([2, 0]);
    // The held TICK for 32 itself, at last: late, and its pair counted already.
    send(32, 44);
    expect([t.stats.lateAbsent, t.stats.late]).toEqual([2, 1]);
    expect(t.final.terriers.length).toBe(1);
  });
});

// --- STATE_REQ (§3.4) ---

describe('a STATE_REQ (§3.4)', () => {
  function giver(): { t: Timeline; sent: StateMsg[] } {
    const sent: StateMsg[] = [];
    const t = new Timeline({ ...NET.timeline, P, me: playerId(0) }, {
      broadcast: () => {}, sendToPlayer: () => false, sendToPeer: (_p, bytes) => sent.push(decode(bytes, P, WIRE) as StateMsg),
    });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    return { t, sent };
  }

  it('is answered with the newest final state, or a held final tick with the hash asked for, and nothing else', () => {
    const { t, sent } = giver();
    t.advance(at(100));
    const f = t.finalTick;
    const req = (tick: number, want: string): boolean => t.onStateReq('p', { type: T.STATE_REQ, tick, want }, at(100));
    expect(req(NO_TICK, ZERO_HASH)).toBe(true);
    expect(req(f - 10, t.hashAt(f - 10))).toBe(true);
    expect(req(f - 11, ZERO_HASH)).toBe(true);
    expect(req(f - 10, t.hashAt(f - 9))).toBe(false); // another hash
    expect(req(f + 1, ZERO_HASH)).toBe(false); // not final
    expect(req(NO_TICK, t.hashAt(f - 1))).toBe(false); // the newest isn't that
    expect(sent.map((m) => m.g)).toEqual([f, f - 10, f - 11]);
    expect([t.stats.statesSent, t.stats.statesRefused]).toEqual([3, 3]);
    for (const m of sent) {
      expect(hash64(m.state)).toBe(t.hashAt(m.g));
      // The clock, not localTick; records to localTick + d.
      expect([m.senderTick, m.senderFinal, m.inputs.length]).toEqual([100, f, 100 + D - m.g]);
    }
  });

  it('carries events-only records up to its final tick and none after (parts-T6)', () => {
    const { t, sent } = giver();
    const b = playerId(1);
    t.advance(at(20));
    // An event for a tick whose input never came: a record events alone made, at 15 and at 30. Its
    // JOIN, since a sender outside the roster without one is in no STATE (H5).
    for (const u of [15, 30]) {
      const events = [{ back: 20, events: JOIN | READY, joinPack: 0, coat: 0, name: 'b' }];
      t.onTick(b, { ...tickOf(new Map(), u + 20), own: { input: 0, present: 0, hist: new Array<number>(NET.timeline.inputHistory).fill(0), events } }, at(20), true);
    }
    t.advance(at(40));
    expect(t.finalTick).toBe(28);
    t.onStateReq('p', { type: T.STATE_REQ, tick: 10, want: ZERO_HASH }, at(40));
    const m = sent[0]!;
    const players = (u: number): string[] => m.inputs[u - m.g - 1]!.map((x) => x.player);
    expect(players(15)).toEqual([b]); // final here: input 0 with its event
    expect(players(30)).toEqual([]); // not final: its event rides in b's TICKs
  });

  it('is refused while paused, and where the clock fell back below finalTick: stateRecordsMax is −1', () => {
    const { t, sent } = giver();
    t.advance(at(100));
    t.pause(at(100));
    expect([t.answering, t.onStateReq('p', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, at(100))]).toEqual([false, false]);
    t.resume(at(100));
    expect(t.answering).toBe(true);
    // A peer whose clock runs 30 ticks behind: once settled, the median jumps this clock back past finalTick.
    const peer = playerId(5);
    let n = 100;
    while (t.stats.jumps === 0 && n < 400) {
      n++;
      t.onTick(peer, tickOf(new Map(), n - 30 + D), at(n), true);
      t.advance(at(n));
    }
    expect(t.stats.jumps).toBe(1);
    expect(Math.floor(t.clock(at(n)))).toBeLessThan(t.finalTick);
    expect(t.onStateReq('p', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, at(n))).toBe(false);
    expect(sent).toEqual([]);
    expect(t.stats.statesRefused).toBe(2);
    // The resync's case is a network one: below, with the repair.
  });

  it('builds records only up to ⌊clock⌋ + d where the clock fell back below localTick, so it truncates none (D-18, M3 phase 1)', () => {
    const { t, sent } = giver();
    t.advance(at(100));
    // A peer whose clock runs 8 ticks behind: once settled, the median jumps this clock back between finalTick and localTick.
    const peer = playerId(5);
    let n = 100;
    while (t.stats.jumps === 0 && n < 400) {
      n++;
      t.onTick(peer, tickOf(new Map(), n - 8 + D), at(n), true);
      t.advance(at(n));
    }
    expect(t.stats.jumps).toBe(1);
    const clock = Math.floor(t.clock(at(n)));
    expect([clock < t.localTick, clock >= t.finalTick]).toEqual([true, true]);
    expect(t.onStateReq('p', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, at(n))).toBe(true);
    expect([t.stats.statesTruncated, sent[0]!.senderTick, sent[0]!.inputs.length]).toEqual([0, clock, clock + D - t.finalTick]);
  });

  it('on a page whose timers sleep, carries what it took past its stale localTick, to ⌊clock⌋ + d: a JOIN its sender has since finalised (M3 phase 4)', () => {
    const { t, sent } = giver();
    t.advance(at(100));
    // Its timers sleep from here; a player's TICKs keep coming, its JOIN in the TICK for 110 + d, a
    // tick its sender finalises at 110 + d + w, so its later TICKs carry the event no more.
    const peer = playerId(5);
    const inputs = new Map<number, number>();
    for (let n = 101; n <= 160; n++) {
      inputs.set(n + D, 0);
      const events = n >= 110 && n <= 110 + D + W ? [{ back: n - 110, events: JOIN, joinPack: 0, coat: 3, name: 'j' }] : [];
      t.onTick(peer, tickOf(inputs, n + D, events), at(n), true);
    }
    expect(t.localTick).toBe(100);
    expect(t.onStateReq('p', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, at(160))).toBe(true);
    const m = sent[0]!;
    expect([m.senderTick, m.g, m.inputs.length, t.stats.statesTruncated]).toEqual([160, t.finalTick, 160 + D - t.finalTick, 0]);
    const join = m.inputs[110 + D - m.g - 1]!.find((r) => r.player === peer)!;
    expect([join.events & JOIN, join.name]).toEqual([JOIN, 'j']);
    expect(m.inputs.at(-1)!.map((r) => r.player)).toEqual([peer]);
  });
});

// --- The votes a voter sent before it knew it lost (§3.6) ---

describe('the votes a voter sent before it knew it lost (§3.6, M3 phase 4)', () => {
  const g = 60;
  const small = '0000000000000001';

  /** This browser and two remote players, x and y, whose TICKs and votes the test writes: they join at
   *  once and hold nothing. At local n each votes for tick n − w − 1, its final tick then, as this
   *  browser does. Both agree to g; at g x votes another hash and loses 2 to 1; after g, y is silent
   *  and x votes the smallest hash there is, which a tie with this browser's one vote would give x.
   *  With lateX, x's TICKs from the one carrying its vote for g are held until two ticks after g's
   *  tally and then come together, FIFO, as over a slow link: this browser sees x lose only in a late
   *  vote's re-tally. */
  function lostAtG(lateX: boolean): { t: Timeline; asked: string[]; x: string; y: string } {
    const asked: string[] = [];
    const me = playerId(1);
    const t = new Timeline({ ...NET.timeline, P, me, verify: 1 }, {
      broadcast: () => {}, sendToPlayer: (player) => (asked.push(player), true), sendToPeer: () => {},
    });
    t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
    t.sending = true;
    t.queueEvent(me, { events: JOIN, joinPack: 0, coat: 1, name: 'me' });
    const [x, y] = [playerId(2), playerId(3)];
    const vote = (id: string, f: number): string | null => (f < g ? t.hashAt(f) : f === g ? (id === x ? 'ffffffffffffffff' : t.hashAt(f)) : id === x ? small : null);
    const held = new Map<number, number>();
    const late: Tick[] = [];
    for (let n = 1; n <= g + W + 3 * V; n++) {
      t.advance(at(n));
      held.set(n + D, 0);
      const f = n - W - 1;
      for (const [id, pack] of [[x, 1], [y, 0]] as const) {
        const h = f > 0 ? vote(id, f) : null;
        const m = tickOf(held, n + D, [], h === null ? NO_TICK : f, h ?? ZERO_HASH);
        if (n === 1) m.own!.events.push({ back: 0, events: JOIN, joinPack: pack, coat: 2, name: id.slice(-2) });
        if (lateX && id === x && f >= g && n <= g + W + V + 2) late.push(m);
        else t.onTick(id, m, at(n), true);
      }
      if (n === g + W + V + 2) for (const m of late.splice(0)) t.onTick(x, m, at(n), true);
    }
    return { t, asked, x, y };
  }

  const disagreements = (t: Timeline): number[] => t.stats.log.filter(([, e]) => e.startsWith('disagree ')).map(([, e]) => Number(e.slice('disagree '.length)));

  it("aren't counted for the v − 1 ticks after a tally this browser won saw it lose, so a tie with them asks no voter that is resyncing", () => {
    const { t, asked, x } = lostAtG(false);
    // The ties of g + 1 … g + v − 1 aren't, x's votes there uncounted; at g + v it counts again.
    expect(disagreements(t)[0]).toBe(g + V);
    expect(t.agreedTo).toBeGreaterThanOrEqual(g + V - 1);
    expect(asked).toEqual([x]);
    expect(t.stats.verifyMismatches).toBe(0);
  });

  it('nor after a late vote’s re-tally this browser won saw it lose, as when the loser learns late over a slow link', () => {
    const { t, asked, x } = lostAtG(true);
    // g, g + 1 and g + 2 were tallied without x; its votes for them came after, g's first: the re-tally
    // of g sees x lose, so its late votes for g + 1 and g + 2 flip nothing, nor its votes after.
    expect(t.stats.lateVoteFlips).toBe(0);
    expect(disagreements(t)[0]).toBe(g + V);
    expect(asked).toEqual([x]);
    expect(t.stats.verifyMismatches).toBe(0);
  });

  it('answers a voter it asks that is resyncing to it, for a tick before the one it lost, and no other ask while its resync is outstanding (a crossing)', () => {
    const { t, asked, x, y } = lostAtG(false);
    // Its resync for g + v asks x, the voter for the winning hash, and is outstanding.
    expect([asked, t.answering, t.repairing]).toEqual([[x], false, true]);
    const now = at(g + W + 3 * V);
    const ask = (tick: number, player?: string): boolean => t.onStateReq('peer', { type: T.STATE_REQ, tick, want: t.hashAt(tick) }, now, player);
    const sent = t.stats.statesSent;
    // A tick before the one it lost, asked by x: answered. At or after it, its newest final state, or
    // asked by anyone else or with no player named: refused.
    expect(ask(g + V - 1, x)).toBe(true);
    expect([ask(g + V, x), ask(g + V - 1, y), ask(g + V - 1)]).toEqual([false, false, false]);
    expect(t.onStateReq('peer', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, now, x)).toBe(false);
    expect(t.stats.statesSent).toBe(sent + 1);
  });
});

// --- LEAVE (M3 phase 1's answers) ---

describe('a LEAVE a STATE wiped out', () => {
  it('goes again with the next own input: the STATE replaced its tick with an absence', () => {
    const sent: Tick[] = [];
    const asked: string[] = [];
    const me = playerId(1);
    const t = new Timeline({ ...NET.timeline, P, me, verify: 1 }, {
      broadcast: (bytes) => sent.push(decode(bytes, P, WIRE) as Tick),
      sendToPlayer: (player) => (asked.push(player), true),
      sendToPeer: () => {},
    });
    t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
    t.sending = true;
    t.queueEvent(me, { events: JOIN, joinPack: 0, coat: 1, name: 'me' });
    // Two remote players, x and y, whose TICKs the test writes: they join at once and hold nothing.
    const [x, y] = [playerId(2), playerId(3)];
    const held = new Map<number, number>();
    const remote = (n: number, voteTick = NO_TICK, voteHash = ZERO_HASH): void => {
      held.set(n + D, 0);
      for (const [id, pack] of [[x, 1], [y, 0]] as const) {
        const m = tickOf(held, n + D, [], voteTick, voteHash);
        if (n === 1) m.own!.events.push({ back: 0, events: JOIN, joinPack: pack, coat: 2, name: id.slice(-2) });
        t.onTick(id, m, at(n), true);
      }
    };
    let n = 0;
    const tickTo = (to: number, vote: () => [number, string] = () => [NO_TICK, ZERO_HASH]): void => {
      while (n < to) {
        n++;
        t.advance(at(n));
        remote(n, ...vote());
      }
    };
    tickTo(52);
    const g = t.finalTick;
    expect([g, t.final.terriers.length]).toEqual([52 - W, 3]);
    // x and y vote for another state at g, so this browser loses g's tally 2 to 1.
    const theirs = { ...t.final, terriers: t.final.terriers.map((T, k) => (k === 0 ? { ...T, heading: (T.heading + 1) >>> 0 } : { ...T })) };
    const bytes = encodeState(theirs);
    const win = hash64(bytes);
    expect(win).not.toBe(t.hashAt(g));
    tickTo(g + W + V - 4, () => [g, win]);
    t.queueEvent(me, { events: LEAVE });
    tickTo(g + W + V - 3, () => [g, win]);
    const leaveTick = sent[sent.length - 1]!.t;
    expect(sent[sent.length - 1]!.own!.events).toEqual([{ back: 0, events: LEAVE }]);
    tickTo(g + W + V);
    expect(asked).toEqual([x]);
    expect(t.repairing).toBe(true);
    // The winner's STATE: its records at g + 1 … senderFinal hold x and y but not this browser.
    const senderFinal = leaveTick + 1;
    const inputs = Array.from({ length: senderFinal + D - g }, () => [x, y].map((player) => ({ player, input: 0, events: 0 })));
    const wire = encodeStateMessage({ timeline: MATCH, senderTick: senderFinal, phase: 0, g, senderFinal, state: bytes, inputs }, theirs.terriers.map((T) => T.id), WIRE);
    const state = decode(wire.bytes, P, WIRE) as StateMsg;
    expect(t.onState('peer-x', state, 0, at(n))).toBe(true);
    expect(t.hashAt(g)).toBe(win);
    expect(t.receivedInput(me, leaveTick)).toBe(undefined);
    // The next TICK carries the LEAVE again, for its own tick, and no longer the one the STATE wiped out.
    tickTo(n + 1);
    const next = sent[sent.length - 1]!;
    expect(next.t).toBeGreaterThan(senderFinal);
    expect(next.own!.events).toEqual([{ back: 0, events: LEAVE }]);
    tickTo(n + W + 2);
    expect(findTerrier(t.final, me)).toBe(-1);
    // It rode until its tick was final here, and stops there.
    expect(sent[sent.length - 1]!.own!.events).toEqual([{ back: W + 2, events: LEAVE }]);
    tickTo(n + 1);
    expect(sent[sent.length - 1]!.own!.events).toEqual([]);
    expect(t.stats.resyncs).toBe(1);
    expect(t.stats.verifyMismatches).toBe(0);
  });
});

// --- Pause, reanchor and the catch-up (§2.4, §2.13, §4.12) ---

describe('the clock on timers (§2.4, §2.13)', () => {
  function lone(over: Partial<TimelineConfig> = {}): { t: Timeline; ticks: Tick[] } {
    const ticks: Tick[] = [];
    const t = new Timeline({ ...NET.timeline, P, me: playerId(0), verify: 1, ...over }, {
      broadcast: (bytes) => ticks.push(decode(bytes, P, WIRE) as Tick), sendToPlayer: () => false, sendToPeer: () => {},
    });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    t.sending = true;
    return { t, ticks };
  }

  it('pauses frozen, resumes where it stopped, and re-anchors at localTick after a stall', () => {
    const { t, ticks } = lone();
    for (let n = 1; n <= 30; n++) t.advance(at(n));
    expect(t.localTick).toBe(30);
    t.pause(at(30));
    t.advance(at(500));
    expect([t.paused, t.localTick, ticks.length]).toEqual([true, 30, 30]);
    t.resume(at(500));
    t.advance(at(501));
    expect(t.localTick).toBe(31); // nothing caught up across the pause (D-22)
    // A stall: the clock ran on 200 ticks while no timer ran; re-anchored, it goes on from localTick.
    t.reanchor(at(731));
    t.advance(at(731) + 1);
    expect(t.localTick).toBe(31);
    t.advance(at(732) + 1);
    expect(t.localTick).toBe(32);
    expect(ticks.map((m) => m.t)).toEqual(Array.from({ length: 32 }, (_, k) => k + 1 + D));
    // A stall the session decided paused (§4.12), re-anchored with no resume: it runs on from localTick.
    t.pause(at(733));
    t.reanchor(at(900));
    expect(t.paused).toBe(false);
    t.advance(at(901) + 1);
    expect(t.localTick).toBe(33);
    expect(ticks.map((m) => m.t)).toEqual(Array.from({ length: 33 }, (_, k) => k + 1 + D));
    expect(t.stats.verifyMismatches).toBe(0);
  });

  it('sends only the newest stallSendTicks after a catch-up, the rest absent for good; Practice sends every tick (D-22)', () => {
    const { t, ticks } = lone();
    t.advance(at(10));
    t.advance(at(40));
    const sentTicks = ticks.map((m) => m.t);
    const stall = NET.timeline.stallSendTicks;
    expect(sentTicks).toEqual([...Array.from({ length: stall }, (_, k) => 10 - stall + 1 + k), ...Array.from({ length: stall }, (_, k) => 40 - stall + 1 + k)].map((n) => n + D));
    // Its own skipped ticks are absent, as every receiver finalises them.
    const last = ticks[ticks.length - 1]!.own!;
    expect(last.present & 0xff).toBe(0b11);
    expect(t.receivedInput(playerId(0), 20 + D)).toBe(undefined);
    expect(t.receivedInput(playerId(0), 40 + D)).toBe(0);
    const practice = lone({ stallSendTicks: Infinity });
    practice.t.advance(at(40));
    expect(practice.ticks.map((m) => m.t)).toEqual(Array.from({ length: 40 }, (_, k) => k + 1 + D));
  });

  it('says a message handled now was held through a freeze of its timers, as its clock holds TICKs (M3 phase 5a)', () => {
    // d + w ticks overdue, its messages taken first; then within d + w ticks after the late run.
    const { t } = lone();
    let now = 0;
    for (; now <= 1000; now += NET.timerMs) t.advance(now);
    now -= NET.timerMs;
    const freeze = (D + W) * NET.tickMs;
    expect([t.heldNow(now + freeze - 1), t.heldNow(now + freeze + 1)]).toEqual([false, true]);
    t.advance(now + 600);
    expect([t.heldNow(now + 600), t.heldNow(now + 600 + freeze - 1)]).toEqual([true, true]);
    t.advance(now + 604);
    expect(t.heldNow(now + 604)).toBe(false);
  });
});

// --- Corrections (§2.11) ---

describe('the correction observer (§2.11)', () => {
  it("fires for each recomputation of the drawn head's tick, from the earliest tick touched, and repair only from a STATE", () => {
    const q = pump();
    q.latency = 90;
    const [a, b] = [q.add(), q.add()];
    plays(a, 0, false, 1);
    plays(b, 1, false, 1);
    q.run(3000);
    const cs = a.corrections;
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.length).toBe(a.t.stats.corrections);
    for (const c of cs) {
      expect(c.repair).toBe(false);
      expect(c.from).toBeLessThanOrEqual(c.tick);
      expect(c.from).toBeGreaterThan(c.tick - W - D - 8);
      expect([c.before.tick, c.after.tick]).toEqual([c.tick, c.tick]);
    }
    // Most moved something; each is reported whether or not it did.
    expect(cs.some((c) => hashState(c.before) !== hashState(c.after))).toBe(true);
  });
});
