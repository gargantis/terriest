// A player's camera outside the walls (PLAN D-28, L89, C-57), in each
// engine, through the real page and its keyboard, at the gate's 640 × 360
// and stored low quality (C-6, D-33). Practice opened from Home by its own
// controls, 1 a side, and in its warm-up, where the ball stays on the
// centre spot (L147), your terrier driven in ball view: from its kickoff
// spot by S, straight back from the ball into its own goal, to the back
// netting; then out again by W, a quarter of the way round the ball by D,
// and back by S into the −y side wall, pressing on into it; then C, chase
// view, and S, which turns your terrier round, away from the wall, let go
// once it has turned, so the chase camera swings out behind it. The bot
// wanders the pitch meanwhile, and a bump can send the terrier into another
// wall, so each ball-view leg ends wherever it is backed into: at the first
// look that finds it against a wall, a cut corner or its goal's netting.
// Then the camera the stage drew (render.camera) keeps its place behind
// the terrier, outside the pitch's region, beyond the walls or behind the
// goal, at cameraAboveMetres over the terrier's floor point, as it is at
// every look: never risen or held inside the walls, as it was before C-57;
// the glass draws the near panes' kick band from outside (render.glass);
// and the overlay shows your mark, and in ball view no arrow, so your
// terrier and the ball are both in view, the ball below the HUD's top bar.
//
// And what's drawn, read off captures taken with your terrier and the
// camera at rest, each region placed by the camera's own numbers, as ball
// view aims at the ball's centre, which the overlay reports drawn at the
// canvas's centre: at the warm-up's start, the outfield's grass through
// the far end wall, not the glass's tint; behind the goal, the ball's
// colour where its centre is drawn, no netting across the pitch through
// the open back, and the near end wall's kick band, drawn once from
// outside, beyond the post; and outside the side wall, the ball's colour,
// and your white coat untinted where the line to your terrier crosses that
// wall's kick band, which clears round the line (fade.ts's line fade).
// Each threshold sits between what the build draws and what a broken one
// drew, both measured in each engine (C-57's review). Every wait is a
// condition on the hook, read every 50 ms with a timeout, never on
// animation frames, and nothing here depends on the frame rate (C-6).

import type { Page } from '@playwright/test';
import { config } from '../src/config';
import { personId } from '../src/core/bot/bot-id';
import { insideRegion } from '../src/core/sim/pitch';
import type { Inspection } from '../src/main';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, inspect, installHook, monotonicMs, openPractice, overlayOf, POLL_MS, seedStorage, smallViewport, steadyCapture } from './lib/page';
import { colourAt, coloursIn, type Image, median, type Rgb } from './lib/png';

test.use({ viewport: smallViewport });

const PITCH = config.pitch;
/** Pack A's goal line along −x. */
const LINE = PITCH.lengthMetres / 2;
/** Pack A's goal's back netting, along −x. */
const BACK = LINE + PITCH.goalDepthMetres;
const R = config.terrierRadiusMetres;
const BEHIND = config.cameraBehindMetres;
const ABOVE = config.cameraAboveMetres;
/** Your terrier's kickoff spot at 1 a side, pack A's, facing the ball. */
const SPOT = config.kickoffSpotsMetres[1]![0]!;
/** A terrier this close to a wall's, a cut corner's or a goal's netting's inner face is against it: a test's
 *  threshold. */
const AGAINST_M = 0.05;
/** A height clear of the floor, the net and a goal's roof by more than a terrier's radius and AGAINST_M, at which
 *  the region's walls, corners and goals alone bound a point: a test's. */
const MID_HEIGHT_M = 1;
/** A terrier on the floor, and the camera at its height over it: within a millimetre, a test's threshold. */
const LEVEL_M = 0.001;
/** How far the camera drawn may be from its place behind the head's terrier: a frame's age at the gate's slowest,
 *  0.2 s at run speed, 1.2 m, and the drawn head's lag, under a tick; a test's threshold. A camera that watches as
 *  a spectator would is 14 m off or more. */
const DRAWN_M = 2;
/** How far round the ball D takes the terrier: past this x on its −y side, a quarter of the way round. */
const QUARTER_X = -1.5;
/** How far out of the goal W brings it: to this x, about 12 m from the ball. */
const OUT_X = -12;
/** Chase view's S has turned your terrier away from the wall once its heading is this far round from where it
 *  faced, about 145° of the half turn S asks for, a fifth of a second at its turn rate: the cosine of the turn, a
 *  test's threshold. Let go then, it stopped facing out from the wall, its centre 1.5 m to 2 m off it, in each
 *  engine, and the camera behind it 2.2 m to 2.6 m outside. */
