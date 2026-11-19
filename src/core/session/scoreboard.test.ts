import { describe, expect, it, vi } from 'vitest';
import { botId, personId } from '../bot/bot-id';
import { T } from '../protocol/messages';
import {
  CELEBRATION, defaultParams, encodeInput, ENDED, FRAME_PITCH, genesis, IN_PLAY, JOIN, KICKOFF_COUNTDOWN, type MatchState, NEVER,
  newTerrier, type Pack, READY, sortTerriers,
} from '../sim';
import { expectAgreement, inside, Pump, type PumpNode } from '../timeline/testing';
import type { Timeline } from '../timeline/timeline';
import { type ConfirmedGoal, Scoreboard, type ScoreTimeline } from './scoreboard';

// D-14's latch (design §1.15, §3.5; PLAN D-14, Q-7, C-4, C-50, P9's unit
// half). First its rules on a hand-built ScoreTimeline: a goal latched only
// once its tick is confirmed and nothing repairs, each once, with its
// scorers; an arrival's score and celebrating goal; a goal withdrawn only
// when a completed repair's state no longer has it; a new timeline; the end.
// Then over real timelines on testing.ts's pump, which satisfy
// ScoreTimeline: every peer latches the same goals at the same ticks, each
// once and none before its tick is confirmed, browsers arriving in and after
// a celebration included; a resync and a late-vote repair crossing a goal
// keep it; a goal a diverged browser confirmed alone is withdrawn by its
// repair (C-4); and the confirmed end, on every peer and on Results.

vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const SPACING = P.celebrationTicks + P.kickoffCountdownTicks;

/** Timeline satisfies ScoreTimeline: the typecheck fails here if it stops (design §0). */
const scored = (t: Timeline): ScoreTimeline => t;

const goalOf = (g: ConfirmedGoal): string => `${g.tick} ${g.pack} ${g.ownGoal} [${g.scorers.join(',')}] ${g.score.join('-')}`;

// --- Hand-built states ---

const IDS = [personId(9, 0), personId(9, 1), personId(9, 2), botId(personId(9, 3), 0)];

/** A 2-a-side match in play at tick, four terriers in (spot, pack) order, and these goals: each
 *  [tick, pack, scorers bits], their celebration and kickoff countdown as the state holds them. */
function matchAt(tick: number, goals: readonly (readonly [number, Pack, number])[] = []): MatchState {
  const s = genesis({ packSize: 2, matchMinutes: 1 }, P);
  IDS.forEach((id, k) => {
    const T = newTerrier(id, `T${k}`, (k % 2) as Pack, k, 1, P);
    T.spot = k >> 1;
    s.terriers.push(T);
  });
  sortTerriers(s);
  s.tick = tick;
  s.phase = IN_PLAY;
  s.phaseStart = 302;
  for (const [L, pack, bits] of goals) {
    if (L > tick) break;
    s.score[pack]++;
    s.lastGoalTick = L;
    s.lastGoalPack = pack;
    s.ownGoal = bits === 0;
    s.terriers.forEach((T, k) => {
      if ((bits & (1 << k)) !== 0) T.goals++;
    });
    // A.1: the scorers stay until the kickoff placement.
    if (tick < L + P.celebrationTicks) [s.phase, s.phaseStart, s.scorers] = [CELEBRATION, L, bits];
    else if (tick < L + SPACING) [s.phase, s.phaseStart, s.scorers] = [KICKOFF_COUNTDOWN, L + P.celebrationTicks, 0];
    else [s.phase, s.phaseStart, s.scorers] = [IN_PLAY, L + SPACING, 0];
  }
  return s;
}

/** A timeline as the scoreboard reads it, its state, repair and confirmation set by hand (§2.10). */
class ByHand implements ScoreTimeline {
  started = true;
  repairing = false;
  agreedTo = -1;
  final: MatchState;
  readonly id: string;

  /** id: its match's timeline ID; a rejoin's is the same, a merge's another (design §1.14). */
  constructor(final: MatchState, id = 'a1a1a1a1a1a1a1a1') {
    this.final = final;
    this.id = id;
  }

  get finalTick(): number {
    return this.final.tick;
  }

  isConfirmed(t: number): boolean {
    return this.started && this.agreedTo >= t && !this.repairing;
  }
}

