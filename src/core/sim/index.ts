// The simulation's public face for M3 and M4 (design §1.16): the state, its
// inputs, parameters, codec, checks and hash, the step, and what Results and
// the canary read. Tests and the tuning page import the modules themselves.
// Re-exports only, so exact operations hold here as in what it exports (D-1).

export * from './state';
export * from './input';
export * from './params';
export { CODEC_VERSION, decodeState, encodeState, hashState } from './codec';
export { stateProblems } from './valid';
export { hash64 } from './hash';
export { angleDiff, datan2, dir, fractionOfTurn, HALF_TURN, QUARTER_TURN, TURN } from './math';
export { makeSim, type Sim, step } from './step';
export { terriest, winner } from './rules';
export { canaryHash } from './golden';
