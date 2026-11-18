import { describe, expect, it, vi } from 'vitest';
import { config } from '../../config';
import { hashState } from './codec';
import { canonicalInputs, encodeInput, FRAME_PITCH, JOIN, LEAVE, READY, SWITCH, type TickInput, UNREADY } from './input';
import { everyone, join, newMatch, noisyInputs, say, stack, startedMatch, tick, ticks } from './match-testing';
import { datan2 } from './math';
import { defaultParams, simParams } from './params';
import { applyEvents, applyPresence, placeArrival } from './rules';
import { place, placeBall } from './scenes';
import {
  cloneState, findTerrier, type MatchState, NEVER, newTerrier, SITTING, slotOf, sortTerriers, STANDING, START_COUNTDOWN, WARM_UP,
} from './state';
import { bindSlots, makeSim, step } from './step';
import { testId } from './testing';
import { stateProblems } from './valid';

// The roster events and warm-up arrivals (PLAN D-8, D-12, D-22, §16 "Rules";
// design §6.1, §6.2, §6.3's start, §6.5, §7.7): the events and their order
// in a tick, presence and Ready, the start countdown, arrivals on a free
// spot or the first clear point, one vacate for every freed slot, and one
// Sim stepping two warm-up states in turn.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const id = testId; // ascending with k, so k's order is ID order
const member = (s: Readonly<MatchState>, k: number): MatchState['terriers'][number] => {
  const at = findTerrier(s, id(k));
  if (at < 0) throw new Error(`${id(k)} isn't a member`);
  return s.terriers[at]!;
};
const roster = (s: Readonly<MatchState>): [string, number, number][] => s.terriers.map((t) => [t.id, t.pack, t.spot]);

describe('JOIN (D-12; design §6.1)', () => {
  it("arrives on its pack's first free spot, at rest, facing the ball, with the JOIN's coat and name, as a new member", () => {
    const m = newMatch(P, 2);
    tick(m, [join(id(1), 0, 0, { coat: 3, name: 'Rex' }), join(id(2), 1, 0, { coat: 5, name: 'Bo' })]);
    expect(roster(m.s)).toEqual([[id(1), 0, 0], [id(2), 1, 0]]);
    for (const [k, x, y, coat, name] of [[1, -9, 4, 3, 'Rex'], [2, 9, -4, 5, 'Bo']] as const) {
      const T = member(m.s, k);
      expect([T.x, T.y, T.z, T.vx, T.vy, T.vz, T.onFloor]).toEqual([x, y, P.terrierRadius, 0, 0, 0, true]);
      expect([T.heading, T.overheadRef]).toEqual([datan2(-y, -x), datan2(-y, -x)]);
      expect([T.coat, T.name, T.joinTick, T.lastInputTick, T.readyUntil, T.prevInput]).toEqual([coat, name, 1, 1, 0, 0]);
      expect([T.touches, T.goals, T.meter, T.lunge, T.slipFrom, T.anim, T.animStart]).toEqual([0, 0, P.meterFull, 0, -1, STANDING, 1]);
    }
    expect(stateProblems(m.s)).toEqual([]);
  });

  it("ignores a JOIN to a full pack, a bad pack byte, a member's JOIN and a non-member's other events", () => {
    const m = newMatch(P, 1);
    tick(m, [join(id(5), 0)]);
    tick(m, [
      join(id(1), 0), // full
      join(id(2), 2),
      join(id(3), 255),
      say(id(4), JOIN), // no pack byte
      say(id(6), READY | UNREADY | SWITCH | LEAVE, 0, { switchPack: 1 }), // not a member
      join(id(5), 1), // a member: stays in pack A
      say(id(7), 0), // present, with no events
    ]);
    expect(roster(m.s)).toEqual([[id(5), 0, 0]]);
    expect(m.s.terriers[0]!.joinTick).toBe(1);
  });

  it("reads a coat outside the list as coat 0, and a name that isn't allowed as '' (D-12, C-17)", () => {
    const coats: [number, number][] = [[7, 7], [8, 0], [200, 0], [-1, 0], [1.5, 0], [NaN, 0]];
    const names: [string, string][] = [
      ['x'.repeat(20), 'x'.repeat(20)], ['🐶'.repeat(8), '🐶'.repeat(8)], ['x'.repeat(21), ''], [`${'é'.repeat(16)}x`, ''],
      ['tab\there', ''], ['c1\u0085', ''], ['del\u007f', ''], ['lone \ud83d', ''], ['\udc36 lone', ''],
    ];
    const m = newMatch(P, 4);
    const inputs: TickInput[] = [];
    coats.forEach(([coat], k) => inputs.push(join(id(10 + k), k & 1, 0, { coat })));
    tick(m, inputs);
    coats.forEach(([, want], k) => expect(member(m.s, 10 + k).coat, `coat ${coats[k]![0]}`).toBe(want));
    for (const [name, want] of names) {
      const n = newMatch(P, 1);
      tick(n, [join(id(1), 0, 0, { name })]);
      expect(n.s.terriers[0]!.name, JSON.stringify(name)).toBe(want);
      expect(stateProblems(n.s)).toEqual([]);
    }
  });

  it("gives a pack's last place to the first JOIN in ID order, whatever order they arrive in", () => {
    for (const order of [[1, 2, 3], [3, 2, 1], [2, 3, 1]]) {
      const m = newMatch(P, 1);
      tick(m, order.map((k) => join(id(k), 1)));
      expect(roster(m.s)).toEqual([[id(1), 1, 0]]);
    }
  });
});