describe('the latch, on a hand-built timeline (§3.5)', () => {
  it('shows nothing before a timeline is held', () => {
    const t = new ByHand(matchAt(700, [[650, 0, 1]]));
    t.started = false;
    t.agreedTo = 700;
    const sb = new Scoreboard();
    expect(sb.update(t)).toEqual({ added: [], withdrawn: [] });
    expect([sb.goals, sb.score, sb.end]).toEqual([[], [0, 0], null]);
  });

  it("latches a goal once its tick is confirmed and nothing repairs, each once, with its scorers and the score after it", () => {
    const t = new ByHand(matchAt(600));
    const sb = new Scoreboard();
    sb.update(t);
    t.final = matchAt(665, [[650, 1, 0b1010]]);
    t.agreedTo = 649;
    expect(sb.update(t).added).toEqual([]);
    t.agreedTo = 650;
    t.repairing = true;
    expect(sb.update(t).added).toEqual([]);
    t.repairing = false;
    const { added, withdrawn } = sb.update(t);
    expect(added.map(goalOf)).toEqual([`650 1 false [${IDS[1]},${IDS[3]}] 0-1`]);
    expect(withdrawn).toEqual([]);
    for (let n = 666; n < 700; n++) {
      t.final = matchAt(n, [[650, 1, 0b1010]]);
      t.agreedTo = n - 12;
      expect(sb.update(t).added).toEqual([]);
    }
    expect(sb.goals.map(goalOf)).toEqual([`650 1 false [${IDS[1]},${IDS[3]}] 0-1`]);
    expect(sb.score).toEqual([0, 1]);
    // An own goal names nobody; it counts for the pack it's given to.
    t.final = matchAt(650 + SPACING + 400, [[650, 1, 0b1010], [650 + SPACING + 390, 0, 0]]);
    t.agreedTo = t.final.tick;
    expect(sb.update(t).added.map(goalOf)).toEqual([`${650 + SPACING + 390} 0 true [] 1-1`]);
  });

  it('keeps the scorers it saw celebrated when the kickoff placement cleared them before the tick was confirmed', () => {
    const t = new ByHand(matchAt(660, [[650, 0, 0b0101]]));
    const sb = new Scoreboard();
    sb.update(t);
    t.final = matchAt(650 + P.celebrationTicks + 5, [[650, 0, 0b0101]]);
    expect([t.final.phase, t.final.scorers]).toEqual([KICKOFF_COUNTDOWN, 0]);
    t.agreedTo = 650;
    expect(sb.update(t).added.map(goalOf)).toEqual([`650 0 false [${IDS[0]},${IDS[2]}] 1-0`]);
  });

  it("names the scorers the confirmed state credits when the goal is confirmed after the kickoff placement, never a replaced lineage's (reviewer SB-1)", () => {
    // This browser lost a tally before 650 and repairs: its own losing lineage scores at 650 too,
    // credited to terrier 0, while the winner's credits terrier 2.
    const t = new ByHand(matchAt(600));
    t.agreedTo = 588;
    const sb = new Scoreboard();
    sb.update(t);
    t.repairing = true;
    t.final = matchAt(700, [[650, 0, 0b0001]]);
    sb.update(t);
    // The winner's STATE lands past the celebration: the placement has cleared the bits.
    t.final = matchAt(650 + 250, [[650, 0, 0b0100]]);
    expect([t.final.phase, t.final.scorers, t.final.terriers[2]!.goals, t.final.terriers[0]!.goals]).toEqual([KICKOFF_COUNTDOWN, 0, 1, 0]);
    t.repairing = false;
    t.agreedTo = 650 + 250;
    expect(sb.update(t).added.map(goalOf)).toEqual([`650 0 false [${IDS[2]}] 1-0`]);
    // The next goal, also confirmed after its placement, credits the terrier whose count rose since.
    const goals = [[650, 0, 0b0100], [650 + SPACING + 10, 1, 0b0010]] as const;
    t.final = matchAt(650 + SPACING + 10 + 250, goals);
    t.agreedTo = t.final.tick;
    expect(sb.update(t).added.map(goalOf)).toEqual([`${650 + SPACING + 10} 1 false [${IDS[1]}] 1-1`]);
  });

  it('never latches a goal that names no scorer yet is no own goal: a repaired lineage without the goal (reviewer SB-1)', () => {
    const t = new ByHand(matchAt(600));
    t.agreedTo = 588;
    const sb = new Scoreboard();
    sb.update(t);
    t.repairing = true;
    t.final = matchAt(700);
    sb.update(t);
    t.final = matchAt(650 + 250, [[650, 0, 0b0100]]);
    t.repairing = false;
    t.agreedTo = 650 + 250;
    const [g] = sb.update(t).added;
    expect([g!.ownGoal, g!.scorers]).toEqual([false, [IDS[2]]]);
  });

  it("starts an arrival from the adopted state's score, and latches a goal it saw celebrated once confirmed, never one celebrated before", () => {
    const goals = [[650, 0, 0b0001], [650 + SPACING + 200, 0, 0b0100]] as const;
    const during = new ByHand(matchAt(700, goals));
    const afterIt = new ByHand(matchAt(650 + P.celebrationTicks + 20, goals));
    const sbDuring = new Scoreboard();
    const sbAfter = new Scoreboard();
    sbDuring.update(during);
    sbAfter.update(afterIt);
    // From the adopted state: the goal being celebrated is in the score already.
    expect([sbDuring.score, sbAfter.score]).toEqual([[1, 0], [1, 0]]);
    for (let n = 720; n <= 650 + SPACING + 230; n += 10) {
      for (const t of [during, afterIt]) {
        t.final = matchAt(Math.max(n, t.final.tick), goals);
        t.agreedTo = t.final.tick - 12;
      }
      sbDuring.update(during);
      sbAfter.update(afterIt);
    }
    const second = `${650 + SPACING + 200} 0 false [${IDS[2]}] 2-0`;
    expect(sbDuring.goals.map(goalOf)).toEqual([`650 0 false [${IDS[0]}] 1-0`, second]);
    expect(sbAfter.goals.map(goalOf)).toEqual([second]);
    expect([sbDuring.score, sbAfter.score]).toEqual([[2, 0], [2, 0]]);
  });

  describe('withdraws the last goal only when a completed repair no longer has it (C-4)', () => {
    /** A scoreboard held from tick 600 that latched a goal at 650 for pack A, its state then at 680. */
    function shown(): { t: ByHand; sb: Scoreboard } {
      const t = new ByHand(matchAt(600));
      const sb = new Scoreboard();
      sb.update(t);
      t.final = matchAt(680, [[650, 0, 0b0001]]);
      t.agreedTo = 668;
      expect(sb.update(t).added.length).toBe(1);
      return { t, sb };
    }

    it('gone: nothing while the repair runs, then withdrawn once, the score without it', () => {
      const { t, sb } = shown();
      t.repairing = true;
      t.final = matchAt(640);
      expect(sb.update(t)).toEqual({ added: [], withdrawn: [] });
      t.final = matchAt(700);
      expect(sb.update(t).withdrawn).toEqual([]);
      t.repairing = false;
      const { added, withdrawn } = sb.update(t);
      expect([added, withdrawn.map(goalOf)]).toEqual([[], [`650 0 false [${IDS[0]}] 1-0`]]);
      expect([sb.goals, sb.score]).toEqual([[], [0, 0]]);
      expect(sb.update(t)).toEqual({ added: [], withdrawn: [] });
    });

    it("moved: the old tick's goal withdrawn and the repaired one latched, once it's confirmed", () => {
      const { t, sb } = shown();
      t.repairing = true;
      t.final = matchAt(690, [[653, 0, 0b0100]]);
      sb.update(t);
      t.repairing = false;
      t.agreedTo = 652;
      const first = sb.update(t);
      expect([first.withdrawn.map((g) => g.tick), first.added]).toEqual([[650], []]);
      expect(sb.score).toEqual([0, 0]);
      t.agreedTo = 678;
      expect(sb.update(t).added.map(goalOf)).toEqual([`653 0 false [${IDS[2]}] 1-0`]);
      expect(sb.goals.map((g) => g.tick)).toEqual([653]);
    });

    it('kept: the repaired state still has it, or a later goal at least a celebration and a kickoff countdown on', () => {
      const { t, sb } = shown();
      t.repairing = true;
      sb.update(t);
      t.final = matchAt(700, [[650, 0, 0b0001]]);
      t.repairing = false;
      expect(sb.update(t)).toEqual({ added: [], withdrawn: [] });
      // A later goal, final but not confirmed when a repair completes, doesn't take the shown one back.
      const later = 650 + SPACING;
      t.repairing = true;
      sb.update(t);
      t.final = matchAt(later + 15, [[650, 0, 0b0001], [later, 1, 0b0010]]);
      t.repairing = false;
      t.agreedTo = later - 1;
      expect(sb.update(t)).toEqual({ added: [], withdrawn: [] });
      t.agreedTo = later;
      expect(sb.update(t).added.map((g) => g.tick)).toEqual([later]);
      expect([sb.goals.map((g) => g.tick), sb.score]).toEqual([[650, later], [1, 1]]);
    });

    it('withdraws every latched goal the repaired state has none of, the last first', () => {
      const { t, sb } = shown();
      const later = 650 + SPACING;
      t.final = matchAt(later + 30, [[650, 0, 0b0001], [later, 1, 0b0010]]);
      t.agreedTo = later + 18;
      expect(sb.update(t).added.map((g) => g.tick)).toEqual([later]);
      t.repairing = true;
      sb.update(t);
      t.final = matchAt(later + 40);
      t.repairing = false;
      const { withdrawn } = sb.update(t);
      expect([withdrawn.map((g) => g.tick), sb.goals, sb.score]).toEqual([[later, 650], [], [0, 0]]);
    });
  });

  it("follows a new timeline, a rejoin's: arrives again from its state, keeping the goals shown, and ignores one not yet held", () => {
    const sb = new Scoreboard();
    const first = new ByHand(matchAt(680, [[650, 0, 0b0001]]));
    first.agreedTo = 668;
    expect(sb.update(first).added.length).toBe(1);
    const fresh = new ByHand(matchAt(0));
    fresh.started = false;
    expect(sb.update(fresh)).toEqual({ added: [], withdrawn: [] });
    expect(sb.score).toEqual([1, 0]);
    // Rejoined after a stall (design §4.12): two goals passed meanwhile, the second still celebrated.
    const goals = [[650, 0, 0b0001], [1200, 1, 0b0010], [1700, 0, 0b0100]] as const;
    const rejoined = new ByHand(matchAt(1750, goals));
    expect(sb.update(rejoined)).toEqual({ added: [], withdrawn: [] });
    expect(sb.score).toEqual([2, 1]);
    rejoined.agreedTo = 1750;
    expect(sb.update(rejoined).added.map(goalOf)).toEqual([`1700 0 false [${IDS[2]}] 2-1`]);
    expect(sb.goals.map((g) => g.tick)).toEqual([650, 1700]);
  });

  it("takes a merge's timeline, another match, from its own state: the goals shown go, and its score stands (reviewer SB-2)", () => {
    const sb = new Scoreboard();
    const lost = new ByHand(matchAt(600));
    sb.update(lost);
    lost.final = matchAt(1000, [[650, 0, 0b0001]]);
    lost.agreedTo = 988;
    expect(sb.update(lost).added.map((g) => g.tick)).toEqual([650]);
    // The winner's match had pack B's goal at 700, its celebration over: its warm-up first.
    const won = new ByHand(matchAt(1000, [[700, 1, 0b0010]]), 'b2b2b2b2b2b2b2b2');
    won.repairing = true;
    expect(sb.update(won).withdrawn.map((g) => g.tick)).toEqual([650]);
    expect([sb.goals, sb.score]).toEqual([[], [0, 1]]);
    won.repairing = false;
    won.agreedTo = 1000;
    expect(sb.update(won)).toEqual({ added: [], withdrawn: [] });
    expect(sb.score).toEqual([0, 1]);
    // Its own goals from then on, the one it was celebrating included.
    const other = new Scoreboard();
    const lost2 = new ByHand(matchAt(600));
    other.update(lost2);
    lost2.final = matchAt(1000, [[650, 0, 0b0001]]);
    lost2.agreedTo = 988;
    other.update(lost2);
    const celebrating = new ByHand(matchAt(1100, [[1050, 1, 0b0010]]), 'c3c3c3c3c3c3c3c3');
    celebrating.agreedTo = 1100;
    const changes = other.update(celebrating);
    expect([changes.withdrawn.map((g) => g.tick), changes.added.map(goalOf)]).toEqual([[650], [`1050 1 false [${IDS[1]}] 0-1`]]);
    expect([other.goals.map((g) => g.tick), other.score]).toEqual([[1050], [0, 1]]);
  });

  it('latches the end once its tick is confirmed, rows in (spot, pack) order with the Terriest and the bots, as an arrival on Results does too', () => {
    const goals = [[650, 0, 0b0001], [650 + SPACING + 100, 1, 0b1000]] as const;
    const ended = (tick: number): MatchState => {
      const s = matchAt(tick, goals);
      [s.phase, s.phaseStart, s.clock] = [ENDED, 4000, 0];
      s.terriers[0]!.touches = 5;
      s.terriers[3]!.touches = 9;
      return s;
    };
    const rows = [
      { id: IDS[0], name: 'T0', pack: 0, coat: 0, goals: 1, touches: 5, terriest: false, bot: false },
      { id: IDS[1], name: 'T1', pack: 1, coat: 1, goals: 0, touches: 0, terriest: false, bot: false },
      { id: IDS[2], name: 'T2', pack: 0, coat: 2, goals: 0, touches: 0, terriest: false, bot: false },
      { id: IDS[3], name: 'T3', pack: 1, coat: 3, goals: 1, touches: 9, terriest: true, bot: true },
    ];
    const end = { tick: 4000, score: [1, 1], winner: null, rows };
    const t = new ByHand(matchAt(3990, goals));
    t.agreedTo = 3978;
    const sb = new Scoreboard();
    sb.update(t);
    t.final = ended(4010);
    t.agreedTo = 3999;
    sb.update(t);
    expect(sb.end).toBe(null);
    t.agreedTo = 4000;
    sb.update(t);
    expect(sb.end).toEqual(end);
    const kept = sb.end;
    t.final = ended(4100);
    t.agreedTo = 4088;
    sb.update(t);
    expect(sb.end).toBe(kept);
    expect(sb.score).toEqual([1, 1]);
    // A browser that arrives on Results: no goal, whose celebration is long over, and the end once its
    // first tally agrees (C-50).
    const late = new ByHand(ended(4500));
    const arrived = new Scoreboard();
    arrived.update(late);
    expect([arrived.end, arrived.score]).toEqual([null, [1, 1]]);
    late.agreedTo = 4510;
    expect(arrived.update(late)).toEqual({ added: [], withdrawn: [] });
    expect([arrived.goals, arrived.end]).toEqual([[], end]);
  });
});

