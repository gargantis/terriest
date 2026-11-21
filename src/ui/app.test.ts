import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { personId } from '../core/bot/bot-id';
import { findTerrier, IN_PLAY, LUNGING, START_COUNTDOWN, WARM_UP } from '../core/sim/index';
import { TEST_BUILD } from '../core/timeline/testing';
import type { Device, DeviceState, UiCommand } from '../input/source';
import type { Timeline } from '../core/session/index';
import type { RenderInfo } from '../render/stage-types';
import { MemoryStorage } from '../storage/kv';
import { ProfileStore } from '../storage/profile';
import { SettingsStore } from '../storage/settings';
import { App, type AppLocation, appRoot } from './app';
import { FakeClock, fakePage } from './clock-testing';
import { pageDevices, type DeviceHost, type PageDevices } from './devices';
import { fake, FakeEvent, type FakeDocument, FakeNode, installDom, only } from './dom-testing';
import { type AnimationFrames, FrameLoop } from './frame-loop';
import type { Inspection, TerriestTest } from './inspect';
import { PITCH_LAYERS, pitchLayers } from './layers/index';
import { FakeStage, StateMatch, stateWith, testHost, FakeView } from './pitch-testing';

// The app (M4's design §1.41, §1.47, §1.63, §2.8, §5.1–§5.4, §5.7–§5.9,
// §9.2's app.test row; PLAN §11, Q-15, Q-17; M4-Q1, M4-Q9, M4-Q38), on the
// screens' DOM fake, its timers and Practice in virtual time: the start-up
// order, the first screen before boot.started() and the compile after it
// has been painted; the fragment's routes, every one Home in phase 1, and a
// hashchange leaving a Practice; Home, Practice's setup, Pre-match, Match,
// Results, Play again and Leave, the stage and the frame loop on the pitch
// screen alone, each screen focused, the keyboard told which screen it's
// on, the page at its top; one announcements log for each match, kept
// across its screens; Results' Home leaving the match; the hook's match
// figures, the drawn head's apart from the final state's, a lunge latched,
// each match's from its opening, P11's count and the timer's gaps past the
// freeze and the stall; Settings' quality re-creating the stage behind
// Home, the old one disposed only once its own prepare has settled. And the
// frame loop's phase-1 fallback, every other frame drawn however long the
// gaps stay late, its log capped; the layers' order and the page's devices,
// which have no test files of their own until phase 2 fills them.

const ME = personId(7, 0);

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

/** A stage that records its prepare and disposal, with a canvas and the figures the hook reads. */
class Stage extends FakeStage {
  override readonly canvas = dom.document.createElement('canvas') as unknown as HTMLCanvasElement;
  prepares = 0;
  disposed = false;
  readonly quality: 'high' | 'low';

  constructor(calls: string[], quality: 'high' | 'low') {
    super(calls);
    this.quality = quality;
  }

  override prepare(): Promise<void> {
    this.prepares++;
    return super.prepare();
  }

  override info(): RenderInfo {
    return { quality: this.quality, frames: this.drawn.length } as RenderInfo;
  }

  override dispose(): void {
    this.disposed = true;
  }
}

/** Animation frames the test runs. */
class Frames implements AnimationFrames {
  private next = 1;
  private queue: { id: number; fn: () => void }[] = [];

  request(fn: () => void): number {
    const id = this.next++;
    this.queue.push({ id, fn });
    return id;
  }

