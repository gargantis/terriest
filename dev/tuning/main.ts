// The tuning page (design §9, PLAN Q-10): the real simulation and the bot
// brain, stepped at the configuration's tick rate on an animation-frame
// accumulator, as roslambo's tuning page runs, with the scenarios, one
// keyboard terrier, a slider for every setting they read, the readouts,
// recordings and Copy settings. Dev only: `npm run dev` serves it at
// /dev/tuning.html, and vite.config.ts builds index.html alone. It touches
// no storage: its values ride in the URL fragment, written with
// location.replace, and a recording is a download.

import plan from '../../PLAN.md?raw';
import requirements from '../../REQUIREMENTS.md?raw';
import { config } from '../../src/config';
import { FRAME_BALL, FRAME_NOSE, FRAME_PITCH } from '../../src/core/sim/input';
import { type MatchState, NEVER } from '../../src/core/sim/state';
import { drawClose, drawPlan, drawSide, type ViewOptions } from './draw';
import { Keyboard } from './keyboard';
import {
  build, type Built, configSnippet, formatNumber, fragmentOf, GROUPS, NOT_TUNED, parseFragment, parseValue, sameValue, type Slider, SLIDERS,
  tableSnippet, takeEach, tryChanges, valueAt,
} from './model';
import { parseRecording, type Recorder, type Recording, replay, startRecording } from './recording';
import { labelOf, lapDrift, type Measure, recordingScenario, Run, type Scenario, SCENARIOS, scenarioOf, terrierByLabel } from './scenarios';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`the page has no #${id}`);
  return el as T;
};

const ui = {
  plan: $<HTMLCanvasElement>('plan'),
  side: $<HTMLCanvasElement>('side'),
  close: $<HTMLCanvasElement>('close'),
  readouts: $<HTMLPreElement>('readouts'),
  scenario: $<HTMLSelectElement>('scenario'),
  seed: $<HTMLInputElement>('seed'),
  keyboard: $<HTMLSelectElement>('keyboard'),
  frame: $<HTMLSelectElement>('frame'),
  pause: $<HTMLButtonElement>('pause'),
  step: $<HTMLButtonElement>('step'),
  speed: $<HTMLSelectElement>('speed'),
  reset: $<HTMLButtonElement>('reset'),
  normals: $<HTMLInputElement>('normals'),
  velocities: $<HTMLInputElement>('velocities'),
  record: $<HTMLButtonElement>('record'),
  stop: $<HTMLButtonElement>('stop'),
  download: $<HTMLAnchorElement>('download'),
  load: $<HTMLInputElement>('load'),
  status: $<HTMLParagraphElement>('status'),
  problems: $<HTMLUListElement>('problems'),
  copy: $<HTMLButtonElement>('copy'),
  defaults: $<HTMLButtonElement>('defaults'),
  snippet: $<HTMLTextAreaElement>('snippet'),
  sliders: $<HTMLDivElement>('sliders'),
  notTuned: $<HTMLUListElement>('not-tuned-list'),
};

const keyboard = new Keyboard();
keyboard.attach(window);

/** What the fragment holds, and what plays. */
const page = {
  changes: {} as Record<string, unknown>,
  built: build({}) as Built,
  scenario: SCENARIOS[0]! as Scenario,
  seed: 0,
  keyboard: '',
  frame: FRAME_BALL as number,
};
// Replaced by the fragment's scenario at the start, below.
let run = new Run(page.scenario, page.built.config, page.seed, () => performance.now());
let paused = false;
let speed = 1;
/** The keyboard's terrier, by ID, resolved from its label at each start,
 *  and C-47's drift while it holds sideways in ball view (design §9.3). */
let driveId: string | null = null;
let drift: Measure | null = null;
let recorder: Recorder | null = null;
let playback: { r: Recording; name: string } | null = null;
let reference = '';
/** Why the last change was refused, and what the fragment held that wasn't used. */
let refused: string[] = [];
let ignored: string[] = [];
const stepMs: number[] = [];
let written = '';

const PHASES = ['warm-up', 'the start countdown', 'a kickoff countdown', 'in play', 'a celebration', 'ended'];

// --- Starting and restarting ---

