// The Match adapters (M4's design, research/m4/DESIGN.md, §1.37, §4.1,
// §8.1; PLAN D-12, D-22, Q-15, D-30, P10): one interface over M3's glue
// (src/ui/match-types.ts), which the screens, the view, the controls and the
// sound meet at. Phase 1's is Practice's, over M3's PracticeGame unchanged:
// - its session is PracticeGame.practice.session, its scoreboard and clock
//   the game's;
// - it pauses while any reason holds, the menu's or lost graphics', and
//   resumes once none does (Q-15, D-30); a stall's or a hidden page's own
//   pause reaches the subscribers' stalled, and the screen opens the menu,
//   which then holds it;
// - the sampler is called once a sent tick on the drawn head, with the tick
//   its input is for, the timeline's local tick + d (§4.1);
// - own(): after each timer run, before the subscribers hear it, the local
//   ticks moved, the TICKs sent and the ticks a catch-up marked absent, for
//   every sender the page sends for (§8.1); Practice sends every tick of a
//   catch-up (D-22), so its skipped stays 0;
// - Play again closes it and starts a new Practice with the same options,
//   contacting no one, as M3's PracticeGame.again does (Q-15).
// It opens no room and sets no fragment (D-22, P10). Phase 2's net-screens
// adds openNetMatch and asMatch here, over NetGame. New at M4.

import type { MatchNetSummary, Scoreboard, Session, TimelineStats } from '../core/session/index';
import type { MatchSettings, MatchState, Pack } from '../core/sim/index';
import { browserClock, type Clock } from './clock';
import type { Traffic } from './game';
import type { Match, MatchStatus, OwnFigures, PauseReason } from './match-types';
import { PracticeGame, type PracticeGameOptions } from './practice';

type Listener = Parameters<Match['subscribe']>[0];

/** What own() reads of the timeline held: src/core/timeline/timeline.ts's Timeline satisfies it. */
export interface OwnTimeline {
  readonly localTick: number;
  readonly stats: { readonly sent: number };
  /** This page plays: it sends its own input (PLAN §8). */
  readonly sending: boolean;
  /** The bots it hosts, each a sender. */
  readonly bots: { readonly size: number };
}

/** A slow page's figures (§8.1), counted after each timer run on the timeline held: the ticks its local
 *  tick moved, the TICKs sent, and, while it sends for anyone, the ticks a catch-up marked absent, the
 *  ticks moved less those sent, for every sender at once, so `senders` says how many inputs each
 *  stood for. Another timeline, a merge's or a rejoin's, starts from where it stands. */
export class OwnTally {
  private ticks = 0;
  private sent = 0;
  private skipped = 0;
  private senders = 0;
  private held: OwnTimeline | null = null;
  private local = 0;
  private sentBefore = 0;

  ran(t: OwnTimeline): void {
    const senders = (t.sending ? 1 : 0) + t.bots.size;
    if (t !== this.held) {
      this.held = t;
      this.local = t.localTick;
      this.sentBefore = t.stats.sent;
      this.senders = senders;
      return;
    }
    const moved = t.localTick - this.local;
    const sent = t.stats.sent - this.sentBefore;
    this.local = t.localTick;
    this.sentBefore = t.stats.sent;
    this.senders = senders;
    this.ticks += moved;
    this.sent += sent;
    if (senders > 0 && moved > sent) this.skipped += moved - sent;
  }

  figures(): OwnFigures {
    return { ticks: this.ticks, sent: this.sent, skipped: this.skipped, senders: this.senders };
  }
}

/** A copy of a timeline's stats, so a reader never holds the live object. */
function copied(s: Readonly<TimelineStats>): TimelineStats {
  return { ...s, lateBy: [...s.lateBy], resyncMs: [...s.resyncMs], log: s.log.map(([t, e]): [number, string] => [t, e]) };
}

