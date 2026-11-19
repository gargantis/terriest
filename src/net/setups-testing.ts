// R-7's replay of §16's three-engine setup over the loopback network (M3's
// design, research/m3/DESIGN.md, §8.1, §8.4, R-7; PLAN §16), for
// bots-setups.test.ts and bots-setups-1 to -6, split so that no file runs
// much over 8 s alone, as the marks' are (design §13). Played as §8.4 has
// e2e/match.net.spec.ts play it through the #test=net page (design §7.2):
// page k is personId(seed, k); the keeper, Chromium's page, proposes 1
// minute at pack size 2 and plays in pack A with script=back, hosting pack
// A's bot; Firefox's and WebKit's pages, opened 0.3 s apart after it, play
// in pack B with script=none; each presses Ready at the first timer run
// whose local tick is at or past the Ready tick with its terrier in the
// final roster (ready=600 in the spec); a fourth page joins as a spectator
// once the keeper's final state is in play with under 50 s on the clock,
// and WebKit's page reloads once it's under 35 s, each with no celebration
// under way, away for 0.5, 2 or 5 s. Links of 30 to 60 ms one way, with
// 20 ms of jitter. The keeper's node verifies its chain at 8 (design §8.3).
// Test support: only those tests import it, so no build bundles it.

import { expect } from 'vitest';
import { botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { ROLE } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, ENDED, findTerrier, IN_PLAY, type MatchState, type Pack, START_COUNTDOWN } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const MATCH = 'e7e7e7e7e7e7e7e7'; // not a setting: a timeline ID, which no state holds
const SPECTATOR_UNDER_SECONDS = 50; // not a setting: §8.4's trigger, on the clock
const RELOAD_UNDER_SECONDS = 35; // not a setting: §8.4's trigger, on the clock
const IN_CONTROL_TICKS = 30; // not a setting: §8.4's check, the reloaded terrier's last input before the end

/** The spec's Ready tick (design §8.4). */
export const SPEC_READY = 600; // not a setting: e2e/match.net.spec.ts's ready=600
/** The reload's absences, ms (design §8.1). */
export const ABSENCES = [500, 2000, 5000] as const; // not a setting: §8.1's 0.5, 2 and 5 s

/** A page as the #test=net page drives its session (design §1.24, §7.2): a gap over stallMs between
 *  timer runs is a stall; it presses Ready at the first timer run whose local tick is at or past
 *  readyAt with its terrier in the final roster; and the test looks after each timer run. */
class Page extends Session {
  readyAt: number | null = null;
  after: (() => void) | null = null;
  private pressed = false;
  private last = -1;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
    if (this.readyAt !== null && !this.pressed && this.timeline.localTick >= this.readyAt && this.inRoster()) {
      this.pressed = true;
      this.ready(true);
    }
    this.after?.();
  }
}

type Node = LoopNode<Page>;

/** Links of lo to hi ms one way, fixed per pair, with jitter. */
function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

/** One run of the setup, as the keeper's final state had it. */
export interface Outcome {
  readonly seed: number;
  readonly ready: number; // the Ready tick
  readonly absence: number; // ms the reloading page was away
  readonly score: readonly [number, number];
  readonly overtime: boolean;
  readonly countdownTick: number; // the start countdown's first tick
  readonly endTick: number;
  readonly firstGoalTick: number;
  readonly firstGoalPlayTicks: number; // ticks of play before it
  readonly spectatorClock: number; // ticks on the clock when the spectator joined
  readonly reloadClock: number; // and when WebKit's page left
}

/** §8.4's setup for a seed, a Ready tick and the reload's absence, played until every page holds the
 *  confirmed end: every page at one end with one score, agreeing; the reloaded page back in its
 *  terrier and in control by the end; the spectator watching; the roster the setup's. */
