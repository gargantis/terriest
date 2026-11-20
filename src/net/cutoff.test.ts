import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { sharedHashes } from '../core/timeline/testing';
import { cutOff, NET, Rig } from './freezes-testing';

// A page cut off from the room in warm-up (PLAN D-13; M3's design,
// research/m3/DESIGN.md, §3.2, §4.10; M3 phase 5b, flood-F3): every message
// to it held for 4.5 to 8 s, its timers running on, then landing at once. It
// finalises the others absent, and its final state removes them for their
// silence (removalSilentTicks) while their TICKs, on live connections, carry
// the room's votes. Counting only its own roster, it agreed with itself
// alone for good: its one lost tally, from a late vote, came too late for
// the room's history to answer. Now a voter its lineage removed for silence
// while connected is counted, so its tallies lose to the room's and it
// repairs: one match after, every page in it with one state, nothing
// closed. At 2 a side, at phase 5a's reviewer's seeds; cutoff-4*.test.ts
// plays 4 a side. No page freezes, so the thaw order changes nothing. And a
// spectator cut off as long, whose lineage removed every player, watched
// an empty warm-up for good: it has no vote, so with none counted it
// trusted its own state; now it counts the players it removed. And a page
// that rejoined after a stall (§4.12), holding a timeline the session made
// later, cut off as long: every timeline the session makes is told who
// reaches it (split-F3).

vi.setConfig({ testTimeout: 120_000 });

const AT = 1300; // not a setting: in warm-up, after the last page joined, before Ready
const SETTLE_MS = 2500; // not a setting: from the release, past the slowest repair seen (0.7 s)

describe('a page whose incoming links are held in warm-up repairs to the room (flood-F3)', () => {
  it('held 4.5 s, seeds 350 and 353', () => {
    for (const seed of [350, 353]) cutOff({ seed, packSize: 2, page: 1, at: AT, ms: 4500, settleMs: SETTLE_MS });
  });

  it('held 6 and 8 s, seeds 354 and 358', () => {
    cutOff({ seed: 354, packSize: 2, page: 1, at: AT, ms: 6000, settleMs: SETTLE_MS });
    cutOff({ seed: 358, packSize: 2, page: 1, at: AT, ms: 8000, settleMs: SETTLE_MS });
  });

  it('the last page held 6 s', () => {
    cutOff({ seed: 3540, packSize: 2, page: 3, at: AT, ms: 6000, settleMs: SETTLE_MS });
  });

  it('a spectator held 4.5 s watches the room again', () => {
    const rig = new Rig({ seed: 71, packSize: 2 });
    const w = rig.page('n4', personId(23, 4), 4);
    rig.net.join(w, 900, () => w.session.watch());
    rig.net.at(AT, () => {
      for (const x of rig.nodes) rig.net.delayNext(x.id, w.id, () => true, 4500);
    });
    rig.runTo(AT + 4500 - 100);
    const t = (): typeof w.session.timeline => w.session.timeline;
    expect(t().final.terriers).toEqual([]);
    rig.settle('a spectator held 4.5 s', AT + 4500, SETTLE_MS);
    expect(t().final.terriers.map((T) => T.id).sort()).toEqual(rig.nodes.map((x) => x.session.cfg.me).sort());
    const from = Math.ceil((AT + 4500 + SETTLE_MS) / NET.tickMs);
    const shared = sharedHashes([rig.nodes[0]!, w].map((x) => ({ t: x.session.timeline })), 1).filter((x) => x.tick >= from);
    expect(shared.length).toBeGreaterThan(0);
    for (const x of shared) expect(new Set(x.hashes).size, `tick ${x.tick}`).toBe(1);
  });

  it('a page that rejoined after a stall, then held 4.5 s, repairs to the room', () => {
    const rig = new Rig({ seed: 77, packSize: 2 });
    // Page 3 leaves at once, so the packs never fill and warm-up goes on.
    rig.net.at(900, () => rig.nodes[3]!.session.leave());
    const x = rig.nodes[1]!;
    const first = x.session.timeline;
    rig.freeze(1, 1500, 2500);
    rig.runTo(6000);
    expect([x.session.stalls, x.session.timeline !== first], 'rejoined on a new timeline').toEqual([1, true]);
    rig.hold(1, 6000, 4500);
    rig.runTo(6000 + 4400);
    expect(x.session.timeline.final.terriers.map((T) => T.id), 'alone').toEqual([x.session.cfg.me]);
    rig.runTo(6000 + 4500 + SETTLE_MS + 1500);
    const three = rig.nodes.slice(0, 3);
    const label = rig.logs();
    const me = three.map((y) => y.session.cfg.me).sort();
    for (const y of three) expect(y.session.timeline.final.terriers.map((T) => T.id).sort(), label).toEqual(me);
    const from = Math.ceil((6000 + 4500 + SETTLE_MS) / NET.tickMs);
    const shared = sharedHashes(three.map((y) => ({ t: y.session.timeline })), 1).filter((s) => s.tick >= from);
    expect(shared.length, label).toBeGreaterThan(0);
    for (const s of shared) expect(new Set(s.hashes).size, `${label}: tick ${s.tick}`).toBe(1);
  });
});
