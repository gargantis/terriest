import { describe, expect, it } from 'vitest';
import { config } from './config';
import { benchVerdict, parseFrameParams, repairFigures, type VerdictFacts } from './frames';

// The #test=frames page's parameters, in its own fragment (M4's design, research/m4/DESIGN.md, §1.53,
// M4-Q4): seconds, quality, frameMs, capacity, repair=1 with holdAt and hold, and model=<path>, a
// same-origin relative path only, with no scheme, no // and no ..; a parameter it doesn't take, one
// given twice, or one out of its range is refused, so the page says why and contacts nothing. And L286's
// verdict, condition by condition (M4-Q17, phase 2b's review, bench-F7). The page itself plays through
// e2e/frames.spec.ts and e2e/frames.run.ts.

describe("the bench's parameters (§1.53, M4-Q4)", () => {
  it('takes none but its own: a whole match at the default quality, no busy wait, capacity, repair or model', () => {
    expect(parseFrameParams('#test=frames')).toEqual({
      seconds: null, quality: config.renderQualityDefault, frameMs: 0, capacity: null, repair: false, holdAt: 15, hold: 4100, model: null,
    });
  });

  it('reads each, the forced repair with its hold, and a model by a relative path on its origin', () => {
    expect(parseFrameParams('#test=frames&seconds=5&quality=low&frameMs=67&capacity=300')).toMatchObject({
      seconds: 5, quality: 'low', frameMs: 67, capacity: 300, repair: false,
    });
    expect(parseFrameParams('test=frames&repair=1&holdAt=1&hold=2000&seconds=20')).toMatchObject({ repair: true, holdAt: 1, hold: 2000, seconds: 20 });
    expect(parseFrameParams('#test=frames&repair=1')).toMatchObject({ repair: true, holdAt: 15, hold: 4100 });
    for (const model of ['standin.glb', './standin.glb', 'dev/standin.glb', 'a_b-c/d.e.glb']) {
      expect(parseFrameParams(`#test=frames&model=${encodeURIComponent(model)}`), model).toMatchObject({ model });
    }
  });

  it('refuses a parameter it takes not, one given twice, another page, and any out of its range', () => {
    const refused = (hash: string): string => {
      const p = parseFrameParams(hash);
      if (!('error' in p)) throw new Error(`${hash} was taken: ${JSON.stringify(p)}`);
      return p.error;
    };
    expect(refused('#test=frames&players=8')).toMatch(/^players: this page takes no such parameter/);
    expect(refused('#test=frames&seconds=5&seconds=6')).toMatch(/^seconds: given more than once/);
    expect(refused('#test=net')).toMatch(/^test: this is the #test=frames page/);
    for (const [key, value] of [
      ['seconds', '0'], ['seconds', '3601'], ['seconds', '1.5'], ['seconds', '05'], ['seconds', ''], ['frameMs', '-1'], ['frameMs', '1001'],
      ['capacity', '0'], ['quality', 'medium'], ['quality', 'LOW'],
    ]) {
      expect(refused(`#test=frames&${key}=${value}`), `${key}=${value}`).toMatch(new RegExp(`^${key}: `));
    }
    expect(refused('#test=frames&repair=0')).toMatch(/^repair: 1/);
    expect(refused('#test=frames&repair=true')).toMatch(/^repair: 1/);
    expect(refused('#test=frames&holdAt=1')).toMatch(/^holdAt and hold: only with repair=1/);
    expect(refused('#test=frames&hold=100')).toMatch(/^holdAt and hold: only with repair=1/);
    expect(refused('#test=frames&repair=1&holdAt=601')).toMatch(/^holdAt: /);
    // From 1 s into play: the room makes its TICKs a little ahead of their send, and holds those sent from the start.
    expect(refused('#test=frames&repair=1&holdAt=0')).toMatch(/^holdAt: a whole number from 1 to 600/);
    expect(refused('#test=frames&repair=1&hold=0')).toMatch(/^hold: /);
  });

  it('refuses a model anywhere but a relative path on its origin: no scheme, no //, no .., nothing root-absolute', () => {
    for (const model of [
      'https://example.invalid/standin.glb', 'http:standin.glb', 'data:model/gltf-binary;base64,AAAA', 'javascript:alert(1)', 'blob:standin',
      '//example.invalid/standin.glb', '/standin.glb', '../standin.glb', 'dev/../standin.glb', 'a..b.glb', '.', './', '', 'dev//standin.glb',
      '.hidden.glb', 'dev\\standin.glb', '%2e%2e/standin.glb', 'standin.glb?x=1', 'standin.glb#x', ' standin.glb', 'a'.repeat(201),
    ]) {
      const p = parseFrameParams(`#test=frames&model=${encodeURIComponent(model)}`);
      expect('error' in p && p.error, model).toMatch(/^model: a relative path on this page's origin/);
    }
  });
});

describe("L286's verdict (M4-Q17, bench-F6, bench-F7)", () => {
  /** A whole match to Results with a goal, its celebration and a kickoff, the code-built drawer, the governor
   *  idle from the loop's start: the run a verdict is given for. */
  const whole: VerdictFacts = {
    params: { repair: false, frameMs: 0, model: null }, error: null, done: true, endedBy: 'results', goals: 1, celebration: true, kickoff: true,
    model: { url: '', state: 'none', ms: null, error: null }, actions: 0, interval: { p50: 16.7, p95: 18, p99: 33, max: 50 },
  };

  it('passes at p95 ≤ 18 ms and max ≤ 50 ms, and fails past either', () => {
    expect(benchVerdict(whole)).toEqual({ verdict: 'pass', pass: true, why: 'p95 18.0 ms (≤ 18) and max 50.0 ms (≤ 50)' });
    expect(benchVerdict({ ...whole, interval: { ...whole.interval, p95: 18.1 } })).toMatchObject({ verdict: 'fail', pass: false });
    expect(benchVerdict({ ...whole, interval: { ...whole.interval, max: 50.1 } })).toMatchObject({ verdict: 'fail', pass: false });
  });

  it('gives none, saying why, for each condition a run misses', () => {
    const none = (o: Partial<VerdictFacts>, why: RegExp): void => {
      const v = benchVerdict({ ...whole, ...o });
      expect(v, JSON.stringify(o)).toMatchObject({ verdict: 'none', pass: false });
      expect(v.why, JSON.stringify(o)).toMatch(why);
    };
    none({ error: 'the match had 7 terriers in 60 s, not 8' }, /^no verdict: the match had 7 terriers/);
    none({ params: { ...whole.params, repair: true } }, /a forced repair decides nothing/);
    none({ params: { ...whole.params, frameMs: 50 } }, /each frame was held to 50 ms/);
    none({ endedBy: 'seconds' }, /the window ended by seconds, not at Results/);
    none({ done: false, endedBy: null }, /still measuring/);
    none({ goals: 0 }, /no goal, its celebration and a kickoff/);
    none({ celebration: false }, /no goal, its celebration and a kickoff/);
    none({ kickoff: false }, /no goal, its celebration and a kickoff/);
    none({ params: { ...whole.params, model: 'standin.glb' } }, /the model standin.glb wasn't drawn: none/);
    none({ params: { ...whole.params, model: 'standin.glb' }, model: { url: 'standin.glb', state: 'failed', ms: null, error: 'a 404' } }, /wasn't drawn: failed, a 404/);
    // The governor's actions from the loop's start, before the window as well as in it: a page that stepped
    // down before the window and stayed down is judged at a lower scale (bench-F6).
    none({ actions: 1 }, /the governor acted 1 times/);
    // The figures go with it, so a person reads them all the same.
    expect(benchVerdict({ ...whole, goals: 0 }).why).toMatch(/; p95 18.0 ms \(≤ 18\) and max 50.0 ms \(≤ 50\)$/);
    // A model drawn is a verdict's.
    expect(benchVerdict({ ...whole, params: { ...whole.params, model: 'standin.glb' }, model: { url: 'standin.glb', state: 'drawn', ms: 40, error: null } }).verdict)
      .toBe('pass');
  });
});

describe("the forced repair's figures (M3-Q14, bench-F4)", () => {
  it("reads its depth off the STATE the page took from the hold's start, not a rejoin's or a transient's before it", () => {
    const hold = { fromMs: 20_000, toMs: 24_100, resyncsBefore: 0, armedMs: 19_000, calm: true, repairedMs: 24_500 };
    const states = [{ atMs: 8_884, g: 499, senderTick: 512 }, { atMs: 24_150, g: 850, senderTick: 1107 }, { atMs: 24_700, g: 900, senderTick: 1110 }];
    const calls = [
      { at: 24_120, ms: 0.2, kind: 'TICK', steps: 0 }, { at: 24_160, ms: 5.3, kind: 'STATE', steps: 14, state: { g: 850, senderTick: 1107 } },
      { at: 24_170, ms: 7.1, kind: 'timer', steps: 20 },
    ];
    const r = repairFigures(calls, { hold, states, witnessStates: 3 }, 1);
    expect(r).toMatchObject({ back: 257, statesFromHold: 2, witnessStates: 3, adoptMs: 5.3, worstMs: 7.1, worstSteps: 20, steps: 34, resyncs: 1 });
    // No hold yet: no forced repair's depth, whatever came before.
    expect(repairFigures(calls, { hold: null, states, witnessStates: 3 }, 0)).toMatchObject({ back: null, statesFromHold: 0 });
  });

  it("times and measures the first STATE the page took from the hold's start, not one sent before it that came too late for its resync, nor a later one's", () => {
    // The first STATE from the hold's start, 257 ticks back, comes through the held burst once its resync has moved
    // on, and the page drops it, stepping nothing; it takes the next, its next resync's, 240 ticks back. A later
    // transient's resync takes another, 15 back, inside the second the calls are kept for after the repair.
    const hold = { fromMs: 20_000, toMs: 24_100, resyncsBefore: 0, armedMs: 19_000, calm: false, repairedMs: 26_900 };
    const states = [{ atMs: 24_150, g: 850, senderTick: 1107 }, { atMs: 26_650, g: 1100, senderTick: 1340 }, { atMs: 27_450, g: 1365, senderTick: 1380 }];
    const calls = [
      { at: 26_600, ms: 1.1, kind: 'STATE', steps: 0, state: { g: 850, senderTick: 1107 } }, { at: 26_620, ms: 0.2, kind: 'TICK', steps: 0 },
      { at: 26_700, ms: 6.4, kind: 'STATE', steps: 14, state: { g: 1100, senderTick: 1340 } }, { at: 26_720, ms: 3.2, kind: 'timer', steps: 14 },
      { at: 27_500, ms: 2.5, kind: 'STATE', steps: 6, state: { g: 1365, senderTick: 1380 } },
    ];
    expect(repairFigures(calls, { hold, states, witnessStates: 3 }, 2)).toMatchObject({
      adoptMs: 6.4, back: 240, statesFromHold: 3, witnessStates: 3, worstMs: 6.4, worstSteps: 14, steps: 34, resyncs: 2,
    });
  });

  it('gives no adoption and no depth when the page took none of the STATEs from the hold, never a dropped one in its place', () => {
    // Each STATE comes through the held burst once its resync has moved on, and the page drops it: three sent, none
    // taken, no resync done, and the window ends first.
    const hold = { fromMs: 20_000, toMs: 24_100, resyncsBefore: 0, armedMs: 19_000, calm: false, repairedMs: null };
    const states = [{ atMs: 24_150, g: 850, senderTick: 1107 }, { atMs: 26_650, g: 1100, senderTick: 1340 }, { atMs: 29_150, g: 1350, senderTick: 1590 }];
    const calls = [
      { at: 26_600, ms: 1.1, kind: 'STATE', steps: 0, state: { g: 850, senderTick: 1107 } }, { at: 26_620, ms: 0.2, kind: 'TICK', steps: 0 },
      { at: 29_100, ms: 0.9, kind: 'STATE', steps: 0, state: { g: 1100, senderTick: 1340 } }, { at: 29_120, ms: 3.2, kind: 'timer', steps: 14 },
      { at: 31_600, ms: 1.0, kind: 'STATE', steps: 0, state: { g: 1350, senderTick: 1590 } },
    ];
    expect(repairFigures(calls, { hold, states, witnessStates: 3 }, 0)).toMatchObject({
      adoptMs: null, back: null, statesFromHold: 3, witnessStates: 3, worstMs: 3.2, worstSteps: 14, steps: 14, resyncs: 0,
    });
  });
});