// --- Real timelines on the pump (testing.ts) ---

const MATCH = '5c02eb0a2d000001';
const SEED = 5;
const GOAL_X = P.pitch.goalLineX;

/** The pitch-frame step nearest the direction from (x, y) to (tx, ty): 32 a turn, counter-clockwise
 *  from +x (A.2). */
function stepToward(x: number, y: number, tx: number, ty: number): number {
  const turns = Math.atan2(ty - y, tx - x) / (2 * Math.PI);
  return ((Math.round(turns * 32) % 32) + 32) % 32;
}

/** Pack A's scorer, a script of this file's: in play, round to behind the ball, then at the +x goal
 *  with zoomies once lined up; idle once its pack has `most` goals. Read from the drawn head, as a
 *  person's controls follow what they see. */
function scorer(t: Timeline, most = Infinity): () => number {
  return () => {
    const s = t.head;
    if (s.phase !== IN_PLAY || s.score[0] >= most) return 0;
    const me = s.terriers.find((x) => x.id === t.cfg.me);
    if (me === undefined) return 0;
    const b = s.ball;
    if (me.x < b.x - 0.6 && Math.abs(me.y - b.y) < 0.35) {
      return encodeInput({ step: stepToward(me.x, me.y, GOAL_X + 1, b.y / 2), frame: FRAME_PITCH, zoomies: true });
    }
    const ahead = me.x > b.x - 0.6;
    const [tx, ty] = ahead ? [b.x - 2.2, b.y + (me.y >= b.y ? 1.8 : -1.8)] : [b.x - 1.3, b.y];
    return encodeInput({ step: stepToward(me.x, me.y, tx, ty), frame: FRAME_PITCH });
  };
}

