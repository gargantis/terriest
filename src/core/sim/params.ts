// The configuration in the simulation's units (PLAN §7.4, Q-10, D-3, D-5,
// D-6, D-7; design §1.5), built once per configuration, so the tuning page
// and the tests can pass a changed copy and no file in the simulation
// copies a setting. From the M0 spike's SimConfig defaults (its config.ts)
// and roslambo's makeParams.
// Each product is computed with the spike's own expression, so M0's values
// come out bit for bit: gravity × dt, never gravity / 240, since 9.8 / 240
// is an ulp from 9.8 × (1/240); 0.4 × 0.4 from the setting, which isn't
// 0.16; the slip cone's cosine through dir(). The spike's test switches
// (drive, friction, rolling) go: a test passes an acceleration, idle
// friction or rolling slowdown of 0, which gives the same bits (design §4.1).

import { config, type Config, type Derived, derive, type SpotTable } from '../../config';
import { dir, fractionOfTurn, TURN } from './math';
import { buildPitch, type Pitch } from './pitch';

export interface SimParams {
  readonly config: Config;
  readonly derived: Derived;
  readonly pitch: Pitch;
  readonly substeps: number; // 4 (D-3)
  readonly dt: number; // derived.substepSeconds, 1/240
  readonly tickSeconds: number;
  readonly gravityDt: number; // g · dt
  readonly driveCapDt: number; // acceleration · dt
  readonly idleFrictionDt: number;
  readonly rollingSlowdownDt: number;
  readonly ballRadius: number;
  readonly ballInvMass: number;
  readonly terrierRadius: number;
  readonly terrierInvMass: number;
  readonly runSpeed: number;
  readonly zoomiesSpeed: number;
  readonly noseReverse: number;
  readonly pounceSpeed: number;
  readonly jumpSpeed: number; // derived
  readonly turnPerTick: number; // fractionOfTurn(turn rate, ticks a second), an integer
  readonly noseTurnPerTick: number; // TURN · nose rate / ticks a second, not rounded (D-7)
  readonly overheadEnter2: number; // squared horizontal centre distances (D-7)
  readonly overheadLeave2: number;
  readonly restitutionThreshold: number;
  readonly ballSurface: number; // the ball off the floor, walls, overhead net and goal frame
  readonly ballGoalNet: number;
  readonly terrierBall: number;
  readonly terrierRestitution: number; // terriers off each other and the walls
  readonly iterations: number;
  readonly positionPasses: number;
  readonly floorInSolve: boolean;
  readonly slipCos: number; // dir(fractionOfTurn(cone°, 360))[0], cos 42°
  readonly slipSpeed: number;
  readonly slipHoldOff: number; // the slip release's reach, surface to surface in plan view (D-5 step 7, M2)
  readonly bowlingSpeed: number;
  readonly rearmGap: number;
  readonly lungeTicks: number;
  readonly pounceWaitTicks: number;
  readonly tumbleTicks: number;
  readonly getUpTicks: number;
  readonly guardTicks: number;
  readonly meterFull: number; // half-ticks (A.1)
  readonly meterDrain: number;
  readonly meterRefill: number;
  readonly sitAfterTicks: number;
  readonly removeAfterTicks: number;
  readonly readyExpiryTicks: number;
  readonly startCountdownTicks: number;
  readonly kickoffCountdownTicks: number;
  readonly celebrationTicks: number;
  readonly ticksPerMinute: number;
  readonly kickoffSpots: readonly [SpotTable, SpotTable];
  readonly arrivalStep: number; // D-8's 1 m
  readonly gaitUnitsPerMetre: number; // TURN / the gait's cycle
  readonly runningMinSpeed: number; // 0.2 m/s: running above it, as M0's sp > 0.2
  readonly coatCount: number;
  readonly nameMaxChars: number;
  readonly nameMaxBytes: number;
  readonly packSizeMin: number;
  readonly packSizeMax: number;
  readonly matchMinutesMin: number;
  readonly matchMinutesMax: number;
  readonly pushAssistCap: number; // 0: off, and the rule is skipped (C-18; design §4.4)
}

const whole = (x: number, min: number, max: number): boolean => Number.isInteger(x) && x >= min && x <= max;

/** What the solver's loops and A.1's fields need of a configuration beyond
 *  derive()'s whole ticks: whole counts, and values that fit their bytes. */
function formatProblems(c: Config, d: Derived): string[] {
  const problems: string[] = [];
  const u16 = 0xffff; // not a setting: A.1's u16
  const checks: [string, boolean][] = [
    // The spike's checkSolver.
    [`substeps: ${c.substepsPerTick} isn't a whole number from 1`, whole(c.substepsPerTick, 1, Infinity)],
    [`solver iterations: ${c.solverIterations} isn't a whole number from 1`, whole(c.solverIterations, 1, Infinity)],
    [`position passes: ${c.positionPasses} isn't a whole number from 0`, whole(c.positionPasses, 0, Infinity)],
    // A.1: the scorers' byte has a bit for each of 2 × 4 terriers, a coat
    // and a name's length are bytes, and the timers are u16.
    [`pack sizes ${c.packSizeMin} to ${c.packSizeMax} aren't whole numbers from 1 to 4 (A.1)`, whole(c.packSizeMin, 1, c.packSizeMax) && whole(c.packSizeMax, 1, 4)],
    [`match lengths ${c.matchLengthMinMinutes} to ${c.matchLengthMaxMinutes} aren't whole minutes from 1 (D-8)`, whole(c.matchLengthMinMinutes, 1, c.matchLengthMaxMinutes) && Number.isInteger(c.matchLengthMaxMinutes)],
    [`${c.coatCount} coats aren't a whole number from 1 to 256 (A.1)`, whole(c.coatCount, 1, 256)],
    [`a name of ${c.displayNameMaxBytes} bytes doesn't fit A.1's byte for its length`, whole(c.displayNameMaxBytes, 0, 255) && whole(c.displayNameMaxChars, 0, Infinity)],
    [`the lunge, pounce wait, tumble and guard, ${d.lungeTicks}, ${d.pounceWaitTicks}, ${d.tumbleTicks} and ${d.tumbleGuardTicks} ticks, don't fit A.1's u16`,
      [d.lungeTicks, d.pounceWaitTicks, d.tumbleTicks, d.tumbleGuardTicks].every((t) => whole(t, 0, u16))],
  ];
  for (const [problem, ok] of checks) if (!ok) problems.push(problem);
  return problems;
}

