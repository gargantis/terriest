// The tuning metrics (design §9.6, PLAN Q-10): what M2's values are settled
// by when the owner isn't free (§17), and the evidence for
// research/tuning/REPORT.md, which settle writes. Off the gate:
//
//   npx vitest run --config dev/vitest.config.ts
//
// It writes research/tuning/results.json, and refuses to overwrite it
// unless TERRIEST_TUNING_OUT names the file to write: that one, to rewrite
// it on purpose, or another. Its other options:
//   TERRIEST_TUNING_ONLY=netting,touches   only these sections (SECTIONS);
//   TERRIEST_TUNING_BASE='{"rearmGapMetres":0.5}'   measure from these
//     settings, by key path, instead of src/config.ts's, such as the
//     tuning page's fragment values or the owner's;
//   TERRIEST_TUNING_CANDIDATES='[{"key":"rearmGapMetres","values":[0.6,0.5]}]'
//     these candidate lists in place of the defaults for their keys.
//
// The 'values' section is §9.6's table: each value's metric, check and rule,
// fixed before anything is measured (research/tuning/REPORT.md's method).
// The rule keeps the start value unless a named check fails, and then takes
// the candidate nearest it that passes; the netting takes the largest that
// passes, and the push assist the smallest cap. It writes the picks, as a
// TERRIEST_TUNING_BASE for the next round, and apart from them any pick
// that would move a value REQUIREMENTS gives, which only the owner can. The
// other sections measure the configuration itself.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { config, type Config } from '../src/config';
import { type BotParams, botParams, newBrain, think } from '../src/core/bot/brain';
import { botCoat, botIds, botName } from '../src/core/bot/bot-id';
import { e2eMatch, emptyGoalRun, fallBackRun, hostOf, regulationMatch, theBrain } from '../src/core/bot/marks';
import { ballOnTerriers, dribble, kickoffPinch, pushTime } from '../src/core/sim/cases';
import { JOIN, READY, type TickInput } from '../src/core/sim/input';
import { simParams, type SimParams } from '../src/core/sim/params';
import { NETTING_SHOTS, type RestCase, sceneInputs, sceneStart, WALL_SCRUM } from '../src/core/sim/scenes';
import { ENDED, genesis, IN_PLAY } from '../src/core/sim/state';
import { makeSim, step } from '../src/core/sim/step';
import { BOX_SIDE_METRES, build, findRow, parseValue, ROWS, sliderOf, spotProblems, valueAt, withValue } from './tuning/model';
import { nettingShot, results, Run, type Scenario, scenarioOf } from './tuning/scenarios';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT = 'research/tuning/results.json';
const OUT = resolve(ROOT, process.env.TERRIEST_TUNING_OUT ?? DEFAULT_OUT);

const SECTIONS = ['pushes', 'slip-out', 'hits', 'bowling', 'netting', 'touches', 'guard', 'roll', 'head-on', 'collider', 'drive', 'bots', 'timing', 'values'] as const;
type Section = (typeof SECTIONS)[number];
const ONLY = (process.env.TERRIEST_TUNING_ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const unknown = ONLY.filter((x) => !(SECTIONS as readonly string[]).includes(x));
if (unknown.length > 0) throw new Error(`TERRIEST_TUNING_ONLY names no section ${unknown.join(', ')}: the sections are ${SECTIONS.join(', ')}`);
const runs = (section: Section): boolean => ONLY.length === 0 || ONLY.includes(section);

/** The settings measured from: src/config.ts's, or TERRIEST_TUNING_BASE's. */
function baseConfig(): Config {
  const text = process.env.TERRIEST_TUNING_BASE;
  if (!text) return config;
  const given: unknown = JSON.parse(text);
  if (typeof given !== 'object' || given === null || Array.isArray(given)) throw new Error('TERRIEST_TUNING_BASE is a JSON object of settings by key path');
  const changes: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(given)) {
    const s = sliderOf(key);
    if (!s) throw new Error(`TERRIEST_TUNING_BASE: ${key} is no setting the simulation or the brain reads`);
    const parsed = parseValue(s, JSON.stringify(v));
    if ('problem' in parsed) throw new Error(`TERRIEST_TUNING_BASE: ${parsed.problem}`);
    changes[key] = parsed.value;
  }
  return build(changes).config;
}

const BASE = baseConfig();
const out: Record<string, unknown> = {
  utc: new Date().toISOString(),
  node: process.version,
  base: process.env.TERRIEST_TUNING_BASE ? JSON.parse(process.env.TERRIEST_TUNING_BASE) : 'src/config.ts',
  configuration: BASE,
};
let ran = 0;

/** A candidate list: a setting's key path and the values to try, the start first. */
interface Candidates {
  readonly key: string;
  readonly values: readonly number[];
}

function candidatesFor(key: string, values: readonly number[]): Candidates {
  const given = process.env.TERRIEST_TUNING_CANDIDATES;
  if (given) {
    const list: unknown = JSON.parse(given);
    const found = Array.isArray(list) ? list.find((c: { key?: unknown }) => c?.key === key) : undefined;
    if (found && Array.isArray(found.values) && found.values.every((v: unknown) => typeof v === 'number')) return { key, values: found.values };
  }
  return { key, values };
}

const round = (n: number | null, digits = 3): number | null => (n === null || !Number.isFinite(n) ? n : Number(n.toFixed(digits)));
const paramsOf = (c: Config): SimParams => simParams(c);

/** A scenario run headless to its length, or until its measures are done. */
function measured(sc: Scenario | string, c: Config, seed = 0): ReturnType<typeof results> {
  const scenario = typeof sc === 'string' ? scenarioOf(sc) : sc;
  if (!scenario) throw new Error(`no scenario ${String(sc)}`);
  return results(new Run(scenario, c, seed).finish());
}

