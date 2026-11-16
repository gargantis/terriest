// Independent re-checks of M0's simulation stop-rule conditions, written
// without the spike's own comparison helpers (mirrorMismatches,
// kineticEnergy, bodyBits), using only the simulation itself:
// - bit-still: the whole state, every field, after every tick for 36,000
//   ticks, in the plan's scene and in scenes with real contacts, pressed by
//   the drive included; and the contacts of the scene contacts.test.ts had
//   before M0's verification, which touched only the floor;
// - simultaneous hitters: the 32 hits of hits.test.ts, placed by this
//   file's own code, with the switches read back from the simulation, plus a
//   fuzz of 3,000 seeded multi-contact hits in mid-air;
// - P8: every own key of every terrier compared with its mirror by value
//   (P8's ===), after every substep and every tick, over 57 mirrored runs.
//
//   node scripts/verify/sim-checks.mjs   -> results/verify/sim-checks.json
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeConfig, SLIP_OUT_RULES, DT, NEVER } from '../../src/sim/config.ts';
import { newMatch, IN_PLAY } from '../../src/sim/state.ts';
import { makeSim, step } from '../../src/sim/step.ts';
import { encodeInput, FRAME_BALL, FRAME_PITCH, mirrorInput } from '../../src/sim/input.ts';
import { GOLDEN_SCRIPTS, chasey, pinch, scriptConfig, scriptInputs, scriptStart, park, place, placeBall } from '../../src/sim/scripts.ts';
import { scenario } from '../../src/sim/testing.ts';
import { pieceContact } from '../../src/sim/pitch.ts';

const outFile = fileURLToPath(new URL('../../results/verify/sim-checks.json', import.meta.url));
const out = {};
const t0 = performance.now();

// The scene contacts.test.ts and scripts/stop-rule.mjs used before this
// check, placed at exactly the touching distances: its contacts.
{
  const sc = scenario(1, {}, (s) => { placeBall(s, 3, -14 + 0.8); place(s, 0, 3, -14 + 0.8 + Math.sqrt(0.8)); park(s, 1); });
  const P = sc.sim.physics;
  const names = sc.sim.pitch.pieces.map((p) => p.name);
  const seen = new Set();
  sc.sim.probe = () => { for (let c = 0; c < P.cnt; c++) seen.add(`${P.ci[c]}-${P.cj[c] >= 0 ? `body ${P.cj[c]}` : names[P.cp[c]]}`); };
  const b = sc.s.ball, t = sc.s.terriers[0];
  const gap = Math.sqrt((t.x - b.x) ** 2 + (t.y - b.y) ** 2 + (t.z - b.z) ** 2) - 1.05;
  const ins = [0, 0];
  for (let i = 0; i < 100; i++) step(sc.sim, sc.s, ins);
  const wall = sc.sim.pitch.pieces.find((p) => p.name === 'side wall −y');
  const hit = { nx: 0, ny: 0, nz: 0, depth: 0 };
  out.oldWallScene = { terrierToBallGapM: gap, ballTouchesSideWall: pieceContact(wall, b.x, b.y, b.z, 0.8, hit), contactsSeenIn100Ticks: [...seen] };
}

