import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { REFUSAL, ROLE } from '../core/session/index';
import { netSettings } from '../core/session/settings';
import {
  defaultParams, encodeInput, findTerrier, IN_PLAY, jumpCount, LEAVE, type MatchState, NEVER, type Pack, pounceCount, START_COUNTDOWN, WARM_UP,
} from '../core/sim/index';
import { TEST_BUILD } from '../core/timeline/testing';
import type { RoomPeer } from '../core/session/room-peer';
import { CURATED_RELAYS } from '../net/room-config';
import type { Transport, TransportOptions } from '../net/transport';
import { DEFAULT_SETTINGS } from '../storage/schema';
import { FakeClock, fakePage } from './clock-testing';
import { arrivalOf, asMatch, type NetMatch, openNetMatch, practiceMatch, RefusedRelay, roomChoice } from './match';
import { playerOf, type Tab, World } from './world-testing';

// The networked Match adapter (M4's design §1.37, §5.12, §8.1, §9.2's
// match row; PLAN D-12, D-17, D-30, M4-Q3), over M3's NetGame in virtual
// time, every page on its own FakeClock over the loopback network
// (src/ui/world-testing.ts's World, M3's network simulator), never a real
// room: openNetMatch's room and roomChoice's relays and ICE, the hook's
// relay alone or npm run dev:local's or the curated ones with Settings';
// status() from the session and the transport; the arrival a joiner's
// adopted STATE gives; a match that never pauses; the sampler on the held
// timeline for the tick its input is for, and the rebase a return hands
// it; own() over a frozen page's catch-up, counting every sender it sends
// for; Leave, its LEAVE out and the room closed leaveGraceMs later; Play
// again's derived room; a joiner refused a full pack, then watching; and a
// page a peer refused for the spectators' cap, which status() says.

vi.setConfig({ testTimeout: 60_000 });

const NET = netSettings();
const P = defaultParams;
const ROOM = 'MATCH-ADAPTER-ROOM'; // not a setting: a room's name, which NetGame never parses
const ONE_A_SIDE = { packSize: 1, matchMinutes: 1 };

interface Page {
  readonly tab: Tab;
  readonly match: NetMatch;
  readonly rooms: TransportOptions[];
}

/** Page k opens room matchId through openNetMatch, its transport the world's loopback for that room, under a
 *  node of its own, so the same player can open it again, as a reload does. */
async function openOn(world: World, k: number, matchId = ROOM, node = `p${k}`): Promise<Page> {
  const clock = new FakeClock(world.now);
  const page = fakePage();
  const tab = { k, me: playerOf(k), clock, page, rooms: new Map(), frozen: false } as unknown as Tab;
  const rooms: TransportOptions[] = [];
  const match = await openNetMatch({
    matchId, me: tab.me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, relays: null, extraRelays: [], ice: 'local', clock, page,
    transport: (peer: RoomPeer, _now, o) => {
      rooms.push(o);
      const net = world.net(o.matchId);
      let link: Transport | null = null;
      const n = net.add(`${node}@${o.matchId}`, (l) => {
        link = l;
        return peer;
      });
      net.join(n, world.now);
      tab.rooms.set(o.matchId, { net, node: n });
      return Promise.resolve(link!);
    },
  });
  world.tabs.push(tab);
  return { tab, match, rooms };
}

const final = (p: Page): Readonly<MatchState> => p.match.session.timeline.final;
const inRoster = (p: Page, id: string): boolean => p.match.session.timeline.started && findTerrier(final(p), id) >= 0;

