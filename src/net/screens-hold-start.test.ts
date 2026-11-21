import { describe, expect, it, vi } from 'vitest';
import { heldDirection } from '../core/sim/index';
import { expectHolds, type HoldStart, type KeeperRecord, playScreensTo, screensName, screensRun } from './setups-testing';

// The screens match's hold begun wherever in the countdown its spec may
// press it (M4's design, research/m4/DESIGN.md, §9.1, §9.2, M4-Q36;
// setups-F2): in a countdown a held direction only turns the terrier on its
// spot (L118, D-8), so the state at play's first tick is the same whether
// the keeper's player pressed S at the countdown's first tick, its middle or
// 30 ticks before its end, as Practice's is (practice-spec-whole-1.test.ts).
// Seed 7, Ready at 600, e drawn, each played to the third play's first
// tick, after the start countdown and two kickoffs' countdowns, both
// lengths: three whole matches would run about 15 s alone, past CLAUDE.md's
// 8 s, and a hold's start acts only in its countdown.

vi.setConfig({ testTimeout: 120_000 });

const PLAYS = 3; // not a setting: the start's play and two kickoffs'
const STARTS: readonly HoldStart[] = ['first', 'middle', 'latest'];

/** A run to the PLAYS-th play's first tick: each play's tick and hash, and the goals before it. */
const upTo = (r: KeeperRecord): unknown => ({ plays: r.plays.slice(0, PLAYS), goals: r.goals.slice(0, PLAYS - 1) });

describe("the keeper's hold's start in the countdown (M4's design §9.1, §9.2)", () => {
  it("leaves the state at every play's first tick the same, begun at the countdown's first tick, its middle or 30 ticks before its end", () => {
    const run = screensRun(3);
    const runs = STARTS.map((from) => {
      const r = playScreensTo({ ...run, from }, PLAYS);
      // Each hold went down where its start puts it, and let go a second and e ticks into play.
      expectHolds(r);
      return r;
    });
    // So the holds began later in each, the start countdown's first held input the first's, then its middle's.
    const firstHeld = runs.map((r) => r.keeperInputs.find(([, v]) => heldDirection(v))?.[0] ?? -1);
    expect(firstHeld.every((u, k) => u > (firstHeld[k - 1] ?? 0)), `first held inputs ${firstHeld.join(', ')}`).toBe(true);
    const [a, ...others] = runs;
    expect([a!.plays.length >= PLAYS, a!.plays.every(([, h]) => h !== '')]).toEqual([true, true]);
    for (const b of others) expect(upTo(b), screensName(b.options)).toEqual(upTo(a!));
  });
});
