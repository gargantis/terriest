import { describe, expect, it, vi } from 'vitest';
import { type PushResult, pushTime } from './cases';
import { pushScript } from './scripts';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN §16 "Pushes", C-18, M0 run 2: from rest, in contact, with the
// rolling slowdown, the time for the ball to reach 95% of run speed.

const fmt = (r: PushResult): string =>
  `${r.name}: ${r.seconds === null ? `not reached (top ${r.top.toFixed(2)} m/s)` : `${r.seconds.toFixed(3)} s`}` +
  `, ball off the floor ${(100 * r.airborneShare).toFixed(0)}% of substeps, ${r.slipOuts} slip-outs`;

describe('push times to 95% of run speed (§16, C-18)', () => {
  it('one pusher takes 1.2 s ± 10%', () => {
    for (const frame of ['pitch', 'ball'] as const) {
      const r = pushTime(pushScript(`one pusher, ${frame} frame`, 'train', 1, frame));
      console.log(`[push] ${fmt(r)}`);
      expect(r.seconds).not.toBeNull();
      expect(r.seconds!).toBeGreaterThanOrEqual(1.08);
      expect(r.seconds!).toBeLessThanOrEqual(1.32);
    }
  });

  it('four in a train take 0.6 s ± 10%', () => {
    const r = pushTime(pushScript('four in a train, pitch frame', 'train', 4, 'pitch'));
    console.log(`[push] ${fmt(r)}`);
    expect(r.seconds).not.toBeNull();
    expect(r.seconds!).toBeGreaterThanOrEqual(0.54);
    expect(r.seconds!).toBeLessThanOrEqual(0.66);
  });

  it('two and four side by side, in the pitch and the ball frame, are measured (marks set at M2)', () => {
    const rows: string[] = [];
    for (const m of [2, 4]) {
      for (const layout of ['round', 'line'] as const) {
        for (const frame of ['pitch', 'ball'] as const) {
          const r = pushTime(pushScript(`${m} abreast ${layout === 'round' ? 'round the ball' : 'on a line'}, ${frame} frame`, layout, m, frame), {}, 600);
          rows.push(fmt(r));
          expect(r.top).toBeGreaterThan(3); // they do move it
        }
      }
    }
    rows.push(fmt(pushTime(pushScript('two in a train, pitch frame', 'train', 2, 'pitch'))));
    rows.push(fmt(pushTime(pushScript('three in a train, pitch frame', 'train', 3, 'pitch'))));
    for (const frame of ['pitch', 'ball'] as const) rows.push(fmt(pushTime(pushScript(`3 abreast round the ball, ${frame} frame`, 'round', 3, frame), {}, 600)));
    console.log(`[push]\n  ${rows.join('\n  ')}`);
  });
});
