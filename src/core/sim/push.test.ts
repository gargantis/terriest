import { describe, expect, it, vi } from 'vitest';
import { type PushResult, pushTime } from './cases';

// PLAN §16 "Pushes", C-18, M0 run 2 (D-6 as M0 amended it): from rest, in
// contact, with the rolling slowdown, the time for the ball to reach 95% of
// run speed. §16's marks, and M0's times pinned to the digits
// research/spike/REPORT.md §5.2 prints. C-18's side-by-side marks were set at
// M2, provisionally by measurement, with the push assist on at its settled
// 9 m/s cap (research/tuning/REPORT.md): each time within ± 10% of its mark,
// as §16's own push marks are, and pinned to the millisecond, so a change to
// the drive or the assist sets the marks again on purpose.
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

  it("two and four side by side reach C-18's marks in both frames, and in ball view beat one pusher", () => {
    // Round the ball, touching it 33° apart, and on a line abreast 0.52 m
    // apart. The assist acts only in ball view, so the pitch frame keeps M0's
    // times; without it, ball view took M0's 2.033, 2.033, 1.313 and 0.921 s
    // (assist.test.ts), all slower than one pusher's 1.225 s.
    const marks: [layout: 'round' | 'line', m: number, frame: 'pitch' | 'ball', mark: number][] = [
      ['round', 2, 'pitch', 0.829],
      ['line', 2, 'pitch', 0.833],
      ['round', 4, 'pitch', 0.721],
      ['line', 4, 'pitch', 0.758],
      ['round', 2, 'ball', 1.175],
      ['line', 2, 'ball', 1.175],
      ['round', 4, 'ball', 0.983],
      ['line', 4, 'ball', 0.854],
    ];
    const one = pushTime('train', 1, 'ball');
    expect(seconds(one)).toBe('1.225');
    for (const [layout, m, frame, mark] of marks) {
      const r = pushTime(layout, m, frame, {}, 600);
      expect(r.seconds, fmt(r)).not.toBeNull();
      expect(r.seconds!, `${fmt(r)}: ${mark} s - 10%`).toBeGreaterThanOrEqual(0.9 * mark);
      expect(r.seconds!, `${fmt(r)}: ${mark} s + 10%`).toBeLessThanOrEqual(1.1 * mark);
      expect(seconds(r), fmt(r)).toBe(mark.toFixed(3));
      if (frame === 'ball') expect(r.seconds!, `${fmt(r)}: quicker than one pusher`).toBeLessThan(one.seconds!);
      expect(r.slipOuts, fmt(r)).toBe(0);
    }
  });
});
