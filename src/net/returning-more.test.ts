import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { REFUSAL, ROLE } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, findTerrier, IN_PLAY, jumpCount, type MatchState, type Pack } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// A returning player over the loopback network, at 16 seeds (PLAN D-10,
// D-17, L215, C-10; M3's design, research/m3/DESIGN.md, §3.6, §4.3, §4.6,
// §8.1), returning.test.ts's first scenario, which says what it checks:
// four players at 2 a side and four spectators; one player's page closes
// in play, and a fresh page under its ID is admitted however full the
// room, takes its terrier back at once, skipping Join, and presses nothing.
// When the page closes, the three voters left may each hold its last
// inputs to a different tick, three lineages: each lost a different tick
// and, none answering a STATE_REQ while it resynced, every resync failed,
// the room never agreeing again and the returning page never getting a
// STATE (M3 phase 4a's integration found it at some of these seeds). A
// voter a won tally saw lose isn't counted for the v − 1 ticks after
// (consensus.test.ts), and every seed ends in agreement. Seed k's room is
// LoopbackNet(k) over returning.test.ts's links. Seeds 9 to 16 here, 1 to 8
// in returning-seeds.test.ts (design §13's 8 s a file).

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

describe('a returning player, at 16 seeds: 9 to 16 (D-17, §3.6)', () => {
  for (let seed = 9; seed <= 16; seed++) {
    it(`seed ${seed}: is admitted into a room with 4 spectators, skips Join, presses nothing, and the room agrees`, () => {
      const room = new NetPump(new LoopbackNet(seed, uniform(31, 30, 60, 20)));
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
      expect(sent.every((v) => jumpCount(v) === 1)).toBe(true);
      const live = [nodes[0]!, nodes[1]!, nodes[3]!, back, ...watchers];
      for (const n of live) {
        const T = terrier(n, me)!;
        expect(finalOf(n).tick - T.lastInputTick, n.id).toBeLessThan(30);
        expect(T.sitting, n.id).toBe(false);
        expect(n.session.timeline.stats.resyncFailed, n.id).toBe(0);
      }
      expectClean(room);
      agree(live);
    });
  }
});