  cancel(id: number): void {
    this.queue = this.queue.filter((x) => x.id !== id);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** One animation frame: every callback requested before it. */
  run(): void {
    const due = this.queue;
    this.queue = [];
    for (const x of due) x.fn();
  }
}

/** A device the test presses, as a keyboard would: a direction held, screen-relative, and a pounce. */
class Pad implements Device {
  readonly kind = 'keyboard' as const;
  direction: number | null = null;
  pounce = false;
  read(): DeviceState {
    const s: DeviceState = { direction: this.direction, stickStep: null, zoomies: false, jump: false, pounce: this.pounce, bark: false, view: false, changedAtMs: null };
    this.pounce = false;
    return s;
  }
  release(): void {
    this.direction = null;
    this.pounce = false;
  }
  dispose(): void {}
}

interface Rig {
  readonly app: App;
  readonly root: ReturnType<typeof fake>;
  readonly clock: FakeClock;
  readonly frames: Frames;
  readonly stages: Stage[];
  readonly calls: string[];
  readonly test: TerriestTest;
  readonly settings: SettingsStore;
  readonly location: AppLocation & { set(hash: string): void };
  readonly device: Pad;
  /** The devices' host, as the app made it. */
  host(): DeviceHost;
  readonly order: string[];
}

function rig(o: { hash?: string } = {}): Rig {
  const calls: string[] = [];
  const order: string[] = [];
  const clock = new FakeClock(1000);
  const frames = new Frames();
  const stages: Stage[] = [];
  const makeStage = (q: 'high' | 'low'): Stage => {
    const s = new Stage(calls, q);
    stages.push(s);
    return s;
  };
  const root = fake(appRoot());
  // index.html hides the landmark until boot.js says started: nothing in it takes the focus till then.
  root.hidden = true;
  dom.document.body.append(root);
  const settings = new SettingsStore(new MemoryStorage(), { reducedMotion: () => false, qualityDefault: () => 'high' });
  const profile = new ProfileStore(new MemoryStorage(), () => ME, () => 3);
  const test: TerriestTest = {};
  let hash = o.hash ?? '';
  const listeners: (() => void)[] = [];
  const location = {
    hash: () => hash,
    onHashChange: (fn: () => void) => {
      listeners.push(fn);
      return () => {};
    },
    set: (h: string) => {
      hash = h;
      for (const fn of listeners) fn();
    },
  };
  const device = new Pad();
  let deviceHost: DeviceHost | null = null;
  const devices = (h: DeviceHost): PageDevices => {
    deviceHost = h;
    return { list: () => [device], gamepad: () => null, dispose: () => {} };
  };
  const boot = {
    started: () => {
      root.hidden = false;
      order.push('started');
      order.push(root.querySelector('h1') === null ? 'no screen' : `screen ${root.querySelector('h1')!.textContent}`);
      order.push(test.inspect === undefined ? 'no hook' : 'hook');
    },
    noWebGL2: () => order.push('noWebGL2'),
  };
  const first = makeStage(settings.get().quality);
  const app = new App({
    root: root as unknown as HTMLElement, stage: first, makeStage, profile, settings, test, build: TEST_BUILD, clock, page: fakePage(), boot,
    location, devices, frames,
  });
  return { app, root, clock, frames, stages, calls, test, settings, location, device, host: () => deviceHost!, order };
}

const look = (r: Rig): Inspection => r.test.inspect!();
/** The match the app holds, as the hook reads it: its timeline's drawn head and final state. */
const held = (r: Rig): Timeline => (r.app as unknown as { match: { session: { timeline: Timeline } } }).match.session.timeline;
const screenEl = (r: Rig): ReturnType<typeof fake> => only(r.root, '[id="screen"]');
const stageBox = (r: Rig): ReturnType<typeof fake> => only(r.root, '[id="stage"]');
const button = (r: Rig, test: string): ReturnType<typeof fake> => only(screenEl(r), `button[data-test="${test}"]`);
const press = (kind: UiCommand['kind'], pressedAt = 0): UiCommand => ({ kind, pressedAt, source: 'keyboard', repeat: false });
const settle = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve();
};

/** Runs ms of virtual time, an animation frame every `frameMs`, as a page's would come. */
function play(r: Rig, ms: number, frameMs = 50): void {
  for (let t = 0; t < ms; t += frameMs) {
    r.clock.advance(frameMs);
    r.frames.run();
  }
}

