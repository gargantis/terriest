import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioOut } from '../../audio/audio';
import { FakeAudioDocument, FakeAudioWindow, type FakeContext, settle } from '../../audio/audio-testing';
import { personId } from '../../core/bot/bot-id';
import type { BarkEvent, ConfirmedEnd, ConfirmedGoal, Session } from '../../core/session/index';
import { CELEBRATION, ENDED, IN_PLAY, LUNGING, type MatchState, START_COUNTDOWN } from '../../core/sim/index';
import type { AudioInspection, CueKind } from '../inspect';
import { cssDeclarations, cssLength, fake, type FakeDocument, installDom, shownText } from '../dom-testing';
import type { Layer, PitchContext } from '../layer';
import { type Calls, FakeControls, FakeStage, FakeView, MemorySettings, StateMatch, stateWith, testHost, type TestHost } from '../pitch-testing';
import { pitchScreen } from '../screens/pitch';
import { audioOut, LAYERS, SOUND_PROMPT, soundFollows, soundLayer } from './sound';

// The sound's layer (M4's design §1.27, §1.29, §1.38, §1.63, §5.8, §7;
// PLAN §13, D-14, D-16, D-32, Q-15), on the screens' DOM fake and a fake
// audio context: the head's cues after each run; each goal latched played
// once however often the scoreboard is read, and the end once it's
// confirmed, never a predicted one; the barks the view found, and yours at
// the press; another timeline resetting the cues, with nothing replayed
// from its adopted state nor from the scoreboard it keeps; a layer made over
// a scoreboard that has latched already, as Watch on Join makes one,
// whistling none of it; Settings' sound
// and Practice's pause on the page's AudioOut; "Press a key or tap for
// sound" while sound is on and the context waits, on an opaque backing,
// reported as the hook's audio.prompt; and the pitch screen handing it its
// runs, the barks and your bark.

const ME = personId(7, 0);
const THEM = personId(7, 1);

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

/** A Practice match whose timeline the test replaces, as a merge or a rejoin does. */
class Swapped extends StateMatch {
  timelineNow: { started: boolean; id: string; head: MatchState };

  constructor(state: MatchState) {
    super(ME, state);
    this.timelineNow = { started: true, id: '00000000000000aa', head: state };
  }

  override get session(): Session {
    return { timeline: this.timelineNow } as unknown as Session;
  }

  /** The head the next run reads. */
  set headNow(s: MatchState) {
    this.timelineNow.head = s;
  }
}

interface Rig {
  readonly match: Swapped;
  readonly settings: MemorySettings;
  readonly host: TestHost;
  readonly win: FakeAudioWindow;
  readonly doc: FakeAudioDocument;
  readonly ctx: FakeContext;
  readonly out: AudioOut;
  readonly layer: Layer;
  run(barks?: readonly BarkEvent[]): void;
  frame(): void;
  audio(): AudioInspection;
  decided(kind: CueKind): number;
  played(kind: CueKind): number;
}

function play(tick: number, f: (s: MatchState) => void = () => {}, phaseStart = 0): MatchState {
  const s = stateWith(1, tick, [{ id: ME, pack: 0 }, { id: THEM, pack: 1 }]);
  s.phase = IN_PLAY;
  s.phaseStart = phaseStart;
  f(s);
  return s;
}

const hit = (tick: number) => (s: MatchState): void => {
  s.ball.lastHitTick = tick;
  s.ball.lastHitStrength = 6;
};

