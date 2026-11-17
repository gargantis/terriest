import { describe, expect, it, vi } from 'vitest';
import { type PushResult, pushTime } from './cases';

// PLAN §16 "Pushes", C-18, M0 run 2 (D-6 as M0 amended it): from rest, in
// contact, with the rolling slowdown, the time for the ball to reach 95% of
// run speed. §16's marks, and M0's times pinned to the digits
// research/spike/REPORT.md §5.2 prints. The side-by-side marks are set with
// the owner at M2 (settle adds them).
vi.setConfig({ testTimeout: 120_000 });

const fmt = (r: PushResult): string =>
  `${r.name}: ${r.seconds === null ? `not reached (top ${r.top.toFixed(2)} m/s)` : `${r.seconds.toFixed(3)} s`}` +
  `, ball off the floor ${(100 * r.airborneShare).toFixed(0)}% of substeps, ${r.slipOuts} slip-outs`;

const seconds = (r: PushResult): string => (r.seconds === null ? 'not reached' : r.seconds.toFixed(3));

describe('push times to 95% of run speed (§16, C-18)', () => {
  it('one pusher takes 1.2 s ± 10%: 1.225 s, in the pitch and the ball frame', () => {
    for (const frame of ['pitch', 'ball'] as const) {
      const r = pushTime('train', 1, frame);
      expect(r.seconds, fmt(r)).not.toBeNull();
      expect(r.seconds!).toBeGreaterThanOrEqual(1.08);
      expect(r.seconds!).toBeLessThanOrEqual(1.32);
      expect(seconds(r), fmt(r)).toBe('1.225');
    }
  });

  it('four in a train take 0.6 s ± 10%: 0.575 s; two in a train 0.779 s', () => {
    const four = pushTime('train', 4, 'pitch');
    expect(four.seconds, fmt(four)).not.toBeNull();
    expect(four.seconds!).toBeGreaterThanOrEqual(0.54);
    expect(four.seconds!).toBeLessThanOrEqual(0.66);
    expect(seconds(four)).toBe('0.575');
    expect(seconds(pushTime('train', 2, 'pitch'))).toBe('0.779');
  });

  it("two and four side by side, in the pitch frame and then the ball frame, take M0's times", () => {
    // Round the ball, touching it 33° apart, and on a line abreast 0.52 m apart.
    const want: [layout: 'round' | 'line', m: number, pitch: string, ball: string][] = [
      ['round', 2, '0.829', '2.033'],
      ['line', 2, '0.833', '2.033'],
      ['round', 4, '0.721', '1.313'],
      ['line', 4, '0.758', '0.921'],
    ];
    for (const [layout, m, pitch, ball] of want) {
      const p = pushTime(layout, m, 'pitch', {}, 600);
      const b = pushTime(layout, m, 'ball', {}, 600);
      expect([seconds(p), seconds(b)], `${fmt(p)}; ${fmt(b)}`).toEqual([pitch, ball]);
      expect(p.slipOuts + b.slipOuts).toBe(0);
    }
  });
});