const TURNED_COS = -0.8;
/** Tries of chase view's turn: a let-go that comes late on a loaded machine leaves your terrier too far from the
 *  wall for its camera to be outside, and it's backed into the wall and turned again. */
const TURNS = 3;

/** The warm-up's first look with your terrier drawn in ball view: Pre-match, the person in the roster, at
 *  most 332 ms in e2e/lib/practice.ts' measured runs; 3 × 0.33 + 2 s, as its margins go, made 5 s. */
const IN_WARM_UP_MS = 5_000;
/** A leg's run: the longest, D's quarter circle of about 12 m radius, about 19 m, 3.2 s at run speed, by the
 *  page's clock, which load slows only between timer runs; 3 × 3.2 + 2 s, as e2e/lib/practice.ts' margins go
 *  for a wait the machine's load lengthens, made 12 s. */
const LEG_MS = 12_000;
/** Two frames drawn after a look: the gate draws 5 to 26 a second (C-6), so at worst 0.4 s; 3 × 0.4 + 2 s. */
const FRAMES_MS = 4_000;
/** Your terrier and the camera at rest once a key's let go, as atRest takes it: in ball view within 0.25 s of the
 *  terrier's stop, and in chase view 3.1 s at most in each engine, the swing's easing, its time constant 0.3 s, to
 *  within a ten-thousandth of a radian, by the page's clock; 3 × 3.1 + 2 s, as e2e/lib/practice.ts' margins go,
 *  made 12 s. */
const REST_MS = 12_000;
/** The whole test: the start and Practice's screens, 30 s each at most (e2e/lib/page.ts), five legs and five
 *  captures at rest, and room for a try of chase view's turn again. */
const TEST_MS = 180_000;

// What the captures read, each measured in each engine on this build and on builds broken on purpose (C-57's
// review): a test's thresholds, between the two.
/** The ball's body colour: red, its green and blue each under this share of its red, and its red over the floor. */
const BALL_GB_SHARE = 0.4;
const BALL_RED_MIN = 100;
/** The ball's colour where its centre is drawn: on a ring half its drawn radius out, 16 points, off its bands, its
 *  highlight and its darkest shade but for a few, at least half of which read it; 10 to 14 did, and none through
 *  an opaque near wall. */
const RING_POINTS = 16;
const RING_RADII = 0.55;
const RING_BALL_MIN = 8;
/** The outfield through the far end wall: its median greener than blue by more than this. The grass read 47 in
 *  each engine, the glass's own tint, drawn opaque, −15. */
const OUTFIELD_GREEN_MIN = 15;
/** No netting across the open back: under this share of the pitch's pixels there as light as the netting's lines,
 *  every channel over NETTING_LIGHT. None were; with the back netting drawn, 5% were. */
const NETTING_LIGHT = 150;
const NETTING_SHARE_MAX = 0.01;
/** Your terrier's line clears the netting this far round it, on the screen, at most: its 1 m at the back netting,
 *  3.8 m off the camera, 91 px, and a margin. */
const LINE_CLEAR_PX = 110;
/** The near end wall's kick band from outside, beyond the post: its median bluer than green by this much at
 *  least, pack A's band over the grass, and by less than the most, the band drawn once. It read 24 to 25 in each
 *  engine; without the outer draw, the grass alone, −34; with the near panes in the inner draw too, 51; with the
 *  outer draw's panes whole and opaque, 42. */
const BAND_BLUE_MIN = 10;
const BAND_BLUE_MAX = 38;
/** Your white coat untinted: of its brightest share below your mark's point, red over blue by a median between
 *  these, the coat's warm white. It read 22 to 26 in each engine; through the orange band, the line fade off, 74 to
 *  75, and through the blue one it would be under 0. */
const COAT_BRIGHTEST = 0.3;
const COAT_RED_OVER_BLUE: readonly [number, number] = [0, 45];

type Mine = NonNullable<NonNullable<Inspection['match']>['mine']>;
const mine = (i: Inspection): Mine => {
  const m = i.match?.mine;
  if (m === undefined || m === null) throw new Error(`no terrier of yours in the drawn head; ${where(i)}`);
  return m;
};

