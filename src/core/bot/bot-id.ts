// Bot IDs, names, coats and seeds (PLAN D-39, Q-9, §14; design §1.17, §8.3).
// roslambo's src/core/bot/bot.ts, its botId, botIds and isBot, with
// terriest's product string and slot count; the coat and the brain's seed
// are new, and so, from the owner's request of 2026-11-22, is the name: a
// robot dog's from BOT_NAMES that no other terrier in the match has, as far
// as its host can see, where roslambo's botName gave "Bot" and four hex
// digits of the ID, now the fallback. A bot's ID is derived from its host's
// and its slot, so a host finds its bots again after a reload, and a
// receiver checks that a bot's inputs come from its host (M3). It's a UUID
// of version 8, RFC 9562's custom version, where a person's own ID is
// version 4 (D-25), so every peer tells a bot from a person by its ID
// alone. A bot's name rides in its JOIN, so every peer takes it from the
// event and the state, and none works it out again. A person's ID for a
// seed, the marks' and the #test=net page's, is here too, moved from
// marks.ts so the page imports neither the marks nor their size (M3's
// design §1.12). Exact operations only (D-39).

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

/** The robot dogs' names (the owner, 2026-11-22), in the order botName walks them. Each is kept unchanged
 *  by cleanName and fitName (C-17) and fits the wire's name limit, and none is a famous robot dog's name
 *  or a trademark: so no Sparky, Bolt, Servo, Chip or Axle, which Five Nights at Freddy's, Disney's Bolt,
 *  Rescue Bots, WowWee's CHiP and the film A.X.L. hold, and Subwoofer, Wirehair, Sensor, Circuit and
 *  Coil stand in their places. Content, not a setting: a JOIN carries the name its host picked. */
export const BOT_NAMES: readonly string[] = [
  'Subwoofer', 'Wirehair', 'Gizmo', 'Widget', 'Sensor', 'Sprocket', 'Gadget', 'Rusty',
  'Circuit', 'Byte', 'Pixel', 'Turbo', 'Rivet', 'Piston', 'Dynamo', 'Coil',
  'Cog', 'Tinker', 'Volt', 'Diode', 'Flux', 'Blip', 'Nano', 'Spanner',
  'Socket', 'Rotor', 'Rover', 'Fuse', 'Terrabyte', 'Bit Bull', 'Mecha-Mutt', 'Data Hound',
];

/** A bot's display name (the owner, 2026-11-22): a pure function of its ID and the names already `taken`
 *  in its match, which its host passes, a person's among them. Its first choice is BOT_NAMES' entry at a
 *  hash of the ID, seeded apart from its coat's; if that's taken, the first after it round the list that
 *  isn't. Only with every list name taken, which a match of at most 2 × packSizeMax terriers never comes
 *  near, is it roslambo's "Bot" and four upper-case hex digits of the ID, which cleanName keeps too.
 *  Names compare as the state holds them, by code unit once cleanName has kept them: it keeps each list
 *  name as it is, so a taken name blocks one only if it's that name exactly. */
export function botName(id: string, taken: readonly string[] = []): string {
  const n = BOT_NAMES.length;
  const first = mix(botSeed(id), 2) % n;
  for (let k = 0; k < n; k++) {
    const name = BOT_NAMES[(first + k) % n]!;
    if (!taken.includes(name)) return name;
  }
  return `Bot ${id.slice(0, 4).toUpperCase()}`;
}

/** The names of bots that join in the order of `ids`, as a host names those it adds in one go: each its
 *  botName with every name before it taken, `taken`'s first. For the marks, the tests and the dev tools,
 *  which write a state's names or its JOINs themselves. */
export function botNames(ids: readonly string[], taken: readonly string[] = []): string[] {
  const names = [...taken];
  for (const id of ids) names.push(botName(id, names));
  return names.slice(taken.length);
}

const hex8 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

/** A person's ID for a seed: 32 hex digits, version 4, as a browser's (D-25). */
export function personId(seed: number, k: number): string {
  const h = mix(seed, k);
  const id = hex8(mix(h, 11)) + hex8(mix(h, 12)) + hex8(mix(h, 13)) + hex8(mix(h, 14));
  return `${id.slice(0, 12)}4${id.slice(13)}`;
}
