import { describe, expect, it, vi } from 'vitest';
import { config, type Config } from '../../config';
import { hashState } from './codec';
import { hash64 } from './hash';
import type { TickInput } from './input';
import { simParams } from './params';
import {
  chasey, dribbleScene, pinchScene, pitchDir, pushScene, rankedIds, RESTING_BALL, ROLLING_BALL, type Scene, sceneInputs, sceneStart,
  WALL_SCRUM,
} from './scenes';
import { cloneState, ENDED, KICKOFF_COUNTDOWN, type MatchState, WARM_UP } from './state';
import { bindSlots, makeSim, type Sim, step } from './step';
import { bodyBits, bodyHash, testId } from './testing';

// The step (PLAN §7.2; design §1.11, §3, §4.1, §7.7): the bit pins that tie
// the port to the M0 spike, one Sim stepping several states in turn, and
// the step's own contracts.
vi.setConfig({ testTimeout: 120_000 });

// --- The bit pins (design §4.1) ---

/** Every setting that can move a body in the pinned scenes, at M0's values:
 *  the M0 spike's DEFAULT_CONFIG, written out here, where the configuration
 *  scan doesn't look, so settle's tuning never moves the pins. They check
 *  the port, not the tuning. The rest, from src/config.ts, move no body in
 *  a placed scene: the bots, names, Ready, warm-up and the clock. */
const M0: Config = {
  ...config,
  packSizeMin: 1, packSizeMax: 4,
  kickoffCountdownSeconds: 3, celebrationSeenSeconds: 3, lateWindowTicks: 12, voteWindowTicks: 12, sittingSilentTicks: 120,
  kickoffSpotsMetres: [[], [[-10, 0]], [[-9, 4], [-9, -4]], [[-9, 5], [-9, -5], [-15, 0]], [[-8, 6], [-8, -6], [-14, 3], [-14, -3]]],
  pitch: {
    lengthMetres: 40, widthMetres: 28, heightMetres: 6, cornerCutsMetres: [4, 4, 4, 4],
    mouthWidthMetres: 8, mouthHeightMetres: 3, goalDepthMetres: 2, postRadiusMetres: 0.1,
  },
  ballRadiusMetres: 0.8, ballMassKg: 2, terrierRadiusMetres: 0.25, terrierMassKg: 1,
  ballRestitution: 0.7, goalNetRestitution: 0.3, terrierBallRestitution: 0.5, terrierRestitution: 0.3, terrierFloorRestitution: 0,
  gravityMetresPerSecond2: 9.8, accelerationMetresPerSecond2: 15, idleFrictionMetresPerSecond2: 8, rollingSlowdownMetresPerSecond2: 0.5,
  runSpeedMetresPerSecond: 6, zoomiesSpeedMetresPerSecond: 9, turnRateTurnsPerSecond: 2, noseTurnRateTurnsPerSecond: 1, noseReverseMetresPerSecond: 3,
  zoomiesFullSeconds: 3, zoomiesRefillSeconds: 6, zoomiesMeterUnitsPerTick: 2, jumpHeightMetres: 1, pounceSpeedMetresPerSecond: 10,
  lungeSeconds: 0.3, pounceWaitSeconds: 1.5, bowlingSpeedMetresPerSecond: 4, tumbleSeconds: 1.5, getUpSeconds: 0.5, tumbleGuardSeconds: 1.5,
  rearmGapMetres: 0.6, ballOverheadEnterMetres: 0.3, ballOverheadLeaveMetres: 0.4, pushAssistCapMetresPerSecond: 0,
  gaitCycleMetres: 0.6, runningMinSpeedMetresPerSecond: 0.2,
  ticksPerSecond: 60, substepsPerTick: 4, solverIterations: 8, positionPasses: 2, floorContactsInSolve: true,
  restitutionThresholdMetresPerSecond: 0.3, slipOutConeDegrees: 42, slipOutSpeedMetresPerSecond: 2,
};