/** Where the page is, for a failure's message: the screen, your terrier and the camera as drawn. */
function where(i: Inspection): string {
  const m = i.match?.mine;
  const c = i.render.camera;
  const at = (x: number, y: number, z: number): string => [x, y, z].map((v) => v.toFixed(2)).join(', ');
  return `screen ${i.screen}, your terrier ${m === null || m === undefined ? 'not drawn' : `at ${at(m.x, m.y, m.z)}`}, ` +
    `the camera ${c.kind} ${c.view ?? ''} at ${at(c.x, c.y, c.z)}, frame ${i.render.frames}`;
}

/** Whether the camera drawn is a player's placed for your terrier, about its distance behind it: a player's frame
 *  drawn before the terrier's arrival watches as a spectator would, from high above the near side
 *  (src/render/camera.ts). */
function placedForMine(i: Inspection): boolean {
  const m = i.match?.mine;
  const c = i.render.camera;
  return c.kind === 'player' && m !== null && m !== undefined && Math.abs(Math.hypot(c.x - m.x, c.y - m.y) - BEHIND) < DRAWN_M;
}

/** Every look's own checks: still in the warm-up, Ready never pressed; and a player's camera placed for your
 *  terrier at its height over the terrier's floor point while the terrier is on the floor, wherever the camera is:
 *  never risen (C-57). */
function everyLook(i: Inspection): void {
  expect(i.screen, `still on Pre-match; ${where(i)}`).toBe('prematch');
  const m = i.match?.mine;
  if (placedForMine(i) && m !== null && m !== undefined && Math.abs(m.z - R) < LEVEL_M) {
    expect(Math.abs(i.render.camera.z - ABOVE), `the camera at its height over your terrier's floor point; ${where(i)}`).toBeLessThan(LEVEL_M);
  }
}

/** Looks every 50 ms, checking each look, until `cond` holds of one; fails on a timeout with where the page is. */
async function until(page: Page, cond: (i: Inspection) => boolean, what: string, timeoutMs: number): Promise<Inspection> {
  const deadline = monotonicMs() + timeoutMs;
  for (;;) {
    const i = await inspect(page);
    everyLook(i);
    if (cond(i)) return i;
    if (monotonicMs() > deadline) throw new Error(`${what}: not reached within ${timeoutMs} ms; ${where(i)}`);
    await page.waitForTimeout(POLL_MS);
  }
}

/** Whether your terrier is backed into whatever is behind it from the ball: within AGAINST_M of the inner face of
 *  a wall, a cut corner, the end wall beside a mouth or a goal's back or side netting, as the pitch's region bounds
 *  it (src/core/sim/pitch.ts). Running through a mouth's middle, it's against none of them. */
const backedIn = (i: Inspection): boolean => !insideRegion(PITCH, mine(i).x, mine(i).y, MID_HEIGHT_M, -(R + AGAINST_M));

/** What the terrier was backed into, for the log: its goal, or a wall. */
const into = (i: Inspection): string => (mine(i).x < -LINE ? 'its own goal' : 'a wall');

/** Whether the camera drawn is outside the walls and the goals. */
const outsideWalls = (i: Inspection): boolean => !insideRegion(PITCH, i.render.camera.x, i.render.camera.y, i.render.camera.z, 0);

/** Holds `key` until `cond` holds of a look, then `then` with that look, still held, and lets go. */
async function holding(page: Page, key: string, cond: (i: Inspection) => boolean, what: string, then?: (i: Inspection) => Promise<unknown>): Promise<Inspection> {
  await page.keyboard.down(key);
  try {
    const at = await until(page, cond, `${what}, ${key} held`, LEG_MS);
    await then?.(at);
    return at;
  } finally {
    await page.keyboard.up(key);
  }
}

/** The first look whose frame was drawn two frames after `at`'s, so the camera drawn follows the terrier `at`
 *  showed, then its checks (C-57): a player's camera in `view`, outside the pitch's region, beyond the walls or
 *  behind the goal's back or beside it, at its height over the floor point, the glass's outer draw drawn; and your
 *  terrier in view, your mark shown, and in ball view the ball too, its arrow not shown (D-28, L90). */
