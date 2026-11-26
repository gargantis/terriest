import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import type { HostedBot } from '../core/session/bots';
import { defaultParams, findTerrier, IN_PLAY, type MatchState, paramsFor, type SimParams, WARM_UP } from '../core/sim/index';
import { HOUSE_RULES } from '../core/sim/scripts';
import { expectAgreement, NetPump, oldest, TEST_BUILD } from '../core/timeline/testing';
import { GameSession, NET, type Node, uniform } from './freezes-testing';
import { LoopbackNet } from './loopback';

// A match under match rules over the loopback network (C-59; PLAN §8, A.1;
// M3's design, research/m3/DESIGN.md, §4.6, §4.8): the proposer's rules are
// in its genesis, and from there in every STATE, the codec's version 2
// (A.1), so a joiner and a spectator hold them from the first state they
// adopt, in warm-up or in play, and every page steps by the parameters
// they make (paramsFor), the only ones step() takes for them. A joiner's
// bots think by them too: one added before the joiner held the match, as
// Play again's are, its brain made by the host's parameters and made again
// at its first thought, and one added once it held it. Into play, every
// page's final state carries the rules, every page holds one hash at each
// final tick they share, and the idle joiner's terrier keeps the rules' own
// full zoomies meter, not the build's: the simulation everywhere played by
// them. And a page reloaded in play takes its terrier back and hosts its
// bots again from the state, their brains made by the rules' parameters
// (D-17). Each about ten seconds of virtual time, 2 a side.

// Matches in virtual time: CPU-bound, as the network's suites are.
vi.setConfig({ testTimeout: 60_000 });

const P = defaultParams;
const B = defaultBotParams;
/** The parameters the house rules make: the match's own. */
const RULED = paramsFor(HOUSE_RULES);
const MATCH = 'c59c59c59c59c59c'; // not a setting: a timeline ID
const id = (k: number): string => personId(59, k);
// The room's schedule, in virtual time.
const JOIN_EVERY_MS = 300; // not a setting: the lobby's pace
const SECOND_BOT_MS = 2000; // not a setting: once the joiner is in the roster
const READY_MS = 2500; // not a setting: Ready on both, the bots ready from their JOINs
const IN_PLAY_MS = 8500; // not a setting: past the start countdown, in play
const END_MS = 10_000; // not a setting: in play still

type Room = NetPump<LoopbackNet>;

/** Page `node`, n<k> by default: player id(k)'s session as NetGame drives it, its person on `script`,
 *  made again from each base onControl hands it (D-10); page 0 verifies its chain at 8 (design §8.3). */
