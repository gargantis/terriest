// The tuning page's model (design §9.3–§9.5, PLAN Q-10): a slider for every
// setting the simulation and the bot brain read, NOT_TUNED with its reason
// for the rest, the configuration a set of changes gives, and the ways tuned
// values leave the page: the URL fragment, and Copy settings' two snippets,
// the changed keys for src/config.ts and the plan's and the requirements'
// table rows in their own wording. DOM-free, so model.test.ts runs it.

import { config, type Config, packSpots } from '../../src/config';
import { type BotParams, botParams } from '../../src/core/bot/brain';
import { simParams, type SimParams } from '../../src/core/sim/params';
import { insideFloorPlan } from '../../src/core/sim/pitch';

// --- The sliders (design §9.3) ---

/** The design's groups, with the pitch's shape apart from the bodies. */
export const GROUPS = ['bodies', 'pitch', 'bounces', 'forces', 'movement', 'actions', 'rules', 'solver', 'slip-out', 'bots', 'push assist'] as const;
export type Group = (typeof GROUPS)[number];

/** A control for one setting, by its key path in Config. */
export interface Slider {
  readonly key: string;
  readonly label: string;
  readonly group: Group;
  /** range: a number from min to max by step; switch: a boolean; json: a
   *  JSON value, checked; assist: 0 for off, or a cap from the zoomies
   *  speed up to max (design §4.4). */
  readonly kind: 'range' | 'switch' | 'json' | 'assist';
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const range = (key: string, label: string, group: Group, min: number, max: number, step: number): Slider =>
  ({ key, label, group, kind: 'range', min, max, step });
const toggle = (key: string, label: string, group: Group): Slider => ({ key, label, group, kind: 'switch', min: 0, max: 1, step: 1 });
const json = (key: string, label: string, group: Group): Slider => ({ key, label, group, kind: 'json', min: 0, max: 0, step: 0 });

// Times step by whole ticks at 60 a second where they can, so most of a
// slider's positions are times derive() takes; one it refuses, such as a
// zoomies meter whose refill isn't whole units a tick, shows its error and
// keeps the last good scene (design §9.3).
export const SLIDERS: readonly Slider[] = [
  range('ballRadiusMetres', 'Ball radius, m', 'bodies', 0.4, 1.2, 0.05),
  range('ballMassKg', 'Ball mass, kg', 'bodies', 0.5, 6, 0.1),
  range('terrierRadiusMetres', "Terrier collider's radius, m (D-4)", 'bodies', 0.15, 0.35, 0.01),
  range('terrierMassKg', 'Terrier mass, kg', 'bodies', 0.5, 3, 0.1),

  range('pitch.lengthMetres', 'Length, goal line to goal line, m', 'pitch', 30, 60, 1),
  range('pitch.widthMetres', 'Width, m', 'pitch', 20, 40, 1),
  range('pitch.heightMetres', 'Walls and overhead net, m', 'pitch', 3, 10, 0.5),
  json('pitch.cornerCutsMetres', 'Corner cuts, m: (−x,−y), (+x,−y), (+x,+y), (−x,+y), opposite corners equal', 'pitch'),
  range('pitch.mouthWidthMetres', 'Goal mouth width, m', 'pitch', 4, 12, 0.5),
  range('pitch.mouthHeightMetres', 'Goal mouth height, m', 'pitch', 2, 5, 0.1),
  range('pitch.goalDepthMetres', 'Goal depth, m', 'pitch', 1, 4, 0.1),
  range('pitch.postRadiusMetres', 'Post and crossbar radius, m', 'pitch', 0.05, 0.3, 0.01),

  range('ballRestitution', 'Ball off the floor, walls, net and frame', 'bounces', 0, 1, 0.05),
  range('goalNetRestitution', "Ball off the goal's netting (C-48)", 'bounces', 0, 1, 0.01),
  range('terrierBallRestitution', 'Terrier against the ball', 'bounces', 0, 1, 0.05),
  range('terrierRestitution', 'Terriers off each other and the walls', 'bounces', 0, 1, 0.05),
  range('restitutionThresholdMetresPerSecond', "Restitution threshold, m/s; also the push assist's moving ball", 'bounces', 0, 2, 0.05),

  range('gravityMetresPerSecond2', 'Gravity, m/s²', 'forces', 1, 20, 0.1),
  range('accelerationMetresPerSecond2', "Acceleration, the drive's cap, m/s²", 'forces', 1, 40, 0.5),
  range('idleFrictionMetresPerSecond2', 'Idle friction, m/s²', 'forces', 0, 20, 0.5),
  range('rollingSlowdownMetresPerSecond2', "Ball's rolling slowdown, m/s²", 'forces', 0, 3, 0.05),

  range('runSpeedMetresPerSecond', 'Run speed, m/s', 'movement', 2, 12, 0.1),
  range('zoomiesSpeedMetresPerSecond', 'Zoomies speed, m/s', 'movement', 3, 20, 0.1),
  range('turnRateTurnsPerSecond', 'Turn rate, turns/s', 'movement', 0.5, 4, 0.05),
  range('noseTurnRateTurnsPerSecond', 'Nose turn rate, turns/s (D-7)', 'movement', 0.25, 3, 0.05),
  range('noseReverseMetresPerSecond', 'Nose reverse, m/s', 'movement', 0, 6, 0.1),
  range('zoomiesFullSeconds', 'Zoomies from a full meter, s', 'movement', 0.5, 10, 0.5),
  range('zoomiesRefillSeconds', 'Zoomies refill from empty, s', 'movement', 0.5, 20, 0.5),
  range('zoomiesMeterUnitsPerTick', "Zoomies meter's units a tick (A.1)", 'movement', 1, 8, 1),
  range('ballOverheadEnterMetres', 'Ball overhead: enter under, m (D-7)', 'movement', 0.05, 1, 0.05),
  range('ballOverheadLeaveMetres', 'Ball overhead: leave above, m', 'movement', 0.05, 1.5, 0.05),
  range('gaitCycleMetres', 'Gait cycle, m (D-9)', 'movement', 0.2, 2, 0.05),
  range('runningMinSpeedMetresPerSecond', 'Draws as running above, m/s', 'movement', 0, 1, 0.05),

  range('jumpHeightMetres', 'Jump height, m', 'actions', 0.2, 3, 0.05),
  range('pounceSpeedMetresPerSecond', 'Pounce speed, m/s', 'actions', 2, 20, 0.5),
  range('lungeSeconds', 'Lunge, s', 'actions', 0.05, 1, 0.05),
  range('pounceWaitSeconds', 'Pounce wait, s', 'actions', 0, 5, 0.05),
  range('bowlingSpeedMetresPerSecond', 'Bowling speed, m/s (Q-8)', 'actions', 1, 12, 0.1),
  range('tumbleSeconds', 'Tumble, s', 'actions', 0.25, 5, 0.05),
  range('getUpSeconds', "Get-up, the tumble's last, s", 'actions', 0, 2, 0.05),
  range('tumbleGuardSeconds', 'Tumble guard, s', 'actions', 0, 5, 0.05),
  range('barkMaxPerSecond', 'Barks at most, a second (L327)', 'actions', 0.25, 4, 0.25),

  range('rearmGapMetres', 'Re-arm gap, surface to surface, m (D-8)', 'rules', 0, 2, 0.05),
  json('kickoffSpotsMetres', "Kickoff spots, pack A's by pack size (D-8)", 'rules'),
  range('warmUpArrivalStepMetres', "Warm-up arrival's step, m", 'rules', 0.25, 3, 0.25),
  range('readyExpirySeconds', 'Ready expiry, s', 'rules', 5, 120, 5),
  range('startCountdownSeconds', 'Start countdown, s', 'rules', 0.5, 10, 0.5),
  range('kickoffCountdownSeconds', 'Kickoff countdown, s', 'rules', 0.5, 10, 0.5),
  range('celebrationSeenSeconds', 'Celebration, as seen, s (Q-7)', 'rules', 0.5, 10, 0.5),
  range('lateWindowTicks', 'Late window w, ticks: the celebration waits it out (Q-7)', 'rules', 0, 30, 1),
  range('voteWindowTicks', 'Vote window v, ticks: the celebration waits it out (Q-7)', 'rules', 0, 30, 1),
  range('removalSilentTicks', 'Removal in warm-up after silent ticks', 'rules', 30, 600, 10),
  range('sittingSilentTicks', 'Sitting from the start countdown after silent ticks', 'rules', 30, 600, 10),
  range('packSizeMin', 'Pack size, from', 'rules', 1, 4, 1),
  range('packSizeMax', 'Pack size, to', 'rules', 1, 4, 1),
  range('matchLengthMinMinutes', 'Match length, from, minutes', 'rules', 1, 10, 1),
  range('matchLengthMaxMinutes', 'Match length, to, minutes', 'rules', 1, 10, 1),
  range('coatCount', 'Coats', 'rules', 1, 16, 1),
  range('displayNameMaxChars', 'Display name, characters', 'rules', 1, 40, 1),
  range('displayNameMaxBytes', 'Display name, UTF-8 bytes', 'rules', 1, 255, 1),

  range('ticksPerSecond', 'Ticks a second (D-3)', 'solver', 30, 240, 30),
  range('substepsPerTick', 'Substeps a tick (D-3)', 'solver', 1, 8, 1),
  range('solverIterations', 'Solver iterations, each a forward and a back sweep', 'solver', 1, 32, 1),
  range('positionPasses', 'Position passes', 'solver', 0, 8, 1),
  toggle('floorContactsInSolve', "The floor's contacts in the solve and the passes", 'solver'),

  range('slipOutConeDegrees', 'Slip-out cone from vertical, ° (C-21)', 'slip-out', 30, 60, 0.1),
  range('slipOutSpeedMetresPerSecond', 'Slip-out speed, m/s', 'slip-out', 0, 6, 0.1),
  range('slipHoldOffMetres', "The slipping flag's hold-off, within this of the body, surface to surface, m", 'slip-out', 0, 2, 0.05),

  range('botReactionSeconds', 'Reaction, s', 'bots', 0, 1, 0.05),
  range('botAimNoiseDegrees', 'Aim noise either way, °', 'bots', 0, 45, 1),
  range('botZoomiesBeyondMetres', 'Zooms toward a target farther than, m', 'bots', 0, 20, 0.5),
  range('botPounceWithinMetres', "Pounces within, of the ball's surface, m", 'bots', 0, 6, 0.1),
  range('botPounceAlignDegrees', 'Pounces lined up within, °', 'bots', 0, 90, 1),
  range('botSupportMetres', 'Supports behind the ball, m', 'bots', 0, 15, 0.5),
  range('botDefendMetres', 'Defends out from its goal line, m', 'bots', 0, 15, 0.5),
  range('botBarkEverySeconds', 'Barks about every, s', 'bots', 1, 20, 0.5),
  range('botStuckSeconds', 'Turns away after held, s', 'bots', 0.25, 5, 0.25),
  range('botStuckMetres', '… within, m', 'bots', 0.1, 2, 0.05),

  { key: 'pushAssistCapMetresPerSecond', label: "Ball-frame push assist's cap, m/s (C-18)", group: 'push assist', kind: 'assist', min: 0, max: 24, step: 0.5 },
];

/** Every setting the simulation and the brain don't read, with why
 *  (design §9.3). model.test.ts checks that changing one changes neither
 *  simParams nor botParams. */
export const NOT_TUNED: readonly { readonly key: string; readonly why: string }[] = [
  { key: 'packSizeDefault', why: "the setup screen's default (D-8); each scenario sets its own pack size" },
  { key: 'matchLengthDefaultMinutes', why: "the setup screen's default (D-8); the regulation mark and the page's bot matches play at it (§16)" },
  { key: 'terrierShoulderHeightMetres', why: "the drawn terrier's size (L311, D-27): drawing's, never the simulation's" },
  { key: 'terrierLengthMetres', why: "the drawn terrier's size (D-4): the views outline its box, and the collider is the radius" },
  { key: 'terrierFloorRestitution', why: 'fixed by L312 and D-5 step 4: a landing terrier never bounces, and a configuration check keeps it 0' },
  { key: 'steering', why: "what the controls send (D-7, D-29); the page's frame selector picks the keyboard terrier's frame" },
  { key: 'chaseSwingTimeConstantSeconds', why: "a camera's (D-28), each viewer's own, tuned at M4" },
  { key: 'chaseSwingMaxTurnsPerSecond', why: "a camera's (D-28), tuned at M4" },
  { key: 'chaseCalmerTimeConstantSeconds', why: "a camera's (D-28), tuned at M4" },
  { key: 'chaseCalmerMaxTurnsPerSecond', why: "a camera's (D-28), tuned at M4" },
  { key: 'ballViewSwingMaxTurnsPerSecond', why: "a camera's (D-28), tuned at M4" },
  { key: 'ballViewCalmerMaxTurnsPerSecond', why: "a camera's (D-28), tuned at M4" },
  { key: 'inputDelayTicks', why: "the timeline's (D-11, D-16), chosen at M3" },
  { key: 'stateHistoryTicks', why: "the timeline's (D-11)" },
  { key: 'inputHistoryTicks', why: "the timeline's (D-11)" },
  { key: 'spreadMaxStepsPerTick', why: "the timeline's (D-11)" },
  { key: 'joinWarmupSeconds', why: "the timeline's joiner warm-up (D-11), M3" },
  { key: 'clockSettleSeconds', why: "the tick clock's (D-15), M3" },
  { key: 'clockSmoothing', why: "the tick clock's (D-15), M3" },
  { key: 'clockGainPerTick', why: "the tick clock's (D-15), M3" },
  { key: 'clockRateMax', why: "the tick clock's (D-15), M3" },
  { key: 'clockDeadbandTicks', why: "the tick clock's (D-15), M3" },
  { key: 'clockRebalanceSeconds', why: "the tick clock's (D-15), M3" },
  { key: 'resyncRetrySeconds', why: "the timeline's resync (D-13), M3" },
  { key: 'stallSendTicks', why: "the timeline's sending after a catch-up (D-10, D-31), M3" },
  { key: 'stateRequestRetrySeconds', why: "the room's joining (PLAN §8), M3" },
  { key: 'eventRetryTicks', why: "the room's events, re-sent (D-12), M3" },
  { key: 'speedBoundMetresPerSecond', why: "D-3's bound, which the configuration checks and the tunnelling fuzz hold speeds to; the step never reads it, and the page warns past it" },
  { key: 'abandonedSeconds', why: "the room's (Q-16), M3" },
  { key: 'duplicateIdSilentSeconds', why: "the network's (D-25), M3" },
  { key: 'handshakeTimeoutSeconds', why: "the network's, M3" },
  { key: 'connectionFailureSeconds', why: "the network's, M3" },
  { key: 'meshPlayersMax', why: "the network's mesh cap (C-49)" },
  { key: 'spectatorsMax', why: "the network's mesh cap" },
  { key: 'messageMaxBytes', why: "the network's (D-18)" },
  { key: 'maxReceiveBytes', why: "the network's (D-18)" },
  { key: 'peersEverySeconds', why: "the room's gossip (D-19, D-21), M3" },
  { key: 'pingEverySeconds', why: "the network's liveness (C-12), M3" },
  { key: 'floodTicksPerTick', why: "the room's, against misbehaving peers, M3" },
  { key: 'floodSeconds', why: "the room's, against misbehaving peers, M3" },
  { key: 'invalidMessagesMax', why: "the room's, against misbehaving peers, M3" },
  { key: 'leaveGraceSeconds', why: "the room's, for a page that leaves, M3" },
  { key: 'botReadyRenewSeconds', why: "the bot host's (C-41, D-39), M3" },
  { key: 'stickSteps', why: "the controls' (D-29), and fixed by A.2's five step bits, which a configuration check holds" },
  { key: 'stickHysteresisSteps', why: "the controls' (D-29), M4" },
  { key: 'stickDeadZoneFraction', why: "the controls' (D-29), M4" },
  { key: 'chaseRereadDegrees', why: "the controls' (Q-19), M4" },
  { key: 'touchEdgeMarginCssPx', why: "the page's touch controls (D-29), M4" },
  { key: 'smoothingMs', why: "drawing's corrections (D-16), M3 and M4" },
  { key: 'ownSmoothingMs', why: "drawing's corrections (D-16)" },
  { key: 'timerStallSeconds', why: "the page's (D-31)" },
  { key: 'timelineTimerMs', why: "the page's timeline timer (D-31), M3" },
  { key: 'phoneShortSideCssPx', why: "the page's (D-30)" },
  { key: 'resultsPressGuardSeconds', why: "the page's (Q-17)" },
  { key: 'lostGraphicsSeconds', why: "the page's (D-30)" },
  { key: 'renderQualityDefault', why: "drawing's (D-33)" },
  { key: 'renderQuality.high.pixelRatioMax', why: "drawing's (D-33)" },
  { key: 'renderQuality.high.msaa', why: "drawing's (D-33)" },
  { key: 'renderQuality.low.pixelRatioMax', why: "drawing's (D-33)" },
  { key: 'renderQuality.low.msaa', why: "drawing's (D-33)" },
  { key: 'soundShiftTicksMax', why: "sound's, under rollback (§13)" },
];

export const sliderOf = (key: string): Slider | undefined => SLIDERS.find((s) => s.key === key);

/** D-4's box round the drawn terrier is 0.6 × 0.5 × 0.5 m, standing on the
 *  floor: its length is terrierLengthMetres, and its width and height are
 *  the drawing's, so a tuned collider never resizes it. */
export const BOX_SIDE_METRES = 0.5;

// --- Configurations by key path ---

/** Every setting's key path: a group's keys under the group's name, and an
 *  array as one setting, as src/config.test.ts reads them. */
export function settingPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) => settingPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

