import { describe, expect, it } from 'vitest';
import { config } from '../config';
import type { BarkEvent, BarkTimeline } from '../core/session/bark-types';
import { BarkTracker } from '../core/session/barks';
import { type ConfirmedGoal, Scoreboard, type ScoreTimeline } from '../core/session/scoreboard';
import { encodeInput } from '../core/sim/input';
import { defaultParams } from '../core/sim/params';
import { placedMatch } from '../core/sim/scenes';
import {
  CELEBRATION, cloneState, ENDED, GETTING_UP, IN_PLAY, KICKOFF_COUNTDOWN, LUNGING, type MatchState, NEVER, RUNNING, START_COUNTDOWN, TUMBLED,
} from '../core/sim/state';
import type { CueKind } from '../ui/inspect';
import { SoundCues } from './cues';
import { type Cue, seedOf } from './synth';

// When each sound plays, given rollback (PLAN §13, D-14, D-16, D-32; M4's
// design §1.29, §7, §9.2's cues.test row): a bounce re-simulated one tick
// later sounds once, and one moved 4 ticks sounds twice; a thump's loudness
// from its first sighting; an old hit a correction shows again never
// thumps; pounces and tumbles keyed by body and start; the kickoff whistle
// once per play's start, the overtime's too; a predicted end that a
// correction turns into overtime blows no end whistle, through the real
// scoreboard; remote barks only from received inputs, never predicted ones,
// through the real bark tracker, and yours at the press; a goal's whistle
// and chorus once however often the scoreboard is read; and another
// timeline's first head a baseline only.

const P = defaultParams;
const SHIFT = config.soundShiftTicksMax;
const base = placedMatch(P, 2);
const ME = base.terriers[0]!.id;
const THEM = base.terriers[1]!.id;
const OTHER = base.terriers[2]!.id;

/** The placed match at `tick`, in play from `phaseStart`, changed by `f`. */
function at(tick: number, f: (s: MatchState) => void = () => {}, phaseStart = 0): MatchState {
  const s = cloneState(base);
  s.tick = tick;
  s.phase = IN_PLAY;
  s.phaseStart = phaseStart;
  f(s);
  return s;
}

const hit = (tick: number, strength = 6) => (s: MatchState): void => {
  s.ball.lastHitTick = tick;
  s.ball.lastHitStrength = strength;
};

const kinds = (cues: readonly Cue[]): CueKind[] => cues.map((c) => c.kind);
const count = (all: readonly Cue[], kind: CueKind): number => all.filter((c) => c.kind === kind).length;

/** Cues whose first look has set the baseline, so the next shows what's new. */
function cues(): SoundCues {
  const c = new SoundCues(ME, SHIFT);
  expect(c.fromHead(at(1, () => {}, 0))).toEqual([]);
  return c;
}