async function outsideAfter(page: Page, at: Inspection, what: string, view: 'ball' | 'chase' = 'ball'): Promise<Inspection> {
  const i = await until(page, (x) => x.render.frames >= at.render.frames + 2, `a frame drawn ${what}`, FRAMES_MS);
  const c = i.render.camera;
  expect([c.kind, c.view], `${what}: your camera, in ${view} view; ${where(i)}`).toEqual(['player', view]);
  expect(outsideWalls(i), `${what}: the camera outside the walls and the goals, behind your terrier; ${where(i)}`).toBe(true);
  expect(Math.abs(c.z - ABOVE), `${what}: the camera at ${ABOVE} m, its height over the floor point, never risen; ${where(i)}`).toBeLessThan(LEVEL_M);
  // Outside the walls, the glass draws the near panes' kick band from outside (src/render/glass.ts).
  expect(i.render.glass.outer, `${what}: the glass's outer draw, the camera outside a wall's plane; ${where(i)}`).toBe(true);
  expect(i.render.glass.outside.length, `${what}: the walls the camera is outside of, ${i.render.glass.outside.join(', ')}; ${where(i)}`).toBeGreaterThan(0);
  const o = overlayOf(i);
  if (view === 'ball') {
    expect([o?.mine?.shown, o?.arrow.shown], `${what}: your mark shown and no arrow, your terrier and the ball both in view; ${where(i)}`)
      .toEqual([true, false]);
  } else {
    expect(o?.mine?.shown, `${what}: your mark shown, your terrier in view; ${where(i)}`).toBe(true);
  }
  console.log(`camera ${what}${view === 'ball' ? `: your terrier backed into ${into(at)}` : ''}; ${where(i)}`);
  return i;
}

// --- What's drawn (C-57) ---

/** Whether two looks show your terrier and the camera at one place, within a tenth of a millimetre, and the camera
 *  turned alike, within a ten-thousandth of a radian: a capture's regions then stand within a hundredth of a pixel
 *  of where either puts them. */
function atRest(a: Inspection, b: Inspection): boolean {
  const [m, n] = [mine(a), mine(b)];
  const [c, d] = [a.render.camera, b.render.camera];
  const near = (u: number, v: number): boolean => Math.abs(u - v) < 1e-4;
  return near(m.x, n.x) && near(m.y, n.y) && near(m.z, n.z) && near(c.x, d.x) && near(c.y, d.y) && near(c.z, d.z) && near(c.yaw, d.yaw);
}

/** The first look of two, two frames apart, that show your terrier and the camera at one place, the keys let go. */
async function restLook(page: Page, what: string): Promise<Inspection> {
  const from = monotonicMs();
  let last = await inspect(page);
  const rest = await until(page, (i) => {
    if (i.render.frames < last.render.frames + 2) return false;
    const still = atRest(last, i);
    last = i;
    return still;
  }, `your terrier and the camera at rest ${what}`, REST_MS);
  console.log(`camera ${what}: at rest after ${Math.round(monotonicMs() - from)} ms`);
  return rest;
}

/** The page captured once your terrier and the camera are at rest: then a capture across which nothing of them
 *  moved (e2e/lib/page.ts), so its regions are where the inspection read just before puts them. */
async function captureAtRest(page: Page, what: string): Promise<{ readonly image: Image; readonly shown: Inspection }> {
  await restLook(page, what);
  return steadyCapture(page, atRest);
}

/** The vertical field's focal length, CSS px, of a player's camera on the canvas `i` drew. */
const focal = (i: Inspection): number => i.render.cssHeight / 2 / Math.tan((config.cameraFovDegrees * Math.PI) / 360);

/** Where a point shows on the canvas `i` drew, CSS px from its top left, for a player's camera in ball view aimed at
 *  the ball's centre, as src/render/camera.ts places it while your terrier sits well inside its view: from the
 *  camera drawn toward the drawn ball, its right level with the pitch. aimedAtBall checks the page drew it so. */
function onScreen(i: Inspection, x: number, y: number, z: number): { readonly x: number; readonly y: number } {
  const c = i.render.camera;
  const b = i.match!.ball;
  const f = [b.x - c.x, b.y - c.y, b.z - c.z];
  const fl = Math.hypot(f[0]!, f[1]!, f[2]!);
  const [fx, fy, fz] = [f[0]! / fl, f[1]! / fl, f[2]! / fl];
  const rl = Math.hypot(fy, fx);
  const [rx, ry] = [fy / rl, -fx / rl];
  const [ux, uy, uz] = [ry * fz, -rx * fz, rx * fy - ry * fx];
  const [dx, dy, dz] = [x - c.x, y - c.y, z - c.z];
  const ahead = dx * fx + dy * fy + dz * fz;
  const k = focal(i) / ahead;
  return { x: i.render.cssWidth / 2 + k * (dx * rx + dy * ry), y: i.render.cssHeight / 2 - k * (dx * ux + dy * uy + dz * uz) };
}

