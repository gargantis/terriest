import { describe, expect, it, vi } from 'vitest';
import { config } from '../../config';
import { ballOnTerriers, dribble, kickoffPinch, type SlipResult } from './cases';
import { defaultParams, type SimParams, simParams } from './params';
import { park, pitchDir, place, placeBall, placedMatch, type RestCase } from './scenes';
import { ballSlot } from './state';
import { makeSim, step } from './step';

// PLAN §16 "A ball on terriers" (D-5 step 7, C-21) under M0's rule, 42° with
// the slipping flag, on the M0 spike's own subset of each case, with M2's
// slip release (bots-F4): the flag's hold-off acts only within 0.6 m of the
// body slipped from, surface to surface in plan view (A.4). M0 compared
// 16 candidates; the gate runs only the chosen one, and the window's bounds,
// which are measurements, are the metrics' (design §12). "Comes down" and
// "reaches the floor" are the ball's centre within 1 cm of its resting
// height (DOWN_METRES), timed from its first landing on a terrier.
vi.setConfig({ testTimeout: 120_000 });

/** M0's mark for case 1, from the first landing to the floor. */
const REST_MARK = 1.5;
/** §16's own, for case 2. */
const SIT_MARK = 0.5;
const THETAS = [10, 20, 30, 38, 42, 45, 50, 55];

describe("§16's slip-out cases under 42° with the flag (D-5 step 7)", () => {
  it('a ball resting on terriers that keep pushing toward it comes down within 1.5 s, mirrored, at every pack size', () => {
    let worst = 0;
    let landed = 0;
    let held = 0;
    let mismatches = 0;
    for (const holding of ['ball frame', 'pitch frame, opposite'] as RestCase['holding'][]) {
      for (const thetaDeg of THETAS) {
        for (let packSize = 1; packSize <= 4; packSize++) {
          for (const offMirror of [false, true]) {
            const r: SlipResult = ballOnTerriers({ packSize, thetaDeg, holding, offMirror }, 6);
            if (r.landed === null) continue;
            landed++;
            if (r.down === null) held++;
            else worst = Math.max(worst, r.down);
            if (!offMirror && r.mirror !== null) mismatches++;
          }
        }
      }
    }
    expect(landed).toBe(128);
    expect(held, 'held up for the whole run').toBe(0);
    expect(mismatches).toBe(0);
    expect(worst).toBeLessThanOrEqual(REST_MARK);
    // The spike's own figure on this subset, recorded from it: 255 substeps.
    // REPORT.md's 1.383 s is the worst of its full sweep of 864 cases.
    expect(worst).toBe(255 / 240);
  });

  it('two sitting terriers let it reach the floor within 0.5 s: 0.471 s at worst', () => {
    let worst = 0;
    for (let thetaDeg = 4; thetaDeg <= 56; thetaDeg += 2) {
      const r = ballOnTerriers({ packSize: 1, thetaDeg, holding: 'sitting' }, 6);
      if (r.landed !== null) worst = Math.max(worst, r.down ?? Infinity);
    }
    expect(worst).toBeLessThanOrEqual(SIT_MARK);
    expect(worst.toFixed(3)).toBe('0.471');
  });

  it('a lone terrier dribbling at run and at zoomies speed never slips out, and the lowest hop onto it is 43.23° from vertical', () => {
    let slipOuts = 0;
    for (const frame of ['ball', 'pitch'] as const) {
      for (const zoomies of [false, true]) {
        for (const runUp of [0, 0.0375, 0.3956, 0.75, 2]) slipOuts += dribble(frame, zoomies, runUp).slipOuts;
      }
    }
    // The two the sweeps found hopping lowest onto the dribbler: in ball view,
    // 3 steps to the side, at zoomies from 9 m/s (REPORT.md §5.2, D-5's window).
    const lowest = dribble('ball', true, 0.1125, {}, 9, 3);
    const swept = dribble('ball', true, 0.3012, {}, 9, 3);
    const other = dribble('ball', true, 0.1125, {}, 9, 29);
    slipOuts += lowest.slipOuts + swept.slipOuts + other.slipOuts;
    expect(slipOuts).toBe(0);
    expect(lowest.hopAngles[0].toFixed(2)).toBe('43.23');
    expect(swept.hopAngles[0].toFixed(2)).toBe('43.53');
  });

  it('a kickoff pinch, its fall and the slip-out land mirrored at every pack size, down in 0.433–1.962 s', () => {
    const downs: number[] = [];
    for (let packSize = 1; packSize <= 4; packSize++) {
      for (const zoomies of [false, true]) {
        const r = kickoffPinch(packSize, zoomies, 8);
        expect(r.mirror, `pinch ${packSize}${zoomies ? ', zoomies' : ''}`).toBeNull();
        expect(r.slipOuts).toBeGreaterThan(0);
        expect(r.landed).not.toBeNull();
        expect(r.down).not.toBeNull();
        downs.push(r.down!);
      }
    }
    // M0's rule took 0.433–1.650 s. With the slip release (bots-F4) the
    // terriers come back sooner, and 2 and 4 a side at zoomies speed take
    // 1.604 and 1.962 s, from 1.229 and 1.650.
    expect(Math.min(...downs).toFixed(3)).toBe('0.433');
    expect(Math.max(...downs).toFixed(3)).toBe('1.962');
  });
});