/** A goal latched or withdrawn, when, and what the timeline said then. */
interface Event {
  readonly goal: ConfirmedGoal;
  readonly at: number;
  readonly finalTick: number;
  /** When isConfirmed(goal tick) first held, as this file's watch saw it. */
  readonly confirmedAt: number;
}

/** A node's scoreboard, updated after each run of the pump's ms, and what it did. */
class Board {
  readonly sb = new Scoreboard();
  readonly added: Event[] = [];
  readonly withdrawn: Event[] = [];
  /** Updates that ran while the timeline repaired: none may latch. */
  repairingUpdates = 0;
  private readonly firstConfirmed = new Map<number, number>();

  update(t: Timeline, now: number): void {
    const L = t.final.lastGoalTick;
    if (t.started && L !== NEVER && !this.firstConfirmed.has(L) && t.isConfirmed(L)) this.firstConfirmed.set(L, now);
    const { added, withdrawn } = this.sb.update(scored(t));
    if (t.repairing) {
      this.repairingUpdates++;
      expect(added.length + withdrawn.length).toBe(0);
    }
    const event = (goal: ConfirmedGoal): Event => ({ goal, at: now, finalTick: t.finalTick, confirmedAt: this.firstConfirmed.get(goal.tick) ?? -1 });
    this.added.push(...added.map(event));
    this.withdrawn.push(...withdrawn.map(event));
  }
}

