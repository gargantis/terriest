// Every setting in one place (PLAN §6; REQUIREMENTS "Configuration": every
// setting should be easy to change): the Configuration table, Appendix A's
// constants (A.4) and gameplay values (A.5), and the number of coats. The
// build hash covers all of it (D-21); src/config.test.ts holds the §7.4
// checks.
//
// Each name carries its unit. The values are REQUIREMENTS' and the plan's,
// exactly: the table's TBDs take A.5's values, which M2 settled
// provisionally by measurement for the owner to confirm
// (research/tuning/REPORT.md), and the cameras' are tuned at M4 (Q-10).
// Table rows are cited by name, since the plan's L-numbers count lines of
// REQUIREMENTS at 6254a1d: from L287 on, today's are one further on (the
// plan's L306, Goal mouth, is now line 307).
//
// The simulation reads this from M2, through src/core/sim/params.ts, so its
// arithmetic is exact operations only (D-1): + − × ÷, Math.sqrt and
// Math.round. The binary angles are params.ts's, from src/core/sim/math.ts.

/** Steering schemes (Configuration: Steering; D-7). */
export type Steering = 'anchored' | 'screen-relative' | 'vehicle';
/** Render quality (D-33). */
export type RenderQuality = 'high' | 'low';
/** A point on the floor, in metres from the centre spot (D-4). */
export type Spot = readonly [x: number, y: number];
/** Kickoff spots by pack size, 1 to 4; index 0 is empty. */
export type SpotTable = readonly (readonly Spot[])[];

