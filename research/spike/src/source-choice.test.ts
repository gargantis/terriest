import { describe, expect, it } from 'vitest';
import { sourceChoice } from './source-choice';
import { createSimSource } from './sim/source';

const choose = (query: string) => sourceChoice(new URLSearchParams(query));

describe("the page's choice of simulation", () => {
  it('defaults to the showcase at 4 a side under 42+flag, which kicks off and plays on', () => {
    const c = choose('');
    expect(c).toMatchObject({ script: 'showcase 4', packSize: 4, slipOut: 'flag42' });
    const src = createSimSource(c.options);
    expect(src.packSize).toBe(4);
    expect(src.view().terriers).toHaveLength(8);
    // The kickoff countdown, then play: terriers leave their spots.
    const at = src.view().terriers.map((t) => [t.x, t.y]);
    src.advance(600);
    const moved = src.view().terriers.filter((t, k) => Math.hypot(t.x - at[k]![0]!, t.y - at[k]![1]!) > 1);
    expect(moved.length).toBeGreaterThan(0);
    expect(src.script.ticks).toBeGreaterThan(60 * 60 * 60);
  });

  it('takes a golden script by name, a showcase pack size, and a slip-out rule', () => {
    expect(choose('script=scrum%20at%20the%20wall%2C%20flag42')).toMatchObject({ script: 'scrum at the wall, flag42', packSize: 4, slipOut: 'flag42' });
    expect(choose('script=pinch 2&slipOut=flag42E0')).toMatchObject({ script: 'pinch 2', packSize: 2, slipOut: 'flag42E0' });
    expect(choose('pack=2')).toMatchObject({ script: 'showcase 2', packSize: 2 });
    expect(createSimSource(choose('script=goals').options).packSize).toBe(1);
  });

  it('refuses what it cannot draw or does not know', () => {
    expect(() => choose('script=nothing')).toThrow(/no script/);
    expect(() => choose('script=kickoff 2, second shape')).toThrow(/second shape/);
    expect(() => choose('pack=5')).toThrow(/outside/);
    expect(() => choose('script=goals&pack=4')).toThrow(/1 a side/);
    expect(() => choose('slipOut=sideways')).toThrow(/no slip-out rule/);
  });
});