describe('bounces from the predicted head (PLAN §13)', () => {
  it('sounds a bounce re-simulated one tick later once, and one moved 4 ticks twice', () => {
    expect(SHIFT).toBe(3);
    const c = cues();
    expect(kinds(c.fromHead(at(100, hit(100))))).toEqual(['thump']);
    expect(c.fromHead(at(100, hit(100))), 'read again').toEqual([]);
    expect(c.fromHead(at(102, hit(101))), 'moved a tick by a re-simulation').toEqual([]);
    expect(c.fromHead(at(103, hit(103))), 'moved 3 ticks').toEqual([]);
    expect(kinds(c.fromHead(at(105, hit(104)))), 'moved 4 ticks').toEqual(['thump']);
    // Earlier as well as later.
    const d = cues();
    expect(kinds(d.fromHead(at(200, hit(200))))).toEqual(['thump']);
    expect(d.fromHead(at(200, hit(197)))).toEqual([]);
    expect(kinds(d.fromHead(at(200, hit(196))))).toEqual(['thump']);
  });

  it('takes its loudness from the hit at its first sighting, louder for a harder hit', () => {
    const c = cues();
    const [soft] = c.fromHead(at(100, hit(100, 3)));
    expect(soft).toMatchObject({ kind: 'thump', loudness: 3 / 12 });
    // A re-simulation that makes it harder changes nothing that's played.
    expect(c.fromHead(at(101, hit(101, 11)))).toEqual([]);
    const [hard] = c.fromHead(at(300, hit(300, 30)));
    expect(hard).toMatchObject({ kind: 'thump', loudness: 1 });
  });

  it('never thumps an old hit that a correction shows again, however old', () => {
    const c = cues();
    expect(kinds(c.fromHead(at(100, hit(100))))).toEqual(['thump']);
    expect(kinds(c.fromHead(at(500, hit(500))))).toEqual(['thump']);
    // The predicted hit at 500 taken away: the head's last hit is 100's again.
    expect(c.fromHead(at(505, hit(100)))).toEqual([]);
    // Past the state history, where no re-simulation reaches, an old hit is never new, played or not.
    const d = cues();
    expect(d.fromHead(at(2000, hit(2000 - config.stateHistoryTicks - 1)))).toEqual([]);
    expect(kinds(d.fromHead(at(2000, hit(1990))))).toEqual(['thump']);
    expect(d.fromHead(at(2000 + config.stateHistoryTicks + 50, hit(1990))), 'long after, the same hit').toEqual([]);
  });
});

describe('pounces and tumbles from the predicted head (PLAN §13)', () => {
  const anim = (id: string, phase: number, start: number) => (s: MatchState): void => {
    const T = s.terriers.find((x) => x.id === id)!;
    T.anim = phase as MatchState['terriers'][number]['anim'];
    T.animStart = start;
  };

  it("whooshes a lunge when it's first seen, keyed by its terrier and its start, once within the shift", () => {
    const c = cues();
    expect(c.fromHead(at(199, anim(THEM, RUNNING, 150)))).toEqual([]);
    const [w] = c.fromHead(at(200, anim(THEM, LUNGING, 200)));
    expect(w).toEqual({ kind: 'whoosh', seed: seedOf(THEM), loudness: 1 });
    expect(c.fromHead(at(210, anim(THEM, LUNGING, 200))), 'still lunging').toEqual([]);
    expect(c.fromHead(at(211, anim(THEM, LUNGING, 202))), 'its start moved by a correction').toEqual([]);
    // Another terrier's at the same tick is its own.
    expect(kinds(c.fromHead(at(212, (s) => {
      anim(THEM, LUNGING, 202)(s);
      anim(OTHER, LUNGING, 202)(s);
    })))).toEqual(['whoosh']);
    expect(kinds(c.fromHead(at(300, anim(THEM, LUNGING, 300)))), 'its next pounce').toEqual(['whoosh']);
  });

  it('thuds a tumble once, its getting up silent', () => {
    const c = cues();
    expect(kinds(c.fromHead(at(400, anim(ME, TUMBLED, 400))))).toEqual(['thud']);
    expect(c.fromHead(at(440, anim(ME, TUMBLED, 400)))).toEqual([]);
    expect(c.fromHead(at(461, anim(ME, GETTING_UP, 460)))).toEqual([]);
    expect(kinds(c.fromHead(at(700, anim(ME, TUMBLED, 700))))).toEqual(['thud']);
  });
});

describe('the kickoff whistle (PLAN §13)', () => {
  it('blows when play starts, keyed by its start, so a correction in play never blows it again', () => {
    const c = new SoundCues(ME, SHIFT);
    const countdown = (tick: number, start: number): MatchState => at(tick, (s) => {
      s.phase = START_COUNTDOWN;
      s.phaseStart = start;
    });
    expect(c.fromHead(countdown(50, 10))).toEqual([]);
    expect(c.fromHead(countdown(309, 10))).toEqual([]);
    expect(c.fromHead(at(310, () => {}, 310))).toEqual([{ kind: 'whistleKickoff', seed: 310, loudness: 1 }]);
    expect(c.fromHead(at(400, () => {}, 310))).toEqual([]);
    // A predicted goal that a correction takes away: the head celebrates, then plays on from the same start.
    expect(c.fromHead(at(500, (s) => {
      s.phase = CELEBRATION;
      s.phaseStart = 498;
    }))).toEqual([]);
    expect(c.fromHead(at(501, () => {}, 310))).toEqual([]);
    // The next kickoff's, the overtime's among them.
    expect(kinds(c.fromHead(at(1200, () => {}, 1190)))).toEqual(['whistleKickoff']);
    expect(kinds(c.fromHead(at(3000, (s) => (s.overtime = true), 2990)))).toEqual(['whistleKickoff']);
  });
});

