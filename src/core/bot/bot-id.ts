// Bot IDs, names, coats and seeds (PLAN D-39, Q-9; design §1.17, §8.3).
// roslambo's src/core/bot/bot.ts, its botId, botIds, isBot and botName, with
// terriest's product string and slot count; the coat and the brain's seed
// are new. A bot's ID is derived from its host's and its slot, so a host
// finds its bots again after a reload, and a receiver checks that a bot's
// inputs come from its host (M3). It's a UUID of version 8, RFC 9562's
// custom version, where a person's own ID is version 4 (D-25), so every peer
// tells a bot from a person by its ID alone.
// Exact operations only (D-39).

import { config } from '../../config';
import { hash64 } from '../sim/hash';
import { isPlayerId } from '../sim/input';
import { mix } from '../sim/math';

/** The most bots one browser hosts: Practice's 7 at 4 a side, and a spare. */
export const BOT_SLOTS = 2 * config.packSizeMax;

const encoder = new TextEncoder();

/** The ID of the k-th bot that `host` hosts: version 8, variant 10. */
export function botId(host: string, k: number): string {
  const hex = hash64(encoder.encode(`terriest bot ${host} ${k} a`)) + hash64(encoder.encode(`terriest bot ${host} ${k} b`));
  const variant = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 12)}8${hex.slice(13, 16)}${variant}${hex.slice(17)}`;
}

/** Every ID `host` may give a bot, in the order it hands them out. */
export function botIds(host: string): string[] {
  const ids: string[] = [];
  for (let k = 0; k < BOT_SLOTS; k++) ids.push(botId(host, k));
  return ids;
}

/** A bot's ID: a player ID whose version digit, its 13th, is 8. */
export function isBot(id: string): boolean {
  return isPlayerId(id) && id[12] === '8';
}

/** A bot's display name, from its ID: "Bot " and four upper-case hex
 *  digits, which cleanName keeps (C-17). */
export function botName(id: string): string {
  return `Bot ${id.slice(0, 4).toUpperCase()}`;
}

/** A u32 from the ID's four 8-digit words, for the brain's noise and bark
 *  times (D-39, design §8.2). */
export function botSeed(id: string): number {
  const word = (k: number): number => parseInt(id.slice(8 * k, 8 * k + 8), 16) >>> 0;
  return mix(mix(word(0), word(1)), mix(word(2), word(3)));
}

/** The coat a bot's host sends in its JOIN: an index in the coat list,
 *  seeded by the ID (D-39, §12). */
export function botCoat(id: string, coatCount: number): number {
  return mix(botSeed(id), 1) % coatCount;
}
