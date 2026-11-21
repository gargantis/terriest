import { describe, expect, it } from 'vitest';
import { derived } from '../../config';
import { personId } from '../bot/bot-id';
import { defaultBotParams } from '../bot/brain';
import { barkCount, encodeInput } from '../sim/input';
import { defaultParams } from '../sim/params';
import { placedMatch } from '../sim/scenes';
import type { MatchState } from '../sim/state';
import { TEST_BUILD } from '../timeline/testing';
import type { BarkEvent, BarkTimeline } from './bark-types';
import { BarkTracker } from './barks';
import { PracticeSession } from './practice';
import { netSettings } from './settings';

// The barks (PLAN D-16, L209, L327; M4's design §1.36, §2.5, M4-Q24): a bark
// at t from received inputs for t and t − 1 whose bark counts differ, never
// a predicted one; the baseline after a gap, so a reload's first input never
// barks; a hole decided once its input comes; this viewer's own at the
// press; a host's own bots, through Practice's real timeline; a late timer
// run still finding a bark, and a hidden spell's backlog never reported;
// what's held when a sender is first seen, or after a reset, a baseline only.

const GAP = derived.barkGapTicks;
const withBark = (n: number): number => encodeInput({ step: 4, bark: n });

/** A timeline's received inputs, set by hand: what isn't set wasn't received, a prediction's tick. */
class Received implements BarkTimeline {
  readonly head: MatchState;
  private readonly inputs = new Map<string, Map<number, number>>();

  constructor(head: MatchState) {
    this.head = head;
  }

  receive(id: string, from: number, to: number, input: (t: number) => number): void {
    let m = this.inputs.get(id);
    if (m === undefined) this.inputs.set(id, (m = new Map()));
    for (let t = from; t <= to; t++) m.set(t, input(t));
  }

  receivedInput(id: string, t: number): number | undefined {
    return this.inputs.get(id)?.get(t);
  }

  newestInput(id: string): { readonly tick: number; readonly input: number } | undefined {
    const m = this.inputs.get(id);
    if (m === undefined || m.size === 0) return undefined;
    const tick = Math.max(...m.keys());
    return { tick, input: m.get(tick)! };
  }
}

const s0 = placedMatch(defaultParams, 2);
const me = s0.terriers[0]!.id;
const them = s0.terriers[1]!.id;
const other = s0.terriers[2]!.id;
const ticksOf = (found: readonly BarkEvent[]): [string, number][] => found.map((e) => [e.id, e.tick]);

