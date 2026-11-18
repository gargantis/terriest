// The configuration in the timeline's, the session's and the transports'
// units (design §1.13, §10; PLAN §7.4), built once per configuration, so the
// tests and the correction measurement pass a changed copy, as simParams
// does for the simulation, and nothing outside src/config.ts copies a
// setting (design §0). Seconds become milliseconds, and ticks where the
// session counts ticks, throwing on a time that isn't a whole number of
// them, as derive() does. The three shapes are declared here, so no later
// phase edits this file (design §12): the timeline's TimelineConfig extends
// TimelineSettings, and its TickClock takes the clock's settings with d and
// w added.

import { config, type Config } from '../../config';

/** A room's settings (design §4). */
export interface RoomSettings {
  readonly spectatorsMax: number;
  readonly meshPlayersMax: number; // browsers that play
  readonly duplicateSilentMs: number; // a duplicate ID replaces a connection this silent: no message, no pong (C-12)
  readonly peersEveryMs: number; // PEERS on each change and this often
  readonly stateRequestRetryMs: number; // then a joiner asks the next peer (design §4.2, §4.12)
  readonly eventRetryTicks: number; // an event goes again this long after its tick is final, if the state doesn't show it (D-12)
  readonly floodTicksPerTick: number; // TICKs a tick from a connection, or for each origin it forwards
  readonly floodMs: number; // counted over this long, from a connection open that long
  /** floodTicksPerTick for each tick of floodMs, as a whole count: more in the last floodMs close the
   *  connection (design §4.10), 360 at A.4's values. floodTicksPerTick × (floodMs / tickMs) is
   *  359.99999999999994. */
  readonly floodTicksMax: number;
  readonly invalidMessagesMax: number; // then the connection closes
  readonly abandonedMs: number; // Q-16
  readonly connectionFailureMs: number; // PLAN §8
  readonly handshakeTimeoutMs: number; // an admission's reservation lasts at most this (D-21)
  readonly botReadyRenewTicks: number; // a bot's READY goes again with this many ticks of its Ready left (C-41)
  readonly leaveGraceMs: number; // a leaving page keeps its room this long
  readonly resyncRetryMs: number; // a peer answers one STATE_REQ per connection this often (design §4.10)
}

/** What a transport reads (design §1.18). */
export interface TransportSettings {
  readonly maxReceiveBytes: number; // D-18
  readonly handshakeTimeoutMs: number;
  readonly pingEveryMs: number; // to each peer, for C-12's liveness
}

/** The timeline's settings; timeline.ts's TimelineConfig extends it with P, me, mode and verify. */
export interface TimelineSettings {
  readonly delay: number; // d, ticks
  readonly window: number; // w, ticks
  readonly voteWindow: number; // v, ticks
  readonly history: number; // final states kept, ticks
  readonly inputHistory: number; // ticks of history in every TICK
  readonly spreadCap: number; // steps a tick (D-11)
  /** The input store's and the vote book's span: the smallest power of two at least twice
   *  history + 2·window + delay (design §2.12), 1024 at A.4's values. */
  readonly inputSpan: number;
  readonly warmupMs: number; // a joiner's hold on finalisation, at most
  readonly resyncRetryMs: number; // then a resync asks the next voter
  readonly stallSendTicks: number; // a catch-up sends only its newest ticks: Infinity in Practice (D-22)
  readonly clock: {
    /** 1000 / ticksPerSecond, which isn't exact at 60: 1,000 ms divided by it is
     *  59.99999999999999 ticks, but times 1 / tickMs, which is 60 / 1000, it's 60. */
    readonly tickMs: number;
    readonly settleMs: number; // a peer's offset counts once heard this long
    readonly smoothing: number; // each sample's weight in a peer's offset
    readonly gainPerTick: number; // the rate's change for each tick of the median offset
    readonly rateMax: number; // its limit either way
    readonly deadbandTicks: number; // no change within this offset
    readonly rebalanceMs: number; // how often the median is taken
    /** A clock sample further off is none: inputSpan less history + 2·window + delay, the ticks a
     *  clock may run past the final tick with the stores' window still in their rings (design
     *  §2.12), 742 at A.4's values. */
    readonly sampleMaxTicks: number;
  };
}

/** The settings of a networked match and of Practice in their units; the
 *  simulation's, the brain's and the wire's come from simParams, botParams
 *  and the protocol's wireLimits. */