describe('SWITCH (D-12; design §6.1)', () => {
  /** 2 a side: ids 1 and 2 in pack A, 3 in pack B, all ready. */
  const three = (): ReturnType<typeof newMatch> => {
    const m = newMatch(P, 2);
    tick(m, [join(id(1), 0, READY), join(id(2), 0, READY), join(id(3), 1, READY)]);
    return m;
  };

  it("moves a member to the other pack's lowest free spot, cancels its Ready and resets its body as an arrival's", () => {
    const m = three();
    const T = member(m.s, 1);
    // Standing since its JOIN at tick 1, so only the arrival can restart its animation.
    Object.assign(T, { vx: 3, vy: 1, lunge: 5, pounceWait: 9, tumble: 30, guard: 2, meter: 10, zoomLocked: true, ballOverhead: true, touchingBall: true });
    expect([T.anim, T.animStart]).toEqual([STANDING, 1]);
    tick(m, [say(id(1), SWITCH, 0, { switchPack: 1 }), say(id(2)), say(id(3))]);
    expect(roster(m.s)).toEqual([[id(3), 1, 0], [id(2), 0, 1], [id(1), 1, 1]]);
    // Pack B's second spot, the mirror of (−9, −4).
    expect([T.x, T.y, T.z, T.vx, T.vy, T.vz, T.heading]).toEqual([9, 4, P.terrierRadius, 0, 0, 0, datan2(-4, -9)]);
    expect([T.readyUntil, T.lunge, T.pounceWait, T.tumble, T.guard, T.meter, T.zoomLocked, T.ballOverhead, T.touchingBall]).toEqual([0, 0, 0, 0, 0, P.meterFull, false, false, false]);
    expect([T.anim, T.animStart, T.joinTick]).toEqual([STANDING, 2, 1]);
    expect(member(m.s, 2).readyUntil).toBe(1 + P.readyExpiryTicks); // the others keep theirs
    expect(stateProblems(m.s)).toEqual([]);
  });

  it('is ignored without room, to its own pack, or with a bad pack byte', () => {
    const m = three();
    tick(m, [say(id(3), SWITCH, 0, { switchPack: 0 }), say(id(1), SWITCH, 0, { switchPack: 0 }), say(id(2), SWITCH, 0, { switchPack: 2 })]);
    expect(roster(m.s)).toEqual([[id(1), 0, 0], [id(3), 1, 0], [id(2), 0, 1]]);
    tick(m, [say(id(1), SWITCH, 0, { switchPack: 255 }), say(id(2), SWITCH)]);
    expect(roster(m.s)).toEqual([[id(1), 0, 0], [id(3), 1, 0], [id(2), 0, 1]]);
    expect(member(m.s, 3).readyUntil).toBe(1 + P.readyExpiryTicks); // an ignored SWITCH cancels nothing
  });

  it("ignores a member's SWITCH to its own pack while that pack has room, as D-12's re-sent SWITCH is once it has landed", () => {
    // 2 a side: id 1 alone in pack A, ready and off its spot; id 2 in pack B.
    const twin = (): ReturnType<typeof newMatch> => {
      const m = newMatch(P, 2);
      tick(m, [join(id(1), 0, READY), join(id(2), 1)]);
      place(P, m.s, 0, -3, 2);
      return m;
    };
    const m = twin();
    const plain = twin();
    tick(m, [say(id(1), SWITCH, 0, { switchPack: 0 }), say(id(2))]);
    tick(plain, [say(id(1)), say(id(2))]);
    expect([member(m.s, 1).x, member(m.s, 1).y, member(m.s, 1).spot, member(m.s, 1).readyUntil]).toEqual([-3, 2, 0, 1 + P.readyExpiryTicks]);
    expect(hashState(m.s)).toBe(hashState(plain.s));
  });

  it('keeps its own pack beside a JOIN: a non-member joins joinPack, and its SWITCH lands a tick later', () => {
    const m = newMatch(P, 2);
    const both = say(id(1), JOIN | SWITCH, 0, { joinPack: 0, switchPack: 1 });
    tick(m, [both]);
    expect(roster(m.s)).toEqual([[id(1), 0, 0]]);
    tick(m, [both]); // re-sent until the state shows them (D-12): now the JOIN is a member's
    expect(roster(m.s)).toEqual([[id(1), 1, 0]]);
    expect(member(m.s, 1).joinTick).toBe(1);
  });

  it('lets two SWITCHes for one place go in ID order', () => {
    const m = newMatch(P, 2);
    tick(m, [join(id(1), 0), join(id(2), 0), join(id(3), 1)]);
    tick(m, [say(id(2), SWITCH, 0, { switchPack: 1 }), say(id(1), SWITCH, 0, { switchPack: 1 }), say(id(3))]);
    expect(roster(m.s)).toEqual([[id(3), 1, 0], [id(2), 0, 1], [id(1), 1, 1]]);
  });
});

