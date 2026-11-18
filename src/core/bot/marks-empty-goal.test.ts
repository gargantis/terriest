import { describe, expect, it, vi } from 'vitest';
import { emptyGoalRun } from './marks';

// §16's empty-goal mark (Q-9; design §8.5): one bot and a resting ball at
// seeded spots, each centre at least 2 m plus its radius inside the floor
// plan, nobody defending. At least 95 of 100 score within 20 s, and the
// bot is never stuck in any tick of the whole 20 s, past any goal.
vi.setConfig({ testTimeout: 120_000 });

describe('the empty goal (§16, Q-9)', () => {
  it('scores into an undefended goal within 20 s in at least 95 of 100 seeds, and is never stuck', () => {
    const runs = Array.from({ length: 100 }, (_, seed) => emptyGoalRun(seed));
    const missed = runs.filter((r) => r.goalTick < 0).map((r) => r.seed);
    const stuck = runs.flatMap((r) => r.stuck.map((x) => `seed ${r.seed}: ${x}`));
    expect(stuck).toEqual([]);
    expect(100 - missed.length, `missed: ${missed.join(', ')}`).toBeGreaterThanOrEqual(95);
  });
});