const figure = (r: ReturnType<typeof results>, measure: string, field: string): number | boolean | string | null => r[measure]?.[field] ?? null;

// --- The metrics, each a function of a configuration ---

const LAYOUTS: readonly [string, 'train' | 'line' | 'round', number][] = [
  ['one pusher', 'train', 1], ['two in a train', 'train', 2], ['four in a train', 'train', 4],
  ['two round the ball', 'round', 2], ['two on a line', 'line', 2], ['four round the ball', 'round', 4], ['four on a line', 'line', 4],
];

/** M0's push layouts in both frames (§16, C-18): seconds to 95% of run speed. */
function pushRows(c: Config): { name: string; frame: string; seconds: number | null; top: number; slipOuts: number }[] {
  return LAYOUTS.flatMap(([name, layout, m]) => (['pitch', 'ball'] as const).map((frame) => {
    const r = pushTime(layout, m, frame, c, 600);
    return { name, frame, seconds: round(r.seconds), top: round(r.top)!, slipOuts: r.slipOuts };
  }));
}

const pushOf = (rows: ReturnType<typeof pushRows>, name: string, frame: string): number | null => rows.find((r) => r.name === name && r.frame === frame)?.seconds ?? null;

/** §16's push marks: one pusher 1.2 s ± 10%, four in a train 0.6 s ± 10%. */
function pushMarks(rows: ReturnType<typeof pushRows>): string[] {
  const fails: string[] = [];
  const one = pushOf(rows, 'one pusher', 'pitch');
  const four = pushOf(rows, 'four in a train', 'pitch');
  if (one === null || one < 1.08 || one > 1.32) fails.push(`one pusher takes ${one ?? 'longer than 10'} s, outside 1.2 s ± 10%`);
  if (four === null || four < 0.54 || four > 0.66) fails.push(`four in a train take ${four ?? 'longer than 10'} s, outside 0.6 s ± 10%`);
  return fails;
}

const HOLDINGS: readonly RestCase['holding'][] = ['ball frame', 'pitch frame, opposite'];

/** §16's four slip-out cases as M0 ran them (C-21): a ball on terriers
 *  pushing toward it, 5°–58° at 1 to 4 a side, mirrored and off mirror, 8 s
 *  each; two sitting terriers, 4°–58° by 0.25°; M0's 336 dribbles; and the
 *  kickoff pinches. With the sweep, the window's bounds too: the lowest hop
 *  onto a dribbler in the 2,880-dribble sweep, which the cone must stay
 *  under, and the sitting pair at cones under the configured one. */
function slipOut(c: Config, sweep: boolean): Record<string, unknown> {
  let landed = 0, held = 0, worst = 0, mismatches = 0;
  let worstAt = '';
  for (let thetaDeg = 5; thetaDeg <= 58; thetaDeg++) {
    for (const holding of HOLDINGS) {
      for (let packSize = 1; packSize <= 4; packSize++) {
        for (const offMirror of [false, true]) {
          const r = ballOnTerriers({ packSize, thetaDeg, holding, offMirror }, 8, c);
          if (r.landed === null) continue;
          landed++;
          if (r.down === null) held++;
          else if (r.down > worst) {
            worst = r.down;
            worstAt = `${packSize} a side at ${thetaDeg}°, ${holding}${offMirror ? ', off mirror' : ''}`;
          }
          if (!offMirror && r.mirror !== null) mismatches++;
        }
      }
    }
  }
  const sitting = sittingWorst(c);
  let dribbleSlips = 0;
  let dribbles = 0;
  for (const frame of ['ball', 'pitch'] as const) {
    for (const zoomies of [false, true]) {
      for (let v = 0; v <= (zoomies ? 9 : 6); v += 3) {
        for (let i = 0; i < 12; i++) {
          for (const stepOff of frame === 'ball' ? [0, 3, 29] : [0]) {
            dribbleSlips += dribble(frame, zoomies, 0.05 + i * 0.0313, c, v, stepOff).slipOuts;
            dribbles++;
          }
        }
      }
    }
  }
  const pinches: { packSize: number; zoomies: boolean; down: number | null; mirrored: boolean; slipOuts: number }[] = [];
  for (let packSize = 1; packSize <= 4; packSize++) {
    for (const zoomies of [false, true]) {
      const r = kickoffPinch(packSize, zoomies, 10, c);
      pinches.push({ packSize, zoomies, down: round(r.down), mirrored: r.mirror === null, slipOuts: r.slipOuts });
    }
  }
  const fails: string[] = [];
  if (held > 0) fails.push(`case 1: ${held} of ${landed} rest cases held up for 8 s`);
  if (worst > 1.5) fails.push(`case 1: the worst comes down in ${round(worst)} s, over 1.5 s (${worstAt})`);
  if (mismatches > 0) fails.push(`case 1: ${mismatches} mirrored cases lost P8`);
  if (sitting.worst === null || sitting.worst > 0.5) fails.push(`case 2: two sitting terriers take ${sitting.worst ?? 'forever'} s, over 0.5 s`);
  if (dribbleSlips > 0) fails.push(`case 3: ${dribbleSlips} slip-outs in ${dribbles} dribbles`);
  for (const p of pinches) if (!p.mirrored || p.down === null) fails.push(`case 4: the pinch at ${p.packSize}${p.zoomies ? ', zoomies' : ''} ${p.mirrored ? 'stays up' : 'lost P8'}`);
  const result: Record<string, unknown> = {
    restCases: { landed, held, worst: round(worst), worstAt, mismatches },
    sitting, dribbles: { runs: dribbles, slipOuts: dribbleSlips }, pinches, fails,
  };
  if (sweep) result.window = slipWindow(c);
  return result;
}