describe('the order of events in a tick (D-12, D-22; design §6.1)', () => {
  it("lands Practice's pack swap in one tick: the bot's LEAVE, the player's SWITCH and a new bot's JOIN, whatever their IDs", () => {
    // The player, the bot it swaps with and the new bot, by ID rank in each order.
    for (const [player, bot, fresh] of [[1, 2, 3], [3, 2, 1], [2, 3, 1], [1, 3, 2]]) {
      const m = newMatch(P, 1);
      tick(m, [join(id(player!), 0), join(id(bot!), 1)]);
      tick(m, [say(id(bot!), LEAVE), say(id(player!), SWITCH, 0, { switchPack: 1 }), join(id(fresh!), 0)]);
      expect(roster(m.s), `player ${player}, bot ${bot}, new bot ${fresh}`).toEqual([[id(fresh!), 0, 0], [id(player!), 1, 0]]);
      expect([member(m.s, player!).x, member(m.s, fresh!).x]).toEqual([10, -10]);
    }
  });

  it('lets a SWITCH take a place a LEAVE frees before a JOIN can, whatever their IDs', () => {
    for (const joiner of [1, 9]) {
      const m = newMatch(P, 1);
      tick(m, [join(id(5), 0), join(id(6), 1)]);
      tick(m, [say(id(5), LEAVE), say(id(6), SWITCH, 0, { switchPack: 0 }), join(id(joiner), 0)]);
      expect(roster(m.s), `the joiner, ${joiner}`).toEqual([[id(6), 0, 0]]);
    }
  });

  it('re-joins on a LEAVE and a JOIN in one input, as a new member in joinPack', () => {
    const m = newMatch(P, 2);
    tick(m, [join(id(1), 0, READY, { coat: 1, name: 'Old' }), join(id(2), 1)]);
    ticks(m, 9, () => [say(id(1), 0, encodeInput({ jump: 2 })), say(id(2))]);
    expect(member(m.s, 1).prevInput).toBe(encodeInput({ jump: 2 }));
    tick(m, [say(id(1), LEAVE | JOIN, 0, { joinPack: 1, coat: 6, name: 'New' }), say(id(2))]);
    const T = member(m.s, 1);
    expect(roster(m.s)).toEqual([[id(2), 1, 0], [id(1), 1, 1]]);
    expect([T.coat, T.name, T.joinTick, T.readyUntil, T.prevInput]).toEqual([6, 'New', 11, 0, 0]);
  });
});