export function valueAt(c: unknown, path: string): unknown {
  let o = c;
  for (const k of path.split('.')) o = typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined;
  return o;
}

/** A copy of c with the setting at path set to v; c is never changed. */
export function withValue<T>(c: T, path: string, v: unknown): T {
  const [head, ...rest] = path.split('.');
  const o = c as Record<string, unknown>;
  return { ...o, [head!]: rest.length === 0 ? v : withValue(o[head!], rest.join('.'), v) } as T;
}

export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Settings changed from src/config.ts's, by key path. */
export type Changes = Readonly<Record<string, unknown>>;

export function configWith(changes: Changes, base: Config = config): Config {
  let c = base;
  for (const [path, v] of Object.entries(changes)) c = withValue(c, path, v);
  return c;
}

/** The slider settings in which c differs from src/config.ts. */
export function changesOf(c: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of SLIDERS) {
    const v = valueAt(c, s.key);
    if (!sameValue(v, valueAt(config, s.key))) out[s.key] = v;
  }
  return out;
}

/** A value for a slider from its text, or why it isn't one. */
export function parseValue(s: Slider, text: string): { value: unknown } | { problem: string } {
  if (s.kind === 'switch') return text === 'true' || text === 'false' ? { value: text === 'true' } : { problem: `${s.label}: not true or false` };
  if (s.kind === 'json') {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      return { problem: `${s.label}: not JSON` };
    }
    const shape = shapeProblem(s.key, v);
    return shape ? { problem: `${s.label}: ${shape}` } : { value: v };
  }
  const v = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(v)) return { problem: `${s.label}: ${JSON.stringify(text)} isn't a number` };
  return { value: v };
}

