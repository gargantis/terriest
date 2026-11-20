// One interface over PracticeGame and NetGame (M4's design,
// research/m4/DESIGN.md, §1.37; PLAN D-12, D-22, Q-15), which the screens,
// the view, the controls and the sound meet at. Its adapters are
// src/ui/match.ts's: Practice's from phase 1, the networked ones from
// phase 2. Nothing outside src/core writes a MatchState, calls step or
// calls a timeline's mutators but through NetGame, PracticeGame and these
// adapters (P11, D-27). Types only.

import type { Correction, MatchNetSummary, Refused, Scoreboard, Session, TimelineStats } from '../core/session/index';
import type { MatchSettings, MatchState, Pack } from '../core/sim/index';
import type { Clock } from './clock';
import type { Traffic } from './game';

/** Practice pauses while any reason holds (Q-15, D-30). */
export type PauseReason = 'menu' | 'graphics';

export interface MatchStatus {
  readonly refusal: number | null; readonly failed: boolean; readonly abandoned: boolean;
  readonly refused: Refused | null; readonly switchRefused: boolean; readonly returning: boolean;
  readonly spectatorsFull: boolean; readonly leaving: boolean; readonly closed: boolean;
  readonly peers: number; readonly againSeen: boolean;
}

/** What a slow page skipped (M4's design §8.1): since the match opened, the local ticks moved, the TICKs
 *  sent, and the ticks a catch-up marked absent, for each of `senders`, its own terrier if it plays and
 *  each bot it hosts. */
export interface OwnFigures { readonly ticks: number; readonly sent: number; readonly skipped: number; readonly senders: number }

export interface Match {
  readonly kind: 'practice' | 'net';
  readonly me: string;
  /** null in Practice, which never sets the fragment (D-22). */
  readonly matchId: string | null;
  readonly settings: MatchSettings;
  /** Read .timeline each time: a merge or a rejoin replaces it. */
  readonly session: Session;
  readonly scoreboard: Scoreboard;
  readonly clock: Clock;
  readonly paused: boolean;
  /** Timer runs, corrections, and Practice's own pauses (a stall or a hidden page, which open the menu). */
  subscribe(l: { run?: () => void; correction?: (c: Readonly<Correction>) => void; stalled?: (why: 'stall' | 'hidden') => void }): () => void;
  /** The sampler, called once a sent tick on the drawn head, with the tick its input is for, the
   *  timeline's local tick + d; and its rebase at onControl (D-10). */
  setControls(sample: (head: Readonly<MatchState>, headTick: number, tick: number) => number, rebase: (base: number) => void): void;
  ready(on: boolean): void;
  /** Practice: swap with the other pack's newest bot (D-22). */
  switchPack(): void;
  /** false in Practice. */
  canAddBot(pack: Pack): boolean; addBot(pack: Pack): boolean; removeBot(pack: Pack): boolean;
  /** Networked only; Practice plays in pack A from its start. */
  play(pack: Pack): void; watch(): void;
  /** Practice: paused while any reason holds; a networked match never pauses, and only releases the controls. */
  pause(why: PauseReason): void; resume(why: PauseReason): void;
  status(): MatchStatus;
  own(): OwnFigures;
  summary(): MatchNetSummary; stats(): TimelineStats;
  /** Networked only (src/ui/game.ts's). */
  traffic(): Traffic | null;
  /** Networked: LEAVE, the room closed leaveGraceMs later; Practice: closed. */
  leave(): void;
  /** D-12, Q-15. */
  playAgain(): Promise<Match>;
  close(): void;
}
