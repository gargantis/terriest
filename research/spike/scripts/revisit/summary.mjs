// M0's cost revisit (PLAN §17 M0's stop rule; REPORT.md §4): one table of
// every solver variant measured, from results/revisit/: behaviour-*.json
// (scripts/revisit/behaviour.mjs), cost-*.json (scripts/revisit/cost.mjs),
// settle-*.json (scripts/revisit/settle.mjs) and conditions-*.json
// (scripts/stop-rule.mjs --measured-only), and the adoption rule applied to it:
// - a variant qualifies when its behaviour run qualifies (no §16 behaviour
//   test fails, and 42° with the flag passes all four slip-out cases on the
//   full sweep) and every drawn run's p95 on the plan's script, at both
//   sizes, is at most 4 ms (the stop rule fires above 4 ms);
// - of those, the cheapest is adopted: the lowest median, over its
//   back-to-back runs at both sizes, of the mean 13-step tick, the reading
//   least disturbed by drawing; if none qualifies, the settings stay.
// The cost batches named with --decide (default: every batch but
// 'adopted') decide; the others are reported beside them.
//
//   node scripts/revisit/summary.mjs [--decide singles,combos]  -> results/revisit/summary.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../results/revisit/', import.meta.url));
const read = (f) => JSON.parse(readFileSync(`${dir}${f}`, 'utf8'));
const args = process.argv.slice(2);
const decideArg = args.includes('--decide') ? args[args.indexOf('--decide') + 1].split(',') : null;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(3);
};
const range = (xs) => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null);

const behaviour = Object.fromEntries(readdirSync(dir).filter((f) => /^behaviour-.*\.json$/.test(f)).map((f) => {
  const b = read(f);
  return [b.label, b];
}));
const batches = readdirSync(dir).filter((f) => /^cost-.*\.json$/.test(f)).map((f) => ({ file: f, ...read(f) }));
const settle = Object.fromEntries(readdirSync(dir).filter((f) => /^settle-.*\.json$/.test(f)).map((f) => {
  const x = read(f);
  return [x.label, x.rows.map((r) => ({ scene: r.scene, atRest: r.atRest, lastTickThatChanged: r.lastTickThatChanged, testSettleTicks: r.testSettleTicks, period: r.periodFromTick1000, ...r.last1000Ticks }))];
}));
// scripts/stop-rule.mjs --measured-only under each variant: its three conditions, with counts.
const conditions = Object.fromEntries(readdirSync(dir).filter((f) => /^conditions-.*\.json$/.test(f)).map((f) => {
  const x = read(f);
  const m = x.measured;
  return [`i${x.solver.iterations} p${x.solver.positionPasses} ${x.solver.floorInSolve ? 'floor' : 'nofloor'} s${x.solver.substeps}`, {
    file: `results/revisit/${f}`, verdicts: Object.fromEntries(x.conditions.map((c) => [c.condition, c.verdict])),
    bitStill: m.bitStill.map((r) => ({ scene: r.scene, ticksDiffering: r.ticksDiffering, of: r.ticks, maxAbsDeviation: r.maxAbsDeviation })),
    energy: { hits: m.hits.length, worstKineticGainJ: Math.max(...m.hits.map((h) => h.kineticWorstOverStartJ)), worstMechanicalGainJ: Math.max(...m.hits.map((h) => h.mechanicalWorstOverStartJ)), worstMomentumChange: Math.max(...m.hits.map((h) => h.momentumChange)) },
    mirror: { runs: m.mirror.runs, substeps: m.mirror.substeps, substepsMismatched: m.mirror.substepsMismatched },
  }];
}));
const deciding = batches.filter((b) => (decideArg ? decideArg.includes(b.name) : b.name !== 'adopted'));
const labels = [...new Set([...Object.keys(behaviour), ...batches.flatMap((b) => b.runs.map((r) => r.label))])];

function costOf(runs) {
  const p95 = (device, mode) => runs.filter((r) => r.device === device && r.mode === mode).map((r) => r.tick.p95);
  const drawn = runs.filter((r) => r.mode === 'drawn');
  const tight = runs.filter((r) => r.mode === 'tight');
  // What drawing adds to the p95: each drawn run against the back-to-back run
  // of the same batch, repetition and size, run just after it.
  const added = drawn.map((d) => {
    const t = tight.find((x) => x.batch === d.batch && x.rep === d.rep && x.device === d.device);
    return t ? +(d.tick.p95 - t.tick.p95).toFixed(3) : null;
  }).filter((x) => x !== null);
  return {
    runs: runs.length,
    drawingAddsToP95: { range: range(added), median: median(added), pairs: added.length },
    drawnP95: { desktop: p95('desktop', 'drawn'), 'Pixel 8a': p95('Pixel 8a', 'drawn') },
    tightP95: { desktop: p95('desktop', 'tight'), 'Pixel 8a': p95('Pixel 8a', 'tight') },
    drawnP95Range: range(drawn.map((r) => r.tick.p95)), drawnP95Median: median(drawn.map((r) => r.tick.p95)),
    drawnOver4: drawn.filter((r) => r.tick.p95 > 4).length, drawnRuns: drawn.length,
    tightP95Range: range(tight.map((r) => r.tick.p95)), tightP95Median: median(tight.map((r) => r.tick.p95)),
    drawnMeanRange: range(drawn.map((r) => r.tick.mean)),
    tightMeanRange: range(tight.map((r) => r.tick.mean)), tightMeanMedian: median(tight.map((r) => r.tick.mean)),
    tightStepUsRange: range(tight.map((r) => r.stepUsMean)), tightStepUsMedian: median(tight.map((r) => r.stepUsMean)),
    contactsPerSubstep: range(runs.map((r) => r.contacts.perSubstep)), floorPerSubstep: range(runs.map((r) => r.contacts.floorPerSubstep)),
    maxInSubstep: range(runs.map((r) => r.contacts.maxInSubstep)),
    burstMaxMs: Object.fromEntries([30, 42, 270].map((s) => [s, range(runs.map((r) => r.bursts.find((b) => b.steps === s).maxMs))])),
    burstMedianMs: Object.fromEntries([30, 42, 270].map((s) => [s, range(runs.map((r) => r.bursts.find((b) => b.steps === s).medianMs))])),
    bursts270Over50: runs.reduce((a, r) => a + r.bursts.find((b) => b.steps === 270).over50, 0),
    load1mBefore: range(runs.map((r) => r.load.before.l1)), otherCoresMean: range(runs.map((r) => r.cpu.otherCoresMean ?? 0)),
    runsWithProblems: runs.filter((r) => r.problems.length > 0).length, runsOverLoadLimit: runs.filter((r) => !r.load.gateOk).length,
  };
}

