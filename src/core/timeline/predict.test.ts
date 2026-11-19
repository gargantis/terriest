import { describe, expect, it, vi } from 'vitest';
import { botId } from '../bot/bot-id';
import { T } from '../protocol/messages';
import { netSettings } from '../session/settings';
import { barkCount, defaultParams, encodeInput, findTerrier, FRAME_PITCH, hashState, IN_PLAY, JOIN, KEPT_BITS, NEVER, READY } from '../sim';
import { at, inside, type Mode, Pump, type PumpNode, tickOf, twin, usedBy } from './testing';
import { Timeline } from './timeline';

// Prediction (design §2.2, §2.5, §8.3; PLAN D-10, D-11, M3-Q12): silent
// terriers predicted absent, and sitting in the predicted state; a press
// acted once, a TICK lost and filled from a later TICK's history included;
// the marks; barks never forcing a rollback; own inputs and bots recorded
// when sent. Each scenario runs twice, incremental and as a full replay,
// with every chain verified after every advance and the drawn head's
// contract checked after each (testing.ts).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const D = NET.timeline.delay;
const W = NET.timeline.window;
const MATCH = '0123456789abcdef';

const playerId = (k: number): string => (0xb0 + k).toString(16).padStart(32, '0');

// --- The pump (testing.ts): timelines in virtual time over FIFO links with latency and jitter ---

type Node = PumpNode;

/** A pump of this file's players, keeping each head it records. */
const pump = (mode: Mode): Pump => new Pump({ mode, ids: playerId, keepStates: true });

function starts(n: Node, packSize = 1): void {
  n.t.start(0, { packSize, matchMinutes: 1 }, MATCH);
}

/** n plays in pack, holding `input(localTick)`. */
function plays(n: Node, pack: number, input: (tick: number) => number, ready: boolean, packSize = 1): void {
  starts(n, packSize);
  n.t.sending = true;
  n.t.controls = () => input(n.t.localTick);
  n.t.queueEvent(n.id, { events: JOIN | (ready ? READY : 0), joinPack: pack, coat: n.k, name: `P${n.k}` });
}

const HELD = encodeInput({ step: 3, frame: FRAME_PITCH });

// --- Silent terriers (D-11) ---

describe('a silent terrier (D-11, D-16)', () => {
  it('is predicted absent once its newest tick is final, sits in the predicted state within the sit threshold plus w, and stands when it returns', () => {
    const watch: { last: number; sitAt: number; standsAt: number } = { last: -1, sitAt: -1, standsAt: -1 };
    const p = twin(pump, (q) => {
      const [a, b] = [q.add(), q.add()];
      plays(a, 0, () => HELD, true);
      plays(b, 1, () => HELD, true);
      q.run(7000);
      expect(a.t.final.phase).toBe(IN_PLAY);
      b.t.sending = false;
      q.run(150);
      const last = a.t.newestInput(b.id)!.tick;
      watch.last = last;
      let sitAt = -1;
      q.run(3000, () => {
        const k = findTerrier(a.t.head, b.id);
        const T = a.t.head.terriers[k]!;
        // Predicted absent from the tick after its newest once that's final: never a later input tick.
        if (a.t.finalTick >= last && T.lastInputTick !== last) q.problems.push(`b predicted present at ${a.t.headTick}`);
        if (sitAt < 0 && T.sitting) sitAt = a.t.headTick;
      });
      watch.sitAt = sitAt;
      b.t.sending = true;
      let standsAt = -1;
      q.run(1000, () => {
        const k = findTerrier(a.t.head, b.id);
        if (standsAt < 0 && !a.t.head.terriers[k]!.sitting) standsAt = a.t.headTick;
      });
      watch.standsAt = standsAt;
    });
    const a = p.nodes[0]!.t;
    expect(watch.sitAt).toBeGreaterThanOrEqual(watch.last + P.sitAfterTicks);
    expect(watch.sitAt).toBeLessThanOrEqual(watch.last + P.sitAfterTicks + W);
    expect(watch.standsAt).toBeGreaterThan(watch.sitAt);
    expect(a.final.terriers[findTerrier(a.final, p.nodes[1]!.id)]!.sitting).toBe(false);
    expect(a.stats.disagree).toBe(0);
  });
});

// --- Presses (D-10) ---

