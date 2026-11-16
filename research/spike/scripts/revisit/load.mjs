// The load each of the cost revisit's timing runs ran under, as
// scripts/m0-run.mjs records a whole command's, but per run:
// - waitForLoad: before a run, wait while the 1-minute load average is over
//   the limit (4), rechecking every 15 s for up to 20 minutes, and keep
//   `uptime` and every check;
// - cpuSampler: during a run, the CPU in use every 2 s, from /proc, split
//   between this process's tree (the driver and the browser it launched)
//   and every other process, so a run can show its load was its own.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';

export const LOAD_LIMIT = 4;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function uptime() {
  try {
    return execFileSync('uptime', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function load() {
  const [l1, l5, l15] = loadavg();
  return { utc: new Date().toISOString(), l1: +l1.toFixed(2), l5: +l5.toFixed(2), l15: +l15.toFixed(2) };
}

/** Waits until the 1-minute load is at most `limit`, or `maxMinutes` pass. */
export async function waitForLoad({ limit = LOAD_LIMIT, maxMinutes = 20, every = 15_000, log = () => {} } = {}) {
  const t0 = Date.now();
  const checks = [];
  for (;;) {
    const s = { ...load(), uptime: uptime() };
    checks.push(s);
    if (s.l1 <= limit) return { ok: true, waitedS: +((Date.now() - t0) / 1000).toFixed(1), before: s, checks: checks.length };
    if (Date.now() - t0 >= maxMinutes * 60_000) return { ok: false, waitedS: +((Date.now() - t0) / 1000).toFixed(1), before: s, checks: checks.length };
    log(`1-minute load ${s.l1} > ${limit}; rechecking in ${every / 1000} s`);
    await sleep(every);
  }
}

function cpuTotals() {
  const f = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = (f[3] ?? 0) + (f[4] ?? 0);
  return { busy: f.slice(0, 8).reduce((a, b) => a + b, 0) - idle, total: f.slice(0, 8).reduce((a, b) => a + b, 0) };
}

function processes() {
  const out = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = readFileSync(`/proc/${d}/stat`, 'utf8');
      const close = s.lastIndexOf(')');
      const rest = s.slice(close + 2).split(' ');
      out.set(Number(d), { ppid: Number(rest[1]), comm: s.slice(s.indexOf('(') + 1, close), cpu: Number(rest[11]) + Number(rest[12]) });
    } catch {
      // gone between readdir and read
    }
  }
  return out;
}

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

/** Samples the CPU in use every 2 s until stopped; returns the means, in cores. */
export function cpuSampler(rootPid = process.pid) {
  let lastTotals = cpuTotals();
  let lastProcs = processes();
  const samples = [];
  const timer = setInterval(() => {
    const totals = cpuTotals();
    const procs = processes();
    const span = (totals.total - lastTotals.total) / cpus().length;
    const tree = subtree(procs, rootPid);
    let run = 0;
    let other = 0;
    for (const [pid, p] of procs) {
      const before = lastProcs.get(pid);
      const d = before && before.comm === p.comm ? p.cpu - before.cpu : p.cpu;
      if (d <= 0) continue;
      if (tree.has(pid)) run += d;
      else other += d;
    }
    if (span > 0) samples.push({ busy: (totals.busy - lastTotals.busy) / span, run: run / span, other: other / span, l1: +loadavg()[0].toFixed(2) });
    lastTotals = totals;
    lastProcs = procs;
  }, 2000);
  return () => {
    clearInterval(timer);
    const mean = (k) => (samples.length ? +(samples.reduce((a, s) => a + s[k], 0) / samples.length).toFixed(2) : null);
    return {
      samples: samples.length, busyCoresMean: mean('busy'), runCoresMean: mean('run'), otherCoresMean: mean('other'),
      otherCoresMax: samples.length ? +Math.max(...samples.map((s) => s.other)).toFixed(2) : null,
      load1mMax: samples.length ? Math.max(...samples.map((s) => s.l1)) : null,
    };
  };
}