describe('a remote bark (D-16, M4-Q24)', () => {
  it('is at t when the inputs received for t and t − 1 differ in their bark count, and found once', () => {
    const t = new Received(s0);
    const b = new BarkTracker(me);
    t.receive(them, 0, 10, () => withBark(0));
    expect(b.update(t)).toEqual([]);
    t.receive(them, 11, 12, () => withBark(1));
    expect(b.update(t)).toEqual([{ id: them, tick: 11, own: false }]);
    expect(b.update(t), 'not again').toEqual([]);
    t.receive(them, 13, 30, (k) => withBark(k < 25 ? 1 : 3));
    expect(ticksOf(b.update(t)), 'a counter that moved 2 barks too').toEqual([[them, 25]]);
    expect(b.latest(them)).toBe(25);
    // A change of direction or anything else but the count is no bark.
    t.receive(them, 31, 40, (k) => encodeInput({ step: k % 32, zoomies: true, jump: k & 3, bark: 3 }));
    expect(b.update(t)).toEqual([]);
  });

  it('is never found in a predicted input: a pair waits for both, and is decided when the missing one comes', () => {
    const t = new Received(s0);
    const b = new BarkTracker(me);
    t.receive(them, 0, 20, () => withBark(1));
    b.update(t);
    // 21 never came, a prediction stands for it; 22 did, with a new count.
    t.receive(them, 22, 22, () => withBark(2));
    expect(b.update(t), 'neither 21 nor 22 known with its tick before').toEqual([]);
    expect(b.latest(them)).toBeNull();
    // The next TICK's history fills 21, as the timeline's store takes it.
    t.receive(them, 21, 21, () => withBark(1));
    t.receive(them, 23, 23, () => withBark(2));
    expect(b.update(t)).toEqual([{ id: them, tick: 22, own: false }]);
    expect(b.update(t)).toEqual([]);
    // A TICK that arrives out of order fills its hole with no newer input: decided at the next look,
    // though its sender then says nothing more.
    t.receive(them, 25, 25, () => withBark(3));
    expect(b.update(t), '24 unknown').toEqual([]);
    t.receive(them, 24, 24, () => withBark(2));
    expect(b.update(t)).toEqual([{ id: them, tick: 25, own: false }]);
    expect(b.update(t)).toEqual([]);
  });

  it('takes the first input after a gap as its baseline only, so a reload, a return or a join never barks', () => {
    const t = new Received(s0);
    const b = new BarkTracker(me);
    // Its first page, its counter at 2, then gone; its reload's first input, its counter back at 0 (D-10).
    t.receive(them, 0, 30, () => withBark(2));
    expect(b.update(t)).toEqual([]);
    t.receive(them, 50, 70, () => withBark(0));
    expect(b.update(t), "the reload's first input, at 50").toEqual([]);
    t.receive(them, 71, 90, (k) => withBark(k < 80 ? 0 : 1));
    expect(ticksOf(b.update(t)), 'its next bark, from the baseline').toEqual([[them, 80]]);
    // A terrier that joins: its first input has nothing before it.
    t.receive(other, 85, 95, () => withBark(3));
    expect(b.update(t)).toEqual([]);
  });

  it("never reads this viewer's own inputs: its bark is the press's", () => {
    const t = new Received(s0);
    const b = new BarkTracker(me);
    t.receive(me, 0, 40, (k) => withBark(k < 20 ? 0 : 1));
    expect(b.update(t)).toEqual([]);
    expect(b.latest(me)).toBeNull();
    b.pressed(me, 42);
    expect(b.latest(me)).toBe(42);
    t.receive(me, 41, 60, () => withBark(2));
    expect(b.update(t)).toEqual([]);
    expect(b.latest(me)).toBe(42);
  });

  it('lists the barks found in tick order, the head order within a tick, and keeps the latest of each', () => {
    const t = new Received(s0);
    const b = new BarkTracker(me);
    t.receive(them, 0, 5, () => withBark(0));
    t.receive(other, 0, 5, () => withBark(0));
    b.update(t);
    t.receive(other, 6, 20, (k) => withBark(k < 9 ? 0 : 1));
    t.receive(them, 6, 20, (k) => withBark(k < 9 ? 0 : k < 15 ? 1 : 2));
    expect(ticksOf(b.update(t))).toEqual([[them, 9], [other, 9], [them, 15]]);
    expect([b.latest(them), b.latest(other)]).toEqual([15, 9]);
    // A press never lowers it.
    b.pressed(them, 12);
    expect(b.latest(them)).toBe(15);
  });

  it("finds a bark however late the timer ran, within a bark gap of the sender's newest input, and no backlog past it", () => {
    const t = new Received(s0);
    const b = new BarkTracker(me);
    t.receive(them, 0, 100, () => withBark(0));
    b.update(t);
    // A timer run half a second late: the bark 30 ticks back is still found.
    t.receive(them, 101, 130, (k) => withBark(k < 101 ? 0 : 1));
    expect(ticksOf(b.update(t))).toEqual([[them, 101]]);
    // Back from a hidden spell: four barks in the inputs since, only the one within the gap reported.
    const at = [300, 500, 700, 1000 - GAP + 5];
    t.receive(them, 131, 1000, (k) => withBark(1 + at.filter((x) => x <= k).length));
    expect(ticksOf(b.update(t))).toEqual([[them, 1000 - GAP + 5]]);
    // And a hole is given up once its tick falls more than a bark gap behind the newest input.
    t.receive(them, 1001, 1010, () => withBark(5));
    expect(b.update(t)).toEqual([]);
    t.receive(them, 1012, 1012 + GAP, () => withBark(6));
    expect(b.update(t), '1011 unknown: nothing decided at 1012').toEqual([]);
    t.receive(them, 1011, 1011, () => withBark(5));
    t.receive(them, 1013 + GAP, 1013 + GAP, () => withBark(6));
    expect(ticksOf(b.update(t)), '1011 came with 1012 more than a bark gap behind the newest').toEqual([]);
  });

  it("takes what's held when a sender is first seen as the baseline only, so nothing from an adopted state plays (§7)", () => {
    const t = new Received(s0);
    // A STATE adopted with its inputs: a bark at 10, within the last second of them.
    t.receive(them, 0, 20, (k) => withBark(k < 10 ? 0 : 1));
    const b = new BarkTracker(me);
    expect(b.update(t)).toEqual([]);
    expect(b.latest(them)).toBeNull();
    t.receive(them, 21, 30, (k) => withBark(k < 25 ? 1 : 2));
    expect(ticksOf(b.update(t)), 'the inputs that came after').toEqual([[them, 25]]);
    // A count that changed at the newest input held: that pair is the adopted state's too.
    const u = new Received(s0);
    u.receive(other, 0, 19, () => withBark(0));
    u.receive(other, 20, 20, () => withBark(1));
    const c = new BarkTracker(me);
    expect(c.update(u)).toEqual([]);
    u.receive(other, 21, 25, () => withBark(1));
    expect(c.update(u), 'nothing at 20, the newest held at first sight').toEqual([]);
    expect(c.latest(other)).toBeNull();
  });

  it('starts again on reset, for another timeline', () => {
    const t = new Received(s0);
    const b = new BarkTracker(me);
    t.receive(them, 0, 5, () => withBark(0));
    b.update(t);
    t.receive(them, 6, 20, (k) => withBark(k < 10 ? 0 : 1));
    expect(ticksOf(b.update(t))).toEqual([[them, 10]]);
    b.pressed(me, 15);
    b.reset();
    expect([b.latest(them), b.latest(me)]).toEqual([null, null]);
    // Another timeline's ticks, from 0 again: its inputs held set the baseline, and the next are looked at.
    const u = new Received(s0);
    u.receive(them, 0, 8, (k) => withBark(k < 4 ? 2 : 3));
    expect(b.update(u)).toEqual([]);
    u.receive(them, 9, 12, (k) => withBark(k < 11 ? 3 : 0));
    expect(ticksOf(b.update(u))).toEqual([[them, 11]]);
    // One whose ticks run ahead of the last: after the reset its inputs held are a baseline too.
    b.reset();
    const x = new Received(s0);
    x.receive(them, 0, 40, (k) => withBark(k < 30 ? 0 : 1));
    expect(b.update(x), 'a bark at 30, from before the tracker looked').toEqual([]);
    x.receive(them, 41, 45, (k) => withBark(k < 43 ? 1 : 2));
    expect(ticksOf(b.update(x))).toEqual([[them, 43]]);
    // A tracker not reset takes a timeline whose ticks run back as another all the same, its holes
    // from the first forgotten, so none is decided twice.
    const c = new BarkTracker(me);
    const w = new Received(s0);
    w.receive(them, 0, 5, () => withBark(0));
    c.update(w);
    w.receive(them, 7, 20, () => withBark(0));
    expect(c.update(w)).toEqual([]);
    const v = new Received(s0);
    v.receive(them, 0, 3, () => withBark(1));
    expect(c.update(v)).toEqual([]);
    v.receive(them, 4, 10, (k) => withBark(k < 7 ? 1 : 2));
    expect(ticksOf(c.update(v))).toEqual([[them, 7]]);
  });
});

