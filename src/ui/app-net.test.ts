import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { personId } from '../core/bot/bot-id';
import { formatMatchId } from '../core/match-id';
import { REFUSAL, ROLE } from '../core/session/index';
import { findTerrier, LEAVE, WARM_UP } from '../core/sim/index';
import type { RoomPeer } from '../core/session/room-peer';
import { CURATED_RELAYS } from '../net/room-config';
import type { Transport, TransportOptions } from '../net/transport';
import { MemoryStorage } from '../storage/kv';
import { type AppRig, appRig, type AppRigOptions, Locks } from './app-testing';
import { FakeClock } from './clock-testing';
import { type FakeDocument, type FakeElement, FakeEvent, installDom, only } from './dom-testing';
import type { TransportFactory } from './game';
import type { Inspection } from './inspect';
import { OFFER_TEXT } from './layers/net';
import type { Match } from './match-types';
import { type Tab, World } from './world-testing';

// The networked screens through the app (M4's design §5.2, §5.5, §5.6,
// §5.7, §5.11, §5.12, §5.13, §6's one game tab, §9.2's app row; PLAN §8,
// D-12, D-17, D-24, D-30, C-32, M4-Q2, M4-Q3), each page an App on the DOM
// fake, every page's clock and room on M3's network simulator
// (src/ui/world-testing.ts's World), never a real room: Propose, Create
// and Created, the fragment set by replace and its own hashchange ignored,
// the link, the code and the joiners counted, the wake lock until someone
// joins; a joiner by link, "Connecting to the match…" until the state is
// held, then the packs, a full pack's Play marked, the smaller suggested;
// Pre-match with Invite and the bots' buttons, a spectator's without Ready;
// the hook's networked fields, the arrival a joiner's adopted STATE gives;
// a page that comes back by the same link skipping Join, its terrier taken
// back, and one whose bot alone is in the roster coming back to watch it;
// a JOIN given up watching, the other pack's Play making the page a player
// again; Leave, its LEAVE out and the fragment cleared; a spectator told
// the players have left, with the score so far, once every browser that
// controls a terrier has gone silent for 30 s from the countdown on (Q-16,
// §5.10, M4-Q39: no gate page can wait that out); the tab lock lost
// mid-match, the match closed without a LEAVE, and the tab that took it
// over playing the same terrier; and on a page with no hook, Create's and
// Join's rooms on the curated relays with Settings' extra ones and TURN.

vi.setConfig({ testTimeout: 60_000 });

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

const settle = async (): Promise<void> => {
  for (let k = 0; k < 10; k++) await Promise.resolve();
};

/** Page k in `world`: an App whose clock the world runs and whose rooms are the world's, each room a node of
 *  its own, as a page's Trystero room is. */
interface Page {
  readonly r: AppRig;
  readonly tab: Tab;
  look(): Inspection;
}

/** Each room's node, by a count of the file's own: a page that comes back is another node. */
let nodes = 0;

/** A room's transport that never meets anyone: what Trystero hands a page that opens a room under an ID its
 *  last room there still holds, whose messages go to the match that opened it. */
const DEAD: Transport = { send: () => {}, broadcast: () => {}, peerCount: () => 0, refusedBy: null, leave: () => Promise.resolve() };

function page(world: World, k: number, o: Omit<AppRigOptions, 'doc' | 'clock' | 'transport'> & { readonly trysteroRooms?: boolean } = {}): Page {
  const clock = new FakeClock(world.now);
  const tab = { k, me: o.me ?? personId(7, k), clock, page: null, rooms: new Map(), frozen: false } as unknown as Tab;
  // With trysteroRooms, the page's rooms by their match ID as Trystero keeps them: joinRoom hands back a room
  // still open under an ID (strategy.mjs's occupiedRooms) until its leave.
  const open = new Set<string>();
  const transport = (rooms: TransportOptions[]): TransportFactory => (peer: RoomPeer, _now, t) => {
    rooms.push(t);
    if (o.trysteroRooms === true && open.has(t.matchId)) return Promise.resolve(DEAD);
    const net = world.net(t.matchId);
    let link: Transport | null = null;
    const node = net.add(`app${k}.${nodes++}@${t.matchId}`, (l) => {
      link = l;
      return peer;
    });
    net.join(node, world.now);
    tab.rooms.set(t.matchId, { net, node });
    if (o.trysteroRooms !== true) return Promise.resolve(link!);
    open.add(t.matchId);
    const l: Transport = link!;
    return Promise.resolve({
      send: (to, bytes) => l.send(to, bytes), broadcast: (bytes) => l.broadcast(bytes), drop: (to) => l.drop?.(to), peerCount: () => l.peerCount(),
      get refusedBy() {
        return l.refusedBy;
      },
      leave: () => {
        open.delete(t.matchId);
        return l.leave();
      },
    });
  };
  const r = appRig({ doc: dom.document, clock, me: tab.me, transport, ...o });
  world.tabs.push(tab);
  return { r, tab, look: () => r.test.inspect!() };
}

