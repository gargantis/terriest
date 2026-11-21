import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CueKind } from '../ui/inspect';
import { AudioOut } from './audio';
import { FakeAudioDocument, FakeAudioWindow, type FakeContext, FakeGain, settle } from './audio-testing';
import type { Cue } from './synth';

// The page's sound output (PLAN §13, D-32, Q-15; M4's design §1.27, §7,
// §9.2's audio.test row, R-9), on a fake context: every cue decided is
// counted whatever the context's state, and scheduled only while it runs,
// sound is on and Practice isn't paused, one decided while it waits dropped
// and never queued; the context resumed at each key, click, pointer-up and
// touch-end until it runs, and when the page is shown, never while paused;
// a refused resume() never thrown nor left unhandled; Practice's pause
// suspending it, with no prompt while it comes back; the master gain for
// Settings' sound; and without Web Audio, 'none' and nothing else.

const cue = (kind: CueKind): Cue => ({ kind, seed: 1, loudness: 1 });

interface Rig {
  readonly out: AudioOut;
  readonly win: FakeAudioWindow;
  readonly doc: FakeAudioDocument;
  readonly ctx: FakeContext;
}

function rig(state: 'suspended' | 'running' = 'suspended'): Rig {
  const win = new FakeAudioWindow({ state });
  const doc = new FakeAudioDocument();
  const out = new AudioOut(win, doc);
  return { out, win, doc, ctx: win.context };
}

/** The sources scheduled so far. */
const sources = (r: Rig): number => r.ctx.sources.length;

// A refused resume() must never reach the page as an unhandled rejection (§0).
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => {
  unhandled.push(e);
};
beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});
/** Long enough for Node to report a rejection left unhandled. */
const turn = (): Promise<void> => new Promise((ok) => setTimeout(ok, 5));

