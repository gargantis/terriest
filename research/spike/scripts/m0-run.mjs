// Runs one of M0's runs (PLAN §17 M0) and records the conditions it ran
// under: the command, its start and end (UTC), wall time, exit code, and the
// machine's load average from `uptime` before it, sampled every 2 s during
// it and after it. With --wait-load N, it first waits, rechecking every 30 s
// for up to --max-wait-min minutes (default 20), until the 1-minute load
// average is at most N, as the timing runs require; the waits are recorded
// too. Output is shown and kept in results/tmp/<name>.log (not tracked);
// the record is appended to results/runs-log.json.
//
//   node scripts/m0-run.mjs --name <name> [--wait-load 4] [--max-wait-min 20] [--results a.json,b.json] -- <command…>
//
// --results names the files the run writes, for the record.
//
// The command runs in this folder through bash, so `npm run build && …`
// works. The load average counts this run's own processes too, so each
// sample also splits the CPU in use (from /proc) between this run's process
// tree and every other process, naming the busiest others by process name:
// that, and the load taken before the run, say whether other work ran.
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dash = args.indexOf('--');
if (dash < 0 || dash === args.length - 1) throw new Error('usage: node scripts/m0-run.mjs --name <name> [--wait-load N] [--max-wait-min M] -- <command…>');
const opts = args.slice(0, dash);
const command = args.slice(dash + 1).join(' ');
const value = (flag) => {
  const i = opts.indexOf(flag);
  return i >= 0 ? opts[i + 1] : undefined;
};
const name = value('--name');
if (!name || !/^[\w.-]+$/.test(name)) throw new Error('--name must be a plain word');
const waitLoad = value('--wait-load') === undefined ? null : Number(value('--wait-load'));
const resultFiles = (value('--results') ?? '').split(',').filter(Boolean);
const maxWaitMin = Number(value('--max-wait-min') ?? 20);

const sample = () => {
  const [l1, l5, l15] = loadavg();
  return { utc: new Date().toISOString(), l1: +l1.toFixed(2), l5: +l5.toFixed(2), l15: +l15.toFixed(2) };
};
const uptime = () => {
  try {
    return execFileSync('uptime', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Busy and total clock ticks over all CPUs, from /proc/stat. */
function cpuTotals() {
  const f = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = (f[3] ?? 0) + (f[4] ?? 0); // idle + iowait
  const total = f.slice(0, 8).reduce((a, b) => a + b, 0); // user … steal
  return { busy: total - idle, total };
}

/** Every process's parent, name and CPU time (utime + stime, all threads), in clock ticks. */
function processes() {
  const out = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = readFileSync(`/proc/${d}/stat`, 'utf8');
      const close = s.lastIndexOf(')');
      const comm = s.slice(s.indexOf('(') + 1, close);
      const rest = s.slice(close + 2).split(' ');
      out.set(Number(d), { ppid: Number(rest[1]), comm, cpu: Number(rest[11]) + Number(rest[12]) });
    } catch {
      // gone between readdir and read
    }
  }
  return out;
}

/** The pids under root, root included, by the parent links. */
function subtree(procs, root) {
  const kids = new Map();
  for (const [pid, p] of procs) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(pid);
  }
  const seen = new Set([root]);
  const todo = [root];
  while (todo.length) for (const k of kids.get(todo.pop()) ?? []) if (!seen.has(k)) { seen.add(k); todo.push(k); }
  return seen;
}

/** A process's name as recorded: only common tools' names are kept, anything else is 'other'. */
const GENERIC = /^(chrome|chrome_crashpad_handler|headless_shell|firefox|Web Content|WebKit\w*|MiniBrowser|node|MainThread|npm|npx|bash|sh|vite|esbuild|Xwayland|weston|systemd(-\w+)?|kworker\/.*|ksoftirqd\/.*|rcu_\w+|dbus-daemon|copilot-runtime)$/;
const label = (comm) => (GENERIC.test(comm) ? comm : 'other');

