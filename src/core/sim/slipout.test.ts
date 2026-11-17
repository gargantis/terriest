import { describe, expect, it, vi } from 'vitest';
import { ballOnTerriers, dribble, kickoffPinch, type SlipResult } from './cases';
import type { RestCase } from './scenes';

// PLAN §16 "A ball on terriers" (D-5 step 7, C-21) under M0's rule, 42° with
// the slipping flag, on the M0 spike's own subset of each case. M0 compared
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

  it('a kickoff pinch, its fall and the slip-out land mirrored at every pack size, down in 0.433–1.650 s', () => {
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
    expect(Math.min(...downs).toFixed(3)).toBe('0.433');
    expect(Math.max(...downs).toFixed(3)).toBe('1.650');
  });
});
