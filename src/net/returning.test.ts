import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { REFUSAL, ROLE } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import {
  defaultParams, encodeInput, ENDED, findTerrier, IN_PLAY, jumpCount, KEPT_BITS, type MatchState, type Pack, terriest, winner,
} from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// Returning players over the loopback network (PLAN D-10, D-17, C-50, L137,
// L215; M3's design, research/m3/DESIGN.md, §4.3, §4.6, §8.1): a player who
// reloads mid-match is admitted however full the room, takes its terrier
// back at once, skipping Join, with its press counters from the terrier's
// stored previous input, so it presses nothing on return (M3-Q28); and a
// browser that arrives, or reloads, on Results takes the final state and
// shows the same results. returning-seeds and returning-more.test.ts play
// the first at 16 seeds, where three voters each lost a different tick
// (§3.6).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const MATCH = 'bac4bac4bac4bac4';
const id = (k: number): string => personId(13, k);

class GameSession extends Session {
  private last = -1;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
  }
}

type Node = LoopNode<GameSession>;
type Room = NetPump<LoopbackNet>;

function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

interface Spec {
  readonly script?: ScriptName;
  readonly controls?: (s: Session) => number;
  readonly nodeId?: string;
  readonly verify?: number;
  readonly over?: Partial<SessionConfig>;
  /** The bases onControl handed it, and each input it sent from then on. */
  readonly bases?: number[];
  readonly sent?: number[];
}