/** Two sitting terriers under a dropped ball, 4°–58° by 0.25°: the worst
 *  time from its landing to the floor (§16's 0.5 s). */
function sittingWorst(c: Config): { worst: number | null; at: number } {
  let worst = 0;
  let at = 0;
  for (let thetaDeg = 4; thetaDeg <= 58; thetaDeg += 0.25) {
    const r = ballOnTerriers({ packSize: 1, thetaDeg, holding: 'sitting' }, 8, c);
    if (r.landed === null) continue;
    const v = r.down ?? Infinity;
    if (v > worst) {
      worst = v;
      at = thetaDeg;
    }
  }
  return { worst: Number.isFinite(worst) ? round(worst) : null, at };
}

/** C-21's window (D-5): the cone must come down under the dribbles' lowest
 *  hop onto the dribbler, and the sitting pair needs it wide enough to get
 *  down within 0.5 s. M0's 2,880-dribble sweep, run here under the
 *  configured slip-out (M0's ran with none), so a hop under the cone shows
 *  as a slip-out too; and the sitting pair at cones from 2° under it. */
function slipWindow(c: Config): Record<string, unknown> {
  let lowest = 180;
  let at = '';
  let n = 0;
  let slips = 0;
  for (const frame of ['ball', 'pitch'] as const) {
    for (const zoomies of [false, true]) {
      for (let v = 0; v <= (zoomies ? 9 : 6); v += 1.5) {
        for (let i = 0; i < 24; i++) {
          for (let stepOff = 0; stepOff <= (frame === 'ball' ? 8 : 0); stepOff++) {
            const runUp = 0.05 + i * 0.0157;
            const d = dribble(frame, zoomies, runUp, c, v, stepOff);
            n++;
            slips += d.slipOuts;
            if (d.hopAngles[0] < lowest) {
              lowest = d.hopAngles[0];
              at = `${frame} frame, ${stepOff} steps off, ${zoomies ? 'zoomies' : 'run'} from ${v} m/s, run-up ${runUp.toFixed(4)} m`;
            }
          }
        }
      }
    }
  }
  const cone = c.slipOutConeDegrees;
  const cones = [cone - 2, cone - 1, cone - 0.5, cone].map((x) => ({ cone: x, sittingWorst: sittingWorst(withValue(c, 'slipOutConeDegrees', x)).worst }));
  const narrowest = cones.find((x) => x.sittingWorst !== null && x.sittingWorst <= 0.5)?.cone ?? null;
  // The sitting pair's side is case 2's check; this is the dribbles' side.
  const shut = cone < lowest ? [] : [`the cone, ${cone}°, isn't under the dribbles' lowest hop, ${round(lowest)}°, and ${slips} slip-outs fire in the ${n} dribbles`];
  return { dribbles: n, slipOuts: slips, lowestHop: round(lowest), lowestAt: at, sittingByCone: cones, narrowestConeTried: narrowest, shut };
}

/** k = 1–4 simultaneous hits (§16, D-5): the ball's speed after 30 ticks. */
function hitSpeeds(c: Config): Record<string, (number | null)[]> {
  const rows: Record<string, (number | null)[]> = {};
  for (const level of [false, true]) {
    for (const layout of ['parallel', 'centre']) {
      rows[`${level ? 'level' : 'from the floor'}, ${layout}`] = [1, 2, 3, 4].map((k) => {
        const r = measured(`hits-${k}-${level ? 'level' : 'floor'}-${layout}`, c);
        return round(figure(r, "the ball's speed after 30 ticks", 'speed') as number | null);
      });
    }
  }
  return rows;
}

/** C-5's bowling examples (Q-8): a push at zoomies speed's leaving speed, a
 *  ball dribbled at a run meeting a rival, a pounce from the air's leaving
 *  speed, and balls rolled at a terrier above and below the bowling speed. */
function bowlingExamples(c: Config): Record<string, unknown> {
  const zoomies = measured('c5-zoomies-push', c);
  const dribbled = measured('c5-dribble-into-rival', c);
  const pounce = measured('c5-pounce-from-air', c);
  const shot5 = measured('bowling-shot-5', c);
  const shot3 = measured('bowling-shot-3', c);
  const pounceSpeed = figure(pounce, 'leaving speed', 'speed') as number | null;
  const fails: string[] = [];
  if (pounceSpeed === null || pounceSpeed < c.bowlingSpeedMetresPerSecond) fails.push(`a pounce from the air sends the ball off at ${round(pounceSpeed)} m/s, under the bowling speed`);
  if (figure(dribbled, 'bowled', 'tumbled') !== true) fails.push('a ball dribbled at a run doesn\'t bowl the rival it meets');
  return {
    zoomiesPushLeaving: round(figure(zoomies, 'leaving speed', 'speed') as number | null),
    dribbleAtARun: { tumbled: figure(dribbled, 'bowled', 'tumbled'), approach: round(figure(dribbled, 'bowled', 'approach') as number | null) },
    pounceFromAirLeaving: round(pounceSpeed),
    rolledAt5: { tumbled: figure(shot5, 'bowled', 'tumbled'), approach: round(figure(shot5, 'bowled', 'approach') as number | null) },
    rolledAt3: { tumbled: figure(shot3, 'bowled', 'tumbled'), approach: round(figure(shot3, 'bowled', 'approach') as number | null) },
    fails,
  };
}

/** Tumbles a minute of play in seeded bot matches, by cause: a ball contact
 *  in the substep the tumble begins is bowling (Q-8), else a pounce. */
