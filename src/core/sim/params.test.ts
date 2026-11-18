import { describe, expect, it } from 'vitest';
import { config, type Config, derive } from '../../config';
import { dir, fractionOfTurn, TURN } from './math';
import { defaultParams, type SimParams, simParams } from './params';

// SimParams from src/config.ts (design §1.5). M0's values come out bit for
// bit: each is pinned with the M0 spike's own expression, from its
// config.ts and physics.ts, never with a rounded literal.

const P = defaultParams;
const planted = (over: Partial<Config>): Config => ({ ...config, ...over });

/** The fields two parameter sets don't share, by value; the configuration
 *  and its derived values aside. */
function changed(a: SimParams, b: SimParams): string[] {
  const keys = Object.keys(a) as (keyof SimParams)[];
  return keys.filter((k) => k !== 'config' && k !== 'derived' && JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

describe('SimParams (design §1.5)', () => {
  it("gives M0's substep, turn rates and slip cone, bit for bit", () => {
    expect(P.substeps).toBe(4);
    expect(P.dt).toBe(1 / (60 * 4));
    expect(P.tickSeconds).toBe(1 / 60);
    expect(P.turnPerTick).toBe(fractionOfTurn(2, 60));
    expect(P.turnPerTick).toBe(143165576);
    expect(P.noseTurnPerTick).toBe(4294967296 / 60);
    const d = new Float64Array(2);
    dir(fractionOfTurn(42, 360), d);
    expect(P.slipCos).toBe(d[0]);
    // dir's own error at the binary angle, and that angle's rounding from
    // 42°: 0.87 units, about 1.3e-9 rad.
    expect(Math.abs(P.slipCos - Math.cos((fractionOfTurn(42, 360) / TURN) * 2 * Math.PI))).toBeLessThan(1e-15);
    expect(Math.abs(P.slipCos - Math.cos((42 * Math.PI) / 180))).toBeLessThan(1e-9);
    expect(P.jumpSpeed).toBe(Math.sqrt(2 * 9.8 * 1));
    expect(P.gaitUnitsPerMetre).toBe(TURN / 0.6);
  });

  it("gives M0's per-substep forces as the spike multiplied them, by dt", () => {
    expect(P.gravityDt).toBe(9.8 * (1 / 240));
    expect(P.driveCapDt).toBe(15 * (1 / 240));
    expect(P.idleFrictionDt).toBe(8 * (1 / 240));
    expect(P.rollingSlowdownDt).toBe(0.5 * (1 / 240));
    // The pin means something: dividing instead is an ulp off.
    expect(P.gravityDt).not.toBe(9.8 / 240);
  });

  it("squares the ball-overhead distances from the settings, as the spike did", () => {
    expect(P.overheadEnter2).toBe(0.3 * 0.3);
    expect(P.overheadLeave2).toBe(0.4 * 0.4);
    expect(P.overheadLeave2).not.toBe(0.16);
  });

  it("reads the rest from the configuration and derive()", () => {
    expect(P.celebrationTicks).toBe(204); // 3 s seen, plus w + v ticks (Q-7)
    expect([P.lungeTicks, P.pounceWaitTicks, P.tumbleTicks, P.getUpTicks, P.guardTicks]).toEqual([18, 90, 90, 30, 90]);
    expect([P.meterFull, P.meterDrain, P.meterRefill]).toEqual([360, 2, 1]);
    expect([P.sitAfterTicks, P.removeAfterTicks, P.readyExpiryTicks]).toEqual([120, 180, 3600]);
    expect([P.startCountdownTicks, P.kickoffCountdownTicks, P.ticksPerMinute]).toEqual([300, 180, 3600]);
    expect([P.ballRadius, P.ballInvMass, P.terrierRadius, P.terrierInvMass]).toEqual([0.8, 1 / 2, 0.25, 1]);
    expect([P.runSpeed, P.zoomiesSpeed, P.noseReverse, P.pounceSpeed]).toEqual([6, 9, 3, 10]);
    expect([P.restitutionThreshold, P.ballSurface, P.ballGoalNet, P.terrierBall, P.terrierRestitution]).toEqual([0.3, 0.7, 0, 0.5, 0.3]);
    expect([P.iterations, P.positionPasses, P.floorInSolve, P.slipSpeed, P.slipHoldOff]).toEqual([8, 2, true, 2, 0.6]);
    expect([P.bowlingSpeed, P.rearmGap, P.arrivalStep, P.runningMinSpeed, P.pushAssistCap]).toEqual([4, 0.6, 1, 0.2, 9]);
    expect([P.coatCount, P.nameMaxChars, P.nameMaxBytes]).toEqual([8, 20, 32]);
    expect([P.packSizeMin, P.packSizeMax, P.matchMinutesMin, P.matchMinutesMax]).toEqual([1, 4, 1, 10]);
    expect(P.kickoffSpots).toEqual(derive(config).kickoffSpots);
    expect(P.pitch.goalLineX).toBe(20);
    expect(P.config).toBe(config);
    expect(Object.isFrozen(P)).toBe(true);
    expect(simParams()).toEqual(P);
  });

  it('changes only what a planted setting feeds', () => {
    const cases: [Partial<Config>, string[]][] = [
      [{ gravityMetresPerSecond2: 9 }, ['gravityDt', 'jumpSpeed']],
      [{ jumpHeightMetres: 1.2 }, ['jumpSpeed']],
      [{ ballOverheadLeaveMetres: 0.45 }, ['overheadLeave2']],
      [{ slipOutConeDegrees: 43 }, ['slipCos']],
      // The slip release's reach and the re-arm gap are separate settings (M2).
      [{ slipHoldOffMetres: 0.5 }, ['slipHoldOff']],
      [{ rearmGapMetres: 0.5 }, ['rearmGap']],
      [{ turnRateTurnsPerSecond: 3 }, ['turnPerTick']],
      [{ substepsPerTick: 5 }, ['driveCapDt', 'dt', 'gravityDt', 'idleFrictionDt', 'rollingSlowdownDt', 'substeps']],
      [{ tumbleSeconds: 2 }, ['tumbleTicks']],
      [{ gaitCycleMetres: 0.5 }, ['gaitUnitsPerMetre']],
      [{ pushAssistCapMetresPerSecond: 12 }, ['pushAssistCap']],
      [{ goalNetRestitution: 0.3 }, ['ballGoalNet']],
      [{ pitch: { ...config.pitch, lengthMetres: 50 } }, ['pitch']],
      [{ kickoffSpotsMetres: [[], [[-11, 0]], ...config.kickoffSpotsMetres.slice(2)] }, ['kickoffSpots']],
    ];
    for (const [over, fields] of cases) expect(changed(P, simParams(planted(over))), JSON.stringify(over)).toEqual(fields);
  });

  it("gives exact zeros for the spike's test switches: no drive, no idle friction, no rolling slowdown", () => {
    const off = simParams(planted({ accelerationMetresPerSecond2: 0, idleFrictionMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0 }));
    for (const v of [off.driveCapDt, off.idleFrictionDt, off.rollingSlowdownDt]) expect(Object.is(v, 0)).toBe(true);
    expect(changed(P, off)).toEqual(['driveCapDt', 'idleFrictionDt', 'rollingSlowdownDt']);
  });

  it('throws on a configuration derive() rejects, or one the solver and A.1 cannot hold', () => {
    expect(() => simParams(planted({ lungeSeconds: 0.31 }))).toThrow(/the lunge: 0.31 s is/);
    expect(() => simParams(planted({ zoomiesRefillSeconds: 5 }))).toThrow(/the zoomies meter/);
    expect(() => simParams(planted({ pitch: { ...config.pitch, cornerCutsMetres: [4, 3, 4, 4] } }))).toThrow(/not point-symmetric/);
    expect(() => simParams(planted({ substepsPerTick: 0 }))).toThrow(/substeps: 0/);
    expect(() => simParams(planted({ solverIterations: 2.5 }))).toThrow(/solver iterations: 2.5/);
    expect(() => simParams(planted({ positionPasses: -1 }))).toThrow(/position passes: -1/);
    expect(() => simParams(planted({ packSizeMax: 5 }))).toThrow(/pack sizes 1 to 5/);
    expect(() => simParams(planted({ packSizeMin: 3, packSizeMax: 2 }))).toThrow(/pack sizes 3 to 2/);
    expect(() => simParams(planted({ matchLengthMinMinutes: 0 }))).toThrow(/match lengths 0 to 10/);
    expect(() => simParams(planted({ coatCount: 300 }))).toThrow(/300 coats/);
    expect(() => simParams(planted({ displayNameMaxBytes: 256 }))).toThrow(/a name of 256 bytes/);
    expect(() => simParams(planted({ tumbleSeconds: 1200 }))).toThrow(/don't fit A.1's u16/);
  });
});