/** k's session, its own terrier driven by a script, made again from each base onControl hands it. */
function node(room: Room, k: number, spec: Spec = {}): Node {
  const me = id(k);
  return room.net.add(
    spec.nodeId ?? `n${k}`,
    room.peer(
      (link, mode) => {
        const s = new GameSession(
          { P, B, net: NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: spec.verify ?? 0, ...spec.over },
          link,
        );
        let sample = scriptSampler(spec.script ?? 'none', me, 0, P, B);
        s.controls = () => {
          const v = spec.controls ? spec.controls(s) : sample(s.timeline.head, s.timeline.headTick);
          spec.sent?.push(v);
          return v;
        };
        s.onControl = (base) => {
          spec.bases?.push(base);
          sample = scriptSampler(spec.script ?? 'none', me, base, P, B);
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

const runTo = (room: Room, t: number): void => room.run(t - room.net.now);
const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;
const terrier = (n: Node, who: string): MatchState['terriers'][number] | undefined => finalOf(n).terriers[findTerrier(finalOf(n), who)];
const agree = (nodes: readonly Node[]): void => expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay (reviewer S5). */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}

/** n0 proposes and plays in pack A; players join 200·k ms on and play; all Ready at 2 s. */
function lobby(room: Room, players: readonly { k: number; pack: Pack; spec?: Spec }[], packSize: number, keeper: Spec = {}): Node[] {
  const net = room.net;
  const k0 = node(room, 0, { verify: 8, ...keeper });
  net.join(k0, 0, (now) => {
    k0.session.propose(k0.local(now), { packSize, matchMinutes: 1 }, MATCH);
    k0.session.play(0);
  });
  const nodes = [k0];
  for (const p of players) {
    const n = node(room, p.k, p.spec);
    net.join(n, 200 * p.k, () => n.session.play(p.pack));
    nodes.push(n);
  }
  nodes.forEach((n, k) => net.at(2000 + 50 * k, () => n.session.ready(true)));
  return nodes;
}

describe('returning players (D-17, L215)', () => {
  it('lets a player who reloads mid-match into a room with 4 spectators, skipping Join, in control at once and pressing nothing (D-10, M3-Q28)', () => {
    const room = new NetPump(new LoopbackNet(1, uniform(31, 30, 60, 20)));
    const net = room.net;
    // Player 2 holds its jump counter at 1 from a second in: a press, whose count its terrier keeps.
    const first: Spec = { controls: (s) => encodeInput({ jump: s.timeline.localTick > 60 ? 1 : 0 }) };
    const nodes = lobby(room, [{ k: 1, pack: 1 }, { k: 2, pack: 0, spec: first }, { k: 3, pack: 1 }], 2);
    const watchers = [20, 21, 22, 23].map((k) => node(room, k));
    watchers.forEach((n, k) => net.join(n, 3000 + 300 * k, () => n.session.watch()));
    net.leave(nodes[2]!, 10_000);
    runTo(room, 10_000);
    expect(finalOf(nodes[0]!).phase).toBe(IN_PLAY);
    const me = id(2);
    expect(jumpCount(terrier(nodes[0]!, me)!.prevInput)).toBe(1);
    // A fresh page under the same player ID, and a stranger, at once: no place is free.
    const bases: number[] = [];
    const sent: number[] = [];
    const back = node(room, 2, { nodeId: 'back', bases, sent });
    const stranger = node(room, 30);
    net.join(back, 11_000);
    net.join(stranger, 11_000);
    runTo(room, 13_000);
    const refused = (n: Node): number[] => [...new Set(net.refusals.filter((r) => r.to === n.id && r.from !== 'back' && r.from !== stranger.id).map((r) => r.reason))];
    expect(refused(stranger)).toEqual([REFUSAL.SPECTATORS_FULL]);
    expect(refused(back)).toEqual([]);
    expect([back.session.returning, back.session.role(), back.session.inRoster(), back.session.timeline.sending]).toEqual([true, ROLE.PLAYER, true, true]);
    // Its counters start from the terrier's stored previous input: its first input presses nothing.
    expect(bases.map(jumpCount)).toEqual([1]);
    expect(bases[0]! & ~KEPT_BITS).toBe(0);
    expect(sent.length).toBeGreaterThan(60);
    expect(sent.every((v) => jumpCount(v) === 1)).toBe(true);
    const live = [nodes[0]!, nodes[1]!, nodes[3]!, back, ...watchers];
    for (const n of live) {
      const T = terrier(n, me)!;
      expect(finalOf(n).tick - T.lastInputTick, n.id).toBeLessThan(30);
      expect(T.sitting, n.id).toBe(false);
    }
    expectClean(room);
    agree(live);
  });

  it('gives a browser that arrives, or reloads, on Results the final state, the same results, confirmed (D-17, C-50)', () => {
    const room = new NetPump(new LoopbackNet(2, uniform(32, 30, 60, 20)));
    const net = room.net;
    // Decisive by setup: a brain against an idle terrier, 1 a side.
    const nodes = lobby(room, [{ k: 1, pack: 1 }], 1, { script: 'brain' });
    const ended = (n: Node): boolean => finalOf(n).phase === ENDED && n.session.timeline.isConfirmed(finalOf(n).phaseStart);
    room.run(200_000, () => nodes.every(ended));
    for (const n of nodes) expect(ended(n), n.id).toBe(true);
    const at = net.now;
    const spectator = node(room, 20);
    net.join(spectator, at + 500, () => spectator.session.watch());
    net.leave(nodes[1]!, at + 500);
    const back = node(room, 1, { nodeId: 'back' });
    net.join(back, at + 1500);
    const all = [nodes[0]!, spectator, back];
    room.run(5000, () => all.every(ended));
    const results = (n: Node): unknown => {
      const s = finalOf(n);
      return { tick: s.phaseStart, score: s.score, winner: winner(s), terriest: terriest(s), rows: s.terriers.map((T) => [T.id, T.pack, T.goals, T.touches]) };
    };
    for (const n of all) {
      expect(ended(n), n.id).toBe(true);
      expect(results(n), n.id).toEqual(results(nodes[0]!));
      expect(n.session.abandoned(n.local(net.now)), n.id).toBe(false);
    }
    expect(finalOf(nodes[0]!).score[0]).toBeGreaterThan(finalOf(nodes[0]!).score[1]);
    expect([back.session.returning, back.session.inRoster()]).toEqual([true, true]);
    expect([spectator.session.returning, spectator.session.role()]).toEqual([false, ROLE.SPECTATOR]);
    expectClean(room);
    agree(all);
  });

  it("joins a reload that isn't in the roster as anyone: undecided, on Join (L137)", () => {
    const room = new NetPump(new LoopbackNet(3, uniform(33, 30, 60, 20)));
    const net = room.net;
    // Player 3 never pressed Play: it watched. Reloaded, it isn't returning.
    const nodes = lobby(room, [{ k: 1, pack: 1 }], 1);
    const watcher = node(room, 3);
    net.join(watcher, 600, () => watcher.session.watch());
    net.leave(watcher, 3000);
    const back = node(room, 3, { nodeId: 'back' });
    net.join(back, 4000);
    runTo(room, 6000);
    expect([back.session.timeline.started, back.session.returning, back.session.role(), back.session.timeline.sending]).toEqual([true, false, ROLE.UNDECIDED, false]);
    expect(finalOf(back).terriers.map((T) => T.id).sort()).toEqual([id(0), id(1)].sort());
    expectClean(room);
    agree([...nodes, back]);
  });
});