function botTumbles(c: Config, packSize: number, seeds: number): Record<string, number | null> {
  let bowled = 0, pounced = 0, playTicks = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const run = new Run(scenarioOf(`bot-match-${packSize}`)!, c, seed);
    const P = run.P;
    const was = new Int32Array(2 * packSize);
    const inner = run.sim.probe;
    run.sim.probe = (s, sub) => {
      inner?.(s, sub);
      const ph = run.sim.physics;
      for (const T of s.terriers) {
        const slot = 2 * T.spot + T.pack;
        if (T.tumble === P.tumbleTicks && was[slot] !== P.tumbleTicks) {
          let ball = false;
          for (let k = 0; k < ph.cnt; k++) if (ph.ci[k] === slot && ph.cj[k] === ph.ball) ball = true;
          if (ball) bowled++;
          else pounced++;
        }
        was[slot] = T.tumble;
      }
    };
    const cap = 8 * P.ticksPerMinute;
    while (run.s.phase !== ENDED && run.ticks < cap) {
      run.tick();
      if (run.s.phase === IN_PLAY) playTicks++;
    }
  }
  const minutes = playTicks / paramsOf(c).ticksPerMinute;
  return { matches: seeds, minutes: round(minutes, 1), bowledAMinute: minutes > 0 ? round(bowled / minutes) : null, pouncedAMinute: minutes > 0 ? round(pounced / minutes) : null };
}

/** §9.6's netting shots, scenes.ts's 18: each one's least |x| from its goal
 *  to its celebration's end, and whether every one stays wholly behind the
 *  line. A shot that doesn't score fails too. */
function netting(c: Config): Record<string, unknown> {
  const shots = NETTING_SHOTS.map((shot) => {
    const m = measured(nettingShot(shot), c)['back out of the netting']!;
    return { speed: shot.speed, angle: shot.angleDeg, kind: shot.kind, goal: m.goal === true, leastX: round(m.leastX as number | null), wholly: m.wholly === true };
  });
  const worst = (v: number): number | null => Math.min(...shots.filter((s) => s.speed === v && s.leastX !== null).map((s) => s.leastX!));
  const fails = shots.filter((s) => !s.wholly).map((s) => `${s.kind} at ${s.speed} m/s, ${s.angle}°: ${s.goal ? `least |x| ${s.leastX}` : 'no goal'}`);
  return { shots, worstAt5: worst(5), worstAt10: worst(10), whollyBehind: paramsOf(c).pitch.goalLineX + paramsOf(c).ballRadius, fails };
}

/** The re-arm gap's cases (§9.6): a push from contact for 2 s, at a run and
 *  at zoomies speed, in both frames, counts one touch; a ball shot at a wall
 *  from 2 m and met on its rebound counts two. */
function touches(c: Config): Record<string, unknown> {
  const pushes: Record<string, number> = {};
  const fails: string[] = [];
  for (const frame of ['ball', 'pitch']) {
    for (const pace of ['run', 'zoomies']) {
      const n = figure(measured(`touches-push-${frame}-${pace}`, c), 'touches', 'touches') as number;
      pushes[`${frame} frame, ${pace}`] = n;
      if (n !== 1) fails.push(`a push from contact for 2 s in the ${frame} frame at ${pace} counts ${n} touches, not 1`);
    }
  }
  const rebound = figure(measured('touches-wall-rebound', c), 'touches at the rebound', 'touches') as number | null;
  if (rebound !== 2) fails.push(`a ball met on its rebound from the wall makes ${rebound ?? 'no'} touches, not 2`);
  return { pushes, rebound, fails };
}

/** The tumble guard (§9.6): two rivals pouncing in turn as soon as a pounce
 *  could tumble a still terrier, for 30 s: its share of time tumbled, and its
 *  shortest time up after a get-up, which must be at least the guard. */
function guard(c: Config): Record<string, unknown> {
  const m = measured('alternating-pounces', c)['time tumbled']!;
  const fails: string[] = [];
  const up = m.shortestUp as number | null;
  if (up !== null && up < c.tumbleGuardSeconds - 1e-9) fails.push(`up only ${up} s after a get-up, under the ${c.tumbleGuardSeconds} s guard`);
  return { share: round(m.share as number | null), tumbles: m.tumbles, shortestUp: round(up), fails };
}

const roll = (c: Config): number | null => round(figure(measured('roll-3', c), 'roll', 'metres') as number | null);

/** Terriers meeting head-on at run speed (the terrier bounce), and the wall
 *  scrum's contacts a substep. */
function headOn(c: Config): Record<string, unknown> {
  const m = measured('head-on', c)['head-on']!;
  const P = paramsOf(c);
  const sim = makeSim(P, WALL_SCRUM.packSize);
  const s = sceneStart(WALL_SCRUM, P);
  const inputs: TickInput[] = [];
  for (let t = 1; t <= 600; t++) step(sim, s, sceneInputs(WALL_SCRUM, s, t, inputs));
  const st = sim.physics.stats;
  return { closing: round(m.closing as number), separating: round(m.separating as number | null), ratio: round(m.ratio as number | null), scrumContactsASubstep: round(st.contacts / st.substeps, 2), scrumMostContacts: st.maxContacts };
}

/** D-4's drawn box against the collider: the 0.6 × 0.5 × 0.5 m box overhangs
 *  the sphere by (length − 2r)/2 along the heading, and toward a floor
 *  push's contact it reaches past the sphere (D-4: 14 cm at r = 0.25 m). */
function collider(c: Config): Record<string, number | null> {
  const r = c.terrierRadiusMetres;
  const R = c.ballRadiusMetres;
  const half = c.terrierLengthMetres / 2;
  const sin = (R - r) / (R + r);
  const cos = Math.sqrt(1 - sin * sin);
  return {
    radius: r,
    overhang: round(half - r),
    contactDegreesUp: round((Math.asin(sin) * 180) / Math.PI, 2),
    boxReachPastTheSphere: round(half * cos + (BOX_SIDE_METRES - r) * sin - r),
  };
}

