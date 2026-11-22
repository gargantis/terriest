// A player's camera outside the walls (PLAN D-28, L89, C-57; M4's design,
// research/m4/DESIGN.md, §3.2, §3.6), in each engine, through the real page
// and its keyboard, at the gate's 640 × 360 and stored low quality (C-6,
// D-33). Practice opened from Home by its own controls, 1 a side, and in its
// warm-up, where the ball stays on the centre spot (L147), your terrier
// driven in ball view: from its kickoff spot by S, straight back from the
// ball into its own goal, to the back netting; then out again by W, a
// quarter of the way round the ball by D, and back by S into the −y side
// wall, pressing on into it. The bot wanders the pitch meanwhile, and a bump
// can send the terrier into another wall, so each leg ends wherever it is
// backed into: at the first look that finds it against a wall, a cut corner
// or its goal's netting. Then the camera the stage drew (render.camera)
// keeps its place behind the terrier, outside the pitch's region, beyond the
// walls or behind the goal, at cameraAboveMetres over the terrier's floor
// point, as it is at every look: never risen or held inside the walls, as it
// was before C-57; the glass draws the near panes' kick band from outside
// (render.glass); and the overlay shows your mark and no arrow, so your
// terrier and the ball are both in view, the ball below the HUD's top bar.
// Every wait is a condition on the hook, read every 50 ms with a timeout,
// never on animation frames, and nothing here depends on the frame rate
// (C-6).

import type { Page } from '@playwright/test';
import { config } from '../src/config';
import { personId } from '../src/core/bot/bot-id';
import { insideRegion } from '../src/core/sim/pitch';
import type { Inspection } from '../src/main';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, inspect, installHook, monotonicMs, openPractice, overlayOf, POLL_MS, seedStorage, smallViewport } from './lib/page';

test.use({ viewport: smallViewport });

const PITCH = config.pitch;
/** Pack A's goal line along −x. */
const LINE = PITCH.lengthMetres / 2;
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

/** The warm-up's first look with your terrier drawn in ball view: Pre-match, the person in the roster, at
 *  most 332 ms in e2e/lib/practice.ts' measured runs; 3 × 0.33 + 2 s, as its margins go, made 5 s. */
const IN_WARM_UP_MS = 5_000;
/** A leg's run: the longest, D's quarter circle of about 12 m radius, about 19 m, 3.2 s at run speed, by the
 *  page's clock, which load slows only between timer runs; 3 × 3.2 + 2 s, as e2e/lib/practice.ts' margins go
 *  for a wait the machine's load lengthens, made 12 s. */
const LEG_MS = 12_000;
/** Two frames drawn after a look: the gate draws 5 to 26 a second (C-6), so at worst 0.4 s; 3 × 0.4 + 2 s. */
const FRAMES_MS = 4_000;
/** The whole test: the start and Practice's screens, 30 s each at most (e2e/lib/page.ts), and four legs. */
const TEST_MS = 120_000;

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
 *  showed, then its checks (C-57): a player's camera in ball view, outside the pitch's region, beyond the walls or
 *  behind the goal's back or beside it, at its height over the floor point, the glass's outer draw drawn; and your
 *  terrier and the ball both in view, your mark shown and the ball's arrow not (D-28, L90). */
async function outsideAfter(page: Page, at: Inspection, what: string): Promise<Inspection> {
  const i = await until(page, (x) => x.render.frames >= at.render.frames + 2, `a frame drawn ${what}`, FRAMES_MS);
  const c = i.render.camera;
  expect([c.kind, c.view], `${what}: your camera, in ball view; ${where(i)}`).toEqual(['player', 'ball']);
  expect(insideRegion(PITCH, c.x, c.y, c.z, 0), `${what}: the camera outside the walls and the goals, behind your terrier; ${where(i)}`).toBe(false);
  expect(Math.abs(c.z - ABOVE), `${what}: the camera at ${ABOVE} m, its height over the floor point, never risen; ${where(i)}`).toBeLessThan(LEVEL_M);
  // Outside the walls, the glass draws the near panes' kick band from outside (src/render/glass.ts).
  expect(i.render.glass.outer, `${what}: the glass's outer draw, the camera outside a pane's plane; ${where(i)}`).toBe(true);
  const o = overlayOf(i);
  expect([o?.mine?.shown, o?.arrow.shown], `${what}: your mark shown and no arrow, your terrier and the ball both in view; ${where(i)}`)
    .toEqual([true, false]);
  console.log(`camera ${what}: your terrier backed into ${into(at)}; ${where(i)}`);
  return i;
}

test("the camera keeps its place behind your terrier, behind its own goal and outside a wall, at its height, the terrier and the ball in view (C-57)", async ({ page }) => {
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

  // S: straight back from the ball, through the mouth to the goal's back netting, and on into it. The camera, 4.2 m
  // behind, is behind the goal's back, looking through its open back (C-57), where it used to be held inside the
  // goal and risen.
  await holding(page, 'KeyS', backedIn, 'your terrier backed into its own goal', (at) => outsideAfter(page, at, 'behind your own goal'));

  // W: out toward the ball again; D: a quarter of the way round it, counter-clockwise, to its −y side; S: straight
  // back from it into the −y side wall, and on into it. The camera, 4.2 m behind, is outside the wall, where it used
  // to be held at the wall and risen toward the net.
  await holding(page, 'KeyW', (i) => mine(i).x > OUT_X, 'your terrier out of the goal, toward the ball');
  await holding(page, 'KeyD', (i) => mine(i).y < 0 && mine(i).x > QUARTER_X, 'your terrier a quarter of the way round the ball');
  await holding(page, 'KeyS', backedIn, 'your terrier backed into the −y side wall', (at) => outsideAfter(page, at, 'outside the side wall'));
});