describe('a press (D-10)', () => {
  /** b jumps once, at its local tick 150, and holds the counter; a watches. With drop, b's TICK for
   *  the press's tick never reaches a: the next TICK's history fills it. */
  function jumpOnce(q: Pump, drop: boolean): { a: Node; b: Node; press: number } {
    const [a, b] = [q.add(), q.add()];
    const jumped = encodeInput({ jump: 1 });
    starts(a);
    plays(b, 1, (n) => (n >= 150 ? jumped : 0), false);
    const press = 150 + D;
    if (drop) q.rules.push((from, _to, m) => (from.k === 1 && m.type === T.TICK && m.t === press ? null : 0));
    q.run(5000);
    return { a, b, press };
  }

  for (const drop of [false, true]) {
    it(drop ? 'acts once when its TICK is lost and filled from a later TICK\'s history: newest stays at the newer input' : 'acts once under prediction and re-simulation', () => {
      const p = twin(pump, (q) => {
        jumpOnce(q, drop);
      });
      const [a, b] = p.nodes as [Node, Node];
      const press = 150 + D;
      // Final: one take-off, at the press's tick.
      const final = a.t.final.terriers[findTerrier(a.t.final, b.id)]!;
      expect(final.takeOffTick).toBe(press);
      expect(a.t.receivedInput(b.id, press)).toBe(encodeInput({ jump: 1 }));
      expect(a.t.newestInput(b.id)!.input).toBe(encodeInput({ jump: 1 }));
      // Every head a drew shows no take-off but the press's: a repeated press would show another.
      const offs = new Set(a.heads.map((h) => h.state!.terriers[findTerrier(h.state!, b.id)]?.takeOffTick ?? NEVER));
      expect([...offs].sort()).toEqual([press, NEVER].sort());
      // And from the tick b's press reached a on, every head equals the final state at its tick.
      const known = a.heads.filter((h) => h.tick >= press + W && h.tick <= a.t.finalTick && h.tick > a.t.finalTick - NET.timeline.history);
      expect(known.length).toBeGreaterThan(50);
      for (const h of known) expect(hashState(h.state!), `head ${h.tick}`).toBe(a.t.hashAt(h.tick));
    });
  }
});

// --- Marks (§2.2) ---

describe('the marks (§2.2)', () => {
  it("predict a catch-up's skipped ticks absent, as finalisation will make them, from the TICK's clear present bits", () => {
    const seen: string[] = [];
    twin(pump, (q) => {
      const [a, b] = [q.add(), q.add()];
      starts(a);
      plays(b, 1, () => HELD, false);
      q.run(2000);
      // b's timers stop for 120 ms: on waking it sends its newest 3 ticks, and the rest are absent for good.
      const before = b.t.localTick;
      b.frozen = true;
      q.run(120);
      b.frozen = false;
      q.run(1);
      const after = b.t.localTick;
      const skipped: number[] = [];
      for (let n = before + 1; n <= after - NET.timeline.stallSendTicks; n++) skipped.push(n + D);
      expect(skipped.length).toBeGreaterThanOrEqual(3);
      // Before the burst lands, a predicts those ticks from b's newest input.
      for (const u of skipped) seen.push(`before ${u - before}: ${usedBy(a.t, u, b.id)?.input ?? 'absent'}`);
      const top = after + D;
      while (a.t.newestInput(b.id)!.tick < top) q.run(1);
      // The burst marked them; a's next advance recomputes them without b, while none is final yet.
      q.run(NET.timerMs);
      for (const u of skipped) {
        expect(u).toBeGreaterThan(a.t.finalTick);
        expect(u).toBeLessThanOrEqual(inside(a.t).validTo);
        seen.push(`after ${u - before}: ${usedBy(a.t, u, b.id)?.input ?? 'absent'} ${a.t.receivedInput(b.id, u) ?? 'none'}`);
      }
      q.run(1000);
      for (const u of skipped) expect(a.t.receivedInput(b.id, u)).toBe(undefined);
    });
    // Both runs saw the same: each skipped tick predicted from b's newest input before, and absent after.
    const half = seen.length / 2;
    const n = half / 2;
    expect(seen.slice(half)).toEqual(seen.slice(0, half));
    for (const run of [seen.slice(0, half), seen.slice(half)]) {
      expect(run.slice(0, n).every((x) => x.endsWith(`: ${HELD}`))).toBe(true);
      expect(run.slice(n).every((x) => x.endsWith(': absent none'))).toBe(true);
    }
  });
});