/** The drive and idle friction: run speed from rest (REQUIREMENTS: 0.4 s),
 *  and a pusher moving an idle terrier (D-6: 3.5 m/s²). */
function drive(c: Config): Record<string, number | null> {
  return {
    runSpeedFromRest: round(figure(measured('run-from-rest', c), 'run speed from rest', 'seconds') as number | null),
    pushedAcceleration: round(figure(measured('push-idle', c), "the pushed terrier's acceleration", 'acceleration') as number | null, 2),
  };
}

/** Q-9's marks from src/core/bot/marks.ts, at a configuration's brain: the
 *  empty goal (≥ 95 of 100 within 20 s, never stuck), the fall-back at 1 to
 *  4 a side (≥ 90 of 100 each, restated for bots-F1), a goal in regulation
 *  (≥ 90 of 100), §16's end-to-end setups (25 of 25 each, ending ahead), and
 *  with `whole`, never stuck through the 100 whole regulation matches. */
function botMarks(c: Config, whole: boolean): Record<string, unknown> {
  const P = paramsOf(c);
  const B: BotParams = botParams(c);
  const empty = Array.from({ length: 100 }, (_, seed) => emptyGoalRun(seed, P, B));
  const scored = empty.filter((r) => r.goalTick >= 0).length;
  const emptyStuck = empty.reduce((n, r) => n + r.stuck.length, 0);
  const fallBack = [1, 2, 3, 4].map((n) => Array.from({ length: 100 }, (_, seed) => fallBackRun(n, seed, theBrain, P, B)).filter((r) => r.pass).length);
  const regulation = Array.from({ length: 100 }, (_, seed) => regulationMatch(seed, true, P, B)).filter((r) => r.regulationGoal).length;
  const e2e: Record<string, number> = {};
  for (const setup of ['three-engine', 'practice'] as const) {
    e2e[setup] = Array.from({ length: 25 }, (_, seed) => e2eMatch(setup, seed, P, B))
      .filter((r) => r.ended && !r.overtime && r.score[r.botPack] > r.score[r.botPack === 0 ? 1 : 0]).length;
  }
  const fails: string[] = [];
  if (scored < 95) fails.push(`the empty goal: ${scored} of 100 score within 20 s`);
  if (emptyStuck > 0) fails.push(`the empty goal: ${emptyStuck} stuck`);
  fallBack.forEach((n, k) => {
    if (n < 90) fails.push(`the fall-back at ${k + 1} a side: ${n} of 100`);
  });
  if (regulation < 90) fails.push(`regulation: ${regulation} of 100 score before 0:00`);
  for (const [setup, n] of Object.entries(e2e)) if (n < 25) fails.push(`the ${setup} setup: ${n} of 25 end with the bot's pack ahead`);
  const result: Record<string, unknown> = { emptyGoal: scored, emptyGoalStuck: emptyStuck, fallBack, regulation, e2e };
  if (whole) {
    let stuck = 0;
    for (let seed = 0; seed < 100; seed++) stuck += regulationMatch(seed, false, P, B).stuck.length;
    result.wholeMatchesStuck = stuck;
    if (stuck > 0) fails.push(`never stuck: ${stuck} stuck in the 100 whole regulation matches`);
  }
  result.fails = fails;
  return result;
}

/** The step's µs on the wall scrum, 8 TickInputs a tick, against M0's
 *  27.8–31.2 µs (REPORT.md §5.3): 600 ticks to warm, then 10 rounds of 300. */
function stepTiming(c: Config): Record<string, number> {
  const P = paramsOf(c);
  const sim = makeSim(P, WALL_SCRUM.packSize);
  const s = sceneStart(WALL_SCRUM, P);
  const inputs: TickInput[] = [];
  let t = 0;
  for (; t < 600; t++) step(sim, s, sceneInputs(WALL_SCRUM, s, t + 1, inputs));
  const rounds: number[] = [];
  for (let k = 0; k < 10; k++) {
    const t0 = performance.now();
    for (let n = 0; n < 300; n++, t++) step(sim, s, sceneInputs(WALL_SCRUM, s, t + 1, inputs));
    rounds.push(((performance.now() - t0) * 1000) / 300);
  }
  rounds.sort((a, b) => a - b);
  return { median: round(rounds[5]!, 1)!, least: round(rounds[0]!, 1)!, most: round(rounds[9]!, 1)! };
}

/** think()'s µs a bot in 4-a-side bot matches, as Practice's host runs 7
 *  brains a tick (design §3): every call timed in batches of a tick's. */
function thinkTiming(c: Config, seeds: number): Record<string, number> {
  const P = paramsOf(c);
  const B = botParams(c);
  let calls = 0;
  let ms = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const s = genesis({ packSize: 4, matchMinutes: c.matchLengthDefaultMinutes }, P);
    const ids = botIds(hostOf(seed));
    const brains = ids.map((id) => newBrain(id, 0, P, B));
    const sim = makeSim(P, 4);
    const list: TickInput[] = [];
    const inputs = new Int32Array(8);
    for (let t = 1; s.phase !== ENDED && t < 8 * P.ticksPerMinute; t++) {
      const t0 = performance.now();
      for (let k = 0; k < 8; k++) inputs[k] = think(brains[k]!, s);
      ms += performance.now() - t0;
      calls += 8;
      list.length = 0;
      for (let k = 0; k < 8; k++) {
        const id = ids[k]!;
        list.push(t === 1 ? { id, input: inputs[k]!, events: JOIN | READY, joinPack: k & 1, coat: botCoat(id, P.coatCount), name: botName(id) } : { id, input: inputs[k]!, events: 0 });
      }
      step(sim, s, list);
    }
  }
  return { calls, microsecondsABot: round((ms * 1000) / calls, 2)! };
}

