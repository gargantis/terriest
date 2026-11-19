import { describe, expect, it, vi } from 'vitest';
import { botId } from '../bot/bot-id';
import { NO_TICK, T, ZERO_HASH } from '../protocol/messages';
import { netSettings } from '../session/settings';
import { encodeInput, FRAME_BALL, FRAME_PITCH, hashState, IN_PLAY, type InputParts, JOIN, READY } from '../sim';
import { expectAgreement, inside, type Mode, Pump, type PumpNode, twin } from './testing';
import type { Timeline } from './timeline';

// The timeline over the test pump, no transport (design §2, §3, §8.3), as
// timeline.test.ts has it: three browsers and a bot in agreement from
// genesis into play, against a full replay; and a resync with its votes,
// after a dropped input. Every timeline verifies its chain after every
// advance (verify: 1), and the pump checks the drawn head's contract after
// each. Split from timeline.test.ts for design §13's 8 s a file.

// Whole matches in virtual time, twice each for the full replay: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const W = NET.timeline.window;
const V = NET.timeline.voteWindow;
const MATCH = 'feedfacecafebeef';

const playerId = (k: number): string => (0xa0 + k).toString(16).padStart(32, '0');

// --- The pump (testing.ts): timelines in virtual time, with latency, jitter and FIFO links ---

type Node = PumpNode;

/** A pump of this file's players, keeping their corrections. */
const pump = (mode: Mode = 'incremental'): Pump => new Pump({ mode, ids: playerId, corrections: true });

/** A person's wandering input, from its node and local tick: a step that changes every 16 ticks,
 *  held most of the time, zoomies in spells, a jump and a pounce now and then, and a bark counter
 *  that turns every 8 ticks, which the simulation never reads. */
function wander(k: number, t: Timeline): () => number {
  return () => {
    const n = t.localTick;
    const p: InputParts = { frame: FRAME_PITCH, zoomies: ((n >> 7) + k) % 3 === 0, jump: (n >> 6) & 3, pounce: (n >> 8) & 3, bark: (n >> 3) & 3 };
    if (((n >> 5) + k) % 4 !== 0) p.step = ((n >> 4) * 7 + k * 5) & 31;
    return encodeInput(p);
  };
}

/** A bot's input from the drawn head, as a hosted bot reads it (§1.11): every 8th head tick a step
 *  from the head's hash, held between. */
function chase(t: Timeline): () => number {
  let input = 0;
  let at = -1;
  return () => {
    if (t.headTick !== at && (t.headTick & 7) === 0) input = encodeInput({ step: parseInt(hashState(t.head).slice(0, 2), 16) & 31, frame: FRAME_BALL });
    at = t.headTick;
    return input;
  };
}

/** n starts from one genesis and plays in a pack: JOIN, and READY if asked. */
function plays(n: Node, pack: number, ready = true, packSize = 2): void {
  n.t.start(0, { packSize, matchMinutes: 1 }, MATCH);
  n.t.sending = true;
  n.t.controls = wander(n.k, n.t);
  n.t.queueEvent(n.id, { events: JOIN | (ready ? READY : 0), joinPack: pack, coat: n.k, name: `P${n.k}` });
}

// --- A match ---