/** The overlay's ball drawn at the canvas's centre, within half a pixel: the camera aimed at the ball's centre, as
 *  onScreen takes it, not turned to keep your terrier in view. */
function aimedAtBall(i: Inspection, what: string): void {
  const b = overlayOf(i)?.ball ?? null;
  expect(b?.inView, `${what}: the ball in view; ${where(i)}`).toBe(true);
  expect(Math.hypot(b!.x - i.render.cssWidth / 2, b!.y - i.render.cssHeight / 2), `${what}: the ball's centre drawn at the canvas's centre, ` +
    `${b!.x.toFixed(1)}, ${b!.y.toFixed(1)}; ${where(i)}`).toBeLessThan(0.5);
}

const isBall = (c: Rgb): boolean => c[0] > BALL_RED_MIN && c[1] < BALL_GB_SHARE * c[0] && c[2] < BALL_GB_SHARE * c[0];
const rgb = (c: readonly number[]): string => c.map((v) => Math.round(v)).join(', ');

/** The ball's colour where its centre is drawn: nothing in front of it, no glass but the near band, well below the
 *  line to it, and no netting but faces cut, hides it from a camera outside (C-57). */
function expectBallDrawn(image: Image, i: Inspection, what: string): void {
  const b = overlayOf(i)!.ball!;
  const c = i.render.camera;
  const ball = i.match!.ball;
  const radius = (focal(i) * config.ballRadiusMetres) / Math.hypot(ball.x - c.x, ball.y - c.y, ball.z - c.z);
  const ring = Array.from({ length: RING_POINTS }, (_, k) => {
    const a = (2 * Math.PI * k) / RING_POINTS;
    return colourAt(image, b.x + RING_RADII * radius * Math.cos(a), b.y + RING_RADII * radius * Math.sin(a));
  });
  const read = ring.filter(isBall).length;
  console.log(`camera ${what}: the ball's colour at ${read} of ${RING_POINTS} points round its drawn centre, its drawn radius ${radius.toFixed(1)} px`);
  expect(read, `${what}: the ball's colour round its drawn centre, ${ring.map(rgb).join('; ')}; ${where(i)}`).toBeGreaterThanOrEqual(RING_BALL_MIN);
}

/** Your white coat untinted, below your mark's point: its brightest pixels' red over blue the coat's warm white, as
 *  the band of the wall the line to your terrier crosses clears round that line (fade.ts's line fade). */
function expectCoatUntinted(image: Image, i: Inspection, what: string): void {
  const m = overlayOf(i)!.mine!;
  const t = mine(i);
  const c = i.render.camera;
  const r = (focal(i) * R) / Math.hypot(t.x - c.x, t.y - c.y, t.z - c.z);
  const coat = coloursIn(image, m.x - 0.5 * r, m.y + 0.2 * r, m.x + 0.5 * r, m.y + r)
    .sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]));
  const brightest = coat.slice(0, Math.ceil(coat.length * COAT_BRIGHTEST));
  const redOverBlue = median(brightest.map((p) => p[0] - p[2]));
  const mid = [0, 1, 2].map((k) => median(brightest.map((p) => p[k]!)));
  console.log(`camera ${what}: your coat ${rgb(mid)}, red over blue ${redOverBlue}`);
  expect(redOverBlue, `${what}: your white coat untinted, ${rgb(mid)}; ${where(i)}`).toBeGreaterThanOrEqual(COAT_RED_OVER_BLUE[0]);
  expect(redOverBlue, `${what}: your white coat untinted, ${rgb(mid)}; ${where(i)}`).toBeLessThanOrEqual(COAT_RED_OVER_BLUE[1]);
}