/** A timeline as the scoreboard reads one: its final state, how far it's confirmed, and its lineage's goals. */
class Confirmed implements ScoreTimeline {
  readonly started = true;
  readonly id = '00000000000000aa';
  final: MatchState;
  repairing = false;
  confirmedTo: number;
  readonly goalTicks: number[] = [];

  constructor(final: MatchState) {
    this.final = final;
    this.confirmedTo = final.tick;
  }

  get finalTick(): number {
    return this.final.tick;
  }

  isConfirmed(t: number): boolean {
    return t <= this.confirmedTo;
  }

  hasGoalAt(t: number): boolean {
    return this.final.lastGoalTick === t || this.goalTicks.includes(t);
  }
}

describe('the goal and end whistles, from the confirmed score (D-14)', () => {
  /** One timer run as the sound layer makes it: the head's cues, then the scoreboard's goals added and its
   *  end, once confirmed. */
  function runner(c: SoundCues, board: Scoreboard, t: Confirmed): (head: MatchState) => Cue[] {
    let ended = false;
    return (head) => {
      const out = [...c.fromHead(head)];
      const { added } = board.update(t);
      out.push(...c.fromScore(added, board.end !== null && !ended));
      ended = board.end !== null;
      return out;
    };
  }

  it('blows no end whistle for a predicted end that a correction turns into overtime, and one at the confirmed end', () => {
    // Its first run, in play, the baseline.
    const c = new SoundCues(ME, SHIFT);
    const late = (tick: number, f: (s: MatchState) => void): MatchState => at(tick, (s) => {
      s.score = [1, 0];
      s.clock = 5000 - tick;
      s.lastGoalTick = 1000;
      s.lastGoalPack = 0;
      f(s);
    }, 4000);
    const t = new Confirmed(late(4990, () => {}));
    const board = new Scoreboard();
    const run = runner(c, board, t);
    const all: Cue[] = [];
    all.push(...run(late(4990, () => {})));
    // The head predicts the end at 0:00, pack A ahead; the final state is still in play.
    const predicted = late(5000, (s) => {
      s.clock = 0;
      s.phase = ENDED;
      s.phaseStart = 5000;
    });
    t.final = late(4995, () => {});
    t.confirmedTo = 4995;
    all.push(...run(predicted), ...run(predicted));
    expect(count(all, 'whistleEnd'), 'a predicted end').toBe(0);
    // A late input shows pack B levelled it in the last tick: a celebration, then the overtime kickoff.
    const levelled = (tick: number, f: (s: MatchState) => void = () => {}): MatchState => late(tick, (s) => {
      s.clock = 0;
      s.score = [1, 1];
      s.lastGoalTick = 5000;
      s.lastGoalPack = 1;
      s.phase = CELEBRATION;
      s.phaseStart = 5000;
      f(s);
    });
    t.final = levelled(5004);
    t.confirmedTo = 5004;
    all.push(...run(levelled(5010)));
    expect(kinds(all)).toEqual(['whistleGoal', 'chorus']);
    const kickoff = 5000 + P.celebrationTicks;
    const overtime = (tick: number, phase: number, start: number): MatchState => levelled(tick, (s) => {
      s.overtime = true;
      s.phase = phase as MatchState['phase'];
      s.phaseStart = start;
    });
    t.final = overtime(kickoff + 1, KICKOFF_COUNTDOWN, kickoff);
    t.confirmedTo = kickoff + 1;
    all.push(...run(overtime(kickoff + 10, KICKOFF_COUNTDOWN, kickoff)));
    const play = kickoff + P.kickoffCountdownTicks;
    t.final = overtime(play + 1, IN_PLAY, play);
    t.confirmedTo = play + 1;
    all.push(...run(overtime(play + 8, IN_PLAY, play)));
    expect(kinds(all)).toEqual(['whistleGoal', 'chorus', 'whistleKickoff']);
    expect(board.end).toBeNull();
    // The overtime goal ends it: its whistle and chorus, and the end whistle once its tick is confirmed,
    // and never again.
    const golden = play + 600;
    const ended = (tick: number): MatchState => overtime(tick, ENDED, golden + P.celebrationTicks);
    const scored = (s: MatchState): MatchState => {
      s.score = [1, 2];
      s.lastGoalTick = golden;
      return s;
    };
    t.goalTicks.push(5000);
    all.push(...run(scored(ended(golden + P.celebrationTicks + 5))));
    expect(count(all, 'whistleEnd'), 'not yet confirmed').toBe(0);
    t.final = scored(ended(golden + P.celebrationTicks + 2));
    t.confirmedTo = golden + P.celebrationTicks + 2;
    all.push(...run(scored(ended(golden + P.celebrationTicks + 9))), ...run(scored(ended(golden + P.celebrationTicks + 10))));
    expect(kinds(all)).toEqual(['whistleGoal', 'chorus', 'whistleKickoff', 'whistleGoal', 'chorus', 'whistleEnd']);
    expect(board.end).not.toBeNull();
    expect(board.goals.map((g) => g.tick)).toEqual([5000, golden]);
  });

  it("blows a goal's whistle and chorus once however often the scoreboard is read, the end whistle once", () => {
    const c = cues();
    const goal = (tick: number, pack: 0 | 1): ConfirmedGoal => ({ tick, pack, ownGoal: false, scorers: [], score: [pack === 0 ? 1 : 0, pack] });
    const g = goal(900, 0);
    expect(c.fromScore([g], false)).toEqual([{ kind: 'whistleGoal', seed: 900, loudness: 1 }, { kind: 'chorus', seed: 1800, loudness: 1 }]);
    for (let k = 0; k < 4; k++) expect(c.fromScore([g], false)).toEqual([]);
    expect(kinds(c.fromScore([g, goal(1500, 1)], false))).toEqual(['whistleGoal', 'chorus']);
    expect(c.fromScore([], false)).toEqual([]);
    expect(kinds(c.fromScore([], true))).toEqual(['whistleEnd']);
    expect(c.fromScore([], true)).toEqual([]);
  });
});

