import { afterAll, describe, expect, it, vi } from 'vitest';
import { netSettings } from '../core/session/settings';
import {
  drawnFor, expectHoldsAsPlayed, expectReadyAt, expectWhole, playSpec, playWhole, printEnds, releases, SPEC_PAUSES, type SpecRun, wholeShare,
} from './practice-spec-testing';

// §16's Practice setup as e2e/practice.spec.ts plays it, continued from
// practice-spec-whole-1.test.ts (M4's design §9.1, §9.2, §9.5, M4-Q36):
// seed 7's whole match over Practice's own timeline, Ready at 609 to 617,
// each with e at 0, at 60 and drawn for each kickoff; and the spec's menu,
// which stops Practice's clock and so leaves the match as it was, however
// long it's open.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const READY = wholeShare(2);

const LONG = [[2, 5000], [4, 2500]] as const; // not a setting: a menu left open for seconds
const open = (pauses: readonly (readonly [number, number])[]): number => pauses.reduce((a, [, ms]) => a + ms, 0);

describe("the spec's menu at the second and fourth goals (M4's design §9.5, Q-15)", () => {
  it('leaves the match as it was, the menu not opened or opened for seconds', () => {
    const ready = READY[0]!;
    const late = drawnFor(ready, 'whole');
    const spec = playWhole(ready, late);
    const none = playSpec({ ready, late, to: 'end' });
    const long = playSpec({ ready, late, to: 'end', pauses: LONG });
    expectWhole(spec);
    for (const [name, r] of [['none', none], ['long', long]] as const) {
      expect([r.goals, r.end, r.stopTick, r.stopHash, r.holds, r.heldAtMenus], name).toEqual([
        spec.goals, spec.end, spec.stopTick, spec.stopHash, spec.holds, spec.heldAtMenus,
      ]);
    }
    // The clock stopped while it was open: the end's latch came that much later, to a timer run.
    const later = (r: SpecRun): number => Math.round((r.stopMs - none.stopMs) / NET.timerMs) * NET.timerMs;
    expect([later(spec), later(long)]).toEqual([open(SPEC_PAUSES), open(LONG)]);
  });
});

const runs: SpecRun[] = [];
afterAll(() => printEnds('practice-spec-whole-2.test.ts', runs));

describe(`§16's Practice setup over Practice's own timeline, seed 7, Ready at ${READY[0]}–${READY.at(-1)} (M4's design §9.2)`, () => {
  for (const ready of READY) {
    for (const [name, late] of releases(ready)) {
      it(`ends at 0:00 with the bot's pack ahead: Ready at ${ready}, e ${name}`, () => {
        const r = playWhole(ready, late);
        runs.push(r);
        expectReadyAt(r, ready);
        expectWhole(r);
        expectHoldsAsPlayed(r);
      });
    }
  }
});