export interface NetSettings {
  readonly tickMs: number; // as the clock's
  readonly timerMs: number; // the glue's timer period (D-31)
  readonly stallMs: number; // a longer gap between timer runs is a stall (A.4)
  readonly timeline: TimelineSettings;
  readonly room: RoomSettings;
  readonly transport: TransportSettings;
}

const MS_PER_SECOND = 1000; // not a setting

/** The smallest power of two at least n, for a ring's span. */
function powerOfTwoAtLeast(n: number, what: string): number {
  // Written so NaN and Infinity fail it too, rather than loop.
  if (!(n >= 1 && n <= 2 ** 30)) throw new Error(`${what}: ${n} ticks is no span a ring can hold`); // not a setting
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** The configuration in the units of the timeline, the room and the transports. */
export function netSettings(c: Config = config): NetSettings {
  const rate = c.ticksPerSecond;
  const ms = (seconds: number): number => seconds * MS_PER_SECOND;
  const ticks = (seconds: number, what: string): number => {
    const t = seconds * rate;
    const whole = Math.round(t);
    if (!(Math.abs(t - whole) <= 1e-9)) throw new Error(`${what}: ${seconds} s is ${t} ticks, not a whole number`);
    return whole;
  };
  const tickMs = MS_PER_SECOND / rate;
  const d = c.inputDelayTicks;
  const w = c.lateWindowTicks;
  const history = c.stateHistoryTicks;
  // The ticks the stores need, from finalTick − history to the clock's tick + 2w + d (design §2.12).
  const needed = history + 2 * w + d; // not a setting
  // Twice that, so a page whose clock runs well past its final tick still fits.
  const inputSpan = powerOfTwoAtLeast(2 * needed, 'the input span'); // not a setting
  const clock = Object.freeze({
    tickMs,
    settleMs: ms(c.clockSettleSeconds),
    smoothing: c.clockSmoothing,
    gainPerTick: c.clockGainPerTick,
    rateMax: c.clockRateMax,
    deadbandTicks: c.clockDeadbandTicks,
    rebalanceMs: ms(c.clockRebalanceSeconds),
    sampleMaxTicks: inputSpan - needed,
  });
  const timeline: TimelineSettings = Object.freeze({
    delay: d,
    window: w,
    voteWindow: c.voteWindowTicks,
    history,
    inputHistory: c.inputHistoryTicks,
    spreadCap: c.spreadMaxStepsPerTick,
    inputSpan,
    warmupMs: ms(c.joinWarmupSeconds),
    resyncRetryMs: ms(c.resyncRetrySeconds),
    stallSendTicks: c.stallSendTicks,
    clock,
  });
  const room: RoomSettings = Object.freeze({
    spectatorsMax: c.spectatorsMax,
    meshPlayersMax: c.meshPlayersMax,
    duplicateSilentMs: ms(c.duplicateIdSilentSeconds),
    peersEveryMs: ms(c.peersEverySeconds),
    stateRequestRetryMs: ms(c.stateRequestRetrySeconds),
    eventRetryTicks: c.eventRetryTicks,
    floodTicksPerTick: c.floodTicksPerTick,
    floodMs: ms(c.floodSeconds),
    floodTicksMax: c.floodTicksPerTick * ticks(c.floodSeconds, 'the flood window'),
    invalidMessagesMax: c.invalidMessagesMax,
    abandonedMs: ms(c.abandonedSeconds),
    connectionFailureMs: ms(c.connectionFailureSeconds),
    handshakeTimeoutMs: ms(c.handshakeTimeoutSeconds),
    botReadyRenewTicks: ticks(c.botReadyRenewSeconds, "a bot's Ready renewal"),
    leaveGraceMs: ms(c.leaveGraceSeconds),
    resyncRetryMs: ms(c.resyncRetrySeconds),
  });
  const transport: TransportSettings = Object.freeze({
    maxReceiveBytes: c.maxReceiveBytes,
    handshakeTimeoutMs: ms(c.handshakeTimeoutSeconds),
    pingEveryMs: ms(c.pingEverySeconds),
  });
  return Object.freeze({ tickMs, timerMs: c.timelineTimerMs, stallMs: ms(c.timerStallSeconds), timeline, room, transport });
}

/** Practice's: the same, but a catch-up records every tick's local input,
 *  since sending only the newest ticks keeps peers from splitting, and
 *  Practice has none (D-22). */
export function practiceSettings(n: NetSettings): NetSettings {
  return Object.freeze({ ...n, timeline: Object.freeze({ ...n.timeline, stallSendTicks: Infinity }) });
}
