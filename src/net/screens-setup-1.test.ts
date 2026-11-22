import { readdirSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { defaultParams } from '../core/sim/index';
import {
  ABSENCES, expectScreens, JUMPS, PACED_READY, PACES, playScreens, playToCountdown, printScreens, RELEASES, SCREENS_BAND, SCREENS_READY,
  SCREENS_RUNS, type ScreensRun, screensBandRuns, screensName, screensRun,
} from './setups-testing';

// §9.4's setup over the loopback network, as e2e/match.screens.net.spec.ts
// plays it through the screens (M4's design, research/m4/DESIGN.md, §8.1,
// §9.1, §9.2, §9.4, M4-Q6, M4-Q36; PLAN §16's three-engine match): seed 7's
// match, every page on the spec's keys, ends at 0:00 with pack A ahead on
// every page, before the spec relies on it (setups-testing.ts plays it),
// under the newest-3 rule, which stands (M4-Q6, docs/acceptance.md's phase
// 2c). §9.2's 13 runs go one a file across screens-setup-1 to -13, so no
// file runs much over 8 s alone; here Ready at 600, e at 0, the reload
// away 0.5 s; and here too the runs themselves, and the warm-up's W, which
// leaves the start countdown's placed state as it was. Each file prints
// its run's figures for the spec's timeout. screens-hold-start.test.ts
// moves the hold's start in the countdown, and screens-band-*.sweep.ts,
// off the gate, play every Ready tick of §9.1's band (setups-F1).

// Whole matches in virtual time: CPU-bound, as M3's setups are.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const SECOND = P.config.ticksPerSecond;

describe("the screens' runs (M4's design §9.1, §9.2)", () => {
  it('are Ready at 600, 630 and 660 with e at 0, at 120 and drawn, and the proposer paced at 50 and 100 ms at 600 and 660, e drawn, one a file', () => {
    const unpaced = SCREENS_RUNS.filter((o) => o.paceMs === null);
    const paced = SCREENS_RUNS.filter((o) => o.paceMs !== null);
    expect(unpaced.map((o) => `${o.ready} ${o.e}`)).toEqual(SCREENS_READY.flatMap((ready) => ['0', '120', 'drawn'].map((e) => `${ready} ${e}`)));
    expect(paced.map((o) => `${o.paceMs} ${o.ready} ${o.e}`)).toEqual(PACES.flatMap((pace) => PACED_READY.map((ready) => `${pace} ${ready} drawn`)));
    // The reload's absence by turns: each Ready tick, and each e, meets every one.
    const absences = (k: (o: (typeof unpaced)[number]) => string): Record<string, number[]> =>
      Object.fromEntries([...new Set(unpaced.map(k))].map((v) => [v, unpaced.filter((o) => k(o) === v).map((o) => o.absence).sort((a, b) => a - b)]));
    for (const got of [absences((o) => `${o.ready}`), absences((o) => o.e)]) for (const a of Object.values(got)) expect(a).toEqual([...ABSENCES]);
    expect(paced.map((o) => o.absence)).toEqual([...ABSENCES, ABSENCES[0]]);
    // WebKit's three presses, each leaving at least a second of the start countdown (M4's design §9.1).
    for (const o of [...SCREENS_RUNS, ...RELEASES.flatMap(screensBandRuns)]) {
      expect(JUMPS).toContainEqual(o.jumps);
      expect(o.jumps.every((at, k) => at >= (o.jumps[k - 1] ?? 0) && at <= P.startCountdownTicks - SECOND), screensName(o)).toBe(true);
    }
    // One file for each run, screens-setup-k playing the k-th.
    const files = readdirSync(new URL('.', import.meta.url)).filter((f) => /^screens-setup-\d+\.test\.ts$/.test(f));
    expect(files.sort()).toEqual(SCREENS_RUNS.map((_, k) => `screens-setup-${k + 1}.test.ts`).sort());
    expect(() => screensRun(SCREENS_RUNS.length + 1)).toThrow(/no screens run/);
  });

  it("are swept off the gate at every Ready tick of §9.1's band, 600 to 660, with e at 0, at 120 and drawn, a file for each e (setups-F1)", () => {
    expect(SCREENS_BAND).toEqual(Array.from({ length: 61 }, (_, k) => 600 + k));
    for (const e of RELEASES) {
      const band = screensBandRuns(e);
      expect(band.map((o) => [o.ready, o.e, o.paceMs]), e).toEqual(SCREENS_BAND.map((ready) => [ready, e, null]));
      // The reload's absence and WebKit's presses by turns: over the band each absence meets every press.
      expect(new Set(band.map((o) => `${o.absence} ${o.jumps.join(',')}`)).size, e).toBe(ABSENCES.length * JUMPS.length);
    }
    const sweeps = readdirSync(new URL('.', import.meta.url)).filter((f) => /^screens-band-.+\.sweep\.ts$/.test(f));
    expect(sweeps.sort()).toEqual(RELEASES.map((e) => `screens-band-${e}.sweep.ts`).sort());
  });

  it("leave the start countdown's placed state as it was after every player's W in warm-up, its gait and animation start aside", () => {
    const run = screensRun(1);
    const warm = playToCountdown(run);
    const none = playToCountdown({ ...run, warmUp: false });
    // Each player's terrier moved in warm-up, as the spec's hook shows (M4's design §9.4's step 3), and
    // only then.
    expect([warm.moved, none.moved]).toEqual([[true, true, true], [false, false, false]]);
    expect([warm.agreed, none.agreed, warm.countdownTick, warm.placed]).toEqual([true, true, none.countdownTick, none.placed]);
  });
});

const run = screensRun(1);
const runs: ScreensRun[] = [];
afterAll(() => printScreens('screens-setup-1.test.ts', runs));

describe("§9.4's setup over the loopback, seed 7 (M4's design §9.2)", () => {
  it(`ends at 0:00 with pack A ahead: ${screensName(run)}`, () => {
    const r = playScreens(run);
    runs.push(r);
    expectScreens(r);
  });
});