/** A timeline's inputs as the bark tracker reads them: what isn't set wasn't received, a prediction's tick. */
class Received implements BarkTimeline {
  head: MatchState;
  private readonly inputs = new Map<string, Map<number, number>>();

  constructor(head: MatchState) {
    this.head = head;
  }

  receive(id: string, from: number, to: number, input: (t: number) => number): void {
    let m = this.inputs.get(id);
    if (m === undefined) this.inputs.set(id, (m = new Map()));
    for (let t = from; t <= to; t++) m.set(t, input(t));
  }

  receivedInput(id: string, t: number): number | undefined {
    return this.inputs.get(id)?.get(t);
  }

  newestInput(id: string): { readonly tick: number; readonly input: number } | undefined {
    const m = this.inputs.get(id);
    if (m === undefined || m.size === 0) return undefined;
    const tick = Math.max(...m.keys());
    return { tick, input: m.get(tick)! };
  }
}

describe('barks (D-16)', () => {
  const withBark = (n: number): number => encodeInput({ step: 4, bark: n });

  it('plays a remote bark only from received inputs, never a predicted one, through the bark tracker', () => {
    const t = new Received(at(10));
    const tracker = new BarkTracker(ME);
    const c = cues();
    const all: Cue[] = [];
    const run = (tick: number, predicted: number): void => {
      // The head predicts THEM's input on from its last received one: here, with a bark count that moves.
      t.head = at(tick, (s) => {
        for (const T of s.terriers) if (T.id !== ME) T.prevInput = withBark(predicted);
      });
      all.push(...c.fromHead(t.head), ...c.fromBarks(tracker.update(t)));
    };
    t.receive(THEM, 0, 10, () => withBark(0));
    t.receive(OTHER, 0, 10, () => withBark(0));
    run(10, 0);
    for (let k = 11; k <= 20; k++) run(k, k); // every predicted tick a "bark", and none received
    expect(count(all, 'bark'), 'predicted').toBe(0);
    // THEM's received input for 15 has the bark: one bark, in THEM's voice.
    t.receive(THEM, 11, 20, (k) => withBark(k < 15 ? 0 : 1));
    run(21, 21);
    expect(all.filter((x) => x.kind === 'bark')).toEqual([{ kind: 'bark', seed: seedOf(THEM), loudness: 1 }]);
  });

  it('plays yours at the press, never again from a received input naming you, and each bark once', () => {
    const c = cues();
    const own = (tick: number): BarkEvent => ({ id: ME, tick, own: true });
    expect(c.fromBarks([own(100)])).toEqual([{ kind: 'bark', seed: seedOf(ME), loudness: 1 }]);
    expect(c.fromBarks([{ id: ME, tick: 100, own: false }, { id: ME, tick: 160, own: false }]), 'yours, received').toEqual([]);
    expect(c.fromBarks([own(100)]), 'the same press').toEqual([]);
    const them = (tick: number): BarkEvent => ({ id: THEM, tick, own: false });
    expect(kinds(c.fromBarks([them(100), them(170), own(170)]))).toEqual(['bark', 'bark', 'bark']);
    expect(c.fromBarks([them(170)])).toEqual([]);
    expect(c.fromBarks([])).toEqual([]);
  });
});