/** Plays until `cond` holds, at most ms. */
function playUntil(r: Rig, cond: () => boolean, ms: number, frameMs = 50): void {
  for (let t = 0; t < ms && !cond(); t += frameMs) play(r, frameMs, frameMs);
  if (!cond()) {
    const m = r.test.inspect!().match;
    throw new Error(`not reached within ${ms} ms of virtual time: ${JSON.stringify({ phase: m?.phase, tick: m?.localTick, score: m?.score, clock: m?.clock })}`);
  }
}

/** Home's Practice, then the setup's 1 a side and 1 minute, then Start. */
function startPractice(r: Rig): void {
  button(r, 'practice').click();
  const sel = (test: string): ReturnType<typeof fake> => only(screenEl(r), `select[data-test="${test}"]`);
  sel('pack-size').value = '1';
  sel('match-length').value = '1';
  button(r, 'start').click();
}

describe('the start-up order (§5.1, M4-Q38)', () => {
  it('shows Home, adds the hook, says started, and only then, once Home has been painted, prepares the stage', async () => {
    const r = rig();
    expect(screenEl(r).children).toEqual([]);
    await r.app.start();
    expect(r.order).toEqual(['started', 'screen terriest', 'hook']);
    expect(look(r).screen).toBe('home');
    expect(dom.document.activeElement.textContent).toBe('terriest'); // Home's heading (Q-17)
    // The stage's canvas, the image "The pitch", in the landmark's #stage, hidden off the pitch screens (M4-Q9).
    const canvas = only(stageBox(r), 'canvas');
    expect([canvas.getAttribute('role'), canvas.getAttribute('aria-label'), stageBox(r).hidden]).toEqual(['img', 'The pitch', true]);
    // The compile waits for a frame, then a task after it, so Home is painted first.
    expect(r.stages[0]!.prepares).toBe(0);
    r.frames.run();
    expect(r.stages[0]!.prepares).toBe(0);
    r.clock.advance(0);
    expect(r.stages[0]!.prepares).toBe(1);
    expect(look(r).startMs).toEqual({ started: 1000, prepared: null });
    r.clock.advance(250);
    await r.stages[0]!.finish();
    await settle();
    expect(look(r).startMs).toEqual({ started: 1000, prepared: 1250 });
    expect(r.test.hashAt!(0)).toBe(''); // no match held
  });
});

describe("the fragment's routes in phase 1 (§5.2)", () => {
  it('goes Home from any fragment, a #join= link among them until phase 2, and a hashchange leaves a Practice for Home', async () => {
    const r = rig({ hash: '#join=TERR1ESTDESKT0PM30004' });
    await r.app.start();
    expect(look(r).screen).toBe('home');
    startPractice(r);
    expect(look(r).screen).toBe('prematch');
    const timers = r.clock.pending;
    r.location.set('#anything');
    expect(look(r).screen).toBe('home');
    expect(look(r).match).toBeNull();
    expect(r.clock.pending).toBe(timers - 1); // Practice's timeline timer, stopped with its match
    // Practice never sets the fragment (D-22).
    expect(r.location.hash()).toBe('#anything');
  });
});

