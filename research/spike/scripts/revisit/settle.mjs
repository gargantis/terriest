// M0's cost revisit: when, if ever, contacts.test.ts's bit-still scenes stop
// changing under a solver variant. The test settles each scene for a fixed
// number of ticks (10, or 60 for the pressing scene) and then needs 36,000
// ticks without a bit changing; a variant that fails it may settle later, or
// never. This runs each scene for 36,000 ticks from its start and reports
// the last tick on which any body's position, velocity or floor flag
// changed, how many ticks changed, from tick 1,000 on the period after
// which a state first repeats (1 is at rest), and over the last 1,000 ticks
// how far any body's position and speed ranged.
//
//   node scripts/revisit/settle.mjs --solver p1   -> results/revisit/settle-<name>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ballDir, park, place, placeBall } from '../../src/sim/scripts.ts';
import { run, scenario } from '../../src/sim/testing.ts';
import { applySolverDefaults, solverLabel, solverName } from '../../src/solver-settings.ts';

const args = process.argv.slice(2);
const spec = args.includes('--solver') ? args[args.indexOf('--solver') + 1] : 'base';
// Every configuration is made when a scene is, so the variant applies to all of them.
const settings = applySolverDefaults(spec);

const TICKS = 36_000;
const values = (s) => [s.ball, ...s.terriers].flatMap((b) => [b.x, b.y, b.z, b.vx, b.vy, b.vz]);
const bits = (s) => {
  const all = [s.ball, ...s.terriers];
  const f = new Float64Array(6 * all.length);
  all.forEach((b, i) => f.set([b.x, b.y, b.z, b.vx, b.vy, b.vz], 6 * i));
  return `${Buffer.from(f.buffer).toString('hex')}|${all.map((b) => (b.onFloor ? 1 : 0)).join('')}`;
};
// contacts.test.ts's scenes: each body 1 µm into the next, as there.
const EPS = 1e-6;
const againstWall = () => scenario(1, {}, (s) => {
  placeBall(s, 3, -14 + 0.8 - EPS);
  place(s, 0, 3, -14 + 0.8 - EPS + Math.sqrt(0.8) - EPS);
  park(s, 1);
});
const scenes = [
  { scene: 'a resting ball with two standing terriers, nothing held', testSettleTicks: 0, make: () => scenario(1, {}, (s) => { placeBall(s, 0, 0); place(s, 0, -3, 2); place(s, 1, 3, -2); }), input: () => 0 },
  { scene: 'a terrier resting against the ball at the side wall, nothing held', testSettleTicks: 10, make: againstWall, input: () => 0 },
  { scene: 'a terrier holding at the ball, pressing it into the side wall', testSettleTicks: 60, make: againstWall, input: (k) => (k === 0 ? ballDir(0) : 0) },
];
const rows = scenes.map(({ scene, testSettleTicks, make, input }) => {
  const sc = make();
  let prev = bits(sc.s);
  let last = 0;
  let changed = 0;
  let period = null;
  const seen = new Map();
  let lo = null;
  let hi = null;
  for (let t = 1; t <= TICKS; t++) {
    run(sc, 1, input);
    if (t > TICKS - 1000) {
      const v = values(sc.s);
      lo = lo ? lo.map((x, i) => Math.min(x, v[i])) : v;
      hi = hi ? hi.map((x, i) => Math.max(x, v[i])) : v;
    }
    const b = bits(sc.s);
    if (b !== prev) {
      last = t;
      changed++;
    }
    if (t >= 1000 && period === null) {
      if (seen.has(b)) period = t - seen.get(b);
      else seen.set(b, t);
    }
    prev = b;
  }
  const { ball } = sc.s;
  // Fields 6k to 6k + 2 are body k's position (the ball first), 6k + 3 to 6k + 5 its velocity.
  const spread = hi.map((x, i) => x - lo[i]);
  const most = (from) => Math.max(...spread.filter((_, i) => i % 6 >= from && i % 6 < from + 3));
  return {
    scene, ticks: TICKS, testSettleTicks, lastTickThatChanged: last, ticksThatChanged: changed, periodFromTick1000: period,
    atRest: period === 1, settledWithinTestSettle: last <= testSettleTicks,
    last1000Ticks: { positionRangeM: most(0), speedRangeMs: most(3) }, ballZ: ball.z, ballY: ball.y,
  };
});
const name = solverName(settings);
const out = { about: "M0's cost revisit: when contacts.test.ts's bit-still scenes stop changing (scripts/revisit/settle.mjs)", utc: new Date().toISOString(), spec, name, label: solverLabel(settings), settings, rows };
mkdirSync(fileURLToPath(new URL('../../results/revisit/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL(`../../results/revisit/settle-${name}.json`, import.meta.url)), `${JSON.stringify(out, null, 1)}\n`);
for (const r of rows) {
  console.log(`${out.label}: ${r.scene}: last change at tick ${r.lastTickThatChanged} (the test settles ${r.testSettleTicks}); ` +
    `${r.atRest ? 'at rest' : `period ${r.periodFromTick1000} from tick 1,000, ranging ${r.last1000Ticks.positionRangeM.toExponential(2)} m and ${r.last1000Ticks.speedRangeMs.toExponential(2)} m/s`}`);
}
