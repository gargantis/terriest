import { describe, expect, it, vi } from 'vitest';
import {
  decode, encodeState as encodeStateMessage, type InputRecord, NO_TICK, type StateMsg, type Tick, type TickEvent, wireLimits, ZERO_HASH,
} from '../protocol/messages';
import { netSettings } from '../session/settings';
import { defaultParams, encodeInput, encodeState, findTerrier, FRAME_PITCH, hash64, JOIN, READY, type TickInput } from '../sim';
import { at, inside, type Mode, tickOf, twin, usedBy, Watch } from './testing';
import { type Correction, Timeline } from './timeline';

// Rollback (design §2.6, §2.7, §8.3; PLAN D-11): every way a predicted
// tick's inputs or base can change, forced alone on one timeline with a
// remote sender whose TICKs the test writes: where the chain is cut, the
// earliest tick re-simulated, a held input that cuts nothing, and the reuse
// of a predicted final. Each runs incremental and as a full replay, the two
// heads and final chains compared tick by tick, with every chain verified
// after every advance (verify: 1): testing.ts's watch and twin.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const WIRE = wireLimits();
const D = NET.timeline.delay;
const W = NET.timeline.window;
const V = NET.timeline.voteWindow;
const H = NET.timeline.inputHistory;
const MATCH = 'abcdef0123456789';

const playerId = (k: number): string => (0xc0 + k).toString(16).padStart(32, '0');

const HELD = encodeInput({ step: 3, frame: FRAME_PITCH });
const TAP = encodeInput({ step: 20, frame: FRAME_PITCH });
/** b's TICK for t reaches this timeline once its local tick is t − d + LAG: so it has predicted t. */
const LAG = 4;

/** A spectator's timeline, a, and a remote player b, whose TICKs the test writes from its inputs. */
class Solo {
  readonly mode: Mode;
  readonly t: Timeline;
  readonly b = playerId(1);
  /** b's inputs by tick: what its TICKs carry, history included. */
  readonly inputs = new Map<number, number>();
  readonly asked: string[] = [];
  readonly problems: string[] = [];
  /** The drawn head's contract after every advance, every advance's head, and the corrections. */
  readonly watch = new Watch(this.problems, { everyHead: true, corrections: true });
  n = 0;

  constructor(mode: Mode) {
    this.mode = mode;
    this.t = new Timeline({ ...NET.timeline, P, me: playerId(0), mode, verify: 1 }, {
      broadcast: () => {},
      sendToPlayer: (player) => {
        this.asked.push(player);
        return true;
      },
      sendToPeer: () => {},
    });
    this.t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    this.watch.adopt(this.t);
  }

  /** The run's one node, as twin reads it. */
  get nodes(): readonly Solo[] {
    return [this];
  }

  get corrections(): readonly Correction[] {
    return this.watch.corrections;
  }

  /** Advances a tick at a time to local tick n, the watch checking after each: the drawn head's
   *  contract, and that the full replay recomputes its whole window from F each advance outside a
   *  repair (D-11). */
  advanceTo(n: number): void {
    while (this.n < n) {
      this.n++;
      const b = this.watch.before(this.t);
      this.t.advance(at(this.n));
      this.watch.advanced(this.t, `${this.n}`, b);
    }
  }

  /** b's TICK for t, as its inputs say, with these events and vote. */
  tickOf(t: number, events: TickEvent[] = [], voteTick = NO_TICK, voteHash = ZERO_HASH): Tick {
    return tickOf(this.inputs, t, events, voteTick, voteHash);
  }

  send(t: number, events: TickEvent[] = [], from = this.b, vote: [number, string] = [NO_TICK, ZERO_HASH]): void {
    this.t.onTick(from, this.tickOf(t, events, ...vote), at(this.n), true);
  }

  /** b joins at tick 3 and holds HELD; its TICKs arrive LAG ticks after their send. To local n. */
  playTo(n: number, vote: (t: number) => [number, string] = () => [NO_TICK, ZERO_HASH]): void {
    while (this.n < n) {
      this.advanceTo(this.n + 1);
      const t = this.n + D - LAG;
      if (t < 3) continue;
      this.inputs.set(t, HELD);
      this.send(t, t === 3 ? [{ back: 0, events: JOIN, joinPack: 1, coat: 2, name: 'b' }] : [], this.b, vote(t));
    }
  }