const isNumbers = (v: unknown, n?: number): boolean =>
  Array.isArray(v) && (n === undefined || v.length === n) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** The JSON settings' shapes: the cuts as four numbers, the spots as a table
 *  of [x, y] pairs by pack size, its first row empty. */
function shapeProblem(key: string, v: unknown): string | null {
  if (key === 'pitch.cornerCutsMetres') return isNumbers(v, 4) ? null : 'four numbers';
  if (key === 'kickoffSpotsMetres') {
    if (!Array.isArray(v) || v.length !== config.kickoffSpotsMetres.length) return `a list of ${config.kickoffSpotsMetres.length} rows, one for each pack size from 0`;
    if (!v.every((row) => Array.isArray(row) && row.every((p) => isNumbers(p, 2)))) return 'each row a list of [x, y] points';
    return null;
  }
  return null;
}

// --- Checks the page makes that simParams doesn't ---

/** The kickoff spots, as src/config.test.ts's check (D-8, A.5): for every
 *  pack size, a spot per terrier in each pack, inside the floor plan by a
 *  terrier's radius, clear of the ball on the centre spot and of each
 *  other; pack A's symmetric about the long axis, so both readings of
 *  "mirrored" pick the same set (D-4). */
export function spotProblems(c: Config): string[] {
  const problems: string[] = [];
  const r = c.terrierRadiusMetres;
  const [a, b] = packSpots(c);
  for (let n = c.packSizeMin; n <= c.packSizeMax; n++) {
    const sa = a[n] ?? [];
    const sb = b[n] ?? [];
    const at = `kickoff spots at ${n} a side`;
    if (sa.length !== n) problems.push(`${at}: ${sa.length} spots, not ${n}`);
    const all = [...sa, ...sb];
    all.forEach(([x, y], i) => {
      if (!insideFloorPlan(c.pitch, x, y, r)) problems.push(`${at}: (${x}, ${y}) isn't inside the floor plan by a terrier's radius`);
      if (!(Math.hypot(x, y) > c.ballRadiusMetres + r)) problems.push(`${at}: a terrier on (${x}, ${y}) touches the ball on the centre spot`);
      for (const [u, v] of all.slice(i + 1)) if (!(Math.hypot(x - u, y - v) > 2 * r)) problems.push(`${at}: terriers on (${x}, ${y}) and (${u}, ${v}) touch`);
    });
    for (const [x, y] of sa) if (!sa.some(([u, v]) => u === x && v === -y)) problems.push(`${at}: (${x}, ${y}) has no mirror across the long axis`);
  }
  return problems;
}

