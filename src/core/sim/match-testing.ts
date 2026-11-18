// Helpers for the rules' tests (design §6, §7.7): matches driven through
// their events from genesis, TickInputs with events, a seeded shuffle for
// P4, seeded noise for the property tests, and terriers stacked so the
// lower one slips. Test support: not shipped, but linted and scanned as
// simulation code, so exact operations only (D-1).

import { JOIN, LEAVE, READY, SWITCH, type TickInput, UNREADY } from './input';
import { mix } from './math';
import type { SimParams } from './params';
import { place, rankedIds } from './scenes';
import { genesis, type MatchState } from './state';
import { makeSim, type Sim, step } from './step';

/** A match, its Sim and its parameters. */
export interface Match {
  readonly P: SimParams;
  readonly sim: Sim;
  readonly s: MatchState;
}

/** A genesis match (D-8): warm-up, nobody in it, a real clock. */
export function newMatch(P: SimParams, packSize: number, matchMinutes = 1): Match {
  return { P, sim: makeSim(P, packSize), s: genesis({ packSize, matchMinutes }, P) };
}

/** JOIN's and SWITCH's payloads (D-12). */
export interface Payload {
  readonly joinPack?: number;
  readonly coat?: number;
  readonly name?: string;
  readonly switchPack?: number;
}

/** One ID's TickInput: its u16, its events and their payloads. */
export function say(id: string, events = 0, input = 0, payload: Payload = {}): TickInput {
  return { id, input, events, ...payload };
}

/** A JOIN of a pack, with any other events and payload. */
export function join(id: string, pack: number, more = 0, payload: Payload = {}): TickInput {
  return say(id, JOIN | more, 0, { joinPack: pack, ...payload });
}

/** Every member's input, by list index, or none for a null; nothing held by
 *  default. */
export function everyone(s: Readonly<MatchState>, input: (k: number) => number | null = () => 0): TickInput[] {
  const out: TickInput[] = [];
  for (let k = 0; k < s.terriers.length; k++) {
    const v = input(k);
    if (v !== null) out.push(say(s.terriers[k]!.id, 0, v));
  }
  return out;
}

/** Steps a match a tick, the inputs handed over reversed (P4). */
export function tick(m: Match, inputs: readonly TickInput[]): void {
  const reversed: TickInput[] = [];
  for (let k = inputs.length - 1; k >= 0; k--) reversed.push(inputs[k]!);
  step(m.sim, m.s, reversed);
}

/** Steps a match n ticks, each tick's inputs from fn. */
export function ticks(m: Match, n: number, fn: (t: number) => readonly TickInput[] = (): TickInput[] => everyone(m.s)): void {
  for (let i = 0; i < n; i++) tick(m, fn(m.s.tick + 1));
}

/** A genesis match whose packs fill at tick 1, every member sending
 *  JOIN | READY with rankedIds' IDs: after that tick it's in the start
 *  countdown, placed by ID rank (D-8, D-12). */
export function startedMatch(P: SimParams, packSize: number, matchMinutes = 1, seed = 0): Match {
  const m = newMatch(P, packSize, matchMinutes);
  const ids = rankedIds(seed, packSize);
  const inputs: TickInput[] = [];
  for (let pack = 0; pack < 2; pack++) {
    for (const id of ids[pack]!) inputs.push(join(id, pack, READY, { coat: inputs.length }));
  }
  tick(m, inputs);
  return m;
}

/** A permutation of list for a seed: Fisher–Yates on mix. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  for (let k = out.length - 1; k > 0; k--) {
    const j = mix(seed, k) % (k + 1);
    const x = out[k]!;
    out[k] = out[j]!;
    out[j] = x;
  }
  return out;
}

/** Terrier upper (a list index) standing on lower's back, a little off its
 *  centre so that it slides off: the lower terrier slips from the upper's
 *  slot in the next substep (D-5 step 7). */
export function stack(P: SimParams, s: MatchState, lower: number, upper: number): void {
  const L = s.terriers[lower]!;
  const r = P.terrierRadius;
  // 2 cm off centre, and 2r above the lower's centre less 1 mm: inside the
  // slip-out cone, and touching.
  place(P, s, upper, L.x + 0.02, L.y, r + r + r - 0.001); // not a setting: a scene's offsets
}

// --- Seeded noise for the property tests (design §7.7) ---

/** One noisy tick input, from a hash and the u16 held this spell: each
 *  event bit now and then, with packs and coats of any byte, most of the
 *  packs 0 or 1 so that the events land. */
function noisy(id: string, h: number, input: number, names: readonly string[]): TickInput {
  const e = mix(h, 1);
  const p = mix(h, 2);
  let events = 0;
  if ((e & 15) === 0) events |= JOIN;
  if (((e >>> 4) & 127) === 0) events |= LEAVE;
  if (((e >>> 11) & 31) === 0) events |= SWITCH;
  if (((e >>> 16) & 63) === 0) events |= READY;
  if (((e >>> 22) & 63) === 0) events |= UNREADY;
  // Now and then, event bits 5 to 15, which no event uses.
  if (((e >>> 26) & 63) === 0) events |= p & 0xffe0;
  const pack = (bits: number): number => ((bits & 3) !== 0 ? (bits >>> 2) & 1 : (bits >>> 3) & 255);
  return {
    id,
    input,
    events,
    joinPack: pack(p),
    coat: (p >>> 11) & ((p & 1024) !== 0 ? 7 : 255),
    name: names[mix(h, 4) % names.length]!,
    switchPack: pack(p >>> 19),
  };
}

/** Tick t's inputs for some IDs, from a seed, in the IDs' order: each ID
 *  present in most ticks, and silent for whole spells now and then, long
 *  enough to sit or to be removed. Its u16 is held through spells of 16
 *  ticks, so terriers run, meet and press, and is any value in one tick of
 *  8. Now and then a second, different copy of an ID's input, and an ID
 *  that isn't one. The P4 tests shuffle and duplicate the list; step
 *  canonicalises it either way. */
export function noisyInputs(seed: number, ids: readonly string[], names: readonly string[], t: number): TickInput[] {
  const out: TickInput[] = [];
  for (let k = 0; k < ids.length; k++) {
    const silence = mix(mix(seed, k), Math.floor(t / 200)); // not a setting: a silent spell's ticks
    if ((silence & 7) === 0) continue; // silent for the spell
    const h = mix(mix(seed, k + 64), t);
    if ((h & 15) === 0) continue; // absent this tick
    const held = mix(mix(seed, k + 128), Math.floor((t + 5 * k) / 16)) & 0xffff;
    const input = ((h >>> 8) & 7) === 0 ? mix(h, 3) & 0xffff : held;
    out.push(noisy(ids[k]!, h, input, names));
    if (((h >>> 4) & 31) === 0) out.push(noisy(ids[k]!, mix(h, 5), mix(h, 6) & 0xffff, names)); // a second copy
  }
  if ((mix(seed, t) & 63) === 0) out.push(say('not an ID', JOIN, 0, { joinPack: 0 }));
  return out;
}
