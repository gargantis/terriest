import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { personId } from '../core/bot/bot-id';
import { nextMatchId } from '../core/match-id';
import type { RoomPeer } from '../core/session/room-peer';
import type { Transport, TransportOptions } from '../net/transport';
import type { MatchNetSummary } from '../core/session/index';
import { type AppRig, appRig, type AppRigOptions } from './app-testing';
import { FakeClock } from './clock-testing';
import { type FakeDocument, type FakeElement, installDom, only } from './dom-testing';
import type { TransportFactory } from './game';
import type { Inspection } from './inspect';
import { audioOut } from './layers/sound';
import type { Match } from './match-types';
import { againText } from './screens/results';
import { readoutLines } from './screens/readout';
import { type Tab, World } from './world-testing';

// A networked match to its end through the app, and Play again (M4's
// design §5.9, §5.11, §5.2, §7; PLAN D-12, C-42, D-14, M3-Q24): one page
// over M3's network simulator proposes 1 a side, plays in pack A and hosts
// a bot in pack B, which scores against it; a second page opens the link
// and reads Join through the bot's first goal, then watches, its pitch
// screen whistling none of what its scoreboard latched before; at the
// confirmed end, Results on both, the leave guard off, and the app's wake
// lock never wanted past Created; the watcher's network figures a match
// with others', as its match summed them; then Play again, past Results'
// guard, into the derived room's Pre-match, with no Join, the fragment its
// ID by replace, a fresh log, its bot along, and the old room closed after
// its grace, and the new room on Settings' TURN as it is at the press, the
// watcher's Play again then reading "Join the next match". A whole match,
// so a file of its own (CLAUDE.md).

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

/** Page k in `world`: an App whose clock the world runs and whose rooms are the world's, each a node of its own. */
function page(world: World, k: number, o: Omit<AppRigOptions, 'doc' | 'clock' | 'transport' | 'me'> = {}): AppRig {
  const clock = new FakeClock(world.now);
  const tab = { k, me: personId(7, k), clock, page: null, rooms: new Map(), frozen: false } as unknown as Tab;
  let nodes = 0;
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
  return r;
}

describe('Results and Play again in a networked match (§5.9)', () => {
  it("plays to the confirmed end, then into the derived room's Pre-match, the fragment its ID, its bot along (D-12, C-42)", async () => {
    const world = new World(53);
    const r = page(world, 0);
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
    // The watcher opens the link and reads Join while the bot scores: its scoreboard latches the goal there.
    const w = page(world, 1, { hash: `#join=${id}` });
    const wLook = (): Inspection => w.test.inspect!();
    const wScreen = (): FakeElement => only(w.root, '[id="screen"]');
    const wHeld = (): Match | null => (w.app as unknown as { match: Match | null }).match;
    await w.app.start();
    w.frames.run();
    w.clock.advance(0);
    await w.stages[0]!.finish();
    await until(() => wLook().screen === 'join' && wHeld()?.scoreboard.goals.length === 1, 120_000);
    world.run(2000);
    await settle();
    expect([wLook().screen, wHeld()!.scoreboard.goals.length]).toEqual(['join', 1]);
    // Watch: its pitch screen's sound whistles none of what was latched before it (§7). Both pages' sound is
    // one AudioOut here, so each page's goals latched meanwhile are the only whistles.
    const decided = (): readonly [number, number] => [audioOut().inspect().decided.whistleGoal, audioOut().inspect().decided.chorus];
    const goals = (): number => held().scoreboard.goals.length + wHeld()!.scoreboard.goals.length;
    const before = decided();
    const goalsBefore = goals();
    only(wScreen(), 'button[data-test="watch"]').click();
    expect(wLook().screen).toMatch(/^(prematch|match)$/);
    world.run(200);
    await settle();
    const latched = goals() - goalsBefore;
    expect([decided()[0] - before[0], decided()[1] - before[1]]).toEqual([latched, latched]);
    // The watcher's figures as Results reads them, once, at its entry.
    let atEntry: MatchNetSummary | null = null;
    const watched = wHeld()!;
    const summary = watched.summary.bind(watched);
    watched.summary = () => (atEntry = summary());
    // The bot scores against a pack that doesn't defend (Q-9), so the match is decided at 0:00.
    await until(() => look().screen === 'results' && wLook().screen === 'results', 240_000);
    const end = look().match!.end!;
    expect(end.winner).toBe(1);
    expect([r.guard.active, r.wakes, look().announcements!.matchId]).toEqual([false, [true, false], id]);
    // A match with others' figures on the watcher's Results (M3-Q24): its late inputs, resyncs and repairs
    // among them, each as its match summed it.
    expect(atEntry).not.toBeNull();
    const lines = readoutLines(atEntry!, false);
    expect(lines.map((l) => l.test)).toEqual(['ticks', 'inputs', 'late', 'late-absent', 'rollbacks', 'resyncs', 'corrections', 'repairs']);
    for (const l of lines) expect(only(wScreen(), `dd[data-test="readout-${l.test}"]`).textContent, l.test).toBe(l.value);
    expect(atEntry!.rollbacks).toBeGreaterThan(0); // the watcher's timeline rolled back for inputs it took late
    expect(only(wScreen(), 'button[data-test="again"]').textContent).toBe(againText(false));
    // A TURN server added since the match began: it applies from the next match, Play again's (§6).
    const turn = [{ urls: 'turns:turn.example:443', username: 'u', credential: 'c' }];
    expect(r.settings.set({ turn })).toBeNull();
    // Play again, once Results' guard has passed (Q-17): the derived room's Pre-match, no Join between.
    world.run(config.resultsPressGuardSeconds * 1000);
    await settle();
    // The two pages share one document here, and the watcher's Results took its focus last.
    button('again').focus();
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
    // The watcher heard the AGAIN: its Play again now joins the next match (roslambo's).
    expect(only(wScreen(), 'button[data-test="again"]').textContent).toBe(againText(true));
  });
});