export const config = deepFreeze({
  // The match (Configuration: Pack size to Goal celebration; D-8).
  packSizeMin: 1,
  packSizeMax: 4, // the mesh cap of 8 browsers that play; bots aren't peers (C-49)
  packSizeDefault: 2,
  matchLengthMinMinutes: 1,
  matchLengthMaxMinutes: 10,
  matchLengthDefaultMinutes: 3,
  readyExpirySeconds: 60,
  startCountdownSeconds: 5,
  kickoffCountdownSeconds: 3,
  celebrationSeenSeconds: 3, // the simulation adds the confirmation delay (Q-7): derive()

  // Kickoff spots (Configuration: TBD; A.5; D-8): pack A's, by pack size.
  // Pack B's are their point mirror (D-4): packSpots(). Spot k goes to the
  // k-th terrier of the pack by player ID, and every terrier faces the ball.
  kickoffSpotsMetres: [
    [],
    [[-10, 0]],
    [[-9, 4], [-9, -4]],
    [[-9, 5], [-9, -5], [-15, 0]],
    [[-8, 6], [-8, -6], [-14, 3], [-14, -3]],
  ] as SpotTable,
  // A warm-up arrival whose spot isn't clear steps from it toward its own
  // goal line by this much at a time (A.4: Warm-up arrivals; D-8).
  warmUpArrivalStepMetres: 1,

  // The pitch (Configuration: Pitch, Goal mouth; A.5: Posts and crossbar;
  // D-4). src/core/sim/pitch.ts builds its pieces from this.
  pitch: {
    lengthMetres: 40, // goal line to goal line, along x
    widthMetres: 28,
    heightMetres: 6, // the walls and the overhead net
    // Along each wall, at (−x,−y), (+x,−y), (+x,+y), (−x,+y). Point
    // symmetry needs opposite corners equal (D-4).
    cornerCutsMetres: [4, 4, 4, 4],
    mouthWidthMetres: 8, // clear, between the posts
    mouthHeightMetres: 3, // clear, under the crossbar
    goalDepthMetres: 2,
    postRadiusMetres: 0.1, // posts and crossbars are capsules
  },

  // Bodies (Configuration: Ball, Terrier; A.5: Terrier collider; D-4).
  ballRadiusMetres: 0.8, // 1.6 m across; no spin (L59)
  ballMassKg: 2, // twice a terrier's
  terrierRadiusMetres: 0.25, // a sphere, centred this high when standing
  terrierMassKg: 1,
  // The drawn terrier, which code-built and modeled terriers fit, so a
  // model never changes play (L310).
  terrierShoulderHeightMetres: 0.3,
  terrierLengthMetres: 0.6,

  // Bounces (Configuration: Ball bounce, Terrier–ball bounce, Terrier
  // bounce; A.5; D-5): the fraction of the closing speed a contact keeps,
  // above the restitution threshold.
  ballRestitution: 0.7, // off the floor, the walls, the overhead net and the goal frame
  // The ball off the goal's netting, so a goal bulges it (C-48). M2 settled
  // 0, provisionally: A.5's starting 0.3 let every one of design §9.6's
  // netting shots come back out, and 0 alone kept them all in.
  goalNetRestitution: 0,
  terrierBallRestitution: 0.5,
  terrierRestitution: 0.3, // terriers off each other and the walls
  terrierFloorRestitution: 0, // a landing terrier doesn't bounce (L312)

  // Forces (Configuration: Gravity, Acceleration, Ball rolling slowdown;
  // A.5: Idle friction; D-5, D-6).
  gravityMetresPerSecond2: 9.8,
  accelerationMetresPerSecond2: 15, // the drive's cap
  idleFrictionMetresPerSecond2: 8, // no direction held, tumbled or sitting
  rollingSlowdownMetresPerSecond2: 0.5, // the ball's, on the floor, to exactly 0; no air drag

  // Movement and actions (Configuration; A.5; A.4: Ball overhead; D-6, D-7).
  runSpeedMetresPerSecond: 6,
  zoomiesSpeedMetresPerSecond: 9,
  turnRateTurnsPerSecond: 2,
  noseTurnRateTurnsPerSecond: 1, // vehicle-style steering's (D-7)
  noseReverseMetresPerSecond: 3,
  steering: 'anchored' as Steering, // what the controls send (D-7, D-29)
  zoomiesFullSeconds: 3, // of zoomies from a full meter
  zoomiesRefillSeconds: 6, // to refill from empty
  zoomiesMeterUnitsPerTick: 2, // the meter counts half-ticks (A.1)
  jumpHeightMetres: 1,
  pounceSpeedMetresPerSecond: 10,
  lungeSeconds: 0.3,
  pounceWaitSeconds: 1.5, // from the lunge's end
  bowlingSpeedMetresPerSecond: 4, // the ball's horizontal speed toward a terrier (Q-8)
  tumbleSeconds: 1.5,
  getUpSeconds: 0.5, // the tumble's last
  tumbleGuardSeconds: 1.5, // from getting up
  rearmGapMetres: 0.6, // surface to surface, before a contact is a new touch (D-8)
  barkMaxPerSecond: 1, // the sender keeps to it (D-10)
  ballOverheadEnterMetres: 0.3, // horizontal centre distance (D-7)
  ballOverheadLeaveMetres: 0.4,
  // The ball-frame push assist's speed cap: 0 turns it off, and on it's at
  // least the zoomies speed (A.5; C-18). M2 settled it on at the zoomies
  // speed, provisionally: the smallest cap at which two and four side by
  // side in ball view beat one pusher.
  pushAssistCapMetresPerSecond: 9,

  // Animation (A.4: Gait and running; D-9), from M0's animate().
  gaitCycleMetres: 0.6, // run on the floor in a gait cycle
  runningMinSpeedMetresPerSecond: 0.2, // running above it, or while the drive is on

  // Cameras (Configuration: Chase view swing; A.5; D-28): each viewer's
  // own, outside the state, tuned at M4.
  chaseSwingTimeConstantSeconds: 0.3,
  chaseSwingMaxTurnsPerSecond: 1,
  chaseCalmerTimeConstantSeconds: 0.6, // the calmer camera
  chaseCalmerMaxTurnsPerSecond: 0.5,
  ballViewSwingMaxTurnsPerSecond: 1, // no lag below the cap
  ballViewCalmerMaxTurnsPerSecond: 0.5,

  // The timeline (A.4; D-3, D-11, D-13).
  ticksPerSecond: 60,
  substepsPerTick: 4,
  inputDelayTicks: 2, // chosen again from M3's measurement (D-16)
  lateWindowTicks: 12,
  voteWindowTicks: 12,
  stateHistoryTicks: 256,
  inputHistoryTicks: 16, // in every TICK
  spreadMaxStepsPerTick: 42, // a worst tick's steps, spread: a 270-step repair takes 7 ticks (D-11)
  speedBoundMetresPerSecond: 25, // D-3: the fastest a body moves; §16's tunnelling fuzz shoots at it

  // The joiner's warm-up and the tick clock (A.4: Join warm-up and the tick
  // clock; D-11, D-15): roslambo's literals, configured from M3.
  joinWarmupSeconds: 0.5, // finalisation held until every active player is heard, at most this (roslambo D-7, M0)
  clockSettleSeconds: 2, // a peer's clock offset counts once heard this long (roslambo D-11, M0)
  clockSmoothing: 0.1, // each new sample's weight in a peer's offset (roslambo's EWMA)
  clockGainPerTick: 0.005, // the rate's change for each tick of median offset: 0.5% (roslambo D-11, M0)
  clockRateMax: 0.02, // of the rate, either way: 2% (roslambo D-11, M0)
  clockDeadbandTicks: 1, // no rate change within this median offset (roslambo D-11, M0)
  clockRebalanceSeconds: 1, // how often the median is taken (roslambo's rebalance)

  // Resyncs, joining and events (A.4: Resync and joining; D-12, D-13), M3.
  resyncRetrySeconds: 0.5, // then a resync asks the next voter (roslambo §8.3)
  stateRequestRetrySeconds: 1, // then a joiner asks the next peer that holds the match (roslambo's JOIN_RETRY_MS)
  eventRetryTicks: 30, // after its tick is final, an event the state doesn't show goes again (roslambo §8.3's delay + 30)

  // The solver (A.4; D-5): M0 kept these.
  solverIterations: 8, // forward and back sweeps over mirror pairs
  positionPasses: 2, // also in mirror pairs
  floorContactsInSolve: true, // in both
  // Slower contacts settle with no bounce. The push assist reads it too, as
  // the speed above which the ball is moving (C-18, design §4.4's 0.3 m/s).
  restitutionThresholdMetresPerSecond: 0.3,
  slipOutConeDegrees: 42, // from vertical, with the slipping flag
  slipOutSpeedMetresPerSecond: 2, // sideways
  // The slipping flag holds the drive off toward the body slipped from only
  // this close to it, surface to surface in plan view (M2's slip release).
  slipHoldOffMetres: 0.6,

  // Presence and the room (A.4; Configuration: Spectators; D-12, D-16,
  // D-17, D-18, D-21).
  removalSilentTicks: 180, // before the start countdown (roslambo Q-15)
  sittingSilentTicks: 120, // from the start countdown
  abandonedSeconds: 30, // from the start countdown, with no browser that controls a terrier (Q-16)
  duplicateIdSilentSeconds: 2, // a duplicate ID replaces a connection this silent
  handshakeTimeoutSeconds: 10,
  connectionFailureSeconds: 20, // before the connection-failure message
  meshPlayersMax: 8, // browsers that play
  spectatorsMax: 4,
  messageMaxBytes: 16000,
  maxReceiveBytes: 1048576, // 1 MiB, Trystero's; never below 16,384 (D-18)
  displayNameMaxChars: 20,
  displayNameMaxBytes: 32, // UTF-8

  // Gossip, misbehaving peers, leaving and bot hosting (A.4: Gossip,
  // Misbehaving peers, Leaving, Bot hosting; D-19, D-21, C-12, C-41), M3.
  peersEverySeconds: 5, // PEERS on each change and this often (§9; roslambo D-14)
  pingEverySeconds: 1, // to each peer, at most half the duplicate's silence (C-12); roslambo's PING_EVERY_MS was 2 s
  floodTicksPerTick: 3, // TICKs a tick from a connection, or for each origin it forwards (roslambo §9.3)
  floodSeconds: 2, // counted over this long, from a connection open that long (roslambo §9.3)
  invalidMessagesMax: 20, // then the connection closes (roslambo §9.4)
  leaveGraceSeconds: 0.4, // a leaving page keeps its room this long, so its LEAVE or AGAIN goes out (roslambo's LEAVE_GRACE_MS)
  botReadyRenewSeconds: 10, // a host sends a bot's READY again with this long left, so a bot is always ready (C-41, §14)

  // Controls (A.4; D-10, D-29).
  stickSteps: 32, // directions a turn
  stickHysteresisSteps: 0.5,
  stickDeadZoneFraction: 0.2, // of the stick's travel
  chaseRereadDegrees: 45, // chase view reads the screen again from this far (Q-19)
  touchEdgeMarginCssPx: 32, // from the side edges, inside the safe-area insets

  // The page (A.4; D-16, D-30, D-31, D-33, §13, Q-11, Q-17).
  smoothingMs: 100, // a correction's offset decay; bodies in contact share one (D-16)
  ownSmoothingMs: 50, // for your own terrier
  timerStallSeconds: 2, // a longer gap between timer runs is a stall (D-31)
  stallSendTicks: 3, // after a shorter catch-up, only the newest ticks' inputs go (A.4: Timer stall; D-10; roslambo D-11's 2026-10-25 fix)
  timelineTimerMs: 4, // the timeline's timer period, never animation frames (D-31; roslambo's ADVANCE_EVERY_MS)
  phoneShortSideCssPx: 600, // a phone: a coarse pointer and a shorter side under this (D-30)
  resultsPressGuardSeconds: 0.5, // Results takes a press that begins this long after it shows (Q-17)
  lostGraphicsSeconds: 5, // then the plain message, counted while the page is visible (D-30)
  renderQualityDefault: 'high' as RenderQuality,
  renderQuality: {
    high: { pixelRatioMax: 2, msaa: true },
    low: { pixelRatioMax: 1, msaa: false }, // and simpler effects
  },
  soundShiftTicksMax: 3, // an event a re-simulation moves this far plays once (§13)
  coatCount: 8, // the coat list is fixed with the look at M4 (Q-11); M0 drew 8

  // The bot brain (A.4: Bot brain; Q-9, D-39), which M2 tunes. Its bark gap
  // is the Bark setting's (L327).
  botReactionSeconds: 0.25, // before it acts on what it sees
  botAimNoiseDegrees: 10, // either way, seeded per bot
  botZoomiesBeyondMetres: 5, // zooms toward a target farther than this
  botPounceWithinMetres: 2, // of the ball's surface
  botPounceAlignDegrees: 20, // lined up with the ball and the goal
  botSupportMetres: 5, // behind the ball
  botDefendMetres: 6, // out from its goal line
  botBarkEverySeconds: 5, // about: jittered by the bark gap either way
  botStuckSeconds: 2, // held within botStuckMetres, then it turns away
  botStuckMetres: 0.5,
} as const);