function restart(): void {
  const scenario = playback ? recordingScenario(playback.r, playback.name) : page.scenario;
  let next: Run;
  try {
    next = new Run(scenario, page.built.config, page.seed, () => performance.now());
  } catch (e) {
    refused = [`kept the last good scene: ${scenario.label} can't start under these settings: ${message(e)}`];
    showProblems();
    return;
  }
  stopRecording();
  run = next;
  stepMs.length = 0;
  try {
    reference = scenario.reference ? `the tests' figure here: ${scenario.reference(page.built.config)}` : '';
  } catch (e) {
    reference = `the tests' figure: ${message(e)}`;
  }
  fillKeyboard();
  driveId = null;
  resolveDrive();
  showProblems();
}

/** The keyboard selector's terriers: refilled at each start, and as a
 *  genesis match's JOINs arrive. */
function fillKeyboard(): void {
  ui.keyboard.replaceChildren(new Option('nobody', ''), ...run.s.terriers.map((T) => new Option(labelOf(T), labelOf(T))));
  ui.keyboard.value = page.keyboard;
}

/** The terrier the keyboard drives, by its label: found at each start, and
 *  each tick until it's there. Its press counters start from its previous
 *  input, so taking it over presses nothing (D-10). */
function resolveDrive(): void {
  const T = page.keyboard === '' || playback ? undefined : terrierByLabel(run.s, page.keyboard);
  const id = T?.id ?? null;
  if (id === driveId) return;
  driveId = id;
  drift = id === null ? null : lapDrift(id);
  if (T) keyboard.adopt(T.prevInput);
}

/** The scene restarts under page.changes, which build() has taken, and the
 *  fragment and the sliders follow them. */
function rerun(): void {
  refused = [];
  restart();
  writeFragment();
  syncSliders();
}

/** Settings changed on the page: taken if simParams, botParams and the
 *  kickoff spots' check take them, and the scene restarts; else the last
 *  good settings and scene stay, in the fragment, Copy settings and the
 *  sliders too, and the refused value shows only in the error (design
 *  §9.3). */
function changeSettings(next: Record<string, unknown>, what: string): void {
  const r = tryChanges(next);
  if ('refused' in r) {
    refuse(`${what}: ${r.refused}`);
    return;
  }
  page.changes = { ...r.changes };
  page.built = r.built;
  rerun();
}

function refuse(why: string): void {
  refused = [`kept the last good settings and scene, refusing ${why}`];
  showProblems();
  syncSliders();
}

/** The fragment's settings, each kept if build() takes it (model.ts's
 *  takeEach); those refused are dropped from the fragment, with why. */
