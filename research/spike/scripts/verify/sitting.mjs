// §16's sitting case (two sitting terriers let a ball dropped on them reach
// the floor within 0.5 s, timed from its first landing on them), the same
// placement as src/sim/cases.ts's ballOnTerriers, under three readings of
// "reach the floor": within 1 cm after the substep (cases.ts's DOWN), within
// 1 µm after the substep, and the ball's floor contact found in step 3 (it
// meets the floor). θ from 4° to 58° in 0.25° steps, 8 s at most.
//
//   node scripts/verify/sitting.mjs   -> results/verify/sitting.json
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeConfig, SLIP_OUT_RULES, substepsPerSecond } from '../../src/sim/config.ts';
import { newMatch, IN_PLAY } from '../../src/sim/state.ts';
import { makeSim, step } from '../../src/sim/step.ts';
import { dir, fractionOfTurn } from '../../src/sim/angle.ts';
import { place, placeBall } from '../../src/sim/scripts.ts';

const R = 0.8, r = 0.25, REACH = R + r;
function sit(rule, thetaDeg) {
  const C = makeConfig({ slipOut: SLIP_OUT_RULES[rule] });
  const sim = makeSim(C, 1); const P = sim.physics;
  const s = newMatch(1, C, IN_PLAY);
  const d = new Float64Array(2);
  dir(fractionOfTurn(thetaDeg, 360), d);
  const rho = REACH * d[1];
  place(s, 0, -rho, 0); place(s, 1, rho, 0);
  placeBall(s, 0, 0, r + REACH * d[0] + 0.01);
  for (const t of s.terriers) t.sitting = true;
  let sub = 0, landed = -1, cm = -1, um = -1, floor = -1, prevZ = Infinity, prevVz = 0;
  sim.probe = (st) => {
    sub++;
    const b = st.ball;
    if (landed < 0) {
      if (prevZ > R + 1e-6 && prevVz < 0) for (const t of st.terriers) { const dx = b.x - t.x, dy = b.y - t.y, dz = b.z - t.z; if (dz > 0 && dx * dx + dy * dy + dz * dz <= REACH * REACH * (1 + 1e-9)) { landed = sub; break; } }
    } else {
      if (cm < 0 && b.z <= R + 0.01) cm = sub;
      if (um < 0 && b.z <= R + 1e-6) um = sub;
      if (floor < 0) for (let c = 0; c < P.cnt; c++) if (P.ci[c] === P.ball && P.cp[c] === 0) { floor = sub; break; }
    }
    prevZ = b.z; prevVz = b.vz;
  };
  for (let t = 1; t <= 480 && floor < 0; t++) step(sim, s, [null, null]);
  const sec = (x) => (x < 0 ? Infinity : (x - landed) / substepsPerSecond(C));
  return { landed, cm: sec(cm), um: sec(um), floor: sec(floor) };
}
const rows = [];
for (const rule of ['flag42', 'flag42E0', 'flag44E0', 'flagE0', 'wideFlagE0', 'review57', 'drafted']) {
  const w = { cm: [0, 0], um: [0, 0], floor: [0, 0] };
  for (let th = 4; th <= 58; th += 0.25) {
    const x = sit(rule, th);
    if (x.landed < 0) continue;
    for (const k of ['cm', 'um', 'floor']) if (x[k] > w[k][0]) w[k] = [x[k], th];
  }
  const f = ([v, th]) => `${v === Infinity ? 'held 8 s' : v.toFixed(3) + ' s'} at ${th}°${v <= 0.5 ? ' (pass)' : ''}`;
  console.log(`${rule.padEnd(10)} within 1 cm: ${f(w.cm)}; within 1 µm: ${f(w.um)}; floor contact: ${f(w.floor)}`);
  rows.push({ rule, ...w });
}
writeFileSync(fileURLToPath(new URL('../../results/verify/sitting.json', import.meta.url)), `${JSON.stringify({ about: 'worst seconds from first landing to the floor, and the angle, per reading; Infinity: held for 8 s', rows: rows.map((r) => ({ rule: r.rule, within1cm: r.cm, within1um: r.um, floorContact: r.floor })) }, (k, v) => (v === Infinity ? 'held 8 s' : v), 1)}\n`);