describe('Practice through the screens (§5.3, §5.4, §5.7–§5.9, Q-15, Q-17)', () => {
  it('plays Home to Results and Play again, the stage and the frame loop on the pitch screen alone, one log for each match', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    expect(r.host().uiActive()).toBe('other');

    // Practice's setup, focused on its heading.
    button(r, 'practice').click();
    expect(look(r).screen).toBe('practice');
    expect(dom.document.activeElement.textContent).toBe('Practice');
    expect(r.host().uiActive()).toBe('other');
    const sel = (test: string): ReturnType<typeof fake> => only(screenEl(r), `select[data-test="${test}"]`);
    sel('pack-size').value = '1';
    sel('match-length').value = '1';
    button(r, 'start').click();

    // Pre-match: the stage shown, the loop running, Ready focused from the entry (§1.42).
    expect(look(r).screen).toBe('prematch');
    expect([stageBox(r).hidden, r.root.classList.contains('pitch'), r.frames.pending]).toEqual([false, true, 1]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    expect(r.host().uiActive()).toBe('pitch');
    await settle();
    let i = look(r);
    expect(i.match).toMatchObject({ kind: 'practice', me: ME, matchId: null, started: true, paused: false });
    expect(i.announcements).toMatchObject({ matchId: null, arrivalTick: 0, countdowns: [], goals: [], results: null });
    expect(Object.keys(i.layers).sort()).toEqual(['hud', 'menu', 'overlay']);
    expect(i.controls).not.toBeNull();

    // A pounce in warm-up, which every control has (D-8): the lunge latched in the hook.
    playUntil(r, () => look(r).match!.inRoster, 2000);
    r.device.pounce = true;
    playUntil(r, () => look(r).match!.mine!.lunges === 1, 2000);
    i = look(r);
    expect(i.match!.mine!.lastLungeTick).not.toBeNull();
    expect(i.controls!.presses.pounce).toBe(1);

    // The menu by Escape: the keyboard's screen is the menu's, and Practice pauses (Q-15); Escape again
    // closes it, the focus back on Ready.
    r.app.ui(press('menu'));
    expect([look(r).menu, r.host().uiActive(), look(r).match!.paused]).toEqual(['menu', 'menu', true]);
    r.app.ui(press('menu'));
    expect([look(r).menu, r.host().uiActive(), look(r).match!.paused]).toEqual(['closed', 'pitch', false]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');

    // Ready by Enter: the start countdown, then Match at the first kickoff's play (M4-Q8).
    playUntil(r, () => button(r, 'ready').getAttribute('aria-disabled') !== 'true', 2000);
    r.app.ui(press('press', r.clock.now()));
    playUntil(r, () => look(r).match!.phase === START_COUNTDOWN, 2000, 16);
    // The drawn head's phase, as the validated scripts time their holds: the final state's comes w ticks on.
    i = look(r);
    expect(i.match!.headTick - i.match!.phaseStart).toBeLessThan(config.lateWindowTicks);
    expect(i.match!.finalTick).toBeLessThan(i.match!.phaseStart);
    expect(i.screen).toBe('prematch');
    playUntil(r, () => look(r).screen === 'match', 8000);
    i = look(r);
    expect(i.match!.phase).toBe(IN_PLAY);
    expect(i.announcements!.countdowns.length).toBeGreaterThanOrEqual(1); // the start's, shown by the HUD

    // To the end, confirmed: Results, the stage hidden, the loop stopped, Play again focused (Q-17).
    // A passive person: the bot's goals stop the clock for 6.4 s each (§9.2's setups play the spec's).
    playUntil(r, () => look(r).screen === 'results', 240_000, 100);
    i = look(r);
    const firstLog = i.announcements!;
    expect([stageBox(r).hidden, r.root.classList.contains('pitch'), r.frames.pending]).toEqual([true, false, 0]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('again');
    expect(r.host().uiActive()).toBe('results');
    expect(i.controls).toBeNull();
    expect(i.layers).toEqual({});
    expect(i.match!.end).not.toBeNull();
    // Each goal the HUD showed, at its confirmed tick (D-14).
    expect(firstLog.goals.length).toBeGreaterThan(0);
    expect(firstLog.goals.every((g) => i.match!.goals.some((x) => x.tick === g.tick) && g.withdrawnAtMs === null)).toBe(true);
    expect(firstLog.results).not.toBeNull();
    expect(i.match!.timer).toMatchObject({ gapMaxMs: config.timelineTimerMs, gapsOverFreeze: 0, gapsOverStall: 0 });
    expect(i.match!.timer.runs).toBeGreaterThan(1000);
    expect(i.frames.frames).toBeGreaterThan(100);
    expect(i.frames.headHashMismatches).toBe(0); // P11, counted under the hook
    const t = i.match!.finalTick - 10;
    expect(r.test.hashAt!(t)).toMatch(/^[0-9a-f]{16}$/);

    // Q-17's guard: a press at once is announced and dropped; one 0.5 s on plays again.
    r.app.ui(press('press', r.clock.now()));
    expect(look(r).screen).toBe('results');
    r.clock.advance(config.resultsPressGuardSeconds * 1000);
    r.app.ui(press('press', r.clock.now()));
    await settle();
    i = look(r);
    expect(i.screen).toBe('prematch');
    // A new log, the new match's, from its opening.
    expect(i.announcements).toMatchObject({ matchId: null, arrivalTick: 0, countdowns: [], goals: [], results: null });
    expect(i.match!.localTick).toBe(0);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    // And the match's own figures from its opening too (§1.40): its timer's runs and its latched lunges.
    const firstRuns = look(r).match!.timer.runs;
    expect(firstRuns).toBeLessThan(10);
    playUntil(r, () => look(r).match!.inRoster && look(r).match!.mine !== null, 2000);
    expect([look(r).match!.mine!.lunges, look(r).match!.mine!.lastLungeTick]).toEqual([0, null]);

    // Leave on Pre-match: Home, nothing held, the log kept until another match opens (§1.40).
    play(r, 500);
    button(r, 'prematch-leave').click();
    i = look(r);
    expect([i.screen, i.match, i.announcements?.arrivalTick, stageBox(r).hidden, r.frames.pending]).toEqual(['home', null, 0, true, 0]);
    expect(dom.document.activeElement.textContent).toBe('terriest');
  }, 30_000);

  it("announces Results' presses into the log it keeps, the guard's verdict with each (§4.9, M4-Q26)", async () => {
    // The whole match is the test above's; here the log is read on Results through a played match's end.
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    playUntil(r, () => button(r, 'ready').getAttribute('aria-disabled') !== 'true', 2000);
    button(r, 'ready').click();
    playUntil(r, () => look(r).screen === 'results', 240_000, 100);
    const shown = look(r).announcements!.results!.shownAtMs;
    r.app.ui(press('press', shown + 100));
    r.clock.advance(600);
    r.app.ui(press('right', r.clock.now())); // to Home
    r.app.ui(press('press', shown + 700));
    await settle();
    expect(look(r).screen).toBe('home');
    expect(look(r).announcements!.results!.presses).toEqual([
      { atMs: 100, source: 'keyboard', accepted: false },
      { atMs: 700, source: 'keyboard', accepted: true },
    ]);
    // Results' Home leaves the match (§5.11): none held, and Practice's Start opens another.
    expect(look(r).match).toBeNull();
    expect(r.test.hashAt!(0)).toBe('');
    startPractice(r);
    expect(look(r).screen).toBe('prematch');
    expect(look(r).match!.localTick).toBe(0);
  }, 30_000);

  it('counts under the hook each frame whose drawing changed the head (P11), the count kept once the pitch screen goes', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    play(r, 300);
    expect(look(r).frames.headHashMismatches).toBe(0);
    // A drawing that writes the head, as P11 forbids: each frame it draws is counted.
    const stage = r.stages[0]!;
    const draw = stage.draw.bind(stage);
    stage.draw = (f) => {
      const out = draw(f);
      held(r).head.ball.x += 0.001;
      return out;
    };
    play(r, 200);
    const n = look(r).frames.headHashMismatches;
    expect(n).toBeGreaterThan(0);
    button(r, 'prematch-leave').click();
    expect([look(r).screen, look(r).frames.headHashMismatches]).toEqual(['home', n]);
  });

  it("counts the timer's gaps past the freeze, d + w ticks, and past the stall's 2 s (D-15, D-31, §8.1)", async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    play(r, 500);
    expect(look(r).match!.timer).toMatchObject({ gapsOverFreeze: 0, gapsOverStall: 0 });
    r.clock.stall(300); // past d + w ticks, 233⅓ ms
    play(r, 100);
    let t = look(r).match!.timer;
    expect([t.gapsOverFreeze, t.gapsOverStall, t.gapMaxMs >= 300 && t.gapMaxMs < 2000]).toEqual([1, 0, true]);
    r.clock.stall(2100);
    play(r, 100);
    t = look(r).match!.timer;
    expect([t.gapsOverFreeze, t.gapsOverStall, t.gapMaxMs >= 2100]).toEqual([2, 1, true]);
  });
});