describe('Ready (D-12; design §6.1, §6.3)', () => {
  it('lasts 60 s from the tick it was sent, and UNREADY cancels it, even in the same input', () => {
    const m = newMatch(P, 2);
    tick(m, [join(id(1), 0, READY), join(id(2), 0, READY | UNREADY), join(id(3), 1)]);
    expect([member(m.s, 1).readyUntil, member(m.s, 2).readyUntil, member(m.s, 3).readyUntil]).toEqual([1 + P.readyExpiryTicks, 0, 0]);
    // A non-member's READY is ignored.
    tick(m, [say(id(1)), say(id(2)), say(id(3)), say(id(4), READY)]);
    expect(findTerrier(m.s, id(4))).toBe(-1);
    ticks(m, P.readyExpiryTicks - 2);
    expect([m.s.tick, member(m.s, 1).readyUntil]).toEqual([P.readyExpiryTicks, 1 + P.readyExpiryTicks]);
    ticks(m, 1);
    expect(member(m.s, 1).readyUntil).toBe(0);
    tick(m, [say(id(1), READY), say(id(2)), say(id(3))]);
    tick(m, [say(id(1), UNREADY), say(id(2)), say(id(3))]);
    expect(member(m.s, 1).readyUntil).toBe(0);
  });

  it('starts the countdown once both packs are full and every terrier is ready, placing them by ID rank (D-8)', () => {
    const m = newMatch(P, 2);
    // Each pack's IDs arrive in reverse of their ranks, so the start's
    // placement moves them.
    tick(m, [join(id(4), 0, READY), join(id(2), 1, READY)]);
    tick(m, [...everyone(m.s), join(id(3), 0, READY)]);
    expect(m.s.phase).toBe(WARM_UP); // pack B is short
    tick(m, [...everyone(m.s), join(id(1), 1)]);
    expect(m.s.phase).toBe(WARM_UP); // id 1 isn't ready
    expect([member(m.s, 4).spot, member(m.s, 3).spot, member(m.s, 2).spot, member(m.s, 1).spot]).toEqual([0, 1, 0, 1]);
    // In the start's tick, id 3, whose spot the placement changes, holds a direction.
    tick(m, [say(id(2)), say(id(3), 0, encodeInput({ step: 8, frame: FRAME_PITCH })), say(id(4)), say(id(1), READY)]);
    expect([m.s.phase, m.s.phaseStart]).toEqual([START_COUNTDOWN, 4]);
    expect(roster(m.s)).toEqual([[id(3), 0, 0], [id(1), 1, 0], [id(4), 0, 1], [id(2), 1, 1]]);
    expect(m.s.terriers.map((t) => [t.x, t.y])).toEqual([[-9, 4], [9, -4], [-9, -4], [9, 4]]);
    // Step binds again after the placement, so each terrier reads its own
    // input at its new slot: id 3 turns on its spot, and nobody else does (design §3).
    expect(m.s.terriers.map((t) => t.headingChange)).toEqual([P.turnPerTick, 0, 0, 0]);
  });

  it("doesn't count a Ready that expires in the tick the last one comes", () => {
    for (const [at, starts] of [[P.readyExpiryTicks, true], [P.readyExpiryTicks + 1, false]] as const) {
      const m = newMatch(P, 1);
      tick(m, [join(id(1), 0, READY), join(id(2), 1)]);
      ticks(m, at - 2);
      tick(m, [say(id(1)), say(id(2), READY)]);
      expect(m.s.tick).toBe(at);
      expect(m.s.phase, `the last READY at tick ${at}`).toBe(starts ? START_COUNTDOWN : WARM_UP);
    }
  });
});

