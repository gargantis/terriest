import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { config, type Config } from '../../src/config';
import { botParams, defaultBotParams } from '../../src/core/bot/brain';
import { regulationMatch } from '../../src/core/bot/marks';
import { hashState } from '../../src/core/sim/codec';
import { canonicalInputs } from '../../src/core/sim/input';
import { defaultParams, simParams } from '../../src/core/sim/params';
import {
  build, changesOf, configSnippet, configWith, findRow, fragmentOf, NO_ROW, NOT_TUNED, parseFragment, parseSnippet, parseValue, ROWS,
  rowNumbers, settingPaths, SLIDERS, sliderOf, spotProblems, tableSnippet, takeEach, tokensIn, tryChanges, valueAt, withValue,
} from './model';
import { parseRecording, replay, startRecording } from './recording';
import { Run, SCENARIOS, scenarioOf } from './scenarios';

// Design §9.5: the tuning page's model, in the gate. Every setting is a
// slider or NOT_TUNED, and the sliders are exactly what the simulation and
// the brain read; the defaults are src/config.ts's; Copy settings' snippet
// and the fragment round-trip; the rows the table snippet rewrites read as
// src/config.ts does; and a recorded bot match replays to its final hash.

const docs = {
  plan: readFileSync(new URL('../../PLAN.md', import.meta.url), 'utf8'),
  requirements: readFileSync(new URL('../../REQUIREMENTS.md', import.meta.url), 'utf8'),
};

const keys = settingPaths(config);
const notTuned = NOT_TUNED.map((n) => n.key);

/** The parameters a configuration gives the simulation and the brain, the
 *  configuration itself aside, or the error building them throws. */
