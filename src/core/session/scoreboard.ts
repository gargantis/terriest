// D-14's latch (PLAN D-14, Q-7, C-4, C-50, P9; M3's design,
// research/m3/DESIGN.md, §1.15, §3.3, §3.5): goals and the end shown only
// from confirmed ticks, each goal once, keyed by its tick and taken from the
// final state, and a goal withdrawn only when a completed repair's final
// state no longer has it. What M4's score, celebration, whistle and Results
// read. New at M3: roslambo latched only its round's end, in its game glue.
// Pure: the glue hands it the timeline the session holds after each
// advance (design §1.24).

import { isBot } from '../bot/bot-id';
import { CELEBRATION, defaultParams, ENDED, type MatchState, NEVER, type Pack, type SimParams, terriest, winner } from '../sim';

export interface ConfirmedGoal {
  readonly tick: number;
  readonly pack: Pack; // the pack it counts for
  readonly ownGoal: boolean;
  readonly scorers: readonly string[]; // terrier IDs, from the final state's scorers bits
  readonly score: readonly [number, number]; // after it
}

export interface ResultRow {
  readonly id: string;
  readonly name: string;
  readonly pack: Pack;
  readonly coat: number;
  readonly goals: number;
  readonly touches: number;
  readonly terriest: boolean;
  readonly bot: boolean;
}

export interface ConfirmedEnd {
  readonly tick: number;
  readonly score: readonly [number, number];
  readonly winner: Pack | null;
  readonly rows: readonly ResultRow[]; // in (spot, pack) order
}

/** What the scoreboard reads of a timeline; timeline.ts's Timeline satisfies it. started and id are
 *  the design's shape plus two members Timeline has: before it starts, final is a placeholder, not an
 *  arrival; and a timeline of another ID is another match, a merge's, whose goals aren't this one's. */
export interface ScoreTimeline {
  readonly started: boolean;
  readonly id: string;
  readonly final: Readonly<MatchState>;
  readonly finalTick: number;
  readonly repairing: boolean;
  isConfirmed(t: number): boolean;
}

/** One update's changes: the goals latched, and the goals withdrawn (C-4). */
export interface ScoreChanges {
  readonly added: readonly ConfirmedGoal[];
  readonly withdrawn: readonly ConfirmedGoal[];
}

const NOTHING: ScoreChanges = Object.freeze({ added: Object.freeze([]), withdrawn: Object.freeze([]) });

/** The IDs the scorers bits name: bit k is F.terriers[k] (A.1). */
function scorersOf(F: Readonly<MatchState>): string[] {
  const out: string[] = [];
  F.terriers.forEach((T, k) => {
    if ((F.scorers & (1 << k)) !== 0) out.push(T.id);
  });
  return out;
}

/** Each terrier's goals (A.1), by ID. */
const goalCounts = (F: Readonly<MatchState>): ReadonlyMap<string, number> => new Map(F.terriers.map((T) => [T.id, T.goals]));

/** F celebrates goal L: A.1 keeps its scorers until the kickoff placement. */
const celebrates = (F: Readonly<MatchState>, L: number): boolean => F.phase === CELEBRATION && F.phaseStart === L;

export class Scoreboard {
  /** In tick order, each once. */
  readonly goals: ConfirmedGoal[] = [];
  end: ConfirmedEnd | null = null;
  /** Goals are at least a celebration and a kickoff countdown apart: 384 ticks at A.4's values,
   *  more than a repair reaches back, the 256-tick history and its spread (§3.5). */
  private readonly spacing: number;
  /** The timeline last arrived on: a merge or a rejoin hands the glue another (design §1.14). */
  private seen: ScoreTimeline | null = null;
  private arrivedAt = 0;
  /** The goal whose celebration was under way at the arrival, latched once confirmed, and its scorers
   *  as the adopted state named them (§3.5). */
  private celebrating = NEVER;
  private celebratingScorers: readonly string[] = [];
  private scoreNow: readonly [number, number] = [0, 0];
  /** Each terrier's goals as of the last latch, or the arrival if later: a goal confirmed after the
   *  kickoff placement cleared its scorers bits is credited to the terriers whose count has risen
   *  since (reviewer SB-1). Beside each latched goal, the counts before it, for its withdrawal. */
  private counts: ReadonlyMap<string, number> = new Map();
  private readonly countsBefore: ReadonlyMap<string, number>[] = [];

  constructor(P: SimParams = defaultParams) {
    this.spacing = P.celebrationTicks + P.kickoffCountdownTicks;
  }

  /** The score as last confirmed: from the adopted state for a browser that arrived mid-match. */
  get score(): readonly [number, number] {
    return this.scoreNow;
  }