  /** Timer runs at this local tick, its clock not moving, while a spread is pending (§2.8), the watch
   *  checking after each: how many it took. */
  spreadOut(): number {
    let runs = 0;
    while (this.t.repairing && runs < 1000) {
      const b = this.watch.before(this.t);
      this.t.advance(at(this.n));
      this.watch.advanced(this.t, `${this.n}`, b);
      runs++;
    }
    return runs;
  }

  validTo(): number {
    return inside(this.t).validTo;
  }

  touchedFrom(): number {
    return inside(this.t).touchedFrom;
  }

  usedBy(u: number, id = this.b): TickInput | undefined {
    return usedBy(this.t, u, id);
  }
}

/** A path run incremental and as a full replay, as twin compares them, with the same observations.
 *  The incremental run's timeline and observations. */
function both<T>(path: (s: Solo) => T): { s: Solo; seen: T } {
  const seen: T[] = [];
  const s = twin((mode) => new Solo(mode), (x) => {
    seen.push(path(x));
  });
  expect(seen[1]).toEqual(seen[0]);
  return { s, seen: seen[0] as T };
}

/** The corrections fired since `since`, as [tick, from, repair]. */
const firedSince = (s: Solo, since: number): [number, number, boolean][] => s.corrections.slice(since).map((c) => [c.tick, c.from, c.repair]);

describe('a record (§2.7)', () => {
  it('written at u in the chain, unlike its prediction, cuts the chain at u: a lost TICK filled from the history', () => {
    const { s, seen } = both((s) => {
      const seen: number[][] = [];
      s.playTo(60);
      expect([s.t.finalTick, s.validTo(), s.t.newestInput(s.b)!.tick]).toEqual([60 - W, 60, 58]);
      // b tapped at 59, but that TICK was lost; the one for 60 brings it in its history.
      s.inputs.set(59, TAP);
      s.inputs.set(60, HELD);
      s.advanceTo(62);
      const fired = s.corrections.length;
      s.send(60);
      // The newest value stayed HELD, so the tap's record alone cut the chain.
      seen.push([s.validTo(), s.touchedFrom()]);
      s.advanceTo(63);
      seen.push(...firedSince(s, fired).map(([tick, from]) => [tick, from]));
      expect(s.usedBy(59)?.input).toBe(TAP);
      return seen;
    });
    expect(seen).toEqual([[58, 59], [62, 59]]);
    expect(s.t.stats.rollbacks).toBeGreaterThan(0);
  });

  it('equal to its prediction, the common held input, cuts nothing', () => {
    const { seen } = both((s) => {
      const seen: number[][] = [];
      s.playTo(60);
      const fired = s.corrections.length;
      s.advanceTo(61);
      s.inputs.set(59, HELD);
      s.send(59);
      seen.push([s.validTo(), s.touchedFrom(), s.corrections.length - fired]);
      return seen;
    });
    expect(seen).toEqual([[61, Infinity, 0]]);
  });

  it('merged with an event, a changed payload, cuts the chain at its tick', () => {
    const { seen } = both((s) => {
      const seen: number[][] = [];
      s.playTo(60);
      s.advanceTo(61);
      s.inputs.set(59, HELD);
      // The TICK for 59 adds READY to b's input at 57, which a already holds with no event.
      s.send(59, [{ back: 2, events: READY }]);
      seen.push([s.validTo(), s.touchedFrom()]);
      s.advanceTo(62);
      seen.push([s.usedBy(57)!.events]);
      return seen;
    });
    expect(seen).toEqual([[56, 57], [READY]]);
  });
});