function rig(o: { state?: 'suspended' | 'running'; sound?: boolean; first?: MatchState; latched?: (m: Swapped) => void } = {}): Rig {
  const match = new Swapped(o.first ?? play(10));
  o.latched?.(match);
  const settings = new MemorySettings();
  if (o.sound === false) settings.value = { ...settings.value, sound: false };
  const calls: Calls = [];
  const host = testHost({ match, view: new FakeView(calls, match), stage: new FakeStage(calls), controls: new FakeControls(calls), settings });
  const win = new FakeAudioWindow({ state: o.state ?? 'running' });
  const doc = new FakeAudioDocument();
  const out = new AudioOut(win, doc);
  const layer = soundLayer(host, out);
  const ctx = (barks: readonly BarkEvent[]): PitchContext => ({
    match, drawn: null, out: null, frame: null, nowMs: 0, mode: { kind: 'overview' }, settings: settings.get(), graphics: 'ok', barks,
  });
  const r: Rig = {
    match, settings, host, win, doc, ctx: win.context, out, layer,
    run: (barks = []) => layer.run!(ctx(barks)),
    frame: () => layer.frame!(ctx([])),
    audio: () => out.inspect(),
    decided: (kind) => out.inspect().decided[kind],
    played: (kind) => out.inspect().played[kind],
  };
  return r;
}

const goal = (tick: number, pack: 0 | 1): ConfirmedGoal => ({ tick, pack, ownGoal: false, scorers: [], score: [pack === 0 ? 1 : 0, pack] });
const END: ConfirmedEnd = { tick: 9000, score: [2, 1], winner: 0, rows: [] };

describe("the sound's layer (§1.63)", () => {
  it("is the sound file's one layer, named sound, its element the prompt", () => {
    expect(LAYERS).toHaveLength(1);
    const match = new Swapped(play(10));
    const calls: Calls = [];
    const host = testHost({ match, view: new FakeView(calls, match), stage: new FakeStage(calls), controls: null });
    const layer = LAYERS[0]!(host);
    expect(layer.name).toBe('sound');
    const el = fake(layer.el);
    expect([el.tagName, el.getAttribute('role'), el.getAttribute('data-test'), el.textContent]).toEqual(['P', 'status', 'sound-prompt', SOUND_PROMPT]);
    // Node has no Web Audio: the page's AudioOut is none, so no prompt.
    expect(audioOut().state).toBe('none');
    expect(audioOut()).toBe(audioOut());
    layer.frame!({ match, drawn: null, out: null, frame: null, nowMs: 0, mode: { kind: 'overview' }, settings: host.settings.get(), graphics: 'ok', barks: [] });
    expect([el.hidden, layer.inspect!()]).toEqual([true, { prompt: false }]);
    layer.dispose!();
  });
});

