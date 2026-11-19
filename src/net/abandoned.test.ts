import { describe, expect, it, vi } from 'vitest';
import { botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { ROLE } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, ENDED, IN_PLAY, jumpCount, type MatchState, pounceCount, WARM_UP } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// The abandoned rule over the loopback network in virtual time (PLAN Q-16,
// D-17, C-50; M3's design, research/m3/DESIGN.md, §4.7, M3-Q18, §8.1):
// from the start countdown on, a browser that controls no terrier, and has
// heard no TICK, direct or forwarded, from a browser that does, its player
// or a bot it hosts in the final roster, for abandonedMs since its arrival,
// reads the match as abandoned; never in warm-up, where a match whose
// browsers all watch waits for players, and never once the final state has
// ended, when Results show. A proposer who watches at once and waits 40 s;
// a spectator who arrives after the players left, before the end, and one
// who arrives after it; and a spectator who hosts a bot, whose TICKs keep
// the match going after the last player left, and whose silence, once it
// goes too, counts from its own last TICK. Each runs one node at verify: 8
// (design §8.3).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const MATCH = 'abababababababab';
const ABANDONED = NET.room.abandonedMs;
const id = (k: number): string => personId(43, k);

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. It
 *  records, after each timer run, whether it reads the match as abandoned, and since when. */
class GameSession extends Session {
  /** The local time of the first timer run of the abandoned reading that holds now, null while it
   *  doesn't; and every reading's flips, as [time, abandoned]. */
  since: number | null = null;
  readonly flips: [number, boolean][] = [];
  private last = -1;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
    const a = this.abandoned(now);
    if (a !== (this.since !== null)) {
      this.since = a ? now : null;
      this.flips.push([now, a]);
    }
  }
}

type Node = LoopNode<GameSession>;
type Room = NetPump<LoopbackNet>;

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

const ROOM = (seed: number): Room => new NetPump(new LoopbackNet(seed, uniform(seed * 5, 30, 60, 20)));

/** A script of setups.ts's, or 'once': the brain until its pack's first goal, then nothing, its
 *  counters held, so a match is decisive with one celebration, not a brain's many. */
type Script = ScriptName | 'once';

/** Player k's session, its own terrier driven by a script, made again from each base onControl hands it. */
function node(room: Room, k: number, o: { script?: Script; verify?: number } = {}): Node {
  const me = id(k);
  const script = o.script ?? 'none';
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P, B, net: NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: o.verify ?? 0,
        };
        const s = new GameSession(cfg, link);
        let sample = scriptSampler(script === 'once' ? 'brain' : script, me, 0, P, B);
        let last = 0;
        s.controls = () => {
          const head = s.timeline.head;
          if (script !== 'once' || head.score[0] === 0) last = sample(head, s.timeline.headTick);
          return script === 'once' && head.score[0] > 0 ? encodeInput({ jump: jumpCount(last), pounce: pounceCount(last) }) : last;
        };
        s.onControl = (base) => {
          sample = scriptSampler(script === 'once' ? 'brain' : script, me, base, P, B);
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;
const agree = (nodes: readonly Node[]): void => expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay (reviewer S5). */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}

/** n0 proposes at 0 and plays in pack A, driven by `script`; n1 joins at 200 ms and plays in pack B,
 *  idle; both press Ready at 2 s: 1 a side, 1 minute. */
function match(room: Room, script: Script = 'none'): [Node, Node] {
  const net = room.net;
  const a = node(room, 0, { script, verify: 8 });
  net.join(a, 0, (now) => {
    a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
    a.session.play(0);
  });
  const b = node(room, 1);
  net.join(b, 200, () => b.session.play(1));
  for (const n of [a, b]) net.at(2000, () => n.session.ready(true));
  return [a, b];
}

/** A watcher k joining at `at`. */
function watcher(room: Room, k: number, at: number): Node {
  const n = node(room, k);
  room.net.join(n, at, () => n.session.watch());
  return n;
}