describe('a mark (§2.2, §2.7)', () => {
  it('where prediction had the sender cuts the chain: a catch-up that skipped ticks', () => {
    const { seen } = both((s) => {
      const seen: number[][] = [];
      s.playTo(60);
      // b's timers slept: it sent nothing for 59, 60 and 61, and its TICK for 62 says it has none there.
      s.inputs.set(62, HELD);
      s.advanceTo(64);
      expect([s.usedBy(59)?.input, s.usedBy(61)?.input]).toEqual([HELD, HELD]);
      s.send(62);
      seen.push([s.validTo(), s.touchedFrom()]);
      s.advanceTo(65);
      seen.push([59, 60, 61].map((u) => (s.usedBy(u) === undefined ? 0 : 1)));
      return seen;
    });
    expect(seen).toEqual([[58, 59], [0, 0, 0]]);
  });

  it('where prediction had no input from the sender cuts nothing', () => {
    const { seen } = both((s) => {
      const seen: number[][] = [];
      s.playTo(60);
      // c isn't in the match: its TICK, all its history marked absent, changes no predicted tick.
      const c = playerId(2);
      const v = s.validTo();
      s.inputs.set(v + 1, HELD);
      for (let k = 0; k < H; k++) s.inputs.delete(v - k);
      s.send(v + 1, [], c);
      seen.push([s.validTo() - v, s.touchedFrom()]);
      return seen;
    });
    expect(seen).toEqual([[0, Infinity]]);
  });
});

describe('the value a terrier is predicted with (§2.7)', () => {
  it('changed with a gap before the newest tick that no record or mark covers: cut from the gap, and the base changes at finalisation', () => {
    const { seen } = both((s) => {
      const seen: number[][] = [];
      s.playTo(60);
      // b's TICKs for 59 to 62 never came; its TICK for 79 holds a new input and covers 63 to 78 only.
      for (let t = 63; t <= 78; t++) s.inputs.set(t, HELD);
      s.inputs.set(79, TAP);
      s.advanceTo(66);
      const stepped = s.t.stats.steppedFinals;
      s.send(79);
      seen.push([s.validTo(), s.touchedFrom()]);
      s.advanceTo(67);
      seen.push([59, 60, 61, 62].map((u) => s.usedBy(u)!.input));
      // Finalised absent where it was predicted from its newest: each a changed base, stepped.
      s.advanceTo(62 + W);
      seen.push([s.t.stats.steppedFinals - stepped >= 4 ? 1 : 0]);
      for (const u of [59, 62]) expect(s.t.receivedInput(s.b, u)).toBe(undefined);
      return seen;
    });
    expect(seen).toEqual([[58, 59], [TAP, TAP, TAP, TAP], [1]]);
  });

  it('of a sender falling silent changes once finalTick reaches its newest tick: absent from there', () => {
    const { seen } = both((s) => {
      const seen: number[][] = [];
      s.playTo(60);
      const newest = s.t.newestInput(s.b)!.tick;
      // Silent from here on: predicted from its newest input until that's final, then absent.
      s.advanceTo(newest + W - 1);
      expect(s.usedBy(newest + 1)?.input).toBe(HELD);
      const fired = s.corrections.length;
      s.advanceTo(newest + W);
      expect(s.t.finalTick).toBe(newest);
      seen.push(...firedSince(s, fired).map(([tick, from]) => [tick, from]));
      seen.push([newest + 1, newest + W].map((u) => (s.usedBy(u) === undefined ? 0 : 1)));
      const k = findTerrier(s.t.head, s.b);
      seen.push([s.t.head.terriers[k]!.lastInputTick - newest]);
      return seen;
    });
    const newest = 60 + D - LAG;
    // The correction names the head's tick before it moved, from the tick after the newest.
    expect(seen).toEqual([[newest + W - 1, newest + 1], [0, 0], [0]]);
  });
});

