// The sim/scene contract of the M0 spike. src/sim produces MatchViews and
// src/scene draws them; each codes against this file alone, never the other.
// Coordinates are metres, with the centre spot at the origin, x along the
// length (pack 0 defends x = -20), and z up (PLAN D-4).
// The tsconfig has exactOptionalPropertyTypes on: a view with no goal yet
// leaves lastGoal out, rather than setting it to undefined.

export const TICK_RATE = 60; export const SUBSTEPS = 4;
export type Pack = 0 | 1;
export type AnimPhase = 'standing' | 'running' | 'zooming' | 'airborne' | 'lunging' | 'tumbled' | 'gettingUp' | 'sitting';
export interface TerrierView { pack: Pack; spot: number; coat: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; heading: number /* u32 binary angle, 2^32 a turn */; phase: AnimPhase; phaseStartTick: number; gait: number /* u32 binary angle */; lastBallContactTick: number }
export interface BallView { x: number; y: number; z: number; vx: number; vy: number; vz: number; lastHitTick: number; lastHitStrength: number }
export interface MatchView { tick: number; terriers: TerrierView[]; ball: BallView; lastGoal?: { tick: number; pack: Pack } }
export interface SimSource { readonly packSize: number; view(): MatchView; advance(ticks: number): void } // the scene advances it by the clock, never once per frame
export interface DrawStats { triangles: number; drawCalls: number; bones: number; textures: number; textureBytes: number; geometries: number }
