import { describe, expect, it, vi } from 'vitest';
import { canonicalRules, config, matchConfig, type MatchRules, NO_RULES, RULE_SETTINGS, type RuleSetting, sameRules } from '../../config';
import { hashState } from './codec';
import { JOIN } from './input';
import { defaultParams, paramsFor, type SimParams, simParams } from './params';
import { chasey, park, pitchDir, placedMatch, rankedIds, type Scene, sceneInputs, sceneStart } from './scenes';
import { HOUSE_RULES } from './scripts';
import { cloneState, genesis, IN_PLAY, KICKOFF_COUNTDOWN, matchSettingsOf, type MatchState, type Terrier } from './state';
import { makeSim, step } from './step';
import { mirrorMismatches, run, SECOND_SHAPE } from './testing';

// The match rules in the simulation (C-59): a match's own parameters, its rules over the build's
// (paramsFor); its rules in its state, written canonical at genesis, frozen and shared by every clone,
// and given back by matchSettingsOf for Play again; the step, which takes a state only with a Sim made
// for its rules; and P8 under the golden run's house rules. The choices and matchConfig are
// src/config.test.ts's to check, and the rules' bytes codec.test.ts's.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;

/** A rule's choices but its setting's own. */
const others = (k: RuleSetting): readonly number[] => config.matchRules[k].filter((v) => !Object.is(v, config[k]));
/** The highest of them. */
const away = (k: RuleSetting): number => others(k)[others(k).length - 1]!;

/** Two matches' rules, each away from the build's settings: a faster run and a longer tumble, and a
 *  shorter meter and a heavier ball. */
const FAST = canonicalRules({ runSpeedMetresPerSecond: away('runSpeedMetresPerSecond'), tumbleSeconds: away('tumbleSeconds') }, config);
const SHORT = canonicalRules({ zoomiesFullSeconds: others('zoomiesFullSeconds')[0]!, ballMassKg: away('ballMassKg') }, config);

/** Every rule at the build's own setting: rules that change nothing, written out. */
const OWN: MatchRules = Object.fromEntries(RULE_SETTINGS.map((k) => [k, config[k]]));

/** The parameters each rule feeds: the meter's time its units, its rates kept, and the zoomies speed
 *  the push assist's cap too, where it moves it (feeds). */
const FEEDS: { readonly [K in RuleSetting]: readonly (keyof SimParams)[] } = {
  runSpeedMetresPerSecond: ['runSpeed'],
  zoomiesSpeedMetresPerSecond: ['pushAssistCap', 'zoomiesSpeed'],
  zoomiesFullSeconds: ['meterFull'],
  turnRateTurnsPerSecond: ['turnPerTick'],
  idleFrictionMetresPerSecond2: ['idleFrictionDt'],
  jumpHeightMetres: ['jumpSpeed'],
  pounceSpeedMetresPerSecond: ['pounceSpeed'],
  pounceWaitSeconds: ['pounceWaitTicks'],
  bowlingSpeedMetresPerSecond: ['bowlingSpeed'],
  tumbleSeconds: ['tumbleTicks'],
  tumbleGuardSeconds: ['guardTicks'],
  ballRestitution: ['ballSurface'],
  ballMassKg: ['ballInvMass'],
  rollingSlowdownMetresPerSecond2: ['rollingSlowdownDt'],
  kickoffCountdownSeconds: ['kickoffCountdownTicks'],
};

/** What a rule at v feeds: a zoomies speed moves the assist's cap only where the assist is on and its
 *  cap under v (matchConfig, C-18). */
const feeds = (k: RuleSetting, v: number): readonly (keyof SimParams)[] => {
  const cap = config.pushAssistCapMetresPerSecond;
  return k === 'zoomiesSpeedMetresPerSecond' && !(cap > 0 && v > cap) ? ['zoomiesSpeed'] : FEEDS[k];
};

const ASIDE: readonly string[] = ['config', 'derived', 'rules', 'base'];

/** The fields two parameter sets don't share, by value, as params.test.ts compares them: the
 *  configuration, its derived values, the rules and the base aside. */
