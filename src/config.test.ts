import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { config, type Config, type Derived, derive, derived, packSpots, type PitchShape, type SpotTable } from './config';
import { BOT_SLOTS } from './core/bot/bot-id';
import { STEP_MASK } from './core/sim/input';
import { buildPitch, CAPSULE, FRAME, GOAL_NET, insideFloorPlan, type Piece, type Pitch, pitch, PLANE, QUAD } from './core/sim/pitch';

// PLAN §7.4: the configuration checks. Each check returns the problems it
// finds, so each test runs it on src/config.ts, which must have none, and on
// a copy with a planted bad value, which it must catch.

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

/** A copy of the configuration with some settings changed. */
const planted = (over: Partial<Config>): Config => ({ ...config, ...over });
const plantedPitch = (over: Partial<PitchShape>): Config => planted({ pitch: { ...config.pitch, ...over } });

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- No tunnelling (D-3) ---

/** The fastest body moves less than the smallest radius in a substep, and
 *  the fastest pair, two bodies at the bound head on, closes less than the
 *  smallest radius sum. The bound must cover the speeds the settings give a
 *  body directly; §16's fuzz checks it in play from M2. */
function tunnelling(c: Config): string[] {
  const problems: string[] = [];
  const bound = c.speedBoundMetresPerSecond;
  const substep = 1 / (c.ticksPerSecond * c.substepsPerTick);
  const r = c.terrierRadiusMetres;
  const R = c.ballRadiusMetres;
  const radius = Math.min(r, R);
  const sum = Math.min(r + r, r + R);
  if (!(bound * substep < radius)) {
    problems.push(`at ${bound} m/s a body moves ${bound * substep} m in a substep, not less than the smallest radius, ${radius} m`);
  }
  if (!(2 * bound * substep < sum)) {
    problems.push(`two bodies at ${bound} m/s close ${2 * bound * substep} m in a substep, not less than the smallest radius sum, ${sum} m`);
  }
  const g = c.gravityMetresPerSecond2;
  const direct: [string, number][] = [
    ['run speed', c.runSpeedMetresPerSecond],
    ['zoomies speed', c.zoomiesSpeedMetresPerSecond],
    // A drive target too: a pusher well off the ball's travel drives at the cap (C-18, M2).
    ["the push assist's cap", c.pushAssistCapMetresPerSecond],
    ['a pounce from the air', Math.hypot(c.pounceSpeedMetresPerSecond, Math.sqrt(2 * g * c.jumpHeightMetres))],
    ['a fall from the overhead net', Math.sqrt(2 * g * c.pitch.heightMetres)],
  ];
  for (const [what, v] of direct) if (!(v < bound)) problems.push(`${what} reaches ${v} m/s, not under the ${bound} m/s bound`);
  return problems;
}

// --- The windows and the history (A.4) ---

/** The late window and the vote window fit in the state history after the
 *  input delay, and every TICK's input history covers the delay and the
 *  late window, as roslambo checks. */
function history(c: Config): string[] {
  const problems: string[] = [];
  const span = c.inputDelayTicks + c.lateWindowTicks + c.voteWindowTicks;
  if (!(span < c.stateHistoryTicks)) {
    problems.push(`the input delay, late window and vote window span ${span} ticks, not inside the ${c.stateHistoryTicks}-tick state history`);
  }
  if (!(c.inputHistoryTicks >= c.inputDelayTicks + c.lateWindowTicks)) {
    problems.push(`a TICK's ${c.inputHistoryTicks}-tick input history doesn't cover the input delay and the late window`);
  }
  return problems;
}

// --- Kickoff spots (D-8, A.5) ---

/** For every pack size, each pack has a spot per terrier, inside the pitch
 *  by a terrier's radius, apart from every other spot and from the ball on
 *  the centre spot. The spots are mirrored: pack B's are pack A's point
 *  mirror, and pack A's are symmetric about the long axis, so both readings
 *  of "mirrored" pick the same set (D-4, C-22). */
function kickoff(c: Config, spots: readonly [SpotTable, SpotTable] = packSpots(c)): string[] {
  const problems: string[] = [];
  const r = c.terrierRadiusMetres;
  const [a, b] = spots;
  for (let n = c.packSizeMin; n <= c.packSizeMax; n++) {
    const sa = a[n] ?? [];
    const sb = b[n] ?? [];
    const at = `pack size ${n}`;
    if (sa.length !== n || sb.length !== n) problems.push(`${at}: ${sa.length} and ${sb.length} spots, not ${n} for each pack`);
    const all = [...sa, ...sb];
    all.forEach(([x, y], i) => {
      if (!insideFloorPlan(c.pitch, x, y, r)) problems.push(`${at}: (${x}, ${y}) isn't inside the pitch by a terrier's radius`);
      if (!(Math.hypot(x, y) > c.ballRadiusMetres + r)) problems.push(`${at}: a terrier on (${x}, ${y}) touches the ball on the centre spot`);
      for (const [u, v] of all.slice(i + 1)) {
        if (!(Math.hypot(x - u, y - v) > 2 * r)) problems.push(`${at}: terriers on (${x}, ${y}) and (${u}, ${v}) touch`);
      }
    });
    sa.forEach(([x, y], k) => {
      const m = sb[k];
      if (!m || m[0] !== -x || m[1] !== -y) problems.push(`${at}: pack B's spot ${k} isn't pack A's (${x}, ${y}) point-mirrored`);
      if (!sa.some(([u, v]) => u === x && v === -y)) problems.push(`${at}: pack A's (${x}, ${y}) has no mirror across the long axis`);
    });
  }
  return problems;
}

/** The configuration with pack size n's spots for pack A replaced. */
const withSpots = (n: number, spots: readonly (readonly [number, number])[]): Config =>
  planted({ kickoffSpotsMetres: config.kickoffSpotsMetres.map((s, k) => (k === n ? spots : s)) });

// --- Point mirrors (D-4) ---

const isPointMirror = (p: Piece, q: Piece): boolean =>
  q.kind === p.kind && q.surface === p.surface && q.radius === p.radius &&
  q.ox === -p.ox && q.oy === -p.oy && q.oz === p.oz &&
  q.nx === -p.nx && q.ny === -p.ny && q.nz === p.nz &&
  q.e1x === -p.e1x && q.e1y === -p.e1y && q.e1z === p.e1z &&
  q.e2x === -p.e2x && q.e2y === -p.e2y && q.e2z === p.e2z &&
  q.inv1 === p.inv1 && q.inv2 === p.inv2 &&
  q.minX === -p.maxX && q.maxX === -p.minX && q.minY === -p.maxY && q.maxY === -p.minY &&
  q.minZ === p.minZ && q.maxZ === p.maxZ;

/** Every piece's point mirror, (x, y, z) → (−x, −y, z), is in the list,
 *  exactly, every number the contact tests read included, so mirrored
 *  contacts are bit-for-bit mirrors (D-5), and each piece's mirror index
 *  names it. */
function pointMirrors(pieces: readonly Piece[]): string[] {
  const problems: string[] = [];
  pieces.forEach((p, k) => {
    const found = pieces.flatMap((q, j) => (isPointMirror(p, q) ? [j] : []));
    if (found.length === 0) problems.push(`${p.name}: its point mirror isn't in the list`);
    else if (!found.includes(p.mirror)) problems.push(`${p.name}: its mirror index, ${p.mirror}, names another piece`);
    if (pieces[p.mirror]?.mirror !== k) problems.push(`${p.name}: its mirror's mirror isn't itself`);
  });
  return problems;
}

function pitchMirrors(shape: PitchShape): string[] {
  try {
    return pointMirrors(buildPitch(shape).pieces);
  } catch (e) {
    return [message(e)];
  }
}

/** D-4's second shape: point-symmetric but not mirror-symmetric. */
const SECOND_SHAPE: PitchShape = { ...config.pitch, lengthMetres: 50, widthMetres: 30, cornerCutsMetres: [6, 3, 6, 3], mouthWidthMetres: 10 };

// --- The zoomies meter (A.1) ---

/** The tuned times give whole units a tick: a full meter drains in the
 *  zoomies time and refills from empty in the refill time, in a u16. */
function zoomiesMeter(c: Config): string[] {
  let d: Derived;
  try {
    d = derive(c);
  } catch (e) {
    return [message(e)];
  }
  const problems: string[] = [];
  const { zoomiesMeterFull: full, zoomiesMeterDrainPerTick: drain, zoomiesMeterRefillPerTick: refill } = d;
  for (const [what, v] of [['full', full], ['drain', drain], ['refill', refill]] as const) {
    if (!(Number.isInteger(v) && v > 0 && v <= 0xffff)) problems.push(`the meter's ${what}, ${v}, isn't a whole number of units in a u16`);
  }
  const ticks = (seconds: number): number => Math.round(seconds * c.ticksPerSecond);
  if (drain * ticks(c.zoomiesFullSeconds) !== full) problems.push(`a full meter doesn't drain in ${c.zoomiesFullSeconds} s`);
  if (refill * ticks(c.zoomiesRefillSeconds) !== full) problems.push(`an empty meter doesn't refill in ${c.zoomiesRefillSeconds} s`);
  return problems;
}

// --- The goal mouth (L306) ---

/** The ball fits through each mouth, under the crossbar and between the
 *  posts, and into the goal behind it, between the side nets and under the
 *  top net, wholly behind the goal line, which a goal needs (D-8). Each is
 *  measured on the goal as built, from its pieces: the configuration's own
 *  pitch, or `built`. */
function goalMouth(c: Config, built?: Pitch): string[] {
  let p: Pitch;
  try {
    p = built ?? buildPitch(c.pitch);
  } catch (e) {
    return [message(e)];
  }
  const problems: string[] = [];
  const ball = 2 * c.ballRadiusMetres;
  for (const goal of p.goals) {
    const { posts, bar } = frameOf(p, goal.pack);
    const { back, sides, top } = nettingOf(p, goal.pack);
    const height = bar.oz - bar.radius;
    const width = Math.abs(posts[0].oy - posts[1].oy) - posts[0].radius - posts[1].radius;
    const between = Math.abs(sides[0].oy - sides[1].oy);
    const depth = Math.abs(back.ox) - Math.abs(goal.lineX);
    const at = `goal ${goal.pack}`;
    if (!(ball < height)) problems.push(`${at}: the ball, ${ball} m across, doesn't fit under the crossbar, ${height} m up`);
    if (!(ball < width)) problems.push(`${at}: the ball, ${ball} m across, doesn't fit between the posts, ${width} m apart`);
    if (!(ball < between)) problems.push(`${at}: the ball, ${ball} m across, doesn't fit between the side nets, ${between} m apart`);
    if (!(ball < top.oz)) problems.push(`${at}: the ball, ${ball} m across, doesn't fit under the top net, ${top.oz} m up`);
    if (!(ball < depth)) problems.push(`${at}: the ball, ${ball} m across, can't get wholly behind the line in a goal ${depth} m deep`);
  }
  return problems;
}

function frameOf(p: Pitch, pack: 0 | 1): { posts: [Piece, Piece]; bar: Piece } {
  const frame = p.goals[pack].pieces.map((k) => p.pieces[k]!).filter((q) => q.surface === FRAME);
  const posts = frame.filter((q) => q.e1z !== 0);
  const bar = frame.find((q) => q.e1z === 0);
  if (posts.length !== 2 || !bar) throw new Error(`goal ${pack} has ${posts.length} posts and ${bar ? 'a' : 'no'} crossbar`);
  return { posts: [posts[0]!, posts[1]!], bar };
}