describe("a host's own bots (D-16, §2.5)", () => {
  it("are found in the inputs Practice's timeline recorded for them, each bark once, about every 5 s", () => {
    const NET = netSettings();
    const person = personId(7, 0);
    const p = new PracticeSession(
      {
        P: defaultParams, B: defaultBotParams, net: NET, me: person, name: 'P0', coat: 0, settings: { packSize: 2, matchMinutes: 1 },
        build: TEST_BUILD,
      },
      { send: () => {}, broadcast: () => {} },
    );
    p.start(0, '9ac71ce09ac71ce0');
    const b = new BarkTracker(person);
    const found: BarkEvent[] = [];
    // Every bot's input as recorded, tick by tick, for the whole run: the store's ring forgets.
    const recorded = new Map<string, Map<number, number>>();
    for (let now = NET.timerMs; now <= 15_000; now += NET.timerMs) {
      p.advance(now);
      const t = p.session.timeline;
      if (!t.started) continue;
      found.push(...b.update(t));
      for (const T of t.head.terriers) {
        const newest = t.newestInput(T.id)?.tick;
        if (newest === undefined) continue;
        let m = recorded.get(T.id);
        if (m === undefined) recorded.set(T.id, (m = new Map()));
        for (let k = newest; k >= 0 && !m.has(k); k--) {
          const v = t.receivedInput(T.id, k);
          if (v === undefined) break;
          m.set(k, v);
        }
      }
    }
    const bots = [...recorded.keys()].filter((id) => id !== person);
    expect(bots).toHaveLength(3);
    // Every change of count in what was recorded, pair by pair: the rule over the whole run.
    const expected: [string, number][] = [];
    for (const id of bots) {
      const m = recorded.get(id)!;
      for (const k of [...m.keys()].sort((x, y) => x - y)) {
        const a = m.get(k - 1);
        if (a !== undefined && barkCount(a) !== barkCount(m.get(k)!)) expected.push([id, k]);
      }
    }
    const got = ticksOf(found);
    expect(got.map(([id, k]) => `${id} ${k}`).sort()).toEqual(expected.map(([id, k]) => `${id} ${k}`).sort());
    expect(found.every((e) => !e.own && e.id !== person)).toBe(true);
    // Each bot barks about every botBarkEverySeconds, jittered by up to a bark gap either way: a bark
    // found twice, or one missed, would break the spacing.
    for (const id of bots) {
      const ticks = got.filter(([x]) => x === id).map(([, k]) => k);
      expect(ticks.length, id).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < ticks.length; i++) {
        const apart = ticks[i]! - ticks[i - 1]!;
        expect(apart, `${id}'s barks ${i - 1} and ${i}`).toBeGreaterThanOrEqual(derived.botBarkEveryTicks - GAP);
        expect(apart, `${id}'s barks ${i - 1} and ${i}`).toBeLessThanOrEqual(derived.botBarkEveryTicks + GAP);
      }
    }
  });
});