const changed = (a: SimParams, b: SimParams): string[] =>
  Object.keys(a)
    .filter((k) => !ASIDE.includes(k) && JSON.stringify(a[k as keyof SimParams]) !== JSON.stringify(b[k as keyof SimParams]))
    .sort();

const settings = { packSize: 2, matchMinutes: 1 };

describe("a match's parameters: paramsFor (C-59)", () => {
  it("gives the base itself for no rules, so a match at the build's settings steps with the very parameters it always has", () => {
    expect(P.rules).toBe(NO_RULES);
    expect(P.base).toBeNull();
    // A rule left undefined is none, as the codec and matchSettingsOf read it.
    for (const none of [NO_RULES, {}, { runSpeedMetresPerSecond: undefined } as unknown as MatchRules]) expect(paramsFor(none)).toBe(P);
    // Over another base, that base: D-4's second shape's.
    const B = simParams({ ...config, pitch: SECOND_SHAPE });
    expect(B.rules).toBe(NO_RULES);
    expect(B.base).toBeNull();
    expect(paramsFor(NO_RULES, B)).toBe(B);
    expect(paramsFor({}, B)).toBe(B);
  });

  it("makes a match's parameters once for its rules, by value, and apart for each base", () => {
    const M = paramsFor(FAST);
    expect(M).not.toBe(P);
    expect(paramsFor(FAST)).toBe(M);
    // The same rules by value: a copy that isn't frozen, and one with its keys in another order.
    expect(paramsFor({ ...FAST })).toBe(M);
    expect(paramsFor(Object.fromEntries(Object.entries(FAST).reverse()))).toBe(M);
    // Other rules have their own, and a page between two matches' rules keeps both.
    const S = paramsFor(SHORT);
    expect(S).not.toBe(M);
    expect(paramsFor(FAST)).toBe(M);
    expect(paramsFor(SHORT)).toBe(S);
    // Another base has its own: the rules over its configuration.
    const B = simParams({ ...config, pitch: SECOND_SHAPE });
    const MB = paramsFor(FAST, B);
    expect(MB).not.toBe(M);
    expect(MB.base).toBe(B);
    expect(paramsFor(FAST, B)).toBe(MB);
    expect(MB.config).toEqual(matchConfig(B.config, FAST));
    expect(changed(M, MB)).toEqual(['pitch']);
  });

  it('carries the rules it was made for and the base it was made from, and paramsFor over it starts from that base', () => {
    const M = paramsFor(FAST);
    expect(M.base).toBe(P);
    expect(sameRules(M.rules, FAST)).toBe(true);
    expect(Object.isFrozen(M) && Object.isFrozen(M.rules) && Object.isFrozen(M.config)).toBe(true);
    expect(M.config).toEqual(matchConfig(config, FAST));
    // Rules that aren't frozen are kept as a frozen copy, which a later change to them never reaches.
    const given: Record<string, number> = { bowlingSpeedMetresPerSecond: away('bowlingSpeedMetresPerSecond'), turnRateTurnsPerSecond: away('turnRateTurnsPerSecond') };
    const G = paramsFor(given);
    expect(G.rules).not.toBe(given);
    expect(Object.isFrozen(G.rules)).toBe(true);
    given['bowlingSpeedMetresPerSecond'] = others('bowlingSpeedMetresPerSecond')[0]!;
    expect(G.rules.bowlingSpeedMetresPerSecond).toBe(away('bowlingSpeedMetresPerSecond'));
    expect(G.bowlingSpeed).toBe(away('bowlingSpeedMetresPerSecond'));
    // Over a match's parameters, rules are over its base, never over its rules: none give the base,
    // its own give it, and others give theirs, the first match's settings not carried.
    expect(paramsFor(NO_RULES, M)).toBe(P);
    expect(paramsFor(FAST, M)).toBe(M);
    expect(paramsFor(SHORT, M)).toBe(paramsFor(SHORT));
    expect(paramsFor(SHORT, M).runSpeed).toBe(P.runSpeed);
    // And so with a base of its own.
    const B = simParams({ ...config, pitch: SECOND_SHAPE });
    const MB = paramsFor(FAST, B);
    expect(paramsFor(NO_RULES, MB)).toBe(B);
    expect(paramsFor(SHORT, MB).base).toBe(B);
    expect(paramsFor(SHORT, MB).config).toEqual(matchConfig(B.config, SHORT));
  });

  it("takes each rule's every choice to the parameters it feeds, as simParams makes them from matchConfig, and to nothing else", () => {
    let made = 0;
    for (const k of RULE_SETTINGS) {
      for (const v of others(k)) {
        const rules: MatchRules = { [k]: v };
        const M = paramsFor(rules);
        expect(changed(P, M), `${k} ${v}`).toEqual(feeds(k, v));
        expect(changed(simParams(matchConfig(config, rules)), M), `${k} ${v}`).toEqual([]);
        expect(M.config[k], `${k} ${v}`).toBe(v);
        made++;
      }
    }
    expect(made).toBe(RULE_SETTINGS.reduce((n, k) => n + config.matchRules[k].length - 1, 0));
    // The values, as derive() and simParams make them: the run speed itself, the meter's units, the
    // tumble's ticks and the ball's inverse mass.
    for (const v of others('runSpeedMetresPerSecond')) expect(paramsFor({ runSpeedMetresPerSecond: v }).runSpeed).toBe(v);
    for (const v of others('zoomiesFullSeconds')) {
      expect(paramsFor({ zoomiesFullSeconds: v }).meterFull).toBe(v * config.ticksPerSecond * config.zoomiesMeterUnitsPerTick);
    }
    for (const v of others('tumbleSeconds')) expect(paramsFor({ tumbleSeconds: v }).tumbleTicks).toBe(v * config.ticksPerSecond);
    for (const v of others('ballMassKg')) expect(paramsFor({ ballMassKg: v }).ballInvMass).toBe(1 / v);
    // And every rule at once, the golden run's house rules: all that each feeds.
    expect(RULE_SETTINGS.every((k) => HOUSE_RULES[k] !== undefined)).toBe(true);
    expect(changed(P, paramsFor(HOUSE_RULES))).toEqual([...new Set(RULE_SETTINGS.flatMap((k) => feeds(k, HOUSE_RULES[k]!)))].sort());
  });

  it("keeps the build's bits at its own settings: no rules, and every rule at its setting through matchConfig", () => {
    // matchConfig's arithmetic, the refill's proportion and the cap's maximum, is exact there: every
    // rule at its setting gives the build's configuration and parameters, by value.
    const own = simParams(matchConfig(config, OWN));
    expect(own.config).not.toBe(config);
    expect(own.config).toEqual(config);
    expect(own.derived).toEqual(P.derived);
    expect(changed(P, own)).toEqual([]);
    // Canonical, those rules are none at all: genesis writes NO_RULES itself.
    expect(canonicalRules(OWN, config)).toBe(NO_RULES);
    expect(genesis({ ...settings, rules: OWN }).rules).toBe(NO_RULES);
    // A seeded kickoff, 4 a side, steps to the same bits tick by tick under each, and the build's.
    const scene: Scene = { name: 'seeded kickoff', packSize: 4, phase: KICKOFF_COUNTDOWN, mirrored: false, input: chasey(3, 'all') };
    const runs = [P, paramsFor(NO_RULES), own].map((Q) => ({ sim: makeSim(Q, 4), s: sceneStart(scene, Q) }));
    for (let t = 1; t <= 600; t++) {
      for (const r of runs) step(r.sim, r.s, sceneInputs(scene, r.s, t));
      const h = hashState(runs[0]!.s);
      for (const r of runs) if (hashState(r.s) !== h) expect(hashState(r.s), `tick ${t}`).toBe(h);
    }
    // The run played: out of the countdown, with contacts, its rules none.
    expect(runs[0]!.s.phase).toBe(IN_PLAY);
    expect(runs[0]!.sim.physics.stats.contacts).toBeGreaterThan(0);
    for (const r of runs) expect(r.s.rules).toBe(NO_RULES);
  });
});