describe('three browsers and a hosted bot (§2, §3)', () => {
  it('agree on every final tick from genesis through the start countdown into play, as a full replay does', () => {
    const p = twin(pump, (q) => {
      const nodes = [q.add(), q.add(), q.add()];
      nodes.forEach((n, k) => plays(n, k % 2));
      const host = nodes[2]!;
      const bot = botId(host.id, 0);
      host.t.bots.set(bot, chase(host.t));
      host.t.queueEvent(bot, { events: JOIN | READY, joinPack: 1, coat: 6, name: 'Bot' });
      q.run(8000);
    });
    const a = p.nodes[0]!.t;
    expect(a.final.phase).toBe(IN_PLAY);
    expect(a.final.terriers.length).toBe(4);
    expectAgreement(p.nodes);
    for (const n of p.nodes) {
      const s = n.t.stats;
      expect([s.disagree, s.resyncs, s.resyncFailed, s.split]).toEqual([0, 0, 0, 0]);
      expect(s.agree).toBeGreaterThan(400);
      // Most finals reuse their prediction; the rest stepped where the chain had been recomputed.
      expect(s.reusedFinals).toBeGreaterThan(s.steppedFinals);
      expect(s.rollbacks).toBeGreaterThan(0);
      expect(s.corrections).toBeGreaterThan(0);
      // A normal tick is never spread (§2.8): the cap covers w + 1.
      expect(s.spreadTicks).toBe(0);
      expect(s.maxStepsPerAdvance).toBeLessThanOrEqual(W + 2);
      expect(n.t.isConfirmed(n.t.finalTick - V)).toBe(true);
      expect(n.t.isConfirmed(n.t.finalTick + 1)).toBe(false);
    }
  });
});

// --- A resync (§3.1, §3.4, §3.6) ---

describe('a resync after a dropped input (§3.1, §3.4, §3.6)', () => {
  /** b misses one of a's TICKs: held back past the late window, so b finalises a absent there,
   *  loses the tally 2 to 1 and repairs from a or c. */
  function dropped(q: Pump): void {
    const nodes = [q.add(), q.add(), q.add()];
    nodes.forEach((n, k) => plays(n, k % 2, false));
    q.run(1500);
    let once = true;
    q.rules.push((from, to, m) => {
      if (once && from.k === 0 && to.k === 1 && m.type === T.TICK) {
        once = false;
        return 400;
      }
      return 0;
    });
    q.run(3500);
  }

  it('repairs the dissenter: no vote sent and no STATE answered while outstanding, its own votes replaced, every hash equal after', () => {
    const p = twin(pump, dropped);
    const [a, b, c] = p.nodes as [Node, Node, Node];
    expectAgreement(p.nodes);
    expect(b.t.stats.resyncs).toBe(1);
    expect(b.t.stats.disagree).toBeGreaterThan(0);
    expect([a.t.stats.resyncs, c.t.stats.resyncs]).toEqual([0, 0]);
    expect(a.t.stats.statesSent + c.t.stats.statesSent).toBe(1);
    const repairs = b.corrections.filter((x) => x.repair);
    expect(repairs.length).toBe(1);
    expect(repairs[0]!.from).toBeLessThanOrEqual(repairs[0]!.tick);
  });

  it("books b's repaired votes in place of its stale ones, and sends none while it waits", () => {
    const q = pump();
    const watch: { voted: number; waiting: number; refused: boolean } = { voted: 0, waiting: 0, refused: false };
    const nodes = [q.add(), q.add(), q.add()];
    nodes.forEach((n, k) => plays(n, k % 2, false));
    q.run(1500);
    let once = true;
    q.rules.push((from, to, m) => {
      if (from.k === 1 && m.type === T.TICK && m.voteTick !== NO_TICK && nodes[1]!.t.repairing) watch.voted++;
      if (once && from.k === 0 && to.k === 1 && m.type === T.TICK) {
        once = false;
        return 400;
      }
      return 0;
    });
    const b = nodes[1]!.t;
    q.run(3500, () => {
      if (b.repairing) watch.waiting++;
      // A STATE_REQ to b while its resync is outstanding is refused (§3.6's second rule).
      if (!b.answering && b.started && !watch.refused) {
        watch.refused = !b.onStateReq('probe', { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }, q.now);
      }
    });
    expect(b.stats.resyncs).toBe(1);
    expect(watch.waiting).toBeGreaterThan(0);
    expect(watch.voted).toBe(0);
    expect(watch.refused).toBe(true);
    // The book holds b's vote for each re-finalised tick under the winner's hash.
    const book = inside(b).book;
    const g = Number(b.stats.log.find(([, e]) => e.startsWith('STATE '))![1].slice(6));
    for (let u = g + 1; u <= g + 10; u++) expect(book.voters(u, b.hashAt(u), '')).toContain(nodes[1]!.id);
    expectAgreement(q.nodes);
  });
});
