// D-15's tick clock (PLAN D-15, D-22, D-31; M3's design,
// research/m3/DESIGN.md, §1.6, §2.13, §4.12).
// roslambo's clock, setRate, the offset samples in onTick and rebalance
// (src/core/timeline/timeline.ts), with its M0 corrections (a proportional
// rate with a deadband and a limit, a jump past the late window's middle,
// the true median, an offset counted once its peer is heard for a while)
// and its 2026-10-25 fix (a phase at its cap is no sample). Changed:
// - every gain, limit and period comes from configuration (§10), where
//   roslambo's were literals: 0.1, 0.005, 0.02, 1 and 1,000 ms;
// - samples come from direct TICKs only (§4.10): the caller passes no other;
// - a sample further off than the stores' rings reach is none, so one forged
//   TICK can't jump the clock past the wire's u32 (§2.12);
// - pause, resume and set are new, for D-22's Practice and §4.12's re-anchor;
// - with one peer's offset counted, a jump moves half the median, to the
//   midpoint of the two clocks: two pages alone with each other that jump
//   at one rebalance meet rather than cross, and one that jumps alone
//   closes half the gap, the rate the rest. D-15's full jump would swap
//   them each rebalanceMs after a freeze (M3 phase 5);
// - a TICK handled across a freeze of this page's timers is no sample: it
//   was held for the page, as old as the freeze, whether the page took it
//   before its late timer run or after. A freeze is a gap between runs of
//   more than an input's time in flight, d + w ticks, that follows a gap
//   within it. How many samples that drops depends on the engine's timer
//   cadence, which M4 measures again with real frames (M3 phase 5's review).
// Pure: it's handed the time (`now`, in ms, monotonic) and reads no clock.

export interface ClockConfig {
  readonly tickMs: number;
  readonly delay: number;
  readonly window: number;
  readonly settleMs: number; // a peer's offset counts once heard this long
  readonly smoothing: number; // each sample's weight in a peer's offset
  readonly gainPerTick: number; // the rate's change for each tick of the median offset
  readonly rateMax: number; // its limit either way
  readonly deadbandTicks: number; // no change within this offset
  readonly rebalanceMs: number; // how often the median is taken
  /** A sample further off is no sample: the ticks the stores' rings hold past their window, so a
   *  clock that far from the final tick still fits them (netSettings', 742 at A.4's values; §2.12). */
  readonly sampleMaxTicks: number;
}

/** A TICK's phase at or above this was clamped: its sender was catching up after its timers
 *  slept, so it was sent late for its tick and says nothing of the clock (roslambo 2026-10-25).
 *  roslambo's PHASE_CAP: a sender clamps the phase below 1, and TICK's u16 carries at most
 *  65535/65536 (design §5.3). */
export const PHASE_CAP = 0.9999; // not a setting: the wire's clamp

export class TickClock {
  /** lastJump: the last jump's size in ticks, half its median's with one peer counted. */
  readonly stats = { jumps: 0, rateAdj: 0, medianOffset: 0, lastJump: 0 };
  private readonly cfg: ClockConfig;
  private readonly baseRate: number; // ticks a ms
  private rate: number;
  // The reading is b0 at t0, moving at rate; frozen holds it while paused.
  private t0 = 0;
  private b0 = 0;
  private frozen: number | null = null;
  private lastRebalance = -Infinity;
  private readonly offsets = new Map<string, number>(); // peer → its clock less mine, in ticks, smoothed
  private readonly firstHeard = new Map<string, number>();
  /** An input's time in flight, from its TICK to its tick's late boundary, d + w ticks: a longer gap
   *  between this page's timer runs, after a shorter one, is a freeze. */
  private readonly freezeMs: number;
  // This page's timer runs, as ran() reports them: the last one's time, the gap before it, and
  // whether it ended a freeze, with no run since. None before the first.
  private lastRun = -Infinity;
  private lastGap = 0;
  private thawed = false;

  constructor(cfg: ClockConfig) {
    this.cfg = cfg;
    this.baseRate = 1 / cfg.tickMs;
    this.rate = this.baseRate;
    this.freezeMs = (cfg.delay + cfg.window) * cfg.tickMs;
  }

  get paused(): boolean {
    return this.frozen !== null;
  }

  /** Fractional ticks at now; frozen while paused. */
  read(now: number): number {
    return this.frozen ?? this.b0 + (now - this.t0) * this.rate;
  }

  /** The clock reads `at` ticks at now, at the base rate. A paused clock reads `at` until resumed.
   *  The peers' offsets stay: after a stall every page shared, each re-anchors alike (§4.12). */
  set(now: number, at: number): void {
    this.rate = this.baseRate;
    this.stats.rateAdj = 0;
    if (this.frozen !== null) this.frozen = at;
    else this.anchor(now, at);
  }

  /** Freezes the reading: Practice's pause (D-22), and §4.12's deciding. */
  pause(now: number): void {
    if (this.frozen === null) this.frozen = this.read(now);
  }

