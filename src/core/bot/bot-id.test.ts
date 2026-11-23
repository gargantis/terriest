import { describe, expect, it } from 'vitest';
import { config } from '../../config';
import { fitName } from '../names';
import { decode, encodeTick, NO_TICK, type Tick, wireLimits, wireString, ZERO_HASH } from '../protocol/messages';
import { isPlayerId, JOIN, READY } from '../sim/input';
import { defaultParams } from '../sim/params';
import { rankedIds } from '../sim/scenes';
import { cleanName } from '../sim/state';
import { BOT_NAMES, BOT_SLOTS, botCoat, botId, botIds, botName, botNames, botSeed, isBot } from './bot-id';
import { personId } from './marks';

// Bot IDs, names, coats and seeds (PLAN D-39, Q-9, §14; design §1.17,
// §8.3): roslambo's bot ID tests, with terriest's slots, coats and seeds;
// and the robot dogs' names (the owner, 2026-11-22).

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

describe("bots' names (the owner, 2026-11-22)", () => {
  /** A bot whose first choice isn't the list's first name, so a walk from it can go round the end. */
  const walker = botIds(host(0)).find((id) => botName(id) !== BOT_NAMES[0])!;
  const first = BOT_NAMES.indexOf(botName(walker));
  /** The list's names from the walker's first choice on, round the end. */
  const from = (k: number): string => BOT_NAMES[(first + k) % BOT_NAMES.length]!;

  it('lists 32 names, each its own, kept unchanged by the name rules (C-17) and the wire, and none a nameless label', () => {
    expect(BOT_NAMES).toHaveLength(32);
    expect(new Set(BOT_NAMES).size).toBe(BOT_NAMES.length);
    const L = wireLimits();
    const bot = botId(host(0), 0);
    for (const name of BOT_NAMES) {
      // As Home fits a typed name, as the simulation keeps a JOIN's, and as the wire writes one.
      expect([fitName(name), cleanName(name, defaultParams), wireString(name, L.nameMaxBytes)], name).toEqual([name, name, name]);
      expect(new TextEncoder().encode(name).length, name).toBeLessThanOrEqual(L.nameMaxBytes);
      // A bot's JOIN carries it through a TICK unchanged.
      const bytes = encodeTick({
        t: 9, own: null, voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0,
        bots: [{ id: bot, input: 0, present: 1, hist: new Array<number>(16).fill(0), events: [{ back: 0, events: JOIN | READY, joinPack: 1, coat: 2, name }] }],
      });
      expect((decode(bytes) as Tick).bots[0]!.events[0]!.name, name).toBe(name);
      // Never the screens' label for a nameless person, nor the fallback (src/core/names.ts).
      expect(name, name).not.toMatch(/^(Player|Bot) [0-9A-F]{4}$/);
    }
  });

  it("has more names than a host's taken names can hold: its final state's terriers and its head's, its bots and its player", () => {
    expect(BOT_NAMES.length).toBeGreaterThan(2 * 2 * config.packSizeMax + BOT_SLOTS + 1);
  });

  it("names a bot from the list by its ID alone, the same every time, every name some bot's first choice", () => {
    const seen = new Array<number>(BOT_NAMES.length).fill(0);
    for (let h = 0; h < 40; h++) {
      for (const id of botIds(host(h))) {
        const name = botName(id);
        expect([botName(id), botName(id, []), botName(id, ['Ada'])], id).toEqual([name, name, name]);
        seen[BOT_NAMES.indexOf(name)]!++;
      }
    }
    // 320 bots over 32 names: every name drawn, none hugely favoured.
    expect(seen.filter((n) => n === 0), 'names no bot took first').toEqual([]);
    expect(Math.max(...seen)).toBeLessThan(30);
  });

  it('walks from a taken first choice to the next name free, round the end of the list', () => {
    expect(first, "a first choice past the list's first, so a walk can go round its end").toBeGreaterThan(0);
    expect(botName(walker, [from(0)])).toBe(from(1));
    expect(botName(walker, [from(1), from(0)]), 'in any order').toBe(from(2));
    expect(botName(walker, [from(1)]), 'a name after the first choice taken: still the first choice').toBe(from(0));
    // Every name from the first choice to the list's end taken: the list's first.
    expect(botName(walker, BOT_NAMES.slice(first))).toBe(BOT_NAMES[0]);
    expect(botName(walker, BOT_NAMES.filter((n) => n !== from(5)))).toBe(from(5));
  });

  it("counts a person's name as taken, compared as the state holds names, by code unit once cleaned", () => {
    // A person who named themselves after the bot's first choice.
    expect(botName(walker, ['Ada', from(0), 'Bea'])).toBe(from(1));
    // Not that name to the state: another case, a space, or a name cleanName drops to ''.
    for (const near of [from(0).toLowerCase(), from(0).toUpperCase(), ` ${from(0)}`, `${from(0)} `]) expect(botName(walker, [near]), near).toBe(from(0));
    const refused = `${from(0)}\u0007`;
    expect(cleanName(refused, defaultParams)).toBe('');
    expect([botName(walker, [refused]), botName(walker, [cleanName(refused, defaultParams)])]).toEqual([from(0), from(0)]);
  });

  it('gives "Bot" and four upper-case hex digits of the ID only once every name is taken, which cleanName keeps', () => {
    for (const id of botIds(host(5))) {
      const name = botName(id, BOT_NAMES);
      expect(name).toBe(`Bot ${id.slice(0, 4).toUpperCase()}`);
      expect(cleanName(name, defaultParams)).toBe(name);
      expect(botName(id, BOT_NAMES.slice(1)), 'one name left').toBe(BOT_NAMES[0]);
    }
  });

  it('names bots joining in turn apart, each with the names before it taken', () => {
    for (let h = 0; h < 40; h++) {
      const ids = botIds(host(h));
      const names = botNames(ids);
      expect(new Set(names).size, `host ${h}: ${names.join(', ')}`).toBe(ids.length);
      names.forEach((name, k) => expect(name).toBe(botName(ids[k]!, names.slice(0, k))));
      const taken = ['Ada', names[0]!];
      expect(botNames(ids, taken)).toEqual(ids.map((_, k) => botName(ids[k]!, [...taken, ...botNames(ids.slice(0, k), taken)])));
      expect(botNames(ids, taken)).not.toContain(names[0]);
    }
  });
});