/** What src/config.test.ts's §7.4 checks would fail that simParams lets
 *  through: the page runs such a configuration, and says so. */
export function configWarnings(c: Config): string[] {
  const out: string[] = [];
  const bound = c.speedBoundMetresPerSecond;
  const substep = 1 / (c.ticksPerSecond * c.substepsPerTick);
  const r = c.terrierRadiusMetres;
  const R = c.ballRadiusMetres;
  if (!(bound * substep < Math.min(r, R))) out.push(`no tunnelling (D-3): at ${bound} m/s a body moves ${(bound * substep).toFixed(3)} m a substep, past the smallest radius`);
  if (!(2 * bound * substep < Math.min(r + r, r + R))) {
    out.push(`no tunnelling (D-3): two bodies at ${bound} m/s close ${(2 * bound * substep).toFixed(3)} m a substep, past the smallest radius sum`);
  }
  const g = c.gravityMetresPerSecond2;
  const speeds: [string, number][] = [
    ['the run speed', c.runSpeedMetresPerSecond],
    ['the zoomies speed', c.zoomiesSpeedMetresPerSecond],
    ["the push assist's cap", c.pushAssistCapMetresPerSecond],
    ['a pounce from the air', Math.hypot(c.pounceSpeedMetresPerSecond, Math.sqrt(2 * g * c.jumpHeightMetres))],
    ['a fall from the overhead net', Math.sqrt(2 * g * c.pitch.heightMetres)],
  ];
  for (const [what, v] of speeds) if (!(v < bound)) out.push(`no tunnelling (D-3): ${what} reaches ${v.toFixed(2)} m/s, not under the ${bound} m/s bound`);
  const cap = c.pushAssistCapMetresPerSecond;
  if (!(cap === 0 || cap >= c.zoomiesSpeedMetresPerSecond)) out.push(`the push assist's cap, ${cap} m/s, is neither 0 nor at least the zoomies speed (§4.4)`);
  if (!(c.botBarkEverySeconds >= 2 / c.barkMaxPerSecond)) out.push(`bots bark every ${c.botBarkEverySeconds} s, under two bark gaps (L327)`);
  return out;
}