function takeFragment(): void {
  const taken = takeEach(page.changes);
  page.changes = { ...taken.changes };
  page.built = taken.built;
  ignored.push(...taken.refused);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function showProblems(): void {
  const lines = [...refused, ...page.built.warnings.map((w) => `the gate's §7.4 checks would fail: ${w}`), ...ignored];
  ui.problems.replaceChildren(...lines.map((l) => Object.assign(document.createElement('li'), { textContent: l })));
}

// --- The fragment (design §9.4) ---

function writeFragment(): void {
  written = fragmentOf({ scenario: page.scenario.id, seed: page.seed, keyboard: page.keyboard, frame: page.frame, changes: page.changes });
  location.replace(`#${written}`);
}

function readFragment(): void {
  const { state, problems } = parseFragment(location.hash);
  ignored = problems;
  const sc = state.scenario === undefined ? undefined : scenarioOf(state.scenario);
  if (state.scenario !== undefined && !sc) ignored.push(`the fragment's scenario, ${state.scenario}, isn't one of the page's`);
  if (sc) page.scenario = sc;
  page.seed = state.seed ?? page.seed;
  page.keyboard = state.keyboard ?? (sc?.keyboard ? 'A1' : page.keyboard);
  page.frame = state.frame ?? page.frame;
  page.changes = { ...(state.changes ?? {}) };
  ui.scenario.value = page.scenario.id;
  ui.seed.value = String(page.seed);
  ui.frame.value = String(page.frame);
}

addEventListener('hashchange', () => {
  if (location.hash.slice(1) === written) return;
  playback = null;
  readFragment();
  takeFragment();
  rerun();
});

// --- The controls ---

function blurAfter(el: HTMLElement): void {
  // So W, A, S, D, Space and Shift reach the keyboard terrier, not the control.
  el.addEventListener('change', () => el.blur());
  el.addEventListener('click', () => {
    if (el instanceof HTMLButtonElement) el.blur();
  });
}

for (const group of [...new Set(SCENARIOS.map((s) => s.group))]) {
  const og = document.createElement('optgroup');
  og.label = group;
  for (const s of SCENARIOS.filter((x) => x.group === group)) og.append(new Option(s.label, s.id));
  ui.scenario.append(og);
}
ui.scenario.addEventListener('change', () => {
  const sc = scenarioOf(ui.scenario.value);
  if (!sc) return;
  playback = null;
  page.scenario = sc;
  page.keyboard = sc.keyboard ? 'A1' : '';
  rerun();
});
ui.seed.addEventListener('change', () => {
  const v = Number(ui.seed.value);
  page.seed = Number.isInteger(v) && v >= 0 ? v : 0;
  ui.seed.value = String(page.seed);
  rerun();
});
ui.keyboard.addEventListener('change', () => {
  page.keyboard = ui.keyboard.value;
  resolveDrive();
  writeFragment();
});
for (const [label, frame] of [['pitch', FRAME_PITCH], ['ball line', FRAME_BALL], ['nose', FRAME_NOSE]] as const) ui.frame.append(new Option(label, String(frame)));
ui.frame.addEventListener('change', () => {
  page.frame = Number(ui.frame.value);
  writeFragment();
});
ui.pause.addEventListener('click', () => setPaused(!paused));
ui.step.addEventListener('click', () => {
  setPaused(true);
  tick();
});
for (const v of [0.25, 0.5, 1, 2]) ui.speed.append(new Option(`×${v}`, String(v)));
ui.speed.value = '1';
ui.speed.addEventListener('change', () => {
  speed = Number(ui.speed.value);
});
ui.reset.addEventListener('click', () => {
  stopRecording();
  restart();
});
ui.record.addEventListener('click', () => {
  try {
    recorder = startRecording(run.s, run.config);
    ui.status.textContent = `Recording ${run.scenario.label} from tick ${run.s.tick}.`;
    ui.download.hidden = true;
  } catch (e) {
    ui.status.textContent = message(e);
  }
  syncButtons();
});
ui.stop.addEventListener('click', stopRecording);
ui.load.addEventListener('change', () => {
  const file = ui.load.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    try {
      const r = parseRecording(text);
      replay(r);
      stopRecording();
      playback = { r, name: file.name };
      ui.status.textContent = `${file.name}: ${r.ticks.length} ticks, which replay to its final hash, ${r.final}. Playing it under its own configuration.`;
      restart();
      setPaused(false);
    } catch (e) {
      ui.status.textContent = `${file.name} doesn't replay: ${message(e)}`;
    }
    ui.load.value = '';
  });
});
ui.copy.addEventListener('click', () => {
  const text = `${configSnippet(page.changes)}\n${tableSnippet(page.changes, { plan, requirements })}`;
  ui.snippet.value = text;
  ui.snippet.hidden = false;
  void navigator.clipboard?.writeText(text).then(
    () => (ui.status.textContent = 'Copied both snippets.'),
    () => (ui.status.textContent = "The clipboard refused them: they're in the box below."),
  );
});
ui.defaults.addEventListener('click', () => changeSettings({}, "src/config.ts's settings"));
for (const el of [ui.scenario, ui.seed, ui.keyboard, ui.frame, ui.pause, ui.step, ui.speed, ui.reset, ui.normals, ui.velocities, ui.record, ui.stop, ui.copy, ui.defaults]) blurAfter(el);

function setPaused(on: boolean): void {
  paused = on;
  ui.pause.textContent = on ? 'Resume' : 'Pause';
}

function syncButtons(): void {
  ui.record.disabled = recorder !== null;
  ui.stop.disabled = recorder === null;
}

/** Stops a recording, checks that it replays, and offers its download. */
function stopRecording(): void {
  if (!recorder) return;
  const r = recorder.stop(run.s);
  recorder = null;
  syncButtons();
  let verdict: string;
  try {
    replay(r);
    verdict = `replays to its final hash, ${r.final}`;
  } catch (e) {
    verdict = `doesn't replay: ${message(e)}`;
  }
  if (ui.download.href) URL.revokeObjectURL(ui.download.href);
  ui.download.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
  ui.download.download = `terriest-${run.scenario.id}-${r.ticks.length}-ticks.json`;
  ui.download.textContent = `Download the recording (${r.ticks.length} ticks)`;
  ui.download.hidden = false;
  ui.status.textContent = `Recorded ${r.ticks.length} ticks of ${run.scenario.label}: it ${verdict}.`;
}

// --- The sliders ---

const rows = new Map<string, { slider: Slider; sync: () => void }>();