// --- §9.6's table: each value's candidates through its checks, and its rule ---

interface Trial {
  readonly value: number;
  readonly pass: boolean;
  readonly fails: readonly string[];
  readonly metrics: Readonly<Record<string, unknown>>;
}

interface Value {
  readonly name: string;
  readonly candidates: readonly Candidates[];
  /** 'keep': the start unless a check fails, then the nearest passing; 'largest' and 'smallest': of those passing. */
  readonly rule: 'keep' | 'largest' | 'smallest';
  readonly note?: string;
  /** The metrics at c, and the checks' failures. */
  readonly measure: (c: Config) => { metrics: Record<string, unknown>; fails: string[] };
}

const failsOf = (m: Record<string, unknown>): string[] => (Array.isArray(m.fails) ? (m.fails as string[]) : []);

/** A value's rule over its trials (research/tuning/REPORT.md's method):
 *  'keep' keeps the start if its checks pass there, listed or not, else
 *  takes the passing candidate nearest it, the smaller on a tie; 'largest'
 *  and 'smallest' take that of the passing candidates. null when none
 *  passes. */
function pick(rule: Value['rule'], start: number, startPasses: boolean, trials: readonly Trial[]): number | null {
  if (rule === 'keep' && startPasses) return start;
  const passing = trials.filter((t) => t.pass).map((t) => t.value);
  if (passing.length === 0) return null;
  if (rule === 'largest') return Math.max(...passing);
  if (rule === 'smallest') return Math.min(...passing);
  // Distances to 9 decimal places, so float noise never decides a tie: 0.6 − 0.5 and 0.7 − 0.6.
  const far = (v: number): number => Number(Math.abs(v - start).toFixed(9));
  return [...passing].sort((a, b) => far(a) - far(b) || a - b)[0]!;
}

/** Settings whose value REQUIREMENTS' Configuration table gives (not TBD):
 *  a pick that moves one is proposed to the owner, never adopted (design
 *  §14 Q-1). Read from the table, by the tuning page's rows. */
const REQUIRED: readonly string[] = (() => {
  const requirements = readFileSync(resolve(ROOT, 'REQUIREMENTS.md'), 'utf8');
  return ROWS.filter((r) => r.where === 'Configuration' && !(findRow(requirements, r)?.cells[1] ?? '').includes('TBD')).flatMap((r) => r.keys);
})();