/** A configuration the page can play, its parameters, and its warnings. */
export interface Built {
  readonly config: Config;
  readonly P: SimParams;
  readonly B: BotParams;
  readonly warnings: readonly string[];
}

/** Builds the configuration a set of changes gives. Throws what simParams,
 *  botParams or the kickoff spots' check refuse, so the page keeps its last
 *  good scene (design §9.3). */
export function build(changes: Changes): Built {
  const c = configWith(changes);
  const P = simParams(c);
  const B = botParams(c);
  const spots = spotProblems(c);
  if (spots.length > 0) throw new Error(spots.join('; '));
  return { config: c, P, B, warnings: configWarnings(c) };
}

/** next, with the push assist's cap raised to the zoomies speed when it's
 *  on and under it: a cap that's on is at least that (design §4.4). */
export function withAssistFloor(next: Changes): Changes {
  const cap = Number(next.pushAssistCapMetresPerSecond ?? config.pushAssistCapMetresPerSecond);
  const zoomies = Number(next.zoomiesSpeedMetresPerSecond ?? config.zoomiesSpeedMetresPerSecond);
  return cap !== 0 && cap < zoomies ? { ...next, pushAssistCapMetresPerSecond: zoomies } : next;
}

/** A set of changes as the page takes them (design §9.3): built, with the
 *  assist's floor, or refused, with why. The page then plays only what's
 *  built, and its fragment, Copy settings and sliders show only that, so a
 *  refused value stays out of them all and appears only in the message. */
export function tryChanges(next: Changes): { readonly changes: Changes; readonly built: Built } | { readonly refused: string } {
  const changes = withAssistFloor(next);
  try {
    return { changes, built: build(changes) };
  } catch (e) {
    return { refused: e instanceof Error ? e.message : String(e) };
  }
}

/** A fragment's changes as the page takes them at load: all of them if they
 *  build together; else each in its turn, kept if it builds with those kept
 *  so far, and the rest tried again while any is taken. Only the values
 *  refused drop, each with why. */
export function takeEach(changes: Changes): { readonly changes: Changes; readonly built: Built; readonly refused: readonly string[] } {
  const all = tryChanges(changes);
  if (!('refused' in all)) return { ...all, refused: [] };
  let kept: Changes = {};
  let built = build(kept);
  let left = Object.keys(changes);
  const why: Record<string, string> = {};
  for (let taken = true; taken && left.length > 0;) {
    taken = false;
    const still: string[] = [];
    for (const key of left) {
      const r = tryChanges({ ...kept, [key]: changes[key] });
      if ('refused' in r) {
        why[key] = r.refused;
        still.push(key);
      } else {
        kept = r.changes;
        built = r.built;
        taken = true;
      }
    }
    left = still;
  }
  return { changes: kept, built, refused: left.map((key) => `the fragment's ${key}, ${JSON.stringify(changes[key])}, was refused: ${why[key]}`) };
}

// --- The URL fragment (design §9.4) ---

/** What the fragment holds: the scenario, its seed, the keyboard's terrier
 *  and frame, and every changed setting as JSON. */
export interface PageState {
  readonly scenario: string;
  readonly seed: number;
  readonly keyboard: string; // a label such as 'A1', or '' for nobody
  readonly frame: number; // A.2's frame: 0 pitch, 1 ball, 2 nose
  readonly changes: Changes;
}

const PAGE_KEYS = ['scenario', 'seed', 'keyboard', 'frame'];

export function fragmentOf(p: PageState): string {
  const q = new URLSearchParams();
  q.set('scenario', p.scenario);
  q.set('seed', String(p.seed));
  q.set('keyboard', p.keyboard);
  q.set('frame', String(p.frame));
  for (const [key, v] of Object.entries(p.changes)) q.set(key, JSON.stringify(v));
  return q.toString();
}

/** The page's state from a fragment, with or without its '#', and what in it
 *  was ignored. */
export function parseFragment(hash: string): { state: Partial<PageState>; problems: string[] } {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const problems: string[] = [];
  const changes: Record<string, unknown> = {};
  const state: { -readonly [K in keyof PageState]?: PageState[K] } = {};
  const scenario = q.get('scenario');
  if (scenario !== null) state.scenario = scenario;
  const seed = Number(q.get('seed'));
  if (q.has('seed') && Number.isInteger(seed) && seed >= 0) state.seed = seed;
  const keyboard = q.get('keyboard');
  if (keyboard !== null) state.keyboard = keyboard;
  const frame = Number(q.get('frame'));
  if (q.has('frame') && (frame === 0 || frame === 1 || frame === 2)) state.frame = frame;
  for (const [key, text] of q) {
    if (PAGE_KEYS.includes(key)) continue;
    const s = sliderOf(key);
    if (!s) {
      problems.push(`the fragment's ${key} is no slider's setting`);
      continue;
    }
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      problems.push(`the fragment's ${key} isn't JSON`);
      continue;
    }
    const parsed = parseValue(s, JSON.stringify(v));
    if ('problem' in parsed) problems.push(`the fragment's ${parsed.problem}`);
    else changes[key] = parsed.value;
  }
  state.changes = changes;
  return { state, problems };
}