// ---------------------------------------------------------------- helpers
function putTerrier(s, k, x, y, z = 0.25) {
  const t = s.terriers[k];
  t.x = x; t.y = y; t.z = z; t.vx = 0; t.vy = 0; t.vz = 0; t.onFloor = z === 0.25;
}
function putBall(s, x, y, z = 0.8) {
  const b = s.ball;
  b.x = x; b.y = y; b.z = z; b.vx = 0; b.vy = 0; b.vz = 0; b.onFloor = z === 0.8;
}
function farAway(s, k) {
  // Far corners of each half, clear of every wall and of each other.
  const t = s.terriers[k];
  const side = t.pack === 0 ? -1 : 1;
  putTerrier(s, k, side * (12 + 0.0), side * (-8 + 1.5 * t.spot));
}
function snapshot(s) {
  return JSON.parse(JSON.stringify(s, (key, v) => (typeof v === 'number' && Object.is(v, -0) ? '-0' : v)));
}
function diffKeys(a, b, prefix = '', outKeys = new Set()) {
  if (typeof a !== 'object' || a === null) { if (a !== b) outKeys.add(prefix.replace(/\.\d+\./g, '.k.')); return outKeys; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffKeys(a[k], b[k], prefix ? `${prefix}.${k}` : k, outKeys);
  return outKeys;
}

// ----------------------------------------------------------- 1. bit-still
// The whole state, every field, compared after every tick with the state
// after the settle ticks. Fields that stamp the current tick by design are
// listed separately (they move every tick): tick, lastInputTick, and the
// contact ticks of bodies in contact.
const STAMPS = new Set(['tick', 'terriers.k.lastInputTick', 'terriers.k.lastBallContactTick', 'ball.lastContactTick', 'terriers.k.lastTerrierContactTick']);
function bitStill(name, packSize, setup, input, settle, ticks = 36000, over = {}) {
  const C = makeConfig(over);
  const sim = makeSim(C, packSize);
  const s = newMatch(packSize, C, IN_PLAY);
  setup(s);
  const ins = new Array(packSize * 2).fill(0);
  const tickOnce = () => { for (let k = 0; k < ins.length; k++) ins[k] = input(k); step(sim, s, ins); };
  for (let i = 0; i < settle; i++) tickOnce();
  const want = snapshot(s);
  let differing = 0; let first = -1; const fields = new Set(); const stampFields = new Set();
  let maxDev = 0;
  for (let i = 1; i <= ticks; i++) {
    tickOnce();
    const got = snapshot(s);
    const keys = diffKeys(want, got);
    let real = false;
    for (const k of keys) { if (STAMPS.has(k)) stampFields.add(k); else { fields.add(k); real = true; } }
    if (real) {
      differing++; if (first < 0) first = i;
      for (const b of [s.ball, ...s.terriers]) for (const f of ['x', 'y', 'z', 'vx', 'vy', 'vz']) {
        const idx = b === s.ball ? null : s.terriers.indexOf(b);
        const w = idx === null ? want.ball[f] : want.terriers[idx][f];
        const wv = w === '-0' ? -0 : w; maxDev = Math.max(maxDev, Math.abs(b[f] - wv));
      }
    }
  }
  return { name, settleTicks: settle, ticks, ticksDiffering: differing, firstDifferingTick: first, fieldsThatMoved: [...fields], stampFieldsThatMoved: [...stampFields], maxAbsBodyDeviation: maxDev, ball: { x: s.ball.x, y: s.ball.y, z: s.ball.z, vx: s.ball.vx, vy: s.ball.vy, vz: s.ball.vz } };
}
const NOTHING = () => 0;
const towardBall = () => encodeInput({ step: 0, frame: FRAME_BALL });
const REACH = Math.sqrt(1.05 * 1.05 - 0.55 * 0.55); // horizontal centre distance, standing terrier to resting ball
out.bitStill = [
  bitStill('S1 resting ball, two standing terriers, nothing held (the plan\'s case)', 1, (s) => { putBall(s, 0, 0); putTerrier(s, 0, -3, 2); putTerrier(s, 1, 3, -2); }, NOTHING, 0),
  bitStill('S2 ball against the side wall, a terrier standing against it, nothing held', 1, (s) => { putBall(s, 3, -14 + 0.8); putTerrier(s, 0, 3, -14 + 0.8 + REACH); farAway(s, 1); }, NOTHING, 2),
  bitStill('S3 (extra) S2 with the terrier holding toward the ball in the ball frame, after 5 s', 1, (s) => { putBall(s, 3, -14 + 0.8); putTerrier(s, 0, 3, -14 + 0.8 + REACH); farAway(s, 1); }, (k) => (k === 0 ? towardBall() : 0), 300),
  bitStill('S4 (extra) S2 with the terrier holding -y in the pitch frame, after 5 s', 1, (s) => { putBall(s, 3, -14 + 0.8); putTerrier(s, 0, 3, -14 + 0.8 + REACH); farAway(s, 1); }, (k) => (k === 0 ? encodeInput({ step: 24, frame: FRAME_PITCH }) : 0), 300),
  bitStill('S5 (extra) a 4-a-side match standing still, ball on the spot, nothing held', 4, (s) => { putBall(s, 0, 0); }, NOTHING, 0),
  bitStill('S6 (extra) a terrier standing against a resting ball in open pitch, nothing held', 1, (s) => { putBall(s, 0, 0); putTerrier(s, 0, -REACH, 0); farAway(s, 1); }, NOTHING, 2),
  // contacts.test.ts's corrected scenes: each body 1 µm into the next, so the contacts exist.
  bitStill('S7 corrected S2: 1 µm overlaps, settled 10 ticks, nothing held', 1, (s) => { putBall(s, 3, -14 + 0.8 - 1e-6); putTerrier(s, 0, 3, -14 + 0.8 - 1e-6 + REACH - 1e-6); farAway(s, 1); }, NOTHING, 10),
  bitStill('S8 corrected S3: 1 µm overlaps, the terrier pressing the ball into the wall, settled 60 ticks', 1, (s) => { putBall(s, 3, -14 + 0.8 - 1e-6); putTerrier(s, 0, 3, -14 + 0.8 - 1e-6 + REACH - 1e-6); farAway(s, 1); }, (k) => (k === 0 ? towardBall() : 0), 60),
];

// ------------------------------------------------- 2. simultaneous hitters
function ke(s, C) {
  let e = 0.5 * C.ballMass * (s.ball.vx ** 2 + s.ball.vy ** 2 + s.ball.vz ** 2);
  for (const t of s.terriers) e += 0.5 * C.terrierMass * (t.vx ** 2 + t.vy ** 2 + t.vz ** 2);
  return e;
}
function pe(s, C, z0) { return C.gravity * (C.ballMass * (s.ball.z - z0[0]) + s.terriers.reduce((a, t, i) => a + C.terrierMass * (t.z - z0[i + 1]), 0)); }
function mom(s, C) {
  let px = C.ballMass * s.ball.vx, py = C.ballMass * s.ball.vy;
  for (const t of s.terriers) { px += C.terrierMass * t.vx; py += C.terrierMass * t.vy; }
  return [px, py];
}
const OFFSETS = [[0], [-0.26, 0.26], [-0.52, 0, 0.52], [-0.78, -0.26, 0.26, 0.78]];
const CENTRE_DEG = [[0], [-25, 25], [-35, 0, 35], [-55, -20, 20, 55]];
function hitRun({ k, level, layout, floorInSolve = true, iterations = 8, speed = 6 }) {
  const g = level ? 0 : 9.8;
  const C = makeConfig({ drive: false, friction: false, rolling: false, gravity: g, floorInSolve, iterations });
  const sim = makeSim(C, 4);
  const s = newMatch(4, C, IN_PLAY);
  for (let j = 0; j < 8; j++) farAway(s, j);
  putBall(s, 0, 0);
  const z = level ? 0.8 : 0.25;
  const dz = 0.8 - z;
  const lead = speed * DT * 20.5; // first overlap in substep 21 for all of them
  for (let j = 0; j < k; j++) {
    const idx = 2 * j;
    if (layout === 'parallel') {
      const y = OFFSETS[k - 1][j];
      const reach = Math.sqrt(1.05 * 1.05 - dz * dz - y * y);
      putTerrier(s, idx, -reach - lead, y, z);
      s.terriers[idx].vx = speed;
    } else {
      const a = (180 + CENTRE_DEG[k - 1][j]) * Math.PI / 180; // rendering-style maths is fine in a check
      const reach = Math.sqrt(1.05 * 1.05 - dz * dz);
      putTerrier(s, idx, (reach + lead) * Math.cos(a), (reach + lead) * Math.sin(a), z);
      s.terriers[idx].vx = -speed * Math.cos(a);
      s.terriers[idx].vy = -speed * Math.sin(a);
    }
  }
  // The switches really are off in the simulation this run uses.
  const sw = { drive: sim.C.drive, friction: sim.C.friction, rolling: sim.C.rolling, gravity: sim.C.gravity };
  const z0 = [s.ball.z, ...s.terriers.map((t) => t.z)];
  const e0 = ke(s, C); const m0 = e0; const p0 = mom(s, C);
  let worstKe = -Infinity, worstMech = -Infinity, keRises = 0, mechRises = 0, maxRise = 0, lastKe = e0, lastMech = m0, firstContactSub = -1, sub = 0, drivenSubsteps = 0;
  sim.probe = (st) => {
    sub++;
    const e = ke(st, C); const m = e + pe(st, C, z0);
    worstKe = Math.max(worstKe, e - e0); worstMech = Math.max(worstMech, m - m0);
    if (e > lastKe + 1e-12) { keRises++; maxRise = Math.max(maxRise, e - lastKe); }
    if (m > lastMech + 1e-9) mechRises++;
    lastKe = e; lastMech = m;
    if (firstContactSub < 0 && st.ball.lastContactTick !== NEVER) firstContactSub = sub;
    for (const t of st.terriers) if (t.driveOn) drivenSubsteps++;
  };
  const ins = new Array(8).fill(0);
  for (let i = 0; i < 30; i++) step(sim, s, ins);
  const p1 = mom(s, C);
  return {
    k, where: level ? 'level' : 'from the floor', layout, floorInSolve, iterations, switches: sw, drivenSubsteps,
    firstContactSubstep: firstContactSub, keStart: e0, keEnd: ke(s, C), keWorstOverStart: worstKe, keRisesSubstepToSubstep: keRises, keLargestRise: maxRise,
    mechWorstOverStart: worstMech, mechRisesOver1e9: mechRises,
    dp: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ballSpeed: Math.hypot(s.ball.vx, s.ball.vy), ballVz: s.ball.vz,
  };
}
out.hits = [];
for (const floorInSolve of [true, false]) for (const level of [false, true]) for (const layout of ['parallel', 'centre']) for (let k = 1; k <= 4; k++) out.hits.push(hitRun({ k, level, layout, floorInSolve }));

// A fuzz of simultaneous multi-contact hits: no gravity, nothing driven,
// no slip-out, the ball in mid-air (no floor), 1 to 4 hitters at seeded
// directions and speeds arriving within a substep or two of each other.
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const fuzz = { runs: 0, substeps: 0, runsWithRise: 0, risesOver1e12: 0, largestRiseJ: 0, largestRelRise: 0, worstOverStartJ: -Infinity, examples: [] };
for (let run = 0; run < 3000; run++) {
  const k = 1 + Math.floor(rnd() * 4);
  const C = makeConfig({ drive: false, friction: false, rolling: false, gravity: 0, slipOut: SLIP_OUT_RULES.none });
  const sim = makeSim(C, 4);
  const s = newMatch(4, C, IN_PLAY);
  for (let j = 0; j < 8; j++) farAway(s, j);
  putBall(s, 0, 0, 3); s.ball.onFloor = false;
  const dirs = [];
  for (let j = 0; j < k; j++) {
    // a direction from the ball, clear of the others (centres > 0.6 m apart at contact)
    let u, tries = 0;
    do {
      const zc = rnd() * 1.6 - 0.8; const ph = rnd() * 2 * Math.PI; const rr = Math.sqrt(1 - zc * zc);
      u = [rr * Math.cos(ph), rr * Math.sin(ph), zc];
      tries++;
    } while (tries < 50 && dirs.some((w) => { const dx = 1.05 * (u[0] - w[0]), dy = 1.05 * (u[1] - w[1]), dz = 1.05 * (u[2] - w[2]); return dx * dx + dy * dy + dz * dz < 0.36; }));
    dirs.push(u);
    const sp = 1 + rnd() * 11;
    const lag = rnd() * 2; // substeps of travel beyond the common arrival
    const dist = 1.05 + sp * DT * (10.5 + lag);
    // aim: at the centre, or off it by up to 25°
    const off = (rnd() - 0.5) * 0.9;
    const t = s.terriers[2 * j];
    t.x = dist * u[0]; t.y = dist * u[1]; t.z = 3 + dist * u[2]; t.onFloor = false;
    const ax = -u[0] + off * u[1], ay = -u[1] - off * u[0], az = -u[2];
    const n = Math.hypot(ax, ay, az);
    t.vx = sp * ax / n; t.vy = sp * ay / n; t.vz = sp * az / n;
  }
  if (rnd() < 0.3) { s.ball.vx = (rnd() - 0.5) * 4; s.ball.vy = (rnd() - 0.5) * 4; s.ball.vz = (rnd() - 0.5) * 4; }
  const e0 = ke(s, C); let last = e0; let rose = false; let worst = -Infinity;
  sim.probe = (st) => {
    fuzz.substeps++;
    const e = ke(st, C);
    worst = Math.max(worst, e - e0);
    if (e > last * (1 + 1e-14) + 1e-12) { fuzz.risesOver1e12++; rose = true; fuzz.largestRiseJ = Math.max(fuzz.largestRiseJ, e - last); fuzz.largestRelRise = Math.max(fuzz.largestRelRise, (e - last) / last); }
    last = e;
  };
  const ins = new Array(8).fill(0);
  for (let i = 0; i < 12; i++) step(sim, s, ins);
  fuzz.runs++;
  fuzz.worstOverStartJ = Math.max(fuzz.worstOverStartJ, worst);
  if (rose) { fuzz.runsWithRise++; if (fuzz.examples.length < 5) fuzz.examples.push({ run, k, e0, worst }); }
}
out.hitFuzz = fuzz;

// ------------------------------------------------------------------ 3. P8
// Every own key of every terrier, the ball and the match header, compared
// by value with its mirror: x, y, vx, vy, targetVx, targetVy negated;
// heading, overheadRef and (once pushed) lastPushDir a half turn on;
// slipFrom the mirror body; prevInput the mirrored input; pack and coat
// skipped (they differ by construction); every other key equal. The ball's
// x, y, vx, vy must be their own negation; score symmetric. Also counts
// ±0 differences (allowed by value) and checks after every tick as well as
// every substep, so the animation fields of the last tick are covered.
const NEG = new Set(['x', 'y', 'vx', 'vy', 'targetVx', 'targetVy']);
const ANG = new Set(['heading', 'overheadRef']);
const HALF = 2147483648;
let valuesCompared = 0; let signedZeroDiffs = 0;
function mirrorCheck(s) {
  const bad = [];
  const b = s.ball;
  for (const f of ['x', 'y', 'vx', 'vy']) { valuesCompared++; if (b[f] !== -b[f]) bad.push(`ball.${f}=${b[f]}`); }
  valuesCompared++; if (s.score[0] !== s.score[1]) bad.push('score');
  const n = s.terriers.length;
  for (let k = 0; k < n; k += 2) {
    const A = s.terriers[k], B = s.terriers[k + 1];
    for (const key of Object.keys(A)) {
      if (key === 'pack' || key === 'coat') continue;
      let want = A[key];
      if (NEG.has(key)) want = -A[key];
      else if (ANG.has(key)) want = (A[key] + HALF) >>> 0;
      else if (key === 'lastPushDir') want = A.lastPushTick === NEVER ? B.lastPushDir : (A.lastPushDir + HALF) >>> 0;
      else if (key === 'slipFrom') want = A.slipFrom < 0 || A.slipFrom === n ? A.slipFrom : A.slipFrom ^ 1;
      else if (key === 'prevInput') want = mirrorInput(A.prevInput);
      valuesCompared++;
      if (want !== B[key]) bad.push(`spot ${k >> 1} ${key}: B=${B[key]} want ${want}`);
      else if (typeof want === 'number' && !Object.is(want, B[key])) signedZeroDiffs++;
    }
    if (A.pack !== 0 || B.pack !== 1 || A.spot !== B.spot) bad.push(`pairing at ${k}`);
  }
  return bad;
}
function mirroredRun(spec, tag) {
  const C = scriptConfig(spec);
  const sim = makeSim(C, spec.packSize);
  const s = scriptStart(spec, C);
  let substeps = 0, mism = 0, first = null, tickMism = 0;
  const startBad = mirrorCheck(s);
  sim.probe = (st) => { substeps++; const bad = mirrorCheck(st); if (bad.length) { mism++; first ??= `tick ${st.tick + 1} sub ${substeps}: ${bad[0]}`; } };
  const inputs = [];
  let maxBallZ = 0;
  for (let t = 1; t <= spec.ticks; t++) {
    step(sim, s, scriptInputs(spec, t, inputs));
    maxBallZ = Math.max(maxBallZ, s.ball.z);
    const bad = mirrorCheck(s); if (bad.length) { tickMism++; first ??= `end of tick ${t}: ${bad[0]}`; }
  }
  const st = sim.physics.stats;
  return { set: tag, script: spec.name, packSize: spec.packSize, pitch: spec.pitch, slipOut: spec.slipOut, ticks: spec.ticks, substeps, startMismatches: startBad.length, substepsMismatched: mism, ticksMismatched: tickMism, first, contactsPerSubstep: +(st.contacts / st.substeps).toFixed(3), nonFloorPerSubstep: +((st.contacts - st.floorContacts) / st.substeps).toFixed(3), slipOuts: st.slipOuts, ballApexAboveRest: +(maxBallZ - 0.8).toFixed(3) };
}
const kick = (p, pitch, sd, rule, frames, ticks) => ({ name: `verify kickoff ${p}, ${pitch}, ${rule}, ${frames}`, packSize: p, pitch, slipOut: rule, ticks, start: 'countdown', mirrored: true, input: chasey(sd, frames) });
const p8 = [];
for (const pitch of ['main', 'second']) for (let p = 1; p <= 4; p++) p8.push(mirroredRun(kick(p, pitch, 40 + p, 'drafted', 'all', 2400), 'mirror.test.ts kickoffs'));
for (const spec of GOLDEN_SCRIPTS.filter((x) => x.mirrored)) p8.push(mirroredRun(spec, 'golden mirrored'));
// New seeds, M0's pick, both frames sets, both shapes, longer.
for (const pitch of ['main', 'second']) for (let p = 1; p <= 4; p++) for (const frames of ['all', 'contact']) p8.push(mirroredRun(kick(p, pitch, 500 + 10 * p + (frames === 'all' ? 1 : 2), 'flag42', frames, 3600), 'new seeds, 42+flag'));
for (let p = 1; p <= 4; p++) for (const z of [false, true]) for (const rule of ['flag42', 'flag42E0']) p8.push(mirroredRun({ ...pinch(p, rule, z), ticks: 1800 }, 'pinches'));
out.p8 = { runs: p8.length, substeps: p8.reduce((a, r) => a + r.substeps, 0), valuesCompared, signedZeroDiffsAllowedByValue: signedZeroDiffs, substepsMismatched: p8.reduce((a, r) => a + r.substepsMismatched, 0), ticksMismatched: p8.reduce((a, r) => a + r.ticksMismatched, 0), slipOuts: p8.reduce((a, r) => a + r.slipOuts, 0), perRun: p8 };

out.seconds = +((performance.now() - t0) / 1000).toFixed(1);
out.node = process.version;
writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
// Summary
for (const r of out.bitStill) console.log(`bit-still ${r.name}: ${r.ticksDiffering} of ${r.ticks} ticks differ (first ${r.firstDifferingTick}); moved: ${r.fieldsThatMoved.join(',') || 'none'}; stamps: ${r.stampFieldsThatMoved.join(',') || 'none'}; max dev ${r.maxAbsBodyDeviation}`);
const h = out.hits;
console.log(`hits: ${h.length} runs; switches off in all: ${h.every((x) => !x.switches.drive && !x.switches.friction && !x.switches.rolling)}; driven substeps ${h.reduce((a, x) => a + x.drivenSubsteps, 0)}; worst KE over start ${Math.max(...h.map((x) => x.keWorstOverStart))}; KE rises (level) ${h.filter((x) => x.where === 'level').reduce((a, x) => a + x.keRisesSubstepToSubstep, 0)}; worst mech over start (floor) ${Math.max(...h.filter((x) => x.where !== 'level').map((x) => x.mechWorstOverStart))}; mech rises ${h.reduce((a, x) => a + x.mechRisesOver1e9, 0)}; max dp ${Math.max(...h.map((x) => x.dp))}; first contact substeps ${[...new Set(h.map((x) => x.firstContactSubstep))].join(',')}`);
for (const where of ['from the floor', 'level']) for (const layout of ['parallel', 'centre']) console.log(`  ${where} ${layout} (floor in solve): ${h.filter((x) => x.floorInSolve && x.where === where && x.layout === layout).map((x) => x.ballSpeed.toFixed(3)).join(', ')}`);
console.log(`hit fuzz: ${fuzz.runs} runs, ${fuzz.substeps} substeps, runs with a KE rise ${fuzz.runsWithRise}, rises ${fuzz.risesOver1e12}, largest rise ${fuzz.largestRiseJ} J (rel ${fuzz.largestRelRise}), worst over start ${fuzz.worstOverStartJ}`);
console.log(`P8: ${out.p8.runs} runs, ${out.p8.substeps} substeps, ${out.p8.valuesCompared} values, mismatched substeps ${out.p8.substepsMismatched}, ticks ${out.p8.ticksMismatched}, ±0 diffs ${out.p8.signedZeroDiffsAllowedByValue}, slip-outs ${out.p8.slipOuts}`);
for (const r of p8) if (r.substepsMismatched || r.ticksMismatched || r.startMismatches) console.log('  MISMATCH', r.script, r.first);
console.log(`(${out.seconds} s)`);
