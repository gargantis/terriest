import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { decode, T } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, type Pack } from '../core/sim/index';
import { inside, NetPump } from '../core/timeline/testing';
import { LoopbackNet, type LoopNode } from './loopback';

// A resync right after a join (M3 phase 4's fixes, reviewer H2; M3's
// design, research/m3/DESIGN.md, §3.4, §4.10): a peer answers one STATE_REQ
// per connection per resyncRetryMs, and the join's STATE_REQ counts, so a
// joiner whose first final state loses its tally passes over the peer it
// joined from for another voter, or, with no other, waits until that peer
// would answer, rather than ask it in vain and fail. Over 15 ms links, a
// joiner's final state spoiled as it adopts.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const BUILD = '0123456789abcdef'; // not a setting: a build hash's form (D-21)

type Node = LoopNode<Session>;

/** k's page, its STATE_REQs and STATEs to and from n2 logged. */
function page(room: NetPump<LoopbackNet>, seed: number, k: number, log: string[]): Node {
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const out = Object.create(link) as typeof link;
        out.send = (peer, bytes) => {
          const m = decode(bytes);
          if (m?.type === T.STATE_REQ && k === 2) log.push(`${room.net.now} REQ ${peer}`);
          link.send(peer, bytes);
        };
        const cfg: SessionConfig = {
          P: defaultParams, B: defaultBotParams, net: NET, me: personId(seed, k), name: `P${k}`, coat: k, build: BUILD, forwarding: true, mode, verify: 0,
        };
        return new Session(cfg, out);
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

/** n0 proposes, n1 plays if `three`, and n2 joins at 3 s and is spoiled as it adopts. */
function joinSpoiled(seed: number, three: boolean): { j: Node; log: string[] } {
  const room = new NetPump(new LoopbackNet(seed, () => ({ base: 15, jitter: 0 })));
  const log: string[] = [];
  const a = page(room, seed, 0, log);
  const b = three ? page(room, seed, 1, log) : null;
  const j = page(room, seed, 2, log);
  room.net.join(a, 0, (now) => {
    a.session.propose(a.local(now), { packSize: 2, matchMinutes: 1 }, 'c0ffeec0ffeec0ff');
    a.session.play(0);
  });
  if (b !== null) room.net.join(b, 300, () => b.session.play(1 as Pack));
  room.net.join(j, 3000, () => j.session.play(0 as Pack));
  room.until(() => j.session.timeline.started, 6000);
  // Spoiled, as asks.test.ts spoils one: its next tallies lose.
  const x = inside(j.session.timeline);
  x.F.ball.x += 0.25;
  x.validTo = j.session.timeline.finalTick;
  room.run(3000);
  return { j, log };
}

describe("a resync's asks after a join (reviewer H2, design §3.4)", () => {
  it('passes over the peer it joined from, asked within resyncRetryMs, for another voter', () => {
    // Seeds where the peer joined from is the winner's voter with the smaller player ID, and others.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { j, log } = joinSpoiled(seed, true);
      const s = j.session.timeline.stats;
      expect([s.resyncs, s.resyncFailed], `seed ${seed}: ${log.join(', ')}`).toEqual([1, 0]);
      // Its first ask is answered: no wait for a peer that wouldn't.
      expect(s.resyncMs[0], `seed ${seed}: ${log.join(', ')}`).toBeLessThan(NET.timeline.resyncRetryMs);
      // The join's ask, then the resync's, to two peers.
      expect(new Set(log.map((l) => l.split(' ')[2])).size, `seed ${seed}`).toBe(2);
    }
  });

  it('waits for the peer it joined from, the only voter, until that peer would answer, and repairs', () => {
    const { j, log } = joinSpoiled(1, false);
    const s = j.session.timeline.stats;
    expect([s.resyncs, s.resyncFailed], log.join(', ')).toEqual([1, 0]);
    const asks = log.map((l) => Number(l.split(' ')[0]));
    expect(asks.length).toBe(2);
    expect(asks[1]! - asks[0]!).toBeGreaterThanOrEqual(NET.timeline.resyncRetryMs);
  });
});