  /** Goes on from where it stopped, at the rate it had, so nothing is caught up across a pause (D-22). */
  resume(now: number): void {
    if (this.frozen === null) return;
    const at = this.frozen;
    this.frozen = null;
    this.anchor(now, at);
  }

  /** This page's timer ran at now: called on every advance, paused or not. A gap since the last run
   *  over d + w ticks, where the one before was within it, ended a freeze (M3 phase 5). */
  ran(now: number): void {
    const gap = this.lastRun === -Infinity ? 0 : now - this.lastRun;
    this.thawed = gap > this.freezeMs && this.lastGap <= this.freezeMs;
    this.lastGap = gap;
    this.lastRun = now;
  }

  /** A TICK handled now was held for this page through a freeze of its timers, as old as the freeze:
   *  handled once the timer, on time before, is d + w ticks overdue, as a page that takes its messages
   *  first takes them, or within d + w ticks after the freeze's late run, before any other, as one
   *  whose timer runs first does (M3 phase 5). */
  private held(now: number): boolean {
    if (this.lastRun === -Infinity) return false;
    const since = now - this.lastRun;
    return this.thawed ? since <= this.freezeMs : this.lastGap <= this.freezeMs && since > this.freezeMs;
  }

  /** held(now), for what else a freeze holds: a pong handled now measured the freeze (M3 phase 5a,
   *  clock-F1). */
  holding(now: number): boolean {
    return this.held(now);
  }

  /** A direct TICK's clock sample: the sender's t − d + phase, plus the one-way delay, against mine. A
   *  phase at its cap was sent catching up after a stall, and is no sample (roslambo, 2026-10-25); nor
   *  is one taken while paused, against a reading that doesn't move, nor one held for this page through
   *  a freeze of its timers (ran), nor one further off than sampleMaxTicks, which no honest clock is.
   *  True if it counted. */
  sample(peer: string, t: number, phase: number, oneWayMs: number, now: number): boolean {
    if (this.frozen !== null || !(phase < PHASE_CAP) || this.held(now)) return false;
    const off = t - this.cfg.delay + phase + oneWayMs * this.baseRate - this.read(now);
    if (!Number.isFinite(off) || !(Math.abs(off) <= this.cfg.sampleMaxTicks)) return false;
    this.heard(peer, now);
    const prev = this.offsets.get(peer);
    this.offsets.set(peer, prev === undefined ? off : prev + this.cfg.smoothing * (off - prev));
    return true;
  }

  /** A TICK from peer, direct or forwarded: its offset counts once heard for settleMs (roslambo M0). */
  heard(peer: string, now: number): void {
    if (!this.firstHeard.has(peer)) this.firstHeard.set(peer, now);
  }

  /** A peer that left: its offset and its settling go (§4.4). */
  forget(peer: string): void {
    this.offsets.delete(peer);
    this.firstHeard.delete(peer);
  }

  /** Called every advance; every rebalanceMs, the median offset of peers heard for settleMs: past the
   *  late window's middle a jump, by the median, or by half of it with one peer counted, else a
   *  proportional rate with a deadband ('rate', its 0 included). Nothing while paused. */
  rebalance(now: number): 'jump' | 'rate' | null {
    if (this.frozen !== null || now - this.lastRebalance < this.cfg.rebalanceMs) return null;
    this.lastRebalance = now;
    const offs: number[] = [];
    for (const [peer, off] of this.offsets) {
      const first = this.firstHeard.get(peer);
      if (first !== undefined && now - first >= this.cfg.settleMs) offs.push(off);
    }
    if (offs.length === 0) return null;
    offs.sort((a, b) => a - b);
    const mid = offs.length >> 1;
    const med = offs.length % 2 === 1 ? offs[mid]! : (offs[mid - 1]! + offs[mid]!) / 2;
    this.stats.medianOffset = med;
    const middle = this.cfg.window / 2; // not a setting: D-15's rule, the late window's middle
    if (Math.abs(med) > middle) {
      // A jump forward, or back, which holds the ticks until the clock catches up (roslambo M0).
      // A lone peer's page may jump at this rebalance too: each goes halfway, so they meet.
      const jump = offs.length === 1 ? med / 2 : med; // not a setting: the midpoint of two clocks
      const at = this.read(now) + jump;
      for (const [peer, off] of this.offsets) this.offsets.set(peer, off - jump);
      this.stats.lastJump = jump;
      this.stats.jumps++;
      this.stats.rateAdj = 0;
      this.rate = this.baseRate;
      this.anchor(now, at);
      return 'jump';
    }
    const { deadbandTicks, gainPerTick, rateMax } = this.cfg;
    const adj = Math.abs(med) <= deadbandTicks ? 0 : Math.max(-rateMax, Math.min(rateMax, med * gainPerTick));
    const at = this.read(now);
    this.stats.rateAdj = adj;
    this.rate = this.baseRate * (1 + adj);
    this.anchor(now, at);
    return 'rate';
  }

  private anchor(now: number, at: number): void {
    this.t0 = now;
    this.b0 = at;
  }
}