/** Four players at 2 a side on one pump, node 0 pack A's scorer and the rest idle, all Ready, and a
 *  board each; verify at 8 on node 1 (design §8.3). */
function match(q: Pump, most = Infinity): { nodes: PumpNode[]; boards: Map<PumpNode, Board> } {
  const nodes = [0, 1, 2, 3].map((k) => q.add({ verify: k === 1 ? 8 : 0 }));
  for (const n of nodes) {
    n.t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
    n.t.sending = true;
    n.t.controls = n.k === 0 ? scorer(n.t, most) : () => 0;
    n.t.queueEvent(n.id, { events: JOIN | READY, joinPack: n.k % 2, coat: n.k, name: `P${n.k}` });
  }
  return { nodes, boards: new Map(nodes.map((n) => [n, new Board()])) };
}

const pump = (): Pump => new Pump({ ids: (k) => personId(SEED, k) });

/** Runs ms, each board updated after every ms's timers, then `each`. */
function run(q: Pump, boards: Map<PumpNode, Board>, ms: number, each?: (now: number) => void): void {
  q.run(ms, (now) => {
    for (const [n, b] of boards) b.update(n.t, now);
    each?.(now);
  });
}

/** The pump ran clean: the drawn head's contract held, every chain verified (testing.ts). */
function expectClean(q: Pump): void {
  expect(q.problems).toEqual([]);
  for (const n of q.nodes) expect(n.t.stats.verifyMismatches).toBe(0);
}

/** b latched each goal at the first update after its tick was confirmed, never while repairing. */
function expectOnTime(b: Board): void {
  for (const e of b.added) expect(e.at, goalOf(e.goal)).toBe(e.confirmedAt);
}

let firstGoalTick = -1;

/** The first goal's tick in this file's match with nothing held back. Holding back what one node
 *  receives leaves the others' lineage as it was: every input still reaches them in time, and the
 *  scorer's inputs stay the same, since an idle player predicted absent moves no body. So the tests
 *  below place what they hold back by it (design §8.2: the runs repeat exactly). */
function firstGoal(): number {
  if (firstGoalTick < 0) {
    const q = pump();
    const { nodes } = match(q);
    q.until(() => nodes[0]!.t.final.lastGoalTick !== NEVER, 30_000);
    firstGoalTick = nodes[0]!.t.final.lastGoalTick;
  }
  return firstGoalTick;
}

/** The tick of the STATE a timeline repaired from, from its log. */
const repairedFrom = (t: Timeline): number => Number(t.stats.log.find(([, e]) => e.startsWith('STATE '))![1].slice('STATE '.length));