describe('presence (D-12, D-16; design §6.2)', () => {
  it('removes a terrier silent for 180 ticks in warm-up, its slot freed', () => {
    const m = newMatch(P, 1);
    tick(m, [join(id(1), 0), join(id(2), 1)]);
    ticks(m, P.removeAfterTicks - 1, () => [say(id(1))]);
    expect([m.s.tick, m.s.terriers.length]).toEqual([P.removeAfterTicks, 2]);
    // Silent since tick 1, past the sitting time: in warm-up it stands until it goes (D-16).
    expect([member(m.s, 2).sitting, member(m.s, 2).anim]).toEqual([false, STANDING]);
    ticks(m, 1, () => [say(id(1))]);
    expect(roster(m.s)).toEqual([[id(1), 0, 0]]);
    tick(m, [say(id(1)), join(id(3), 1)]); // its place is free
    expect(roster(m.s)).toEqual([[id(1), 0, 0], [id(3), 1, 0]]);
  });

  it("leaves no body of a terrier removed for its silence in that tick's physics: one sliding into its place meets nothing (design §3)", () => {
    // Pack A's id 1 slides at 3 m/s a centimetre into pack B's id 2 in the
    // tick id 2 is removed; and the same with id 2 never there.
    const slide = (rival: boolean): MatchState => {
      const m = newMatch(P, 1);
      m.s.tick = 1000; // so a removal can be scheduled by the last input tick
      tick(m, rival ? [join(id(1), 0), join(id(2), 1)] : [join(id(1), 0)]);
      place(P, m.s, findTerrier(m.s, id(1)), -5, 5);
      member(m.s, 1).vx = 3;
      if (rival) {
        place(P, m.s, findTerrier(m.s, id(2)), -5 + 2 * P.terrierRadius - 0.01, 5);
        member(m.s, 2).lastInputTick = m.s.tick + 1 - P.removeAfterTicks;
      }
      tick(m, [say(id(1))]);
      return m.s;
    };
    const removed = slide(true);
    expect(findTerrier(removed, id(2))).toBe(-1);
    expect(member(removed, 1).lastTerrierContactTick).toBe(NEVER);
    expect(hashState(removed)).toBe(hashState(slide(false)));
  });

  it('ignores every event from the start countdown on, LEAVE included; the leaver sits after 120 silent ticks, on its spot (L138)', () => {
    const m = startedMatch(P, 1);
    const [a, b] = m.s.terriers.map((t) => t.id) as [string, string];
    const before = roster(m.s);
    tick(m, [say(a, LEAVE), say(b, SWITCH | READY, 0, { switchPack: 0 }), join(id(9), 0), say(id(8), JOIN, 0, { joinPack: 1 })]);
    expect(roster(m.s)).toEqual(before);
    // The LEAVE came in an input, so A was heard from at tick 2; then silence.
    ticks(m, P.sitAfterTicks - 1, () => [say(b)]);
    expect(m.s.terriers[0]!.sitting).toBe(false);
    ticks(m, 1, () => [say(b)]);
    const A = m.s.terriers[0]!;
    expect([A.sitting, A.anim, A.x, A.y]).toEqual([true, SITTING, -10, 0]);
    // Through the countdown and into play, still a member, sitting until it's heard from.
    ticks(m, 300, () => [say(b)]);
    expect([m.s.terriers.length, A.sitting]).toEqual([2, true]);
    tick(m, [say(a), say(b)]);
    expect([A.sitting, A.lastInputTick]).toEqual([false, m.s.tick]);
  });
});

