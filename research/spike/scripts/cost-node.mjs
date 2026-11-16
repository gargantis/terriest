// Run 3's tick cost in Node (PLAN §17 M0), for comparison with Chromium:
// the same harness as the page's ?test=cost mode (src/cost.ts), on the same
// scripts, timed by performance.now() (sub-microsecond in Node). Node 22
// strips the harness's types itself, so nothing is bundled or transformed.
// e2e/cost.spec.ts runs this beside the browser runs. Two modes, as the page
// has two:
// - tight: every unit of work back to back, as the page's draw=0;
// - paced: one unit per 60 Hz tick of the clock, caught up on an 8 ms timer,
//   as the page's draw=1 is paced (with nothing drawn here). On this machine
//   a paced tick costs about twice a back-to-back one: the CPU idles between
//   ticks, so the work meets a slower clock and colder caches.
//
//   node scripts/cost-node.mjs [--mode tight|paced|both] [--script "scrum at the wall, flag42"]
//     [--ticks 1200] [--runs 30] [--json out.json]
// With no --script, both of src/cost.ts's COST_SCRIPTS run; the default mode
// is both. One JSON object is printed on stdout.
import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { clockResolution, COST_SCRIPTS, CostRun, DEFAULT_COST } from '../src/cost.ts';

const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const scripts = value('--script') ? [value('--script')] : COST_SCRIPTS;
const mode = value('--mode') ?? 'both';
const modes = mode === 'both' ? ['tight', 'paced'] : [mode];
if (!modes.every((m) => m === 'tight' || m === 'paced')) throw new Error(`--mode is tight, paced or both, not ${mode}`);
const ticks = Number(value('--ticks') ?? DEFAULT_COST.ticks);
const burstRuns = Number(value('--runs') ?? DEFAULT_COST.burstRuns);
const now = () => performance.now();

/** One unit of work per 60 Hz tick of the clock, as a page's timeline is paced. */
function paced(run) {
  return new Promise((done) => {
    const t0 = now();
    let units = 0;
    const timer = setInterval(() => {
      const due = Math.floor(((now() - t0) * 60) / 1000);
      while (units < due) {
        units++;
        if (!run.step(now)) {
          clearInterval(timer);
          done(undefined);
          return;
        }
      }
    }, 8);
  });
}

const runs = [];
for (const m of modes) {
  for (const script of scripts) {
    const run = new CostRun({ script, ticks, burstRuns });
    const t0 = now();
    if (m === 'tight') while (run.step(now));
    else await paced(run);
    runs.push({ engine: 'node', mode: m, wallMs: now() - t0, report: run.report() });
  }
}
const out = {
  engine: 'node',
  node: process.version,
  v8: process.versions.v8,
  cpu: cpus()[0]?.model ?? '',
  cpus: cpus().length,
  clockResolutionMs: clockResolution(now),
  runs,
};
const json = `${JSON.stringify(out, null, 1)}\n`;
const to = value('--json');
if (to) await writeFile(resolve(to), json);
process.stdout.write(json);