describe('over real timelines (P9)', () => {
  it('every peer latches the same goals at the same ticks, each once, none before its tick is confirmed; arrivals in a celebration and after it', () => {
    const q = pump();
    const { nodes, boards } = match(q);
    const [a] = nodes as [PumpNode];
    const late: { during: PumpNode | null; afterIt: PumpNode | null; arrivedIn: number } = { during: null, afterIt: null, arrivedIn: -1 };
    /** A spectator that asks a for the state now. */
    const spectator = (): PumpNode => {
      const n = q.add({ verify: 0 });
      boards.set(n, new Board());
      n.t.requestState(a.peer);
      return n;
    };
    run(q, boards, 26_000, () => {
      const F = a.t.final;
      // One asks for the state 1 s into the first goal's celebration, another once the kickoff
      // countdown after it has begun.
      if (late.during === null && F.phase === CELEBRATION && F.score[0] === 1 && F.tick >= F.phaseStart + 60) late.during = spectator();
      if (late.afterIt === null && F.phase === KICKOFF_COUNTDOWN && F.score[0] === 1) late.afterIt = spectator();
      if (late.during !== null && late.arrivedIn < 0 && late.during.t.started) late.arrivedIn = late.during.t.final.phase;
    });
    expectClean(q);
    expectAgreement(q.nodes);
    expect(late.arrivedIn).toBe(CELEBRATION);
    const players = nodes.map((n) => boards.get(n)!);
    const shown = players[0]!.added.map((e) => goalOf(e.goal));
    expect(shown.length).toBe(2);
    expect(shown.map((g) => g.split(' ').slice(1).join(' '))).toEqual([`0 false [${a.id}] 1-0`, `0 false [${a.id}] 2-0`]);
    for (const b of players) {
      expect(b.added.map((e) => goalOf(e.goal))).toEqual(shown);
      expect(b.withdrawn).toEqual([]);
      expect(b.sb.goals.map(goalOf)).toEqual(shown);
      expect(b.sb.score).toEqual([2, 0]);
      expectOnTime(b);
      // Shown about w + v after the ball crossed (Q-7), never before.
      for (const e of b.added) expect(e.finalTick - e.goal.tick).toBeGreaterThanOrEqual(P.config.voteWindowTicks);
    }
    // Every peer's goal ticks are final ticks with the same hash, and scored there.
    for (const e of players[0]!.added) expect(new Set(q.nodes.map((n) => n.t.hashAt(e.goal.tick))).size).toBe(1);
    // The arrivals: in the celebration, its goal with its scorers and the next; after it, the next alone.
    const d = boards.get(late.during!)!;
    const f = boards.get(late.afterIt!)!;
    expect(d.added.map((e) => goalOf(e.goal))).toEqual(shown);
    expect(f.added.map((e) => goalOf(e.goal))).toEqual(shown.slice(1));
    for (const b of [d, f]) {
      expect(b.withdrawn).toEqual([]);
      expectOnTime(b);
      expect(b.sb.score).toEqual([2, 0]);
    }
  });

  it('a resync crossing a goal: the dissenter latches it once, after its repair, as the others did', () => {
    const L = firstGoal();
    const q = pump();
    const { nodes, boards } = match(q);
    const [, b, , d] = nodes as [PumpNode, PumpNode, PumpNode, PumpNode];
    // d's TICK sent at L − 10 reaches b past the late window: b finalises d absent from L − 8 for a
    // few ticks, loses the tally 3 to 1, and repairs from there, its re-finalisation through L.
    let held = false;
    q.rules.push((from, to, m) => {
      if (held || from !== d || to !== b || m.type !== T.TICK || d.t.localTick < L - 10) return 0;
      held = true;
      return 400;
    });
    const completed = { at: -1, finalTick: -1 };
    run(q, boards, 16_000, (now) => {
      if (completed.at < 0 && b.t.stats.resyncs > 0) [completed.at, completed.finalTick] = [now, b.t.finalTick];
    });
    expectClean(q);
    expectAgreement(q.nodes);
    expect([held, b.t.stats.resyncs, b.t.stats.disagree > 0]).toEqual([true, 1, true]);
    for (const n of nodes) if (n !== b) expect(n.t.stats.resyncs).toBe(0);
    const shown = boards.get(nodes[0]!)!.added.map((e) => goalOf(e.goal));
    expect(boards.get(nodes[0]!)!.added[0]!.goal.tick).toBe(L);
    for (const n of nodes) {
      const board = boards.get(n)!;
      expect(board.added.map((e) => goalOf(e.goal))).toEqual(shown);
      expect(board.withdrawn).toEqual([]);
      expectOnTime(board);
    }
    // The repair took the state from before the goal, and its re-finalisation passed it.
    expect(repairedFrom(b.t)).toBeLessThan(L);
    expect(completed.finalTick).toBeGreaterThanOrEqual(L);
    // b shows it only once its repair is done, never from the lineage it lost.
    expect(boards.get(b)!.repairingUpdates).toBeGreaterThan(0);
    expect(boards.get(b)!.added[0]!.at).toBeGreaterThanOrEqual(completed.at);
  });

  it('a resync for a later tick after the goal shows keeps it: never withdrawn, never latched again', () => {
    const q = pump();
    const { nodes, boards } = match(q);
    const [a, b, , d] = nodes as [PumpNode, PumpNode, PumpNode, PumpNode];
    let held = false;
    q.rules.push((from, to, m) => {
      if (held || from !== d || to !== b || m.type !== T.TICK || boards.get(b)!.sb.goals.length === 0) return 0;
      held = true;
      return 400;
    });
    run(q, boards, 16_000);
    expectClean(q);
    expectAgreement(q.nodes);
    expect([held, b.t.stats.resyncs]).toEqual([true, 1]);
    const shown = boards.get(a)!.added.map((e) => goalOf(e.goal));
    expect(shown.length).toBe(1);
    for (const n of nodes) {
      const board = boards.get(n)!;
      expect(board.added.map((e) => goalOf(e.goal))).toEqual(shown);
      expect(board.withdrawn).toEqual([]);
    }
    expect(repairedFrom(b.t)).toBeGreaterThan(boards.get(b)!.added[0]!.goal.tick);
  });

  /** Every TICK from the others to `to` held back delayMs once, FIFO holding the rest behind it, from
   *  the first sent once `when` holds: `to` finalises them absent, votes alone, and confirms its own
   *  lineage, until the burst lands and the late votes flip its tallies (spread.test.ts's lateFlip). */
  function holdBack(q: Pump, to: PumpNode, delayMs: number, when: () => boolean): { readonly from: () => number } {
    const delayed = new Set<number>();
    let at = -1;
    q.rules.push((from, dest, m) => {
      if (dest !== to || from === to || m.type !== T.TICK || delayed.has(from.k)) return 0;
      if (at < 0) {
        if (!when()) return 0;
        at = to.t.localTick;
      }
      delayed.add(from.k);
      return delayMs;
    });
    return { from: () => at };
  }

  it("a late-vote repair crossing a goal the dissenter confirmed alone keeps it, the repair's state having it", () => {
    const L = firstGoal();
    const q = pump();
    const { nodes, boards } = match(q);
    const [a] = nodes as [PumpNode];
    // a scores. The others' TICKs to a are held back 1.2 s from a's local L − 20, so a tallies L alone
    // and confirms it before the burst lands. The others are idle and stay standing (D-16's sitting is
    // 2 s off), so a's own lineage scores at L too, and the repair's state still has it.
    const hold = holdBack(q, a, 1200, () => a.t.localTick >= L - 20);
    let flippedAt = -1;
    run(q, boards, 16_000, (now) => {
      if (flippedAt < 0 && a.t.stats.lateVoteFlips > 0) flippedAt = now;
    });
    expectClean(q);
    expectAgreement(q.nodes);
    const st = a.t.stats;
    expect([hold.from() > 0, st.lateVoteFlips > 0, st.resyncs]).toEqual([true, true, 1]);
    const mine = boards.get(a)!;
    expect(mine.added.map((e) => e.goal.tick)).toEqual([L]);
    // Latched alone before the late votes arrived, the repair from before it, and never taken back.
    expect(mine.added[0]!.at).toBeLessThan(flippedAt);
    expect(repairedFrom(a.t)).toBeLessThan(L);
    expect(mine.withdrawn).toEqual([]);
    expect(a.t.final.lastGoalTick).toBe(L);
    for (const n of nodes) expect(boards.get(n)!.added.map((e) => goalOf(e.goal))).toEqual(mine.added.map((e) => goalOf(e.goal)));
  });

  it("withdraws, once, a goal a diverged browser confirmed alone when its repair's state hasn't it (C-4)", () => {
    const q = pump();
    const { nodes, boards } = match(q);
    const [a] = nodes as [PumpNode];
    // Early in play the others' TICKs to a are held back 1.2 s, and a's own final state is spoilt
    // meanwhile: the ball just over the +x goal line, which a's next step scores (design §0's
    // on-purpose corruptions). Nobody else has that goal.
    const hold = holdBack(q, a, 1200, () => a.t.final.phase === IN_PLAY);
    let spoilt = -1;
    run(q, boards, 15_000, () => {
      if (spoilt >= 0 || hold.from() < 0 || a.t.localTick < hold.from() + 20) return;
      const x = inside(a.t);
      const ball = x.F.ball;
      [ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz] = [GOAL_X + P.ballRadius + 0.2, 0, P.ballRadius, 0, 0, 0];
      x.validTo = a.t.finalTick;
      x.touchedFrom = Math.min(x.touchedFrom, a.t.finalTick + 1);
      spoilt = a.t.finalTick + 1;
    });
    expectAgreement(q.nodes);
    expect(q.problems).toEqual([]);
    const mine = boards.get(a)!;
    expect(a.t.stats.resyncs).toBe(1);
    expect(mine.added[0]!.goal.tick).toBe(spoilt);
    expect(mine.withdrawn.map((e) => goalOf(e.goal))).toEqual([goalOf(mine.added[0]!.goal)]);
    expect(mine.withdrawn[0]!.at).toBeGreaterThan(mine.added[0]!.at);
    // The true first goal came later, and every peer shows it alone.
    const shown = boards.get(nodes[1]!)!.added.map((e) => goalOf(e.goal));
    expect(shown.length).toBe(1);
    expect(boards.get(nodes[1]!)!.sb.goals[0]!.tick).toBeGreaterThan(spoilt);
    for (const n of nodes) {
      expect(boards.get(n)!.sb.goals.map(goalOf)).toEqual(shown);
      expect(boards.get(n)!.sb.score).toEqual([1, 0]);
    }
    expect(mine.added.slice(1).map((e) => goalOf(e.goal))).toEqual(shown);
    for (const n of nodes.slice(1)) expect(boards.get(n)!.withdrawn).toEqual([]);
  });

  it("names the goal's scorers on a dissenter whose repair lands after the celebration, as every peer does (reviewer SB-1)", () => {
    const L = firstGoal();
    const q = pump();
    const { nodes, boards } = match(q);
    const [a, b] = nodes as [PumpNode, PumpNode];
    // b's final state is spoilt 30 ticks before the goal, the ball at rest on the centre spot, so its
    // own lineage doesn't score at L. Every STATE to b is dropped until its resync is for a tick past
    // the goal's celebration, when the kickoff placement has cleared the scorers bits.
    const g = (): number => (b.t as unknown as { resync: { g: number } | null }).resync?.g ?? -1;
    q.rules.push((_from, to, m) => (to === b && m.type === T.STATE && g() < L + P.celebrationTicks + 6 ? null : 0));
    let spoilt = -1;
    run(q, boards, 26_000, () => {
      if (spoilt >= 0 || b.t.finalTick < L - 30) return;
      const x = inside(b.t);
      const ball = x.F.ball;
      [ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz] = [0, 0, P.ballRadius, 0, 0, 0];
      x.validTo = b.t.finalTick;
      x.touchedFrom = Math.min(x.touchedFrom, b.t.finalTick + 1);
      spoilt = b.t.finalTick;
    });
    expectAgreement(q.nodes);
    expect(q.problems).toEqual([]);
    const mine = boards.get(b)!;
    const theirs = boards.get(a)!;
    expect(spoilt).toBeGreaterThan(0);
    expect(b.t.stats.resyncFailed).toBeGreaterThan(0);
    expect(repairedFrom(b.t)).toBeGreaterThan(L + P.celebrationTicks);
    expect(theirs.added[0]!.goal.tick).toBe(L);
    expect(theirs.added[0]!.goal.scorers).toEqual([a.id]);
    // Latched only after the placement, and with the scorers every other peer shows.
    expect(mine.added[0]!.finalTick).toBeGreaterThanOrEqual(L + P.celebrationTicks);
    expect(mine.added.map((e) => goalOf(e.goal))).toEqual(theirs.added.map((e) => goalOf(e.goal)));
    expect(mine.withdrawn).toEqual([]);
  });

  it('the confirmed end: the same tick, score, winner and rows on every peer, and on a browser that arrives on Results (C-50)', () => {
    const q = pump();
    // 1 a side: a scores twice and then idles, b hosts pack B's bot, which idles.
    const [a, b] = [q.add({ verify: 8 }), q.add({ verify: 0 })];
    for (const n of [a, b]) n.t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    a.t.sending = true;
    a.t.controls = scorer(a.t, 2);
    a.t.queueEvent(a.id, { events: JOIN | READY, joinPack: 0, coat: 0, name: 'Ace' });
    const bot = botId(b.id, 0);
    b.t.bots.set(bot, () => 0);
    b.t.queueEvent(bot, { events: JOIN | READY, joinPack: 1, coat: 5, name: 'Bot' });
    const boards = new Map([a, b].map((n) => [n, new Board()]));
    const late: { c: PumpNode | null } = { c: null };
    run(q, boards, 90_000, () => {
      if (late.c !== null || boards.get(a)!.sb.end === null || boards.get(b)!.sb.end === null) return;
      late.c = q.add({ verify: 0 });
      boards.set(late.c, new Board());
      late.c.t.requestState(b.peer);
    });
    expectClean(q);
    expectAgreement(q.nodes);
    expect(late.c).not.toBe(null);
    const end = boards.get(a)!.sb.end!;
    expect(end).toMatchObject({ score: [2, 0], winner: 0 });
    expect(a.t.final.phase).toBe(ENDED);
    expect(end.tick).toBe(a.t.final.phaseStart);
    expect(end.rows.map((r) => [r.id, r.pack, r.goals, r.terriest, r.bot])).toEqual([[a.id, 0, 2, true, false], [bot, 1, 0, false, true]]);
    for (const n of q.nodes) {
      const board = boards.get(n)!;
      expect(board.sb.end).toEqual(end);
      expect(board.sb.score).toEqual([2, 0]);
      expect(board.withdrawn).toEqual([]);
    }
    expect(boards.get(late.c!)!.sb.goals).toEqual([]);
    expect(boards.get(b)!.sb.goals.map(goalOf)).toEqual(boards.get(a)!.sb.goals.map(goalOf));
    expect(boards.get(a)!.sb.goals.length).toBe(2);
  });
});