describe('warm-up arrivals (D-8; design §6.5)', () => {
  it("takes its pack's lowest free spot, a gap a LEAVE left included", () => {
    const m = newMatch(P, 2);
    tick(m, [join(id(1), 0), join(id(2), 0)]);
    tick(m, [say(id(1), LEAVE), say(id(2))]);
    expect(roster(m.s)).toEqual([[id(2), 0, 1]]);
    tick(m, [say(id(2)), join(id(3), 0)]);
    expect(roster(m.s)).toEqual([[id(3), 0, 0], [id(2), 0, 1]]);
    expect([member(m.s, 3).x, member(m.s, 3).y]).toEqual([-9, 4]);
  });

  it('steps from a spot that is in the way toward its own goal line, to the first clear point, mirrored for pack B', () => {
    for (const pack of [0, 1] as const) {
      const sign = pack === 0 ? -1 : 1;
      const m = newMatch(P, 1);
      tick(m, [join(id(1), 1 - pack)]);
      // The other pack's terrier stands on this pack's spot, (∓10, 0).
      place(P, m.s, 0, sign * 10, 0);
      tick(m, [say(id(1)), join(id(2), pack)]);
      // ±0 alike: pack B's spot has y = −0, which the tick's integration,
      // adding +0 × dt, makes +0. P8 compares with ===.
      expect([member(m.s, 2).x, member(m.s, 2).y + 0], `pack ${pack}`).toEqual([sign * 11, 0]);
    }
  });

  it('counts a body exactly 2r away as in the way, and the ball too, in 3D', () => {
    const m = newMatch(P, 1);
    tick(m, [join(id(1), 1)]);
    place(P, m.s, 0, -10.5, 0); // 0.5 m from −10 and from −11: neither is clear
    tick(m, [say(id(1)), join(id(2), 0)]);
    expect(member(m.s, 2).x).toBe(-12);
    // The ball over the spot, 0.55 m above a standing terrier's centre: in
    // the way. One step on it's 1.14 m off, more than R + r: clear.
    const b = newMatch(P, 1);
    placeBall(P, b.s, -10, 0);
    tick(b, [join(id(2), 0)]);
    expect(b.s.terriers[0]!.x).toBe(-11);
  });

  it('goes on its spot when no point is clear before it leaves the floor plan, and the solver pushes it out', () => {
    const m = newMatch(P, 4);
    const inputs: TickInput[] = [];
    for (let k = 0; k < 7; k++) inputs.push(join(id(k + 1), k < 3 ? 0 : 1));
    tick(m, inputs);
    // Pack B's four block pack A's fourth spot, (−14, −3), and every step
    // from it to the end wall: −15 to −19, each within 2r of one of them.
    const blockers = [-14, -15.5, -17.5, -19.5];
    m.s.terriers.filter((t) => t.pack === 1).forEach((t, j) => place(P, m.s, m.s.terriers.indexOf(t), blockers[j]!, -3));
    // Directly, to see where it lands …
    const s = cloneState(m.s);
    const T = newTerrier(id(8), '', 0, 0, 2, P);
    s.terriers.push(T);
    placeArrival(makeSim(P, 4), s, T, 2);
    expect([T.spot, T.x, T.y]).toEqual([3, -14, -3]);
    // … and through step, which pushes it out of the blocker on its spot.
    tick(m, [...everyone(m.s), join(id(8), 0)]);
    const U = member(m.s, 8);
    expect(U.spot).toBe(3);
    expect(Math.hypot(U.x + 14, U.y + 3)).toBeLessThan(0.1);
    expect(stateProblems(m.s)).toEqual([]);
    const blocker = m.s.terriers.find((t) => t.pack === 1 && t.spot === 0)!;
    ticks(m, 30);
    expect(Math.hypot(U.x - blocker.x, U.y - blocker.y, U.z - blocker.z)).toBeGreaterThan(2 * P.terrierRadius - 1e-3);
  });

  it('refuses a point nearer the end wall than its radius: the steps stay inside the floor plan by r', () => {
    const m = newMatch(P, 4);
    const inputs: TickInput[] = [];
    for (let k = 0; k < 7; k++) inputs.push(join(id(k + 1), k < 3 ? 0 : 1));
    tick(m, inputs);
    // Three of pack B's block pack A's fourth spot, (−14, −3), and each step
    // from it to −19; −20, on the end wall's plane, is clear of them. The
    // fourth stands out of the way.
    const blockers = [-14.5, -16.5, -18.5];
    m.s.terriers.filter((t) => t.pack === 1).forEach((t, j) => place(P, m.s, m.s.terriers.indexOf(t), blockers[j] ?? 5, j < 3 ? -3 : 5));
    const s = cloneState(m.s);
    const T = newTerrier(id(8), '', 0, 0, 2, P);
    s.terriers.push(T);
    placeArrival(makeSim(P, 4), s, T, 2);
    expect([T.spot, T.x, T.y]).toEqual([3, -14, -3]);
  });

  it('measures the way in 3D: a terrier in the air over a spot, more than 2r from a standing one, leaves it clear', () => {
    const m = newMatch(P, 1);
    tick(m, [join(id(1), 1)]);
    // Pack B's terrier 0.6 m above a standing terrier's centre on pack A's spot.
    place(P, m.s, 0, -10, 0, 3 * P.terrierRadius + 0.1);
    tick(m, [say(id(1)), join(id(2), 0)]);
    expect([member(m.s, 2).spot, member(m.s, 2).x, member(m.s, 2).y]).toEqual([0, -10, 0]);
  });

  it('counts the ball exactly R + r from a standing terrier on the spot as in the way', () => {
    const m = newMatch(P, 1);
    const reach = P.ballRadius + P.terrierRadius;
    const z = P.terrierRadius + reach;
    expect(z - P.terrierRadius).toBe(reach); // exactly, in floats
    placeBall(P, m.s, -10, 0, z);
    tick(m, [join(id(2), 0)]);
    expect(m.s.terriers[0]!.x).toBe(-11);
  });

  it('counts the terriers placed earlier in the same tick as in the way', () => {
    // Pack A's spots at 2 a side on one line, 3 m apart, so the first
    // arrival's steps reach the second's spot.
    const Q = simParams({ ...config, kickoffSpotsMetres: [[], [[-10, 0]], [[-9, 0], [-12, 0]], ...config.kickoffSpotsMetres.slice(3)] });
    const m = newMatch(Q, 2);
    tick(m, [join(id(5), 1), join(id(6), 1)]);
    // Pack B's two block −9, −10 and −11.
    place(Q, m.s, 0, -9.5, 0);
    place(Q, m.s, 1, -11, 0);
    tick(m, [say(id(5)), say(id(6)), join(id(1), 0), join(id(2), 0)]);
    expect([member(m.s, 1).spot, member(m.s, 1).x]).toEqual([0, -12]);
    expect([member(m.s, 2).spot, member(m.s, 2).x]).toEqual([1, -13]);
  });

  it('never steps when the step setting is 0, which the tuning page can set', () => {
    const Q = simParams({ ...config, warmUpArrivalStepMetres: 0 });
    const m = newMatch(Q, 1);
    tick(m, [join(id(1), 1)]);
    place(Q, m.s, 0, -10, 0);
    tick(m, [say(id(1)), join(id(2), 0)]);
    expect(member(m.s, 2).spot).toBe(0);
    expect(Number.isFinite(member(m.s, 2).x)).toBe(true);
  });
});