/** The configuration's type with its numbers widened, for a copy that a
 *  test or the tuning page changes. */
export type Config = Widen<typeof config>;
/** The pitch's shape, which src/core/sim/pitch.ts builds the pieces from. */
export type PitchShape = Config['pitch'];

type Widen<T> = T extends number
  ? number
  : T extends boolean
    ? boolean
    : T extends object
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T;

/** Each pack's kickoff spots by pack size: pack A's from the configuration,
 *  and pack B's their point mirror, (x, y) → (−x, −y), exact by negation
 *  (D-4). */
export function packSpots(c: Config): readonly [SpotTable, SpotTable] {
  const a = c.kickoffSpotsMetres;
  const b = a.map((spots) => spots.map(([x, y]): Spot => [-x, -y]));
  return [a, b];
}

/** The settings in the simulation's units: whole ticks, the zoomies meter's
 *  units (A.1), the substep, the jump speed and both packs' kickoff spots;
 *  from M2, a minute's ticks and the bots' and the bark gap's ticks.
 *  Throws on a time that isn't a whole number of ticks, and on a meter whose
 *  rates aren't whole units a tick. */
export function derive(c: Config) {
  const rate = c.ticksPerSecond;
  const ticks = (seconds: number, what: string): number => {
    const t = seconds * rate;
    const whole = Math.round(t);
    // Written so NaN and ±Infinity fail it too: 1 / a bark rate of 0 is Infinity.
    if (!(Math.abs(t - whole) <= 1e-9)) throw new Error(`${what}: ${seconds} s is ${t} ticks, not a whole number`);
    return whole;
  };
  // A.1: a tick of zoomies drains its units a tick, and the meter refills
  // from empty in the refill time.
  const units = c.zoomiesMeterUnitsPerTick;
  const full = ticks(c.zoomiesFullSeconds, 'zoomies from full') * units;
  const refill = full / ticks(c.zoomiesRefillSeconds, 'the zoomies refill');
  if (!Number.isInteger(units) || !Number.isInteger(refill) || full > 0xffff) {
    throw new Error(`the zoomies meter: full ${full}, drain ${units} and refill ${refill} a tick are not whole units of a u16 (A.1)`);
  }
  return deepFreeze({
    tickSeconds: 1 / rate,
    substepSeconds: 1 / (rate * c.substepsPerTick),
    jumpSpeedMetresPerSecond: Math.sqrt(2 * c.gravityMetresPerSecond2 * c.jumpHeightMetres), // D-6
    readyExpiryTicks: ticks(c.readyExpirySeconds, 'the ready expiry'),
    startCountdownTicks: ticks(c.startCountdownSeconds, 'the start countdown'),
    kickoffCountdownTicks: ticks(c.kickoffCountdownSeconds, 'the kickoff countdown'),
    // Held until the goal's tick is confirmed, w + v ticks on (D-13, Q-7).
    celebrationTicks: ticks(c.celebrationSeenSeconds, 'the celebration') + c.lateWindowTicks + c.voteWindowTicks,
    lungeTicks: ticks(c.lungeSeconds, 'the lunge'),
    pounceWaitTicks: ticks(c.pounceWaitSeconds, 'the pounce wait'),
    tumbleTicks: ticks(c.tumbleSeconds, 'the tumble'),
    getUpTicks: ticks(c.getUpSeconds, 'the get-up'),
    tumbleGuardTicks: ticks(c.tumbleGuardSeconds, 'the tumble guard'),
    botReactionTicks: ticks(c.botReactionSeconds, "the bots' reaction"),
    ticksPerMinute: ticks(60, 'a minute'), // the match length's (D-8)
    botBarkEveryTicks: ticks(c.botBarkEverySeconds, "the bots' bark period"),
    botStuckTicks: ticks(c.botStuckSeconds, "the bots' unstick"),
    barkGapTicks: ticks(1 / c.barkMaxPerSecond, 'the bark gap'), // L327
    zoomiesMeterFull: full,
    zoomiesMeterDrainPerTick: units,
    zoomiesMeterRefillPerTick: refill,
    kickoffSpots: packSpots(c),
  });
}

export type Derived = ReturnType<typeof derive>;

/** The configuration in the simulation's units. */
export const derived: Derived = derive(config);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