function valuesTable(base: Config): Value[] {
  const zoomies = base.zoomiesSpeedMetresPerSecond;
  const pushChecks = (c: Config): { metrics: Record<string, unknown>; fails: string[] } => {
    const rows = pushRows(c);
    return { metrics: { onePusher: pushOf(rows, 'one pusher', 'pitch'), fourInATrain: pushOf(rows, 'four in a train', 'pitch') }, fails: pushMarks(rows) };
  };
  const slipChecks = (c: Config, sweep: boolean): { metrics: Record<string, unknown>; fails: string[] } => {
    const m = slipOut(c, sweep);
    const shut = (m.window as { shut?: string[] } | undefined)?.shut ?? [];
    return { metrics: m, fails: [...failsOf(m), ...shut.map((x) => `C-21's window is shut: ${x}`)] };
  };
  return [
    {
      name: 'Kickoff spots', rule: 'keep', candidates: [],
      note: "kept (§9.6): the configuration's checks, the pinches and the 1-a-side spot on y = 0 are reported; the regulation mark and the end-to-end setups are the 'bots' section's",
      measure: (c) => {
        const pinches = [1, 2, 3, 4].flatMap((n) => [false, true].map((z) => ({ n, z, r: kickoffPinch(n, z, 10, c) })));
        const fails = [...spotProblems(c)];
        // §16's case 4 as it reads: the pinch comes down, mirrored. Settle
        // restated §9.6's "within 1.5 s" so; the time is reported.
        for (const { n, z, r } of pinches) {
          if (r.mirror !== null) fails.push(`the pinch at ${n}${z ? ', zoomies' : ''} lost P8`);
          if (r.down === null) fails.push(`the pinch at ${n}${z ? ', zoomies' : ''} doesn't come down in 10 s`);
        }
        const solo = c.kickoffSpotsMetres[1] ?? [];
        if (!(solo.length === 1 && solo[0]![1] === 0)) fails.push("the 1-a-side spot isn't on y = 0, where §16's Practice setup needs it");
        return { metrics: { pinches: pinches.map(({ n, z, r }) => ({ packSize: n, zoomies: z, down: round(r.down), mirrored: r.mirror === null })) }, fails };
      },
    },
    {
      name: 'Rolling slowdown', rule: 'keep', candidates: [candidatesFor('rollingSlowdownMetresPerSecond2', [0.5, 0.4, 0.6, 0.3, 0.75, 1])],
      measure: (c) => {
        const p = pushChecks(c);
        const net = netting(c);
        return { metrics: { ...p.metrics, roll3: roll(c), nettingWorstAt5: net.worstAt5, nettingWorstAt10: net.worstAt10 }, fails: p.fails };
      },
    },
    {
      name: 'Terrier bounce', rule: 'keep', candidates: [candidatesFor('terrierRestitution', [0.3, 0.2, 0.4, 0.1, 0.5, 0])],
      measure: (c) => {
        const s = slipChecks(c, false);
        return { metrics: { headOn: headOn(c), timing: stepTiming(c), slipOut: s.metrics }, fails: s.fails };
      },
    },
    {
      name: 'Re-arm gap', rule: 'keep', candidates: [candidatesFor('rearmGapMetres', [0.6, 0.5, 0.7, 0.4, 0.8, 0.3, 1])],
      measure: (c) => {
        const m = touches(c);
        return { metrics: m, fails: failsOf(m) };
      },
    },
    {
      // M2's slip release (bots-F4), a setting of its own since settle: it
      // was the re-arm gap, whose candidates it takes.
      name: 'Slip hold-off', rule: 'keep', candidates: [candidatesFor('slipHoldOffMetres', [0.6, 0.5, 0.7, 0.4, 0.8, 0.3, 1])],
      note: "§16's slip-out cases bound it from below (C-21): as the re-arm gap, at phase 4, 0.5 m passed and 0.4 m failed case 1; no check bounds it from above",
      measure: (c) => slipChecks(c, false),
    },
    {
      name: 'Tumble guard', rule: 'keep', candidates: [candidatesFor('tumbleGuardSeconds', [1.5, 1, 2, 0.5, 2.5])],
      measure: (c) => {
        const m = guard(c);
        return { metrics: m, fails: failsOf(m) };
      },
    },
    {
      name: 'Collider size', rule: 'keep', candidates: [candidatesFor('terrierRadiusMetres', [0.25, 0.23, 0.27, 0.2, 0.3])],
      note: "a change is reported for M4's pushing pose (D-27)",
      measure: (c) => {
        const s = slipChecks(c, true);
        const p = pushChecks(c);
        return { metrics: { collider: collider(c), ...p.metrics, slipOut: s.metrics }, fails: [...s.fails, ...p.fails] };
      },
    },
    {
      name: 'Drive and idle friction', rule: 'keep',
      candidates: [candidatesFor('idleFrictionMetresPerSecond2', [8, 6, 10, 4, 12]), candidatesFor('accelerationMetresPerSecond2', [15, 12, 18])],
      note: "keep both: the acceleration is REQUIREMENTS', so it changes only with the owner (Q-1)",
      measure: (c) => {
        const s = slipChecks(c, true);
        const p = pushChecks(c);
        return { metrics: { ...drive(c), ...p.metrics, slipOut: s.metrics }, fails: [...s.fails, ...p.fails] };
      },
    },
    {
      name: 'Goal netting', rule: 'largest', candidates: [candidatesFor('goalNetRestitution', [0.3, 0.2, 0.15, 0.1, 0.05, 0.02, 0])],
      measure: (c) => {
        const m = netting(c);
        return { metrics: { worstAt5: m.worstAt5, worstAt10: m.worstAt10, shots: m.shots }, fails: failsOf(m) };
      },
    },
    {
      name: 'Bowling speed', rule: 'keep', candidates: [candidatesFor('bowlingSpeedMetresPerSecond', [4, 3.5, 4.5, 3, 5])],
      note: "REQUIREMENTS' value, so a change goes to the owner (Q-1)",
      measure: (c) => {
        const m = bowlingExamples(c);
        return { metrics: { ...m, botMatches2: botTumbles(c, 2, 10), botMatches4: botTumbles(c, 4, 10) }, fails: failsOf(m) };
      },
    },
    {
      name: 'Side-by-side pushers, and the remedy', rule: 'smallest',
      candidates: [candidatesFor('pushAssistCapMetresPerSecond', [zoomies, zoomies + 3, zoomies + 6])],
      note: 'the assist at the smallest cap that passes, and the marks at the measured times plus 10%; if none passes, the assist goes and C-18 goes to the owner (Q-13)',
      measure: (c) => {
        const off = pushRows(withValue(c, 'pushAssistCapMetresPerSecond', 0));
        const on = pushRows(c);
        const one = pushOf(off, 'one pusher', 'ball');
        const fails: string[] = [];
        if (pushOf(on, 'one pusher', 'ball') !== one) fails.push(`one pusher's time moves, from ${one} to ${pushOf(on, 'one pusher', 'ball')} s`);
        for (const name of ['two round the ball', 'two on a line', 'four round the ball', 'four on a line']) {
          const v = pushOf(on, name, 'ball');
          if (v === null || one === null || !(v < one)) fails.push(`${name} in ball view take ${v ?? 'over 10'} s, not under one pusher's ${one} s`);
        }
        const marks = on.filter((r) => r.name.startsWith('two ') || r.name.startsWith('four ')).map((r) => ({ name: r.name, frame: r.frame, seconds: r.seconds, mark: r.seconds === null ? null : round(r.seconds * 1.1) }));
        return { metrics: { off: off.map((r) => ({ name: r.name, frame: r.frame, seconds: r.seconds })), on: marks }, fails };
      },
    },
  ];
}

// --- The run ---

beforeAll(() => {
  if (!process.env.TERRIEST_TUNING_OUT && existsSync(OUT)) {
    throw new Error(`Refusing to overwrite ${DEFAULT_OUT}: set TERRIEST_TUNING_OUT to the file to write, that one to rewrite it on purpose`);
  }
});

afterAll(() => {
  if (ran === 0) return;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`Wrote ${OUT}`);
});