describe('vacated slots (design §6.1)', () => {
  /** 2 a side, ids 1 (pack A) and 2 (pack B) in warm-up, 2 standing on 1's
   *  back: after a tick, 1 slips from 2's slot. */
  const stacked = (): ReturnType<typeof newMatch> => {
    const m = newMatch(P, 2);
    m.s.tick = 1000; // so a removal can be scheduled by the last input tick
    tick(m, [join(id(1), 0), join(id(2), 1)]);
    stack(P, m.s, findTerrier(m.s, id(1)), findTerrier(m.s, id(2)));
    tick(m, [say(id(1)), say(id(2))]);
    const A = member(m.s, 1);
    expect([A.slipping, A.slipFrom]).toEqual([true, slotOf(member(m.s, 2))]);
    return m;
  };
  /** Steps 1 and 2 alone, on a clone, as step runs them: what vacate does,
   *  before the substeps' own clear, which also lets go of an empty or
   *  landed slot, could hide it. Between the two, the drive would hold off
   *  toward the wrong body (design §6.1). */
  const eventsOnly = (m: ReturnType<typeof newMatch>, inputs: readonly TickInput[]): MatchState => {
    const s = cloneState(m.s);
    const sim = makeSim(P, 2);
    const t = s.tick + 1;
    canonicalInputs(inputs, sim.ins);
    bindSlots(sim, s);
    if (applyEvents(sim, s, t)) bindSlots(sim, s);
    applyPresence(sim, s, t);
    return s;
  };
  /** Then the whole tick: nothing throws, and nobody slips from the freed slot. */
  const freed = (m: ReturnType<typeof newMatch>, inputs: readonly TickInput[], what: string): void => {
    const early = eventsOnly(m, inputs);
    expect([member(early, 1).slipping, member(early, 1).slipFrom], `${what}, after the events`).toEqual([false, -1]);
    tick(m, inputs);
    const A = member(m.s, 1);
    expect([A.slipping, A.slipFrom], what).toEqual([false, -1]);
    expect(stateProblems(m.s), what).toEqual([]);
  };

  it('clears the slip when the upper terrier switches packs', () => {
    const m = stacked();
    freed(m, [say(id(1)), say(id(2), SWITCH, 0, { switchPack: 0 })], 'a SWITCH');
    expect(member(m.s, 2).pack).toBe(0);
  });

  it('clears the slip when the upper terrier leaves and a JOIN takes its slot in the same tick', () => {
    const m = stacked();
    const slot = slotOf(member(m.s, 2));
    freed(m, [say(id(1)), say(id(2), LEAVE), join(id(3), 1)], 'a LEAVE and a JOIN');
    expect(slotOf(member(m.s, 3))).toBe(slot);
  });

  it('clears the slip when the upper terrier is removed for its silence', () => {
    const m = stacked();
    member(m.s, 2).lastInputTick = m.s.tick + 1 - P.removeAfterTicks;
    freed(m, [say(id(1))], 'a removal');
    expect(findTerrier(m.s, id(2))).toBe(-1);
  });

  it("clears the lower terrier's own slip when it switches", () => {
    const m = stacked();
    freed(m, [say(id(1), SWITCH, 0, { switchPack: 1 }), say(id(2))], "the lower one's SWITCH");
    expect(member(m.s, 1).pack).toBe(1);
  });
});

