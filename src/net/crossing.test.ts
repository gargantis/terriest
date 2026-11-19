import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { T } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, IN_PLAY, type MatchState } from '../core/sim/index';
import { NetPump, oldest, spoil, TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { LoopbackNet, type LoopNode } from './loopback';

// Two voters whose resyncs cross (PLAN C-10, D-13, D-31; M3's design,
// research/m3/DESIGN.md, §3.2, §3.4, §3.6): at 1 a side every disagreement
// is a tie the smaller hash wins, tick by tick, and a page that loses one
// keeps voting its lineage until it knows. consensus.test.ts plays the
// dissenter that learns in time, at 30 and 80 ms. Here it learns late, from
// a late vote's re-tally: over links of 200 ms one way, past the tally's v
// ticks; with the winner's TICK carrying its vote held 250 ms; with the
// design's dropped input held 500 ms; and with one page hidden, its timers
// a second apart (D-31). The winner then could lose a tie to one of the
// loser's stale votes, ask a loser that, resyncing, answers nothing, and
// refuse the loser's own ask meanwhile, so both resyncs failed, again at
// each divergence, and from about 190 ms the pair never agreed again (M3
// phase 4's review). A split re-tally sees its losers lose as a tally does,
// and of two resyncs that cross, each asking the other, the one for the
// earlier tick is answered (M3 phase 4's integration): every seed ends with
// one page's resync completed, never both failing, each failing at most
// once (§3.6's spurious loss, paid for with one failed resync), and every
// hash equal from the last repair on.

// Matches in virtual time: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const B = defaultBotParams;
const P = defaultParams;
const W = NET.timeline.window;
const V = NET.timeline.voteWindow;
const MATCH = '7a07a07a07a07a07';
const SEEDS = 8;

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall.
 *  It notes the tick of each STATE a resync of its timeline takes. */
class GameSession extends Session {
  readonly states: number[] = [];
  /** What the test does right after a timer run. */
  after: (() => void) | null = null;
  private last = -1;
  private watched: Timeline | null = null;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
    const t = this.timeline;
    if (t !== this.watched) this.observe(t);
    this.after?.();
  }

  private observe(t: Timeline): void {
    this.watched = t;
    const take = t.onState.bind(t);
    t.onState = (peer, m, oneWayMs, now) => {
      const repair = t.started;
      const ok = take(peer, m, oneWayMs, now);
      if (ok && repair) this.states.push(m.g);
      return ok;
    };
  }
}

type Node = LoopNode<GameSession>;
type Room = NetPump<LoopbackNet>;

/** Player me's session as node n<k>, named P<k>, its terrier driven by a script on its head, made
 *  again from each base onControl hands it (D-10). */
function node(room: Room, k: number, me: string, script: ScriptName, verify: number): Node {
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = { P, B, net: NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify };
        const s = new GameSession(cfg, link);
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
}

const tl = (n: Node): Timeline => n.session.timeline;
const stats = (n: Node): Timeline['stats'] => tl(n).stats;
const isTick = (bytes: Uint8Array): boolean => bytes[0] === T.TICK;

/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay. */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}

interface Pair {
  /** One way, ms, with 10 ms of jitter. */
  readonly oneWay: number;
  /** b's final state spoiled at 9 s, in play: its next final tick, g, the first the two disagree on. */
  readonly spoiled?: boolean;
  /** The TICK of a's that carries its vote for g held this much longer on its way to b, FIFO holding
   *  those behind it. */
  readonly holdVote?: number;
  /** The design's dropped input: at 9 s, one of a's TICKs to b held this much, FIFO holding those
   *  behind it, so b finalises a absent for a few ticks (consensus.test.ts's pair). */
  readonly holdInput?: number;
  /** Which page is hidden from 8 to 20 s, its timers a second apart (D-31). */
  readonly hidden?: 'a' | 'b';
  /** Virtual time to run, ms. */
  readonly until: number;
}

/** a and b at 1 a side, a with the brain and verifying at 8, b idle, both Ready at 2 s, in play from
 *  about 7.2 s; then the case's divergence and its late learning. */