describe("Settings' render quality from Home (§2.8, D-33)", () => {
  it('re-creates the stage at once, preparing the new one behind Home, the old disposed only once its own prepare has settled', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    const [old] = r.stages;
    expect(old!.prepares).toBe(1); // under way, unsettled
    // Home scrolled down to its Settings, as a short window leaves it: Settings opens at its top (§5.14).
    dom.document.defaultView.scrollTo(0, 148);
    button(r, 'settings').click();
    expect(look(r).screen).toBe('settings');
    expect(dom.document.defaultView.scrollY).toBe(0);
    const low = only(screenEl(r), 'input[data-test="quality-low"]');
    low.checked = true;
    low.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(r.stages.map((s) => s.quality)).toEqual(['high', 'low']);
    const next = r.stages[1]!;
    expect(only(stageBox(r), 'canvas')).toBe(fake(next.canvas));
    expect(look(r).render.quality).toBe('low');
    expect(old!.disposed).toBe(false); // mid-compile: never disposed under it
    await old!.finish();
    await settle();
    expect(old!.disposed).toBe(true);
    expect(next.prepares).toBe(0);
    r.frames.run();
    r.clock.advance(0);
    expect(next.prepares).toBe(1);
    // A change that changes nothing makes no stage; one before a stage's prepare began disposes it at once.
    r.settings.set({ quality: 'low' });
    expect(r.stages.length).toBe(2);
    r.settings.set({ quality: 'high' });
    expect(r.stages.length).toBe(3);
    r.settings.set({ quality: 'low' });
    expect(r.stages.length).toBe(4);
    expect(r.stages[2]!.disposed).toBe(true); // its prepare hadn't begun
    expect(r.stages[2]!.prepares).toBe(0);
    // Back goes Home, at its top, where a Practice draws on the newest stage.
    dom.document.defaultView.scrollTo(0, 90);
    button(r, 'back').click();
    expect([look(r).screen, dom.document.defaultView.scrollY]).toEqual(['home', 0]);
  });
});