describe('another timeline (§7)', () => {
  it("replays nothing from its adopted state: its first head only sets the baseline", () => {
    const c = cues();
    const busy = (tick: number): MatchState => at(tick, (s) => {
      hit(tick - 2)(s);
      const T = s.terriers.find((x) => x.id === THEM)!;
      T.anim = LUNGING;
      T.animStart = tick - 5;
    }, tick - 100);
    expect(kinds(c.fromHead(busy(900)))).toEqual(['thump', 'whoosh', 'whistleKickoff']);
    c.reset();
    // A merge's state, mid-play, its own hit, lunge and kickoff: nothing plays from it.
    expect(c.fromHead(busy(4000))).toEqual([]);
    expect(c.fromHead(busy(4000))).toEqual([]);
    // What comes after it does.
    expect(kinds(c.fromHead(at(4010, hit(4010), 3900)))).toEqual(['thump']);
    // And nothing it had seen is kept: its goals and end, and the barks.
    c.fromScore([{ tick: 10, pack: 0, ownGoal: false, scorers: [], score: [1, 0] }], true);
    c.fromBarks([{ id: THEM, tick: 50, own: false }]);
    c.reset();
    expect(kinds(c.fromScore([{ tick: 10, pack: 0, ownGoal: false, scorers: [], score: [1, 0] }], true))).toEqual(['whistleGoal', 'chorus', 'whistleEnd']);
    expect(kinds(c.fromBarks([{ id: THEM, tick: 50, own: false }]))).toEqual(['bark']);
  });

  it('takes the first head after it is made as the baseline too', () => {
    const c = new SoundCues(ME, SHIFT);
    expect(c.fromHead(at(800, hit(798), 700))).toEqual([]);
    expect(c.fromHead(at(801, hit(798), 700))).toEqual([]);
    expect(kinds(c.fromHead(at(900, hit(900), 700)))).toEqual(['thump']);
    expect(NEVER).toBe(base.ball.lastHitTick); // the placed match's ball was never hit
  });
});
