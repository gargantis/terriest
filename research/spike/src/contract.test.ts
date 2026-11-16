import { describe, expect, it } from 'vitest';
import { SUBSTEPS, TICK_RATE } from './contract';

describe('the sim/scene contract', () => {
  it('runs 60 ticks a second in 4 substeps (PLAN D-3)', () => {
    expect(TICK_RATE).toBe(60);
    expect(SUBSTEPS).toBe(4);
  });
});