/** The simulation's parameters for a configuration. Throws as derive()
 *  does, and on counts the solver and A.1 can't hold. */
export function simParams(c: Config = config): SimParams {
  const d = derive(c);
  const problems = formatProblems(c, d);
  if (problems.length > 0) throw new Error(problems.join('; '));
  const dt = d.substepSeconds;
  const cone = new Float64Array(2);
  dir(fractionOfTurn(c.slipOutConeDegrees, 360), cone); // not a setting: degrees a turn
  return Object.freeze({
    config: c,
    derived: d,
    pitch: buildPitch(c.pitch),
    substeps: c.substepsPerTick,
    dt,
    tickSeconds: d.tickSeconds,
    gravityDt: c.gravityMetresPerSecond2 * dt,
    driveCapDt: c.accelerationMetresPerSecond2 * dt,
    idleFrictionDt: c.idleFrictionMetresPerSecond2 * dt,
    rollingSlowdownDt: c.rollingSlowdownMetresPerSecond2 * dt,
    ballRadius: c.ballRadiusMetres,
    ballInvMass: 1 / c.ballMassKg,
    terrierRadius: c.terrierRadiusMetres,
    terrierInvMass: 1 / c.terrierMassKg,
    runSpeed: c.runSpeedMetresPerSecond,
    zoomiesSpeed: c.zoomiesSpeedMetresPerSecond,
    noseReverse: c.noseReverseMetresPerSecond,
    pounceSpeed: c.pounceSpeedMetresPerSecond,
    jumpSpeed: d.jumpSpeedMetresPerSecond,
    turnPerTick: fractionOfTurn(c.turnRateTurnsPerSecond, c.ticksPerSecond),
    noseTurnPerTick: (TURN * c.noseTurnRateTurnsPerSecond) / c.ticksPerSecond,
    overheadEnter2: c.ballOverheadEnterMetres * c.ballOverheadEnterMetres,
    overheadLeave2: c.ballOverheadLeaveMetres * c.ballOverheadLeaveMetres,
    restitutionThreshold: c.restitutionThresholdMetresPerSecond,
    ballSurface: c.ballRestitution,
    ballGoalNet: c.goalNetRestitution,
    terrierBall: c.terrierBallRestitution,
    terrierRestitution: c.terrierRestitution,
    iterations: c.solverIterations,
    positionPasses: c.positionPasses,
    floorInSolve: c.floorContactsInSolve,
    slipCos: cone[0]!,
    slipSpeed: c.slipOutSpeedMetresPerSecond,
    slipHoldOff: c.slipHoldOffMetres,
    bowlingSpeed: c.bowlingSpeedMetresPerSecond,
    rearmGap: c.rearmGapMetres,
    lungeTicks: d.lungeTicks,
    pounceWaitTicks: d.pounceWaitTicks,
    tumbleTicks: d.tumbleTicks,
    getUpTicks: d.getUpTicks,
    guardTicks: d.tumbleGuardTicks,
    meterFull: d.zoomiesMeterFull,
    meterDrain: d.zoomiesMeterDrainPerTick,
    meterRefill: d.zoomiesMeterRefillPerTick,
    sitAfterTicks: c.sittingSilentTicks,
    removeAfterTicks: c.removalSilentTicks,
    readyExpiryTicks: d.readyExpiryTicks,
    startCountdownTicks: d.startCountdownTicks,
    kickoffCountdownTicks: d.kickoffCountdownTicks,
    celebrationTicks: d.celebrationTicks,
    ticksPerMinute: d.ticksPerMinute,
    kickoffSpots: d.kickoffSpots,
    arrivalStep: c.warmUpArrivalStepMetres,
    gaitUnitsPerMetre: TURN / c.gaitCycleMetres,
    runningMinSpeed: c.runningMinSpeedMetresPerSecond,
    coatCount: c.coatCount,
    nameMaxChars: c.displayNameMaxChars,
    nameMaxBytes: c.displayNameMaxBytes,
    packSizeMin: c.packSizeMin,
    packSizeMax: c.packSizeMax,
    matchMinutesMin: c.matchLengthMinMinutes,
    matchMinutesMax: c.matchLengthMaxMinutes,
    pushAssistCap: c.pushAssistCapMetresPerSecond,
  });
}

/** The parameters of src/config.ts. */
export const defaultParams: SimParams = simParams(config);