export function playSetup(seed: number, ready: number, absence: number): Outcome {
  const room = new NetPump(new LoopbackNet(seed, uniform(seed * 31 + 7, 30, 60, 20)));
  const net = room.net;
  const page = (k: number, script: ScriptName, nodeId = `n${k}`, verify = 0): Node =>
    net.add(
      nodeId,
      room.peer(
        (link, mode) => {
          const me = personId(seed, k);
          const cfg: SessionConfig = { P, B, net: NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify };
          const s = new Page(cfg, link);
          let sample = scriptSampler(script, me, 0, P, B);
          s.controls = () => sample(s.timeline.head, s.timeline.headTick);
          s.onControl = (base) => {
            sample = scriptSampler(script, me, base, P, B);
          };
          return s;
        },
        (s) => ({ t: s.timeline, host: s.bots }),
      ),
    );
  const keeper = page(0, 'back', 'n0', 8);
  const firefox = page(1, 'none');
  const webkit = page(2, 'none');
  const spectator = page(3, 'none');
  const back = page(2, 'none', 'n2-back');
  for (const n of [keeper, firefox, webkit, back]) n.session.readyAt = ready;
  net.join(keeper, 0, (now) => {
    keeper.session.propose(keeper.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
    keeper.session.play(0);
    expect(keeper.session.addBot(0)).toBe(true);
  });
  net.join(firefox, 300, () => firefox.session.play(1));
  net.join(webkit, 600, () => webkit.session.play(1));
  // The triggers and the first goal, from the keeper's final state after each of its timer runs.
  const seen = { spectatorClock: -1, reloadClock: -1, countdownTick: -1, firstGoalTick: -1 };
  const tps = P.config.ticksPerSecond;
  keeper.session.after = () => {
    const s = keeper.session.timeline.final;
    if (seen.countdownTick < 0 && s.phase === START_COUNTDOWN) seen.countdownTick = s.phaseStart;
    if (seen.firstGoalTick < 0 && s.score[0] + s.score[1] > 0) seen.firstGoalTick = s.lastGoalTick;
    if (s.phase !== IN_PLAY) return;
    if (seen.spectatorClock < 0 && s.clock < SPECTATOR_UNDER_SECONDS * tps) {
      seen.spectatorClock = s.clock;
      net.join(spectator, net.now, () => spectator.session.watch());
    }
    if (seen.reloadClock < 0 && s.clock < RELOAD_UNDER_SECONDS * tps) {
      seen.reloadClock = s.clock;
      net.leave(webkit, net.now);
      net.join(back, net.now + absence);
    }
  };
  const pages = [keeper, firefox, spectator, back];
  const F = (n: Node): Readonly<MatchState> => n.session.timeline.final;
  const ended = (n: Node): boolean => F(n).phase === ENDED && n.session.timeline.isConfirmed(F(n).phaseStart);
  room.run(400_000, () => seen.reloadClock >= 0 && pages.every(ended));
  const label = `seed ${seed}, Ready at ${ready}, away ${absence} ms`;
  for (const n of pages) expect(ended(n), `${label}: ${n.id} ${F(n).phase}`).toBe(true);
  expect(room.problems, label).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `${label}: node ${n.k}`).toBe(0);
  expectAgreement(pages.map((n) => ({ t: n.session.timeline })));
  const end = F(keeper).phaseStart;
  for (const n of pages) expect([F(n).phaseStart, F(n).score.join(':')], `${label}: ${n.id}`).toEqual([end, F(keeper).score.join(':')]);
  const me = personId(seed, 2);
  expect([back.session.returning, back.session.inRoster()], label).toEqual([true, true]);
  for (const n of pages) expect(end - F(n).terriers[findTerrier(F(n), me)]!.lastInputTick, `${label}: ${n.id}`).toBeLessThan(IN_CONTROL_TICKS);
  expect([spectator.session.role(), spectator.session.inRoster()], label).toEqual([ROLE.SPECTATOR, false]);
  const roster: [string, Pack][] = [[personId(seed, 0), 0], [botIds(personId(seed, 0))[0]!, 0], [personId(seed, 1), 1], [me, 1]];
  expect(F(keeper).terriers.map((T): [string, Pack] => [T.id, T.pack]).sort(), label).toEqual(roster.sort());
  const s = F(keeper);
  const playFrom = seen.countdownTick + P.startCountdownTicks;
  return {
    seed, ready, absence, score: [s.score[0], s.score[1]], overtime: s.overtime, countdownTick: seen.countdownTick, endTick: end,
    firstGoalTick: seen.firstGoalTick, firstGoalPlayTicks: seen.firstGoalTick - playFrom,
    spectatorClock: seen.spectatorClock, reloadClock: seen.reloadClock,
  };
}

/** The run ended at 0:00 with the bot's pack, A, ahead: no overtime, a goal for A, not level (§16). */
export function expectDecisive(r: Outcome): void {
  expect([r.overtime, r.score[0] > r.score[1], r.firstGoalTick >= 0, r.spectatorClock >= 0, r.reloadClock >= 0], JSON.stringify(r)).toEqual([
    false, true, true, true, true,
  ]);
}

/** Prints the slowest first goal and the latest end of these runs, for e2e/match.net.spec.ts's
 *  timeout (design §8.1): the play before the goal, and the ticks from genesis to it and to the end,
 *  as seconds. */
export function printSlowest(file: string, runs: readonly Outcome[]): void {
  if (runs.length === 0) return; // every run failed: its own failure says why
  const tps = P.config.ticksPerSecond;
  const goal = runs.reduce((a, b) => (b.firstGoalPlayTicks > a.firstGoalPlayTicks ? b : a));
  const last = runs.reduce((a, b) => (b.endTick > a.endTick ? b : a));
  console.log(
    `${file}: the slowest first goal came after ${(goal.firstGoalPlayTicks / tps).toFixed(1)} s of play, ${(goal.firstGoalTick / tps).toFixed(1)} s from genesis (seed ${goal.seed}); ` +
      `the latest end, ${(last.endTick / tps).toFixed(1)} s from genesis (seed ${last.seed}), scores ${runs.map((r) => r.score.join('–')).join(', ')}`,
  );
}
