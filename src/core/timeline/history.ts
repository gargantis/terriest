// The last stateHistoryTicks final states (PLAN D-11, D-13; M3's design,
// research/m3/DESIGN.md, §1.4, §2.1, §3.4): for each final tick, A.1's
// bytes, their hash and the roster's IDs, which a vote, a tally, a late vote
// and a STATE reply read.
// roslambo's ringTick, ringBytes, ringHash and ringRoster
// (src/core/timeline/timeline.ts), with dropAfter, so a STATE adopted at g
// leaves nothing of the losing lineage after it (§3.4).

const EMPTY = -1; // not a setting: a slot that holds no tick
const NO_ROSTER: readonly string[] = Object.freeze([]);

/** A tick, as the wire's u32 and the timeline's counters hold one. */
const isTick = (t: number): boolean => Number.isSafeInteger(t) && t >= 0;

export class FinalHistory {
  private readonly size: number;
  private readonly ticks: Float64Array;
  private readonly states: (Uint8Array | null)[];
  private readonly hashes: string[];
  private readonly rosters: (readonly string[])[];

  /** size: the ticks held, config.stateHistoryTicks (256). */
  constructor(size: number) {
    if (!Number.isSafeInteger(size) || size < 1) throw new RangeError(`a final history holds a whole number of ticks, not ${size}`);
    this.size = size;
    this.ticks = new Float64Array(size).fill(EMPTY);
    this.states = new Array<Uint8Array | null>(size).fill(null);
    this.hashes = new Array<string>(size).fill('');
    this.rosters = new Array<readonly string[]>(size).fill(NO_ROSTER);
  }

  /** Holds t in its slot, in place of the tick size before it, as finalisation moves on. The bytes
   *  are kept as given: encodeState returns a copy of its own, which nothing writes again. */
  put(t: number, bytes: Uint8Array, hash: string, roster: readonly string[]): void {
    if (!isTick(t)) return;
    const s = t % this.size;
    this.ticks[s] = t;
    this.states[s] = bytes;
    this.hashes[s] = hash;
    this.rosters[s] = Object.freeze([...roster]);
  }

  has(t: number): boolean {
    return this.slotOf(t) !== EMPTY;
  }

  bytes(t: number): Uint8Array | null {
    const s = this.slotOf(t);
    return s === EMPTY ? null : this.states[s]!;
  }

  /** '' if not held. */
  hash(t: number): string {
    const s = this.slotOf(t);
    return s === EMPTY ? '' : this.hashes[s]!;
  }

  /** [] if not held. */
  roster(t: number): readonly string[] {
    const s = this.slotOf(t);
    return s === EMPTY ? NO_ROSTER : this.rosters[s]!;
  }

  /** Forgets every tick after t: a STATE adopted at t, whose re-finalisation writes them again (§3.4). */
  dropAfter(t: number): void {
    for (let s = 0; s < this.size; s++) if (this.ticks[s]! > t) this.empty(s);
  }

  clear(): void {
    for (let s = 0; s < this.size; s++) this.empty(s);
  }

  /** t's slot if it holds t, else EMPTY. */
  private slotOf(t: number): number {
    if (!isTick(t)) return EMPTY;
    const s = t % this.size;
    return this.ticks[s] === t ? s : EMPTY;
  }

  private empty(s: number): void {
    this.ticks[s] = EMPTY;
    this.states[s] = null;
    this.hashes[s] = '';
    this.rosters[s] = NO_ROSTER;
  }
}