describe('abandoned matches (Q-16, D-17, design §4.7)', () => {
  it('never abandons a warm-up: a proposer who watches at once waits 40 s for players, who then play (L130, L163)', () => {
    const room = ROOM(1);
    const net = room.net;
    const keeper = node(room, 0, { verify: 8 });
    net.join(keeper, 0, (now) => {
      keeper.session.propose(keeper.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
      keeper.session.watch();
    });
    room.run(40_000);
    const k = keeper.session;
    expect([k.role(), k.inRoster(), k.failed(keeper.local(net.now)), finalOf(keeper).phase, finalOf(keeper).terriers]).toEqual([ROLE.SPECTATOR, false, false, WARM_UP, []]);
    expect(k.flips).toEqual([]);
    // Friends open the link: the match it waited in plays, and isn't abandoned.
    const [a, b] = [node(room, 1), node(room, 2)];
    net.join(a, 40_000, () => a.session.play(0));
    net.join(b, 40_200, () => b.session.play(1));
    for (const n of [a, b]) net.at(42_000, () => n.session.ready(true));
    room.run(15_000);
    expect(finalOf(keeper).phase).toBe(IN_PLAY);
    for (const n of [keeper, a, b]) expect(n.session.flips, n.id).toEqual([]);
    expectClean(room);
    agree([keeper, a, b]);
  });

  it('abandons a match the players left to a spectator who arrives before the end, abandonedMs after its arrival, and one who stayed, abandonedMs after their last TICK', () => {
    const room = ROOM(2);
    const net = room.net;
    const [a, b] = match(room);
    const stayed = watcher(room, 5, 3000);
    // 10 s into play, both players' pages close; a spectator arrives 5 s later.
    const LEFT = 20_000;
    let lastTick = -1;
    net.at(LEFT - 1, () => {
      expect(finalOf(stayed).phase).toBe(IN_PLAY);
    });
    net.leave(a, LEFT);
    net.leave(b, LEFT);
    net.at(LEFT + 1000, () => {
      // The last TICK of theirs that reached it.
      lastTick = Math.max(stayed.session.timeline.heardAt(id(0)) ?? -1, stayed.session.timeline.heardAt(id(1)) ?? -1);
    });
    const late = watcher(room, 6, LEFT + 5000);
    room.run(LEFT + 5000 + ABANDONED + 2000);
    expect(lastTick).toBeGreaterThan(LEFT - 200);
    // Each reads it at the first timer run abandonedMs after the later of its arrival and the last TICK.
    expect(stayed.session.flips.map(([, x]) => x)).toEqual([true]);
    expect(stayed.session.since! - lastTick).toBeGreaterThanOrEqual(ABANDONED);
    expect(stayed.session.since! - lastTick).toBeLessThan(ABANDONED + NET.timerMs + 1);
    const arrived = late.session.timeline.stats.joinedAt;
    expect(arrived).toBeGreaterThan(0);
    expect(late.session.flips.map(([, x]) => x)).toEqual([true]);
    expect(late.session.since!).toBeGreaterThanOrEqual(LEFT + 5000 + ABANDONED);
    expect(late.session.since!).toBeLessThan(LEFT + 5000 + ABANDONED + 1000);
    // Before the end: the final state is still in play, or its overtime.
    for (const n of [stayed, late]) expect(finalOf(n).phase, n.id).not.toBe(ENDED);
    expect(late.session.role()).toBe(ROLE.SPECTATOR);
    expectClean(room);
    agree([stayed, late]);
  });

  it('never abandons a match that has ended: a spectator who stayed, and one who arrives after the players left, show Results (C-50)', () => {
    const room = ROOM(3);
    const net = room.net;
    // Decisive by setup: a brain against an idle terrier, to its first goal.
    const [a, b] = match(room, 'once');
    const stayed = watcher(room, 5, 3000);
    const ended = (n: Node): boolean => finalOf(n).phase === ENDED && n.session.timeline.isConfirmed(finalOf(n).phaseStart);
    room.run(200_000, () => [a, b, stayed].every(ended));
    for (const n of [a, b, stayed]) expect(ended(n), n.id).toBe(true);
    const at = net.now;
    net.leave(a, at + 500);
    net.leave(b, at + 500);
    const late = watcher(room, 6, at + 2000);
    room.run(2000 + ABANDONED + 2000);
    for (const n of [stayed, late]) {
      expect(ended(n), n.id).toBe(true);
      expect(n.session.flips, n.id).toEqual([]);
      expect(n.session.abandoned(n.local(net.now)), n.id).toBe(false);
    }
    expect(finalOf(late).score).toEqual(finalOf(stayed).score);
    expect(finalOf(stayed).score).toEqual([1, 0]);
    expectClean(room);
    agree([stayed, late]);
  });

  it("keeps a match its last player left going while a spectator's bot plays, and abandons it abandonedMs after that host's last TICK (M3-Q18)", () => {
    // n0 plays in pack A; n9 watches and hosts pack B's bot. n0 leaves in play: the bot plays on, so
    // the watcher n5 reads nothing abandoned until n9 leaves too, though n9 isn't in the roster.
    const room = ROOM(4);
    const net = room.net;
    const a = node(room, 0, { verify: 8 });
    net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
      a.session.play(0);
    });
    const host = node(room, 9);
    net.join(host, 200, () => {
      host.session.watch();
      expect(host.session.addBot(1)).toBe(true);
    });
    net.at(2000, () => a.session.ready(true));
    const stayed = watcher(room, 5, 3000);
    const LEFT = 15_000;
    net.leave(a, LEFT);
    const GONE = LEFT + ABANDONED + 10_000;
    let lastTick = -1;
    net.at(GONE - 1, () => {
      expect(finalOf(stayed).phase).not.toBe(WARM_UP);
      expect([stayed.session.flips, host.session.flips]).toEqual([[], []]);
    });
    net.leave(host, GONE);
    net.at(GONE + 1000, () => {
      lastTick = stayed.session.timeline.heardAt(id(9)) ?? -1;
    });
    room.run(GONE + ABANDONED + 2000);
    const bot = botIds(id(9))[0]!;
    expect(finalOf(stayed).terriers.map((T) => T.id).sort()).toEqual([id(0), bot].sort());
    expect(lastTick).toBeGreaterThan(GONE - 200);
    expect(stayed.session.flips.map(([, x]) => x)).toEqual([true]);
    expect(stayed.session.since! - lastTick).toBeGreaterThanOrEqual(ABANDONED);
    expect(stayed.session.since! - lastTick).toBeLessThan(ABANDONED + NET.timerMs + 1);
    expectClean(room);
  });
});
