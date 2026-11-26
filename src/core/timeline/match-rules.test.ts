import { describe, expect, it, vi } from 'vitest';
import { canonicalRules, config, type MatchRules, NO_RULES, RULE_SETTINGS, sameRules } from '../../config';
import { decode, encodeState as encodeStateMessage, NO_TICK, type StateMsg, wireLimits, ZERO_HASH } from '../protocol/messages';
import { netSettings } from '../session/settings';
import { cloneState, defaultParams, encodeInput, encodeState, findTerrier, FRAME_PITCH, hash64, type InputParts, JOIN, type MatchState, paramsFor } from '../sim';
import { HOUSE_RULES } from '../sim/scripts';
import { at, expectAgreement, type Mode, Pump, type PumpNode, sharedHashes, tickOf, twin } from './testing';
import { Timeline } from './timeline';

// A match's rules over the timeline (C-59), on the test pump (M3's design,
// research/m3/DESIGN.md, §3.4, §8.3): genesis writes them into the state,
// so a joiner takes them with its STATE, steps its match under their
// parameters and agrees with the room hash for hash, incrementally and in
// the full replay (twin); a timeline at the build's settings, or at rules
// that are each its setting, holds none and steps with the base's own
// parameters, its genesis byte for byte the build's; and a resync takes no
// STATE of a match under other rules, though the votes named its hash.

// Matches in virtual time, twice for the full replay: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const WIRE = wireLimits();
const D = NET.timeline.delay;
const W = NET.timeline.window;
const V = NET.timeline.voteWindow;
const MATCH = 'c59c59c59c59c59c';

const playerId = (k: number): string => (0xc0 + k).toString(16).padStart(32, '0');

const pump = (mode: Mode): Pump => new Pump({ mode, ids: playerId });

/** A quiet timeline's way out: nobody to hear it. */
const nowhere = { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} };

/** A person's wandering input, from its node and local tick, as timeline.test.ts's: a step that
 *  changes every 16 ticks, held most of the time, zoomies in spells, and a jump and a pounce now and
 *  then, so the rules' speeds, meter, jump and pounce all act. */
function wander(k: number, t: Timeline): () => number {
  return () => {
    const n = t.localTick;
    const p: InputParts = { frame: FRAME_PITCH, zoomies: ((n >> 7) + k) % 3 === 0, jump: (n >> 6) & 3, pounce: (n >> 8) & 3 };
    if (((n >> 5) + k) % 4 !== 0) p.step = ((n >> 4) * 7 + k * 5) & 31;
    return encodeInput(p);
  };
}

/** n plays in pack from its input on: JOIN, then its wandering input. */
function joins(n: PumpNode, pack: number): void {
  n.t.sending = true;
  n.t.controls = wander(n.k, n.t);
  n.t.queueEvent(n.id, { events: JOIN, joinPack: pack, coat: n.k, name: `P${n.k}` });
}

