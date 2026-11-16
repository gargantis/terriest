// The spike's canonical state bytes, the hash input (PLAN A.1, without the
// roster's IDs, names and Ready, which the spike doesn't keep). One encoding
// per state, little-endian; floats as f64. NaN must never occur (D-1), so
// encoding one throws.

import { hash64 } from './hash.ts';
import type { MatchState, Terrier } from './state.ts';

export const CODEC_VERSION = 1;
const HEADER = 2 + 1 + 4 + 4 + 1 + 1 + 1 + 4 + 1 + 1 + 1;
const BALL = 6 * 8 + 1 + 4 + 8 + 4;
const TERRIER = 3 + 4 + 2 + 4 + 4 + 6 * 8 + 1 + 1 + 2 + 2 * 4 + 1 + 2 + 1 + 1 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 1 + 8 + 8;

function flags(t: Terrier): number {
  return (t.onFloor ? 1 : 0) | (t.sitting ? 2 : 0) | (t.lunge > 0 ? 4 : 0) | (t.zoomLocked ? 8 : 0) |
    (t.ballOverhead ? 16 : 0) | (t.slipping ? 32 : 0) | (t.driveOn ? 64 : 0) | (t.zooming ? 128 : 0);
}

let buffer = new Uint8Array(1024);

/** Encodes s into a shared buffer and returns its length: read it before
 *  the next call. */
function encodeInto(s: MatchState): number {
  const size = HEADER + BALL + s.terriers.length * TERRIER;
  if (buffer.length < size) buffer = new Uint8Array(size * 2);
  const v = new DataView(buffer.buffer);
  let o = 0;
  const f64 = (x: number): void => {
    if (x !== x) throw new Error('NaN in the match state'); // must never happen (D-1)
    v.setFloat64(o, x, true);
    o += 8;
  };
  const u32 = (x: number): void => { v.setUint32(o, x >>> 0, true); o += 4; };
  const i32 = (x: number): void => { v.setInt32(o, x | 0, true); o += 4; };
  const u16 = (x: number): void => { v.setUint16(o, x, true); o += 2; };
  const u8 = (x: number): void => { v.setUint8(o, x); o += 1; };
  u16(CODEC_VERSION);
  u8(s.phase); u32(s.phaseStart); u32(s.tick); u8(s.packSize);
  u8(s.score[0]); u8(s.score[1]);
  u32(s.lastGoalTick); u8(s.lastGoalPack); u8(s.ownGoal ? 1 : 0); u8(s.scorers);
  const b = s.ball;
  f64(b.x); f64(b.y); f64(b.z); f64(b.vx); f64(b.vy); f64(b.vz);
  u8(b.onFloor ? 1 : 0); u32(b.lastHitTick); f64(b.lastHitStrength); u32(b.lastContactTick);
  for (const t of s.terriers) {
    u8(t.pack); u8(t.spot); u8(t.coat);
    u32(t.lastInputTick); u16(t.prevInput);
    u32(t.heading); u32(t.overheadRef);
    f64(t.x); f64(t.y); f64(t.z); f64(t.vx); f64(t.vy); f64(t.vz);
    u8(flags(t)); u8(t.slipFrom + 1);
    u16(t.meter);
    u16(t.pounceWait); u16(t.lunge); u16(t.tumble); u16(t.guard);
    u8(t.touchingBall ? 1 : 0); u16(t.touches); u8(t.goals);
    u8(t.anim); u32(t.animStart);
    u32(t.gait);
    u32(t.takeOffTick); u32(t.landingTick);
    u32(t.lastBallContactTick); u32(t.lastTerrierContactTick);
    u32(t.lastPushDir); u32(t.lastPushTick);
    i32(t.headingChange);
    u8(0); // reserved
    f64(t.targetVx); f64(t.targetVy);
  }
  if (o !== size) throw new Error(`codec size ${o} != ${size}`);
  return o;
}

export function encodeState(s: MatchState): Uint8Array {
  const len = encodeInto(s);
  return buffer.slice(0, len);
}

export function hashState(s: MatchState): string {
  const len = encodeInto(s);
  return hash64(buffer, len);
}
