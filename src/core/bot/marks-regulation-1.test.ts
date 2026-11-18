import { describe, expect, it, vi } from 'vitest';
import { regulationMatch } from './marks';

// §16's never-stuck mark through the regulation mark's whole matches (Q-9;
// design §8.5, §12), seeds 0–24 of its 100, a quarter a file for the
// worker pool: each to ENDED, through any overtime up to a minute of it.
// No bot is ever stuck in any tick.
vi.setConfig({ testTimeout: 120_000 });

describe('never stuck, in whole regulation matches (§16, Q-9)', () => {
  it('leaves no bot stuck for 5 s in any tick of seeds 0–24', () => {
    const stuck: string[] = [];
    for (let seed = 0; seed <= 24; seed++) {
      const r = regulationMatch(seed, false);
      expect(r.ended || r.overtime, `seed ${seed} stopped early`).toBe(true);
      for (const x of r.stuck) stuck.push(`seed ${seed}: ${x}`);
    }
    expect(stuck).toEqual([]);
  });
});
