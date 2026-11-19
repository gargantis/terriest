// The #test=net page (M3's design, research/m3/DESIGN.md, §1.27, §7; PLAN
// §16's "M3's #test=net match", §17's M3): matches without the screens,
// over the real Trystero transport or Practice's local one, for
// e2e/match.net.spec.ts, e2e/nettest.spec.ts and e2e/practice-net.spec.ts,
// the load run and the owner's desktop check. A chunk of its own, which
// src/main.ts loads for #test=net alone: it makes no WebGL context and
// draws nothing. roslambo's src/nettest.ts, with the design's changes:
// - its parameters by parseNetParams (src/nettest-params.ts, §7.2): a
//   missing or bad room, no relay, or a relay this build doesn't take
//   (§6.7) shows its message, and the page contacts nothing. A dev build
//   given no relay takes npm run dev:local's (src/net/dev-relay.ts, loaded
//   only under import.meta.env.DEV, so a production build never has it);
// - mode=net through NetGame.open (src/ui/game.ts) with the relay and the
//   ICE: the keeper proposes genesis; the page plays in its pack or
//   watches, hosts its bots and presses Ready; a fifth spectator leaves the
//   room, as NetGame does (§4.5). mode=practice through PracticeGame
//   (src/ui/practice.ts), which never requests the Trystero chunk (P10);
// - the page's own input, a script of src/core/bot/setups.ts, sampled once
//   a sent tick on the timeline's head as it stands then, and made again
//   from the base whenever onControl hands one, so a page that reloads
//   presses nothing on return (D-10, §4.6);
// - Ready in the game's onRun, at the first timer run whose local tick is
//   at or past `ready` with this page's terrier in the final roster, as
//   src/net/setups-testing.ts's replay presses it (§8.1), in both modes;
// - no canary at M3 and no goldens.json, which stay the determinism page's
//   (§7.3, R-15);
// - a main landmark, id="net", with the heading "Network test" and a
//   status <pre> refreshed every 500 ms for a person to read, and
//   boot.started() once it shows (D-30);
// - window.terriestTest.net (§7.4, M3-Q7), added once the match is open,
//   and only when a spec set window.terriestTest before load: a normal page
//   never has the object, and never loads this chunk.

import { BUILD_INPUTS } from './build-info';
import { config } from './config';
import { defaultBotParams } from './core/bot/brain';
import { scriptSampler } from './core/bot/setups';
import { formatMatchId } from './core/match-id';
import { REFUSAL } from './core/protocol/messages';
import { buildHash } from './core/session/build';
import type { Scoreboard } from './core/session/scoreboard';
import type { Session } from './core/session/session';
import type { MatchNetSummary } from './core/session/summary';
import { defaultParams, type MatchSettings } from './core/sim/index';
import type { TimelineStats } from './core/timeline/timeline';
import type { Boot } from './main';
import { type NetHook, type NetParams, type NetReport, parseNetParams } from './nettest-params';
import { NetGame, type Traffic, type TrafficCount } from './ui/game';
import { PracticeGame } from './ui/practice';

const P = defaultParams;
const B = defaultBotParams;
const STATUS_EVERY_MS = 500; // not a setting: the status's refresh, for a person to read (§7.1)
const P95 = 0.95; // not a setting: the cpu figure's percentile, roslambo's
const PHASES = ['warm-up', 'start countdown', 'kickoff countdown', 'in play', 'celebration', 'ended']; // not a setting: A.1's phases
const PACKS = ['A', 'B']; // not a setting: the packs' names
const MONO = 'white-space: pre-wrap; font: 0.9em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** What the report and the status read of the match, in either mode. */
interface Match {
  readonly session: Session;
  readonly scoreboard: Scoreboard;
  readonly tickCosts: readonly number[];
  /** Where it plays: the relay and the ICE, or the local transport. */
  readonly where: string;
  stats(): Readonly<TimelineStats>;
  summary(): MatchNetSummary;
  arrivedTick(): number;
  peers(): number;
  refusedBy(): number | null;
  traffic(): Traffic;
  spectatorsFull(): boolean;
  abandoned(): boolean;
  failed(): boolean;
  /** Practice's pause, why, for the status; null while it runs. */
  paused(): string | null;
  /** What the page couldn't do as its parameters asked, for the status. */
  readonly notes: readonly string[];
}

/** Shows the page, tells boot.js the app has started, and opens the match the fragment names, or says
 *  why not and contacts nothing. */
