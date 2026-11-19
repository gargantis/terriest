// Practice in this tab (PLAN D-22, D-31, Q-15, P10; M3's design,
// research/m3/DESIGN.md, §1.25, M3-Q5): a PracticeSession over the local
// transport on the glue's timer, never animation frames (D-31), the
// scoreboard updated after each timer run (D-14), the match's summary, and
// Q-15's pauses: the menu's, and a stall's or a hidden page's, which open
// the menu through onPause; onRun after each timer run and onCorrection
// for each correction, as NetGame has them (§1.24), for the #test=net
// page's Ready and M4's drawing. It imports neither src/ui/game.ts nor
// src/net/trystero.ts, so Practice never loads Trystero and contacts no one
// (L158, L238, P10), which src/ui/practice.test.ts checks over its static
// import graph. M3 builds it without screens; M4 adds them, and the pause
// while the graphics are lost (D-30). New at M3.

import { defaultBotParams } from '../core/bot/brain';
import { PracticeSession } from '../core/session/practice';
import { Scoreboard } from '../core/session/scoreboard';
import { type NetSettings, netSettings } from '../core/session/settings';
import { type MatchNetSummary, SummaryBuilder } from '../core/session/summary';
import { defaultParams, type MatchSettings } from '../core/sim/index';
import type { Correction } from '../core/timeline/timeline';
import { LocalTransport } from '../net/local';
import { browserClock, browserPage, type Clock, type PageEvents } from './clock';

export interface PracticeGameOptions {
  readonly me: string;
  readonly name: string;
  readonly coat: number;
  readonly settings: MatchSettings;
  readonly build: string;
  /** netSettings() by default; Practice runs it under practiceSettings (D-22). */
  readonly net?: NetSettings;
  readonly clock?: Clock;
  readonly page?: PageEvents;
  /** The menu opens: a stall or a hidden page paused Practice (Q-15). */
  readonly onPause?: (why: 'stall' | 'hidden') => void;
  /** Tests: the chain's checks (§2.7), as NetGameOptions' verify. */
  readonly verify?: number;
}

const TICK_COSTS_KEPT = 50_000; // not a setting: the samples kept, as roslambo's game kept them

export class PracticeGame {
  readonly practice: PracticeSession;
  readonly scoreboard: Scoreboard;
  /** Practice's transport: each message offered is counted and dropped, and no peer is ever held (P10). */
  readonly transport: LocalTransport;
  /** ms per timer run that moved the clock, as NetGame keeps them: the page's cpu figure (design §7.4). */
  readonly tickCosts: number[] = [];
  /** Each correction, once the summary has its sizes: M4's drawing (D-16), as NetGame's. */
  onCorrection: ((c: Correction) => void) | null = null;
  /** After each timer run's advance, paused or not: where the #test=net page presses Ready at its tick
   *  (design §7.2), as NetGame's onRun, and M4's screens look again. */
  onRun: (() => void) | null = null;
  private readonly o: PracticeGameOptions;
  private readonly clock: Clock;
  private readonly page: PageEvents;
  private readonly corrections: SummaryBuilder;
  private readonly stopTimer: () => void;
  private readonly stopListening: () => void;
  private sample: () => number = () => 0;
  private closed = false;

  /** Starts Practice now, with the person in the first pack and bots in every other place (Q-15). */
  constructor(o: PracticeGameOptions) {
    this.o = o;
    this.clock = o.clock ?? browserClock;
    this.page = o.page ?? browserPage;
    const P = defaultParams;
    this.transport = new LocalTransport();
    this.practice = new PracticeSession(
      {
        P, B: defaultBotParams, net: o.net ?? netSettings(), me: o.me, name: o.name, coat: o.coat, settings: o.settings, build: o.build,
        ...(o.verify !== undefined ? { verify: o.verify } : {}),
      },
      this.transport,
    );
    this.scoreboard = new Scoreboard(P);
    this.corrections = new SummaryBuilder(o.me);
    this.practice.session.timeline.onCorrection = (c) => {
      this.corrections.add(c);
      this.onCorrection?.(c);
    };
    this.practice.start(this.clock.now());
    this.stopTimer = this.clock.every(this.practice.cfg.net.timerMs, () => this.run());
    this.stopListening = this.page.onVisibility(() => this.visibility());
  }

  /** The menu's pause or a stall's (Q-15). */
  get paused(): boolean {
    return this.practice.paused;
  }

  /** The menu opens (Q-15): play and the clock stop, and with them what's drawn from the state. */
  pause(): void {
    if (!this.closed) this.practice.pause(this.clock.now());
  }

  /** Resume, or the menu closes (Q-15). On a hidden page the next timer run pauses it again. */
  resume(): void {
    if (!this.closed) this.practice.resume(this.clock.now());
  }

  ready(on: boolean): void {
    this.practice.ready(on);
  }

  /** Swaps the person with the other pack's newest bot, in one tick (Q-15, D-22). */
  switchPack(): boolean {
    return this.practice.switchPack();
  }

  /** This browser's own input, sampled once a sent tick; again() passes it on. */
  set controls(sample: () => number) {
    this.sample = sample;
    this.practice.controls = sample;
  }

  /** The match's network summary (design §1.16): a lone timeline's, so no late input or resync. */
  summary(): MatchNetSummary {
    return this.corrections.summary(this.practice.session.timeline.stats);
  }

  /** Play again (Q-15): this one closed, and a new Practice with the same options, contacting no one.
   *  The controls go on to it; a sampler that reads this one's timeline is to be set again, and
   *  onRun and onCorrection, as NetGame's playAgain leaves them, are the new one's to set. */
  again(): PracticeGame {
    this.close();
    const g = new PracticeGame(this.o);
    g.controls = this.sample;
    return g;
  }

  /** Its timer and its listener stop. Nothing to tell anyone: a reload goes Home (D-22). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopTimer();
    this.stopListening();
    void this.transport.leave();
  }

  /** One timer run (D-31). A page found hidden pauses first, as hiding does, in case its
   *  visibilitychange is still to come. */
  private run(): void {
    if (this.closed) return;
    const now = this.clock.now();
    if (!this.practice.paused && this.page.hidden()) {
      this.hidden(now);
      return;
    }
    const t = this.practice.session.timeline;
    const before = t.localTick;
    if (this.practice.advance(now) === 'stalled') this.o.onPause?.('stall');
    if (t.localTick !== before && this.tickCosts.length < TICK_COSTS_KEPT) this.tickCosts.push(this.clock.now() - now);
    this.scoreboard.update(t);
    this.onRun?.();
  }

  /** Hiding the tab opens the menu (Q-15); showing it again leaves it open. */
  private visibility(): void {
    if (!this.closed && !this.practice.paused && this.page.hidden()) this.hidden(this.clock.now());
  }

  private hidden(now: number): void {
    this.practice.pause(now);
    this.o.onPause?.('hidden');
  }
}