/** A goal's netting by the way each piece faces: the back along x, the
 *  sides along y, the top down. */
function nettingOf(p: Pitch, pack: 0 | 1): { back: Piece; sides: [Piece, Piece]; top: Piece } {
  const net = p.goals[pack].pieces.map((k) => p.pieces[k]!).filter((q) => q.surface === GOAL_NET);
  const back = net.filter((q) => q.nx !== 0);
  const sides = net.filter((q) => q.ny !== 0);
  const top = net.filter((q) => q.nz !== 0);
  if (back.length !== 1 || sides.length !== 2 || top.length !== 1) {
    throw new Error(`goal ${pack}'s netting has ${back.length} back, ${sides.length} side and ${top.length} top pieces`);
  }
  return { back: back[0]!, sides: [sides[0]!, sides[1]!], top: top[0]! };
}

// --- Settings that a format or a rule fixes (M2, design §10) ---

/** A.2's five step bits fix the stick's steps: today nothing else ties the
 *  setting to the input format. */
function stickSteps(c: Config): string[] {
  const steps = STEP_MASK + 1;
  return c.stickSteps === steps ? [] : [`the stick has ${c.stickSteps} steps, and A.2's five step bits hold ${steps}`];
}

/** A landing terrier never bounces (L312), and D-5 step 4 has no terrier
 *  floor bounce to read the setting with, so any other value would be one
 *  the simulation silently ignores. */
function terrierFloor(c: Config): string[] {
  const e = c.terrierFloorRestitution;
  return e === 0 ? [] : [`a terrier keeps ${e} of its speed off the floor, but a landing terrier never bounces (L312)`];
}

/** The ball-frame push assist is off at 0, and on it never slows a pusher
 *  below its base speed: its cap is at least the zoomies speed (C-18). */
function pushAssist(c: Config): string[] {
  const cap = c.pushAssistCapMetresPerSecond;
  const zoomies = c.zoomiesSpeedMetresPerSecond;
  return cap === 0 || cap >= zoomies ? [] : [`the push assist's cap, ${cap} m/s, is neither 0, which is off, nor at least the zoomies speed, ${zoomies} m/s`];
}

/** A bot's barks come about every period, jittered by the bark gap either
 *  way, so the period is at least two gaps and no bark comes within the
 *  gap of the last (L327). */
function botBarks(c: Config): string[] {
  const gap = 1 / c.barkMaxPerSecond;
  return c.botBarkEverySeconds >= 2 * gap ? [] : [`bots bark every ${c.botBarkEverySeconds} s, under two bark gaps of ${gap} s`];
}

// --- The network's settings (M3; M3's design §10) ---

/** A TICK's present and "same" masks are u16s, a bit a tick (M3's design §5.3). */
const TICK_MASK_TICKS = 16;

/** A TICK carries the history its masks hold, as A.2's bits fix the
 *  stick's steps. A wider late window needs a wider history (protocol 2). */
function tickHistory(c: Config): string[] {
  const n = c.inputHistoryTicks;
  return n === TICK_MASK_TICKS ? [] : [`a TICK's input history is ${n} ticks, and its u16 masks hold ${TICK_MASK_TICKS}`];
}

/** Trystero 0.26.0's, the version A.6 pins exactly: an action's frame
 *  (data-limits.mjs's maxActionFrameBytes) and the header of a message sent
 *  in one frame (action-wire.mjs's inlineHeaderSize). */
const TRYSTERO_FRAME_BYTES = 16384;
const TRYSTERO_INLINE_HEADER_BYTES = 36;

/** The largest message goes in one frame with its header, so no message is
 *  chunked, and maxReceiveBytes takes at least a frame (D-18). */
function trysteroFrame(c: Config): string[] {
  const problems: string[] = [];
  const framed = c.messageMaxBytes + TRYSTERO_INLINE_HEADER_BYTES;
  if (!(framed <= TRYSTERO_FRAME_BYTES)) {
    problems.push(
      `the largest message, ${c.messageMaxBytes} bytes, and Trystero's ${TRYSTERO_INLINE_HEADER_BYTES}-byte inline header make ${framed} bytes, past its ${TRYSTERO_FRAME_BYTES}-byte frame`,
    );
  }
  if (!(c.maxReceiveBytes >= TRYSTERO_FRAME_BYTES)) problems.push(`maxReceiveBytes, ${c.maxReceiveBytes}, is under Trystero's ${TRYSTERO_FRAME_BYTES}-byte frame`);
  return problems;
}

/** A normal tick's worst, a late input at the late window's start, is
 *  w + 1 steps, which the spread never splits (D-11, M3's design §2.8). */
function spreadCap(c: Config): string[] {
  const cap = c.spreadMaxStepsPerTick;
  const worst = c.lateWindowTicks + 1;
  return cap >= worst ? [] : [`the spread's cap, ${cap} steps a tick, is under a normal tick's worst, w + 1 = ${worst} steps`];
}

/** A host sends a bot's READY again before its Ready expires, and early
 *  enough that one lost once lands on its second sending. Queued at local
 *  tick n, after the advance, when the final state, w behind, shows the
 *  Ready's time left, it rides in the next tick's input, for n + 1 + d; it
 *  goes again once the final tick passes n + d + eventRetryTicks without the
 *  state showing it, eventRetryTicks after its tick is final, at local tick
 *  n + d + w + eventRetryTicks + 1, for 1 + d later (M3 phase 2's
 *  integration: tend runs after the advance, as roslambo's tendBots). The
 *  Ready expires at n − w and its time left, and a READY for that tick
 *  still renews it, since a tick's events come before the expiry
 *  (step.ts). So the time left is at least 2d + 2w + eventRetryTicks + 2
 *  ticks (C-41, M3's design §4.8). */
function botsReady(c: Config): string[] {
  const problems: string[] = [];
  const renew = c.botReadyRenewSeconds;
  const land = 2 * (c.inputDelayTicks + c.lateWindowTicks) + c.eventRetryTicks + 2;
  if (!(renew < c.readyExpirySeconds)) problems.push(`a bot's READY goes again with ${renew} s of its Ready left, not under the ${c.readyExpirySeconds} s expiry`);
  if (!(renew * c.ticksPerSecond >= land)) {
    problems.push(
      `a bot's READY goes again with ${renew} s of its Ready left, under the ${land} ticks, 2d + 2w + eventRetryTicks + 2, one lost once takes to land`,
    );
  }
  return problems;
}

/** A leaving page keeps its room until its LEAVE is final at its sender,
 *  d + w ticks on (M3's design §4.2). */
function leaving(c: Config): string[] {
  const grace = c.leaveGraceSeconds * c.ticksPerSecond;
  const final = c.inputDelayTicks + c.lateWindowTicks;
  return grace >= final ? [] : [`a leaving page keeps its room for ${c.leaveGraceSeconds} s, ${grace} ticks, under the ${final} ticks, d + w, its LEAVE takes to be final`];
}

/** After a catch-up a page sends only its newest ticks' inputs: at least
 *  its newest, and no more than the late window, since older ones would
 *  reach peers near its end, in time for some and too late for others
 *  (A.4's Timer stall, roslambo D-11's 2026-10-25 fix). */
function afterStall(c: Config): string[] {
  const n = c.stallSendTicks;
  const ok = Number.isInteger(n) && n >= 1 && n <= c.lateWindowTicks;
  return ok ? [] : [`after a stall a page sends its newest ${n} ticks' inputs, not a whole number from 1 to the late window's ${c.lateWindowTicks}`];
}

/** Pings go at most half C-12's silence apart, so a live connection answers
 *  one well within it, even one that sends only PEERS (M3's design §4.4). */
function liveness(c: Config): string[] {
  const silence = c.duplicateIdSilentSeconds;
  return c.pingEverySeconds <= silence / 2 ? [] : [`pings every ${c.pingEverySeconds} s, over half the ${silence} s silence that lets a duplicate ID replace a connection (C-12)`];
}

/** The protocol's counts are u8s: a string's byte length, the IDs PEERS
 *  lists and the bots a TICK carries (M3's design §5). */
const U8_MAX = 255;

/** Each count fits its u8: the name's bytes, as A.1's byte holds them too;
 *  PEERS' IDs, every browser of the mesh but the sender; and BOT_SLOTS. */
function wireCounts(c: Config, botSlots: number = BOT_SLOTS): string[] {
  const problems: string[] = [];
  if (!(c.displayNameMaxBytes <= U8_MAX)) problems.push(`a name of ${c.displayNameMaxBytes} bytes doesn't fit a wire string's u8 length`);
  const peers = c.meshPlayersMax + c.spectatorsMax - 1;
  if (!(peers <= U8_MAX)) problems.push(`PEERS lists up to ${peers} IDs, the mesh cap and the spectators less the sender, past its u8 count`);
  if (!(botSlots <= U8_MAX)) problems.push(`a TICK carries up to ${botSlots} bots, BOT_SLOTS, past its u8 count`);
  return problems;
}

// --- The cameras (M4; M4's design §3.2, §10) ---

/** A player's camera fits the pitch: at its height, with its margin, it's
 *  under the walls' and the net's height and under the goal's mouth, so a
 *  camera at its height fits inside a goal too; its distance behind fits
 *  in half the pitch's width inside the margin; and the distance it rises
 *  nearer than is under that distance and under the goal's depth less the
 *  margin, so insidePitch and the rise always have room. */
function cameras(c: Config): string[] {
  const problems: string[] = [];
  const { cameraAboveMetres: above, cameraBehindMetres: behind, cameraNearestMetres: nearest, cameraWallMarginMetres: margin } = c;
  const { heightMetres: height, mouthHeightMetres: mouth, widthMetres: width, goalDepthMetres: depth } = c.pitch;
  const up = `a player's camera ${above} m up, with its ${margin} m margin,`;
  if (!(above + margin < height)) problems.push(`${up} doesn't fit under the walls' and the net's ${height} m`);
  if (!(above + margin < mouth)) problems.push(`${up} doesn't fit under the goal's ${mouth} m mouth`);
  if (!(behind < width / 2 - margin)) problems.push(`a player's camera ${behind} m behind doesn't fit in half the pitch's ${width} m width less its ${margin} m margin`);
  if (!(nearest < behind)) problems.push(`a player's camera rises nearer than ${nearest} m, not under its ${behind} m behind`);
  if (!(nearest < depth - margin)) {
    problems.push(`a player's camera rises nearer than ${nearest} m, not under the goal's ${depth} m depth less its ${margin} m margin`);
  }
  return problems;
}

// --- Every setting from the tables is in src/config.ts (§7.4) ---

/** How a table row maps to src/config.ts: the settings it names, and the
 *  numbers its value cell gives, in order (by default, the settings' own
 *  values). `holds` checks what the numbers can't. */
interface Row {
  readonly keys: readonly string[];
  readonly numbers?: (c: Config) => readonly number[];
  readonly holds?: (c: Config, value: string) => boolean;
}

const plusMinus = (spots: readonly (readonly [number, number])[]): number[] => {
  // A.5 writes a spot and its mirror across the long axis as (x, ±y).
  const out: number[] = [];
  for (let k = 0; k < spots.length; k++) {
    const [x, y] = spots[k]!;
    const next = spots[k + 1];
    if (next && y !== 0 && next[0] === x && next[1] === -y) {
      out.push(x, y, -y);
      k++;
    } else out.push(x, y);
  }
  return out;
};

