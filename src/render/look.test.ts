import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { coatOf, PLACEHOLDER_LOOK } from './look';
import { GRASS, LINE, NETTING, PACKS, ROPE, SKY, WALL_PANEL, WHITE } from './palette';

// The look's contract (M4's design §1.11, §2.9): the placeholder has a coat
// for each of config.coatCount, so every index the state, storage and
// messages carry draws as its own coat; one outside the list draws as coat
// 0 (L44, D-12); and M1's palette reads the placeholder unchanged.

describe('the placeholder look (M4)', () => {
  it('has a coat for each of the configuration\'s coats, none in a pack\'s colour (L43, L44)', () => {
    expect(PLACEHOLDER_LOOK.coats).toHaveLength(config.coatCount);
    expect(new Set(PLACEHOLDER_LOOK.coats.map((c) => c.name)).size).toBe(config.coatCount);
    const packColours = PLACEHOLDER_LOOK.packs.map((p) => p.colour);
    for (const c of PLACEHOLDER_LOOK.coats) expect(packColours, c.name).not.toContain(c.fur);
    expect(PLACEHOLDER_LOOK.packs.map((p) => p.pattern)).toEqual(['plain', 'striped']);
  });

  it('draws a coat outside the list as coat 0 (D-12)', () => {
    const look = PLACEHOLDER_LOOK;
    expect(coatOf(look, 3)).toBe(look.coats[3]);
    expect(coatOf(look, config.coatCount - 1)).toBe(look.coats[config.coatCount - 1]);
    for (const index of [config.coatCount, -1, 1.5, NaN, 255]) expect(coatOf(look, index), `${index}`).toBe(look.coats[0]);
  });

  it("keeps M1's palette: the pitch's colours, read from the look", () => {
    expect(PACKS).toBe(PLACEHOLDER_LOOK.packs);
    expect(PACKS.map((p) => [p.colour, p.pattern])).toEqual([[0x2f6bd8, 'plain'], [0xf07a1a, 'striped']]);
    expect([SKY, GRASS, LINE, WALL_PANEL, ROPE, NETTING, WHITE]).toEqual([0xa9d3ef, 0x5c9e46, 0xf4f4ee, 0xe6ecef, 0xcdb98c, 0xf6f6f2, 0xffffff]);
  });
});