function readings(c: Config): unknown {
  try {
    const P: Record<string, unknown> = { ...simParams(c) };
    delete P.config;
    return { P, B: botParams(c) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** A different value of the same kind. */
function changed(v: unknown): unknown {
  if (typeof v === 'number') return v === 0 ? 1 : v * 1.5 + 1;
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'string') return `${v}, changed`;
  if (Array.isArray(v)) return JSON.parse(JSON.stringify(v).replace(/-?\d+(\.\d+)?/, (n) => String(Number(n) + 0.5)));
  throw new Error(`no change for ${String(v)}`);
}

describe('the tuning page model (design §9.5)', () => {
  it('puts every configuration key in the sliders or NOT_TUNED, never both', () => {
    const sliders = SLIDERS.map((s) => s.key);
    expect(new Set(sliders).size).toBe(sliders.length);
    expect(new Set(notTuned).size).toBe(notTuned.length);
    expect(sliders.filter((k) => notTuned.includes(k))).toEqual([]);
    expect(keys.filter((k) => !sliders.includes(k) && !notTuned.includes(k))).toEqual([]);
    expect([...sliders, ...notTuned].filter((k) => !keys.includes(k))).toEqual([]);
    // The push assist is a slider, a switch with its cap (§4.4).
    expect(sliderOf('pushAssistCapMetresPerSecond')?.kind).toBe('assist');
    expect(NOT_TUNED.find((n) => n.key === 'terrierFloorRestitution')?.why).toMatch(/L312/);
  });

  it('has a slider for exactly the settings simParams and botParams read', () => {
    const base = readings(config);
    const read = keys.filter((k) => !isDeepStrictEqual(readings(withValue(config, k, changed(valueAt(config, k)))), base));
    expect(read.sort()).toEqual(SLIDERS.map((s) => s.key).sort());
  });

  it("defaults to src/config.ts, each range slider's default on its own scale", () => {
    expect(changesOf(config)).toEqual({});
    expect(configWith({})).toEqual(config);
    for (const s of SLIDERS.filter((x) => x.kind === 'range')) {
      const v = valueAt(config, s.key) as number;
      const steps = (v - s.min) / s.step;
      expect(v >= s.min && v <= s.max && Math.abs(steps - Math.round(steps)) < 1e-9, `${s.key} = ${v} on ${s.min} to ${s.max} by ${s.step}`).toBe(true);
    }
    expect(valueAt(config, 'pushAssistCapMetresPerSecond')).toBe(0);
  });

  it('round-trips Copy settings\' snippet into a configuration simParams accepts', () => {
    const changes = {
      rearmGapMetres: 0.5,
      goalNetRestitution: 0,
      floorContactsInSolve: false,
      pushAssistCapMetresPerSecond: 10.5,
      'pitch.mouthWidthMetres': 9,
      'pitch.cornerCutsMetres': [5, 3, 5, 3],
      kickoffSpotsMetres: [[], [[-11, 0]], [[-9, 4.5], [-9, -4.5]], [[-9, 5], [-9, -5], [-15, 0]], [[-8, 6], [-8, -6], [-14, 3], [-14, -3]]],
    };
    const text = configSnippet(changes);
    expect(text).toMatch(/^ {2}pitch: \{ cornerCutsMetres: \[5, 3, 5, 3\], mouthWidthMetres: 9 \},$/m);
    expect(text).toMatch(/^ {2}rearmGapMetres: 0\.5,$/m);
    const back = parseSnippet(text);
    expect(back).toEqual(changes);
    const built = build(back);
    expect(changesOf(built.config)).toEqual(changes);
    expect(built.P.rearmGap).toBe(0.5);
    expect(built.P.pitch.shape.cornerCutsMetres).toEqual([5, 3, 5, 3]);
    expect(parseSnippet(configSnippet({}))).toEqual({});
  });

  it('round-trips the URL fragment, and ignores what no slider reads', () => {
    const state = { scenario: 'push-round-2-ball', seed: 7, keyboard: 'B2', frame: 1, changes: { rearmGapMetres: 0.45, kickoffSpotsMetres: config.kickoffSpotsMetres } };
    const { state: back, problems } = parseFragment(`#${fragmentOf(state)}`);
    expect(problems).toEqual([]);
    expect(back).toEqual(state);
    const bad = parseFragment('scenario=x&ticksPerSecond=60&stickSteps=16&rearmGapMetres=fast&kickoffSpotsMetres=[1]');
    expect(bad.state.changes).toEqual({ ticksPerSecond: 60 });
    expect(bad.problems).toHaveLength(3);
  });

  it('keeps a refused value out of what plays, so out of the fragment and Copy settings too, and at load drops only what is refused', () => {
    // A zoomies refill of 2.5 s leaves 2.4 meter units a tick, which derive() refuses.
    const refused = tryChanges({ ballRadiusMetres: 0.9, zoomiesRefillSeconds: 2.5 });
    expect('refused' in refused && refused.refused).toMatch(/the zoomies meter: .* refill 2\.4 a tick/);
    // The page keeps playing { ballRadiusMetres: 0.9 }, and a later change builds on that.
    expect(tryChanges({ ballRadiusMetres: 0.9, rollingSlowdownMetresPerSecond2: 1 })).toMatchObject({ changes: { ballRadiusMetres: 0.9, rollingSlowdownMetresPerSecond2: 1 } });
    // A fragment holding a refused value loses only that one.
    const loaded = takeEach({ ballRadiusMetres: 0.9, zoomiesRefillSeconds: 2.5, rollingSlowdownMetresPerSecond2: 1 });
    expect(loaded.changes).toEqual({ ballRadiusMetres: 0.9, rollingSlowdownMetresPerSecond2: 1 });
    expect(loaded.built.config.rollingSlowdownMetresPerSecond2).toBe(1);
    expect(loaded.refused).toEqual([expect.stringMatching(/^the fragment's zoomiesRefillSeconds, 2\.5, was refused: the zoomies meter/)]);
    // Values that build only together are taken together.
    expect('refused' in tryChanges({ zoomiesFullSeconds: 2.5 })).toBe(true);
    expect(takeEach({ zoomiesFullSeconds: 2.5, zoomiesRefillSeconds: 2.5 })).toMatchObject({ changes: { zoomiesFullSeconds: 2.5, zoomiesRefillSeconds: 2.5 }, refused: [] });
    // A cap that's on is raised to the zoomies speed (design §4.4); 0 stays off.
    expect(tryChanges({ pushAssistCapMetresPerSecond: 5 })).toMatchObject({ changes: { pushAssistCapMetresPerSecond: 9 } });
    expect(tryChanges({ pushAssistCapMetresPerSecond: 0 })).toMatchObject({ changes: { pushAssistCapMetresPerSecond: 0 } });
  });

  it("refuses kickoff spots without their mirror or on the ball, and warns on a pair's tunnelling and the bots' barks", () => {
    const spots = (n: number, row: [number, number][]): unknown => config.kickoffSpotsMetres.map((r, k) => (k === n ? row : r));
    expect(() => build({ kickoffSpotsMetres: spots(2, [[-9, 4.5], [-10, -4.5]]) })).toThrow(/\(-9, 4\.5\) has no mirror across the long axis/);
    expect(() => build({ kickoffSpotsMetres: spots(1, [[-0.5, 0]]) })).toThrow(/a terrier on \(-0\.5, 0\) touches the ball on the centre spot/);
    expect(build({ substepsPerTick: 1 }).warnings).toContain('no tunnelling (D-3): two bodies at 25 m/s close 0.833 m a substep, past the smallest radius sum');
    expect(build({ botBarkEverySeconds: 1.5 }).warnings).toEqual(['bots bark every 1.5 s, under two bark gaps (L327)']);
  });

  it('refuses what derive() and the kickoff spots\' check refuse, and warns on what the gate would', () => {
    expect(() => build({ lungeSeconds: 0.31 })).toThrow(/the lunge: 0.31 s/);
    expect(() => build({ kickoffSpotsMetres: [[], [[-19.9, 0]], ...config.kickoffSpotsMetres.slice(2)] })).toThrow(/inside the floor plan/);
    expect(spotProblems(configWith({ kickoffSpotsMetres: [[], [[-10, 0]], [[-9, 0.2], [-9, -0.2]], ...config.kickoffSpotsMetres.slice(3)] }))).toEqual([
      'kickoff spots at 2 a side: terriers on (-9, 0.2) and (-9, -0.2) touch',
      'kickoff spots at 2 a side: terriers on (9, -0.2) and (9, 0.2) touch',
    ]);
    expect(build({ zoomiesSpeedMetresPerSecond: 30 }).warnings.join('\n')).toMatch(/zoomies speed reaches 30\.00 m\/s/);
    expect(build({ pushAssistCapMetresPerSecond: 7 }).warnings.join('\n')).toMatch(/neither 0 nor at least the zoomies speed/);
    expect(build({}).warnings).toEqual([]);
    expect(parseValue(sliderOf('pitch.cornerCutsMetres')!, '[4, 4]')).toEqual({ problem: expect.stringMatching(/four numbers/) });
  });

  it("finds every row the table snippet rewrites, reading as src/config.ts does", () => {
    for (const row of ROWS) {
      const found = findRow(row.where === 'Configuration' ? docs.requirements : docs.plan, row);
      expect(found, `${row.where} "${row.name}"`).toBeDefined();
      if (found!.cells[1]!.includes('TBD')) continue;
      expect(tokensIn(found!.line.split('|')[2]!).flatMap((t) => t.values), `${row.where} "${row.name}"`).toEqual(rowNumbers(row, config));
    }
    const named = ROWS.flatMap((r) => r.keys);
    expect(SLIDERS.map((s) => s.key).filter((k) => !named.includes(k) && !NO_ROW.includes(k))).toEqual([]);
  });

  it('writes the changed rows in their own wording', () => {
    const text = tableSnippet({ rearmGapMetres: 0.5, rollingSlowdownMetresPerSecond2: 1, ballRestitution: 0.65, runSpeedMetresPerSecond: 7 }, docs);
    expect(text).toContain('| Re-arm gap | 0.5 m surface to surface |');
    expect(text).toContain('| Ball rolling slowdown | 1 m/s² on the floor, to exactly 0; no air drag. A 3 m/s ball rolls 4.5 m |');
    expect(text).toContain('| Goal netting bounce | 0.3; walls, overhead net and goal frame 0.65 |');
    expect(text).toMatch(/\| Run speed \| 7 m\/s \|/);
    expect(text).toMatch(/Keeps 65% of its speed into the surface/);
    expect(text).toMatch(/\| Re-arm gap \| \*\*TBD\*\* \|.*\n {2}\(TBD there/);
    // The slip release's reach, apart from the re-arm gap, in A.4's Slip-out row (M2).
    expect(tableSnippet({ slipHoldOffMetres: 0.5 }, docs)).toContain('toward the body slipped from only within 0.5 m of it, surface to surface in plan view (M2) |');
    const spots = tableSnippet({ kickoffSpotsMetres: [[], [[-11, 0]], [[-9, 4.5], [-9, -4.5]], ...config.kickoffSpotsMetres.slice(3)] }, docs);
    expect(spots).toContain('1 a side: (−11, 0). 2: (−9, ±4.5). 3: (−9, ±5), (−15, 0). 4: (−8, ±6), (−14, ±3). Everyone faces the ball');
    expect(tableSnippet({ coatCount: 9 }, docs)).toMatch(/In no table .*: coatCount/);
  });

  it('starts and steps every scenario', () => {
    for (const sc of SCENARIOS) {
      const run = new Run(sc, config, 1);
      for (let k = 0; k < 3; k++) run.tick();
      expect(run.ticks, sc.id).toBe(3);
    }
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it("plays the regulation mark's match as the page's 2-a-side bot match, bit for bit", () => {
    // Seed 1's first goal comes at tick 727, so its run to the goal passes tick 600.
    let want = '';
    regulationMatch(1, true, defaultParams, defaultBotParams, (s) => {
      if (s.tick === 600) want = hashState(s);
    });
    const run = new Run(scenarioOf('bot-match-2')!, config, 1);
    while (run.s.tick < 600) run.tick();
    expect(want).toMatch(/^[0-9a-f]{16}$/);
    expect(hashState(run.s)).toBe(want);
  });

  it('records a seeded 2-a-side bot match for 600 ticks, which replays to its final hash, and under one changed setting does not', () => {
    const run = new Run(scenarioOf('bot-match-2')!, config, 5);
    const recorder = startRecording(run.s, run.config);
    for (let k = 0; k < 600; k++) recorder.tick(run.tick());
    const r = recorder.stop(run.s);
    expect(r.ticks).toHaveLength(600);
    expect(hashState(replay(r))).toBe(r.final);
    // As downloaded: JSON, and back.
    expect(hashState(replay(parseRecording(JSON.stringify(r))))).toBe(r.final);
    expect(() => replay({ ...r, config: { ...r.config, runSpeedMetresPerSecond: 7 } })).toThrow(/final hash/);
    const older: Record<string, unknown> = { ...r.config };
    delete older.pushAssistCapMetresPerSecond;
    expect(() => parseRecording(JSON.stringify({ ...r, config: older }))).toThrow(/pushAssistCapMetresPerSecond/);
  });

  it('records each tick in canonical order, whatever order its inputs came in', () => {
    const run = new Run(scenarioOf('bot-match-2')!, config, 5);
    const recorder = startRecording(run.s, run.config);
    let unordered = 0;
    for (let k = 0; k < 120; k++) {
      const given = [...run.tick()].reverse();
      if (!isDeepStrictEqual(canonicalInputs(given, []), given)) unordered++;
      recorder.tick(given);
    }
    expect(unordered).toBeGreaterThan(0);
    for (const t of recorder.stop(run.s).ticks) expect(canonicalInputs(t, [])).toEqual(t);
  });

  it("refuses to record a start stateProblems rejects: a short pack in play", () => {
    const run = new Run(SCENARIOS[0]!, config, 0);
    run.s.terriers.pop();
    expect(() => startRecording(run.s, run.config)).toThrow(/can't be recorded/);
  });
});