  /** After each advance, with the timeline the session holds. Nothing is latched or withdrawn while it
   *  repairs, since isConfirmed is false throughout (D-14); a goal is withdrawn only when a completed
   *  repair's final state no longer has it (C-4), and every goal shown goes when the timeline held is
   *  another match's, a merge's. */
  update(t: ScoreTimeline): ScoreChanges {
    if (!t.started) return NOTHING;
    const F = t.final;
    let withdrawn: ConfirmedGoal[] | null = t === this.seen ? null : this.arrive(t, F);
    if (t.repairing) return withdrawn === null ? NOTHING : { added: NOTHING.added, withdrawn };
    let changed = false;
    for (let last = this.goals.at(-1); last !== undefined && !this.has(F, last.tick); last = this.goals.at(-1)) {
      this.goals.pop();
      this.counts = this.countsBefore.pop()!;
      (withdrawn ??= []).push(last);
      changed = true;
    }
    // The score as F has it, less its last goal while that's still to be confirmed (reviewer SB-2).
    if (changed) this.scoreNow = this.confirmedScore(F);
    const added = this.latchGoal(t, F);
    this.latchEnd(t, F);
    if (withdrawn === null && added === null) return NOTHING;
    return { added: added ?? NOTHING.added, withdrawn: withdrawn ?? NOTHING.withdrawn };
  }

  /** A timeline held for the first time: the latch starts from its state's score, and a goal it is
   *  celebrating is latched once confirmed (§3.5). A rejoin's keeps its ID, and the goals shown stay; a
   *  merge's is another match, and they go, withdrawn, with the end (reviewer SB-2). */
  private arrive(t: ScoreTimeline, F: Readonly<MatchState>): ConfirmedGoal[] | null {
    const other = this.seen !== null && this.seen.id !== t.id;
    this.seen = t;
    this.arrivedAt = t.finalTick;
    this.celebrating = F.lastGoalTick !== NEVER && celebrates(F, F.lastGoalTick) ? F.lastGoalTick : NEVER;
    this.celebratingScorers = this.celebrating === NEVER ? [] : scorersOf(F);
    this.scoreNow = [F.score[0], F.score[1]];
    this.counts = goalCounts(F);
    if (!other) return null;
    this.end = null;
    this.countsBefore.length = 0;
    return this.goals.length === 0 ? null : this.goals.splice(0).reverse();
  }

  /** F's score, less its last goal if that's after the arrival, or was being celebrated then, and isn't
   *  latched: what's confirmed of it (A.1's scores saturate, so never below 0). */
  private confirmedScore(F: Readonly<MatchState>): [number, number] {
    const s: [number, number] = [F.score[0], F.score[1]];
    const L = F.lastGoalTick;
    const pending = L !== NEVER && (L > this.arrivedAt || L === this.celebrating) && !this.goals.some((g) => g.tick === L);
    if (pending && s[F.lastGoalPack] > 0) s[F.lastGoalPack]--;
    return s;
  }

  /** F's lineage has goal L: its last goal is L, or one at least a goal's spacing after it, which a
   *  repair from before L can't reach (§3.5). */
  private has(F: Readonly<MatchState>, L: number): boolean {
    const g = F.lastGoalTick;
    return g === L || (g !== NEVER && g >= L + this.spacing);
  }

  /** F's last goal, once its tick is confirmed, if it came after the arrival or was celebrating then.
   *  Its scorers are F's, while it celebrates the goal; once the kickoff placement has cleared them,
   *  the adopted state's for a goal it was celebrating, else the terriers whose goals have risen since
   *  the last latch or the arrival, which F, confirmed, holds as every peer does. Never from a lineage
   *  a repair replaced (reviewer SB-1). */
  private latchGoal(t: ScoreTimeline, F: Readonly<MatchState>): ConfirmedGoal[] | null {
    const L = F.lastGoalTick;
    if (L === NEVER || !(L > this.arrivedAt || L === this.celebrating)) return null;
    if (this.goals.some((g) => g.tick === L) || !t.isConfirmed(L)) return null;
    let scorers: readonly string[];
    if (F.ownGoal) scorers = [];
    else if (celebrates(F, L)) scorers = scorersOf(F);
    else if (L === this.celebrating) scorers = this.celebratingScorers;
    else scorers = F.terriers.filter((T) => T.goals > (this.counts.get(T.id) ?? 0)).map((T) => T.id);
    const goal: ConfirmedGoal = { tick: L, pack: F.lastGoalPack, ownGoal: F.ownGoal, scorers, score: [F.score[0], F.score[1]] };
    let k = this.goals.length;
    while (k > 0 && this.goals[k - 1]!.tick > L) k--;
    this.goals.splice(k, 0, goal);
    this.countsBefore.splice(k, 0, this.counts);
    this.counts = goalCounts(F);
    this.scoreNow = goal.score;
    return [goal];
  }

  /** The end, once its tick is confirmed: terminal, so a browser that arrives on Results latches it
   *  with its first agreeing tally (C-50). Never withdrawn, but with the match, by a merge's arrival. */
  private latchEnd(t: ScoreTimeline, F: Readonly<MatchState>): void {
    if (this.end !== null || F.phase !== ENDED || !t.isConfirmed(F.phaseStart)) return;
    const best = terriest(F);
    const rows = F.terriers.map((T, k): ResultRow => ({
      id: T.id, name: T.name, pack: T.pack, coat: T.coat, goals: T.goals, touches: T.touches,
      terriest: best.includes(k), bot: isBot(T.id),
    }));
    this.end = { tick: F.phaseStart, score: [F.score[0], F.score[1]], winner: winner(F), rows };
    this.scoreNow = this.end.score;
  }
}
