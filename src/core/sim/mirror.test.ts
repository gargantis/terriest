import { describe, expect, it, vi } from 'vitest';
import { config, type PitchShape } from '../../config';
import { simParams } from './params';
import { chasey, pinchScene, pitchDir, type Scene, sceneInputs, sceneStart } from './scenes';
import { KICKOFF_COUNTDOWN } from './state';
import { makeSim, step } from './step';
import { mirrorMismatches, SECOND_SHAPE } from './testing';

// PLAN §16 P8 (D-4, D-5; design §7.6): a mirrored kickoff gives a
// point-mirrored state at every pack size, compared by value after every
// substep, on the pitch and on D-4's second shape: seeded inputs in all
// three frames, pack B's through mirrorInput, and the pinches, with the
// slip-out firing; and a run into the corners, posts and goals, the pieces
// where the second shape differs. The M0 spike's mirror.test.ts, under the
// chosen slip-out rule alone.
vi.setConfig({ testTimeout: 120_000 });

interface MirrorRun {
  firstMismatch: string | null;
  terrierBall: number; // contacts, summed over substeps
  terrierTerrier: number;
  slipOuts: number;
  pieces: string[]; // every piece met but the floor, by name, sorted
}

function mirroredRun(shape: PitchShape, scene: Scene, ticks: number): MirrorRun {
  const P = simParams({ ...config, pitch: shape });
  const sim = makeSim(P, scene.packSize);
  const ph = sim.physics;
  const s = sceneStart(scene, P);
  let firstMismatch: string | null = null;
  let terrierBall = 0;
  let terrierTerrier = 0;
  const met = new Set<string>();
  let sub = 0;
  sim.probe = (st) => {
    sub++;
    for (let c = 0; c < ph.cnt; c++) {
      const j = ph.cj[c]!;
      if (j === ph.ball) terrierBall++;
      else if (j >= 0) terrierTerrier++;
      else if (ph.cp[c]! > 0) met.add(P.pitch.pieces[ph.cp[c]!]!.name);
    }
    if (firstMismatch === null) {
      const m = mirrorMismatches(st, 1);
      if (m.length > 0) firstMismatch = `tick ${st.tick + 1}, substep ${sub}: ${m[0]}`;
    }
  };
  for (let t = 1; t <= ticks && firstMismatch === null; t++) step(sim, s, sceneInputs(scene, s, t));
  return { firstMismatch, terrierBall, terrierTerrier, slipOuts: ph.stats.slipOuts, pieces: [...met].sort() };
}

const kickoff = (packSize: number, seed: number, frames: 'all' | 'contact'): Scene => ({
  name: `mirrored kickoff ${packSize}, ${frames}`, packSize, phase: KICKOFF_COUNTDOWN, mirrored: true, input: chasey(seed, frames),
});

/** 4 a side from the kickoff, pack A holding in the pitch frame from its
 *  spots toward its end's (−x,+y) corner, its (−x,−y) corner, into its goal
 *  and at its −y post, and sliding along them to the end-wall panels and
 *  the goal's side netting; pack B the mirror. On the second shape the two
 *  corners at an end are cut 3 m and 6 m, and the mouth is 10 m. */
const CORNERS: Scene = {
  name: 'into the corners, the posts and the goals', packSize: 4, phase: KICKOFF_COUNTDOWN, mirrored: true,
  input: (_pack, rank) => pitchDir([14, 18, 17, 17][rank]!),
};
const CORNERS_MEET = [
  'corner −x−y', 'corner −x+y', 'corner +x−y', 'corner +x+y',
  'end −x, −y of the mouth', 'end −x, +y of the mouth', 'end +x, −y of the mouth', 'end +x, +y of the mouth',
  'goal −x back', 'goal −x side −y', 'goal +x back', 'goal +x side +y', 'post −x−y', 'post +x+y',
];

describe('P8: mirrored kickoffs stay exactly mirrored, by value', () => {
  for (const [shapeName, shape] of [['main', config.pitch], ['second', SECOND_SHAPE]] as const) {
    for (let packSize = 1; packSize <= 4; packSize++) {
      it(`${packSize} a side, ${shapeName} pitch, seeded inputs in all three frames`, () => {
        const r = mirroredRun(shape, kickoff(packSize, 40 + packSize, 'all'), 2400);
        expect(r.firstMismatch).toBeNull();
        // The run met the ball, and its packmates and rivals: the floor's contacts aside.
        expect(r.terrierBall, 'terrier–ball contacts').toBeGreaterThan(0);
        if (packSize > 1) expect(r.terrierTerrier, 'terrier–terrier contacts').toBeGreaterThan(0);
      });
    }

    it(`the pinches and seeded contact play at every pack size, ${shapeName} pitch, with the slip-out firing`, () => {
      let slipOuts = 0;
      for (let packSize = 1; packSize <= 4; packSize++) {
        for (const scene of [kickoff(packSize, 90 + packSize, 'contact'), pinchScene(packSize, packSize % 2 === 0)]) {
          const r = mirroredRun(shape, scene, 900);
          expect(r.firstMismatch, scene.name).toBeNull();
          expect(r.terrierBall + r.terrierTerrier, scene.name).toBeGreaterThan(0);
          slipOuts += r.slipOuts;
        }
      }
      expect(slipOuts).toBeGreaterThan(20);
    });

    it(`4 a side, ${shapeName} pitch, driven into the corners, the posts and the goals`, () => {
      const r = mirroredRun(shape, CORNERS, 600);
      expect(r.firstMismatch).toBeNull();
      expect(r.pieces).toEqual(expect.arrayContaining(CORNERS_MEET));
    });
  }

  it('notices a mirror broken by one bit, an ulp or a unit of angle', () => {
    const P = simParams(config);
    const scene = kickoff(2, 7, 'all');
    expect(mirrorMismatches(sceneStart(scene, P))).toEqual([]);
    const a = sceneStart(scene, P);
    a.terriers[1]!.x = a.terriers[1]!.x * (1 + Number.EPSILON);
    expect(mirrorMismatches(a)).toHaveLength(1);
    const b = sceneStart(scene, P);
    b.terriers[3]!.heading = (b.terriers[3]!.heading + 1) >>> 0;
    expect(mirrorMismatches(b)[0]).toMatch(/heading/);
    const c = sceneStart(scene, P);
    c.ball.lastHitDvy = 1e-300;
    expect(mirrorMismatches(c)[0]).toMatch(/lastHitDvy/);
    // A slip from a terrier's slot mirrors to slot ^ 1; the ball's slot is its own.
    const d = sceneStart(scene, P);
    Object.assign(d.terriers[0]!, { slipping: true, slipFrom: 3 }); // A1 off B2
    Object.assign(d.terriers[1]!, { slipping: true, slipFrom: 2 }); // B1 off A2
    expect(mirrorMismatches(d)).toEqual([]);
    d.terriers[1]!.slipFrom = 3;
    expect(mirrorMismatches(d)).toEqual(["terrier 0: B.slipFrom = 3, the mirror of A's = 2"]);
    Object.assign(d.terriers[0]!, { slipFrom: 4 }); // the ball's, 2 × pack size
    Object.assign(d.terriers[1]!, { slipFrom: 4 });
    expect(mirrorMismatches(d)).toEqual([]);
  });
});