function setChange(s: Slider, v: unknown): void {
  const next = { ...page.changes };
  if (sameValue(v, valueAt(config, s.key))) delete next[s.key];
  else next[s.key] = v;
  changeSettings(next, `${s.label} at ${formatValue(v)}`);
}

function take(s: Slider, text: string): void {
  const parsed = parseValue(s, text);
  if ('problem' in parsed) {
    // A number's problem quotes it; a JSON field's text is kept here, since its field is reset.
    refuse(s.kind === 'json' ? `${text} for ${parsed.problem}` : parsed.problem);
    return;
  }
  setChange(s, parsed.value);
}

const current = (s: Slider): unknown => (s.key in page.changes ? page.changes[s.key] : valueAt(config, s.key));

function sliderRow(s: Slider): HTMLElement {
  const row = document.createElement('div');
  row.className = 'slider';
  const name = document.createElement('label');
  name.textContent = s.label;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'reset';
  reset.textContent = '↺';
  reset.title = `Back to src/config.ts's ${formatValue(valueAt(config, s.key))}`;
  reset.addEventListener('click', () => {
    reset.blur();
    setChange(s, valueAt(config, s.key));
  });
  let sync: () => void;
  if (s.kind === 'switch') {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      box.blur();
      setChange(s, box.checked);
    });
    name.prepend(box);
    row.append(name, reset);
    sync = () => {
      box.checked = current(s) === true;
    };
  } else if (s.kind === 'json') {
    const text = document.createElement('input');
    text.type = 'text';
    text.spellcheck = false;
    text.addEventListener('change', () => take(s, text.value));
    row.append(name, reset, text);
    sync = () => {
      text.value = JSON.stringify(current(s));
    };
  } else {
    const rangeIn = document.createElement('input');
    rangeIn.type = 'range';
    const num = document.createElement('input');
    num.type = 'number';
    const on = document.createElement('input');
    on.type = 'checkbox';
    for (const el of [rangeIn, num]) {
      el.step = String(s.step);
      el.max = String(s.max);
    }
    rangeIn.addEventListener('input', () => take(s, rangeIn.value));
    rangeIn.addEventListener('change', () => rangeIn.blur());
    num.addEventListener('change', () => take(s, num.value));
    if (s.kind === 'assist') {
      // 0 is off; on, the cap starts at the zoomies speed (design §4.4).
      on.addEventListener('change', () => {
        on.blur();
        const zoomies = Number(valueAt(page.built.config, 'zoomiesSpeedMetresPerSecond'));
        setChange(s, on.checked ? Math.max(zoomies, Number(current(s)) || zoomies) : 0);
      });
      const onLabel = document.createElement('label');
      onLabel.append(on, ' on');
      row.append(name, reset, onLabel, rangeIn, num);
    } else {
      row.append(name, reset, rangeIn, num);
    }
    sync = () => {
      const v = Number(current(s));
      const min = s.kind === 'assist' ? Number(valueAt(page.built.config, 'zoomiesSpeedMetresPerSecond')) : s.min;
      rangeIn.min = String(min);
      num.min = s.kind === 'assist' ? '0' : String(s.min);
      rangeIn.value = String(v);
      num.value = formatNumber(v);
      on.checked = v !== 0;
      rangeIn.disabled = s.kind === 'assist' && v === 0;
    };
  }
  rows.set(s.key, {
    slider: s,
    sync: () => {
      sync();
      row.classList.toggle('changed', s.key in page.changes);
      reset.hidden = !(s.key in page.changes);
    },
  });
  return row;
}

function formatValue(v: unknown): string {
  return typeof v === 'number' ? formatNumber(v) : JSON.stringify(v);
}

for (const group of GROUPS) {
  const box = document.createElement('details');
  box.open = true;
  const head = document.createElement('summary');
  head.textContent = group;
  box.append(head, ...SLIDERS.filter((s) => s.group === group).map(sliderRow));
  ui.sliders.append(box);
}
ui.notTuned.append(...NOT_TUNED.map((n) => Object.assign(document.createElement('li'), { textContent: `${n.key}: ${n.why}` })));

function syncSliders(): void {
  for (const r of rows.values()) r.sync();
}

// --- Ticking and the readouts ---