/** Started, its compile done, so Ready can act once its player is in the roster. */
async function started(p: Page): Promise<void> {
  await p.r.app.start();
  p.r.frames.run();
  p.r.clock.advance(0);
  await p.r.stages[0]!.finish();
  await settle();
}

const screenOf = (p: Page): FakeElement => only(p.r.root, '[id="screen"]');
const button = (p: Page, test: string): FakeElement => only(screenOf(p), `button[data-test="${test}"]`);
const text = (p: Page, test: string): string => only(screenOf(p), `[data-test="${test}"]`).textContent;
const held = (p: Page): Match => (p.r.app as unknown as { match: Match }).match;
const inRosterOf = (p: Page, id: string): boolean => {
  const t = held(p)?.session.timeline;
  return t !== undefined && t.started && findTerrier(t.final, id) >= 0;
};

/** Through the world until cond holds, the pages' promises let run as it goes. */
async function until(world: World, cond: () => boolean, ms: number): Promise<void> {
  for (let t = 0; t < ms && !cond(); t += 20) {
    world.run(20);
    await settle();
  }
  if (!cond()) throw new Error(`not reached within ${ms} ms of virtual time`);
}

/** Trystero's announcement again after a refused handshake, which the loopback never makes: page p's node in
 *  match id's room meets each of `others` again, where both are online and not connected. */
function meetAgain(p: Page, others: readonly Page[], id: string): void {
  const mine = p.tab.rooms.get(id);
  if (mine === undefined) return;
  for (const o of others) {
    const theirs = o.tab.rooms.get(id);
    if (theirs !== undefined) mine.net.unblock(mine.node.id, theirs.node.id);
  }
}

/** Proposes from Home: Propose a match, 1 a side and 1 minute, Create; on to Created. */
async function propose(world: World, p: Page): Promise<string> {
  button(p, 'propose').click();
  only(screenOf(p), 'select[data-test="pack-size"]').value = '1';
  only(screenOf(p), 'select[data-test="match-length"]').value = '1';
  button(p, 'create').click();
  await until(world, () => p.look().screen === 'created', 1000);
  return held(p).matchId!;
}