// bots-F4: M0's flag held a slipping terrier's drive off toward the body at
// any distance until that body was down, so it couldn't brake: in the first
// scene below it coasted away at 3 m/s for 3.6 s, 11 m, until the bouncing
// ball was down. M2's slip release, chosen by a measured experiment (the
// flag cleared 0, 0.1, 0.25, 0.6 or 1 m clear of the body, or its hold-off
// kept to within 0 or 0.6 m): the hold-off acts only while the terrier is
// within 0.6 m of the body, surface to surface in plan view. That was the
// re-arm gap's value, and is now a setting of its own, slipHoldOffMetres,
// so the two tune apart. The flag itself still clears once the body is down.
describe('the slip release (D-5 step 7, bots-F4)', () => {
  const P = defaultParams;
  /** 1 a side: A slipping from the ball, on the floor at (x, 0) facing it at
   *  vx, holding toward it in the pitch frame (+x), with the ball's centre
   *  3 m up over the centre spot; B parked, sending nothing. */
  function slipped(x: number, vx: number, P: SimParams = defaultParams): (ticks: number) => { vx: number; slipping: boolean }[] {
    const s = placedMatch(P, 1, {});
    park(P, s, 1);
    place(P, s, 0, x, 0);
    const A = s.terriers[0]!;
    A.vx = vx;
    A.heading = 0;
    A.slipping = true;
    A.slipFrom = ballSlot(1);
    placeBall(P, s, 0, 0, 3);
    const sim = makeSim(P, 1);
    return (ticks) => {
      const seen: { vx: number; slipping: boolean }[] = [];
      for (let t = 1; t <= ticks; t++) {
        step(sim, s, [{ id: A.id, input: pitchDir(0), events: 0 }, { id: s.terriers[1]!.id, input: 0, events: 0 }]);
        seen.push({ vx: A.vx, slipping: A.slipping });
      }
      return seen;
    };
  }
  const reach = P.terrierRadius + P.ballRadius;

  it('lets a terrier 9 m clear of the ball brake and turn back toward it within 0.5 s, its flag still set', () => {
    const seen = slipped(-10, -3)(60);
    const turned = seen.findIndex((x) => x.vx > 0) + 1;
    expect(turned, 'ticks until it moves toward the ball').toBeGreaterThan(0);
    expect(turned).toBeLessThanOrEqual(30);
    // A run speed's braking: 3 m/s at 15 m/s² is 12 ticks, and the ball is up throughout.
    expect(turned).toBe(13);
    expect(seen.every((x) => x.slipping)).toBe(true);
  });

  it('still holds the drive off toward the body within its reach, 0.6 m, and from there out lets it go', () => {
    expect(P.slipHoldOff).toBe(0.6);
    const inside = slipped(-(reach + 0.9 * P.slipHoldOff), 0)(10);
    expect(Math.max(...inside.map((x) => Math.abs(x.vx))), 'just inside the reach: no speed gained toward the ball').toBeLessThan(1e-12);
    const outside = slipped(-(reach + 1.1 * P.slipHoldOff), 0)(1);
    expect(outside[0]!.vx, 'just outside: the drive acts').toBeGreaterThan(0);
  });

  it('reads its own reach, not the re-arm gap', () => {
    // The re-arm gap at half the reach: the hold-off still acts at 0.54 m.
    const shortGap = simParams({ ...config, rearmGapMetres: 0.3 });
    const inside = slipped(-(reach + 0.9 * P.slipHoldOff), 0, shortGap)(10);
    expect(Math.max(...inside.map((x) => Math.abs(x.vx)))).toBeLessThan(1e-12);
    // The reach at half its value: there it no longer does.
    const shortReach = simParams({ ...config, slipHoldOffMetres: 0.3 });
    expect(slipped(-(reach + 0.9 * P.slipHoldOff), 0, shortReach)(1)[0]!.vx).toBeGreaterThan(0);
  });
});