describe('the cues after each timer run (§7)', () => {
  it("plays the head's bounces, pounces, tumbles and kickoffs as they first appear", () => {
    const r = rig();
    r.run(); // the first look, a baseline
    r.match.headNow = play(100, hit(100));
    r.run();
    r.run();
    expect([r.decided('thump'), r.played('thump')]).toEqual([1, 1]);
    r.match.headNow = play(200, (s) => {
      const T = s.terriers.find((x) => x.id === THEM)!;
      T.anim = LUNGING;
      T.animStart = 199;
    });
    r.run();
    expect(r.decided('whoosh')).toBe(1);
    r.match.headNow = play(300, () => {}, 300);
    r.run();
    expect(r.decided('whistleKickoff')).toBe(1);
    expect(r.ctx.sources.length).toBeGreaterThan(0);
  });

  it('plays each goal latched once however often the scoreboard is read, and the end once confirmed', () => {
    const r = rig();
    r.run();
    r.match.board.goals.push(goal(500, 0));
    for (let k = 0; k < 5; k++) r.run();
    expect([r.decided('whistleGoal'), r.decided('chorus')]).toEqual([1, 1]);
    r.match.board.goals.push(goal(900, 1));
    r.run();
    r.run();
    expect([r.decided('whistleGoal'), r.decided('chorus')]).toEqual([2, 2]);
    // A goal a repair takes back, and one latched at the same tick again: once per goal tick.
    r.match.board.goals.pop();
    r.run();
    r.match.board.goals.push(goal(900, 1));
    r.run();
    expect(r.decided('whistleGoal')).toBe(2);
    expect(r.decided('whistleEnd')).toBe(0);
    r.match.board.end = END;
    r.run();
    r.run();
    expect([r.decided('whistleEnd'), r.played('whistleEnd')]).toEqual([1, 1]);
  });

  it('whistles nothing the scoreboard latched before the layer was made, as Watch on Join or a role\'s new pitch screen makes it, and each goal after (§7)', () => {
    const r = rig({ latched: (m) => m.board.goals.push(goal(500, 0), goal(900, 1)) });
    r.run();
    r.run();
    expect([r.decided('whistleGoal'), r.decided('chorus'), r.played('whistleGoal')]).toEqual([0, 0, 0]);
    r.match.board.goals.push(goal(1300, 0));
    r.run();
    expect([r.decided('whistleGoal'), r.decided('chorus')]).toEqual([1, 1]);
    // An end confirmed before the layer was made, as a page arriving on Results has it, is no new end.
    const ended = rig({ latched: (m) => (m.board.end = END) });
    ended.run();
    expect(ended.decided('whistleEnd')).toBe(0);
  });

  it("blows no end whistle for the head's predicted end, nor a goal whistle for its predicted goal", () => {
    const r = rig();
    r.run();
    r.match.headNow = play(3000, (s) => {
      s.phase = CELEBRATION;
      s.phaseStart = 2999;
      s.lastGoalTick = 2999;
      s.score = [0, 1];
    });
    r.run();
    r.match.headNow = play(3700, (s) => {
      s.phase = ENDED;
      s.phaseStart = 3690;
      s.clock = 0;
    });
    r.run();
    r.run();
    expect([r.decided('whistleGoal'), r.decided('chorus'), r.decided('whistleEnd')]).toEqual([0, 0, 0]);
  });

  it('plays the barks the view found in this run, and yours at the press, each once', () => {
    const r = rig();
    r.run([{ id: THEM, tick: 40, own: false }]);
    expect(r.decided('bark')).toBe(1);
    r.layer.ownBark!(50);
    expect([r.decided('bark'), r.played('bark')]).toEqual([2, 2]);
    // Yours, as a received input would name it: played at the press already.
    r.run([{ id: ME, tick: 50, own: false }]);
    r.run([]);
    expect(r.decided('bark')).toBe(2);
  });

  it("resets for another timeline: nothing replays from its adopted state, nor from the scoreboard it keeps", () => {
    const r = rig();
    r.run();
    r.match.headNow = play(400, hit(400), 300);
    r.match.board.goals.push(goal(350, 0));
    r.run();
    expect([r.decided('thump'), r.decided('whistleKickoff'), r.decided('whistleGoal')]).toEqual([1, 1, 1]);
    r.match.board.end = END;
    r.run();
    // A rejoin's timeline: another object and ID, its adopted state in play with a hit of its own; the
    // scoreboard keeps its goals and its end (src/core/session/scoreboard.ts).
    r.match.timelineNow = { started: true, id: '00000000000000bb', head: play(1400, hit(1398), 1300) };
    r.run();
    r.run();
    expect([r.decided('thump'), r.decided('whistleKickoff'), r.decided('whistleGoal'), r.decided('whistleEnd')]).toEqual([1, 1, 1, 1]);
    // What happens after the adoption plays.
    r.match.headNow = play(1500, hit(1500), 1300);
    r.run();
    expect(r.decided('thump')).toBe(2);
    // The same timeline object under another ID is another timeline too, as the view takes it.
    r.match.timelineNow.id = '00000000000000cc';
    r.match.headNow = play(1600, hit(1590), 1300);
    r.run();
    expect(r.decided('thump')).toBe(2);
  });

  it('reads nothing from a timeline that has not started', () => {
    const r = rig();
    r.match.timelineNow = { started: false, id: '', head: play(100, hit(100), 50) };
    r.run();
    // Started: its first head is the baseline.
    r.match.timelineNow = { started: true, id: '00000000000000dd', head: play(110, hit(108), 50) };
    r.run();
    expect([r.decided('thump'), r.decided('whistleKickoff')]).toEqual([0, 0]);
  });
});