describe("the frame loop's phase-1 fallback (§1.47, §8.2, R-3)", () => {
  function loop(): { loop: FrameLoop; clock: FakeClock; frames: Frames; drawn: [number, number][] } {
    const clock = new FakeClock(0);
    const frames = new Frames();
    const drawn: [number, number][] = [];
    const l = new FrameLoop({ frame: (now, dt) => drawn.push([now, dt]), clock, stage: { setScale: () => {} }, frames });
    return { loop: l, clock, frames, drawn };
  }
  /** A frame of `ms`, the timer running every 4 ms through it, or held for the whole frame. */
  function frame(x: ReturnType<typeof loop>, ms: number, held: boolean): void {
    x.frames.run();
    if (held) {
      x.clock.advance(ms);
      x.loop.timerRan(x.clock.now(), null);
    } else {
      for (let t = 4; t <= ms; t += 4) {
        x.clock.advance(4);
        x.loop.timerRan(x.clock.now(), null);
      }
    }
  }

  it('draws every frame while the timer keeps its time, with the page clock and the time since the last frame drawn', () => {
    const x = loop();
    x.loop.start();
    for (let k = 0; k < 10; k++) frame(x, 16, false);
    expect(x.drawn.length).toBe(10);
    expect(x.drawn[0]).toEqual([0, 0]);
    expect(x.drawn[1]).toEqual([16, 16]);
    expect(x.loop.inspect()).toMatchObject({ frames: 10, scale: 1, skipping: false, actions: 0, log: [] });
  });

  it('skips the frame after one whose timer gap passed drawingLateTimerMs, so slow frames draw every other one, and recovers', () => {
    const x = loop();
    x.loop.start();
    frame(x, 16, false);
    frame(x, 16, false);
    expect(x.drawn.length).toBe(2);
    // Frames that hold the timer past the threshold: every other one drawn.
    const late = config.drawingLateTimerMs + 20;
    for (let k = 0; k < 8; k++) frame(x, k % 2 === 0 ? late : 4, k % 2 === 0);
    expect(x.drawn.length).toBe(2 + 4);
    expect(x.loop.skippedFrames).toBe(4);
    expect(x.loop.inspect()).toMatchObject({ skipping: true, actions: 1, log: [{ skipping: true, why: 'gaps', scale: 1 }] });
    // A gap just at the threshold isn't late.
    frame(x, config.drawingLateTimerMs, true);
    frame(x, 16, false);
    frame(x, 16, false);
    const f = x.loop.inspect();
    expect([f.skipping, f.actions, f.log.at(-1)!.why]).toEqual([false, 2, 'recovered']);
    expect(x.loop.skippedFrames).toBe(4);
  });

  it('draws every other frame while every timer gap is late, never none (§1.47)', () => {
    const x = loop();
    x.loop.start();
    // Each frame holds the timer past the threshold, as a page drawing too slowly does: the first draws, having
    // no gap before it, then every other one.
    for (let k = 0; k < 21; k++) frame(x, config.drawingLateTimerMs + 20, true);
    expect([x.drawn.length, x.loop.skippedFrames]).toEqual([11, 10]);
    expect(x.loop.inspect()).toMatchObject({ skipping: true, actions: 1 });
  });

  it('keeps the newest 200 of its log, and counts every action', () => {
    const x = loop();
    x.loop.start();
    const late = config.drawingLateTimerMs + 20;
    // On and off: a late frame, skipped, then two drawn on time, which end it; each action's time noted.
    const acted: number[] = [];
    const note = (): void => {
      const n = x.loop.inspect().actions;
      while (acted.length < n) acted.push(x.clock.now());
    };
    for (let k = 0; k < 150; k++) {
      for (const [ms, heldUp] of [[late, true], [4, false], [16, false]] as const) {
        x.frames.run();
        note();
        if (heldUp) {
          x.clock.advance(ms);
          x.loop.timerRan(x.clock.now(), null);
        } else {
          for (let t = 4; t <= ms; t += 4) {
            x.clock.advance(4);
            x.loop.timerRan(x.clock.now(), null);
          }
        }
      }
    }
    const f = x.loop.inspect();
    expect(acted.length).toBeGreaterThan(250);
    expect([f.actions, f.log.length]).toEqual([acted.length, 200]);
    expect(f.log.map((e) => e.atMs)).toEqual(acted.slice(-200));
  });

  it('runs only between start and stop, a new start drawing from a fresh time', () => {
    const x = loop();
    x.loop.start();
    frame(x, 16, false);
    x.loop.stop();
    expect(x.frames.pending).toBe(0);
    x.clock.advance(1000);
    x.loop.start();
    x.loop.start();
    expect(x.frames.pending).toBe(1);
    frame(x, 16, false);
    expect(x.drawn).toEqual([[0, 0], [1016, 0]]);
  });
});