describe('the tuning metrics (design §9.6)', () => {
  it.runIf(runs('pushes'))("M0's push layouts in both frames, the assist off and on (C-18)", () => {
    ran++;
    const z = BASE.zoomiesSpeedMetresPerSecond;
    const caps = [0, z, z + 3, z + 6];
    out.pushes = caps.map((cap) => ({ cap, rows: pushRows(withValue(BASE, 'pushAssistCapMetresPerSecond', cap)) }));
    for (const r of out.pushes as { cap: number; rows: unknown[] }[]) {
      console.log(`push assist cap ${r.cap} m/s`);
      console.table(r.rows);
    }
  });

  it.runIf(runs('slip-out'))("§16's slip-out cases, the 2,880-dribble sweep and C-21's window", () => {
    ran++;
    out.slipOut = slipOut(BASE, true);
    console.log(JSON.stringify(out.slipOut, null, 1));
  });

  it.runIf(runs('hits'))('k = 1–4 simultaneous hits', () => {
    ran++;
    out.hits = hitSpeeds(BASE);
    console.table(out.hits);
  });

  it.runIf(runs('bowling'))("C-5's bowling examples, and tumbles by bowling a minute in bot matches", () => {
    ran++;
    out.bowling = { ...bowlingExamples(BASE), botMatches2: botTumbles(BASE, 2, 10), botMatches4: botTumbles(BASE, 4, 10) };
    console.log(JSON.stringify(out.bowling, null, 1));
  });

  it.runIf(runs('netting'))("the netting rebound at each of §9.6's candidates (C-48)", () => {
    ran++;
    const e = candidatesFor('goalNetRestitution', [0.3, 0.2, 0.15, 0.1, 0.05, 0.02, 0]);
    out.netting = e.values.map((v) => ({ goalNetRestitution: v, ...netting(withValue(BASE, e.key, v)) }));
    console.table((out.netting as Record<string, unknown>[]).map((r) => ({ e: r.goalNetRestitution, worstAt5: r.worstAt5, worstAt10: r.worstAt10, fails: failsOf(r).length })));
  });

  it.runIf(runs('touches'))('the touches the re-arm gap counts', () => {
    ran++;
    out.touches = touches(BASE);
    console.log(JSON.stringify(out.touches));
  });

  it.runIf(runs('guard'))('the time down under alternating pounces', () => {
    ran++;
    out.guard = guard(BASE);
    console.log(JSON.stringify(out.guard));
  });

  it.runIf(runs('roll'))("a 3 m/s ball's roll (A.5: 9 m)", () => {
    ran++;
    out.roll = { metres: roll(BASE) };
    console.log(JSON.stringify(out.roll));
  });

  it.runIf(runs('head-on'))("terriers head-on at run speed, and the scrum's contacts", () => {
    ran++;
    out.headOn = headOn(BASE);
    console.log(JSON.stringify(out.headOn));
  });

  it.runIf(runs('collider'))("D-4's overhang and the drawn box's reach", () => {
    ran++;
    out.collider = collider(BASE);
    console.log(JSON.stringify(out.collider));
  });

  it.runIf(runs('drive'))('run speed from rest, and a pusher moving an idle terrier', () => {
    ran++;
    out.drive = drive(BASE);
    console.log(JSON.stringify(out.drive));
  });

  it.runIf(runs('bots'))("Q-9's marks at candidate brain settings, and the 100 whole regulation matches", () => {
    ran++;
    const brains = [candidatesFor('botReactionSeconds', [0.25, 0.15, 0.35]), candidatesFor('botAimNoiseDegrees', [10, 5, 15])];
    const rows: Record<string, unknown>[] = [{ settings: 'the base', ...botMarks(BASE, true) }];
    for (const { key, values } of brains) {
      for (const v of values) {
        if (v === valueAt(BASE, key)) continue;
        rows.push({ settings: `${key} ${v}`, ...botMarks(withValue(BASE, key, v), false) });
      }
    }
    out.bots = rows;
    console.table(rows.map((r) => ({ ...r, e2e: JSON.stringify(r.e2e), fails: failsOf(r).length })));
  });

  it.runIf(runs('timing'))("the step's µs on the wall scrum, and think()'s µs a bot", () => {
    ran++;
    out.timing = { wallScrumStepMicroseconds: stepTiming(BASE), againstM0: '27.8–31.2', think: thinkTiming(BASE, 3) };
    console.log(JSON.stringify(out.timing));
  });

  it.runIf(runs('values'))("§9.6's table: each value's candidates through its checks, and its rule's pick", () => {
    ran++;
    // Each value alone: its candidates from the base, everything else at the base.
    const picks: Record<string, number> = {};
    const proposals: Record<string, number> = {};
    const table = valuesTable(BASE).map((value) => {
      const start = value.measure(BASE);
      const lists = value.candidates.map(({ key, values }) => {
        const from = valueAt(BASE, key) as number;
        const trials: Trial[] = values.map((v) => {
          const m = v === from ? start : value.measure(withValue(BASE, key, v));
          return { value: v, pass: m.fails.length === 0, fails: m.fails, metrics: m.metrics };
        });
        const chosen = pick(value.rule, from, start.fails.length === 0, trials);
        if (chosen !== null && chosen !== from) (REQUIRED.includes(key) ? proposals : picks)[key] = chosen;
        return { key, start: from, trials, pick: chosen };
      });
      const row = { value: value.name, rule: value.rule, note: value.note ?? null, atTheBase: { pass: start.fails.length === 0, fails: start.fails, metrics: start.metrics }, candidates: lists };
      console.log(`${value.name}: ${start.fails.length === 0 ? 'passes' : `fails: ${start.fails.join('; ')}`} at the base${lists.map((l) => `; ${l.key} picks ${l.pick ?? 'none'}`).join('')}`);
      return row;
    });
    out.values = table;
    // The values whose checks all pass at the base, the changes the rules
    // pick (TERRIEST_TUNING_BASE for the next round), and the picks that
    // would move one of REQUIREMENTS' values, which only the owner can.
    out.allPassAtTheBase = table.every((r) => r.atTheBase.pass);
    out.picks = picks;
    out.proposals = proposals;
    console.log(`every value passes at the base: ${String(out.allPassAtTheBase)}; picks ${JSON.stringify(picks)}; for the owner ${JSON.stringify(proposals)}`);
  });
});
