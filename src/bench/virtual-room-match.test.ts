import { describe, expect, it, vi } from 'vitest';
import { defaultBotParams } from '../core/bot/brain';
import { personId } from '../core/bot/bot-id';
import { scriptSampler } from '../core/bot/setups';
import { defaultParams, findTerrier, IN_PLAY, START_COUNTDOWN } from '../core/sim/index';
import { TEST_BUILD } from '../core/timeline/testing';
import { FakeClock, fakePage } from '../ui/clock-testing';
import { openNetMatch } from '../ui/match';
import { virtualRoom } from './virtual-room';

// The bench's room under the real NetGame, session and timeline (M4's design, research/m4/DESIGN.md,
// §1.53, §8.3; PLAN §16's frame-time run, M4-Q16), in virtual time, as the #test=frames page plays it
// with no witness: this page proposes 4 a side and plays in pack A by the brain, pressing Ready once in
// the roster; the seven virtual players join with JOIN, ready with READY and play by the brain on the
// page's drawn head; their votes are the page's own final hashes, so every tally agrees and nothing is
// late, repaired or skipped. A match into play, so a file of its own (CLAUDE.md).

vi.setConfig({ testTimeout: 60_000 });

const P = defaultParams;
const B = defaultBotParams;
const ME = personId(7, 0);

describe("the bench's room under NetGame (§1.53, M4-Q16)", () => {
  it('fills both packs, readies, starts the countdown and plays, every tally agreeing, nothing late, repaired or skipped', async () => {
    const clock = new FakeClock(1000);
    const room = virtualRoom({
      peers: 7, seed: 7, latencyMs: [20, 80], jitterMs: 15, build: TEST_BUILD, capacityPerSecond: null, holdAtMs: null, holdMs: 4100,
      witness: false, clock, task: (fn) => clock.after(0, fn),
    });
    const m = await openNetMatch({
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
    clock.until(() => t().final.terriers.length === 8, 5000);
    const roster = t().final.terriers;
    expect(roster.map((x) => x.id).sort()).toEqual(Array.from({ length: 8 }, (_, k) => personId(7, k)).sort());
    expect([roster.filter((x) => x.pack === 0).length, roster.filter((x) => x.pack === 1).length]).toEqual([4, 4]);
    clock.until(() => t().final.phase === START_COUNTDOWN, 10_000);
    clock.until(() => t().final.phase === IN_PLAY, 10_000);
    // Each virtual player's terrier moves by its brain's inputs through 5 s of play, never sitting silent.
    const spots = new Map(t().final.terriers.map((x) => [x.id, [x.x, x.y] as const]));
    clock.advance(5000);
    let moved = 0;
    for (const [id, [x, y]] of spots) {
      if (id === ME) continue;
      const now = t().final.terriers[findTerrier(t().final, id)]!;
      const d = Math.hypot(now.x - x, now.y - y);
      expect(d, id).toBeGreaterThan(0.25);
      expect([now.sitting, t().finalTick - now.lastInputTick], id).toEqual([false, 0]);
      moved += d;
    }
    expect(moved).toBeGreaterThan(20);
    const s = t().stats;
    // Every tally from the players' first votes agreed: most of the match's final ticks.
    expect(s.agree).toBeGreaterThan(t().finalTick * 0.8);
    expect([s.disagree, s.split, s.resyncs, s.resyncFailed, s.late, s.lateAbsent]).toEqual([0, 0, 0, 0, 0, 0]);
    // The clock takes their TICKs as samples, and none was dropped: the page's timer never froze.
    expect(s.clockSamples).toBeGreaterThan(5000);
    expect(s.clockSamplesDropped).toBe(0);
    expect(m.own()).toMatchObject({ skipped: 0, senders: 1 });
    expect(room.report().delivered.byKind.TICK).toBeGreaterThan(5000);
    // The page's own messages go nowhere: no witness hears them.
    expect(m.status().peers).toBe(7);
    m.close();
  });
});