describe('a STATE (§2.7, §3.4)', () => {
  it('replaces the base at g: the whole chain is re-simulated from g + 1, a repair', () => {
    const { seen } = both((s) => {
      const seen: (number | boolean)[][] = [];
      // b votes for another state at g, so the spectator's tally, with b's vote the only one counted, loses.
      s.playTo(40);
      const g = s.t.finalTick;
      const theirs = { ...s.t.final, ball: { ...s.t.final.ball, vx: s.t.final.ball.vx + 1 } };
      const bytes = encodeState(theirs);
      const win = hash64(bytes);
      s.playTo(g + W + V, () => [g, win]);
      expect(s.asked).toEqual([s.b]);
      expect(s.t.repairing).toBe(true);
      const records: InputRecord[][] = [];
      for (let t = g + 1; t <= s.n + D; t++) records.push(s.inputs.has(t) ? [{ player: s.b, input: s.inputs.get(t)!, events: 0 }] : []);
      const wire = encodeStateMessage({ timeline: MATCH, senderTick: s.n, phase: 0, g, senderFinal: s.n - W, state: bytes, inputs: records }, theirs.terriers.map((x) => x.id), WIRE);
      const fired = s.corrections.length;
      expect(s.t.onState('peer-b', decode(wire.bytes, P, WIRE) as StateMsg, 0, at(s.n))).toBe(true);
      // Caught up within the spread's budget (§2.8): s.n − g steps at the cap a call, the adoption's
      // and then timer runs whose clock doesn't move, so in the same call while the cap covers them.
      const calls = 1 + s.spreadOut();
      expect(calls).toBe(Math.ceil((s.n - g) / NET.timeline.spreadCap));
      seen.push([s.t.repairing, s.t.stats.resyncs, s.t.hashAt(g) === win]);
      seen.push(...firedSince(s, fired).map(([tick, from, repair]) => [tick - s.n, from - g, repair]));
      return seen;
    });
    expect(seen).toEqual([[false, 1, true], [0, 1, true]]);
  });
});

describe('finalisation (§2.6)', () => {
  it('reuses a predicted final whose inputs held, which verify checks against F stepped with them', () => {
    const { s } = both((s) => s.playTo(300));
    const st = s.t.stats;
    expect(st.reusedFinals).toBeGreaterThan(st.steppedFinals);
    expect(st.reusedFinals + st.steppedFinals).toBe(s.t.finalTick);
    // b's input never changed, so after its JOIN no predicted tick was ever wrong.
    expect(st.steppedFinals).toBeLessThan(2 * (LAG + W));
    expect(st.rollbacks).toBeLessThan(5);
  });
});

describe('verify (§2.7)', () => {
  it('catches a chain that a missed invalidation would leave: a wrong entry, its inputs, a reused final', () => {
    const wrong = (spoil: (s: Solo) => void): number => {
      const s = new Solo('incremental');
      s.playTo(60);
      spoil(s);
      s.playTo(80);
      return s.t.stats.verifyMismatches;
    };
    expect(wrong(() => {})).toBe(0);
    // An entry's state, as a predicted clone written after it was entered.
    expect(wrong((s) => (inside(s.t).entryAt(s.n)!.state.ball.vx += 1))).toBeGreaterThan(0);
    // An entry's inputs, as an invalidation that missed a record.
    expect(wrong((s) => ((inside(s.t).entryAt(s.n - 1) as unknown as { used: TickInput[] }).used = []))).toBeGreaterThan(0);
    // The entry finalisation reuses next, checked against F stepped with the final inputs.
    expect(wrong((s) => (inside(s.t).entryAt(s.t.finalTick + 1)!.state.terriers[0]!.vx += 1))).toBeGreaterThan(0);
  });

  it('catches a corrupted final it reuses when it is the chain\'s last entry, which only the reuse check sees', () => {
    const s = new Solo('incremental');
    s.playTo(60);
    // The chain cut back to the next final alone, and that entry spoiled: once F takes it over, the
    // chain predicted from F agrees with F, so only verifyReuse, against F stepped with the final
    // inputs, can tell.
    const t = s.t;
    const f = t.finalTick;
    inside(t).validTo = f + 1;
    inside(t).entryAt(f + 1)!.state.terriers[0]!.vx += 1;
    const reused = t.stats.reusedFinals;
    s.advanceTo(61);
    expect([t.finalTick, t.stats.reusedFinals - reused]).toEqual([f + 1, 1]);
    expect(t.stats.verifyMismatches).toBe(1);
    expect(t.stats.log.map(([, e]) => e).filter((e) => e.startsWith('verify'))).toEqual([`verify: reused final ${f + 1}`]);
  });
});
