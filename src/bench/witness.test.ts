import { describe, expect, it, vi } from 'vitest';
import { defaultBotParams } from '../core/bot/brain';
import { personId } from '../core/bot/bot-id';
import { scriptSampler } from '../core/bot/setups';
import { netSettings } from '../core/session/settings';
import { defaultParams, IN_PLAY } from '../core/sim/index';
import { TEST_BUILD } from '../core/timeline/testing';
import { FakeClock, fakePage } from '../ui/clock-testing';
import { type NetMatch, openNetMatch } from '../ui/match';
import { decode, type StateMsg, T } from '../core/protocol/messages';
import { type FromWitness, PAGE_PEER, type ToWitness, virtualRoom, type WitnessPort } from './virtual-room';
import { serveWitness, type WitnessScope } from './witness';

// The forced repair with its witness (M4's design, research/m4/DESIGN.md, §1.53, §2.11, §8.3; M3-Q14,
// M4-Q16), in virtual time: the page's real NetGame over the bench's room, and the witness's real
// Session and timeline, serveWitness on a scope whose messages each way go a task later, cloned as a
// Worker's postMessage clones them. The witness joins the page's timeline from a STATE and plays one of
// the seven; the room's others vote its final hashes. From 1 s into play every message to the page is
// held 4,100 ms, FIFO: the page finalises its peers' inputs absent, tallies alone, and when the late
// votes come it loses, asks one of the voters for a STATE, the witness answers as that voter, and the
// page repairs from about 240 ticks back, then agrees again. A whole repair, so a file of its own.