export function run(boot: Boot): void {
  const main = document.createElement('main');
  main.id = 'net';
  main.style.cssText = 'max-width: 48rem; padding: 1rem 1.5rem';
  const heading = document.createElement('h1');
  heading.textContent = 'Network test';
  const out = document.createElement('pre');
  out.style.cssText = MONO;
  main.append(heading, out);
  document.body.append(main);
  // The loading message goes, so one main landmark shows (D-30).
  boot.started();
  const p = parseNetParams(location.hash, import.meta.env.DEV);
  if ('error' in p) {
    refuse(out, p.error);
    return;
  }
  out.textContent = p.mode === 'practice' ? 'Starting Practice…' : `Opening room ${formatMatchId(p.room ?? '')}…`;
  void open(p, out).catch((e: unknown) => {
    out.textContent = `The network test stopped: ${e instanceof Error ? e.message : String(e)}`;
    // The page's own error, which the end-to-end guard fails (§16's "Everywhere").
    throw e;
  });
}

/** The page's message when it won't start: what's wrong, and that it contacted nothing. */
function refuse(out: HTMLElement, error: string): void {
  out.textContent = `The network test didn't start, and contacted nothing: ${error}.`;
}

/** The match: NetGame's in a room, or PracticeGame's; then the hook and the status. */
async function open(p: NetParams, out: HTMLElement): Promise<void> {
  const build = buildHash(config, BUILD_INPUTS);
  const settings: MatchSettings = { packSize: p.packSize, matchMinutes: p.minutes };
  let match: Match;
  if (p.mode === 'practice') {
    match = practice(p, build, settings);
  } else {
    let relay = p.relay;
    if (import.meta.env.DEV) {
      if (relay === null) relay = (await import('./net/dev-relay')).devRelay(location.hostname);
    }
    if (relay === null) {
      refuse(out, "relay: none given, and this dev server isn't npm run dev:local's, which has one");
      return;
    }
    match = await networked(p, build, settings, relay);
  }
  const test = window.terriestTest;
  if (test) {
    const hook: NetHook = { report: () => report(p, build, match), hashAt: (t) => match.session.timeline.hashAt(t) };
    test.net = hook;
  }
  const show = (): void => {
    out.textContent = status(p, match, report(p, build, match));
  };
  show();
  setInterval(show, STATUS_EVERY_MS);
}

/** The page's own input from its script, sampled on the timeline the session holds as it stands at
 *  each sent tick, and the sampler made again from the base onControl hands (D-10, §4.6). */
function controlled(p: NetParams, session: Session): { sample: () => number; rebase: (base: number) => void } {
  let script = scriptSampler(p.script, p.me, 0, P, B);
  return {
    sample: () => {
      const t = session.timeline;
      return script(t.head, t.headTick);
    },
    rebase: (base) => {
      script = scriptSampler(p.script, p.me, base, P, B);
    },
  };
}

/** Ready, once, at the first timer run whose local tick is at or past p.ready with this page's
 *  terrier in the final roster (§7.2, as src/net/setups-testing.ts's Page presses it). */
function readyAtTick(p: NetParams, session: Session, press: () => void): () => void {
  let pressed = false;
  return () => {
    if (pressed || p.ready === null) return;
    if (session.timeline.localTick >= p.ready && session.inRoster()) {
      pressed = true;
      press();
    }
  };
}

/** mode=net (§7.3): the room, then the keeper's genesis, the page's pack or watching, and its bots. */
async function networked(p: NetParams, build: string, settings: MatchSettings, relay: string): Promise<Match> {
  if (p.room === null) throw new Error('a networked page needs a room');
  const game = await NetGame.open({ matchId: p.room, me: p.me, name: p.name, coat: p.coat, build, relays: [relay], ice: p.ice });
  const input = controlled(p, game.session);
  game.controls = input.sample;
  game.onControl = input.rebase;
  game.onRun = readyAtTick(p, game.session, () => game.ready(true));
  if (p.role === 'keeper') game.propose(settings);
  if (p.pack !== null) game.play(p.pack);
  else game.watch();
  const unplaced = p.bots.filter((pack) => !game.addBot(pack));
  return {
    notes: unplaced.map((pack) => `no place for a bot in pack ${PACKS[pack]}`),
    session: game.session,
    scoreboard: game.scoreboard,
    tickCosts: game.tickCosts,
    where: `relay ${relay}, ICE ${p.ice}`,
    stats: () => game.stats(),
    summary: () => game.summary(),
    arrivedTick: () => game.arrivedTick,
    peers: () => game.peers(),
    refusedBy: () => game.refusedBy,
    traffic: () => copied(game.traffic),
    spectatorsFull: () => game.session.spectatorsFull || game.refusal() === REFUSAL.SPECTATORS_FULL,
    abandoned: () => game.abandoned(),
    failed: () => game.failed(),
    paused: () => null,
  };
}