// --- Barks (M3-Q12) ---

describe('barks (D-16, M3-Q12)', () => {
  it('never force a rollback: the simulation takes inputs masked to the kept bits, and receivedInput keeps the counter', () => {
    const counts: { rollbacks: number; corrections: number } = { rollbacks: -1, corrections: -1 };
    const p = twin(pump, (q) => {
      const [a, b] = [q.add(), q.add()];
      starts(a);
      // Held, with a bark every 16 ticks.
      plays(b, 1, (n) => HELD | encodeInput({ bark: (n >> 4) & 3 }), false);
      q.run(1500);
      const r = a.t.stats.rollbacks;
      const c = a.t.stats.corrections;
      q.run(4000);
      // The full replay recomputes, and so replaces, its whole window every advance.
      if (q.mode === 'incremental') {
        counts.rollbacks = a.t.stats.rollbacks - r;
        counts.corrections = a.t.stats.corrections - c;
      }
    });
    expect(counts).toEqual({ rollbacks: 0, corrections: 0 });
    const [a, b] = p.nodes as [Node, Node];
    const barks = new Set<number>();
    for (let u = a.t.finalTick - 100; u <= a.t.finalTick; u++) {
      const x = a.t.receivedInput(b.id, u)!;
      expect(x & KEPT_BITS).toBe(HELD);
      barks.add(barkCount(x));
    }
    expect(barks.size).toBe(4);
  });
});

// --- Own inputs (§2.2, §2.4) ---

describe('own inputs and hosted bots (§2.2, §2.4)', () => {
  it('are recorded when sent, for tick n + d, and never predicted', () => {
    const problems: string[] = [];
    twin(pump, (q) => {
      const a = q.add();
      plays(a, 0, (n) => encodeInput({ step: n & 31, bark: n & 3 }), false, 2);
      const bot = botId(a.id, 0);
      a.t.bots.set(bot, () => encodeInput({ step: a.t.headTick & 31 }));
      a.t.queueEvent(bot, { events: JOIN, joinPack: 1, coat: 3, name: 'Bot' });
      q.run(2000, () => {
        const t = a.t;
        if (t.localTick === 0) return;
        const top = t.localTick + D;
        if (t.receivedInput(a.id, top) !== encodeInput({ step: t.localTick & 31, bark: t.localTick & 3 })) problems.push(`own ${top}`);
        if (t.receivedInput(bot, top) === undefined) problems.push(`bot ${top}`);
        // Every predicted tick took the own inputs as recorded, masked.
        for (let u = t.finalTick + 1; u <= inside(t).validTo; u++) {
          const x = usedBy(t, u, a.id);
          if (findTerrier(t.final, a.id) >= 0 && x?.input !== (t.receivedInput(a.id, u)! & KEPT_BITS)) problems.push(`predicted own ${u}`);
        }
      });
      expect(a.t.final.terriers.length).toBe(2);
    });
    expect(problems).toEqual([]);
  });

  it('repeat the newest input in a prediction with no events (§2.2)', () => {
    const t = new Timeline({ ...NET.timeline, P, me: playerId(0), verify: 1 }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    const b = playerId(1);
    const inputs = new Map<number, number>();
    const send = (n: number, events: number): void => {
      inputs.set(n, HELD);
      const m = tickOf(inputs, n);
      if (events !== 0) m.own!.events.push({ back: 0, events, ...(events & JOIN ? { joinPack: 1, coat: 0, name: 'b' } : {}) });
      t.onTick(b, m, at(n - D), true);
    };
    for (let n = 1; n <= 30; n++) {
      t.advance(at(n));
      send(n + D, n === 1 ? JOIN : 0);
    }
    // b's newest input, for 33, carries READY; a has predicted 31 and 32 and goes on to 36.
    send(33, READY);
    for (let n = 31; n <= 36; n++) t.advance(at(n));
    expect(t.newestInput(b)).toEqual({ tick: 33, input: HELD });
    expect([usedBy(t, 33, b)?.input, usedBy(t, 33, b)?.events]).toEqual([HELD, READY]);
    for (let u = 34; u <= 36; u++) expect([usedBy(t, u, b)?.input, usedBy(t, u, b)?.events]).toEqual([HELD, 0]);
    expect(t.stats.verifyMismatches).toBe(0);
  });
});
