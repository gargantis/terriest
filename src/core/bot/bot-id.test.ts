import { describe, expect, it } from 'vitest';
import { config } from '../../config';
import { isPlayerId } from '../sim/input';
import { defaultParams } from '../sim/params';
import { rankedIds } from '../sim/scenes';
import { cleanName } from '../sim/state';
import { BOT_SLOTS, botCoat, botId, botIds, botName, botSeed, isBot } from './bot-id';
import { personId } from './marks';

// Bot IDs, names, coats and seeds (PLAN D-39, Q-9; design §1.17, §8.3):
// roslambo's bot ID tests, with terriest's slots, coats and seeds.

const host = (k: number): string => (k + 1).toString(16).padStart(32, '0');

describe('bot IDs (D-39)', () => {
  it("gives each host its own bot IDs, the same after a reload, of a UUID version no person's ID uses", () => {
    expect(BOT_SLOTS).toBe(2 * config.packSizeMax); // Practice's 7 at 4 a side, and a spare
    const a = botIds(host(1));
    const b = botIds(host(2));
    expect(a).toHaveLength(BOT_SLOTS);
    expect(new Set([...a, ...b]).size).toBe(2 * BOT_SLOTS);
    expect(botIds(host(1))).toEqual(a);
    expect(botId(host(1), 3)).toBe(a[3]);
    for (const x of [...a, ...b]) {
      expect(x).toMatch(/^[0-9a-f]{12}8[0-9a-f]{3}[89ab][0-9a-f]{15}$/); // version 8, variant 10 (RFC 9562)
      expect(isPlayerId(x)).toBe(true);
      expect(isBot(x)).toBe(true);
    }
  });

  it("tells a person's ID from a bot's by its version digit alone (D-25)", () => {
    // A browser's own ID is version 4: crypto.randomUUID's, and the scenes' and marks' people.
    for (let k = 0; k < 200; k++) expect(isBot(crypto.randomUUID().replace(/-/g, ''))).toBe(false);
    for (const id of [...rankedIds(7, 4).flat(), personId(3, 0), personId(3, 1)]) expect(isBot(id)).toBe(false);
    // Not a player ID at all: too short, upper case, or not hex.
    const bot = botId(host(0), 0);
    for (const id of [bot.slice(1), bot.toUpperCase(), `${bot.slice(0, 31)}g`, '']) expect(isBot(id)).toBe(false);
  });

  it('names a bot from its ID, in a form the name rule keeps (C-17)', () => {
    for (const id of botIds(host(5))) {
      const name = botName(id);
      expect(name).toBe(`Bot ${id.slice(0, 4).toUpperCase()}`);
      expect(cleanName(name, defaultParams)).toBe(name);
    }
  });

  it('gives each bot a coat from the list, seeded by its ID (D-39)', () => {
    const seen = new Array<number>(config.coatCount).fill(0);
    for (let h = 0; h < 40; h++) {
      for (const id of botIds(host(h))) {
        const coat = botCoat(id, config.coatCount);
        expect(Number.isInteger(coat) && coat >= 0 && coat < config.coatCount, `${id}: coat ${coat}`).toBe(true);
        expect(botCoat(id, config.coatCount)).toBe(coat);
        seen[coat]!++;
      }
    }
    // 320 bots over 8 coats: every coat drawn, none hugely favoured.
    for (const n of seen) expect(n).toBeGreaterThan(20);
    expect(botCoat(botId(host(0), 0), 1)).toBe(0);
  });

  it("gives each bot a seed of its own for its brain's noise", () => {
    const seeds = new Set<number>();
    for (let h = 0; h < 20; h++) {
      for (const id of botIds(host(h))) {
        const seed = botSeed(id);
        expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
        expect(botSeed(id)).toBe(seed);
        seeds.add(seed);
      }
    }
    expect(seeds.size).toBe(20 * BOT_SLOTS);
  });
});