describe('one Sim over two warm-up states (design §7.7, R-14)', () => {
  it('steps two warm-up states taking JOINs, SWITCHes, LEAVEs and arrivals in the same ticks, and a clone, each tick as a fresh Sim of its own does', () => {
    const names = ['', 'Rex', 'x'.repeat(21), 'tab\there'];
    // Six IDs each for four places, and no Ready until tick 400, so the
    // rosters churn through warm-up; then everyone readies, and the runs go
    // on through the start countdown into play.
    const runs = [0, 1].map((r) => ({
      seed: 40 + r, ids: [1, 2, 3, 4, 5, 6].map((k) => id(k + 20 * r)), a: newMatch(P, 2).s, b: newMatch(P, 2).s, own: makeSim(P, 2),
    }));
    const inputsOf = (r: (typeof runs)[number], t: number): TickInput[] =>
      noisyInputs(r.seed, r.ids, names, t).map((x) => ({ ...x, events: t < 400 ? x.events & ~READY : x.events | READY }));
    const shared = makeSim(P, 2);
    let clone: { a: MatchState; b: MatchState; own: ReturnType<typeof makeSim> } | null = null;
    let changes = 0;
    const previous = ['', ''];
    for (let t = 1; t <= 800; t++) {
      if (t === 151) clone = { a: cloneState(runs[0]!.a), b: cloneState(runs[0]!.b), own: makeSim(P, 2) };
      for (const r of runs) {
        const inputs = inputsOf(r, t);
        step(shared, r.a, inputs);
        step(r.own, r.b, inputs);
      }
      if (clone) {
        const inputs = inputsOf(runs[0]!, t);
        step(shared, clone.a, inputs);
        step(clone.own, clone.b, inputs);
        expect(hashState(clone.a), `the clone, tick ${t}`).toBe(hashState(clone.b));
        expect(hashState(clone.a), `the clone and its original, tick ${t}`).toBe(hashState(runs[0]!.a));
      }
      runs.forEach((r, k) => {
        expect(hashState(r.a), `state ${k}, tick ${t}`).toBe(hashState(r.b));
        const now = JSON.stringify(roster(r.a));
        if (now !== previous[k]) changes++;
        previous[k] = now;
      });
    }
    // The rosters changed often, so the binding did too, and both runs went
    // through the start countdown's placement into play.
    expect(changes).toBeGreaterThan(20);
    expect(runs.map((r) => r.a.phase !== WARM_UP && r.a.phase !== START_COUNTDOWN)).toEqual([true, true]);
  });
});

describe('sortTerriers after the events (design §6.1)', () => {
  it('leaves the list in (spot, pack) order after every kind of event in one tick', () => {
    const m = newMatch(P, 3);
    tick(m, [join(id(1), 0), join(id(2), 0), join(id(3), 1), join(id(4), 1), join(id(5), 1)]);
    tick(m, [say(id(1), LEAVE), say(id(4), SWITCH, 0, { switchPack: 0 }), join(id(6), 1), join(id(7), 0), say(id(2)), say(id(3)), say(id(5))]);
    // Pack A: 4 switched into the place 1 left, then 7 after 2; pack B: 6 in
    // the place 4 left.
    expect(roster(m.s)).toEqual([[id(4), 0, 0], [id(3), 1, 0], [id(2), 0, 1], [id(6), 1, 1], [id(7), 0, 2], [id(5), 1, 2]]);
    const copy = cloneState(m.s);
    sortTerriers(copy);
    expect(copy.terriers.map((t) => t.id)).toEqual(m.s.terriers.map((t) => t.id));
    expect(stateProblems(m.s)).toEqual([]);
  });
});