describe("Settings' sound and Practice's pause on the page's AudioOut (D-32, Q-15)", () => {
  it("follows Settings' sound from the layer's start, each change at once, until it goes", () => {
    const r = rig({ sound: false });
    expect(r.out.enabled).toBe(false);
    r.run([{ id: THEM, tick: 40, own: false }]);
    expect([r.decided('bark'), r.played('bark')]).toEqual([1, 0]);
    r.settings.set({ sound: true });
    expect(r.out.enabled).toBe(true);
    r.run([{ id: THEM, tick: 100, own: false }]);
    expect(r.played('bark')).toBe(1);
    r.layer.dispose!();
    r.settings.set({ sound: false });
    expect(r.out.enabled).toBe(true);
  });

  it("follows Practice's pause each frame and each run, a cue decided while paused counted, never scheduled", async () => {
    const r = rig();
    r.match.pause('menu');
    r.frame();
    expect([r.out.paused, r.ctx.suspends]).toEqual([true, 1]);
    await settle();
    r.layer.ownBark!(60);
    expect([r.decided('bark'), r.played('bark')]).toEqual([1, 0]);
    r.match.resume('menu');
    r.run();
    expect([r.out.paused, r.ctx.resumes]).toEqual([false, 1]);
    await settle();
    r.layer.ownBark!(120);
    expect(r.played('bark')).toBe(1);
  });

  it("leaves the page's sound unpaused and unprompted when it goes, and acts no more", () => {
    const r = rig({ state: 'suspended' });
    r.frame();
    expect(r.audio().prompt).toBe(true);
    r.match.pause('menu');
    r.frame();
    r.layer.dispose!();
    expect([r.out.paused, r.audio().prompt]).toEqual([false, false]);
    r.match.board.goals.push(goal(10, 0));
    r.run();
    r.layer.ownBark!(5);
    r.frame();
    expect([r.decided('whistleGoal'), r.decided('bark'), r.audio().prompt]).toEqual([0, 0, false]);
  });

  it('keeps the master gain on the settings on every screen, from soundFollows at start-up', () => {
    const settings = new MemorySettings();
    const out = new AudioOut(new FakeAudioWindow(), new FakeAudioDocument());
    settings.set({ sound: false });
    const stop = soundFollows(settings, out);
    expect(out.enabled).toBe(false);
    settings.set({ sound: true });
    expect(out.enabled).toBe(true);
    stop();
    settings.set({ sound: false });
    expect(out.enabled).toBe(true);
  });
});

