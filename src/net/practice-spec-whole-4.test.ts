import { afterAll, describe, it, vi } from 'vitest';
import { expectHoldsAsPlayed, expectReadyAt, expectWhole, playWhole, printEnds, releases, type SpecRun, wholeShare } from './practice-spec-testing';

// §16's Practice setup as e2e/practice.spec.ts plays it, continued from
// practice-spec-whole-1.test.ts (M4's design §9.1, §9.2, §9.5, M4-Q36):
// seed 7's whole match over Practice's own timeline, Ready at 629 to 639,
// each with e at 0, at 60 and drawn for each kickoff, so no file runs much
// over 8 s alone.

vi.setConfig({ testTimeout: 120_000 });

const READY = wholeShare(4);

const runs: SpecRun[] = [];
afterAll(() => printEnds('practice-spec-whole-4.test.ts', runs));

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