test("the camera keeps its place behind your terrier, behind its own goal and outside a wall, in ball view and chase view, at its height, the terrier and the ball seen through the glass (C-57)", async ({ page }) => {
  test.setTimeout(TEST_MS);
  await expectWebGL2(page);
  await seedStorage(page, { profile: { playerId: personId(7, 0) }, settings: { quality: 'low' } });
  await installHook(page);
  await page.goto('./');
  await expectStarted(page);
  await openPractice(page, { packSize: 1, minutes: 1 });
  const start = await until(page, (i) => i.match?.inRoster === true && placedForMine(i) && i.render.camera.view === 'ball',
    'your terrier drawn in the warm-up, in ball view', IN_WARM_UP_MS);
  expect(Math.hypot(mine(start).x - SPOT[0], mine(start).y - SPOT[1]), `your terrier on its kickoff spot, (${SPOT.join(', ')}); ${where(start)}`)
    .toBeLessThan(0.5);
  const ball = start.match!.ball;
  expect(Math.hypot(ball.x, ball.y), 'the ball on the centre spot in the warm-up (L147)').toBeLessThan(1e-9);

  // From the kickoff spot, inside the walls, the far end wall beside pack B's goal: the outfield's grass shows
  // through it, between 45 m and 80 m off the camera, past the apron and before it fades into the sky, not the
  // glass's own tint, which an opaque wall would show.
  const first = await captureAtRest(page, 'on the kickoff spot');
  aimedAtBall(first.shown, 'on the kickoff spot');
  const far = [onScreen(first.shown, LINE, 9, 1), onScreen(first.shown, LINE, 5, 1)];
  const [from, to] = [onScreen(first.shown, LINE + 46, 0, 0), onScreen(first.shown, LINE + 11, 0, 0)];
  const outfield = coloursIn(first.image, far[0]!.x, from.y, far[1]!.x, to.y);
  const green = median(outfield.map((p) => p[1] - p[2]));
  console.log(`camera on the kickoff spot: the outfield through the far end wall greener than blue by ${green}`);
  expect(green, `the outfield's grass through the far end wall, not the glass's tint; ${where(first.shown)}`).toBeGreaterThan(OUTFIELD_GREEN_MIN);

  // S: straight back from the ball, through the mouth to the goal's back netting, and on into it. The camera, 4.2 m
  // behind, is behind the goal's back, looking through its open back (C-57), where it used to be held inside the
  // goal and risen.
  const goal = await holding(page, 'KeyS', backedIn, 'your terrier backed into its own goal', (at) => outsideAfter(page, at, 'behind your own goal'));
  const behind = await captureAtRest(page, 'behind your own goal');
  aimedAtBall(behind.shown, 'behind your own goal');
  expectBallDrawn(behind.image, behind.shown, 'behind your own goal');
  expectCoatUntinted(behind.image, behind.shown, 'behind your own goal');
  const c = behind.shown.render.camera;
  if (c.x < -BACK - 0.5 && Math.abs(c.y) < PITCH.mouthWidthMetres / 2 - 0.5) {
    // Behind the back netting, between the goal's sides: its back alone not drawn, and the end wall's pieces the
    // outer draw's.
    expect(behind.shown.render.netting, `the back netting not drawn, the rest whole; ${where(behind.shown)}`).toEqual([{ name: 'goal −x back', shown: 0 }]);
    expect([...behind.shown.render.glass.outside].sort(), `the end wall's pieces the outer draw's; ${where(behind.shown)}`)
      .toEqual(['end −x, +y of the mouth', 'end −x, above the mouth', 'end −x, −y of the mouth'].sort());
    // The pitch through the open back, from 0.5 m to 9 m in front of the goal line, between its +y side's
    // line on the screen and your terrier's line, round which the netting would clear: no netting's lines.
    const left = onScreen(behind.shown, -LINE, PITCH.mouthWidthMetres / 2 - 0.5, 0).x;
    const right = overlayOf(behind.shown)!.mine!.x - LINE_CLEAR_PX;
    const pitchRows = [onScreen(behind.shown, -LINE + 9, 0, 0).y, onScreen(behind.shown, -LINE + 0.5, 0, 0).y];
    const through = coloursIn(behind.image, left, pitchRows[0]!, right, pitchRows[1]!);
    const light = through.filter((p) => Math.min(...p) > NETTING_LIGHT).length / through.length;
    console.log(`camera behind your own goal: ${(100 * light).toFixed(2)}% of the pitch through the open back as light as netting`);
    expect(through.length, `the pitch's region through the open back; ${where(behind.shown)}`).toBeGreaterThan(1000);
    expect(light, `no netting across the open back; ${where(behind.shown)}`).toBeLessThan(NETTING_SHARE_MAX);
    // The near end wall's kick band from outside, beyond the post on the +y side of the mouth, from the screen's left
    // edge, between the band's foot and its top line: pack A's band over the grass, drawn once.
    const band = [onScreen(behind.shown, -LINE, PITCH.mouthWidthMetres / 2 + 0.35, 0.4), onScreen(behind.shown, -LINE, PITCH.mouthWidthMetres / 2 + 0.35, 0.05)];
    const kick = coloursIn(behind.image, 4, band[0]!.y, band[0]!.x, band[1]!.y);
    const blue = median(kick.map((p) => p[2] - p[1]));
    console.log(`camera behind your own goal: the near end wall's kick band bluer than green by ${blue}`);
    expect(kick.length, `the kick band's region beyond the post; ${where(behind.shown)}`).toBeGreaterThan(500);
    expect(blue, `the near end wall's kick band, drawn from outside; ${where(behind.shown)}`).toBeGreaterThanOrEqual(BAND_BLUE_MIN);
    expect(blue, `the near end wall's kick band, drawn once; ${where(behind.shown)}`).toBeLessThan(BAND_BLUE_MAX);
  } else {
    console.log(`camera behind your own goal: your terrier bumped into ${into(goal)}, the camera not behind the back netting; ${where(behind.shown)}`);
  }

  // W: out toward the ball again; D: a quarter of the way round it, counter-clockwise, to its −y side; S: straight
  // back from it into the −y side wall, and on into it. The camera, 4.2 m behind, is outside the wall, where it used
  // to be held at the wall and risen toward the net. Let go, your terrier at rest against the wall, the line from the
  // camera to it crosses the wall's kick band, which clears round the line, so your white coat shows untinted.
  await holding(page, 'KeyW', (i) => mine(i).x > OUT_X, 'your terrier out of the goal, toward the ball');
  await holding(page, 'KeyD', (i) => mine(i).y < 0 && mine(i).x > QUARTER_X, 'your terrier a quarter of the way round the ball');
  await holding(page, 'KeyS', backedIn, 'your terrier backed into the −y side wall', (at) => outsideAfter(page, at, 'outside the side wall'));
  const side = await captureAtRest(page, 'outside the side wall');
  aimedAtBall(side.shown, 'outside the side wall');
  expectBallDrawn(side.image, side.shown, 'outside the side wall');
  expectCoatUntinted(side.image, side.shown, 'outside the side wall');

  // C: chase view, its camera behind your terrier along its heading, facing the wall it backed into. S: toward the
  // camera, so your terrier turns round, away from the wall; let go once it has, and the chase camera swings round
  // behind it, out past the wall, and keeps its place there (C-57). If it stopped too far from the wall, S again,
  // toward the camera, backs it into the wall, the camera swinging back in behind it, and it turns again.
  await page.keyboard.press('KeyC');
  let chase = await until(page, (i) => i.render.camera.view === 'chase' && placedForMine(i), 'chase view, behind your terrier', FRAMES_MS);
  for (let turn = 1; ; turn++) {
    const facing = mine(chase).heading;
    await holding(page, 'KeyS', (i) => Math.cos(mine(i).heading - facing) < TURNED_COS, 'your terrier turned away from the wall in chase view');
    const rest = await restLook(page, 'turned in chase view');
    if (placedForMine(rest) && outsideWalls(rest)) {
      await outsideAfter(page, rest, 'swung out in chase view', 'chase');
      break;
    }
    expect(turn, `the chase camera outside the walls once your terrier stopped, in ${turn} tries; ${where(rest)}`).toBeLessThan(TURNS);
    console.log(`camera in chase view: your terrier stopped too far from the wall for its camera to be outside; ${where(rest)}`);
    await holding(page, 'KeyS', backedIn, 'your terrier backed into the wall again in chase view');
    chase = await until(page, (i) => placedForMine(i) && Math.cos(i.render.camera.yaw - mine(i).heading) > 0.99, 'the chase camera behind your terrier again', REST_MS);
  }
  const swung = await captureAtRest(page, 'swung out in chase view');
  expect(outsideWalls(swung.shown), `the chase camera at rest outside the walls; ${where(swung.shown)}`).toBe(true);
  expect(overlayOf(swung.shown)?.mine?.shown, `your mark shown at rest, chase view; ${where(swung.shown)}`).toBe(true);
  expectCoatUntinted(swung.image, swung.shown, 'swung out in chase view');
});