describe('"Press a key or tap for sound" (D-32)', () => {
  it('shows while sound is on and the context waits for an input, and goes once it runs', async () => {
    const r = rig({ state: 'suspended' });
    const el = fake(r.layer.el);
    expect([el.hidden, shownText(el)]).toEqual([false, SOUND_PROMPT]);
    expect(r.audio().prompt).toBe(true);
    expect(r.layer.inspect!()).toEqual({ prompt: true });
    // A key: the context runs, and the next frame takes the prompt down.
    r.win.fire('keydown');
    await settle();
    r.frame();
    expect([el.hidden, r.audio().prompt, r.layer.inspect!()]).toEqual([true, false, { prompt: false }]);
  });

  it('hides with sound off, and while Practice is paused, and shows again after', async () => {
    const r = rig({ state: 'suspended' });
    const el = fake(r.layer.el);
    r.settings.set({ sound: false });
    expect([el.hidden, r.audio().prompt]).toEqual([true, false]);
    r.settings.set({ sound: true });
    expect(el.hidden).toBe(false);
    r.match.pause('menu');
    r.frame();
    expect([el.hidden, r.audio().prompt]).toEqual([true, false]);
    r.ctx.resumeWill = 'refuse'; // no input yet: the context still waits once the pause ends
    r.match.resume('menu');
    r.frame();
    await settle();
    r.frame();
    expect([el.hidden, r.audio().prompt]).toEqual([false, true]);
  });

  it('never shows without Web Audio', () => {
    const match = new Swapped(play(10));
    const calls: Calls = [];
    const host = testHost({ match, view: new FakeView(calls, match), stage: new FakeStage(calls), controls: null });
    const out = new AudioOut(new FakeAudioWindow({ audio: false }), new FakeAudioDocument());
    const layer = soundLayer(host, out);
    layer.run!({ match, drawn: null, out: null, frame: null, nowMs: 0, mode: { kind: 'overview' }, settings: host.settings.get(), graphics: 'ok', barks: [] });
    expect([fake(layer.el).hidden, out.inspect().prompt]).toEqual([true, false]);
  });

  it("sits on an opaque backing at the left under the HUD's top bar, inside the safe area, over the bark marks and under the menu", () => {
    const css = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');
    const d = cssDeclarations(css('./sound.css'), '.sound-prompt');
    expect([d.background, d.color, d['pointer-events'], d.position]).toEqual(['var(--bg)', 'var(--fg)', 'none', 'absolute']);
    const bar = cssDeclarations(css('../hud.css'), '.hud-top');
    const button = cssDeclarations(css('../screens.css'), 'button');
    expect(cssLength(d.top, 360)).toBeGreaterThanOrEqual(cssLength(bar.top, 360) + cssLength(button['min-height'], 360));
    const z = Number(d['z-index']);
    expect(z).toBeGreaterThan(Number(cssDeclarations(css('../overlay.css'), '.overlay-bark')['z-index']));
    expect(z).toBeLessThan(Number(cssDeclarations(css('../screens/menu.css'), '.match-menu')['z-index']));
    // On the left, at most a little over half the width, so Pre-match's panel on the right stays clear of it.
    expect([cssLength(d.left, 640), d['max-width']]).toEqual([8, 'calc(55% - 16px)']);
    // Inside the safe area, as the HUD is (§5.13): each inset its own term, 0 at the gate's sizes.
    expect(d.left).toContain('env(safe-area-inset-left, 0px)');
    expect(d.top).toContain('env(safe-area-inset-top, 0px)');
  });
});

describe('through the pitch screen (§1.38)', () => {
  it('runs after each timer run with the barks the view found, and hears your bark at the press', async () => {
    const calls: Calls = [];
    const match = new StateMatch(ME, play(100, () => {}, 0));
    const view = new FakeView(calls, match);
    const stage = new FakeStage(calls);
    const host = { ...testHost({ match, view, stage, controls: new FakeControls(calls) }), results: () => {} };
    const out = new AudioOut(new FakeAudioWindow({ state: 'running' }), new FakeAudioDocument());
    const screen = pitchScreen(host, [(h) => soundLayer(h, out)]);
    dom.document.body.append(fake(screen.el));
    await stage.finish();
    match.run();
    view.barks = [{ id: THEM, tick: 99, own: false }];
    match.run();
    expect(out.inspect().decided.bark).toBe(1);
    screen.ownBark(104);
    expect(out.inspect().decided.bark).toBe(2);
    // The countdown's end: the head in play, and the kickoff whistle after the run.
    match.state = play(400, () => {}, 400);
    match.run();
    expect(out.inspect().decided.whistleKickoff).toBe(1);
    expect(screen.inspect().layers['sound']).toEqual({ prompt: false });
    screen.dispose();
    expect(out.inspect().prompt).toBe(false);
  });

  it('shows the prompt over the pitch on Pre-match while the context waits', async () => {
    const calls: Calls = [];
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }], {}));
    match.state.phase = START_COUNTDOWN;
    const view = new FakeView(calls, match);
    const stage = new FakeStage(calls);
    const host = { ...testHost({ match, view, stage, controls: new FakeControls(calls) }), results: () => {} };
    const out = new AudioOut(new FakeAudioWindow({ state: 'suspended' }), new FakeAudioDocument());
    const screen = pitchScreen(host, [(h) => soundLayer(h, out)]);
    dom.document.body.append(fake(screen.el));
    await stage.finish();
    screen.frame(16);
    const prompt = fake(screen.el).querySelectorAll('[data-test="sound-prompt"]');
    expect(prompt).toHaveLength(1);
    expect([prompt[0]!.hidden, out.inspect().prompt]).toEqual([false, true]);
    screen.dispose();
  });
});