/** REQUIREMENTS' Configuration table, by row. A TBD row's value is A.5's. */
const CONFIGURATION: Readonly<Record<string, Row>> = {
  'Pack size': { keys: ['packSizeMin', 'packSizeMax', 'packSizeDefault'] },
  'Match length': { keys: ['matchLengthDefaultMinutes', 'matchLengthMinMinutes', 'matchLengthMaxMinutes'] },
  'Ready expiry': { keys: ['readyExpirySeconds'] },
  'Start countdown': { keys: ['startCountdownSeconds'] },
  'Kickoff countdown': { keys: ['kickoffCountdownSeconds'] },
  'Goal celebration': { keys: ['celebrationSeenSeconds'] },
  'Kickoff spots': { keys: ['kickoffSpotsMetres'] },
  Pitch: {
    keys: ['pitch.lengthMetres', 'pitch.widthMetres', 'pitch.heightMetres', 'pitch.cornerCutsMetres'],
    numbers: ({ pitch: p }) => {
      const cuts = p.cornerCutsMetres;
      return [p.lengthMetres, p.widthMetres, p.heightMetres, ...(cuts.every((x) => x === cuts[0]) ? [cuts[0]] : cuts)];
    },
  },
  'Goal mouth': { keys: ['pitch.mouthWidthMetres', 'pitch.mouthHeightMetres', 'pitch.goalDepthMetres'] },
  Ball: { keys: ['ballRadiusMetres', 'ballMassKg', 'terrierMassKg'], numbers: (c) => [2 * c.ballRadiusMetres, c.ballMassKg / c.terrierMassKg] },
  'Ball bounce': { keys: ['ballRestitution'] },
  'Ball rolling slowdown': { keys: ['rollingSlowdownMetresPerSecond2'] },
  Terrier: { keys: ['terrierShoulderHeightMetres', 'terrierLengthMetres'] },
  'Terrier–ball bounce': { keys: ['terrierBallRestitution'] },
  'Terrier bounce': { keys: ['terrierRestitution'] },
  'Re-arm gap': { keys: ['rearmGapMetres'] },
  'Run speed': { keys: ['runSpeedMetresPerSecond'] },
  Acceleration: { keys: ['accelerationMetresPerSecond2'] },
  'Turn rate': { keys: ['turnRateTurnsPerSecond'] },
  Steering: { keys: ['steering'], numbers: () => [], holds: (c, value) => value.toLowerCase() === c.steering },
  'Chase view swing': {
    keys: ['chaseSwingTimeConstantSeconds', 'chaseSwingMaxTurnsPerSecond', 'chaseCalmerTimeConstantSeconds', 'chaseCalmerMaxTurnsPerSecond'],
  },
  'Zoomies speed': { keys: ['zoomiesSpeedMetresPerSecond'] },
  'Zoomies meter': { keys: ['zoomiesFullSeconds', 'zoomiesRefillSeconds'] },
  Jump: { keys: ['jumpHeightMetres'] },
  Gravity: { keys: ['gravityMetresPerSecond2'] },
  Pounce: { keys: ['pounceSpeedMetresPerSecond', 'lungeSeconds', 'pounceWaitSeconds'] },
  'Bowling speed': { keys: ['bowlingSpeedMetresPerSecond'] },
  Tumble: { keys: ['tumbleSeconds'] },
  'Tumble guard': { keys: ['tumbleGuardSeconds'] },
  Bark: { keys: ['barkMaxPerSecond'] },
  Spectators: { keys: ['spectatorsMax'] },
};

/** PLAN A.4, by row. */
const A4: Readonly<Record<string, Row>> = {
  // "(M0 kept 4, D-3)" names the substeps again.
  'Tick rate, substeps': { keys: ['ticksPerSecond', 'substepsPerTick'], numbers: (c) => [c.ticksPerSecond, c.substepsPerTick, c.substepsPerTick] },
  'Input delay d, late window w, vote window v': { keys: ['inputDelayTicks', 'lateWindowTicks', 'voteWindowTicks'] },
  'State history, input history per TICK': { keys: ['stateHistoryTicks', 'inputHistoryTicks'] },
  // The cap for each tick a timer run's clock moved, the cap when it moved
  // none or a STATE is adopted, then a 270-step repair's runs (M3, by measurement).
  'Worst-tick spread': {
    keys: ['spreadMaxStepsPerTick'],
    numbers: (c) => [c.spreadMaxStepsPerTick, c.spreadMaxStepsPerTick, 270, Math.ceil(270 / c.spreadMaxStepsPerTick)],
  },
  'Solver iterations (forward and back sweeps over mirror pairs), position passes (also in mirror pairs)': {
    keys: ['solverIterations', 'positionPasses', 'floorContactsInSolve'],
    numbers: (c) => [c.solverIterations, c.positionPasses],
    holds: (c, value) => c.floorContactsInSolve === value.includes("the floor's contacts in both"),
  },
  'Restitution threshold': { keys: ['restitutionThresholdMetresPerSecond'] },
  // M2 adds the slip release's reach (bots-F4).
  'Slip-out': { keys: ['slipOutConeDegrees', 'slipOutSpeedMetresPerSecond', 'slipHoldOffMetres'] },
  'Ball overhead': { keys: ['ballOverheadEnterMetres', 'ballOverheadLeaveMetres'] },
  Stick: { keys: ['stickSteps', 'stickHysteresisSteps', 'stickDeadZoneFraction', 'chaseRereadDegrees'] },
  // "bodies in contact share one decay"
  Smoothing: { keys: ['smoothingMs', 'ownSmoothingMs'], numbers: (c) => [c.smoothingMs, c.ownSmoothingMs, 1] },
  'Removal before the start countdown': { keys: ['removalSilentTicks'] },
  'Sitting, from the start countdown': { keys: ['sittingSilentTicks'] },
  'Abandoned match': { keys: ['abandonedSeconds'] },
  'A duplicate ID replaces a connection': { keys: ['duplicateIdSilentSeconds'] },
  'Handshake timeout, connection-failure message': { keys: ['handshakeTimeoutSeconds', 'connectionFailureSeconds'] },
  'Largest message, maxReceiveBytes': {
    keys: ['messageMaxBytes', 'maxReceiveBytes'],
    numbers: (c) => [c.messageMaxBytes, c.maxReceiveBytes / 1048576], // 1 MiB
  },
  'Mesh cap': { keys: ['meshPlayersMax', 'spectatorsMax'] },
  'Display name': { keys: ['displayNameMaxChars', 'displayNameMaxBytes'] },
  // M3 extends it with the catch-up's newest ticks.
  'Timer stall': { keys: ['timerStallSeconds', 'stallSendTicks'] },
  Phone: { keys: ['phoneShortSideCssPx'] },
  "Touch controls' edge margin": { keys: ['touchEdgeMarginCssPx'] },
  "Results' press guard": { keys: ['resultsPressGuardSeconds'] },
  'Lost graphics': { keys: ['lostGraphicsSeconds'] },
  'Render quality': {
    keys: ['renderQuality.high.pixelRatioMax', 'renderQuality.high.msaa', 'renderQuality.low.pixelRatioMax', 'renderQuality.low.msaa'],
    numbers: ({ renderQuality: q }) => [q.high.pixelRatioMax, q.low.pixelRatioMax],
    holds: ({ renderQuality: q }, value) => q.high.msaa === /high:[^;]*with MSAA/.test(value) && q.low.msaa === !/low:[^;]*no MSAA/.test(value),
  },
  'Sound under rollback': { keys: ['soundShiftTicksMax'] },
  // M2's rows (design §10).
  'Warm-up arrivals': { keys: ['warmUpArrivalStepMetres'] },
  'Gait and running': { keys: ['gaitCycleMetres', 'runningMinSpeedMetresPerSecond'] },
  'Bot brain': {
    keys: [
      'botReactionSeconds', 'botAimNoiseDegrees', 'botZoomiesBeyondMetres', 'botPounceWithinMetres', 'botPounceAlignDegrees',
      'botSupportMetres', 'botDefendMetres', 'botBarkEverySeconds', 'botStuckSeconds', 'botStuckMetres',
    ],
  },
  // M3's rows (M3's design §10); the duplicate ID's is reworded, with the same number.
  'Join warm-up and the tick clock': {
    keys: ['joinWarmupSeconds', 'clockSettleSeconds', 'clockSmoothing', 'clockGainPerTick', 'clockRateMax', 'clockDeadbandTicks', 'clockRebalanceSeconds'],
  },
  'Resync and joining': { keys: ['resyncRetrySeconds', 'stateRequestRetrySeconds', 'eventRetryTicks'] },
  Gossip: { keys: ['peersEverySeconds', 'pingEverySeconds'] },
  'Misbehaving peers': { keys: ['floodTicksPerTick', 'floodSeconds', 'invalidMessagesMax'] },
  'Timeline timer': { keys: ['timelineTimerMs'] },
  Leaving: { keys: ['leaveGraceSeconds'] },
  'Bot hosting': { keys: ['botReadyRenewSeconds'] },
  // M4's rows (M4's design §10).
  'Pushing pose': { keys: ['pushPoseTicks'] },
  'Animation blends': { keys: ['animationBlendMs'] },
  Gamepad: { keys: ['gamepadPollHz', 'gamepadTriggerFraction'] },
  'A held head': { keys: ['heldHeadCarryTicks'] },
  // One share for the ticks skipped and for the second in late gaps.
  'Drawing gives way': {
    keys: ['drawingLateShare', 'drawingLateTimerMs', 'drawingScaleStep', 'drawingScaleMin', 'drawingRecoverSeconds'],
    numbers: (c) => [c.drawingLateShare, c.drawingLateShare, c.drawingLateTimerMs, c.drawingScaleStep, c.drawingScaleMin, c.drawingRecoverSeconds],
  },
  // The model's texture is square, "512 × 512", and the download is in kB.
  'Drawing budget': {
    keys: [
      'budgetCodeTrianglesPerTerrier', 'budgetModelTrianglesPerTerrier', 'budgetModelBonesPerTerrier', 'budgetModelTexturePx', 'budgetDrawCalls',
      'budgetDownloadBytesPerWay',
    ],
    numbers: (c) => [
      c.budgetCodeTrianglesPerTerrier, c.budgetModelTrianglesPerTerrier, c.budgetModelBonesPerTerrier, c.budgetModelTexturePx, c.budgetModelTexturePx,
      c.budgetDrawCalls, c.budgetDownloadBytesPerWay / 1000,
    ],
  },
  'Terrier model': { keys: ['terrierModelUrl'], numbers: () => [], holds: (c, value) => c.terrierModelUrl === '' && value.startsWith('none') },
};