// --- Copy settings (design §9.4) ---

/** A number as the tables and src/config.ts write it: no float noise. */
export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
}

function formatValue(v: unknown): string {
  if (typeof v === 'number') return formatNumber(v);
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
  return JSON.stringify(v);
}

/** The changed keys as a TypeScript object for src/config.ts: each key
 *  replaces its line there, and a group's keys sit inside the group. */
export function configSnippet(changes: Changes): string {
  const paths = Object.keys(changes).sort();
  if (paths.length === 0) return '// No setting differs from src/config.ts.\n{}\n';
  const lines = ['// For src/config.ts (Q-10): each key replaces its line; pitch.* sit inside pitch.', '{'];
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const dot = path.indexOf('.');
    if (dot < 0) {
      lines.push(`  ${path}: ${formatValue(changes[path])},`);
      continue;
    }
    const group = path.slice(0, dot);
    groups.set(group, [...(groups.get(group) ?? []), `${path.slice(dot + 1)}: ${formatValue(changes[path])}`]);
  }
  for (const [group, entries] of groups) lines.push(`  ${group}: { ${entries.join(', ')} },`);
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** configSnippet's text back to changes by key path: its subset of
 *  TypeScript, keys bare, values JSON. Throws on anything else. */
export function parseSnippet(text: string): Record<string, unknown> {
  const body = text
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1');
  const value: unknown = JSON.parse(body);
  const out: Record<string, unknown> = {};
  const flatten = (v: unknown, prefix: string): void => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k);
    } else {
      out[prefix] = v;
    }
  };
  flatten(value, '');
  return out;
}

/** A row of the requirements' Configuration table or the plan's A.4 or A.5
 *  that names a slider's setting: the settings it names, and the numbers
 *  its value cell gives, in order, as src/config.test.ts's maps have them
 *  (by default, the settings' own values). model.test.ts checks these
 *  against the documents. */
export interface Row {
  readonly where: 'Configuration' | 'A.4' | 'A.5';
  readonly name: string;
  readonly keys: readonly string[];
  readonly numbers?: (c: Config) => readonly number[];
}

const plusMinus = (spots: readonly (readonly number[])[]): number[] => {
  // A.5 writes a spot and its mirror across the long axis as (x, ±y).
  const out: number[] = [];
  for (let k = 0; k < spots.length; k++) {
    const [x, y] = spots[k] as [number, number];
    const next = spots[k + 1];
    if (next && y !== 0 && next[0] === x && next[1] === -y) {
      out.push(x, y, -y);
      k++;
    } else out.push(x, y);
  }
  return out;
};

const cfg = (where: Row['where'], name: string, ...keys: string[]): Row => ({ where, name, keys });

