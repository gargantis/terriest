import { describe, expect, it, vi } from 'vitest';
import { regulationMatch } from './marks';

// §16's regulation mark, the count (Q-9; design §8.5): 2-a-side bot matches
// at the default 3 minutes, from genesis. At least 90 of 100 have a goal
// before the clock reaches 0. Each run stops at its first goal, or at 0:00;
// that first part is, bit for bit, the start of the whole matches that
// marks-regulation-1 to -4 play for never-stuck.
vi.setConfig({ testTimeout: 120_000 });

describe('a goal in regulation (§16, Q-9)', () => {
  it('has a goal before the clock reaches 0 in at least 90 of 100 bot matches, 2 a side, 3 minutes', () => {
    const runs = Array.from({ length: 100 }, (_, seed) => regulationMatch(seed, true));
    const none = runs.filter((r) => !r.regulationGoal).map((r) => r.seed);
    expect(100 - none.length, `no regulation goal: ${none.join(', ')}`).toBeGreaterThanOrEqual(90);
  });
});
