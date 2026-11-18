// Votes by tick and voter, and D-13's tally (PLAN D-13, C-10, C-16; M3's
// design, research/m3/DESIGN.md, §1.5, §2.12, §3.1, §3.2, §3.4).
// roslambo's votes, vote, tally and beginResync's candidate list
// (src/core/timeline/timeline.ts), changed: a ring by tick that never evicts
// a needed tick, so a vote for a far tick can't stay for the match, where
// roslambo's map kept any voteTick until its tally passed it (§2.12).
// Nothing here follows arrival order: a voter has one vote a tick, the
// winner is the most votes and then the smallest hash, and candidates sort
// by ID (§0).

export interface TallyResult {
  readonly win: string;
  /** The winner is my hash. */
  readonly agree: boolean;
  /** The counted votes name more than one hash. */
  readonly split: boolean;
}

const EMPTY = -1; // not a setting: a slot that holds no tick, and no tick retired

interface Slot {
  tick: number;
  readonly votes: Map<string, string>; // voter → hash
}

/** A tick, as the wire's u32 and the timeline's counters hold one. */
const isTick = (t: number): boolean => Number.isSafeInteger(t) && t >= 0;

/** By UTF-16 code units: `<`, never localeCompare (D-38). */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class VoteBook {
  private readonly size: number;
  private readonly slots: Slot[];
  /** Ticks at or before it are no longer needed (§2.12). */
  private retired = EMPTY;

  /** size: the ticks it can hold, netSettings' inputSpan; the timeline checks each vote's window (§3.1). */
  constructor(size: number) {
    if (!Number.isSafeInteger(size) || size < 1) throw new RangeError(`a vote book holds a whole number of ticks, not ${size}`);
    this.size = size;
    this.slots = Array.from({ length: size }, (): Slot => ({ tick: EMPTY, votes: new Map() }));
  }

  /** Records or replaces voter's vote at t; false if t's slot still holds a needed tick (§2.12),
   *  or t is retired. */
  add(t: number, voter: string, hash: string): boolean {
    const s = this.claim(t);
    if (s === undefined) return false;
    s.votes.set(voter, hash);
    return true;
  }

  /** Ticks at or before t are no longer needed: their votes go, and their slots may be reused.
   *  Never moves back. */
  retire(t: number): void {
    if (t > this.retired) this.retired = t;
  }

  /** D-13: one vote per voter that controls a terrier in roster (counts(voter)), the most votes
   *  winning, the smallest hash on a tie; null with no counted vote or no hash of mine. Hashes
   *  compare with `<`, which orders A.1's 16 lower-case hex digits as the numbers they spell. */
  tally(t: number, mine: string, counts: (voter: string) => boolean): TallyResult | null {
    const s = this.slotOf(t);
    if (s === undefined || mine === '') return null;
    const byHash = new Map<string, number>();
    for (const [voter, hash] of s.votes) if (counts(voter)) byHash.set(hash, (byHash.get(hash) ?? 0) + 1);
    let win = '';
    let most = 0;
    for (const [hash, n] of byHash) {
      if (n > most || (n === most && hash < win)) {
        win = hash;
        most = n;
      }
    }
    return most === 0 ? null : { win, agree: win === mine, split: byHash.size > 1 };
  }

  /** The voters for hash at t other than me, sorted by ID: a resync's candidates (§3.4). */
  voters(t: number, hash: string, me: string): string[] {
    const s = this.slotOf(t);
    if (s === undefined) return [];
    const out: string[] = [];
    for (const [voter, h] of s.votes) if (h === hash && voter !== me) out.push(voter);
    return out.sort(byId);
  }

  /** t's slot, if it holds t and t is still needed. */
  private slotOf(t: number): Slot | undefined {
    if (!isTick(t) || t <= this.retired) return undefined;
    const s = this.slots[t % this.size]!;
    return s.tick === t ? s : undefined;
  }

  /** t's slot for a vote: its own, or a free one, which holds no tick or a retired one; none
   *  where it holds another needed tick, which it never evicts (§2.12). */
  private claim(t: number): Slot | undefined {
    if (!isTick(t) || t <= this.retired) return undefined;
    const s = this.slots[t % this.size]!;
    if (s.tick === t) return s;
    if (s.tick > this.retired) return undefined;
    s.tick = t;
    s.votes.clear();
    return s;
  }
}