/** mode=practice (§7.3): the person in pack A, bots in every other place, over the local transport. */
function practice(p: NetParams, build: string, settings: MatchSettings): Match {
  let why: string | null = null;
  const game = new PracticeGame({
    me: p.me, name: p.name, coat: p.coat, settings, build,
    onPause: (w) => {
      why = w;
    },
  });
  const session = game.practice.session;
  const input = controlled(p, session);
  game.controls = input.sample;
  session.onControl = input.rebase;
  game.onRun = readyAtTick(p, session, () => game.ready(true));
  // Nothing leaves the page: the local transport drops what it's offered (P10).
  const none: Traffic = { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0, byType: {} };
  return {
    notes: [],
    session,
    scoreboard: game.scoreboard,
    tickCosts: game.tickCosts,
    where: 'the local transport: nothing leaves this page (P10)',
    stats: () => session.timeline.stats,
    summary: () => game.summary(),
    arrivedTick: () => (session.timeline.started ? 0 : -1),
    peers: () => 0,
    refusedBy: () => game.transport.refusedBy,
    traffic: () => copied(none),
    spectatorsFull: () => false,
    abandoned: () => session.abandoned(performance.now()),
    failed: () => session.failed(performance.now()),
    paused: () => (game.paused ? (why ?? 'paused') : null),
  };
}

/** A copy of the live traffic counts (§1.24). */
function copied(t: Readonly<Traffic>): Traffic {
  const byType: Record<number, TrafficCount> = {};
  for (const [type, row] of Object.entries(t.byType)) byType[Number(type)] = { ...row };
  return { sent: t.sent, received: t.received, sentBytes: t.sentBytes, receivedBytes: t.receivedBytes, byType };
}

/** ms per timer run that moved the clock: mean, p95 and max, as roslambo's page reported them. */
function cpuOf(costs: readonly number[]): NetReport['cpu'] {
  if (costs.length === 0) return null;
  const sorted = [...costs].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { mean, p95: sorted[Math.floor(sorted.length * P95)]!, max: sorted[sorted.length - 1]! };
}

/** window.__rtcCount, which e2e/lib/browsers.ts's countPeerConnections keeps, or null. */
function rtcConnections(): number | null {
  const n = (window as unknown as { __rtcCount?: unknown }).__rtcCount;
  return typeof n === 'number' ? n : null;
}

/** NetReport (§7.4), from the sources M3's phase 4 names: the game's stats, summary, arrival, peers,
 *  refusals and tick costs, a copy of its traffic, and the session's timeline and scoreboard. */
function report(p: NetParams, build: string, m: Match): NetReport {
  const s = m.session;
  const t = s.timeline;
  const F = t.final;
  const all = m.stats();
  const stats: NetReport['stats'] & Partial<Pick<TimelineStats, 'log' | 'resyncMs'>> = {
    ...all, lateBy: [...all.lateBy], resyncMsMax: all.resyncMs.reduce((a, b) => Math.max(a, b), 0),
  };
  delete stats.log;
  delete stats.resyncMs;
  const e = m.scoreboard.end;
  return {
    me: p.me, role: p.role, mode: p.mode, build,
    started: t.started, timeline: t.id, localTick: t.localTick, finalTick: t.finalTick, headTick: t.headTick,
    phase: F.phase, phaseStart: F.phaseStart, overtime: F.overtime, clock: F.clock, score: [F.score[0], F.score[1]],
    roster: F.terriers.map((T) => ({
      id: T.id, pack: T.pack, spot: T.spot, sitting: T.sitting, lastInputTick: T.lastInputTick, goals: T.goals, touches: T.touches,
    })),
    goals: m.scoreboard.goals.map((g) => ({ tick: g.tick, pack: g.pack, ownGoal: g.ownGoal, scorers: [...g.scorers] })),
    end: e === null ? null : { tick: e.tick, score: [e.score[0], e.score[1]], winner: e.winner, rows: e.rows.map((r) => ({ ...r })) },
    arrivedTick: m.arrivedTick(),
    peers: m.peers(),
    refused: s.refused,
    refusedBy: m.refusedBy(),
    returning: s.returning,
    spectatorsFull: m.spectatorsFull(),
    abandoned: m.abandoned(),
    failed: m.failed(),
    stall: s.stall,
    stats,
    summary: m.summary(),
    duplicates: s.duplicates.map((d) => ({ ...d })),
    cpu: cpuOf(m.tickCosts),
    traffic: m.traffic(),
    rtcConnections: rtcConnections(),
  };
}