describe("the pitch's layers and the page's devices (§1.63)", () => {
  it('composes the HUD, the overlay and the menu named menu, the later builders\' slots empty in phase 1', () => {
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }]));
    const host = testHost({ match, view: new FakeView([], match), stage: new FakeStage([]), controls: null });
    expect(PITCH_LAYERS.length).toBe(3);
    expect(pitchLayers(host).map((l) => l.name)).toEqual(['hud', 'overlay', 'menu']);
  });

  it("makes the keyboard once, which hands Q-17's keys to the app and reads the play keys only on a player's pitch", () => {
    const doc = dom.document;
    const target = Object.assign(new FakeNode(doc), { document: doc });
    let screen: 'pitch' | 'other' = 'other';
    const told: string[] = [];
    const devices = pageDevices({
      clock: new FakeClock(0), mirrored: () => false, sampling: () => false, used: () => {},
      ui: (c) => told.push(c.kind), uiActive: () => screen,
    }, target as unknown as Window);
    const key = (type: string, code: string): void => {
      target.dispatchEvent(Object.assign(new FakeEvent(type, { cancelable: true }), { code, repeat: false, ctrlKey: false, altKey: false, metaKey: false }));
    };
    expect(devices.list().map((d) => d.kind)).toEqual(['keyboard']);
    expect(devices.gamepad()).toBeNull();
    key('keydown', 'Escape');
    key('keydown', 'KeyE');
    expect(told).toEqual(['menu']);
    expect(devices.list()[0]!.read().pounce).toBe(false);
    screen = 'pitch';
    key('keydown', 'KeyE');
    expect(devices.list()[0]!.read().pounce).toBe(true);
    devices.dispose();
    key('keydown', 'Escape');
    expect(told).toEqual(['menu']);
  });
});