function page(room: Room, k: number, script: ScriptName, node = `n${k}`): Node {
  const me = id(k);
  return room.net.add(
    node,
    room.peer(
      (link, mode) => {
        const s = new GameSession({ P, B, net: NET, me, name: `P${k}`, coat: k, build: TEST_BUILD, forwarding: true, mode, verify: k === 0 ? 8 : 0 }, link);
        let sample = scriptSampler(script, me, 0, P, B);
        s.controls = () => sample(s.timeline.head, s.timeline.headTick);
        s.onControl = (base) => {
          sample = scriptSampler(script, me, base, P, B);
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

/** The parameters a hosted bot's brain thinks by: its mind's own (src/core/bot/brain.ts), which each
 *  think() reads. */
const thinksBy = (b: HostedBot): SimParams => (b.brain as unknown as { readonly P: SimParams }).P;
const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;

interface Lobby {
  readonly keeper: Node;
  readonly joiner: Node;
  readonly watcher: Node;
  /** The joiner's bot added before it held the match, once it's added. */
  readonly early: () => HostedBot;
}

/** The keeper proposes under the house rules and plays pack A, on the brain's script; the joiner plays
 *  pack B, idle, and hosts a bot for each pack, pack A's added before it holds the match, as Play
 *  again's are, its brain made by the host's parameters then, and pack B's once it's in the roster; a
 *  spectator watches. Both packs full, the people Ready at 2.5 s: in play by 8 s. */
function lobby(room: Room): Lobby {
  const net = room.net;
  const keeper = page(room, 0, 'brain');
  const joiner = page(room, 1, 'none');
  const watcher = page(room, 2, 'none');
  net.join(keeper, 0, (now) => {
    keeper.session.propose(keeper.local(now), { packSize: 2, matchMinutes: 1, rules: HOUSE_RULES }, MATCH);
    keeper.session.play(0);
  });
  let early: HostedBot | null = null;
  net.join(joiner, JOIN_EVERY_MS, () => {
    joiner.session.play(1);
    expect(joiner.session.timeline.started).toBe(false);
    expect(joiner.session.addBot(0)).toBe(true);
    early = joiner.session.bots.hosted[0]!;
    expect(thinksBy(early)).toBe(P);
  });
  net.join(watcher, 2 * JOIN_EVERY_MS, () => watcher.session.watch());
  net.at(SECOND_BOT_MS, () => {
    expect(findTerrier(finalOf(joiner), id(1))).toBeGreaterThanOrEqual(0);
    expect(joiner.session.addBot(1)).toBe(true);
  });
  net.at(READY_MS, () => {
    for (const p of [keeper, joiner]) p.session.ready(true);
  });
  return { keeper, joiner, watcher, early: () => early! };
}

/** One match: nothing closed, the drawn head's contract held everywhere, the keeper's chain its full
 *  replay's, and one hash at each final tick the pages share. */
function expectOneMatch(room: Room, pages: readonly Node[]): void {
  expect([room.net.drops, pages.map((p) => p.session.dropped)]).toEqual([[], pages.map(() => [])]);
  expect(room.problems).toEqual([]);
  for (const x of room.nodes) expect(x.t.stats.verifyMismatches, `page ${x.k}`).toBe(0);
  expectAgreement(pages.map((p) => ({ t: p.session.timeline })));
}

describe('a match under match rules over the network (C-59)', () => {
  it("carries the proposer's rules to a joiner, its bots and spectators, every page stepping by them into play", () => {
    // The house rules' zoomies meter isn't the build's, so a terrier's full meter tells which a page stepped by.
    expect(RULED.meterFull).not.toBe(P.meterFull);
    const room: Room = new NetPump(new LoopbackNet(59, uniform(59 * 5, 30, 60, 20)));
    const net = room.net;
    const { keeper, joiner, watcher, early } = lobby(room);
    // A second spectator once play has begun: the STATE it adopts is one in play.
    const late = page(room, 3, 'none');
    net.join(late, IN_PLAY_MS, () => late.session.watch());
    const pages = [keeper, joiner, watcher, late];
    room.run(READY_MS - 50);

    // Held on every page but the late one, each with the keeper's rules from the STATE it adopted, in warm-up.
    expect(late.session.timeline.started).toBe(false);
    for (const [k, p] of [keeper, joiner, watcher].entries()) {
      const t = p.session.timeline;
      expect([t.started, t.final.phase, t.final.rules], `page ${k}`).toEqual([true, WARM_UP, HOUSE_RULES]);
      expect(t.params, `page ${k}`).toBe(RULED);
    }
    // The early bot's brain made again at its first thought in the match, by its parameters.
    expect(thinksBy(early())).toBe(RULED);

    room.run(END_MS - net.now);
    const bots = joiner.session.bots.hosted;
    expect(bots.map((b) => [b.pack, b.wanted])).toEqual([[0, true], [1, true]]);
    expect(bots[0]).toBe(early());
    for (const b of bots) expect(thinksBy(b), b.id).toBe(RULED);
    const ids = [id(0), id(1), ...bots.map((b) => b.id)].sort();
    for (const [k, p] of pages.entries()) {
      const F = finalOf(p);
      const label = `page ${k}: ${JSON.stringify(p.session.timeline.stats.log.slice(-4))}`;
      // Into play, the two people and the joiner's two bots in the roster, under the rules, by the
      // parameters they make.
      expect([F.phase, F.terriers.map((T) => T.id).sort(), F.rules], label).toEqual([IN_PLAY, ids, HOUSE_RULES]);
      expect(p.session.timeline.params, label).toBe(RULED);
      // The idle joiner never zooms: its meter is the rules' full one, set at its joining and its kickoff.
      expect(F.terriers[findTerrier(F, id(1))]!.meter, label).toBe(RULED.meterFull);
      // Every bot's input reached every page: each sent into play.
      for (const b of bots) expect(F.terriers[findTerrier(F, b.id)]!.lastInputTick, `${label}: ${b.id}`).toBeGreaterThan(F.phaseStart);
    }
    // The late spectator took the match in play, under its rules, as the others hold it.
    expect(oldest(late.session.timeline)).toBeGreaterThan(finalOf(keeper).phaseStart);
    for (const p of [watcher, late]) expect(p.session.inRoster(), p.id).toBe(false);
    expectOneMatch(room, pages);
  });

  it("hosts a page's bots again by the rules when it reloads in play, its terrier taken back (D-17)", () => {
    const room: Room = new NetPump(new LoopbackNet(61, uniform(61 * 5, 30, 60, 20)));
    const net = room.net;
    const { keeper, joiner, watcher } = lobby(room);
    // The joiner's page goes in play, as a reload does, and the same browser opens the match again.
    net.leave(joiner, IN_PLAY_MS);
    const back = page(room, 1, 'none', 'back');
    net.join(back, IN_PLAY_MS + JOIN_EVERY_MS);
    // Its bots' brains as its adoption of the STATE hosts them again, before any thought: by the rules'
    // parameters already, so none is made again, and each keeps the press counters its terrier's stored
    // input gave it (D-10).
    const adoptions: (readonly SimParams[])[] = [];
    const take = back.session.onMessage.bind(back.session);
    back.session.onMessage = (peer: string, bytes: Uint8Array, now: number): void => {
      const held = back.session.timeline.started;
      take(peer, bytes, now);
      if (!held && back.session.timeline.started) adoptions.push(back.session.bots.hosted.map(thinksBy));
    };
    room.run(IN_PLAY_MS);
    const before = joiner.session.bots.hosted;
    expect([finalOf(keeper).phase, before.map((b) => thinksBy(b))]).toEqual([IN_PLAY, [RULED, RULED]]);
    room.run(END_MS - net.now);
    // Back in its terrier, skipping Join, under the rules.
    const t = back.session.timeline;
    expect([back.session.returning, back.session.inRoster(), t.final.rules]).toEqual([true, true, HOUSE_RULES]);
    expect(t.params).toBe(RULED);
    // Its bots hosted again from the state's roster, each brain made by the rules' parameters, and each
    // driven again: its input in every page's final state since the return.
    const bots = back.session.bots.hosted;
    expect(bots.map((b) => [b.id, b.pack, b.wanted])).toEqual(before.map((b) => [b.id, b.pack, true]));
    expect(adoptions.map((brains) => brains.map((x) => x === RULED))).toEqual([[true, true]]);
    for (const b of bots) expect(thinksBy(b), b.id).toBe(RULED);
    const returned = oldest(t);
    for (const p of [keeper, watcher, back]) {
      const F = finalOf(p);
      expect([F.phase, F.rules], p.id).toEqual([IN_PLAY, HOUSE_RULES]);
      for (const b of bots) expect(F.terriers[findTerrier(F, b.id)]!.lastInputTick, `${p.id}: ${b.id}`).toBeGreaterThan(returned);
    }
    expectOneMatch(room, [keeper, watcher, back]);
  });
});