const rows = labels.map((label) => {
  const b = behaviour[label];
  const mine = (bs) => bs.flatMap((x) => x.runs.filter((r) => r.label === label && r.problems.length === 0).map((r) => ({ ...r, batch: x.name })));
  const own = b?.settings.floorInSolve;
  const hits = b?.measure?.hits?.filter((h) => h.floorInSolve === own) ?? null;
  const pushes = b?.measure?.pushes?.filter((p) => p.floorInSolve === own) ?? null;
  return {
    label, name: b?.name ?? batches.flatMap((x) => x.runs).find((r) => r.label === label)?.name, settings: b?.settings ?? null,
    behaviour: b ? {
      file: `results/revisit/behaviour-${b.name}.json`, qualifies: b.verdict.qualifies, allTestsGreen: b.verdict.allTestsGreen,
      tests: b.vitest.tests, behaviourFailures: b.vitest.failed.filter((t) => t.kind === '§16 behaviour').map((t) => `${t.title}: ${t.failure ?? ''}`),
      pinnedRecordFailures: b.vitest.failed.filter((t) => t.kind !== '§16 behaviour').map((t) => `${t.title} [${t.kind}]`),
      settle: settle[label] ?? null,
      conditions: conditions[label] ?? null,
      pick: b.measure?.pick ?? null, passingAll: b.measure?.passingAll ?? null,
      hitsSpeeds: hits?.map((h) => ({ where: h.where, layout: h.layout, speeds: h.speeds, worstEnergyGain: h.worstEnergyGain, worstMomentumChange: h.worstMomentumChange })) ?? null,
      pushSeconds: pushes ? Object.fromEntries(pushes.map((p) => [p.name, p.seconds])) : null,
      dribbleHopDeg: b.measure?.dribbleHop?.smallestDegFromVertical ?? null,
      nodeTick: b.measure?.tickCostNode?.find((t) => t.script === 'scrum at the wall, flag42') ?? null,
    } : null,
    cost: costOf(mine(deciding)),
    costOther: Object.fromEntries(batches.filter((x) => !deciding.includes(x)).map((x) => [x.name, costOf(mine([x]))]).filter(([, c]) => c.runs > 0)),
  };
});

const timed = rows.filter((r) => r.cost.drawnRuns > 0);
const enoughRuns = (c) => Object.values(c.drawnP95).every((xs) => xs.length >= 3) && Object.values(c.tightP95).every((xs) => xs.length >= 3);
const qualifying = timed.filter((r) => r.behaviour?.qualifies === true && r.cost.drawnOver4 === 0 && enoughRuns(r.cost));
const cheapest = [...qualifying].sort((a, b) => a.cost.tightMeanMedian - b.cost.tightMeanMedian)[0] ?? null;
const out = {
  about: "M0's cost revisit: every solver variant's behaviour and cost, and the adoption rule (scripts/revisit/summary.mjs)",
  utc: new Date().toISOString(),
  rule: 'qualifies: the behaviour run qualifies, and every drawn run p95 at most 4 ms, at least 3 runs at each size; adopt the qualifying variant with the lowest median back-to-back mean tick; none: keep the settings',
  decidingBatches: deciding.map((b) => b.name), otherBatches: batches.filter((b) => !deciding.includes(b)).map((b) => b.name),
  qualifying: qualifying.map((r) => r.label),
  adopt: cheapest ? { label: cheapest.label, name: cheapest.name, settings: cheapest.settings, tightMeanMedianMs: cheapest.cost.tightMeanMedian } : null,
  rows: rows.sort((a, b) => (a.cost.tightMeanMedian ?? 99) - (b.cost.tightMeanMedian ?? 99)),
};
writeFileSync(`${dir}summary.json`, `${JSON.stringify(out, null, 1)}\n`);
const f = (r) => (r ? r.map((x) => x.toFixed(3)).join('-') : '-');
for (const r of out.rows) {
  console.log(`${r.label.padEnd(20)} behaviour ${r.behaviour ? (r.behaviour.qualifies ? 'qualifies' : 'FAILS') : 'not run'}${r.behaviour && !r.behaviour.allTestsGreen && r.behaviour.qualifies ? ' (pinned records moved)' : ''}; ` +
    `drawn p95 ${f(r.cost.drawnP95Range)} ms, ${r.cost.drawnOver4} of ${r.cost.drawnRuns} over 4; back to back p95 ${f(r.cost.tightP95Range)}, mean median ${r.cost.tightMeanMedian ?? '-'} ms; step ${r.cost.tightStepUsMedian ?? '-'} µs`);
}
console.log(`qualifying: ${out.qualifying.join(', ') || 'none'}; adopt: ${out.adopt ? out.adopt.label : 'none, keep the settings'}`);
