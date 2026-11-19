// The roster's questions a room asks (PLAN D-17, D-21, C-11, P7; M3's
// design, research/m3/DESIGN.md, §1.10, §4.3, §4.5): who is in it, how
// many places are free, whether a HELLO from outside it is admitted, when a
// watcher is one spectator too many, and which of two timelines a room
// keeps: two live timelines ranked as old as each is at one moment, as M3
// builds Q-7 (P7's peer side, M3 phase 4a), and a Play-again timeline's ID,
// which makes that rank exact for one old match's presses (§4.9). Pure.

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

/** P7's rule, Q-7 as M3 builds it: whether a room keeps timeline a over timeline b, each as old as it
 *  is at one moment, in ticks. The older wins, but two whose ages differ by at most `tie` are a tie
 *  that the smaller ID wins, so pages whose estimates of the ages differ a little rank them alike
 *  (M3 phase 4a). */
export function outranks(a: string, ageA: number, b: string, ageB: number, tie: number): boolean {
  return Math.abs(ageA - ageB) > tie ? ageA > ageB : a < b;
}

/** A Play-again timeline's ID (§4.9, M3 phase 4): the old timeline's tick at the press, as a
 *  big-endian u32, then the first 4 bytes of `random`, in the 16 lowercase hex characters every
 *  timeline ID takes. Of two presses in one old match the earlier has the smaller ID, so outranks'
 *  tie agrees with their age order however far apart they are, and every page ranks them alike. The
 *  tick is floored and held to the u32's range; the ID is never all zero, which means none. */
export function againTimelineId(pressTick: number, random: Uint8Array): string {
  if (random.length < 4) throw new RangeError('againTimelineId takes 4 random bytes');
  const t = Number.isFinite(pressTick) ? Math.min(Math.max(Math.floor(pressTick), 0), 0xffffffff) : 0;
  const bytes = [t >>> 24, (t >>> 16) & 0xff, (t >>> 8) & 0xff, t & 0xff, random[0]!, random[1]!, random[2]!, random[3]!];
  if (!bytes.some((b) => b !== 0)) bytes[7] = 1;
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