/** CPU in use since the last call, in cores: all of it, this run's tree's, and the busiest other processes'. */
function cpuSplitter(rootPid) {
  let lastTotals = cpuTotals();
  let lastProcs = processes();
  return () => {
    const totals = cpuTotals();
    const procs = processes();
    const cores = cpus().length;
    const span = (totals.total - lastTotals.total) / cores; // clock ticks per core in the interval
    const busy = totals.busy - lastTotals.busy;
    const tree = subtree(procs, rootPid);
    let run = 0;
    const others = new Map();
    for (const [pid, p] of procs) {
      // A process new since the last sample spent all its CPU time within the interval.
      const before = lastProcs.get(pid);
      const d = before && before.comm === p.comm ? p.cpu - before.cpu : p.cpu;
      if (d <= 0) continue;
      if (tree.has(pid) || pid === process.pid) run += d;
      else others.set(label(p.comm), (others.get(label(p.comm)) ?? 0) + d);
    }
    lastTotals = totals;
    lastProcs = procs;
    if (span <= 0) return null;
    const otherTotal = [...others.values()].reduce((a, b) => a + b, 0);
    const top = [...others.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([comm, d]) => ({ comm, cores: +(d / span).toFixed(2) }));
    return {
      busyCores: +(busy / span).toFixed(2), runCores: +(run / span).toFixed(2), otherCores: +(otherTotal / span).toFixed(2), topOthers: top,
    };
  };
}

const waits = [];
if (waitLoad !== null) {
  const until = Date.now() + maxWaitMin * 60_000;
  for (;;) {
    const s = { ...sample(), uptime: uptime() };
    waits.push(s);
    if (s.l1 <= waitLoad) break;
    if (Date.now() >= until) {
      console.error(`m0-run: the 1-minute load is still ${s.l1} after ${maxWaitMin} minutes; running anyway, and recording it`);
      break;
    }
    console.error(`m0-run: 1-minute load ${s.l1} > ${waitLoad}; rechecking in 30 s`);
    await sleep(30_000);
  }
}

mkdirSync(join(root, 'results', 'tmp'), { recursive: true });
const logPath = join(root, 'results', 'tmp', `${name}.log`);
const log = createWriteStream(logPath);
const before = { ...sample(), uptime: uptime() };
const samples = [];
const t0 = Date.now();
const child = spawn('bash', ['-c', command], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const split = cpuSplitter(child.pid);
const timer = setInterval(() => samples.push({ ...sample(), ...(split() ?? {}) }), 2000);
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (d) => {
    log.write(d);
    (stream === child.stdout ? process.stdout : process.stderr).write(d);
  });
}
const exitCode = await new Promise((done) => child.on('close', (code, signal) => done(code ?? (signal ? `signal ${signal}` : null))));
clearInterval(timer);
const wallSeconds = (Date.now() - t0) / 1000;
const after = { ...sample(), uptime: uptime() };
await new Promise((done) => log.end(done));

const all = [before, ...samples, after];
const split2 = samples.filter((s) => s.otherCores !== undefined);
const mean = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null);
const othersByName = new Map();
for (const s of split2) for (const t of s.topOthers) othersByName.set(t.comm, (othersByName.get(t.comm) ?? 0) + t.cores);
const record = {
  name, command, cwd: 'research/spike', utcStart: before.utc, utcEnd: after.utc, wallSeconds: +wallSeconds.toFixed(1), exitCode,
  cpus: cpus().length, cpu: cpus()[0]?.model ?? '',
  load: {
    waitLimit1m: waitLoad, waits,
    before, after,
    during: {
      samples: samples.length, max1m: Math.max(...all.map((s) => s.l1)), mean1m: +(all.reduce((a, s) => a + s.l1, 0) / all.length).toFixed(2),
      // CPU in use, in cores, averaged over the 2 s samples: all, this run's process tree's, and every other process's.
      cpuCores: split2.length ? {
        busyMean: mean(split2.map((s) => s.busyCores)), runMean: mean(split2.map((s) => s.runCores)),
        otherMean: mean(split2.map((s) => s.otherCores)), otherMax: Math.max(...split2.map((s) => s.otherCores)),
        busiestOthers: [...othersByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([comm, sum]) => ({ comm, meanCores: +(sum / split2.length).toFixed(2) })),
      } : null,
    },
    samples,
  },
  log: `results/tmp/${name}.log`,
  results: resultFiles,
};
const out = join(root, 'results', 'runs-log.json');
const runs = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')).runs : [];
runs.push(record);
writeFileSync(out, `${JSON.stringify({ about: 'M0 runs as measured, each with the load average it ran under (scripts/m0-run.mjs)', runs }, null, 1)}\n`);
const c = record.load.during.cpuCores;
console.error(`m0-run: ${name} exited ${exitCode} after ${record.wallSeconds} s; load before ${before.l1}, most during ${record.load.during.max1m}, after ${after.l1}${c ? `; cores in use ${c.busyMean} (this run ${c.runMean}, others ${c.otherMean}, at most ${c.otherMax})` : ''}`);
process.exit(typeof exitCode === 'number' ? exitCode : 1);