vi.setConfig({ testTimeout: 90_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const ME = personId(7, 0);
const WITNESS = personId(7, 1);

/** The Worker, in-process: what each side posts reaches the other a task later, cloned, or what the room
 *  posts `lag(m)` ms later; each of the witness's posts is seen first. */
function inProcess(
  clock: FakeClock, seen: (m: FromWitness) => void, lag: (m: ToWitness) => number = () => 0,
): { port: WitnessPort; scope: WitnessScope; terminated: () => boolean } {
  let terminated = false;
  const scope: WitnessScope = {
    postMessage: (m: FromWitness) => {
      seen(m);
      if (!terminated) clock.after(0, () => port.onmessage?.({ data: structuredClone(m) } as MessageEvent<FromWitness>));
    },
    onmessage: null,
  };
  const port: WitnessPort = {
    postMessage: (m: ToWitness) => {
      if (!terminated) clock.after(lag(m), () => scope.onmessage?.({ data: structuredClone(m) }));
    },
    onmessage: null,
    onerror: null,
    terminate: () => {
      terminated = true;
    },
  };
  return { port, scope, terminated: () => terminated };
}

describe("the forced repair's witness (§1.53, M3-Q14)", () => {
  it('joins and plays, and the page held for 4.1 s in play repairs from its STATE, about 240 ticks back, then agrees again', async () => {
    const clock = new FakeClock(1000);
    // Each STATE the witness sends the page: the tick it's at, and the page's local tick as it went.
    const states: { g: number; local: number }[] = [];
    let localTick = (): number => -1;
    const worker = inProcess(clock, (x) => {
      if (x.kind !== 'send' || x.to !== PAGE_PEER || x.bytes[0] !== T.STATE) return;
      const state = decode(x.bytes) as StateMsg;
      states.push({ g: state.g, local: localTick() });
    });
    serveWitness(worker.scope, clock, 0);
    const room = virtualRoom({
      peers: 7, seed: 7, latencyMs: [20, 80], jitterMs: 15, build: TEST_BUILD, capacityPerSecond: null, holdAtMs: 1000, holdMs: 4100,
      witness: true, clock, origin: 0, task: (fn) => clock.after(0, fn), worker: () => worker.port,
    });
    const m: NetMatch = await openNetMatch({
      matchId: 'feedfacecafebeef', me: ME, name: 'Bench', coat: 0, build: TEST_BUILD, relays: null, ice: 'none', clock, page: fakePage(),
      transport: room,
    });
    room.attach(() => m.session.timeline);
    localTick = () => m.session.timeline.localTick;
    m.propose({ packSize: 4, matchMinutes: 1 });
    m.play(0);
    let sample = scriptSampler('brain', ME, 0, P, B);
    m.setControls((head, headTick) => sample(head, headTick), (base) => {
      sample = scriptSampler('brain', ME, base, P, B);
    });
    let readied = false;
    m.subscribe({
      run: () => {
        if (!readied && m.session.inRoster()) {
          readied = true;
          m.ready(true);
        }
      },
    });
    const t = (): typeof m.session.timeline => m.session.timeline;
    // The witness joins the page's timeline from a STATE, then its pack, as any joiner does.
    clock.until(() => t().final.terriers.length === 8, 10_000);
    expect(t().final.terriers.map((x) => x.id)).toContain(WITNESS);
    expect(room.report().witness).toBe('worker');
    clock.until(() => t().final.phase === IN_PLAY, 15_000);
    // Until the hold, the witness's hashes and the page's agree.
    clock.until(() => room.report().hold !== null, 2000);
    expect([t().stats.disagree, t().stats.resyncs]).toEqual([0, 0]);
    const hold = room.report().hold!;
    clock.until(() => t().stats.resyncs >= 1, 20_000);
    const s = t().stats;
    // It lost a tally to the late votes, and repaired from the witness's STATE.
    expect(s.disagree + s.lateVoteFlips).toBeGreaterThan(0);
    expect(s.lateAbsent).toBeGreaterThan(1000);
    const report = room.report();
    expect(report.witnessStates).toBeGreaterThanOrEqual(1);
    expect(report.witnessError).toBe(null);
    // From about 240 ticks back: the hold's length in ticks, less the late window, inside the history; the
    // room reads each STATE's ticks as the witness sends it, and the page made no repair before the hold.
    expect(states.length).toBe(report.witnessStates);
    expect(report.states.map((x) => x.g)).toEqual(states.map((x) => x.g));
    expect(report.hold!.resyncsBefore).toBe(0);
    const back = states[0]!.local - states[0]!.g;
    const held = (hold.toMs - hold.fromMs) / NET.tickMs;
    expect(back).toBeGreaterThan(held - 2 * NET.timeline.window);
    expect(back).toBeLessThan(NET.timeline.history);
    // The repair's calls are kept, the STATE's adoption among them, with its steps and its ticks as it was sent.
    const adopt = report.calls.find((c) => c.kind === 'STATE')!;
    expect(adopt.steps).toBeGreaterThan(0);
    expect(adopt.state).toEqual({ g: report.states[0]!.g, senderTick: report.states[0]!.senderTick });
    expect(report.calls.filter((c) => c.kind === 'TICK').length).toBeGreaterThan(1000);
    // Then it agrees again: no further disagreement, and nothing failed.
    const [disagreed, agreed] = [t().stats.disagree, t().stats.agree];
    clock.advance(5000);
    expect([t().stats.disagree, t().stats.resyncFailed, t().stats.resyncs]).toEqual([disagreed, 0, 1]);
    expect(t().stats.agree).toBeGreaterThan(agreed + 200);
    m.close();
    clock.advance(100);
    expect(worker.terminated()).toBe(true);
  });

  it("keeps the page's own lineage through a transient of the witness's: the witness, not the page, repairs before the hold", async () => {
    const clock = new FakeClock(1000);
    // For 4 s of warm-up, one player's TICKs reach the witness 300 ms late, past the late window, so it
    // finalises that player's inputs absent, its clock in step with the rest, and its lineage parts from
    // the page's, which has them: a transient of the witness's alone.
    const worker = inProcess(clock, () => {}, (x) => (x.kind === 'message' && x.from === 'virtual-3' && clock.now() >= 3000 && clock.now() < 7000 ? 300 : 0));
    serveWitness(worker.scope, clock, 0);
    const room = virtualRoom({
      peers: 7, seed: 7, latencyMs: [20, 80], jitterMs: 15, build: TEST_BUILD, capacityPerSecond: null, holdAtMs: 1000, holdMs: 4100,
      witness: true, clock, origin: 0, task: (fn) => clock.after(0, fn), worker: () => worker.port,
    });
    const m: NetMatch = await openNetMatch({
      matchId: 'feedfacecafebeef', me: ME, name: 'Bench', coat: 0, build: TEST_BUILD, relays: null, ice: 'none', clock, page: fakePage(),
      transport: room,
    });
    room.attach(() => m.session.timeline);
    m.propose({ packSize: 4, matchMinutes: 1 });
    m.play(0);
    let sample = scriptSampler('brain', ME, 0, P, B);
    m.setControls((head, headTick) => sample(head, headTick), (base) => {
      sample = scriptSampler('brain', ME, base, P, B);
    });
    let readied = false;
    m.subscribe({
      run: () => {
        if (!readied && m.session.inRoster()) {
          readied = true;
          m.ready(true);
        }
      },
    });
    const t = (): typeof m.session.timeline => m.session.timeline;
    clock.until(() => room.report().hold !== null, 30_000);
    // The witness lost its tallies and repaired from the page; the page kept its own, until the hold.
    expect(room.report().witnessFigures!.stats.resyncs).toBeGreaterThanOrEqual(1);
    expect([t().stats.resyncs, room.report().hold!.resyncsBefore]).toEqual([0, 0]);
    clock.until(() => t().stats.resyncs >= 1, 20_000);
    expect(room.report().witnessStates).toBeGreaterThanOrEqual(1);
    m.close();
  });
});