describe('AudioOut (D-32)', () => {
  it('makes one context and its master chain at start-up, through a limiter to the speakers', () => {
    const r = rig();
    expect(r.win.contexts).toHaveLength(1);
    const master = r.ctx.nodes[0]!;
    expect(master).toBeInstanceOf(FakeGain);
    expect((master as FakeGain).gain.value).toBeGreaterThan(0);
    const limiter = master.outputs[0]!;
    expect(limiter).toMatchObject({ kind: 'compressor' });
    expect((limiter as FakeGain).outputs).toEqual([r.ctx.destination]);
    expect(r.out.state).toBe('waiting');
  });

  it('counts every cue decided whatever its state, and schedules it only while running, on and unpaused', async () => {
    const r = rig();
    // Waiting for an input: decided, dropped.
    r.out.play(cue('thump'));
    expect(r.out.inspect().decided.thump).toBe(1);
    expect([r.out.inspect().played.thump, sources(r)]).toEqual([0, 0]);
    // Running: scheduled at the context's time now.
    r.win.fire('keydown');
    await settle();
    expect(r.out.state).toBe('running');
    // Nothing queued from the wait: a suspended context's time stood still, so it would all sound at once.
    expect(sources(r)).toBe(0);
    r.ctx.currentTime = 12.5;
    r.out.play(cue('thump'));
    expect(r.out.inspect().played.thump).toBe(1);
    expect(sources(r)).toBeGreaterThan(0);
    expect(r.ctx.sources.every((s) => s.startAt === 12.5)).toBe(true);
    const made = sources(r);
    // Sound off: decided, not played.
    r.out.setEnabled(false);
    r.out.play(cue('bark'));
    // Paused: decided, not played.
    r.out.setEnabled(true);
    r.out.setPaused(true);
    r.out.play(cue('whistleGoal'));
    await settle();
    r.out.play(cue('chorus'));
    const i = r.out.inspect();
    expect([i.decided.thump, i.decided.bark, i.decided.whistleGoal, i.decided.chorus]).toEqual([2, 1, 1, 1]);
    expect([i.played.thump, i.played.bark, i.played.whistleGoal, i.played.chorus]).toEqual([1, 0, 0, 0]);
    expect(sources(r)).toBe(made);
    // Every kind counted apart, each at 0 before its first.
    expect(Object.keys(i.decided).sort()).toEqual(['bark', 'chorus', 'thud', 'thump', 'whistleEnd', 'whistleGoal', 'whistleKickoff', 'whoosh']);
    expect([i.decided.whoosh, i.played.whoosh]).toEqual([0, 0]);
  });

  it('resumes at each key, click, pointer-up and touch-end, heard first on the window, until it runs', async () => {
    for (const type of ['keydown', 'click', 'pointerup', 'touchend']) {
      const r = rig();
      const heard = r.win.listeners.find((l) => l.type === type);
      expect(heard?.options, type).toEqual({ capture: true, passive: true });
      r.win.fire(type);
      expect(r.ctx.resumes, type).toBe(1);
      await settle();
      expect(r.out.state, type).toBe('running');
      // Running: an input asks nothing more.
      r.win.fire(type);
      expect(r.ctx.resumes, type).toBe(1);
    }
    // Other inputs never: a gamepad's press makes no event at all, and a key's release isn't one of them.
    const r = rig();
    for (const type of ['keyup', 'pointerdown', 'mousemove', 'gamepadconnected']) r.win.fire(type);
    expect(r.ctx.resumes).toBe(0);
  });

  it('resumes when the page is shown, and never while Practice is paused', async () => {
    const r = rig();
    r.doc.show(false);
    expect(r.ctx.resumes).toBe(0);
    r.ctx.resumeWill = 'hang'; // held until an input, as an engine may
    r.doc.show(true);
    expect(r.ctx.resumes).toBe(1);
    r.win.fire('pageshow');
    expect(r.ctx.resumes).toBe(2);
    r.out.setPaused(true);
    const asked = r.ctx.resumes;
    r.win.fire('keydown');
    r.win.fire('click');
    r.doc.show(true);
    expect(r.ctx.resumes).toBe(asked);
  });

  it('never throws a refused resume(), nor leaves its rejection unhandled (R-9)', async () => {
    const r = rig();
    r.ctx.resumeWill = 'refuse';
    expect(() => r.win.fire('keydown')).not.toThrow();
    r.ctx.resumeWill = 'throw';
    expect(() => r.win.fire('touchend')).not.toThrow();
    expect(() => r.doc.show(true)).not.toThrow();
    await turn();
    expect(unhandled).toEqual([]);
    expect(r.out.state).toBe('waiting');
    expect(r.out.waitsForInput).toBe(true);
    // And a later input that's allowed still starts it.
    r.ctx.resumeWill = 'run';
    r.win.fire('pointerup');
    await settle();
    expect(r.out.state).toBe('running');
  });

  it("suspends for Practice's pause, and resumes after it, with no prompt while it comes back (Q-15)", async () => {
    const r = rig('running');
    expect(r.out.waitsForInput).toBe(false);
    r.out.setPaused(true);
    r.out.setPaused(true); // once
    expect(r.ctx.suspends).toBe(1);
    await settle();
    expect(r.out.inspect()).toMatchObject({ state: 'waiting', paused: true });
    // Suspended on purpose: no input would help, so no prompt.
    expect(r.out.waitsForInput).toBe(false);
    r.ctx.resumeWill = 'hang';
    r.out.setPaused(false);
    expect(r.ctx.resumes).toBe(1);
    expect(r.out.inspect()).toMatchObject({ state: 'waiting', paused: false });
    // Coming back from the pause: not waiting for an input, so the prompt doesn't flash up meanwhile.
    expect(r.out.waitsForInput).toBe(false);
    // A context that waited for an input before the pause waits for one after it.
    const w = rig();
    w.out.setPaused(true);
    w.ctx.resumeWill = 'refuse';
    w.out.setPaused(false);
    await settle();
    expect(w.out.waitsForInput).toBe(true);
    // And one whose resume settles is no longer coming back.
    const s = rig('running');
    s.out.setPaused(true);
    await settle();
    s.ctx.resumeWill = 'refuse';
    s.out.setPaused(false);
    expect(s.out.waitsForInput).toBe(false);
    await settle();
    expect(s.out.waitsForInput).toBe(true);
    await turn();
    expect(unhandled).toEqual([]);
  });

  it("fades the master gain to Settings' sound", () => {
    const r = rig('running');
    const master = r.ctx.nodes[0] as FakeGain;
    r.ctx.currentTime = 3;
    r.out.setEnabled(false);
    expect(master.gain.events.at(-1)).toEqual({ type: 'target', value: 0, time: 3 });
    expect(r.out.enabled).toBe(false);
    r.out.setEnabled(true);
    expect(master.gain.events.at(-1)).toMatchObject({ type: 'target', time: 3 });
    expect(master.gain.events.at(-1)!.value).toBe(master.gain.value);
  });

  it("reports the sound layer's prompt as it's told", () => {
    const r = rig();
    expect(r.out.inspect().prompt).toBe(false);
    r.out.setPrompt(true);
    expect(r.out.inspect().prompt).toBe(true);
    r.out.setPrompt(false);
    expect(r.out.inspect().prompt).toBe(false);
  });

  it('hands the hook copies, so a reader never holds its counts', () => {
    const r = rig('running');
    const i = r.out.inspect();
    r.out.play(cue('bark'));
    expect([i.decided.bark, r.out.inspect().decided.bark]).toEqual([0, 1]);
    expect(r.out.inspect().decided).not.toBe(r.out.inspect().decided);
  });

  it('is none without Web Audio, or when a context cannot be made: no listener, no prompt, cues counted alone', () => {
    for (const win of [new FakeAudioWindow({ audio: false }), new FakeAudioWindow({ throws: true })]) {
      const doc = new FakeAudioDocument();
      const out = new AudioOut(win, doc);
      expect(out.state).toBe('none');
      expect(win.listeners).toEqual([]);
      expect(doc.listeners).toEqual([]);
      out.setEnabled(false);
      out.setPaused(true);
      out.setPaused(false);
      out.play(cue('whistleEnd'));
      expect(out.waitsForInput).toBe(false);
      expect(out.inspect()).toMatchObject({ state: 'none', enabled: false, paused: false, prompt: false });
      expect([out.inspect().decided.whistleEnd, out.inspect().played.whistleEnd]).toEqual([1, 0]);
    }
  });

  it("logs a sound that can't be scheduled once, and never throws it into the timer run", () => {
    const r = rig('running');
    r.ctx.createOscillator = () => {
      throw new Error('no oscillators');
    };
    const logged: unknown[][] = [];
    const error = console.error;
    console.error = (...a: unknown[]) => logged.push(a);
    try {
      expect(() => r.out.play(cue('thud'))).not.toThrow();
      expect(() => r.out.play(cue('thud'))).not.toThrow();
    } finally {
      console.error = error;
    }
    expect(logged).toHaveLength(1);
    expect(r.out.inspect().played.thud).toBe(0);
    expect(r.out.inspect().decided.thud).toBe(2);
  });
});