class PracticeMatch implements Match {
  readonly kind = 'practice';
  readonly me: string;
  readonly matchId = null;
  readonly settings: MatchSettings;
  readonly clock: Clock;
  private readonly options: PracticeGameOptions;
  private readonly game: PracticeGame;
  private readonly listeners = new Set<Listener>();
  private readonly reasons = new Set<PauseReason>();
  private readonly tally = new OwnTally();
  private closedNow = false;

  constructor(o: PracticeGameOptions) {
    this.options = o;
    this.me = o.me;
    this.settings = o.settings;
    this.clock = o.clock ?? browserClock;
    this.game = new PracticeGame({
      ...o,
      onPause: (why) => {
        o.onPause?.(why);
        for (const l of [...this.listeners]) l.stalled?.(why);
      },
    });
    this.game.onRun = () => this.ran();
    this.game.onCorrection = (c) => {
      for (const l of [...this.listeners]) l.correction?.(c);
    };
    this.tally.ran(this.session.timeline);
  }

  /** PracticeGame.practice.session: Practice's never changes, but it's read each time, as a Match's is. */
  get session(): Session {
    return this.game.practice.session;
  }

  get scoreboard(): Scoreboard {
    return this.game.scoreboard;
  }

  /** While the menu, lost graphics, a stall or a hidden page holds it: the clock and the drawing stop. */
  get paused(): boolean {
    return this.game.paused;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  setControls(sample: (head: Readonly<MatchState>, headTick: number, tick: number) => number, rebase: (base: number) => void): void {
    const s = this.session;
    const d = this.game.practice.cfg.net.timeline.delay;
    this.game.controls = () => {
      const t = s.timeline;
      return sample(t.head, t.headTick, t.localTick + d);
    };
    // Practice adopts no state, so it never hands one (D-10); wired as a networked match's is.
    s.onControl = rebase;
  }

  ready(on: boolean): void {
    this.game.ready(on);
  }

  /** Swaps the person with the other pack's newest bot (D-22); nothing while it can't, a swap or a Ready
   *  on its way among the reasons (src/core/session/practice.ts). */
  switchPack(): void {
    this.game.switchPack();
  }

  canAddBot(_pack: Pack): boolean {
    return false;
  }

  addBot(_pack: Pack): boolean {
    return false;
  }

  removeBot(_pack: Pack): boolean {
    return false;
  }

  /** Practice plays in pack A from its start (Q-15). */
  play(_pack: Pack): void {}

  watch(): void {}

  pause(why: PauseReason): void {
    if (this.closedNow) return;
    this.reasons.add(why);
    this.game.pause();
  }

  resume(why: PauseReason): void {
    this.reasons.delete(why);
    if (this.reasons.size === 0 && !this.closedNow) this.game.resume();
  }

  status(): MatchStatus {
    const closed = this.closedNow;
    return {
      refusal: null, failed: false, abandoned: false, refused: null, switchRefused: false, returning: false,
      spectatorsFull: false, leaving: closed, closed, peers: 0, againSeen: false,
    };
  }

  own(): OwnFigures {
    return this.tally.figures();
  }

  summary(): MatchNetSummary {
    return this.game.summary();
  }

  stats(): TimelineStats {
    return copied(this.session.timeline.stats);
  }

  traffic(): Traffic | null {
    return null;
  }

  /** Practice has no one to tell: it closes (D-22). */
  leave(): void {
    this.close();
  }

  /** A new Practice with the same options, contacting no one (Q-15); this one closes. */
  playAgain(): Promise<Match> {
    this.close();
    return Promise.resolve(practiceMatch(this.options));
  }

  close(): void {
    if (this.closedNow) return;
    this.closedNow = true;
    this.game.close();
  }

  private ran(): void {
    this.tally.ran(this.session.timeline);
    for (const l of [...this.listeners]) l.run?.();
  }
}

/** Practice, started now: the person in pack A and bots in every other place (Q-15, D-22). */
export function practiceMatch(o: PracticeGameOptions): Match {
  return new PracticeMatch(o);
}

