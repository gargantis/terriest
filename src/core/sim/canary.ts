// The canary (PLAN D-23; design §7.3): a short placed run whose final hash
// every browser must reproduce, which the page replays at start-up and
// compares with goldens.json's (src/ui/canary.ts). Its script moved out of
// scripts.ts, and its hash out of golden.ts, unchanged, by M4's phase 2a
// (M4's design §1.50, M4-Q5), so the page's module holds the canary and no
// other golden run; scripts.ts and golden.ts re-export them. It ships in
// the page's module and the determinism chunk, so exact operations only
// (D-1).

import { encodeInput, FRAME_PITCH } from './input';
import { defaultParams, type SimParams } from './params';
import { ballDir, place, placeBall, type Scene, touchReach } from './placing';
import { replay } from './replay';
import { placed } from './script-inputs';
import type { ScriptSpec } from './scripts';
import { IN_PLAY } from './state';

/** Pack A's four in a train behind the ball, 4 m in front of pack B's
 *  goal, holding at it with zoomies in spells; pack B's four off the
 *  train's flanks, holding across it and pouncing on a schedule into pack
 *  A's terriers and the ball. */
const CANARY_B: readonly (readonly [x: number, y: number, step: number, at: number])[] = [
  [-1.2, 1.7, 28, 14], [-1.2, -1.7, 4, 20], [-2.6, 1.7, 28, 26], [-2.6, -1.7, 4, 32], // not a setting: a scene's coordinates, steps and ticks
];

const CANARY_SCENE: Scene = {
  name: 'canary', packSize: 4, phase: IN_PLAY, mirrored: false, // not a setting: the scene's size
  setup: (s, P) => {
    const x = P.pitch.goalLineX - 4; // not a setting: 4 m in front of the goal line
    placeBall(P, s, x, 0);
    const reach = touchReach(P);
    for (let j = 0; j < 4; j++) {
      place(P, s, 2 * j, x - reach - 0.5 * j, 0);
      place(P, s, 2 * j + 1, x + CANARY_B[j]![0], CANARY_B[j]![1]);
    }
  },
  input: (pack, rank, t) => {
    if (pack === 0) return ballDir(0, ((t >> 5) + rank) % 2 === 0);
    const [, , step, at] = CANARY_B[rank]!;
    return encodeInput({ step, frame: FRAME_PITCH, pounce: t >= at ? 1 : 0 });
  },
};

export const CANARY_SCRIPT: ScriptSpec = placed('canary', CANARY_SCENE, 300, { pushes: 1, bounces: 1, pounces: 1, tumbles: 1, goals: 1, zooms: 1 }); // not a setting: D-23's length

/** The canary's final hash (D-23). */
export function canaryHash(P: SimParams = defaultParams): string {
  return replay(CANARY_SCRIPT, P).final;
}