export const ROWS: readonly Row[] = [
  cfg('Configuration', 'Pack size', 'packSizeMin', 'packSizeMax', 'packSizeDefault'),
  cfg('Configuration', 'Match length', 'matchLengthDefaultMinutes', 'matchLengthMinMinutes', 'matchLengthMaxMinutes'),
  cfg('Configuration', 'Ready expiry', 'readyExpirySeconds'),
  cfg('Configuration', 'Start countdown', 'startCountdownSeconds'),
  cfg('Configuration', 'Kickoff countdown', 'kickoffCountdownSeconds'),
  cfg('Configuration', 'Goal celebration', 'celebrationSeenSeconds'),
  cfg('Configuration', 'Kickoff spots', 'kickoffSpotsMetres'),
  {
    where: 'Configuration', name: 'Pitch', keys: ['pitch.lengthMetres', 'pitch.widthMetres', 'pitch.heightMetres', 'pitch.cornerCutsMetres'],
    numbers: ({ pitch: p }) => {
      const cuts = p.cornerCutsMetres;
      return [p.lengthMetres, p.widthMetres, p.heightMetres, ...(cuts.every((x) => x === cuts[0]) ? [cuts[0]!] : cuts)];
    },
  },
  cfg('Configuration', 'Goal mouth', 'pitch.mouthWidthMetres', 'pitch.mouthHeightMetres', 'pitch.goalDepthMetres'),
  { where: 'Configuration', name: 'Ball', keys: ['ballRadiusMetres', 'ballMassKg', 'terrierMassKg'], numbers: (c) => [2 * c.ballRadiusMetres, c.ballMassKg / c.terrierMassKg] },
  cfg('Configuration', 'Ball bounce', 'ballRestitution'),
  cfg('Configuration', 'Ball rolling slowdown', 'rollingSlowdownMetresPerSecond2'),
  cfg('Configuration', 'Terrier–ball bounce', 'terrierBallRestitution'),
  cfg('Configuration', 'Terrier bounce', 'terrierRestitution'),
  cfg('Configuration', 'Re-arm gap', 'rearmGapMetres'),
  cfg('Configuration', 'Run speed', 'runSpeedMetresPerSecond'),
  cfg('Configuration', 'Acceleration', 'accelerationMetresPerSecond2'),
  cfg('Configuration', 'Turn rate', 'turnRateTurnsPerSecond'),
  cfg('Configuration', 'Zoomies speed', 'zoomiesSpeedMetresPerSecond'),
  cfg('Configuration', 'Zoomies meter', 'zoomiesFullSeconds', 'zoomiesRefillSeconds'),
  cfg('Configuration', 'Jump', 'jumpHeightMetres'),
  cfg('Configuration', 'Gravity', 'gravityMetresPerSecond2'),
  cfg('Configuration', 'Pounce', 'pounceSpeedMetresPerSecond', 'lungeSeconds', 'pounceWaitSeconds'),
  cfg('Configuration', 'Bowling speed', 'bowlingSpeedMetresPerSecond'),
  cfg('Configuration', 'Tumble', 'tumbleSeconds'),
  cfg('Configuration', 'Tumble guard', 'tumbleGuardSeconds'),
  cfg('Configuration', 'Bark', 'barkMaxPerSecond'),
  { where: 'A.4', name: 'Tick rate, substeps', keys: ['ticksPerSecond', 'substepsPerTick'], numbers: (c) => [c.ticksPerSecond, c.substepsPerTick, c.substepsPerTick] },
  cfg('A.4', 'Input delay d, late window w, vote window v', 'inputDelayTicks', 'lateWindowTicks', 'voteWindowTicks'),
  {
    where: 'A.4', name: 'Solver iterations (forward and back sweeps over mirror pairs), position passes (also in mirror pairs)',
    keys: ['solverIterations', 'positionPasses', 'floorContactsInSolve'], numbers: (c) => [c.solverIterations, c.positionPasses],
  },
  cfg('A.4', 'Restitution threshold', 'restitutionThresholdMetresPerSecond'),
  cfg('A.4', 'Slip-out', 'slipOutConeDegrees', 'slipOutSpeedMetresPerSecond', 'slipHoldOffMetres'),
  cfg('A.4', 'Ball overhead', 'ballOverheadEnterMetres', 'ballOverheadLeaveMetres'),
  cfg('A.4', 'Removal before the start countdown', 'removalSilentTicks'),
  cfg('A.4', 'Sitting, from the start countdown', 'sittingSilentTicks'),
  cfg('A.4', 'Display name', 'displayNameMaxChars', 'displayNameMaxBytes'),
  cfg('A.4', 'Warm-up arrivals', 'warmUpArrivalStepMetres'),
  cfg('A.4', 'Gait and running', 'gaitCycleMetres', 'runningMinSpeedMetresPerSecond'),
  cfg(
    'A.4', 'Bot brain', 'botReactionSeconds', 'botAimNoiseDegrees', 'botZoomiesBeyondMetres', 'botPounceWithinMetres', 'botPounceAlignDegrees',
    'botSupportMetres', 'botDefendMetres', 'botBarkEverySeconds', 'botStuckSeconds', 'botStuckMetres',
  ),
  {
    where: 'A.5', name: 'Kickoff spots, pack A (pack B is the point mirror)', keys: ['kickoffSpotsMetres'],
    numbers: (c) => c.kickoffSpotsMetres.flatMap((spots, n) => (n === 0 ? [] : [n, ...plusMinus(spots)])),
  },
  {
    where: 'A.5', name: 'Ball rolling slowdown', keys: ['rollingSlowdownMetresPerSecond2'],
    numbers: ({ rollingSlowdownMetresPerSecond2: a }) => [a, 0, 3, (3 * 3) / (2 * a)],
  },
  cfg('A.5', 'Terrier bounce', 'terrierRestitution'),
  cfg('A.5', 'Goal netting bounce', 'goalNetRestitution', 'ballRestitution'),
  cfg('A.5', 'Re-arm gap', 'rearmGapMetres'),
  cfg('A.5', 'Tumble guard', 'tumbleGuardSeconds'),
  cfg('A.5', 'Terrier collider', 'terrierRadiusMetres', 'terrierMassKg', 'ballMassKg'),
  cfg('A.5', 'Idle friction', 'idleFrictionMetresPerSecond2'),
  cfg('A.5', 'Get-up', 'getUpSeconds', 'tumbleSeconds'),
  cfg('A.5', 'Nose turn rate (vehicle-style)', 'noseTurnRateTurnsPerSecond', 'noseReverseMetresPerSecond'),
  cfg('A.5', 'Posts and crossbar', 'pitch.postRadiusMetres'),
  // The settled cap, then "a cap of 0 turns it off".
  { where: 'A.5', name: 'Ball-frame push assist (C-18)', keys: ['pushAssistCapMetresPerSecond'], numbers: (c) => [c.pushAssistCapMetresPerSecond, 0] },
];

/** Slider settings in no table, as src/config.test.ts's ELSEWHERE has them. */
export const NO_ROW: readonly string[] = ['coatCount', 'zoomiesMeterUnitsPerTick'];

/** What A.4's and A.5's rows say after a value M2 settled by measurement,
 *  "(M2, provisional by measurement)", owner-pending (A.5's note, §17). */
export const PROVISIONAL_MARK = ', provisional by measurement';

/** The settings M2 settled so (research/tuning/REPORT.md §2.4). A value set
 *  on the page is the owner's (Q-10), so the table snippet drops the mark
 *  from the row of one it changes. model.test.ts checks the list against
 *  the plan's rows. */
export const PROVISIONAL: readonly string[] = [
  'kickoffSpotsMetres', 'rollingSlowdownMetresPerSecond2', 'terrierRestitution', 'goalNetRestitution', 'rearmGapMetres',
  'slipHoldOffMetres', 'tumbleGuardSeconds', 'terrierRadiusMetres', 'idleFrictionMetresPerSecond2', 'pushAssistCapMetresPerSecond',
];

const HEADINGS: Readonly<Record<Row['where'], string>> = { Configuration: '## Configuration', 'A.4': '### A.4', 'A.5': '### A.5' };

/** A table row as written, and its cells with Markdown's bold and code marks
 *  removed, as src/config.test.ts reads them. */
interface Line {
  readonly line: string;
  readonly cells: readonly string[];
}

