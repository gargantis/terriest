// The canary (M4's design, research/m4/DESIGN.md, §1.50, §5.6; PLAN D-23,
// M4-Q5, M4-Q31): whether this browser computes the simulation as every
// other does. The canary's run is replayed once and its final hash
// compared with the build's, src/canary-expected.ts's; a browser that
// computes differently gets no networked match, since a match with it would
// keep going wrong, and Practice still plays. The app asks it once
// start-up's prepare() has finished, in a task of its own, so the two
// don't share a long task, and on demand if Propose or Join comes first;
// Practice never asks it. The verdict is kept, so it's computed once a
// page. New at M4.

import { CANARY_EXPECTED } from '../canary-expected';
import { canaryHash } from '../core/sim/index';

/** A verdict computed at its first call, then kept: the hash against the expected. */
export function canaryCheck(expected: string, hash: () => string): () => boolean {
  let verdict: boolean | null = null;
  return () => (verdict ??= hash() === expected);
}

/** This page's verdict (D-23): the canary's run against goldens.json's, as the build defined it. */
export const canaryOk: () => boolean = canaryCheck(CANARY_EXPECTED, () => canaryHash());
