import { describe, expect, it } from 'vitest';
import type { Config } from '../../config';
import { NETTING_SHOTS, type NettingShot, nettingScene, sceneInputs, sceneStart } from './scenes';
import { CELEBRATION } from './state';
import { makeSim, step } from './step';
import { paramsWith } from './testing';

// C-48, design §9.6 and §11's phase 5: a goal bulges the net instead of
// springing back out. M2 settled the netting bounce at 0, provisionally by
// measurement (research/tuning/REPORT.md): there, each of §9.6's 18 netting
// shots (scenes.ts) scores and keeps the ball wholly behind the goal line,
// its centre more than R past it, after every substep of the celebration.
// At A.5's starting 0.3 every one of them comes back out.

const name = (s: NettingShot): string => `a ${s.kind} shot at ${s.speed} m/s, ${s.angleDeg}°`;

/** A shot's least |x| from its goal to its celebration's end, by the
 *  substep, as the tuning page's measure takes it; null if it never scored
 *  or its celebration hadn't ended. */
function leastX(shot: NettingShot, over: Partial<Config> = {}): number | null {
  const P = paramsWith(over);
  const scene = nettingScene(shot);
  const sim = makeSim(P, scene.packSize);
  const s = sceneStart(scene, P);
  let scored = false;
  let ended = false;
  let least = Infinity;
  sim.probe = (st) => {
    if (st.phase === CELEBRATION) {
      scored = true;
      least = Math.min(least, Math.abs(st.ball.x));
    } else if (scored) ended = true;
  };
  for (let t = 1; t <= 600 && !ended; t++) step(sim, s, sceneInputs(scene, s, t));
  return ended ? least : null;
}

describe("the goal's netting (C-48, design §9.6)", () => {
  const P = paramsWith();
  const wholly = P.pitch.goalLineX + P.ballRadius; // 20.8 m

  it('keeps every shot wholly behind the line through its celebration, at the settled bounce', () => {
    expect(NETTING_SHOTS).toHaveLength(18);
    const xs = NETTING_SHOTS.map((shot) => {
      const x = leastX(shot);
      expect(x, `${name(shot)}: a goal and its celebration`).not.toBeNull();
      expect(x!, name(shot)).toBeGreaterThan(wholly);
      return x!;
    });
    // The worst is the 5 m/s rolling shot straight in, at the substep it scored.
    expect(Math.min(...xs).toFixed(3)).toBe('20.801');
  });

  it("lets every shot come back out at A.5's starting 0.3, the 10 m/s high shot 8.5 m onto the pitch", () => {
    const xs = NETTING_SHOTS.map((shot) => {
      const x = leastX(shot, { goalNetRestitution: 0.3 });
      expect(x, `${name(shot)}: a goal and its celebration`).not.toBeNull();
      expect(x!, name(shot)).toBeLessThanOrEqual(wholly);
      return x!;
    });
    expect(Math.min(...xs).toFixed(2)).toBe('11.51');
  });
});