function tick(): void {
  if (playback && run.ticks >= playback.r.ticks.length) {
    setPaused(true);
    return;
  }
  if (ui.keyboard.options.length !== run.s.terriers.length + 1) fillKeyboard();
  if (driveId === null) resolveDrive();
  const inputs = run.tick(driveId === null ? null : { id: driveId, input: keyboard.input(page.frame) });
  recorder?.tick(inputs);
  drift?.tick?.(run.s, run, inputs);
  // The browser's clock is coarse (100 µs in Chromium without cross-origin
  // isolation), so the mean needs many ticks to settle.
  stepMs.push(run.stepMs);
  if (stepMs.length > 600) stepMs.shift();
}

const clockText = (s: Readonly<MatchState>, ticksPerSecond: number): string => {
  if (s.matchLengthTicks >= 0x80000000) return 'no clock: a placed scene';
  const whole = Math.floor(s.clock / ticksPerSecond);
  const text = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  return s.overtime ? `overtime +${text}` : text;
};

function readouts(closeNote: string): string {
  const { s, P } = run;
  const b = s.ball;
  const st = run.sim.physics.stats;
  const tps = P.config.ticksPerSecond;
  const mean = stepMs.length > 0 ? (1000 * stepMs.reduce((p, q) => p + q, 0)) / stepMs.length : 0;
  const lines = [
    `${run.scenario.label}, seed ${page.seed}: tick ${s.tick} (${run.ticks} run), ${PHASES[s.phase]}, ${clockText(s, tps)}, score ${s.score[0]}–${s.score[1]}${s.lastGoalTick === NEVER ? '' : `, last goal at tick ${s.lastGoalTick}${s.ownGoal ? ', an own goal' : ''}`}`,
    `ball: ${Math.hypot(b.vx, b.vy).toFixed(2)} m/s across, ${b.vz.toFixed(2)} up; centre ${b.z.toFixed(3)} m high${b.onFloor ? ', on the floor' : ''}`,
    `contacts: ${run.contacts} in the last substep, ${st.substeps > 0 ? (st.contacts / st.substeps).toFixed(2) : '0'} a substep on average, ${st.maxContacts} at most; slip-outs ${st.slipOuts}; step ${mean.toFixed(1)} µs (mean of the last ${stepMs.length})`,
    ...run.measures.map((m) => `${m.label}: ${m.text()}`),
    ...(reference ? [reference] : []),
    `close-up: ${closeNote}`,
  ];
  if (driveId) {
    const T = s.terriers.find((x) => x.id === driveId);
    lines.push(`keyboard: ${page.keyboard} in the ${['pitch', 'ball line', 'nose'][page.frame]} frame, ${keyboard.describe()}${T ? `; ${hspeed(T).toFixed(2)} m/s, meter ${T.meter}/${P.meterFull}${T.zoomLocked ? ', zoomies locked out' : ''}` : ''}`);
    if (drift) lines.push(`C-47, the keyboard's ${drift.label}: ${drift.text()}`);
  }
  const roles = run.brains.map((br) => {
    const T = s.terriers.find((x) => x.id === br.id);
    return T ? `${labelOf(T)} ${br.id === driveId ? 'keyboard' : ROLE_NAMES[br.role] ?? br.role}` : '';
  }).filter(Boolean);
  if (roles.length > 0) lines.push(`bots: ${roles.join(', ')}`);
  if (recorder) lines.push(`recording: ${recorder.length} ticks`);
  if (playback) lines.push(`playing ${playback.name}: ${run.ticks} of ${playback.r.ticks.length} ticks`);
  return lines.join('\n');
}

const ROLE_NAMES = ['chases', 'falls back', 'supports', 'defends', 'wanders', 'faces the ball', 'idles'];
const hspeed = (T: { vx: number; vy: number }): number => Math.hypot(T.vx, T.vy);

let last = performance.now();
let acc = 0;
let shown = 0;
function animate(now: number): void {
  acc += Math.min(250, now - last) * speed;
  last = now;
  const tickMs = 1000 * run.P.tickSeconds;
  let n = 0;
  while (acc >= tickMs) {
    acc -= tickMs;
    if (!paused && n < 8) {
      tick();
      n++;
    }
  }
  const o: ViewOptions = { normals: ui.normals.checked, velocities: ui.velocities.checked, focus: driveId };
  drawPlan(ui.plan, run, o);
  drawSide(ui.side, run, o);
  const note = drawClose(ui.close, run, o);
  if (now - shown > 100 || paused) {
    ui.readouts.textContent = readouts(note);
    shown = now;
  }
  requestAnimationFrame(animate);
}

readFragment();
takeFragment();
rerun();
syncButtons();
requestAnimationFrame(animate);