/** bodyHash at ticks 1, 60 and 600 of six M0 scenes, each with the spike's
 *  own coordinates and inputs, then a hash chained over every tick's
 *  bodyBits to 600: chain_0 is '', and chain_t is hash64 of the UTF-8 of
 *  chain_{t−1} + bodyBits at tick t. The chain is there because tick 600
 *  can't see a goal's aftermath: the push and the dribble score and are
 *  back on the same kickoff spots by then, with one hash, so only the chain
 *  ties their celebrations, the netting's contacts and the placements to
 *  the spike. Recorded once from the M0 spike, its sources as of commit
 *  85775cd, by a scratch script outside the repo: it imported the spike and
 *  the port in one Node process, under Node's type stripping with a resolve
 *  hook for the port's extensionless imports, ran each scene through both
 *  under the spike's kept settings (42° with the flag, 8 iterations, 2
 *  passes), and hashed the spike's own state in bodyBits's format. The two
 *  matched every tick to 600, and on every field the states share. A
 *  mismatch is a port bug: never fixed by re-pinning.
 *
 *  Re-pinned once, deliberately, for M2's slip release (bots-F4): the
 *  slipping flag's hold-off acts only while the terrier is within the
 *  re-arm gap of the body it slipped from, surface to surface in plan view
 *  (physics.ts's drive()), where M0's acted at any distance. Four scenes
 *  slip out and then drive toward the body from farther out, so they leave
 *  M0's bits at the tick the release first acts: the push at 323, the pinch
 *  at 396, the wall scrum at 104 and the dribble at 462. Until then each
 *  still moves by the spike's bits, which `spike` holds: the spike's own
 *  chain to the tick before, recorded the same way. Their other values are
 *  the port's, recorded with the release under this M0 copy. The resting
 *  and rolling balls never slip out and keep the spike's pins. */
const PINS: [scene: Scene, hashes: [string, string, string], chain: string, spike?: [tick: number, chain: string]][] = [
  [RESTING_BALL, ['86a13468df457878', '86a13468df457878', '86a13468df457878'], '63c7e6295a6b96f3'],
  [ROLLING_BALL, ['430b22f26b318cc7', 'a66c47768eaf6ae4', 'acf3e6f6dcb53c08'], '555db0d7f8feb176'],
  [pushScene('train', 1, 'pitch'), ['5ae363dc88638ff8', '78848aa555750373', '0748d64010422fc4'], '0cc658e59c947bee', [322, '87411fd2fe7b63f8']],
  [pinchScene(2), ['2bd3f6bd18811486', '2bd3f6bd18811486', '354ef82ed79d67db'], '541bb59af26de350', [395, '0009a752bfd83934']],
  [WALL_SCRUM, ['216a7b3b5c37c4c4', '1943d48609cd55ac', '25d678c8d4553fd5'], 'ae15f90715a69405', [103, 'e90f73cd6cd7dbd1']],
  [dribbleScene('ball', false), ['09b107e2c7011af4', '4431fb7e2fab6a60', '0748d64010422fc4'], '171774d597df6109', [461, '580658e3cf5837c1']],
];

describe("the bit pins: the port moves M0's bodies by M0's bits, and by the slip release's once it acts (design §4.1, bots-F4)", () => {
  const P = simParams(M0);
  const utf8 = new TextEncoder();
  for (const [scene, want, wantChain, spike] of PINS) {
    it(scene.name, () => {
      const sim = makeSim(P, scene.packSize);
      const s = sceneStart(scene, P);
      const got: string[] = [];
      let chain = '';
      let spikeChain = '';
      for (let t = 1; t <= 600; t++) {
        step(sim, s, sceneInputs(scene, s, t));
        if (t === 1 || t === 60 || t === 600) got.push(bodyHash(s));
        chain = hash64(utf8.encode(chain + bodyBits(s)));
        if (spike && t === spike[0]) spikeChain = chain;
      }
      if (spike) expect(spikeChain, `the spike's chain to tick ${spike[0]}, before the slip release acts`).toBe(spike[1]);
      expect(got).toEqual(want);
      expect(chain, 'the chain over every tick').toBe(wantChain);
    });
  }
});

// --- One Sim, many states (design §7.7, R-14) ---