/** PLAN A.5, by row; its first row is "as REQUIREMENTS' Configuration table". */
const A5: Readonly<Record<string, Row>> = {
  'Kickoff spots, pack A (pack B is the point mirror)': {
    keys: ['kickoffSpotsMetres'],
    numbers: (c) => c.kickoffSpotsMetres.flatMap((spots, n) => (n === 0 ? [] : [n, ...plusMinus(spots)])),
  },
  // "to exactly 0", and "a 3 m/s ball rolls 9 m"
  'Ball rolling slowdown': {
    keys: ['rollingSlowdownMetresPerSecond2'],
    numbers: ({ rollingSlowdownMetresPerSecond2: a }) => [a, 0, 3, (3 * 3) / (2 * a)],
  },
  'Terrier bounce': { keys: ['terrierRestitution'] },
  'Terrier against the floor': { keys: ['terrierFloorRestitution'] },
  'Goal netting bounce': { keys: ['goalNetRestitution', 'ballRestitution'] },
  'Re-arm gap': { keys: ['rearmGapMetres'] },
  'Chase view swing': {
    keys: ['chaseSwingTimeConstantSeconds', 'chaseSwingMaxTurnsPerSecond', 'chaseCalmerTimeConstantSeconds', 'chaseCalmerMaxTurnsPerSecond'],
  },
  'Ball view swing': { keys: ['ballViewSwingMaxTurnsPerSecond', 'ballViewCalmerMaxTurnsPerSecond'] },
  'Tumble guard': { keys: ['tumbleGuardSeconds'] },
  'Terrier collider': { keys: ['terrierRadiusMetres', 'terrierMassKg', 'ballMassKg'] },
  'Idle friction': { keys: ['idleFrictionMetresPerSecond2'] },
  'Get-up': { keys: ['getUpSeconds', 'tumbleSeconds'] },
  'Nose turn rate (vehicle-style)': { keys: ['noseTurnRateTurnsPerSecond', 'noseReverseMetresPerSecond'] },
  'Posts and crossbar': { keys: ['pitch.postRadiusMetres'] },
  // M2's row (design §4.4, §10): the settled cap, then "a cap of 0 turns it off".
  'Ball-frame push assist (C-18)': { keys: ['pushAssistCapMetresPerSecond'], numbers: (c) => [c.pushAssistCapMetresPerSecond, 0] },
  // M4's rows (M4's design §10, M4-Q34).
  "Players' cameras": {
    keys: ['cameraBehindMetres', 'cameraAboveMetres', 'cameraFovDegrees', 'cameraWallMarginMetres', 'cameraNearestMetres', 'chaseLookAheadMetres'],
  },
  "Spectators' camera": { keys: ['spectatorViewLengthMetres', 'spectatorFollowSeconds'] },
};

/** Settings in none of the tables, with their sources. */
const ELSEWHERE: Readonly<Record<string, string>> = {
  coatCount: 'PLAN §6, D-12: the number of coats',
  zoomiesMeterUnitsPerTick: "A.1: the meter's half-ticks",
  speedBoundMetresPerSecond: 'D-3: the fastest body',
  renderQualityDefault: 'D-33: high by default',
};

/** The [setting, value] rows of the first table after a heading, with
 *  Markdown's bold and code marks removed. */
function tableRows(doc: string, heading: string): [string, string][] {
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start < 0) throw new Error(`no heading "${heading}"`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/\*\*|`/g, '')));
    else if (rows.length > 0 || line.startsWith('#')) break;
  }
  return rows.slice(2).map(([setting = '', value = '']): [string, string] => [setting, value]);
}

const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, twice: 2, half: 0.5 };

/** The numbers a value cell gives, in order, without the plan's
 *  references (Q-7, D-28, L312, M2, §13): −, ±, %, thousands' commas, and
 *  "one", "twice" and "half". */
function numbersIn(value: string): number[] {
  const text = value.replace(/§\d+(?:\.\d+)*/g, ' ').replace(/\b(?:[QDCP]-\d+|[LM]\d+)\b/g, ' ');
  const out: number[] = [];
  for (const m of text.matchAll(/(±)?([−-])?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(%)?|\b(one|twice|half)\b/g)) {
    if (m[5]) {
      out.push(NUMBER_WORDS[m[5]]!);
      continue;
    }
    let n = Number(m[3]!.replaceAll(',', ''));
    if (m[4]) n /= 100;
    if (m[2]) n = -n;
    if (m[1]) out.push(n, -n);
    else out.push(n);
  }
  return out;
}

/** Every setting's path in a configuration: its keys, and a group's keys
 *  under the group's name. */
function settingPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) => settingPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

const valueAt = (c: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), c);

/** Each row of REQUIREMENTS' Configuration table and of A.4 and A.5 names
 *  settings that src/config.ts has, with the values the row gives. A TBD in
 *  the table takes A.5's starting value; a value the table gives wins over
 *  A.5's, as Q-10 records tuned values there. And every setting in
 *  src/config.ts is in a table, or in ELSEWHERE with its source. */
function documented(c: Config, requirements: string, plan: string): string[] {
  const problems: string[] = [];
  const paths = new Set(settingPaths(c));
  const claimed = new Set(Object.keys(ELSEWHERE));
  const table = tableRows(requirements, '## Configuration');
  const a5 = tableRows(plan, '### A.5');
  // A.5's rows by the setting they name: "Kickoff spots, pack A (…)".
  const base = (name: string): string => name.split(/,| \(/)[0]!;
  const given = new Set(table.filter(([, value]) => !value.includes('TBD')).map(([name]) => name));
  const check = (where: string, rows: [string, string][], map: Readonly<Record<string, Row>>): void => {
    const names = new Set(rows.map(([name]) => name));
    for (const name of Object.keys(map)) if (!names.has(name)) problems.push(`${where} has no row "${name}"`);
    for (const [name, value] of rows) {
      if (where === 'A.5' && value.startsWith("as REQUIREMENTS'")) continue;
      const row = map[name];
      if (!row) {
        problems.push(`${where} "${name}" maps to no setting in src/config.ts`);
        continue;
      }
      for (const key of row.keys) {
        claimed.add(key);
        if (!paths.has(key)) problems.push(`${where} "${name}": src/config.ts has no ${key}`);
      }
      if (where === 'A.5' && given.has(base(name))) continue;
      if (value.includes('TBD')) {
        if (!a5.some(([n]) => base(n) === name)) problems.push(`${where} "${name}" is TBD, and A.5 has no starting value for it`);
        continue;
      }
      const want = numbersIn(value);
      let got: readonly unknown[];
      try {
        got = row.numbers ? row.numbers(c) : row.keys.map((key) => valueAt(c, key));
      } catch (e) {
        got = [message(e)];
      }
      if (want.length !== got.length || want.some((n, i) => n !== got[i])) {
        problems.push(`${where} "${name}" gives ${JSON.stringify(want)}, and src/config.ts ${JSON.stringify(got)}`);
      }
      if (row.holds && !row.holds(c, value)) problems.push(`${where} "${name}": src/config.ts doesn't match "${value}"`);
    }
  };
  check('the Configuration table', table, CONFIGURATION);
  check('A.4', tableRows(plan, '### A.4'), A4);
  check('A.5', a5, A5);
  for (const path of paths) if (!claimed.has(path)) problems.push(`${path} is in src/config.ts but in no table`);
  return problems;
}

// --- And nowhere else (§7.4) ---

interface Source {
  readonly path: string;
  readonly text: string;
}

const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** The shipped and dev scripts under a folder of the repo: no tests, no
 *  declarations, and not src/config.ts. */
function sourcesUnder(dir: string): Source[] {
  if (!existsSync(`${root}${dir}`)) return [];
  return readdirSync(`${root}${dir}`, { recursive: true, encoding: 'utf8' })
    .map((p) => `${dir}/${p.replaceAll('\\', '/')}`)
    .filter((p) => SCRIPT.test(p) && !/\.test\.[^/]*$/.test(p) && !p.endsWith('.d.ts') && p !== 'src/config.ts')
    .sort()
    .map((path) => ({ path, text: read(path) }));
}

/** A name's words, lower case: runSpeedMetresPerSecond, RUN_SPEED_MPS. */
const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const UNIT_WORDS = new Set([
  'metres', 'meters', 'metre', 'meter', 'm', 'mps', 'per', 'second', 'seconds', 'sec', 'secs', 's', 'ms', 'minute', 'minutes',
  'tick', 'ticks', 'turn', 'turns', 'degree', 'degrees', 'deg', 'kg', 'byte', 'bytes', 'chars', 'characters', 'css', 'px',
  'unit', 'units', 'fraction', 'squared', '2', 'hz',
]);

/** A name without its unit, as an order-free key: runSpeedMetresPerSecond
 *  and RUN_SPEED are both "run speed"; ticksPerSecond is "ticks". */
function stem(list: readonly string[]): string {
  const w = [...list];
  while (w.length > 1 && UNIT_WORDS.has(w[w.length - 1]!)) w.pop();
  return w.sort().join(' ');
}

/** A literal number, a string, arithmetic on literal numbers, or an array
 *  of them, an empty one included, as the kickoff spots' first row is;
 *  undefined for anything else. */
function literal(node: ts.Expression): number | string | readonly unknown[] | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll('_', ''));
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression);
  if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)) {
    const v = literal(node.operand);
    return typeof v === 'number' ? (node.operator === ts.SyntaxKind.MinusToken ? -v : v) : undefined;
  }
  if (ts.isBinaryExpression(node)) {
    const a = literal(node.left);
    const b = literal(node.right);
    if (typeof a !== 'number' || typeof b !== 'number') return undefined;
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: return a + b;
      case ts.SyntaxKind.MinusToken: return a - b;
      case ts.SyntaxKind.AsteriskToken: return a * b;
      case ts.SyntaxKind.SlashToken: return a / b;
      default: return undefined;
    }
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map((e) => literal(e));
    return items.every((v) => v !== undefined) ? items : undefined;
  }
  return undefined;
}

const scriptKind = (path: string): ts.ScriptKind =>
  path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;

/** The name and value of a declaration, property, parameter default or
 *  enum member. */
function declared(node: ts.Node): { name: string; init: ts.Expression | undefined } | undefined {
  if (
    ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) ||
    ts.isParameter(node) || ts.isBindingElement(node) || ts.isEnumMember(node)
  ) {
    const n = node.name;
    if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n)) return { name: n.text, init: node.initializer };
  }
  return undefined;
}

const sameKind = (setting: unknown, v: unknown): boolean =>
  typeof setting === 'string' ? typeof v === 'string' : typeof v === 'number' || Array.isArray(v);

const leaves = (v: unknown): unknown[] => (Array.isArray(v) ? v.flatMap(leaves) : [v]);
/** An array with no number in it, such as an empty list a loop fills. */
const numberless = (v: unknown): boolean => Array.isArray(v) && !leaves(v).some((n) => typeof n === 'number');
/** Every array in a value, nested ones included, by its path. */
const arraysIn = (v: unknown, path: string): [string, readonly unknown[]][] =>
  Array.isArray(v) ? [[path, v], ...v.flatMap((x, i) => arraysIn(x, `${path}[${i}]`))] : [];
/** Up to three settings, then how many more. */
const listed = (paths: readonly string[]): string =>
  paths.length <= 3 ? paths.join(', ') : `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more`;

/** The declarations and properties that hold a module's top-level
 *  constants: each variable at module scope, each property of a class
 *  declared there, and each property of an object literal one of them
 *  holds, however deep. */
function topLevelHolders(sf: ts.SourceFile): Set<ts.Node> {
  const held = new Set<ts.Node>();
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ? unwrap(e.expression) : e;
  const hold = (holder: ts.Node, init: ts.Expression | undefined): void => {
    if (!init) return;
    held.add(holder);
    const e = unwrap(init);
    if (ts.isObjectLiteralExpression(e)) for (const p of e.properties) if (ts.isPropertyAssignment(p)) hold(p, p.initializer);
  };
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) hold(d, d.initializer);
    else if (ts.isClassDeclaration(s)) for (const m of s.members) if (ts.isPropertyDeclaration(m)) hold(m, m.initializer);
  }
  return held;
}

/** M3's settings under the names its ports would give them, where their
 *  stems aren't a setting's own (M3's design §0): netSettings' fields,
 *  derived ones included, and roslambo's constants; and M4's under the M0
 *  spike's. netSettings' tickMs is left out: its stem, "tick", is every
 *  script's tick: in src/core/sim. */
