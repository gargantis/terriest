import { describe, expect, it, vi } from 'vitest';
import { SLIP_OUT_RULES, type SlipOutName } from './config';
import { ballOnTerriers, dribble, type Holding, kickoffPinch, type SlipResult } from './cases';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN §16 "A ball on terriers" (D-5 step 7, C-21), for every candidate.
// Each candidate is run on a representative set of each case; the full
// sweeps behind the report are in measure.test.ts. The verdicts the
// candidates must reach are pinned, so a change to the solver that moves
// one shows up here.

/** The mark M0 sets for case 1: from the first landing to the floor. */
export const REST_MARK = 1.5;
const SIT_MARK = 0.5; // §16's own

const THETAS = [10, 20, 30, 38, 42, 45, 50, 55];

interface Verdict {
  rest: { worst: number; held: number; mismatches: number };
  sitting: number; // worst seconds
  dribbleSlips: number;
  pinch: { worst: number; up: number; mismatches: number };
}

function judge(rule: SlipOutName): Verdict {
  let worst = 0;
  let held = 0;
  let mismatches = 0;
  for (const holding of ['ball frame', 'pitch frame, opposite'] as Holding[]) {
    for (const thetaDeg of THETAS) {
      for (let packSize = 1; packSize <= 4; packSize++) {
        for (const offMirror of [false, true]) {
          const r: SlipResult = ballOnTerriers(rule, { packSize, thetaDeg, holding, offMirror }, 6);
          if (r.landed === null) continue;
          if (r.down === null) held++;
          else worst = Math.max(worst, r.down);
          if (!offMirror && r.mirror !== null) mismatches++;
        }
      }
    }
  }
  let sitting = 0;
  for (let thetaDeg = 4; thetaDeg <= 56; thetaDeg += 2) {
    const r = ballOnTerriers(rule, { packSize: 1, thetaDeg, holding: 'sitting' }, 6);
    if (r.landed !== null) sitting = Math.max(sitting, r.down ?? Infinity);
  }
  // Dribbles at run and zoomies, from contact and with run-ups, including
  // the two the sweeps found hopping lowest onto the dribbler: straight at
  // zoomies (44.95°) and a 3-step side step in ball view (43.23°).
  let dribbleSlips = 0;
  for (const frame of ['ball', 'pitch'] as const) {
    for (const zoomies of [false, true]) {
      for (const runUp of [0, 0.0375, 0.3956, 0.75, 2]) dribbleSlips += dribble(rule, frame, zoomies, runUp).slipOuts;
    }
  }
  dribbleSlips += dribble(rule, 'ball', true, 0.1125, {}, 9, 3).slipOuts;
  dribbleSlips += dribble(rule, 'ball', true, 0.3012, {}, 9, 3).slipOuts;
  dribbleSlips += dribble(rule, 'ball', true, 0.1125, {}, 9, 29).slipOuts;
  let pinchWorst = 0;
  let pinchUp = 0;
  let pinchMismatches = 0;
  for (let packSize = 1; packSize <= 4; packSize++) {
    for (const zoomies of [false, true]) {
      const r = kickoffPinch(rule, packSize, zoomies, 8);
      if (r.mirror !== null) pinchMismatches++;
      if (r.landed === null) continue;
      if (r.down === null) pinchUp++;
      else pinchWorst = Math.max(pinchWorst, r.down);
    }
  }
  return { rest: { worst, held, mismatches }, sitting, dribbleSlips, pinch: { worst: pinchWorst, up: pinchUp, mismatches: pinchMismatches } };
}

function passes(v: Verdict): { rest: boolean; sitting: boolean; dribble: boolean; pinch: boolean } {
  return {
    rest: v.rest.held === 0 && v.rest.worst <= REST_MARK && v.rest.mismatches === 0,
    sitting: v.sitting <= SIT_MARK,
    dribble: v.dribbleSlips === 0,
    pinch: v.pinch.mismatches === 0,
  };
}

// What M0 measured for each candidate (case 4 asks only that the pinch, its
// fall and the slip-out land mirrored; its fall time is reported).
const EXPECTED: Record<SlipOutName, ReturnType<typeof passes>> = {
  none: { rest: false, sitting: false, dribble: true, pinch: true },
  drafted: { rest: false, sitting: true, dribble: false, pinch: true },
  wide: { rest: false, sitting: true, dribble: false, pinch: true },
  flag: { rest: true, sitting: true, dribble: false, pinch: true },
  e0: { rest: false, sitting: true, dribble: false, pinch: true },
  flagE0: { rest: true, sitting: true, dribble: false, pinch: true },
  wideFlag: { rest: true, sitting: true, dribble: false, pinch: true },
  wideE0: { rest: false, sitting: true, dribble: false, pinch: true },
  wideFlagE0: { rest: true, sitting: true, dribble: false, pinch: true },
  review57: { rest: true, sitting: true, dribble: false, pinch: true },
  flag42: { rest: true, sitting: true, dribble: true, pinch: true },
  flag40: { rest: true, sitting: false, dribble: true, pinch: true },
  flag42E0: { rest: true, sitting: true, dribble: true, pinch: true },
  flag40E0: { rest: true, sitting: false, dribble: true, pinch: true },
  flag44: { rest: true, sitting: true, dribble: false, pinch: true },
  flag44E0: { rest: true, sitting: true, dribble: false, pinch: true },
};

describe('slip-out candidates on §16\'s cases (D-5 step 7)', () => {
  for (const name of Object.keys(SLIP_OUT_RULES) as SlipOutName[]) {
    it(`${SLIP_OUT_RULES[name].name}`, () => {
      const v = judge(name);
      const p = passes(v);
      console.log(
        `[slip-out] ${SLIP_OUT_RULES[name].name.padEnd(13)} ` +
        `rest ${p.rest ? 'pass' : 'FAIL'} (worst ${v.rest.worst.toFixed(2)} s, held up ${v.rest.held}); ` +
        `sitting ${p.sitting ? 'pass' : 'FAIL'} (worst ${Number.isFinite(v.sitting) ? v.sitting.toFixed(2) : 'held'} s); ` +
        `dribbles ${p.dribble ? 'pass' : 'FAIL'} (${v.dribbleSlips} slip-outs); ` +
        `pinch ${p.pinch ? 'mirrored' : 'NOT MIRRORED'} (down within ${v.pinch.worst.toFixed(2)} s, ${v.pinch.up} of 8 held up)`,
      );
      expect(p).toEqual(EXPECTED[name]);
    });
  }

  it('at least one candidate passes all four cases (M0 stop rule)', () => {
    const all = (Object.keys(EXPECTED) as SlipOutName[]).filter((n) => Object.values(EXPECTED[n]).every(Boolean));
    expect(all).toEqual(['flag42', 'flag42E0']);
  });
});