describe("a match's rules over the timeline (C-59)", () => {
  /** How long the joiner plays, once caught up. */
  const PLAYS_MS = 1500;

  it("come to a joiner with its STATE: its final state, its head and its parameters the match's, hash for hash with the room's", () => {
    const run = twin(pump, (q) => {
      const [a, b] = [q.add(), q.add()];
      for (const n of [a, b]) {
        n.t.start(0, { packSize: 2, matchMinutes: 1, rules: HOUSE_RULES }, MATCH);
        joins(n, n.k);
      }
      expect(sameRules(a.t.final.rules, HOUSE_RULES)).toBe(true);
      expect(a.t.params).toBe(paramsFor(HOUSE_RULES, P));
      q.run(1000);
      const c = q.add();
      // Before it holds the match, its placeholder's: none, and the configuration's own parameters.
      expect(c.t.final.rules).toBe(NO_RULES);
      expect(c.t.params).toBe(P);
      c.t.requestState(a.peer);
      q.until(() => c.t.started, 1000);
      // From the STATE on, the match's: its rules, frozen, every state held sharing them, and their parameters.
      expect(c.t.final.rules).toEqual(HOUSE_RULES);
      expect(Object.isFrozen(c.t.final.rules)).toBe(true);
      for (const s of [c.t.head, c.t.prevHead]) expect(s.rules).toBe(c.t.final.rules);
      expect(c.t.params).toBe(paramsFor(HOUSE_RULES, P));
      for (const x of [c.t.params.base, c.t.cfg.P]) expect(x).toBe(P);
      // Its warm-up and catch-up done, it plays too.
      q.run(600);
      expect(c.t.repairing).toBe(false);
      joins(c, 0);
      q.run(PLAYS_MS);
      expect(c.t.head.rules).toBe(c.t.final.rules);
    });
    const [a, b, c] = run.nodes as [PumpNode, PumpNode, PumpNode];
    expect(findTerrier(a.t.final, c.id)).toBeGreaterThanOrEqual(0);
    expect(run.nodes.map((n) => sameRules(n.t.final.rules, HOUSE_RULES))).toEqual([true, true, true]);
    for (const n of [b, c]) expect(n.t.params).toBe(a.t.params);
    // Every final tick the three hold, over the time the joiner played and more: one hash each.
    expectAgreement(run.nodes, 1);
    expect(sharedHashes(run.nodes, 1).length).toBeGreaterThan(PLAYS_MS / NET.tickMs);
    expect([c.t.stats.disagree, c.t.stats.resyncs, a.t.stats.statesSent]).toEqual([0, 0, 1]);
    expect(c.t.stats.agree).toBeGreaterThan(0);
  });

  it("are none at the build's settings, or at rules that are each its setting: its parameters, and its genesis byte for byte", () => {
    const lone = (rules?: MatchRules): Timeline => {
      const t = new Timeline({ ...NET.timeline, P, me: playerId(9), verify: 1 }, nowhere);
      t.start(0, rules === undefined ? { packSize: 2, matchMinutes: 1 } : { packSize: 2, matchMinutes: 1, rules }, MATCH);
      t.advance(at(30));
      return t;
    };
    // Every rule at the build's own setting, which a match never writes.
    const own: Record<string, number> = {};
    for (const k of RULE_SETTINGS) own[k] = config[k];
    const [plain, same, house] = [lone(), lone(own), lone(HOUSE_RULES)];
    for (const t of [plain, same]) {
      expect(t.final.rules).toBe(NO_RULES);
      expect(t.params).toBe(P);
    }
    expect([same.hashAt(0), same.finalTick, same.hashAt(same.finalTick)]).toEqual([plain.hashAt(0), plain.finalTick, plain.hashAt(plain.finalTick)]);
    // House rules: the match's own parameters over the configuration's, and a genesis of their own.
    expect(house.params).toBe(paramsFor(HOUSE_RULES, P));
    expect(house.params.base).toBe(P);
    expect(house.params.rules).toEqual(HOUSE_RULES);
    expect(house.hashAt(0)).not.toBe(plain.hashAt(0));
    for (const s of [house.head, house.prevHead]) expect(s.rules).toBe(house.final.rules);
    for (const t of [plain, same, house]) expect(t.stats.verifyMismatches).toBe(0);
  });
});

