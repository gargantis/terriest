// The roster's questions a room asks (PLAN D-17, D-21, C-11, P7; M3's
// design, research/m3/DESIGN.md, §1.10, §4.3, §4.5): who is in it, how
// many places are free, whether a HELLO from outside it is admitted, when a
// watcher is one spectator too many, and which of two timelines a room
// keeps. roslambo's beats (src/core/session/session.ts), without saves: a
// live timeline beats none, then the later final tick, then the smaller
// hash, then the smaller ID (roslambo D-12, Q-7). Pure.

import { TIMELINE_KIND, type Hello } from '../protocol/messages';
import type { MatchState } from '../sim/index';

/** Whether player, or a bot derived from it, is in the roster (D-17, D-21). */
export function inRoster(player: string, roster: ReadonlySet<string>, botIdsOf: (host: string) => readonly string[]): boolean {
  if (roster.has(player)) return true;
  for (const b of botIdsOf(player)) if (roster.has(b)) return true;
  return false;
}

/** 2 × pack size − terriers: the places both packs have left. */
export function freePlaces(s: Readonly<MatchState>): number {
  return 2 * s.packSize - s.terriers.length;
}

/** D-21: admit a HELLO from outside the roster? Only a peer that holds the state counts; it admits
 *  while the connected browsers outside the roster, those it has admitted whose handshakes are still
 *  under way, and itself if it's outside, number fewer than the spectator cap plus the free places.
 *  The newcomer itself is never counted, so a fifth spectator is refused with four connected
 *  (M3-Q16). */
export function admits(o: {
  readonly holdsState: boolean; readonly outsideConnected: number; readonly reserved: number;
  readonly selfOutside: boolean; readonly freePlaces: number; readonly spectatorsMax: number;
}): boolean {
  if (!o.holdsState) return true;
  const outside = o.outsideConnected + o.reserved + (o.selfOutside ? 1 : 0);
  return outside < o.spectatorsMax + o.freePlaces;
}

/** D-21: on Watch, or a refusal as a player: the announced spectators and itself over the cap? */
export function spectatorsOverCap(announcedSpectators: number, spectatorsMax: number): boolean {
  return announcedSpectators > spectatorsMax;
}

/** roslambo D-12 and Q-7, without saves: whether a room keeps a's timeline over b's. A live timeline
 *  beats none; then the later final tick, the older timeline; then the smaller hash, then the
 *  smaller ID, each compared with `<`. None beats nothing. */
export function beats(a: Hello, b: Hello): boolean {
  if (a.timelineKind === TIMELINE_KIND.NONE) return false;
  if (b.timelineKind === TIMELINE_KIND.NONE) return true;
  if (a.finalTick !== b.finalTick) return a.finalTick > b.finalTick;
  if (a.hash !== b.hash) return a.hash < b.hash;
  return a.timeline < b.timeline;
}
