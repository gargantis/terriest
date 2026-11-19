import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { scriptSampler } from '../core/bot/setups';
import { T } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, FRAME_PITCH, IN_PLAY, type InputParts, type MatchState, NEVER, type Pack } from '../core/sim/index';
import { type Mode, NetPump, oldest, TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32, type NodeOptions } from './loopback';

// The replay checks in play over the loopback network (PLAN D-11, D-31,
// R-1; M3's design, research/m3/DESIGN.md, §2.7, §2.8, §8.1, §13), as
// replay-play.test.ts has them, which says what they check: every node
// verifying its chain after every advance, four players at 2 a side in
// play to a goal and past it, here through a spread worst tick, an
// ordinary resync spread at a cap of w + 1, and a hidden page's bursts, its
// timers a second apart while the ball moves. Split for design §13's 8 s a
// file.

// Matches in virtual time, twice each, every chain verified each advance: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const B = defaultBotParams;
const P = defaultParams;
const W = NET.timeline.window;
const MATCH = '5e9e5e9e5e9e5e9e';
const SEED = 29;
const id = (k: number): string => personId(SEED, k);

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. */
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

/** A person's wandering input from its local tick: a step that changes every 16 ticks, held most of
 *  the time, zoomies in spells and a jump now and then; never read from the drawn head. */
function wander(k: number, s: Session): number {
  const n = s.timeline.localTick;
  const p: InputParts = { frame: FRAME_PITCH, zoomies: ((n >> 7) + k) % 3 === 0, jump: (n >> 6) & 3 };
  if (((n >> 5) + k) % 4 !== 0) p.step = ((n >> 4) * 7 + k * 5) & 31;
  return encodeInput(p);
}

interface Spec {
  readonly nodeId?: string;
  readonly net?: typeof NET;
  readonly opts?: NodeOptions;
  /** The brain on its drawn head, made again from each base onControl hands it (D-10): the keeper's. */
  readonly brain?: boolean;
}

/** Player k's session, verifying after every advance, its terrier wandering. */
function node(room: Room, k: number, spec: Spec = {}): Node {
  const me = id(k);
  return room.net.add(
    spec.nodeId ?? `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P, B, net: spec.net ?? NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: 1,
        };
        const s = new GameSession(cfg, link);
        if (spec.brain === true) {
          let sample = scriptSampler('brain', me, 0, P, B);
          s.controls = () => sample(s.timeline.head, s.timeline.headTick);
          s.onControl = (base) => {
            sample = scriptSampler('brain', me, base, P, B);
          };
        } else {
          s.controls = () => wander(k, s);
        }
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
    spec.opts,
  );
}

const tl = (n: Node): Timeline => n.session.timeline;
const stats = (n: Node): Timeline['stats'] => tl(n).stats;
const finalOf = (n: Node): Readonly<MatchState> => tl(n).final;
const isTick = (bytes: Uint8Array): boolean => bytes[0] === T.TICK;
const ROOM = (seed: number) => (mode: Mode): Room => new NetPump(new LoopbackNet(seed, uniform(seed * 7, 30, 60, 20)), { mode });

/** n0 proposes and plays in pack A with the brain; n1, n2 and n3 join 200·k ms on and play in packs
 *  B, A and B; all press Ready at 2 s, 50·k ms apart, so play starts about 7.2 s in. */
function lobby(room: Room, specs: readonly Spec[] = []): Node[] {
  const net = room.net;
  const k0 = node(room, 0, { brain: true, ...specs[0] });
  net.join(k0, 0, (now) => {
    k0.session.propose(k0.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
    k0.session.play(0);
  });
  const nodes = [k0];
  for (let k = 1; k < 4; k++) {
    const n = node(room, k, specs[k]);
    net.join(n, 200 * k, () => n.session.play((k % 2) as Pack));
    nodes.push(n);
  }
  nodes.forEach((n, k) => net.at(2000 + 50 * k, () => n.session.ready(true)));
  return nodes;
}

/** Each node's final phase at virtual time at. */
function phasesAt(room: Room, at: number): Map<string, number> {
  const out = new Map<string, number>();
  room.net.at(at, () => {
    for (const n of room.net.nodes.values()) out.set(n.id, (n as Node).session.timeline.final.phase);
  });
  return out;
}

/** In play when the case began, and by the end a goal scored and past its celebration: the ball and
 *  the terriers moving, the goal, the celebration and the kickoff placement all stepped under every
 *  check (§2.7). */
function expectPlayed(nodes: readonly Node[], phases: ReadonlyMap<string, number>): void {
  for (const n of nodes) {
    const F = finalOf(n);
    expect([phases.get(n.id), F.lastGoalTick !== NEVER, F.tick - F.lastGoalTick > P.celebrationTicks], n.id).toEqual([IN_PLAY, true, true]);
  }
}

/** A scenario run with every node verifying each advance: no chain a node checked differed from a
 *  full replay, and the drawn head's contract held (testing.ts); every page online then holds one hash
 *  at each of the last second's final ticks they all hold, whatever a dissent left in a repaired
 *  page's history before (§3.2). Its nodes. */
function replayed(seed: number, scene: (room: Room) => void): Node[] {
  const room = ROOM(seed)('incremental');
  scene(room);
  expect(room.problems).toEqual([]);
  const nodes = ([...room.net.nodes.values()] as Node[]).filter((n) => n.online && n.session.timeline.started);
  const ts = nodes.map(tl);
  const hi = Math.min(...ts.map((t) => t.finalTick));
  const lo = Math.max(...ts.map(oldest), hi - NET.timeline.history / 4);
  expect(hi - lo).toBeGreaterThan(W);
  for (let g = lo; g <= hi; g++) expect(new Set(ts.map((t) => t.hashAt(g))).size, `tick ${g}`).toBe(1);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}`).toBe(0);
  return nodes;
}

const nodeNamed = (nodes: readonly Node[], name: string): Node => nodes.find((n) => n.id === name)!;

describe('the replay checks in play: every node verifying each advance (§2.7, §8.1)', () => {
  it('a spread worst tick and a hidden page’s bursts in play: a resync spread at a cap of w + 1, and a page whose timers wake once a second, through a goal', () => {
    const net = { ...NET, timeline: { ...NET.timeline, spreadCap: W + 1 } };
    let phases = new Map<string, number>();
    const nodes = replayed(12, (room) => {
      const [, , , h] = lobby(room, [{ net }, { net }, { net }, { net }]);
      phases = phasesAt(room, 9000);
      room.net.at(9000, () => room.net.delayNext('n0', 'n1', isTick, 400));
      room.net.pace(h!, 10_000, 1000);
      room.net.pace(h!, 16_000, NET.timerMs);
      room.run(19_000);
    });
    expectPlayed(nodes, phases);
    const s = stats(nodeNamed(nodes, 'n1'));
    expect([s.resyncs, s.spreadTicks > 1, s.maxStepsPerAdvance]).toEqual([1, true, W + 1]);
    // The hidden page caught up its seconds in bursts, never repairing or losing a tally.
    const x = stats(nodeNamed(nodes, 'n3'));
    expect([x.resyncs, x.disagree, x.maxStepsPerAdvance > W + 1]).toEqual([0, 0, true]);
  });
});
