import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { personId } from '../core/bot/bot-id';
import { nextMatchId } from '../core/match-id';
import type { RoomPeer } from '../core/session/room-peer';
import type { Transport, TransportOptions } from '../net/transport';
import { appRig } from './app-testing';
import { FakeClock } from './clock-testing';
import { type FakeDocument, type FakeElement, installDom, only } from './dom-testing';
import type { TransportFactory } from './game';
import type { Inspection } from './inspect';
import type { Match } from './match-types';
import { type Tab, World } from './world-testing';

// A networked match to its end through the app, and Play again (M4's
// design §5.9, §5.11, §5.2; PLAN D-12, C-42, D-14): one page over M3's
// network simulator proposes 1 a side, plays in pack A and hosts a bot in
// pack B, which scores against it; at the confirmed end, Results, the leave
// guard off, and the app's wake lock never wanted past Created; then Play
// again, past Results' guard, into the derived room's Pre-match, with no
// Join, the fragment its ID by replace, a fresh log, its bot along, and
// the old room closed after its grace, and the new room on Settings' TURN
// as it is at the press. A whole match, so a file of its own (CLAUDE.md).

vi.setConfig({ testTimeout: 60_000 });

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

/** The pages' promises let run, and the event loop turned once: Play again's derived ID is a SHA-256 digest
 *  (nextMatchId), which Node resolves off the microtask queue. */
const settle = async (): Promise<void> => {
  for (let k = 0; k < 10; k++) await Promise.resolve();
  await new Promise<void>((done) => setImmediate(done));
};

describe('Results and Play again in a networked match (§5.9)', () => {
  it("plays to the confirmed end, then into the derived room's Pre-match, the fragment its ID, its bot along (D-12, C-42)", async () => {
    const world = new World(53);
    const clock = new FakeClock(world.now);
    const tab = { k: 0, me: personId(7, 0), clock, page: null, rooms: new Map(), frozen: false } as unknown as Tab;
    let nodes = 0;
    const transport = (rooms: TransportOptions[]): TransportFactory => (peer: RoomPeer, _now, t) => {
      rooms.push(t);
      const net = world.net(t.matchId);
      let link: Transport | null = null;
      const node = net.add(`app0.${nodes++}@${t.matchId}`, (l) => {
        link = l;
        return peer;
      });
      net.join(node, world.now);
      tab.rooms.set(t.matchId, { net, node });
      return Promise.resolve(link!);
    };
    const r = appRig({ doc: dom.document, clock, me: tab.me, transport });
    world.tabs.push(tab);
    const look = (): Inspection => r.test.inspect!();
    const screen = (): FakeElement => only(r.root, '[id="screen"]');
    const button = (test: string): FakeElement => only(screen(), `button[data-test="${test}"]`);
    const held = (): Match => (r.app as unknown as { match: Match }).match;
    const until = async (cond: () => boolean, ms: number): Promise<void> => {
      for (let t = 0; t < ms && !cond(); t += 20) {
        world.run(20);
        await settle();
      }
      if (!cond()) throw new Error(`not reached within ${ms} ms of virtual time: ${JSON.stringify(look().match?.score)}`);
    };

    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    button('propose').click();
    only(screen(), 'select[data-test="pack-size"]').value = '1';
    only(screen(), 'select[data-test="match-length"]').value = '1';
    button('create').click();
    await until(() => look().screen === 'created', 1000);
    const id = held().matchId!;
    button('play-0').click();
    button('add-bot-1').click();
    await until(() => held().session.timeline.final.terriers.length === 2 && button('ready').getAttribute('aria-disabled') === null, 5000);
    button('ready').click();
    // The bot scores against a pack that doesn't defend (Q-9), so the match is decided at 0:00.
    await until(() => look().screen === 'results', 240_000);
    const end = look().match!.end!;
    expect(end.winner).toBe(1);
    expect([r.guard.active, r.wakes, look().announcements!.matchId]).toEqual([false, [true, false], id]);
    // A TURN server added since the match began: it applies from the next match, Play again's (§6).
    const turn = [{ urls: 'turns:turn.example:443', username: 'u', credential: 'c' }];
    expect(r.settings.set({ turn })).toBeNull();
    // Play again, once Results' guard has passed (Q-17): the derived room's Pre-match, no Join between.
    world.run(config.resultsPressGuardSeconds * 1000);
    await settle();
    r.app.ui({ kind: 'press', pressedAt: r.clock.now(), source: 'keyboard', repeat: false });
    const old = held();
    await until(() => look().screen === 'prematch', 2000);
    const next = await nextMatchId(id);
    expect(held().matchId).toBe(next);
    expect(r.rooms.map((o) => [o.matchId, o.turn])).toEqual([[id, []], [next, turn]]);
    expect([r.location.hash(), r.location.replaced]).toEqual([`#join=${next}`, [`#join=${id}`, `#join=${next}`]]);
    expect(look().announcements).toMatchObject({ matchId: next, arrivalTick: 0, countdowns: [], goals: [], results: null });
    expect([r.guard.active, r.wakes]).toEqual([true, [true, false]]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    // Its own hashchange ignored: the match held stays, and its bot comes along into the next roster.
    await until(() => held().session.timeline.final.terriers.length === 2, 5000);
    expect(held().matchId).toBe(next);
    await until(() => old.status().closed, 1000); // the old room, leaveGraceMs after its AGAIN
    expect(r.rooms.map((x) => x.matchId)).toEqual([id, next]);
  });
});