/** A clock of ticks as m:ss, whole seconds rounded up, as a match clock shows it. */
function clockText(ticks: number): string {
  const seconds = Math.ceil(ticks / config.ticksPerSecond);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The status, for a person to read (§7.1). */
function status(p: NetParams, m: Match, r: NetReport): string {
  const short = (id: string): string => `${id.slice(0, 4)}…${id.slice(-4)}`;
  const names = new Map(m.session.timeline.final.terriers.map((T) => [T.id, T.name]));
  const who = (id: string): string => `${names.get(id) ?? '?'} (${short(id)})`;
  const lines = [
    `${p.mode === 'practice' ? 'Practice' : `Room ${formatMatchId(p.room ?? '')}`}: ${p.name} (${short(p.me)}), k ${p.k} of seed ${p.seed}, ${p.role}` +
      `${p.pack === null ? '' : ` in pack ${PACKS[p.pack]}`}, script ${p.script}${p.ready === null ? '' : `, Ready at tick ${p.ready}`}`,
    `${m.where}; build ${r.build}; ${r.peers} ${r.peers === 1 ? 'peer' : 'peers'}`,
  ];
  if (!r.started) {
    lines.push(r.failed ? 'No match: nobody holding one answered (PLAN §8).' : 'Waiting for the match…');
  } else {
    lines.push(
      `Timeline ${r.timeline}, held from tick ${r.arrivedTick}; ticks: local ${r.localTick}, final ${r.finalTick}, drawn ${r.headTick}`,
      `${PHASES[r.phase] ?? r.phase}${r.overtime ? ', overtime' : ''} since tick ${r.phaseStart}; clock ${clockText(r.clock)}; score ${r.score.join('–')}`,
      ...r.roster.map(
        (T) =>
          `  ${PACKS[T.pack]}${T.spot + 1} ${who(T.id)}: ${T.goals} ${T.goals === 1 ? 'goal' : 'goals'}, ${T.touches} touches, ` +
          `last input ${T.lastInputTick}${T.sitting ? ', sitting' : ''}`,
      ),
      `Goals confirmed: ${r.goals.length === 0 ? 'none' : r.goals.map((g) => `${PACKS[g.pack]} at ${g.tick}${g.ownGoal ? ' (own goal)' : ''}`).join(', ')}`,
    );
    // A whole second's final tick, so two windows show the same tick's state to compare by eye.
    const at = r.finalTick - (r.finalTick % config.ticksPerSecond);
    lines.push(`State at final tick ${at}: ${m.session.timeline.hashAt(at) || 'not held'}`);
    if (r.end !== null) {
      const best = r.end.rows.filter((row) => row.terriest).map((row) => row.name);
      lines.push(`Ended at tick ${r.end.tick}: ${r.end.score.join('–')}, ${r.end.winner === null ? 'a draw' : `pack ${PACKS[r.end.winner]} won`}; Terriest: ${best.join(', ') || 'none'}`);
    }
  }
  const st = r.stats;
  lines.push(
    `Late inputs ${st.late}, and ${st.lateAbsent} for ticks already final without them; disagreements ${st.disagree}, resyncs ${st.resyncs} ` +
      `(${st.resyncFailed} failed), rollbacks ${st.rollbacks}, most steps in an advance ${st.maxStepsPerAdvance}, clock jumps ${st.jumps}`,
    `Sent ${r.traffic.sent} messages (${r.traffic.sentBytes} bytes), received ${r.traffic.received} (${r.traffic.receivedBytes} bytes)` +
      `${r.cpu === null ? '' : `; a timer run's cost ${r.cpu.mean.toFixed(2)} ms on average, ${r.cpu.max.toFixed(1)} at most`}`,
  );
  const notes = [
    r.refused !== null ? `refused a place: ${r.refused}` : '',
    r.refusedBy !== null ? `a peer refused this page: reason ${r.refusedBy}` : '',
    r.spectatorsFull ? `the room had ${config.spectatorsMax} spectators: this page left it (§4.5)` : '',
    r.returning ? 'took its terrier back on return (D-17)' : '',
    r.abandoned ? 'abandoned: no browser controls a terrier (Q-16)' : '',
    r.stall !== 'none' ? `stalled: ${r.stall}` : '',
    m.paused() !== null ? `paused: ${m.paused()}` : '',
    ...m.notes,
  ].filter((n) => n !== '');
  if (notes.length > 0) lines.push(`This page: ${notes.join('; ')}.`);
  return lines.join('\n');
}