describe("Propose, Created and Join by link (§5.5, §5.6)", () => {
  it('creates a match, shares it, holds the wake lock until someone joins, and plays it with a joiner who comes by its link', async () => {
    const world = new World(31);
    const a = page(world, 0, { test: { relay: 'ws://127.0.0.1:7001', ice: 'none' } });
    await started(a);
    world.run(1);
    expect(a.r.canaries).toEqual([true]); // start-up's, after the compile, in a task of its own
    button(a, 'propose').click();
    expect(a.look().screen).toBe('propose');
    expect(button(a, 'create').getAttribute('aria-disabled')).toBeNull();
    only(screenOf(a), 'select[data-test="pack-size"]').value = '1';
    only(screenOf(a), 'select[data-test="match-length"]').value = '1';
    button(a, 'create').click();
    expect(button(a, 'create')).toMatchObject({ textContent: 'Creating…' });
    expect(button(a, 'create').getAttribute('aria-disabled')).toBe('true');
    await until(world, () => a.look().screen === 'created', 1000);
    // The spec's loopback relay alone, with its ICE (M4-Q3), and genesis proposed.
    const id = held(a).matchId!;
    expect(a.r.rooms).toEqual([{ matchId: id, relays: ['ws://127.0.0.1:7001'], ice: 'none', turn: [], settings: expect.anything() }]);
    expect(held(a).session.timeline.started).toBe(true);
    // The fragment by replace, once; its own hashchange, a task later, ignored: Created stays.
    expect([a.r.location.hash(), a.r.location.replaced]).toEqual([`#join=${id}`, [`#join=${id}`]]);
    const created = screenOf(a).children[0];
    world.run(10);
    expect(screenOf(a).children[0]).toBe(created);
    // The link and the code in groups of four, and nobody yet: the wake lock wanted (D-30).
    expect(only(screenOf(a), 'input[data-test="invite-link"]').getAttribute('value')).toBe(`https://terriest.test/play/#join=${id}`);
    expect(text(a, 'invite-code')).toBe(formatMatchId(id));
    expect(text(a, 'created-status')).toBe('Nobody has joined yet.');
    expect(a.r.wakes).toEqual([true]);
    // The wake lock's refusal, this browser's, caught and reported through the hook (§0, §5.13); and the
    // guard asks nothing on Created (§5.11).
    await settle();
    expect(a.look().wakeLock).toMatchObject({ wanted: true, state: 'refused', refusals: 1, lastRefusal: 'NotAllowedError' });
    expect(a.r.guard.active).toBe(false);
    button(a, 'copy-code').click();
    await settle();
    expect(a.r.copied).toEqual([formatMatchId(id)]);
    expect(a.look().announcements).toMatchObject({ matchId: id, arrivalTick: 0 }); // the proposer's arrival: genesis

    // A joiner by the link, with no hook: the curated relays, Settings' extra ones none.
    const b = page(world, 1, { hash: `#join=${id}` });
    await b.r.app.start();
    void b.r.stages[0]!.finish(); // its compile, behind Join
    expect(b.look().screen).toBe('join');
    expect(text(b, 'join-status')).toBe('Connecting to the match…');
    expect(b.r.guard.active).toBe(false); // nothing asked on Join (§5.11)
    expect(button(b, 'watch').hidden).toBe(true); // no choice before the state is known (M4-Q2)
    expect(button(b, 'play-0').hidden).toBe(false);
    expect(only(screenOf(b), '.join-packs').hidden).toBe(true);
    await settle();
    button(b, 'play-0').click(); // a choice made before the state is held does nothing
    expect([b.look().screen, held(b).session.role()]).toEqual(['join', 4]); // ROLE.UNDECIDED
    expect(b.r.rooms.map((x) => [x.matchId, x.relays, x.ice])).toEqual([[id, [...CURATED_RELAYS], 'default']]);
    expect(b.look().match).toMatchObject({ kind: 'net', matchId: id, started: false, inRoster: false });
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    // Both packs free: the first suggested on the tie; Watch offered.
    expect(button(b, 'play-0').classList.contains('primary')).toBe(true);
    expect(button(b, 'play-1').classList.contains('primary')).toBe(false);
    expect(button(b, 'watch').hidden).toBe(false);
    const arrived = b.look().announcements!.arrivalTick!;
    expect(arrived).toBeGreaterThan(0); // the final tick of the STATE it adopted
    expect(arrived).toBe((held(b) as unknown as { arrivedTick: number }).arrivedTick);
    // Created counts the joiner, and the wake lock goes.
    await until(world, () => text(a, 'created-status') === '1 person has joined.', 2000);
    expect(a.r.wakes).toEqual([true, false]);
    expect(a.look().wakeLock).toMatchObject({ wanted: false, state: 'off' });

    // The proposer plays in pack A: its Pre-match, Ready focused, the guard on; the app's wake lock
    // stays off, the pitch's being the turn prompt's layer's (src/ui/phone.ts).
    button(a, 'play-0').click();
    expect(a.look().screen).toBe('prematch');
    expect([a.r.guard.active, a.r.wakes]).toEqual([true, [true, false]]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    // The joiner's Join shows it in pack A, which is full now: its Play marked, the other suggested.
    await until(world, () => button(b, 'play-0').getAttribute('aria-disabled') === 'true', 2000);
    expect(button(b, 'play-0').textContent).toBe('Play in the Blue pack: full');
    expect(button(b, 'play-1').classList.contains('primary')).toBe(true);
    expect(only(screenOf(b), '[data-test="join-pack-0"]').textContent).toMatch(/^Player [0-9A-F]{4}/);
    button(b, 'play-0').click(); // full: nothing
    expect(b.look().screen).toBe('join');
    button(b, 'play-1').click();
    expect(b.look().screen).toBe('prematch');
    await until(world, () => [a, b].every((p) => inRosterOf(p, a.tab.me) && inRosterOf(p, b.tab.me)), 5000);
    world.run(100);
    await settle();
    expect(button(b, 'ready').getAttribute('aria-disabled')).toBeNull();
    // A networked Pre-match: Invite, its panel behind it, and the bots' buttons, full packs saying so.
    expect(button(b, 'invite-button').hidden).toBe(false);
    expect(only(screenOf(b), '[data-test="invite"]').hidden).toBe(true);
    button(b, 'invite-button').click();
    expect(only(screenOf(b), '[data-test="invite"]').hidden).toBe(false);
    expect(text(b, 'invite-code')).toBe(formatMatchId(id));
    expect(button(b, 'add-bot-0')).toMatchObject({ textContent: 'Add a Blue bot: full', hidden: false });
    expect(button(b, 'remove-bot-1').hidden).toBe(true);
    // The hook's networked figures (§1.40), the room's connections among them (§9.3's peer counts).
    expect(b.look().match).toMatchObject({ kind: 'net', matchId: id, started: true, inRoster: true, returning: false, peers: 1 });
    expect([a.look().match!.peers, held(a).status().peers]).toEqual([1, 1]);
    expect(b.look().announcements).toMatchObject({ matchId: id, arrivalTick: arrived });
    expect(b.look().match!.own.senders).toBe(1);
    // The clock's samples, taken and dropped by its freeze rule, and its jumps: the held timeline's (§1.40,
    // §8.4's run 4, phase 2c's late messages).
    const st = held(b).session.timeline.stats;
    expect(st.clockSamples).toBeGreaterThan(0);
    expect(b.look().match!.stats).toMatchObject({ clockSamples: st.clockSamples, clockSamplesDropped: st.clockSamplesDropped, jumps: st.jumps });
    // Ready on both: the start countdown, Pre-match still (M4-Q8).
    button(a, 'ready').click();
    button(b, 'ready').click();
    await until(world, () => held(b).session.timeline.head.phase === 1, 3000);
    await settle();
    expect(b.look().screen).toBe('prematch');
    expect(button(b, 'ready').textContent).toBe('Starting…');
  });

  it('takes a page that comes back by the same link straight to Pre-match, its terrier taken back (L215, D-17)', async () => {
    const world = new World(37);
    const a = page(world, 0);
    await started(a);
    const id = await propose(world, a);
    button(a, 'play-0').click();
    const storage = new MemoryStorage();
    const b = page(world, 1, { hash: `#join=${id}`, storage });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    button(b, 'play-1').click();
    await until(world, () => inRosterOf(a, b.tab.me), 5000);
    // The page goes, as a reload does: its room left, its timers stopped.
    const room = b.tab.rooms.get(id)!;
    room.net.leave(room.node, world.now);
    world.tabs.splice(world.tabs.indexOf(b.tab), 1);
    world.run(200);
    // The same browser opens the link again: the same player, back in its terrier.
    const again = page(world, 1, { hash: `#join=${id}`, storage });
    await started(again);
    expect(again.look().screen).toBe('join');
    await until(world, () => again.look().screen === 'prematch', 5000);
    expect(again.look().match).toMatchObject({ returning: true, inRoster: true });
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    expect(again.look().controls).not.toBeNull();
  });

  it("takes a page whose bot alone is in the roster back to watch, skipping Join, its bot driven again and its Remove shown (D-17, D-39)", async () => {
    const world = new World(73);
    const a = page(world, 0);
    await started(a);
    const id = await propose(world, a);
    button(a, 'play-0').click();
    const storage = new MemoryStorage();
    const b = page(world, 1, { hash: `#join=${id}`, storage });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    button(b, 'watch').click();
    button(b, 'add-bot-1').click();
    const bot = (p: Page): string | undefined => held(p).session.hostedBots()[0];
    await until(world, () => bot(b) !== undefined && inRosterOf(a, bot(b)!), 5000);
    const botId = bot(b)!;
    // The page goes, as a reload does, and the same browser opens the link again.
    const room = b.tab.rooms.get(id)!;
    room.net.leave(room.node, world.now);
    world.tabs.splice(world.tabs.indexOf(b.tab), 1);
    world.run(200);
    const again = page(world, 1, { hash: `#join=${id}`, storage });
    await started(again);
    expect(again.look().screen).toBe('join');
    await until(world, () => again.look().screen === 'prematch', 5000);
    // A spectator's pitch screen: no play controls, its bot's Remove shown, the session watching.
    expect(again.look()).toMatchObject({ controls: null, match: { inRoster: false } });
    expect(held(again).session.role()).toBe(ROLE.SPECTATOR);
    expect(button(again, 'remove-bot-1').hidden).toBe(false);
    // Its bot driven again from this page: the proposer takes its inputs.
    const lastInput = (): number => held(a).session.timeline.final.terriers.find((T) => T.id === botId)!.lastInputTick;
    const before = lastInput();
    world.run(1000);
    await settle();
    expect(lastInput()).toBeGreaterThan(before);
    expect(inRosterOf(a, botId)).toBe(true);
  });

  it("opens Create's and Join's rooms on the curated relays with Settings' extra ones, and Settings' TURN, on a page with no hook (§5.5, §5.12, §6)", async () => {
    const world = new World(79);
    const extra = 'wss://extra.example';
    const turn = { urls: 'turns:turn.example:443', username: 'u', credential: 'c' };
    const a = page(world, 0);
    expect(a.r.settings.set({ relays: [extra], turn: [turn] })).toBeNull();
    await started(a);
    const id = await propose(world, a);
    expect(a.r.rooms).toEqual([{ matchId: id, relays: [...CURATED_RELAYS, extra], ice: 'default', turn: [turn], settings: expect.anything() }]);
    // A joiner by the link, its own Settings' connections, read as its room opens.
    const b = page(world, 1, { hash: `#join=${id}` });
    expect(b.r.settings.set({ relays: [extra, 'wss://another.example'], turn: [turn] })).toBeNull();
    await b.r.app.start();
    await settle();
    expect(b.r.rooms.map((o) => [o.matchId, o.relays, o.turn, o.ice])).toEqual([[id, [...CURATED_RELAYS, extra, 'wss://another.example'], [turn], 'default']]);
  });

  it('watches without play controls, adds and removes a bot as a spectator, and leaves with its LEAVE out, the fragment cleared', async () => {
    const world = new World(41);
    const a = page(world, 0);
    await started(a);
    button(a, 'propose').click();
    button(a, 'create').click(); // 2 a side, 3 minutes: the defaults
    await until(world, () => a.look().screen === 'created', 1000);
    const id = held(a).matchId!;
    button(a, 'watch').click();
    expect(a.look().screen).toBe('prematch');
    expect([button(a, 'ready').hidden, button(a, 'switch-pack').hidden, a.look().controls]).toEqual([true, true, null]);
    expect(button(a, 'invite-button').hidden).toBe(false);
    expect(a.r.guard.active).toBe(true);
    // A spectator's bots: Add, then Remove shown while it hosts one there (D-39).
    expect(button(a, 'remove-bot-0').hidden).toBe(true);
    button(a, 'add-bot-0').click();
    await until(world, () => inRosterOf(a, held(a).session.hostedBots()[0] ?? ''), 3000);
    expect(button(a, 'remove-bot-0').hidden).toBe(false);
    button(a, 'remove-bot-0').click();
    await until(world, () => held(a).session.timeline.final.terriers.length === 0, 3000);
    await until(world, () => button(a, 'remove-bot-0').hidden, 1000);
    // A joiner plays; the watcher leaves: its room closed after its grace, the fragment cleared.
    const b = page(world, 1, { hash: `#join=${id}` });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    button(b, 'play-0').click();
    await until(world, () => inRosterOf(b, b.tab.me) && held(a).status().peers === 1, 5000);
    const m = held(b);
    button(b, 'prematch-leave').click();
    expect(m.session.timeline.eventsInFlight(b.tab.me) & LEAVE).toBe(LEAVE);
    expect([b.look().screen, b.look().match, b.r.location.hash(), b.r.location.replaced, b.r.guard.active]).toEqual(['home', null, '', ['#'], false]);
    await until(world, () => m.status().closed, 1000);
    await until(world, () => !inRosterOf(a, b.tab.me), 1000); // in warm-up the LEAVE takes it out at once
  });

  it("watches once a JOIN is given up for a full pack, says so, and plays the other pack's place when asked (D-12)", async () => {
    const world = new World(43);
    const a = page(world, 0);
    await started(a);
    const id = await propose(world, a);
    const b = page(world, 1, { hash: `#join=${id}` });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    // Both press Play in the Blue pack, A a few ticks first: A's JOIN takes its one place, and B's, on its way
    // before B's Join could show the pack full, is given up.
    button(a, 'play-0').click();
    world.run(50);
    await settle();
    expect(button(b, 'play-0').getAttribute('aria-disabled')).toBeNull();
    button(b, 'play-0').click();
    expect([b.look().screen, b.look().controls === null]).toEqual(['prematch', false]);
    await until(world, () => held(b).status().refused === 'full', 3000);
    await until(world, () => b.look().controls === null, 100); // a spectator's pitch screen now
    // The notice, never a message screen: the page still on Pre-match (§5.10's watching, M4-Q39).
    expect([b.look().screen, b.look().message]).toEqual(['prematch', null]);
    expect(b.look().layers['net']).toEqual({ watching: true, offer: 1 });
    const notes = only(screenOf(b), '[data-test="watching"]');
    expect([notes.hidden, notes.getAttribute('role')]).toEqual([false, 'status']);
    expect(notes.textContent).toBe(`${OFFER_TEXT}Play in the Orange pack`); // the other pack has a place: not full (§5.6)
    expect(button(b, 'ready').hidden).toBe(true);
    expect(inRosterOf(b, b.tab.me)).toBe(false);
    // The other pack's Play: a player's pitch screen again, Ready focused, and into the roster.
    button(b, 'play-other').click();
    await until(world, () => b.look().controls !== null, 100);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    await until(world, () => inRosterOf(b, b.tab.me), 5000);
    expect(b.look().layers['net']).toEqual({ watching: false, offer: null });
    expect(held(b).session.timeline.final.terriers.find((T) => T.id === b.tab.me)!.pack).toBe(1);
  });

  it('tells a spectator the players have left, with the score so far, once every browser that controls a terrier has gone silent for 30 s from the countdown on (Q-16, §5.10)', async () => {
    const world = new World(53);
    const a = page(world, 0);
    await started(a);
    const id = await propose(world, a);
    // The proposer plays in A and hosts B's bot, so the match starts on its Ready alone.
    button(a, 'play-0').click();
    button(a, 'add-bot-1').click();
    const b = page(world, 1, { hash: `#join=${id}` });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    button(b, 'watch').click();
    expect(b.look().screen).toBe('prematch');
    await until(world, () => a.look().match!.roster.length === 2 && button(a, 'ready').getAttribute('aria-disabled') === null, 5000);
    button(a, 'ready').click();
    await until(world, () => held(b).session.timeline.final.phase !== WARM_UP, 5000);
    // The proposer's tab goes silent, its terrier and its bot with it: nothing tells the watcher.
    world.freeze(a.tab);
    const silent = world.now;
    await until(world, () => b.look().screen === 'message', config.abandonedSeconds * 1000 + 2000);
    expect(world.now - silent).toBeGreaterThanOrEqual(config.abandonedSeconds * 1000 - 500);
    expect(b.look()).toMatchObject({ message: 'left', match: null });
    const message = only(screenOf(b), 'section[data-test="message"]');
    expect(message.getAttribute('data-message')).toBe('left');
    expect(message.querySelectorAll('button').map((x) => x.getAttribute('data-test'))).toEqual(['message-home']);
    expect(text(b, 'message-detail')).toBe('0–0'); // the scoreboard's, as the fake words it
    button(b, 'message-home').click();
    expect([b.look().screen, b.r.location.hash()]).toEqual(['home', '']);
  });

  it("moves the game to the tab that takes the lock: the old tab's match closed with no LEAVE, its terrier played on there (D-24)", async () => {
    const world = new World(47);
    const a = page(world, 0);
    await started(a);
    const id = await propose(world, a);
    button(a, 'play-0').click();
    const locks = new Locks();
    const storage = new MemoryStorage();
    const b = page(world, 1, { hash: `#join=${id}`, locks, storage });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    button(b, 'play-1').click();
    await until(world, () => inRosterOf(a, b.tab.me), 5000);
    const m = held(b);
    // A second tab of the same browser, by the same link: another tab holds the lock.
    const b2 = page(world, 1, { hash: `#join=${id}`, locks, storage });
    await b2.r.app.start();
    expect(b2.look()).toMatchObject({ screen: 'message', message: 'other-tab', match: null });
    expect(b2.r.rooms).toEqual([]);
    // Use here: the first tab closes its match, sending no LEAVE, and says so.
    button(b2, 'message-useHere').click();
    await settle();
    expect(b.look()).toMatchObject({ screen: 'message', message: 'other-tab', match: null });
    expect(m.status().closed).toBe(true);
    expect(m.session.timeline.eventsInFlight(b.tab.me) & LEAVE).toBe(0);
    world.tabs.splice(world.tabs.indexOf(b.tab), 1);
    // The new tab takes the same terrier back by the link, skipping Join.
    expect(b2.look().screen).toBe('join');
    await until(world, () => b2.look().screen === 'prematch', 5000);
    expect(b2.look().match).toMatchObject({ returning: true, inRoster: true, matchId: id });
    expect(inRosterOf(a, b.tab.me)).toBe(true);
    // A Home code that isn't one, on the new tab's Home, contacts nothing.
    button(b2, 'prematch-leave').click();
    only(screenOf(b2), 'input[data-test="code"]').value = 'not a code';
    only(screenOf(b2), 'form').dispatchEvent(new FakeEvent('submit', { bubbles: true, cancelable: true }));
    expect([b2.look().screen, b2.r.rooms.length]).toEqual(['home', 1]);
  });
});

describe("a duplicate ID and a room opened again under its ID (§5.10, C-12, D-21; phase 2d's review)", () => {
  /** A duplicate's refusal stands once it has outlasted a lingering connection's silence and a handshake. */
  const DUPLICATE_HOLD_MS = (config.duplicateIdSilentSeconds + config.handshakeTimeoutSeconds) * 1000;
  /** Warm-up's removal of a silent player's terrier (roslambo Q-15). */
  const REMOVAL_MS = (config.removalSilentTicks / config.ticksPerSecond) * 1000;

  /** Runs the world 20 ms at a time until cond holds, at most ms, p meeting `others` again every 240 ms as
   *  Trystero's announcements bring a refused pair together, and each look of p's at its end to `each`. */
  async function retrying(world: World, p: Page, others: readonly Page[], id: string, cond: () => boolean, ms: number, each: (i: Inspection) => void): Promise<void> {
    for (let t = 0; t < ms && !cond(); t += 20) {
      if (t % 240 === 0) meetAgain(p, others, id);
      world.run(20);
      await settle();
      each(p.look());
    }
    if (!cond()) throw new Error(`not reached within ${ms} ms of virtual time: ${JSON.stringify(p.look().match)}`);
  }

  it("lets a killed tab's page, reopened, come back to its terrier by itself once its old connection has gone silent, never saying it's open in another tab (C-12)", async () => {
    const world = new World(59);
    const a = page(world, 0);
    await started(a);
    const id = await propose(world, a);
    button(a, 'play-0').click();
    const storage = new MemoryStorage();
    const b = page(world, 1, { hash: `#join=${id}`, storage });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    button(b, 'play-1').click();
    await until(world, () => inRosterOf(a, b.tab.me) && inRosterOf(b, b.tab.me), 5000);
    // The OS kills b's tab: its page runs nothing more, and its connection lingers at the keeper, silent.
    world.freeze(b.tab);
    const killed = world.now;
    world.run(300);
    // The same browser opens the link again: refused as a duplicate while the old connection was heard
    // within 2 s, then let in once it hadn't been, replacing it, and back in its terrier.
    const again = page(world, 1, { hash: `#join=${id}`, storage });
    await started(again);
    const seen = { refused: false, messages: [] as string[] };
    await retrying(world, again, [a], id, () => again.look().screen === 'prematch', REMOVAL_MS, (i) => {
      if (i.match?.refusal === REFUSAL.DUPLICATE) seen.refused = true;
      if (i.message !== null) seen.messages.push(i.message);
    });
    expect(seen, 'refused as a duplicate, and no message for it').toEqual({ refused: true, messages: [] });
    expect(again.look().match).toMatchObject({ returning: true, inRoster: true, peers: 1 });
    expect(world.now - killed, "back before warm-up's removal took its terrier").toBeLessThan(REMOVAL_MS);
    // The keeper kept the terrier, its old connection replaced by the new one (C-12).
    world.run(500);
    expect([inRosterOf(a, again.tab.me), held(a).status().peers]).toEqual([true, 1]);
  });

  it("says this match is open in another tab or window of a live duplicate once its refusal has stood a lingering connection's silence and a handshake, and lets it in by Try again once the other has gone", async () => {
    const world = new World(61);
    const a = page(world, 0);
    await started(a);
    const id = await propose(world, a);
    button(a, 'play-0').click();
    const b = page(world, 1, { hash: `#join=${id}` });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    button(b, 'watch').click();
    await until(world, () => held(a).status().peers === 1, 3000);
    // The same player in another browser window, as without Web Locks: refused while b's connection is heard.
    const c = page(world, 1, { hash: `#join=${id}` });
    await started(c);
    let refusedAt: number | null = null;
    await retrying(world, c, [a, b], id, () => c.look().screen === 'message', DUPLICATE_HOLD_MS + 5000, (i) => {
      if (refusedAt === null && i.match?.refusal === REFUSAL.DUPLICATE) refusedAt = world.now;
      if (i.screen === 'message') return;
      expect(i.screen, 'connecting while refused').toBe('join');
    });
    expect(c.look()).toMatchObject({ screen: 'message', message: 'duplicate', match: null });
    const stood = world.now - refusedAt!;
    expect(stood, 'the refusal held for a silence and a handshake').toBeGreaterThanOrEqual(DUPLICATE_HOLD_MS - 40);
    expect(stood).toBeLessThan(DUPLICATE_HOLD_MS + 200);
    // b leaves, then Try again: c is let in, its choices offered.
    button(b, 'prematch-leave').click();
    await until(world, () => held(a).status().peers === 0, 3000);
    button(c, 'message-tryAgain').click();
    await settle();
    await until(world, () => c.look().screen === 'join' && only(screenOf(c), '.join-packs').hidden === false, 5000);
    expect([c.look().message, c.look().match?.peers]).toEqual([null, 1]);
  });

  it("opens a match's room again only once the room it left there in its grace has closed, as Trystero hands back a room still open under its ID: a Leave, then Join by code at once (players-1, screens-msg-F2)", async () => {
    const world = new World(67);
    const a = page(world, 0);
    await started(a);
    const id = await propose(world, a);
    button(a, 'play-0').click();
    const b = page(world, 1, { hash: `#join=${id}`, trysteroRooms: true });
    await started(b);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 5000);
    button(b, 'watch').click();
    await until(world, () => held(a).status().peers === 1, 3000);
    const left = held(b);
    button(b, 'prematch-leave').click();
    expect([b.look().screen, left.status().closed]).toEqual(['home', false]); // its LEAVE going out in its grace
    // Join by its code at once: the room opens once the left one has closed, and meets the keeper.
    only(screenOf(b), 'input[data-test="code"]').value = formatMatchId(id);
    only(screenOf(b), 'form').dispatchEvent(new FakeEvent('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect([b.look().screen, b.r.rooms.length]).toEqual(['join', 1]);
    await until(world, () => b.r.rooms.length === 2, 1000);
    expect(left.status().closed, 'the left room closed before the next opened').toBe(true);
    await until(world, () => only(screenOf(b), '.join-packs').hidden === false, 3000);
    expect(b.look().match).toMatchObject({ matchId: id, peers: 1 });
  });
});