describe('one Sim steps any states of its pack size, in any order', () => {
  it('steps the wall scrum, a seeded kickoff, a warm-up with holes and a clone in turn, each tick as a fresh Sim of its own does', () => {
    const P = simParams(config);
    // Some of the kickoff's inputs are absent, so a binding left from another
    // state's step would show.
    const contact = chasey(11, 'contact');
    const kickoff: Scene = {
      name: 'kickoff', packSize: 4, phase: KICKOFF_COUNTDOWN, mirrored: false,
      input: (pack, rank, t, s) => (rank === pack + 1 && t % 3 === 0 ? null : contact(pack, rank, t, s)),
    };
    // A warm-up with holes: the ball fixed, slots 5 and 7 empty, so the
    // binding and the ball's inverse mass change every call.
    const warmUp: Scene = { name: 'warm-up', packSize: 4, phase: WARM_UP, members: [4, 2], mirrored: false, input: chasey(12, 'all') };
    const scenes = [WALL_SCRUM, kickoff, warmUp];
    const shared = makeSim(P, 4);
    const own = scenes.map(() => makeSim(P, 4));
    // Each state with IDs of its own.
    const a = scenes.map((scene, k) => sceneStart(scene, P, k + 1));
    const b = scenes.map((scene, k) => sceneStart(scene, P, k + 1));
    let clone: { scene: Scene; a: MatchState; b: MatchState; own: Sim } | null = null;
    let compared = 0;
    for (let t = 1; t <= 600; t++) {
      if (t === 101) clone = { scene: WALL_SCRUM, a: cloneState(a[0]!), b: cloneState(b[0]!), own: makeSim(P, 4) };
      for (let k = 0; k < scenes.length; k++) {
        step(shared, a[k]!, sceneInputs(scenes[k]!, a[k]!, t));
        step(own[k]!, b[k]!, sceneInputs(scenes[k]!, b[k]!, t));
      }
      if (clone) {
        step(shared, clone.a, sceneInputs(clone.scene, clone.a, t));
        step(clone.own, clone.b, sceneInputs(clone.scene, clone.b, t));
      }
      for (let k = 0; k < scenes.length; k++) {
        expect(hashState(a[k]!), `${scenes[k]!.name}, tick ${t}`).toBe(hashState(b[k]!));
        compared++;
      }
      if (clone) {
        expect(hashState(clone.a), `the clone, tick ${t}`).toBe(hashState(clone.b));
        expect(hashState(clone.a), `the clone and its original, tick ${t}`).toBe(hashState(a[0]!));
      }
    }
    expect(compared).toBe(1800);
    // The runs did what they're for: contacts, a slip-out, play from the kickoff.
    expect(a[1]!.phase).not.toBe(KICKOFF_COUNTDOWN);
    expect(own[0]!.physics.stats.slipOuts).toBeGreaterThan(0);
    expect(own[2]!.physics.stats.contacts).toBeGreaterThan(0);
  });

  it('refuses a state of another pack size', () => {
    const P = simParams(config);
    const sim = makeSim(P, 2);
    const s = sceneStart(WALL_SCRUM, P);
    expect(() => step(sim, s, [])).toThrow(/4-a-side state can't be stepped by a 2-a-side Sim/);
    expect(() => makeSim(P, 5)).toThrow(/pack size of 5/);
  });

  it('binds every slot from the state on each call: empty slots null, absent inputs −1', () => {
    const P = simParams(config);
    const sim = makeSim(P, 2);
    const full = sceneStart({ name: 'full', packSize: 2, phase: WARM_UP, mirrored: false, input: () => 0 }, P);
    const holes = sceneStart({ name: 'holes', packSize: 2, phase: WARM_UP, members: [1, 1], mirrored: false, input: () => 0 }, P);
    sim.ins.length = 0;
    sim.ins.push(...[...full.terriers].map((t): TickInput => ({ id: t.id, input: 0, events: 0 })).sort((x, y) => (x.id < y.id ? -1 : 1)));
    bindSlots(sim, full);
    expect(sim.bodies.map((b) => b !== null)).toEqual([true, true, true, true, true]);
    expect([...sim.inputOf].every((i) => i >= 0)).toBe(true);
    bindSlots(sim, holes);
    expect(sim.bodies.map((b) => b !== null)).toEqual([true, true, false, false, true]);
    expect(sim.terriers.slice(2)).toEqual([null, null]);
    expect([...sim.inputOf].slice(2)).toEqual([-1, -1]);
    expect(sim.bodies[4]).toBe(holes.ball);
  });
});

// --- The step's contracts ---

describe('the step (§7.2)', () => {
  it('calls the probe after every substep, in order, before the tick is counted', () => {
    const P = simParams(config);
    const sim = makeSim(P, 1);
    const s = sceneStart(RESTING_BALL, P);
    const calls: [number, number][] = [];
    sim.probe = (st, sub) => calls.push([st.tick, sub]);
    for (let t = 1; t <= 2; t++) step(sim, s, sceneInputs(RESTING_BALL, s, t));
    expect(calls).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]]);
    expect(s.tick).toBe(2);
  });

  it('treats ENDED as terminal: later ticks only advance the tick (design §6.6)', () => {
    const P = simParams(config);
    const sim = makeSim(P, 4);
    const s = sceneStart(WALL_SCRUM, P);
    for (let t = 1; t <= 50; t++) step(sim, s, sceneInputs(WALL_SCRUM, s, t));
    s.phase = ENDED;
    const before = cloneState(s);
    let probed = 0;
    sim.probe = () => probed++;
    for (let t = 51; t <= 100; t++) step(sim, s, sceneInputs(WALL_SCRUM, s, t));
    expect(s.tick).toBe(100);
    expect(probed).toBe(0);
    expect(hashState({ ...s, tick: before.tick })).toBe(hashState(before));
  });

  it('gives the same state whatever order the inputs arrive in, duplicated or not, and ignores IDs not in the match', () => {
    const P = simParams(config);
    const runs = [0, 1, 2].map(() => ({ sim: makeSim(P, 4), s: sceneStart(WALL_SCRUM, P) }));
    for (let t = 1; t <= 300; t++) {
      const inputs = sceneInputs(WALL_SCRUM, runs[0]!.s, t);
      step(runs[0]!.sim, runs[0]!.s, inputs);
      step(runs[1]!.sim, runs[1]!.s, [...inputs].reverse());
      const stranger: TickInput = { id: testId(t), input: 0x1ff, events: 0 };
      step(runs[2]!.sim, runs[2]!.s, [stranger, ...inputs, ...inputs, { ...stranger, id: 'not an ID' }]);
    }
    const h = hashState(runs[0]!.s);
    expect(hashState(runs[1]!.s)).toBe(h);
    expect(hashState(runs[2]!.s)).toBe(h);
  });

  it("steps a test-only short pack in play, the empty-goal mark's: 1 a side, pack B empty (design §2.3)", () => {
    const P = simParams(config);
    const scene: Scene = { name: 'empty goal', packSize: 1, phase: KICKOFF_COUNTDOWN, members: [1, 0], mirrored: false, input: () => pitchDir(0) };
    const sim = makeSim(P, 1);
    const s = sceneStart(scene, P);
    expect(s.terriers.map((t) => [t.spot, t.pack])).toEqual([[0, 0]]);
    let t = 0;
    while (s.score[0] === 0 && t < 1200) step(sim, s, sceneInputs(scene, s, ++t));
    // Pack A pushes the ball from its kickoff spot into the open +x goal, and
    // the celebration's end places a pack of one against none.
    expect(s.score).toEqual([1, 0]);
    expect([s.scorers, s.terriers[0]!.goals]).toEqual([1, 1]);
    for (let k = 0; k < P.celebrationTicks; k++) step(sim, s, sceneInputs(scene, s, ++t));
    expect(s.phase).toBe(KICKOFF_COUNTDOWN);
    expect([s.terriers[0]!.x, s.ball.x]).toEqual([-10, 0]);
  });

  it("ranks each pack's IDs in ascending order, a person's 32 hex digits, the same for a seed", () => {
    for (const seed of [0, 1, 99]) {
      const [a, b] = rankedIds(seed, 4);
      for (const ids of [a, b]) {
        expect([...ids].sort()).toEqual(ids);
        for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}4[0-9a-f]{19}$/);
      }
      expect(new Set([...a, ...b]).size).toBe(8);
      expect(rankedIds(seed, 4)).toEqual([a, b]);
      // A smaller pack keeps the same members, by rank within its pack.
      expect(rankedIds(seed, 2)[0].every((id) => a.includes(id))).toBe(true);
    }
    expect(rankedIds(1, 4)).not.toEqual(rankedIds(2, 4));
  });

  it('reads an input with no entry as absent: nothing held, and no press', () => {
    const P = simParams(config);
    const scene = pushScene('train', 1, 'pitch');
    const sim = makeSim(P, 1);
    const s = sceneStart(scene, P);
    for (let t = 1; t <= 60; t++) step(sim, s, sceneInputs(scene, s, t).filter((x) => x.id !== s.terriers[0]!.id));
    expect(s.terriers[0]!.lastInputTick).toBe(0);
    expect(sim.intents.driveOn[0]).toBe(0);
    expect(s.ball.vx).toBe(0);
  });
});