/** A proposer at `size` a side in pack A, and a joiner in pack B, both in the roster on both pages. */
async function pair(world: World, size = 1): Promise<[Page, Page]> {
  const a = await openOn(world, 0);
  a.match.propose({ packSize: size, matchMinutes: 1 });
  a.match.play(0);
  world.run(200);
  const b = await openOn(world, 1);
  b.match.play(1);
  world.until(() => [a, b].every((p) => inRoster(p, a.tab.me) && inRoster(p, b.tab.me)), 8000);
  return [a, b];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('roomChoice: every room\'s relays and ICE (§5.12, M4-Q3)', () => {
  const settings = { relays: ['wss://extra.example'], turn: [{ urls: 'turns:turn.example:443', username: 'u', credential: 'c' }] };
  const turn = [{ urls: 'turns:turn.example:443', username: 'u', credential: 'c' }];

  it("opens with the curated relays and Settings' extra ones, and Settings' TURN, on a normal page", () => {
    expect(roomChoice(settings, null, false, null)).toEqual({ relays: null, extraRelays: ['wss://extra.example'], turn, ice: 'default' });
    expect(roomChoice(DEFAULT_SETTINGS, {}, false, null)).toEqual({ relays: null, extraRelays: [], turn: [], ice: 'default' });
  });

  it("takes a spec's loopback relay alone, with its ICE or local, and no TURN, contacting nothing else", () => {
    expect(roomChoice(settings, { relay: 'ws://127.0.0.1:7001' }, false, null)).toEqual({ relays: ['ws://127.0.0.1:7001'], extraRelays: [], turn: [], ice: 'local' });
    expect(roomChoice(settings, { relay: 'ws://localhost:7001', ice: 'none' }, false, null).ice).toBe('none');
    expect(roomChoice(settings, { relay: 'ws://[::1]:7001', ice: 'bogus' as never }, false, null).ice).toBe('local');
    expect(roomChoice(settings, { relay: CURATED_RELAYS[0]! }, false, null).relays).toEqual([CURATED_RELAYS[0]]);
    // The hook's relay wins over npm run dev:local's.
    expect(roomChoice(settings, { relay: 'ws://127.0.0.1:7001' }, true, 'ws://localhost:7002').relays).toEqual(['ws://127.0.0.1:7001']);
  });

  it("refuses a hook's relay a production build doesn't take, a public host or credentials, so no room opens with it", () => {
    for (const relay of ['wss://relay.example', 'ws://relay.example:7001', 'ws://u:p@127.0.0.1:7001', 'nonsense']) {
      expect(() => roomChoice(settings, { relay }, false, null), relay).toThrow(RefusedRelay);
    }
    // A dev build takes any ws: or wss: relay, as the #test=net page does.
    expect(roomChoice(settings, { relay: 'wss://relay.example' }, true, null).relays).toEqual(['wss://relay.example']);
  });

  it("opens with npm run dev:local's relay alone under the dev server, Settings' TURN kept, and never in a build", () => {
    expect(roomChoice(settings, null, true, 'ws://localhost:7002')).toEqual({ relays: ['ws://localhost:7002'], extraRelays: [], turn, ice: 'default' });
    expect(roomChoice(settings, null, true, null).relays).toBeNull(); // npm run dev, no local relay
    expect(roomChoice(settings, null, false, 'ws://localhost:7002').relays).toBeNull();
  });
});

describe("the networked Match (M4's design §1.37)", () => {
  it("opens its room with the options' relays and ICE, undecided, and holds a timeline from its proposal or a STATE", async () => {
    const world = new World(3);
    const a = await openOn(world, 0);
    expect(a.rooms).toEqual([{ matchId: ROOM, relays: [...CURATED_RELAYS], ice: 'local', settings: NET.transport }]);
    expect([a.match.kind, a.match.matchId, a.match.me, a.match.clock]).toEqual(['net', ROOM, a.tab.me, a.tab.clock]);
    expect([a.match.session.role(), a.match.session.timeline.started, a.match.arrivedTick, arrivalOf(a.match)]).toEqual([ROLE.UNDECIDED, false, -1, -1]);
    a.match.propose({ packSize: 3, matchMinutes: 2 });
    expect([a.match.session.role(), a.match.arrivedTick, a.match.settings]).toEqual([ROLE.KEEPER, 0, { packSize: 3, matchMinutes: 2 }]);
    world.run(1000);
    const b = await openOn(world, 1);
    // Until it holds the state, a joiner knows only the configuration's defaults.
    expect(b.match.settings).toEqual({ packSize: config.packSizeDefault, matchMinutes: config.matchLengthDefaultMinutes });
    world.until(() => b.match.session.timeline.started, 5000);
    // The joiner's arrival: the final tick of the STATE it adopted, well into the proposer's warm-up.
    expect(b.match.arrivedTick).toBeGreaterThan(30);
    expect(arrivalOf(b.match)).toBe(b.match.arrivedTick);
    expect(b.match.settings).toEqual({ packSize: 3, matchMinutes: 2 }); // the proposal's, from the state held
    expect(arrivalOf(practiceMatch({ me: playerOf(9), name: '', coat: 0, settings: ONE_A_SIDE, build: TEST_BUILD, clock: new FakeClock(), page: fakePage() }))).toBe(0);
    a.match.close();
    b.match.close();
  });

  it("reports the session's and the room's status: peers, the return, an AGAIN, a switch refused, leaving and closed", async () => {
    const world = new World(5);
    const [a, b] = await pair(world);
    world.run(500);
    expect(a.match.status()).toEqual({
      refusal: null, failed: false, abandoned: false, refused: null, switchRefused: false, returning: false,
      spectatorsFull: false, leaving: false, closed: false, peers: 1, againSeen: false,
    });
    // 1 a side: the other pack is full, and the session says so.
    b.match.switchPack();
    expect(b.match.status().switchRefused).toBe(true);
    const traffic = b.match.traffic();
    expect(traffic.sent).toBeGreaterThan(0);
    expect(traffic).not.toBe(b.match.traffic());
    traffic.byType[0x10]!.sent = -1; // a copy: the room's counts untouched
    expect(b.match.traffic().byType[0x10]!.sent).toBeGreaterThan(0);
    expect(b.match.stats().sent).toBeGreaterThan(0);
    expect(b.match.summary().remoteInputs).toBeGreaterThan(0);
    a.match.close();
    b.match.close();
  });

  it('never pauses: the menu and lost graphics leave its timeline running (Q-15, D-30)', async () => {
    const world = new World(7);
    const [a, b] = await pair(world);
    b.match.pause('menu');
    b.match.pause('graphics');
    const at = b.match.session.timeline.localTick;
    world.run(1000);
    expect([b.match.paused, b.match.session.timeline.localTick - at]).toEqual([false, 60]);
    b.match.resume('menu');
    expect(b.match.paused).toBe(false);
    a.match.close();
    b.match.close();
  });

  it('runs its subscribers after each timer run, and hands them each correction, until they unsubscribe', async () => {
    const world = new World(9);
    const [a, b] = await pair(world);
    let runs = 0;
    const stop = b.match.subscribe({ run: () => runs++ });
    world.run(1000);
    expect(runs).toBe(1000 / NET.timerMs);
    stop();
    world.run(100);
    expect(runs).toBe(1000 / NET.timerMs);
    a.match.close();
    b.match.close();
  });

  it('samples on the held timeline for the tick its input is for, the local tick + d, and rebases at a return (D-10, D-17)', async () => {
    const world = new World(11);
    const [a, b] = await pair(world);
    const t = b.match.session.timeline;
    const calls: { tick: number; local: number; head: boolean }[] = [];
    b.match.setControls((head, headTick, tick) => {
      calls.push({ tick, local: t.localTick, head: head === t.head && headTick === t.headTick });
      return 0;
    }, () => {});
    world.run(500);
    expect(calls.length).toBe(30);
    for (const c of calls) expect([c.tick, c.head]).toEqual([c.local + NET.timeline.delay, true]);
    // The page goes and comes back, as a reload does: its terrier taken back, the rebase handed its stored input.
    const terrier = (p: Page): number => final(p).terriers[findTerrier(final(p), b.tab.me)]!.prevInput;
    b.match.close();
    world.run(300);
    const again = await openOn(world, 1, ROOM, 'p1-again');
    const bases: number[] = [];
    again.match.setControls(() => 0, (base) => bases.push(base));
    world.until(() => again.match.session.timeline.started && again.match.session.inRoster(), 5000);
    expect(again.match.status().returning).toBe(true);
    expect(bases).toEqual([terrier(again)]);
    expect(again.match.session.role()).toBe(ROLE.PLAYER);
    a.match.close();
    again.match.close();
  });

  it("keeps a return's base for the Controls the screens make after it, its input until then keeping the stored counters, so the returning terrier presses nothing (§4.6, page-F4)", async () => {
    const world = new World(17);
    const [a, b] = await pair(world);
    // b's terrier jumps once in warm-up, its input's jump counter at 3 from then on.
    const JUMPED = encodeInput({ jump: 3 });
    b.match.setControls(() => JUMPED, () => {});
    const mine = (p: Page) => final(p).terriers[findTerrier(final(p), b.tab.me)]!;
    world.until(() => mine(a).prevInput === JUMPED && mine(a).takeOffTick !== NEVER, 3000);
    const took = mine(a).takeOffTick;
    // The page goes and comes back by its link, as a reload through the screens does: the session takes the
    // terrier back on Join, before any pitch screen, so the Controls come a timer run or more later.
    b.match.close();
    world.run(300);
    const again = await openOn(world, 1, ROOM, 'p1-again');
    world.until(() => again.match.session.timeline.started && again.match.session.inRoster(), 5000);
    world.run(500);
    expect(again.match.status().returning).toBe(true);
    // Meanwhile its input kept the stored counters, nothing held: no press acted on either page.
    for (const p of [a, again]) expect([jumpCount(mine(p).prevInput), mine(p).takeOffTick], `page ${p.tab.k}`).toEqual([3, took]);
    // The Controls made now take the base at once.
    const bases: number[] = [];
    again.match.setControls(() => JUMPED, (base) => bases.push(base));
    expect(bases.map((x) => [jumpCount(x), pounceCount(x)])).toEqual([[3, 0]]);
    world.run(500);
    expect(bases.length, 'handed once').toBe(1);
    expect([jumpCount(mine(a).prevInput), mine(a).takeOffTick]).toEqual([3, took]);
    a.match.close();
    again.match.close();
  });

  it("counts a frozen page's catch-up, the newest stallSendTicks sent and the rest skipped, for its terrier and its bot (§8.1)", async () => {
    const world = new World(13);
    const a = await openOn(world, 0);
    a.match.propose({ packSize: 2, matchMinutes: 1 });
    a.match.play(0);
    expect(a.match.addBot(0)).toBe(true);
    world.run(200);
    const b = await openOn(world, 1);
    b.match.play(1);
    world.until(() => b.match.session.timeline.started, 5000);
    expect(b.match.addBot(1)).toBe(true);
    world.until(() => final(a).terriers.length === 4 && final(b).terriers.length === 4, 8000);
    a.match.ready(true);
    b.match.ready(true);
    world.until(() => final(a).phase === IN_PLAY && final(b).phase === IN_PLAY, 15_000);
    world.run(500);
    const before = b.match.own();
    expect(before.senders).toBe(2);
    expect(before.skipped).toBe(0);
    world.freeze(b.tab);
    world.run(500); // past d + w ticks, under the stall's 2 s: one late timer run catches up 30 ticks
    world.thaw(b.tab);
    const after = b.match.own();
    expect(after.ticks - before.ticks).toBe(30);
    expect(after.sent - before.sent).toBe(NET.timeline.stallSendTicks);
    expect(after.skipped).toBe(30 - NET.timeline.stallSendTicks);
    expect(after.senders).toBe(2);
    // A watching page sends for no one, and skips nothing.
    const w = await openOn(world, 2);
    w.match.watch();
    world.until(() => w.match.session.timeline.started, 5000);
    world.freeze(w.tab);
    world.run(500);
    world.thaw(w.tab);
    expect(w.match.own()).toMatchObject({ skipped: 0, senders: 0 });
    for (const p of [a, b, w]) p.match.close();
  });

  it('leaves with its LEAVE in the TICKs that follow, the room closed leaveGraceMs later, its terrier gone from the others', async () => {
    const world = new World(15);
    const [a, b] = await pair(world);
    b.match.leave();
    expect(b.match.status()).toMatchObject({ leaving: true, closed: false });
    expect(b.match.session.timeline.eventsInFlight(b.tab.me) & LEAVE).toBe(LEAVE);
    world.run(NET.room.leaveGraceMs - 1);
    expect(b.match.status().closed).toBe(false);
    world.run(1);
    expect(b.match.status()).toMatchObject({ leaving: true, closed: true });
    expect(b.tab.clock.pending).toBe(0);
    world.until(() => !inRoster(a, b.tab.me), 1000); // in warm-up the LEAVE takes it out at once
    a.match.close();
  });

  it("opens the derived room's match on Play again, its pack kept, the old room closing after its grace (D-12, C-42)", async () => {
    const world = new World(17);
    const [a, b] = await pair(world);
    const oldA = a.match;
    const nextA = await oldA.playAgain();
    expect(nextA.kind).toBe('net');
    expect(nextA.matchId).not.toBe(ROOM);
    expect([nextA.session.timeline.started, nextA.settings]).toEqual([true, ONE_A_SIDE]); // no AGAIN reached it: it proposed
    expect(oldA.status().leaving).toBe(true);
    world.until(() => b.match.status().againSeen, 1000);
    const nextB = await b.match.playAgain();
    expect(nextB.matchId).toBe(nextA.matchId);
    world.until(() => oldA.status().closed, NET.room.leaveGraceMs + 10);
    const pageA = { tab: a.tab, match: nextA, rooms: a.rooms };
    const pageB = { tab: b.tab, match: nextB, rooms: b.rooms };
    world.until(() => [pageA, pageB].every((p) => inRoster(p, a.tab.me) && inRoster(p, b.tab.me)), 8000);
    const pack = (p: Page, id: string): Pack => final(p).terriers[findTerrier(final(p), id)]!.pack;
    expect([pack(pageB, a.tab.me), pack(pageB, b.tab.me)]).toEqual([0, 1]);
    nextA.close();
    nextB.close();
    b.match.close();
  });

  it("opens Play again's room on the relays, TURN and ICE given, Settings' now, and on its own room's without them (§6)", async () => {
    const world = new World(23);
    const [a, b] = await pair(world);
    const turn = [{ urls: 'turns:turn.example:443', username: 'u', credential: 'c' }];
    const nextA = await a.match.playAgain({ relays: null, extraRelays: ['wss://extra.example'], turn, ice: 'none' });
    expect(a.rooms.map((o) => [o.matchId, o.turn ?? [], o.ice])).toEqual([[ROOM, [], 'local'], [nextA.matchId, turn, 'none']]);
    expect(a.rooms[1]!.relays).toContain('wss://extra.example');
    world.until(() => b.match.status().againSeen, 1000);
    const nextB = await b.match.playAgain();
    expect(b.rooms.map((o) => [o.matchId, o.turn ?? [], o.ice])).toEqual([[ROOM, [], 'local'], [nextA.matchId, [], 'local']]);
    expect(nextB.matchId).toBe(nextA.matchId);
    // And the next match's own Play again, given none, keeps the room it opened with.
    const third = await nextA.playAgain();
    expect(a.rooms.map((o) => [o.turn ?? [], o.ice]).at(-1)).toEqual([turn, 'none']);
    for (const m of [third, nextA, nextB, a.match, b.match]) m.close();
  });

  it('gives up a JOIN for a full pack, then watches, and plays the other pack when asked (D-12)', async () => {
    const world = new World(19);
    const a = await openOn(world, 0);
    a.match.propose(ONE_A_SIDE);
    a.match.play(0);
    world.run(200);
    const b = await openOn(world, 1);
    world.until(() => b.match.session.timeline.started, 5000);
    b.match.play(0); // the pack taken already
    world.run(100);
    expect([b.match.status().refused, b.match.session.role()]).toEqual(['full', ROLE.SPECTATOR]);
    b.match.play(1);
    expect([b.match.status().refused, b.match.session.role()]).toEqual([null, ROLE.PLAYER]);
    world.until(() => inRoster(b, b.tab.me), 5000);
    expect(final(b).phase).toBe(WARM_UP);
    a.match.ready(true);
    b.match.ready(true);
    world.until(() => b.match.session.timeline.head.phase === START_COUNTDOWN, 5000);
    a.match.close();
    b.match.close();
  });

  it('fails a page that holds no timeline connectionFailureMs after opening, and never refuses a match it reaches', async () => {
    const world = new World(21);
    const alone = await openOn(world, 0, 'NOBODY-HERE');
    alone.match.play(0);
    world.run(NET.room.connectionFailureMs + 2 * NET.timerMs);
    expect(alone.match.status()).toMatchObject({ failed: true, refusal: null, peers: 0 });
    expect(REFUSAL.SPECTATORS_FULL).toBe(4);
    alone.match.close();
  });

  it("says a page a peer refused for the spectators' cap is refused so, the spectators' message's status (REFUSE 4, C-11, §5.6)", async () => {
    // The room's transport as Trystero's leaves it once its only peer has refused this page.
    const refusing: Transport = { send: () => {}, broadcast: () => {}, peerCount: () => 0, refusedBy: REFUSAL.SPECTATORS_FULL, leave: () => Promise.resolve() };
    const clock = new FakeClock(0);
    const match = await openNetMatch({
      matchId: ROOM, me: playerOf(0), name: 'P0', coat: 0, build: TEST_BUILD, relays: null, extraRelays: [], ice: 'local', clock, page: fakePage(),
      transport: () => Promise.resolve(refusing),
    });
    match.watch();
    clock.advance(NET.timerMs);
    expect(match.status()).toMatchObject({ refusal: REFUSAL.SPECTATORS_FULL, spectatorsFull: true, failed: false, peers: 0 });
    match.close();
  });

  it('wraps a game already open with asMatch, on the clock it runs on', async () => {
    const world = new World(23);
    const tab = await world.open(0);
    const m = asMatch(tab.game, ONE_A_SIDE, tab.clock);
    expect([m.kind, m.matchId, m.clock, m.settings]).toEqual(['net', tab.game.matchId, tab.clock, ONE_A_SIDE]);
    let runs = 0;
    m.subscribe({ run: () => runs++ });
    world.run(100);
    expect(runs).toBe(100 / NET.timerMs);
    tab.game.close();
  });
});
