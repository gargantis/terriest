import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { formatMatchId } from '../core/match-id';
import { findTerrier, LEAVE } from '../core/sim/index';
import type { RoomPeer } from '../core/session/room-peer';
import { CURATED_RELAYS } from '../net/room-config';
import type { Transport, TransportOptions } from '../net/transport';
import { MemoryStorage } from '../storage/kv';
import { type AppRig, appRig, type AppRigOptions, Locks } from './app-testing';
import { FakeClock } from './clock-testing';
import { type FakeDocument, type FakeElement, FakeEvent, installDom, only } from './dom-testing';
import type { TransportFactory } from './game';
import type { Inspection } from './inspect';
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
// back; a JOIN given up watching, the other pack's Play making the page a
// player again; Leave, its LEAVE out and the fragment cleared; and the tab
// lock lost mid-match, the match closed without a LEAVE, and the tab that
// took it over playing the same terrier.

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

function page(world: World, k: number, o: Omit<AppRigOptions, 'doc' | 'clock' | 'transport'> = {}): Page {
  const clock = new FakeClock(world.now);
  const tab = { k, me: o.me ?? personId(7, k), clock, page: null, rooms: new Map(), frozen: false } as unknown as Tab;
  const transport = (rooms: TransportOptions[]): TransportFactory => (peer: RoomPeer, _now, t) => {
    rooms.push(t);
    const net = world.net(t.matchId);
    let link: Transport | null = null;
    const node = net.add(`app${k}.${nodes++}@${t.matchId}`, (l) => {
      link = l;
      return peer;
    });
    net.join(node, world.now);
    tab.rooms.set(t.matchId, { net, node });
    return Promise.resolve(link!);
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
    // The hook's networked figures (§1.40).
    expect(b.look().match).toMatchObject({ kind: 'net', matchId: id, started: true, inRoster: true, returning: false });
    expect(b.look().announcements).toMatchObject({ matchId: id, arrivalTick: arrived });
    expect(b.look().match!.own.senders).toBe(1);
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
    expect(b.look().layers['net']).toEqual({ watching: true, offer: 1 });
    const notes = only(screenOf(b), '[data-test="watching"]');
    expect([notes.hidden, notes.getAttribute('role')]).toEqual([false, 'status']);
    expect(notes.textContent).toBe('This match is full, so you’re watching it.Play in the Orange pack');
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