describe("a resync's STATE under other rules (§3.4, C-59)", () => {
  /** A match under house rules, this browser in it with two remote players, x and y, whose TICKs the
   *  test writes: they join at once, hold nothing, and at g vote for the hash of this browser's final
   *  state there with the ball given a push and the rules given, so this browser loses g's tally 2 to
   *  1 and asks x for that state. Returns the timeline, x's STATE of it, decoded as it arrives, its
   *  hash, the time, and the test's ticks on from there, x and y voting no more. */
  function lostTo(rules: MatchRules): { t: Timeline; state: StateMsg; win: string; now: number; tickTo: (to: number) => void } {
    const asked: string[] = [];
    const me = playerId(1);
    const t = new Timeline({ ...NET.timeline, P, me, verify: 1 }, { ...nowhere, sendToPlayer: (player) => (asked.push(player), true) });
    t.start(0, { packSize: 2, matchMinutes: 1, rules: HOUSE_RULES }, MATCH);
    t.sending = true;
    t.queueEvent(me, { events: JOIN, joinPack: 0, coat: 1, name: 'me' });
    const [x, y] = [playerId(2), playerId(3)];
    const held = new Map<number, number>();
    let n = 0;
    const tickTo = (to: number, vote: [number, string] = [NO_TICK, ZERO_HASH]): void => {
      while (n < to) {
        n++;
        t.advance(at(n));
        held.set(n + D, 0);
        for (const [id, pack] of [[x, 1], [y, 0]] as const) {
          const m = tickOf(held, n + D, [], ...vote);
          if (n === 1) m.own!.events.push({ back: 0, events: JOIN, joinPack: pack, coat: 2, name: id.slice(-2) });
          t.onTick(id, m, at(n), true);
        }
      }
    };
    tickTo(52);
    const g = t.finalTick;
    expect([g, t.final.terriers.length]).toEqual([52 - W, 3]);
    const F = cloneState(t.final);
    const theirs: MatchState = { ...F, rules, ball: { ...F.ball, vx: F.ball.vx + 1 } };
    const bytes = encodeState(theirs);
    const win = hash64(bytes);
    tickTo(g + W + V, [g, win]);
    expect([asked, t.repairing]).toEqual([[x], true]);
    // x's STATE at g, its records to g + d holding x and y.
    const inputs = Array.from({ length: D }, () => [x, y].map((player) => ({ player, input: 0, events: 0 })));
    const wire = encodeStateMessage({ timeline: MATCH, senderTick: g, phase: 0, g, senderFinal: g, state: bytes, inputs }, theirs.terriers.map((T) => T.id), WIRE);
    const state = decode(wire.bytes, P, WIRE) as StateMsg;
    expect(state).not.toBeNull();
    return { t, state, win, now: at(n), tickTo };
  }

  it("is refused, though its timeline, its tick, its pack size and its hash are the winner's; the same state under the match's own rules is taken", () => {
    // None, the build's own settings, or house rules with one rule more changed.
    const mass = config.matchRules.ballMassKg.find((v) => v !== config.ballMassKg && v !== HOUSE_RULES.ballMassKg)!;
    const others = [NO_RULES, canonicalRules({ ...HOUSE_RULES, ballMassKg: mass }, config)];
    for (const rules of others) {
      const { t, state, win, now } = lostTo(rules);
      const g = state.g;
      // All but the rules are what the resync asked for.
      expect([state.timeline, state.decoded.packSize, hash64(state.state)]).toEqual([t.id, t.final.packSize, win]);
      expect(sameRules(state.decoded.rules, rules)).toBe(true);
      expect(sameRules(state.decoded.rules, t.final.rules)).toBe(false);
      expect(t.onState('peer-x', state, 0, now)).toBe(false);
      // Not taken: the resync still waits, the history and the rules as they were.
      expect([t.repairing, t.hashAt(g) === win, t.stats.resyncs]).toEqual([true, false, 0]);
      expect(sameRules(t.final.rules, HOUSE_RULES)).toBe(true);
    }
    // The same state, the match's rules its own, is taken, and the repair completes.
    const { t, state, win, now, tickTo } = lostTo(HOUSE_RULES);
    expect(t.onState('peer-x', state, 0, now)).toBe(true);
    expect(t.hashAt(state.g)).toBe(win);
    tickTo(state.g + 3 * W + V);
    expect([t.repairing, t.stats.resyncs, t.stats.verifyMismatches]).toEqual([false, 1, 0]);
    expect(sameRules(t.final.rules, HOUSE_RULES)).toBe(true);
    expect(t.params).toBe(paramsFor(HOUSE_RULES, P));
  });
});
