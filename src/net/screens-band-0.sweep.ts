import { afterAll, describe, it } from 'vitest';
import { expectScreens, playScreens, printScreens, printSlowestScreens, type ScreensRun, screensBandRuns, screensName } from './setups-testing';

// §9.4's setup over the loopback network at every Ready tick of §9.1's
// band, 600 to 660, with e at 0 (M4's design,
// research/m4/DESIGN.md, §9.1, §9.2, §9.4, M4-Q36; setups-F1), each run
// taking every check screens-setup-1 to -13 take in the gate. Never part of
// the gate: 58 of these matches in it took check:commit from about 6
// minutes to 10.5. Run it, and its siblings, e at 60 and drawn, side by side:
//   npx vitest run --config dev/screens-band.vitest.config.ts
// before a networked spec relies on the setup, and again whenever the
// simulation, the bots, the timeline, the session or the specs' scripts
// change. Each run prints its line, and the file its slowest end.

const FILE = 'screens-band-0.sweep.ts';
const runs: ScreensRun[] = [];
afterAll(() => {
  printScreens(FILE, runs);
  printSlowestScreens(FILE, runs);
});

describe("§9.4's setup over the loopback at every Ready tick of §9.1's band, e 0, seed 7 (M4's design §9.1)", () => {
  for (const o of screensBandRuns('0')) {
    it(`ends at 0:00 with pack A ahead: ${screensName(o)}`, () => {
      const r = playScreens(o);
      runs.push(r);
      expectScreens(r);
    });
  }
});