const PORTED_NAMES: Readonly<Record<string, readonly string[]>> = {
  delay: ['inputDelayTicks'],
  window: ['lateWindowTicks'],
  history: ['stateHistoryTicks', 'inputHistoryTicks'],
  spreadCap: ['spreadMaxStepsPerTick'],
  inputSpan: ['stateHistoryTicks', 'lateWindowTicks', 'inputDelayTicks'],
  warmupMs: ['joinWarmupSeconds'],
  settleMs: ['clockSettleSeconds'],
  smoothing: ['clockSmoothing'],
  gainPerTick: ['clockGainPerTick'],
  rateMax: ['clockRateMax'],
  deadbandTicks: ['clockDeadbandTicks'],
  rebalanceMs: ['clockRebalanceSeconds'],
  sampleMaxTicks: ['stateHistoryTicks', 'lateWindowTicks', 'inputDelayTicks'],
  duplicateSilentMs: ['duplicateIdSilentSeconds'],
  floodTicksMax: ['floodTicksPerTick', 'floodSeconds'],
  timerMs: ['timelineTimerMs'],
  stallMs: ['timerStallSeconds'],
  SEND_BEHIND: ['stallSendTicks'],
  JOIN_RETRY_MS: ['stateRequestRetrySeconds'],
  INVALID_LIMIT: ['invalidMessagesMax'],
  EWMA: ['clockSmoothing'],
  FLOOD_WINDOW_MS: ['floodSeconds'],
  ADVANCE_EVERY_MS: ['timelineTimerMs'],
  STALLED_MS: ['timerStallSeconds'],
  STATE_RING: ['stateHistoryTicks'],
  INPUT_RING: ['stateHistoryTicks', 'lateWindowTicks', 'inputDelayTicks'],
  MAX_STRING: ['displayNameMaxBytes'],
  FAIL_AFTER_MS: ['connectionFailureSeconds'],
  // M4's: the M0 spike's terrier pose (M4's design §1.5).
  PUSH_TICKS: ['pushPoseTicks'],
};

/** The source files' copies of a setting. Everywhere: a declaration,
 *  property or default whose name is a setting's, unit aside, or one of
 *  PORTED_NAMES, holding a literal. In the simulation and the bot brain
 *  (src/core/sim, src/core/bot), where M2 ports the M0 spike's own
 *  configuration, and in M3's timeline, session and protocol
 *  (src/core/timeline, src/core/session, src/core/protocol), where M3
 *  ports roslambo's inline clock gains:
 *  - any literal or literal arithmetic equal to a setting's or a derived
 *    value that isn't a whole number or 0.5.
 *  And in the simulation and the bot brain alone:
 *  - a top-level constant, or a property of an object literal one holds,
 *    whose literal is a number equal to a setting's or a derived value but
 *    0, whole numbers included, or an array equal to one of theirs or to a
 *    row or entry of a table: TICK_RATE = 60, { iterations: 8 },
 *    cuts: [4, 4, 4, 4].
 *  A line saying "not a setting" is skipped. */
function copies(files: readonly Source[], c: Config): string[] {
  const names = new Map<string, string[]>();
  const values = new Map<number, string[]>();
  const numbers = new Map<number, string[]>();
  const arrays = new Map<string, string[]>();
  const add = <K>(map: Map<K, string[]>, key: K, path: string): void => {
    const paths = map.get(key) ?? [];
    if (!paths.includes(path)) map.set(key, [...paths, path]);
  };
  const distinctive = (n: unknown): n is number => typeof n === 'number' && !Number.isInteger(n) && n !== 0.5;
  const addValues = (v: unknown, path: string): void => {
    for (const n of leaves(v)) if (distinctive(n)) add(values, n, path);
    // A table's numbers are coordinates, not settings: it's matched whole, by row and by entry.
    if (typeof v === 'number' && v !== 0) add(numbers, Math.abs(v), path);
    for (const [p, a] of arraysIn(v, path)) if (leaves(a).some((n) => typeof n === 'number' && n !== 0)) add(arrays, JSON.stringify(a), p);
  };
  for (const path of settingPaths(c)) {
    const v = valueAt(c, path);
    if (typeof v === 'boolean') continue;
    add(names, stem(path.split('.').flatMap(words)), path);
    addValues(v, path);
  }
  for (const [name, paths] of Object.entries(PORTED_NAMES)) for (const path of paths) add(names, stem(words(name)), path);
  const d = derive(c);
  for (const path of settingPaths(d)) addValues(valueAt(d, path), `derived.${path}`);

  const problems: string[] = [];
  for (const file of files) {
    const sf = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKind(file.path));
    const lines = file.text.split('\n');
    const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const exempt = (node: ts.Node): boolean => lines[lineOf(node)]?.includes('not a setting') ?? false;
    const at = (node: ts.Node): string => `${file.path}:${lineOf(node) + 1}: ${node.getText(sf).split('\n')[0]}`;
    const scanValues = /^src\/core\/(?:sim|bot|timeline|session|protocol)\//.test(file.path);
    const held = /^src\/core\/(?:sim|bot)\//.test(file.path) ? topLevelHolders(sf) : new Set<ts.Node>();
    const isLiteralSum = (node: ts.Node): boolean => ts.isBinaryExpression(node) && typeof literal(node) === 'number';

    /** A declaration's copy: by its name, else, at top level, by its value. */
    const declaration = (node: ts.Node, v: ReturnType<typeof literal>, chain: readonly string[]): string | undefined => {
      if (v !== undefined && v !== 0 && !numberless(v)) {
        // The name alone, then with each enclosing name: pitch = { lengthMetres: 40 }.
        for (let i = chain.length - 1; i >= 0; i--) {
          const hits = (names.get(stem(chain.slice(i).flatMap(words))) ?? []).filter((p) => sameKind(valueAt(c, p), v));
          if (hits.length > 0) return `${at(node)} copies ${listed(hits)}`;
        }
      }
      if (!held.has(node)) return undefined;
      // A whole number or an array; the scan below reports the other numbers.
      const hits = typeof v === 'number' ? (distinctive(v) ? undefined : numbers.get(Math.abs(v))) : Array.isArray(v) ? arrays.get(JSON.stringify(v)) : undefined;
      return hits && `${at(node)} is the value of ${listed(hits)}`;
    };

    const visit = (node: ts.Node, chain: readonly string[]): void => {
      let next = chain;
      const decl = declared(node);
      if (decl) {
        next = [...chain, decl.name];
        const problem = exempt(node) ? undefined : declaration(node, decl.init && literal(decl.init), next);
        if (problem) problems.push(problem);
      }
      if (scanValues && !exempt(node)) {
        // Each literal, and the whole of any arithmetic on literals: 1 / 240.
        let v: number | undefined;
        if (ts.isNumericLiteral(node)) v = Number(node.text.replaceAll('_', ''));
        else if (isLiteralSum(node) && !isLiteralSum(node.parent)) v = literal(node as ts.Expression) as number;
        const hits = v === undefined ? undefined : values.get(Math.abs(v));
        if (hits) problems.push(`${at(node)} is the value of ${listed(hits)}`);
      }
      ts.forEachChild(node, (child) => visit(child, next));
    };
    visit(sf, []);
  }
  return problems;
}

// --- The tests ---

