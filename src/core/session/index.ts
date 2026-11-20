// The session's public face for M4 (M3's design, research/m3/DESIGN.md,
// §1.39), as src/core/sim/index.ts is the simulation's: the types M4's
// screens, Results and match readout meet on src/ui/game.ts's NetGame and
// src/ui/practice.ts's PracticeGame, which hold a room's session, its bots
// and its scoreboard (D-14, D-21, D-39); and what M4's code calls itself:
// the build hash for the handshake (D-21, C-13), the settings in the
// session's units (PLAN §7.4), the match summary's figures and its one
// definition of a correction's size (M3-Q24, D-16), and the room peer and
// link a transport of its own, such as the frame bench's virtual peers,
// drives (design §1.8). The session's own rules stay inside it: the
// roster's questions, the bot host's timeline, Practice's settings and the
// timeline IDs Play again and Practice make. M4 widens it as its screens
// need, and nothing imports it before M4: M3's glue, the #test=net page,
// the tests and the correction measurement import the modules themselves.
// Re-exports only.

export { buildHash } from './build';
export { type NetSettings, netSettings, type RoomSettings, type TimelineSettings, type TransportSettings } from './settings';
export type { Accepted, Link, Refusal, RoomPeer } from './room-peer';
export { type AgainChoice, type DuplicateHello, type Refused, Session, type SessionConfig } from './session';
export type { BotHost, HostedBot } from './bots';
export { type ConfirmedEnd, type ConfirmedGoal, type ResultRow, type ScoreChanges, Scoreboard, type ScoreTimeline } from './scoreboard';
export {
  type BodyChange, type CorrectionFigures, type CorrectionSizes, correctionSizes, type MatchNetSummary, type Quantiles, type RepairFigures,
} from './summary';
export { type PracticeConfig, type PracticeRun, PracticeSession } from './practice';