/** The rows of the first table after a heading. */
export function tableLines(doc: string, heading: string): Line[] {
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start < 0) return [];
  const rows: Line[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) rows.push({ line, cells: line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/\*\*|`/g, '')) });
    else if (rows.length > 0 || line.startsWith('#')) break;
  }
  return rows.slice(2);
}

export function findRow(doc: string, row: Row): Line | undefined {
  return tableLines(doc, HEADINGS[row.where]).find((l) => l.cells[0] === row.name);
}

/** The numbers a row's value cell gives, as src/config.test.ts's numbersIn
 *  reads them, each with where it's written: the plan's references aside,
 *  ± as both signs, % as a fraction, and "one", "twice" and "half". */
interface Token {
  readonly start: number;
  readonly end: number;
  readonly values: readonly number[];
  readonly word: boolean;
  readonly percent: boolean;
  readonly plusMinus: boolean;
  readonly minus: string;
}

const WORDS: Readonly<Record<string, number>> = { one: 1, twice: 2, half: 0.5 };

export function tokensIn(value: string): Token[] {
  // References are blanked, not removed, so the tokens keep their places.
  const blank = (m: string): string => ' '.repeat(m.length);
  const text = value.replace(/§\d+(?:\.\d+)*/g, blank).replace(/\b(?:[QDCP]-\d+|[LM]\d+)\b/g, blank);
  const out: Token[] = [];
  for (const m of text.matchAll(/(±)?([−-])?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(%)?|\b(one|twice|half)\b/g)) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[5]) {
      out.push({ start, end, values: [WORDS[m[5]]!], word: true, percent: false, plusMinus: false, minus: '' });
      continue;
    }
    let n = Number(m[3]!.replaceAll(',', ''));
    if (m[4]) n /= 100;
    if (m[2]) n = -n;
    out.push({ start, end, values: m[1] ? [n, -n] : [n], word: false, percent: m[4] !== undefined, plusMinus: m[1] !== undefined, minus: m[2] ?? '−' });
  }
  return out;
}

export const rowNumbers = (row: Row, c: Config): readonly number[] => row.numbers?.(c) ?? row.keys.map((k) => valueAt(c, k) as number);

/** A row's value cell with its numbers moved from base's to c's, or null when
 *  the cell doesn't read as base does, or a changed number is a word. */
export function rewrite(cell: string, row: Row, base: Config, c: Config): string | null {
  const tokens = tokensIn(cell);
  const before = rowNumbers(row, base);
  const after = rowNumbers(row, c);
  const flat = tokens.flatMap((t) => t.values);
  if (flat.length !== before.length || flat.some((n, i) => n !== before[i]) || after.length !== before.length) return null;
  let out = '';
  let at = 0;
  let i = 0;
  for (const t of tokens) {
    const now = after.slice(i, i + t.values.length);
    const was = before.slice(i, i + t.values.length);
    i += t.values.length;
    out += cell.slice(at, t.start);
    at = t.end;
    if (now.every((n, k) => n === was[k])) {
      out += cell.slice(t.start, t.end);
      continue;
    }
    if (t.word || (t.plusMinus && now[1] !== -now[0]!)) return null;
    const n = t.percent ? now[0]! * 100 : now[0]!;
    const text = formatNumber(Math.abs(n));
    out += `${t.plusMinus ? '±' : ''}${n < 0 && !t.plusMinus ? t.minus : ''}${text}${t.percent ? '%' : ''}`;
  }
  return out + cell.slice(at);
}

export interface Docs {
  readonly plan: string; // PLAN.md
  readonly requirements: string; // REQUIREMENTS.md
}

/** The table rows that name a changed setting, in their wording, with the
 *  tuned values: the plan's A.4 and A.5, and the requirements'
 *  Configuration table, which changes only with the owner's sign-off (PLAN
 *  §2, Q-10). A TBD there leaves A.5's value standing. A row loses M2's
 *  provisional mark once a value M2 settled changes, since a value set on
 *  the page is the owner's (A.5's note). */
export function tableSnippet(changes: Changes, docs: Docs, base: Config = config): string {
  const keys = Object.keys(changes);
  if (keys.length === 0) return 'No setting differs from src/config.ts, so no row changes.\n';
  const c = configWith(changes, base);
  const out: string[] = [];
  for (const where of ['A.4', 'A.5', 'Configuration'] as const) {
    const rows = ROWS.filter((r) => r.where === where && r.keys.some((k) => keys.includes(k)));
    if (rows.length === 0) continue;
    out.push(where === 'Configuration'
      ? "REQUIREMENTS.md's Configuration table, only with the owner's sign-off (PLAN §2, Q-10):"
      : `PLAN.md's ${where}:`);
    for (const row of rows) {
      const found = findRow(where === 'Configuration' ? docs.requirements : docs.plan, row);
      if (!found) {
        out.push(`  "${row.name}": no such row; check the table by hand`);
        continue;
      }
      const parts = found.line.split('|');
      const cell = parts[2] ?? '';
      if (found.cells[1]?.includes('TBD')) {
        out.push(`${found.line}\n  (TBD there: A.5's row holds the tuned value until the owner signs it off)`);
        continue;
      }
      const theirs = cell.includes(PROVISIONAL_MARK) && row.keys.some((k) => PROVISIONAL.includes(k) && !sameValue(valueAt(c, k), valueAt(base, k)));
      const moved = rewrite(cell, row, base, c);
      if (moved === null) {
        const by = row.keys.filter((k) => keys.includes(k)).map((k) => `${k} ${formatValue(valueAt(c, k))}`).join(', ');
        out.push(`${found.line}\n  (its wording needs the new values by hand: ${by}${theirs ? `; and drop "${PROVISIONAL_MARK.slice(2)}"` : ''})`);
        continue;
      }
      parts[2] = theirs ? moved.replace(PROVISIONAL_MARK, '') : moved;
      out.push(parts.join('|'));
    }
  }
  const unlisted = keys.filter((k) => NO_ROW.includes(k));
  if (unlisted.length > 0) out.push(`In no table (src/config.test.ts's ELSEWHERE): ${unlisted.join(', ')}`);
  return `${out.join('\n')}\n`;
}
