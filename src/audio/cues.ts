// When each sound plays, given rollback (PLAN §13, D-14, D-16, D-32; M4's
// design, research/m4/DESIGN.md, §1.29, §7), decided after each timer run,
// since the head moves there, not once a frame:
// - bounces, pounces and tumbles from the predicted head, when their event
//   first appears there: the ball's lastHitTick changing (a thump, its
//   loudness the hit's strength at that first sighting), a terrier's
//   animation entering lunging (a whoosh) or tumbled (a thud). Each is keyed
//   by its kind, its body and its tick, and none plays within shiftTicks of
//   one of its kind and body already played, so one a re-simulation moves by
//   up to soundShiftTicksMax (3) ticks doesn't play again; one a correction
//   removes has already played and is left to finish, each under 0.3 s. An
//   event older than the state history no re-simulation reaches, so it's
//   never new: a correction that takes the latest hit away shows an old one;
// - the kickoff whistle when play starts: the head's phase becoming in play,
//   keyed by its start, which ticks final seconds before fixed, so no
//   correction moves it;
// - a goal's whistle and chorus once per confirmed goal tick, from the
//   scoreboard's goals added (D-14), and the end whistle once, at the
//   confirmed end, so a predicted end a correction turns into overtime
//   blows none;
// - barks from BarkTracker's events: a remote terrier's and a hosted bot's
//   from received or recorded inputs only, never predicted ones (D-16), and
//   this viewer's own at the press, so a received event naming it is never
//   played twice; each once.
// The first look after construction or reset() only sets the baseline:
// another timeline, a merge's or a rejoin's, replays nothing from its
// adopted state (§7). Three-free and pure. New at M4.

import { config } from '../config';
import type { BarkEvent, ConfirmedGoal } from '../core/session/index';
import { IN_PLAY, LUNGING, type MatchState, NEVER, TUMBLED } from '../core/sim/index';
import { type Cue, seedOf } from './synth';

const NONE: readonly Cue[] = Object.freeze([]);
/** The ball, among the bodies: no terrier's ID is empty. */
const BALL = '';
/** A hit this hard, in m/s of closing speed, thumps at full loudness; a softer one more quietly. */
const LOUD_HIT_MPS = 12;

type HeadKind = 'thump' | 'whoosh' | 'thud';

export class SoundCues {
  private readonly me: string;
  private readonly shift: number;
  /** The ticks played of each kind's events, by body, ascending. */
  private readonly played: Readonly<Record<HeadKind, Map<string, number[]>>> = { thump: new Map(), whoosh: new Map(), thud: new Map() };
  /** The phaseStarts of the plays whistled, and the goal ticks. */
  private readonly kickoffs: number[] = [];
  private readonly goals: number[] = [];
  private ended = false;
  /** Each terrier's last bark played, by tick. */
  private readonly barks = new Map<string, number>();
  /** The first look at a head only sets the baseline. */
  private looked = false;

  constructor(me: string, shiftTicks: number) {
    this.me = me;
    this.shift = shiftTicks;
  }

  /** After each timer run: bounces, pounces and tumbles first seen in the predicted head, keyed by kind,
   *  body and tick, none again within shiftTicks of one played; the kickoff whistle when play starts. */
  fromHead(head: Readonly<MatchState>): readonly Cue[] {
    const baseline = !this.looked;
    this.looked = true;
    const oldest = head.tick - config.stateHistoryTicks;
    let out: Cue[] | null = null;
    const b = head.ball;
    if (b.lastHitTick !== NEVER && this.first('thump', BALL, b.lastHitTick, oldest, baseline)) {
      (out ??= []).push({ kind: 'thump', seed: b.lastHitTick, loudness: Math.min(1, b.lastHitStrength / LOUD_HIT_MPS) });
    }
    for (const T of head.terriers) {
      const kind = T.anim === LUNGING ? 'whoosh' : T.anim === TUMBLED ? 'thud' : null;
      if (kind !== null && this.first(kind, T.id, T.animStart, oldest, baseline)) (out ??= []).push({ kind, seed: seedOf(T.id), loudness: 1 });
    }
    if (head.phase === IN_PLAY && !this.kickoffs.includes(head.phaseStart)) {
      this.kickoffs.push(head.phaseStart);
      if (!baseline) (out ??= []).push({ kind: 'whistleKickoff', seed: head.phaseStart, loudness: 1 });
    }
    return out ?? NONE;
  }

  /** Confirmed goals and the end, from the scoreboard's changes (D-14): a whistle and the chorus once per
   *  goal tick, the end whistle once. */
  fromScore(goalsAdded: readonly ConfirmedGoal[], endConfirmed: boolean): readonly Cue[] {
    let out: Cue[] | null = null;
    for (const g of goalsAdded) {
      if (this.goals.includes(g.tick)) continue;
      this.goals.push(g.tick);
      (out ??= []).push({ kind: 'whistleGoal', seed: g.tick, loudness: 1 }, { kind: 'chorus', seed: (2 * g.tick + g.pack) >>> 0, loudness: 1 });
    }
    if (endConfirmed && !this.ended) {
      this.ended = true;
      (out ??= []).push({ kind: 'whistleEnd', seed: 0, loudness: 1 });
    }
    return out ?? NONE;
  }

  /** Barks: remote ones from received inputs only (D-16), yours at the press, each once. */
  fromBarks(barks: readonly BarkEvent[]): readonly Cue[] {
    let out: Cue[] | null = null;
    for (const e of barks) {
      if (e.id === this.me && !e.own) continue;
      if (this.barks.get(e.id) === e.tick) continue;
      this.barks.set(e.id, e.tick);
      (out ??= []).push({ kind: 'bark', seed: seedOf(e.id), loudness: 1 });
    }
    return out ?? NONE;
  }

  /** Another timeline: nothing seen is kept, and the next head sets the baseline. */
  reset(): void {
    for (const k of ['thump', 'whoosh', 'thud'] as const) this.played[k].clear();
    this.kickoffs.length = 0;
    this.goals.length = 0;
    this.ended = false;
    this.barks.clear();
    this.looked = false;
  }

  /** Whether the event of this kind and body at `tick` is new: inside the history a re-simulation reaches,
   *  and not within shiftTicks of one of its kind and body played. Recorded as played when it is, and
   *  played unless it's the baseline's. */
  private first(kind: HeadKind, body: string, tick: number, oldest: number, baseline: boolean): boolean {
    if (tick < oldest) return false;
    const by = this.played[kind];
    let ticks = by.get(body);
    if (ticks === undefined) by.set(body, (ticks = []));
    // What no new event can come within shiftTicks of is dropped.
    while (ticks.length > 0 && ticks[0]! < oldest - this.shift) ticks.shift();
    let at = ticks.length;
    for (let k = 0; k < ticks.length; k++) {
      const t = ticks[k]!;
      if (Math.abs(t - tick) <= this.shift) return false;
      if (t > tick && at === ticks.length) at = k;
    }
    ticks.splice(at, 0, tick);
    return !baseline;
  }
}