describe("a match's rules in its state (C-59)", () => {
  it("are written at genesis over its parameters' base, canonical: a rule at its setting dropped, in A.1's order", () => {
    const k = 'runSpeedMetresPerSecond';
    expect(genesis({ ...settings, rules: { [k]: away(k), tumbleSeconds: config.tumbleSeconds } }).rules).toEqual({ [k]: away(k) });
    // No rules, none given, or every rule at its setting: NO_RULES itself.
    for (const rules of [{}, NO_RULES, OWN]) expect(genesis({ ...settings, rules }).rules).toBe(NO_RULES);
    expect(genesis(settings).rules).toBe(NO_RULES);
    // In A.1's order, however they come.
    const every = Object.fromEntries([...RULE_SETTINGS].reverse().map((r) => [r, away(r)]));
    expect(Object.keys(every)).not.toEqual(RULE_SETTINGS);
    expect(Object.keys(genesis({ ...settings, rules: every }).rules)).toEqual(RULE_SETTINGS);
    // Over the base: under a match's own parameters its rules are kept, though its configuration has them.
    const M = paramsFor(FAST);
    expect(genesis({ ...settings, rules: FAST }, M).rules).toEqual(FAST);
    expect(genesis({ ...settings, rules: HOUSE_RULES }, paramsFor(HOUSE_RULES)).rules).toEqual(HOUSE_RULES);
  });

  it("refuses a rule that names no rule, and a value that isn't one of the rule's choices", () => {
    expect(() => genesis({ ...settings, rules: { spinTurnsPerSecond: 1 } as MatchRules })).toThrow('spinTurnsPerSecond is no match rule (C-59)');
    // A setting that's no rule is no rule, even at its own value.
    expect(() => genesis({ ...settings, rules: { gravityMetresPerSecond2: config.gravityMetresPerSecond2 } as MatchRules })).toThrow(
      'gravityMetresPerSecond2 is no match rule (C-59)',
    );
    // Past the choices, between two, a choice negated, NaN, Infinity and a choice's own text: none of
    // them a choice, compared by Object.is.
    const run = config.matchRules.runSpeedMetresPerSecond;
    const wrong: unknown[] = [run[run.length - 1]! + 1, (run[0] + run[1]) / 2, NaN, Infinity, -run[0], String(away('runSpeedMetresPerSecond'))];
    for (const v of wrong) {
      expect(() => genesis({ ...settings, rules: { runSpeedMetresPerSecond: v as number } }), String(v)).toThrow(
        /^runSpeedMetresPerSecond \S+ isn't one of its choices, .* \(C-59\)$/,
      );
    }
  });

  it('are frozen, set at genesis and never changed: every clone and every step shares them', () => {
    const s = genesis({ ...settings, rules: SHORT });
    const rules = s.rules;
    expect(Object.isFrozen(rules)).toBe(true);
    expect(cloneState(s).rules).toBe(rules);
    expect(() => {
      (rules as Record<string, number>)['ballMassKg'] = config.ballMassKg;
    }).toThrow(TypeError);
    expect(sameRules(rules, SHORT)).toBe(true);
    // A step keeps them, and a placed match takes its parameters' own.
    const M = paramsFor(SHORT);
    step(makeSim(M, settings.packSize), s, []);
    expect(s.tick).toBe(1);
    expect(s.rules).toBe(rules);
    expect(placedMatch(M, settings.packSize).rules).toBe(M.rules);
    expect(placedMatch(P, settings.packSize).rules).toBe(NO_RULES);
  });

  it('give back the settings genesis took, through matchSettingsOf: the rules only where the match has any', () => {
    const plain = genesis({ packSize: 3, matchMinutes: 2 });
    expect(matchSettingsOf(plain)).toStrictEqual({ packSize: 3, matchMinutes: 2 });
    const ruled = genesis({ packSize: 3, matchMinutes: 2, rules: FAST });
    const back = matchSettingsOf(ruled);
    expect(back).toStrictEqual({ packSize: 3, matchMinutes: 2, rules: ruled.rules });
    expect(back.rules).toBe(ruled.rules);
    // Under the match's own parameters too, whose minute is the build's.
    expect(matchSettingsOf(ruled, paramsFor(FAST))).toStrictEqual(back);
    // Genesis from them gives the match again, byte for byte, as Play again does (L154, D-12).
    expect(hashState(genesis(back))).toBe(hashState(ruled));
    expect(hashState(genesis(matchSettingsOf(plain)))).toBe(hashState(plain));
    expect(hashState(genesis(back))).not.toBe(hashState(genesis({ packSize: 3, matchMinutes: 2 })));
  });

  it('are stepped only by a Sim made for them', () => {
    const M = paramsFor(FAST);
    const S = paramsFor(SHORT);
    const n = settings.packSize;
    // A state under its parameters, and a Sim under other parameters: refused before anything moves.
    for (const [its, other] of [[P, M], [M, P], [S, M], [M, S]] as const) {
      const s = placedMatch(its, n);
      const before = hashState(s);
      expect(() => step(makeSim(other, n), s, [])).toThrow("a state can't be stepped by a Sim made for another match's rules (C-59)");
      expect(hashState(s)).toBe(before);
    }
    // Compared by value: a copy of the rules steps.
    const copy: MatchState = { ...placedMatch(M, n), rules: { ...FAST } };
    step(makeSim(M, n), copy, []);
    expect(copy.tick).toBe(1);
    // Another pack size is named first.
    expect(() => step(makeSim(M, 1), placedMatch(P, n), [])).toThrow(/2-a-side state can't be stepped by a 1-a-side Sim/);
  });

  it("are played by: a joiner's meter fills to the match's, and a terrier runs at the match's run speed", () => {
    const meter = others('zoomiesFullSeconds')[0]!;
    const speed = away('runSpeedMetresPerSecond');
    const M = paramsFor({ zoomiesFullSeconds: meter, runSpeedMetresPerSecond: speed });
    expect([M.meterFull, M.runSpeed]).not.toEqual([P.meterFull, P.runSpeed]);
    // A JOIN in warm-up.
    const s = genesis({ packSize: 1, matchMinutes: 1, rules: M.rules });
    const [[id]] = rankedIds(1, 1);
    step(makeSim(M, 1), s, [{ id: id!, input: 0, events: JOIN, joinPack: 0 }]);
    expect(s.terriers.map((T) => T.meter)).toEqual([M.meterFull]);
    // In play, held toward +x from its kickoff spot, its rival parked: the match's run speed, exactly.
    const placed = placedMatch(M, 1);
    park(M, placed, 1);
    run({ sim: makeSim(M, 1), s: placed }, 50, (k) => (k === 0 ? pitchDir(0) : 0));
    expect([placed.terriers[0]!.vx, placed.terriers[0]!.vy]).toEqual([M.runSpeed, 0]);
  });
});

// --- P8 under the house rules (§16; design §7.6): mirror.test.ts's check, under a match's parameters ---

/** What a mirrored run met, and the first substep its state wasn't mirrored. */
interface MirrorRun {
  readonly s: MatchState;
  readonly firstMismatch: string | null;
  readonly terrierBall: number; // contacts, summed over substeps
  readonly terrierTerrier: number;
  readonly slipOuts: number;
  /** Begun as the golden replay counts them: from neither lunging nor waiting, and from neither
   *  tumbled nor guarded (replay.ts); each tumble by its timer at the end of the tick it began. */
  readonly pounces: number;
  readonly tumbles: readonly number[];
  readonly inPlayAt: number; // the tick play began, or −1
}

/** A scene stepped under M, compared by value with its mirror after every substep. */
function mirroredRun(M: SimParams, scene: Scene, ticks: number): MirrorRun {
  const sim = makeSim(M, scene.packSize);
  const ph = sim.physics;
  const s = sceneStart(scene, M);
  let firstMismatch: string | null = null;
  let terrierBall = 0;
  let terrierTerrier = 0;
  let sub = 0;
  sim.probe = (st) => {
    sub++;
    for (let c = 0; c < ph.cnt; c++) {
      const j = ph.cj[c]!;
      if (j === ph.ball) terrierBall++;
      else if (j >= 0) terrierTerrier++;
    }
    if (firstMismatch === null) {
      const m = mirrorMismatches(st, 1);
      if (m.length > 0) firstMismatch = `tick ${st.tick + 1}, substep ${sub}: ${m[0]}`;
    }
  };
  // A placed scene's roster never changes, so its list indexes stay.
  const pouncing = (T: Readonly<Terrier>): boolean => T.lunge > 0 || T.pounceWait > 0;
  const tumbling = (T: Readonly<Terrier>): boolean => T.tumble > 0 || T.guard > 0;
  let was = s.terriers.map((T) => [pouncing(T), tumbling(T)]);
  let pounces = 0;
  const tumbles: number[] = [];
  let inPlayAt = -1;
  for (let t = 1; t <= ticks && firstMismatch === null; t++) {
    step(sim, s, sceneInputs(scene, s, t));
    s.terriers.forEach((T, k) => {
      if (pouncing(T) && !was[k]![0]) pounces++;
      if (tumbling(T) && !was[k]![1]) tumbles.push(T.tumble);
    });
    was = s.terriers.map((T) => [pouncing(T), tumbling(T)]);
    if (inPlayAt < 0 && s.phase === IN_PLAY) inPlayAt = s.tick;
  }
  return { s, firstMismatch, terrierBall, terrierTerrier, slipOuts: ph.stats.slipOuts, pounces, tumbles, inPlayAt };
}

const kickoff = (packSize: number, seed: number, frames: 'all' | 'contact'): Scene => ({
  name: `mirrored kickoff ${packSize}, ${frames}`, packSize, phase: KICKOFF_COUNTDOWN, mirrored: true, input: chasey(seed, frames),
});

describe("P8 under the golden run's house rules: a mirrored kickoff stays exactly mirrored, by value (C-59)", () => {
  const H = paramsFor(HOUSE_RULES);

  /** The run was the house rules' match: its state's rules, and its kickoff countdown, not the build's. */
  const housed = (r: MirrorRun, M: SimParams): void => {
    expect(r.s.rules).toBe(M.rules);
    expect(M.kickoffCountdownTicks).not.toBe(P.kickoffCountdownTicks);
    expect(r.inPlayAt).toBe(M.kickoffCountdownTicks);
  };

  for (let packSize = 1; packSize <= 4; packSize++) {
    it(`${packSize} a side, seeded inputs in all three frames, pouncing`, () => {
      const r = mirroredRun(H, kickoff(packSize, 70 + packSize, 'all'), 900);
      expect(r.firstMismatch).toBeNull();
      housed(r, H);
      expect(r.pounces, 'pounces').toBeGreaterThan(0);
      expect(r.terrierBall, 'terrier–ball contacts').toBeGreaterThan(0);
      if (packSize > 1) expect(r.terrierTerrier, 'terrier–terrier contacts').toBeGreaterThan(0);
    });
  }

  /** Each tumble the house tumble's length: its timer at the end of its first tick its ticks less that
   *  tick's own, which step 7a counts down, and never the build's. */
  const houseTumbles = (r: MirrorRun, M: SimParams, what: string): void => {
    expect(r.tumbles.length, `${what}: tumbles`).toBeGreaterThan(0);
    expect(M.tumbleTicks).not.toBe(P.tumbleTicks);
    expect([...new Set(r.tumbles)], what).toEqual([M.tumbleTicks - 1]);
  };

  it('seeded contact play at 2 to 4 a side, tumbling for the house tumble and slipping out', () => {
    let slipOuts = 0;
    for (let packSize = 2; packSize <= 4; packSize++) {
      const r = mirroredRun(H, kickoff(packSize, 90 + packSize, 'contact'), 900);
      expect(r.firstMismatch, `${packSize} a side`).toBeNull();
      housed(r, H);
      houseTumbles(r, H, `${packSize} a side`);
      slipOuts += r.slipOuts;
    }
    expect(slipOuts).toBeGreaterThan(0);
  });

  it("4 a side in contact play on D-4's second shape, the rules over its own base", () => {
    const base = simParams({ ...config, pitch: SECOND_SHAPE });
    const M = paramsFor(HOUSE_RULES, base);
    expect(M.base).toBe(base);
    const r = mirroredRun(M, kickoff(4, 75, 'contact'), 900);
    expect(r.firstMismatch).toBeNull();
    housed(r, M);
    houseTumbles(r, M, 'the second shape');
    expect(r.pounces, 'pounces').toBeGreaterThan(0);
    expect(r.slipOuts, 'slip-outs').toBeGreaterThan(0);
    expect(r.terrierTerrier, 'terrier–terrier contacts').toBeGreaterThan(0);
  });
});