describe('the configuration checks (PLAN §7.4)', () => {
  it('no tunnelling (D-3)', () => {
    expect(tunnelling(config)).toEqual([]);
    // 25 m/s for 1/60 s is 0.42 m, past the terrier's 0.25 m.
    expect(tunnelling(planted({ substepsPerTick: 1 })).join('\n')).toMatch(/smallest radius, 0.25 m[\s\S]*smallest radius sum/);
    expect(tunnelling(planted({ terrierRadiusMetres: 0.1 }))).toHaveLength(2);
    expect(tunnelling(planted({ pounceSpeedMetresPerSecond: 30 })).join('\n')).toMatch(/a pounce from the air reaches/);
    // The push assist's cap, which 0 turns off (M2).
    expect(tunnelling(planted({ pushAssistCapMetresPerSecond: 30 }))).toEqual(["the push assist's cap reaches 30 m/s, not under the 25 m/s bound"]);
    expect(tunnelling(planted({ pushAssistCapMetresPerSecond: 12 }))).toEqual([]);
  });

  it('fits the late window and the vote window in the state history (A.4)', () => {
    expect(history(config)).toEqual([]);
    expect(history(planted({ voteWindowTicks: 250 })).join('\n')).toMatch(/span 264 ticks/);
    expect(history(planted({ stateHistoryTicks: 26 }))).toHaveLength(1);
    expect(history(planted({ inputHistoryTicks: 13 })).join('\n')).toMatch(/input history/);
  });

  it('puts the kickoff spots inside the pitch, apart, and mirrored, for every pack size (D-8, A.5)', () => {
    expect(kickoff(config)).toEqual([]);
    expect(kickoff(withSpots(1, [[-19.9, 0]])).join('\n')).toMatch(/isn't inside the pitch/);
    expect(kickoff(withSpots(1, [[-18.5, 12.5]])).join('\n')).toMatch(/isn't inside the pitch/); // in the cut corner
    expect(kickoff(withSpots(1, [[-1, 0]])).join('\n')).toMatch(/touches the ball/);
    expect(kickoff(withSpots(2, [[-9, 0.2], [-9, -0.2]])).join('\n')).toMatch(/touch$/m);
    expect(kickoff(withSpots(2, [[-9, 4], [-9, -3]])).join('\n')).toMatch(/no mirror across the long axis/);
    expect(kickoff(withSpots(3, [[-9, 5], [-9, -5]])).join('\n')).toMatch(/2 and 2 spots, not 3/);
    // Pack B's spots come from pack A's by negation; a table that breaks it is caught.
    const [a, b] = packSpots(config);
    const bent = b.map((spots, n) => (n === 2 ? [spots[0]!, [9, 5] as const] : spots));
    expect(kickoff(config, [a, bent]).join('\n')).toMatch(/pack B's spot 1 isn't/);
  });

  it("has every pitch piece's point mirror in the list (D-4)", () => {
    expect(pitchMirrors(config.pitch)).toEqual([]);
    expect(pitchMirrors(SECOND_SHAPE)).toEqual([]);
    expect(pitchMirrors({ ...config.pitch, cornerCutsMetres: [4, 3, 4, 4] })).toEqual([
      'the corner cuts 4, 3, 4, 4 are not point-symmetric (D-4)',
    ]);
    const moved = pitch.pieces.map((p, k) => (k === 5 ? { ...p, ox: p.ox + 1e-6 } : p));
    expect(pointMirrors(moved)).toHaveLength(2); // the moved piece, and the piece it mirrored
    // The closest-point tests' reciprocals too (M2).
    for (const over of [{ inv1: pitch.pieces[5]!.inv1 * 2 }, { inv2: 7 }]) {
      expect(pointMirrors(pitch.pieces.map((p, k) => (k === 5 ? { ...p, ...over } : p)))).toHaveLength(2);
    }
    const misnamed = pitch.pieces.map((p, k) => (k === 2 ? { ...p, mirror: 4 } : p));
    expect(pointMirrors(misnamed).join('\n')).toMatch(/mirror index, 4, names another piece/);
  });

  it("gives the zoomies meter's tuned times whole units a tick (A.1)", () => {
    expect(zoomiesMeter(config)).toEqual([]);
    expect([derived.zoomiesMeterFull, derived.zoomiesMeterDrainPerTick, derived.zoomiesMeterRefillPerTick]).toEqual([360, 2, 1]);
    expect(zoomiesMeter(planted({ zoomiesRefillSeconds: 5 })).join('\n')).toMatch(/refill 1.2 a tick/);
    expect(zoomiesMeter(planted({ zoomiesFullSeconds: 2.5 }))).not.toEqual([]);
    expect(zoomiesMeter(planted({ zoomiesMeterUnitsPerTick: 1 }))).not.toEqual([]);
    expect(zoomiesMeter(planted({ zoomiesFullSeconds: 3.01 })).join('\n')).toMatch(/not a whole number/);
  });

  it('leaves the ball room under the crossbar (L306)', () => {
    expect(goalMouth(config)).toEqual([]);
    // REQUIREMENTS' Goal mouth: "the ball fits under the crossbar with 1.4 m to spare".
    for (const goal of pitch.goals) {
      const { posts, bar } = frameOf(pitch, goal.pack);
      expect(bar.oz - bar.radius - 2 * config.ballRadiusMetres).toBeCloseTo(1.4, 12);
      expect(Math.abs(posts[0].oy - posts[1].oy) - 2 * config.pitch.postRadiusMetres).toBeCloseTo(config.pitch.mouthWidthMetres, 12);
    }
    expect(goalMouth(plantedPitch({ mouthHeightMetres: 1.5 })).join('\n')).toMatch(/doesn't fit under the crossbar/);
    expect(goalMouth(planted({ ballRadiusMetres: 1.6 })).join('\n')).toMatch(/under the crossbar/);
    expect(goalMouth(plantedPitch({ mouthWidthMetres: 1.5 })).join('\n')).toMatch(/between the posts/);
    expect(goalMouth(plantedPitch({ goalDepthMetres: 1.5 })).join('\n')).toMatch(/wholly behind the line/);
    // Measured on the netting as built, not read from the shape: a builder
    // that put a net in the wrong place is caught.
    const misbuilt = (name: string, over: Partial<Piece>): Pitch => {
      expect(pitch.pieces.some((q) => q.name === name), name).toBe(true);
      return { ...pitch, pieces: pitch.pieces.map((q) => (q.name === name ? { ...q, ...over } : q)) };
    };
    expect(goalMouth(config, misbuilt('goal −x back', { ox: -21 }))).toEqual([
      "goal 0: the ball, 1.6 m across, can't get wholly behind the line in a goal 1 m deep",
    ]);
    expect(goalMouth(config, misbuilt('goal +x side +y', { oy: -2.5 }))).toEqual([
      "goal 1: the ball, 1.6 m across, doesn't fit between the side nets, 1.5 m apart",
    ]);
    expect(goalMouth(config, misbuilt('goal −x top', { oz: 1.5 }))).toEqual([
      "goal 0: the ball, 1.6 m across, doesn't fit under the top net, 1.5 m up",
    ]);
  });

  it("holds the stick to A.2's 32 steps (M2)", () => {
    expect(stickSteps(config)).toEqual([]);
    expect(stickSteps(planted({ stickSteps: 16 }))).toEqual(["the stick has 16 steps, and A.2's five step bits hold 32"]);
  });

  it('keeps a landing terrier from bouncing (L312, M2)', () => {
    expect(terrierFloor(config)).toEqual([]);
    expect(terrierFloor(planted({ terrierFloorRestitution: 0.1 })).join('\n')).toMatch(/keeps 0.1 of its speed off the floor/);
  });

  it("keeps the push assist off, or its cap at least the zoomies speed (C-18, M2)", () => {
    expect(pushAssist(config)).toEqual([]);
    for (const cap of [9, 12]) expect(pushAssist(planted({ pushAssistCapMetresPerSecond: cap })), `${cap} m/s`).toEqual([]);
    expect(pushAssist(planted({ pushAssistCapMetresPerSecond: 6 })).join('\n')).toMatch(/cap, 6 m\/s, is neither 0/);
    expect(pushAssist(planted({ pushAssistCapMetresPerSecond: -1 }))).toHaveLength(1);
    expect(pushAssist(planted({ pushAssistCapMetresPerSecond: 10, zoomiesSpeedMetresPerSecond: 11 }))).toHaveLength(1);
  });

  it("spaces a bot's barks at least two bark gaps apart (L327, M2)", () => {
    expect(botBarks(config)).toEqual([]);
    expect(botBarks(planted({ botBarkEverySeconds: 2 }))).toEqual([]);
    expect(botBarks(planted({ botBarkEverySeconds: 1.5 })).join('\n')).toMatch(/every 1.5 s, under two bark gaps of 1 s/);
    expect(botBarks(planted({ barkMaxPerSecond: 0.25 })).join('\n')).toMatch(/two bark gaps of 4 s/);
  });

  it("holds a TICK's input history to the 16 ticks its u16 masks hold (M3)", () => {
    expect(tickHistory(config)).toEqual([]);
    expect(tickHistory(planted({ inputHistoryTicks: 32 }))).toEqual(["a TICK's input history is 32 ticks, and its u16 masks hold 16"]);
    // 14 still covers d + w, which the windows' check asks, and is still caught here.
    expect(history(planted({ inputHistoryTicks: 14 }))).toEqual([]);
    expect(tickHistory(planted({ inputHistoryTicks: 14 }))).toHaveLength(1);
  });

  it("sends every message in one of Trystero 0.26.0's frames (D-18, M3)", () => {
    expect(trysteroFrame(config)).toEqual([]);
    // 16,348 bytes and the 36-byte header fill a frame exactly; a byte more would be chunked.
    expect(trysteroFrame(planted({ messageMaxBytes: 16348 }))).toEqual([]);
    expect(trysteroFrame(planted({ messageMaxBytes: 16349 })).join('\n')).toMatch(/make 16385 bytes, past its 16384-byte frame/);
    expect(trysteroFrame(planted({ maxReceiveBytes: 16383 }))).toEqual(["maxReceiveBytes, 16383, is under Trystero's 16384-byte frame"]);
    expect(trysteroFrame(planted({ maxReceiveBytes: 16384 }))).toEqual([]);
    // The two numbers are the installed Trystero's, and a message within the
    // frame goes inline, with no metadata, as the transport sends it.
    const core = 'node_modules/@trystero-p2p/core';
    expect((JSON.parse(read(`${core}/package.json`)) as { version: string }).version).toBe('0.26.0');
    expect(read(`${core}/dist/data-limits.mjs`)).toContain(`const maxActionFrameBytes = ${TRYSTERO_FRAME_BYTES};`);
    const wire = read(`${core}/dist/action-wire.mjs`);
    expect(wire).toContain(`const inlineHeaderSize = ${TRYSTERO_INLINE_HEADER_BYTES};`);
    expect(wire).toContain('const small = inlineHeaderSize + meta.length + size <= maxActionFrameBytes;');
  });

  it("keeps the spread's cap at least a normal tick's worst, w + 1 steps (D-11, M3)", () => {
    expect(spreadCap(config)).toEqual([]);
    expect(spreadCap(planted({ spreadMaxStepsPerTick: 13 }))).toEqual([]);
    expect(spreadCap(planted({ spreadMaxStepsPerTick: 12 }))).toEqual(["the spread's cap, 12 steps a tick, is under a normal tick's worst, w + 1 = 13 steps"]);
    expect(spreadCap(planted({ lateWindowTicks: 42 })).join('\n')).toMatch(/w \+ 1 = 43 steps/);
  });

  it("sends a bot's READY again before its Ready expires, in time to land (C-41, M3)", () => {
    expect(botsReady(config)).toEqual([]);
    expect(botsReady(planted({ botReadyRenewSeconds: 60 }))).toEqual(["a bot's READY goes again with 60 s of its Ready left, not under the 60 s expiry"]);
    expect(botsReady(planted({ readyExpirySeconds: 5 })).join('\n')).toMatch(/not under the 5 s expiry/);
    // 2d + 2w + 30 + 2 = 60 ticks to land: 1 s is 60 ticks, and 0.75 s only 45.
    expect(botsReady(planted({ botReadyRenewSeconds: 1 }))).toEqual([]);
    expect(botsReady(planted({ botReadyRenewSeconds: 0.75 }))).toEqual([
      "a bot's READY goes again with 0.75 s of its Ready left, under the 60 ticks, 2d + 2w + eventRetryTicks + 2, one lost once takes to land",
    ]);
    // At the bound, 60 ticks with a retry of 30, it lands on the expiry's tick, in time; with 31, a tick
    // late, as src/core/session/bots.test.ts measures with BotHost.
    expect(botsReady(planted({ botReadyRenewSeconds: 1, eventRetryTicks: 30 }))).toEqual([]);
    expect(botsReady(planted({ botReadyRenewSeconds: 1, eventRetryTicks: 31 }))).toHaveLength(1);
    expect(botsReady(planted({ eventRetryTicks: 600 })).join('\n')).toMatch(/under the 630 ticks/);
  });

  it('keeps a leaving page in its room until its LEAVE is final (M3)', () => {
    expect(leaving(config)).toEqual([]);
    // d + w = 14 ticks: 0.25 s covers them, and 0.2 s, 12 ticks, doesn't.
    expect(leaving(planted({ leaveGraceSeconds: 0.25 }))).toEqual([]);
    expect(leaving(planted({ leaveGraceSeconds: 0.2 }))).toEqual(['a leaving page keeps its room for 0.2 s, 12 ticks, under the 14 ticks, d + w, its LEAVE takes to be final']);
    expect(leaving(planted({ lateWindowTicks: 30 })).join('\n')).toMatch(/24 ticks, under the 32 ticks/);
    // Exactly d + w covers them: 15 ticks against w = 13, and not against 14.
    expect(leaving(planted({ leaveGraceSeconds: 0.25, lateWindowTicks: 13 }))).toEqual([]);
    expect(leaving(planted({ leaveGraceSeconds: 0.25, lateWindowTicks: 14 }))).toHaveLength(1);
  });

  it("sends from 1 to w of a catch-up's newest ticks after a stall (M3)", () => {
    expect(afterStall(config)).toEqual([]);
    for (const n of [1, 12]) expect(afterStall(planted({ stallSendTicks: n })), `${n}`).toEqual([]);
    for (const n of [0, 2.5, -1, NaN, Infinity]) expect(afterStall(planted({ stallSendTicks: n })), `${n}`).toHaveLength(1);
    expect(afterStall(planted({ stallSendTicks: 13 }))).toEqual(["after a stall a page sends its newest 13 ticks' inputs, not a whole number from 1 to the late window's 12"]);
  });

  it("pings at most half C-12's silence apart, so a live connection is never silent (M3)", () => {
    expect(liveness(config)).toEqual([]);
    expect(liveness(planted({ pingEverySeconds: 1.5 }))).toEqual(['pings every 1.5 s, over half the 2 s silence that lets a duplicate ID replace a connection (C-12)']);
    expect(liveness(planted({ duplicateIdSilentSeconds: 1.5 }))).toHaveLength(1);
    expect(liveness(planted({ pingEverySeconds: 0.5 }))).toEqual([]);
  });

  it("fits the counts on the wire in the protocol's u8s (M3)", () => {
    expect(wireCounts(config)).toEqual([]);
    expect(wireCounts(planted({ displayNameMaxBytes: 256 }))).toEqual(["a name of 256 bytes doesn't fit a wire string's u8 length"]);
    expect(wireCounts(planted({ displayNameMaxBytes: 255 }))).toEqual([]);
    // PEERS lists every browser of the mesh but its sender: 250 + 6 − 1 fits, and one more spectator doesn't.
    expect(wireCounts(planted({ meshPlayersMax: 250, spectatorsMax: 6 }))).toEqual([]);
    expect(wireCounts(planted({ meshPlayersMax: 250, spectatorsMax: 7 })).join('\n')).toMatch(/PEERS lists up to 256 IDs/);
    expect(wireCounts(config, 256)).toEqual(['a TICK carries up to 256 bots, BOT_SLOTS, past its u8 count']);
    expect(wireCounts(config, 255)).toEqual([]);
  });

  it("fits a player's camera inside the pitch, a goal included, with room to rise (M4)", () => {
    expect(cameras(config)).toEqual([]);
    // 2.1 m up and 0.4 m in fit under the goal's 3 m mouth: 2.5 m up still does, and 2.7 m doesn't.
    expect(cameras(planted({ cameraAboveMetres: 2.5 }))).toEqual([]);
    expect(cameras(planted({ cameraAboveMetres: 2.7 }))).toEqual(["a player's camera 2.7 m up, with its 0.4 m margin, doesn't fit under the goal's 3 m mouth"]);
    expect(cameras(plantedPitch({ heightMetres: 2.5 }))).toEqual([
      "a player's camera 2.1 m up, with its 0.4 m margin, doesn't fit under the walls' and the net's 2.5 m",
    ]);
    // Half the 28 m width less the margin is 13.6 m.
    expect(cameras(planted({ cameraBehindMetres: 13.5 }))).toEqual([]);
    expect(cameras(planted({ cameraBehindMetres: 14 }))).toEqual([
      "a player's camera 14 m behind doesn't fit in half the pitch's 28 m width less its 0.4 m margin",
    ]);
    // The goal's 2 m depth less the margin is 1.6 m.
    expect(cameras(planted({ cameraNearestMetres: 1.55 }))).toEqual([]);
    expect(cameras(planted({ cameraNearestMetres: 1.7 }))).toEqual([
      "a player's camera rises nearer than 1.7 m, not under the goal's 2 m depth less its 0.4 m margin",
    ]);
    expect(cameras(plantedPitch({ goalDepthMetres: 1.8 })).join('\n')).toMatch(/nearer than 1.5 m, not under the goal's 1.8 m depth/);
    expect(cameras(planted({ cameraNearestMetres: 5 })).join('\n')).toMatch(/nearer than 5 m, not under its 4.2 m behind\n.*goal's 2 m depth/);
    // A wider margin takes room from the height and the depth at once.
    expect(cameras(planted({ cameraWallMarginMetres: 1 }))).toHaveLength(2);
  });

  it('has every setting of the Configuration table, A.4 and A.5, with their values', () => {
    const requirements = read('REQUIREMENTS.md');
    const plan = read('PLAN.md');
    expect(documented(config, requirements, plan)).toEqual([]);

    expect(documented(planted({ runSpeedMetresPerSecond: 7 }), requirements, plan)).toEqual([
      'the Configuration table "Run speed" gives [6], and src/config.ts [7]',
    ]);
    const noLunge: Record<string, unknown> = { ...config };
    delete noLunge.lungeSeconds;
    expect(documented(noLunge as unknown as Config, requirements, plan).join('\n')).toMatch(/"Pounce": src\/config.ts has no lungeSeconds/);
    expect(documented({ ...config, ballSpinTurnsPerSecond: 0 } as Config, requirements, plan)).toEqual([
      'ballSpinTurnsPerSecond is in src/config.ts but in no table',
    ]);
    expect(documented(planted({ steering: 'vehicle' }), requirements, plan).join('\n')).toMatch(/"Steering": src\/config.ts doesn't match/);
    expect(documented(planted({ kickoffSpotsMetres: [[], [[-11, 0]], ...config.kickoffSpotsMetres.slice(2)] }), requirements, plan)).toHaveLength(1);

    // And the documents: a row with no setting, a row gone, a TBD with no
    // starting value, a changed value.
    const spin = requirements.replace('| Spectators |', '| Ball spin | None | |\n| Spectators |');
    expect(documented(config, spin, plan)).toEqual(['the Configuration table "Ball spin" maps to no setting in src/config.ts']);
    expect(documented(config, requirements.replace(/^\| Jump \|.*\n/m, ''), plan).join('\n')).toMatch(/has no row "Jump"/);
    const noGuard = plan.replace(/^\| Tumble guard \|/m, '| Tumble cover |');
    expect(noGuard).not.toBe(plan);
    expect(documented(config, requirements, noGuard).join('\n')).toMatch(/"Tumble guard" is TBD, and A.5 has no starting value/);
    const friction = plan.replace(/^\| Idle friction \| 8 /m, '| Idle friction | 7 ');
    expect(friction).not.toBe(plan);
    expect(documented(config, requirements, friction)).toEqual(['A.5 "Idle friction" gives [7], and src/config.ts [8]']);
    // A value tuned at M2 and recorded in the table wins over A.5's start (Q-10).
    const tuned = requirements.replace(/^\| Re-arm gap \| \*\*TBD\*\* \|/m, '| Re-arm gap | 0.5 m |');
    expect(tuned).not.toBe(requirements);
    expect(documented(planted({ rearmGapMetres: 0.5 }), tuned, plan)).toEqual([]);
    expect(documented(planted({ rearmGapMetres: 0.5 }), requirements, plan)).toEqual(['A.5 "Re-arm gap" gives [0.6], and src/config.ts [0.5]']);
  });

  it('has the settings nowhere else: no copy in src or dev', () => {
    const files = [...sourcesUnder('src'), ...sourcesUnder('dev')];
    expect(files.map((f) => f.path)).toContain('src/core/sim/pitch.ts');
    expect(copies(files, config)).toEqual([]);

    expect(
      copies(
        [
          {
            path: 'src/render/a.ts',
            text: 'export const RUN_SPEED = 6;\nexport const pitch = { lengthMetres: 40 };\nexport const KICKOFF_SPOTS = [[], [[-10, 0]]];\n',
          },
          { path: 'src/ui/b.ts', text: "export function f(maxPackSize = 4, steering = 'anchored') { return [maxPackSize, steering]; }\n" },
          { path: 'src/core/sim/c.ts', text: 'export const fall = 9.8 * 2;\nexport const dt = 1 / 240;\n' },
        ],
        config,
      ),
    ).toEqual([
      'src/render/a.ts:1: RUN_SPEED = 6 copies runSpeedMetresPerSecond',
      'src/render/a.ts:2: lengthMetres: 40 copies pitch.lengthMetres',
      // An empty row is a literal too, so the table's copy is one.
      'src/render/a.ts:3: KICKOFF_SPOTS = [[], [[-10, 0]]] copies kickoffSpotsMetres',
      'src/ui/b.ts:1: maxPackSize = 4 copies packSizeMax',
      "src/ui/b.ts:1: steering = 'anchored' copies steering",
      'src/core/sim/c.ts:1: 9.8 is the value of gravityMetresPerSecond2',
      'src/core/sim/c.ts:2: 1 / 240 is the value of derived.substepSeconds',
    ]);
    // In the simulation, a top-level constant under any name, whole numbers
    // included, as the M0 spike's configuration names them.
    const spike = [
      'export const TICK_RATE = 60;',
      'export const CONFIG = { iterations: 8, celebrationTicks: 204, tumble: { guardTicks: 90 }, cuts: [4, 4, 4, 4] };',
      'export class Solver { passes = 2; }',
      'export const SPOTS = [',
      '  [],',
      '  [[-10, 0]],',
      '  [[-9, 4], [-9, -4]],',
      '  [[-9, 5], [-9, -5], [-15, 0]],',
      '  [[-8, 6], [-8, -6], [-14, 3], [-14, -3]],',
      '];',
    ].join('\n');
    expect(copies([{ path: 'src/core/sim/e.ts', text: spike }], config)).toEqual([
      // M4's gamepadPollHz is 60 too, before derived.barkGapTicks: 1 more.
      'src/core/sim/e.ts:1: TICK_RATE = 60 is the value of readyExpirySeconds, ticksPerSecond, gamepadPollHz and 1 more',
      // And its pushPoseTicks 8: 3 more, where M3 had 2.
      'src/core/sim/e.ts:2: iterations: 8 is the value of pitch.mouthWidthMetres, idleFrictionMetresPerSecond2, solverIterations and 3 more',
      'src/core/sim/e.ts:2: celebrationTicks: 204 is the value of derived.celebrationTicks',
      'src/core/sim/e.ts:2: guardTicks: 90 copies tumbleGuardSeconds',
      'src/core/sim/e.ts:2: cuts: [4, 4, 4, 4] is the value of pitch.cornerCutsMetres',
      // M3's clockSettleSeconds and floodSeconds are 2 s too, and M4's chaseLookAheadMetres 2 m:
      // 14 more, where M2 had 11 and M3 13.
      'src/core/sim/e.ts:3: passes = 2; is the value of packSizeDefault, pitch.goalDepthMetres, ballMassKg and 14 more',
      'src/core/sim/e.ts:4: SPOTS = [ is the value of kickoffSpotsMetres, derived.kickoffSpots[0]',
    ]);
    // Counters, halves, locals, reads of the configuration and marked lines pass.
    const fine = [
      'import { config } from "../../config";',
      'let ticks = 0;',
      'ticks += 1;',
      'export const kickoffSpots: number[][] = [];',
      'export const half = 0.5 * ticks;',
      'export const g = config.gravityMetresPerSecond2;',
      'export const shade = 0.25; // not a setting: a colour',
      'export const QUAD = 1; // not a setting',
      'export function f(): number { const steps = 12; return steps * ticks; }',
    ].join('\n');
    expect(copies([{ path: 'src/core/sim/d.ts', text: fine }], config)).toEqual([]);
    // A timeout of its own, as the repo's long tests have: the scan of src and dev took 0.9 s alone but 5.9
    // to 6.7 s in a loaded unit stage, past vitest's 5 s (M4's phase 2c).
  }, 60_000);

  it("finds M3's settings copied by name outside the simulation, as the timeline and the session would port them (M3)", () => {
    // Outside src/core/sim and src/core/bot only names are scanned, under
    // their own name or a group's: roslambo's RESYNC_RETRY_MS, or a clock's
    // rebalanceMs (M3's design §0).
    const port = [
      'const RESYNC_RETRY_MS = 500;',
      'const PING_EVERY_MS = 2000;',
      'const LEAVE_GRACE_MS = 400;',
      'export const cfg = { stallSendTicks: 3, clock: { rebalanceMs: 1000 }, room: { floodTicksPerTick: 3 } };',
      // Reads of the settings pass.
      'export const read = { stallSendTicks: net.timeline.stallSendTicks, rebalanceMs: 1000 * config.clockRebalanceSeconds };',
    ].join('\n');
    expect(copies([{ path: 'src/core/timeline/f.ts', text: port }], config)).toEqual([
      'src/core/timeline/f.ts:1: RESYNC_RETRY_MS = 500 copies resyncRetrySeconds',
      'src/core/timeline/f.ts:2: PING_EVERY_MS = 2000 copies pingEverySeconds',
      'src/core/timeline/f.ts:3: LEAVE_GRACE_MS = 400 copies leaveGraceSeconds',
      'src/core/timeline/f.ts:4: stallSendTicks: 3 copies stallSendTicks',
      'src/core/timeline/f.ts:4: rebalanceMs: 1000 copies clockRebalanceSeconds',
      'src/core/timeline/f.ts:4: floodTicksPerTick: 3 copies floodTicksPerTick, floodSeconds',
    ]);
  });

  it("finds M3's settings under netSettings' and roslambo's names, and roslambo's inline clock gains (M3)", () => {
    const port = [
      'export const cfg = { delay: 2, window: 12, history: 256, spreadCap: 42, inputSpan: 1024, warmupMs: 500, duplicateSilentMs: 2000 };',
      'export const clock = { settleMs: 2000, smoothing: 0.1, gainPerTick: 0.005, rateMax: 0.02, deadbandTicks: 1, sampleMaxTicks: 742 };',
      'export const net = { timerMs: 4, stallMs: 2000, floodTicksMax: 360 };',
      'const SEND_BEHIND = 3;',
      'const JOIN_RETRY_MS = 1000;',
      'const INVALID_LIMIT = 20;',
      'const EWMA = 0.1;',
      'const FLOOD_WINDOW_MS = 2000;',
      'const ADVANCE_EVERY_MS = 4;',
      'const STALLED_MS = 2000;',
      'const STATE_RING = 256;',
      'const INPUT_RING = 1024;',
      'const HISTORY = 16;',
      'const MAX_STRING = 32;',
      'const FAIL_AFTER_MS = 20_000;',
      'export const adj = (med: number): number => Math.max(-0.02, Math.min(0.02, med * 0.005));',
      // A marked line, and a read of the settings, pass.
      'export const shade = 0.02; // not a setting: a colour',
      'export const read = { window: net.timeline.window, delay: cfg2.delay };',
    ].join('\n');
    const at = (line: number, what: string): string => `src/core/timeline/g.ts:${line}: ${what}`;
    expect(copies([{ path: 'src/core/timeline/g.ts', text: port }], config)).toEqual([
      at(1, 'delay: 2 copies inputDelayTicks'),
      at(1, 'window: 12 copies lateWindowTicks'),
      at(1, 'history: 256 copies stateHistoryTicks, inputHistoryTicks'),
      at(1, 'spreadCap: 42 copies spreadMaxStepsPerTick'),
      at(1, 'inputSpan: 1024 copies stateHistoryTicks, lateWindowTicks, inputDelayTicks'),
      at(1, 'warmupMs: 500 copies joinWarmupSeconds'),
      at(1, 'duplicateSilentMs: 2000 copies duplicateIdSilentSeconds'),
      at(2, 'settleMs: 2000 copies clockSettleSeconds'),
      at(2, 'smoothing: 0.1 copies smoothingMs, clockSmoothing'),
      at(2, '0.1 is the value of pitch.postRadiusMetres, clockSmoothing, drawingLateShare'),
      at(2, 'gainPerTick: 0.005 copies clockGainPerTick'),
      at(2, '0.005 is the value of clockGainPerTick'),
      at(2, 'rateMax: 0.02 copies clockRateMax'),
      at(2, '0.02 is the value of clockRateMax'),
      at(2, 'deadbandTicks: 1 copies clockDeadbandTicks'),
      at(2, 'sampleMaxTicks: 742 copies stateHistoryTicks, lateWindowTicks, inputDelayTicks'),
      at(3, 'timerMs: 4 copies timelineTimerMs'),
      at(3, 'stallMs: 2000 copies timerStallSeconds'),
      at(3, 'floodTicksMax: 360 copies floodTicksPerTick, floodSeconds'),
      at(4, 'SEND_BEHIND = 3 copies stallSendTicks'),
      at(5, 'JOIN_RETRY_MS = 1000 copies stateRequestRetrySeconds'),
      at(6, 'INVALID_LIMIT = 20 copies invalidMessagesMax'),
      at(7, 'EWMA = 0.1 copies clockSmoothing'),
      at(7, '0.1 is the value of pitch.postRadiusMetres, clockSmoothing, drawingLateShare'),
      at(8, 'FLOOD_WINDOW_MS = 2000 copies floodSeconds'),
      at(9, 'ADVANCE_EVERY_MS = 4 copies timelineTimerMs'),
      at(10, 'STALLED_MS = 2000 copies timerStallSeconds'),
      at(11, 'STATE_RING = 256 copies stateHistoryTicks'),
      at(12, 'INPUT_RING = 1024 copies stateHistoryTicks, lateWindowTicks, inputDelayTicks'),
      at(13, 'HISTORY = 16 copies stateHistoryTicks, inputHistoryTicks'),
      at(14, 'MAX_STRING = 32 copies displayNameMaxBytes'),
      at(15, 'FAIL_AFTER_MS = 20_000 copies connectionFailureSeconds'),
      // roslambo's rebalance: the limit either way, and the gain.
      at(16, '0.02 is the value of clockRateMax'),
      at(16, '0.02 is the value of clockRateMax'),
      at(16, '0.005 is the value of clockGainPerTick'),
    ]);
    // Values are scanned in M3's core folders, not in the transports' or the glue's.
    expect(copies([{ path: 'src/net/g.ts', text: 'export const adj = (med: number): number => med * 0.005;' }], config)).toEqual([]);
    expect(copies(['session', 'protocol'].map((dir) => ({ path: `src/core/${dir}/g.ts`, text: 'export const adj = (med: number): number => med * 0.005;' })), config))
      .toEqual(['src/core/session/g.ts:1: 0.005 is the value of clockGainPerTick', 'src/core/protocol/g.ts:1: 0.005 is the value of clockGainPerTick']);
  });

  it("finds M4's settings copied by name, unit aside, and under the M0 spike's names (M4)", () => {
    // Drawing's ports are scanned by name alone: the spike's pose and camera, and the gamepad's poll.
    const port = [
      'const PUSH_TICKS = 8;',
      'export const pose = { pushPoseTicks: 8, animationBlendMs: 150 };',
      'const GAMEPAD_POLL_MS = 16;',
      'export const camera = { behindMetres: 4.2 };',
      "export const look = { terrierModelUrl: './standin.glb' };",
      // A drawing constant named apart from the settings passes, as M1's overview keeps its field.
      'const FOV_DEGREES = 40;',
    ].join('\n');
    const at = (line: number, what: string): string => `src/render/drawers/h.ts:${line}: ${what}`;
    expect(copies([{ path: 'src/render/drawers/h.ts', text: port }], config)).toEqual([
      at(1, 'PUSH_TICKS = 8 copies pushPoseTicks'),
      at(2, 'pushPoseTicks: 8 copies pushPoseTicks'),
      at(2, 'animationBlendMs: 150 copies animationBlendMs'),
      at(3, 'GAMEPAD_POLL_MS = 16 copies gamepadPollHz'),
      at(4, 'behindMetres: 4.2 copies cameraBehindMetres'),
      at(5, "terrierModelUrl: './standin.glb' copies terrierModelUrl"),
    ]);
  });
});

describe('src/config.ts', () => {
  it("keeps to the simulation's exact operations, which read it from M2 (D-1, D-38)", async () => {
    // Linted as if it were in src/core/sim, where exact-ops applies.
    const eslint = new ESLint({ cwd: root });
    const lint = async (text: string): Promise<string[]> =>
      (await eslint.lintText(text, { filePath: `${root}src/core/sim/config-as-sim.ts` })).flatMap((r) =>
        r.messages.map((m) => `${m.ruleId ?? ''}: ${m.message}`),
      );
    const text = read('src/config.ts');
    expect(await lint(text)).toEqual([]);
    expect((await lint(`${text}\nexport const planted = Math.sin(config.lungeSeconds);\n`)).join('\n')).toMatch(/^hermet\/exact-ops:/);
  }, 60_000);

  it('derives whole ticks and the jump speed (D-6, Q-7)', () => {
    expect(derived.substepSeconds).toBe(1 / 240);
    expect(derived.celebrationTicks).toBe(204); // 3 s seen, plus w + v ticks to confirm the goal
    expect([derived.lungeTicks, derived.pounceWaitTicks, derived.tumbleTicks, derived.getUpTicks, derived.tumbleGuardTicks]).toEqual([18, 90, 90, 30, 90]);
    expect([derived.readyExpiryTicks, derived.startCountdownTicks, derived.kickoffCountdownTicks, derived.botReactionTicks]).toEqual([3600, 300, 180, 15]);
    expect(derived.jumpSpeedMetresPerSecond).toBeCloseTo(4.43, 2);
    expect(() => derive(planted({ lungeSeconds: 0.31 }))).toThrow(/the lunge: 0.31 s is/);
    // M2's: a minute, the bots' bark period and unstick, and the bark gap.
    expect([derived.ticksPerMinute, derived.botBarkEveryTicks, derived.botStuckTicks, derived.barkGapTicks]).toEqual([3600, 300, 120, 60]);
    expect(derive(planted({ barkMaxPerSecond: 2 })).barkGapTicks).toBe(30);
    expect(() => derive(planted({ barkMaxPerSecond: 7 }))).toThrow(/the bark gap: .* not a whole number/);
    expect(() => derive(planted({ botStuckSeconds: 0.33 }))).toThrow(/the bots' unstick: 0.33 s is/);
    expect(() => derive(planted({ botBarkEverySeconds: 4.99 }))).toThrow(/the bots' bark period: 4.99 s is/);
    // No time is a whole number of ticks that isn't a number: a bark rate of 0 gives an endless gap.
    expect(() => derive(planted({ barkMaxPerSecond: 0 }))).toThrow(/the bark gap: Infinity s is Infinity ticks, not a whole number/);
    expect(() => derive(planted({ botStuckSeconds: NaN }))).toThrow(/the bots' unstick: NaN s is/);
    expect(() => derive(planted({ lungeSeconds: Infinity }))).toThrow(/the lunge: Infinity s is/);
    expect(() => derive(planted({ tumbleSeconds: -Infinity }))).toThrow(/the tumble: -Infinity s is/);
  });

  it('is frozen, and builds the pitch the page draws (D-4)', () => {
    expect(Object.isFrozen(config) && Object.isFrozen(config.pitch) && Object.isFrozen(config.kickoffSpotsMetres[2]![0])).toBe(true);
    expect(Object.isFrozen(pitch.pieces[3]) && Object.isFrozen(pitch.goals[1].floor)).toBe(true);
    const kinds = [PLANE, QUAD, CAPSULE].map((kind) => pitch.pieces.filter((p) => p.kind === kind).length);
    expect(kinds).toEqual([2, 20, 6]);
    expect(pitch.goalLineX).toBe(20);
    expect(pitch.outline).toHaveLength(8);
    for (const pack of [0, 1] as const) {
      const goal = pitch.goals[pack];
      expect(goal.pack).toBe(pack);
      expect(goal.lineX).toBe(pack === 0 ? -20 : 20);
      expect(goal.pieces.map((k) => pitch.pieces[k]!.surface).sort()).toEqual([FRAME, FRAME, FRAME, GOAL_NET, GOAL_NET, GOAL_NET, GOAL_NET]);
      expect(pitch.halves[pack].pack).toBe(pack);
    }
    // The halves meet on the halfway line, and their areas add up to the floor's.
    const area = (pts: readonly (readonly [number, number])[]): number =>
      pts.reduce((s, [x, y], i) => s + (x * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * y) / 2, 0);
    expect(area(pitch.halves[0].outline) + area(pitch.halves[1].outline)).toBeCloseTo(area(pitch.outline), 9);
    expect(area(pitch.outline)).toBeCloseTo(40 * 28 - 4 * (4 * 4) / 2, 9);
    // D-4's second shape is point-symmetric but not mirror-symmetric.
    const inside = (x: number, y: number): boolean => insideFloorPlan(SECOND_SHAPE, x, y);
    expect([inside(-21.5, -14.4), inside(-21.5, 14.4), inside(21.5, 14.4), inside(21.5, -14.4)]).toEqual([false, true, false, true]);
  });
});