describe("the hook's match (§1.40)", () => {
  it('reads the drawn head for the phase, your terrier and the ball, the final state for the roster', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    playUntil(r, () => look(r).match!.inRoster, 2000);
    let m = look(r).match!;
    expect(m.phase).toBe(WARM_UP);
    expect(m.roster.map((x) => x.id)).toContain(ME);
    expect(m.mine).toMatchObject({ anim: expect.any(Number), pounceWait: 0, meter: 1, lunges: 0, lastLungeTick: null });
    expect(m.mine!.anim).not.toBe(LUNGING);
    expect(m.own.skipped).toBe(0); // Practice sends every tick (§8.1)

    // Your terrier running at the ball: the head, w ticks on from the final state, has it elsewhere, and the
    // hook reads it there; the roster the final state's, its inputs w ticks older.
    r.device.direction = 0;
    play(r, 1000);
    const t = held(r);
    const H = t.head.terriers[findTerrier(t.head, ME)]!;
    const F = t.final.terriers[findTerrier(t.final, ME)]!;
    m = look(r).match!;
    expect([H.x, H.y]).not.toEqual([F.x, F.y]);
    expect([m.mine!.x, m.mine!.y, m.mine!.z]).toEqual([H.x, H.y, H.z]);
    expect(H.lastInputTick).not.toBe(F.lastInputTick);
    expect(m.roster.find((x) => x.id === ME)!.lastInputTick).toBe(F.lastInputTick);
    expect([m.phase, m.phaseStart, m.clock]).toEqual([t.head.phase, t.head.phaseStart, t.head.clock]);
    r.device.direction = null;

    // In play, the ball moving: the head's ball, not the final state's.
    playUntil(r, () => button(r, 'ready').getAttribute('aria-disabled') !== 'true', 2000);
    button(r, 'ready').click();
    playUntil(r, () => {
      const x = held(r);
      return x.head.phase === IN_PLAY && x.head.ball.x !== x.final.ball.x;
    }, 20_000);
    m = look(r).match!;
    const ball = held(r).head.ball;
    expect(m.ball).toEqual({ x: ball.x, y: ball.y, z: ball.z });
    expect(m.ball.x).not.toBe(held(r).final.ball.x);
  });
});