function pair(seed: number, c: Pair): { room: Room; a: Node; b: Node } {
  const room = new NetPump(new LoopbackNet(seed, () => ({ base: c.oneWay, jitter: 10 })));
  const net = room.net;
  const a = node(room, 0, personId(seed, 0), 'brain', 8);
  const b = node(room, 1, personId(seed, 1), 'none', 0);
  net.join(a, 0, (now) => {
    a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
    a.session.play(0);
  });
  net.join(b, 300, () => b.session.play(1));
  net.at(2000, () => a.session.ready(true));
  net.at(2050, () => b.session.ready(true));
  if (c.hidden !== undefined) {
    const h = c.hidden === 'a' ? a : b;
    net.pace(h, 8000, 1000);
    net.pace(h, 20_000, NET.timerMs);
  }
  let g = -1;
  net.at(9000, () => {
    const t = tl(b);
    expect(t.final.phase).toBe(IN_PLAY);
    if (c.spoiled !== true) return;
    spoil(t, (F: MatchState) => void (F.terriers[0]!.x += 1e-9));
    g = t.finalTick + 1;
  });
  const hold = c.holdVote;
  if (hold !== undefined) {
    let held = false;
    a.session.after = () => {
      if (!held && g > 0 && tl(a).finalTick >= g) {
        held = true;
        net.delayNext('n0', 'n1', isTick, hold);
      }
    };
  }
  if (c.holdInput !== undefined) net.at(9000, () => net.delayNext('n0', 'n1', isTick, c.holdInput!));
  room.run(c.until);
  return { room, a, b };
}

/** One page's resync completed, never both failing, each failing at most once, every hash equal from
 *  the last STATE taken on, and the run clean. Whether a resync failed. */
function expectOneCompletes(c: Pair, seed: number): boolean {
  const { room, a, b } = pair(seed, c);
  const label = `${JSON.stringify(c)}, seed ${seed}: a ${JSON.stringify(stats(a).log.slice(0, 6))}, b ${JSON.stringify(stats(b).log.slice(0, 6))}`;
  const [fa, fb] = [stats(a).resyncFailed, stats(b).resyncFailed];
  expect([fa > 0 && fb > 0, fa <= 1, fb <= 1], label).toEqual([false, true, true]);
  expect(stats(a).resyncs + stats(b).resyncs, label).toBeGreaterThanOrEqual(1);
  expectClean(room);
  const ts = [tl(a), tl(b)];
  const lo = Math.max(...a.session.states, ...b.session.states, ...ts.map(oldest));
  const hi = Math.min(...ts.map((t) => t.finalTick));
  expect(hi - lo, label).toBeGreaterThan(W + V);
  for (let x = lo; x <= hi; x++) expect(ts[0]!.hashAt(x), `${label}: tick ${x}`).toBe(ts[1]!.hashAt(x));
  return fa + fb > 0;
}

describe('two voters, the loser learning late that it lost (§3.6, C-10)', () => {
  it('over links of 200 ms one way, past the tally’s v ticks: one resync completes, and in most seeds none fails', () => {
    const c: Pair = { oneWay: 200, spoiled: true, until: 17_000 };
    let failed = 0;
    for (let seed = 1; seed <= SEEDS; seed++) if (expectOneCompletes(c, seed)) failed++;
    // The re-tally's marks cover the loser's votes for the v − 1 ticks after g; only one past them, a
    // tick or two at 200 ms, can still beat the winner, which pays with one failed resync (§3.6).
    expect(failed).toBeLessThanOrEqual(SEEDS / 4);
  });

  it('with the winner’s TICK carrying its vote for g held 250 ms over 80 ms links: one resync completes', () => {
    const c: Pair = { oneWay: 80, spoiled: true, holdVote: 250, until: 17_000 };
    for (let seed = 1; seed <= SEEDS; seed++) expectOneCompletes(c, seed);
  });

  it('with the design’s dropped input held 500 ms over 80 ms links: one resync completes', () => {
    const c: Pair = { oneWay: 80, holdInput: 500, until: 15_000 };
    for (let seed = 1; seed <= SEEDS; seed++) expectOneCompletes(c, seed);
  });

  it('with one page hidden, its timers a second apart, over 40 ms links: one resync completes (D-31)', () => {
    for (const hidden of ['a', 'b'] as const) {
      const c: Pair = { oneWay: 40, spoiled: true, hidden, until: 24_000 };
      for (let seed = 1; seed <= SEEDS / 2; seed++) expectOneCompletes(c, seed);
    }
  });
});
