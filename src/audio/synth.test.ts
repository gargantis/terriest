import { describe, expect, it, vi } from 'vitest';
import type { CueKind } from '../ui/inspect';
import { FakeBufferSource, FakeContext, FakeGain, FakeNode, FakeOscillator, type FakeParam, type FakeSource } from './audio-testing';
import { barkVoice, BLASTS, type Cue, schedule, seedOf } from './synth';

// The sounds made in code (PLAN D-32, §13; M4's design §1.28, §7), on a
// context that records what they build: every cue reaches the output it's
// given, from sources started at its time and stopped; each is under 0.3 s
// but the whistles and the chorus; a bark's pitch and length are its
// terrier's own, the same on every page; a thump is louder and lower the
// harder the hit; each whistle has its own pattern of blasts; a cue's nodes
// are disconnected once its last source ends; and the noise is made once
// for a context.

// The seeds' sweep takes 1.6 s alone and over 5 s beside the whole unit stage.
vi.setConfig({ testTimeout: 60_000 });

const AT = 2;
const ALL: readonly CueKind[] = ['bark', 'thump', 'whoosh', 'thud', 'whistleKickoff', 'whistleGoal', 'whistleEnd', 'chorus'];
const ID = 'b'.repeat(32);

/** The cue scheduled at AT on a fresh context, into an output of its own. */
function scheduled(cue: Cue): { ctx: FakeContext; out: FakeGain; sources: FakeSource[] } {
  const ctx = new FakeContext('running');
  const out = new FakeGain();
  schedule(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, cue, AT);
  return { ctx, out, sources: ctx.sources };
}

/** Whether `node` reaches `out` through its connections, a param's node onward included. */
function reaches(node: FakeNode, out: FakeNode, ctx: FakeContext): boolean {
  if (node === out) return true;
  return node.outputs.some((o) => {
    if (o instanceof FakeNode) return reaches(o, out, ctx);
    const owner = ctx.nodes.find((n) => Object.values(n).includes(o));
    return owner !== undefined && reaches(owner, out, ctx);
  });
}

/** The latest a source of the cue stops, after AT. */
const length = (sources: readonly FakeSource[]): number => Math.max(...sources.map((s) => s.stopAt! - AT));

/** The gains on the way out whose envelope rises from 0: each blast a rise. */
function rises(p: FakeParam): number {
  let n = 0;
  for (let k = 1; k < p.events.length; k++) if (p.events[k - 1]!.value === 0 && p.events[k]!.value > 0) n++;
  return n;
}

describe('the sounds (D-32)', () => {
  it('reach the output from sources started at the cue and stopped, every kind', () => {
    for (const kind of ALL) {
      const { ctx, out, sources } = scheduled({ kind, seed: 7, loudness: 1 });
      expect(sources.length, kind).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s.startAt, kind).toBeGreaterThanOrEqual(AT);
        expect(s.stopAt, kind).toBeGreaterThan(s.startAt!);
        expect(reaches(s, out, ctx), `${kind}: a ${s.kind} reaches the output`).toBe(true);
      }
      // Into the output given, never straight to the speakers past the master gain.
      expect(ctx.nodes.some((n) => n.outputs.includes(ctx.destination)), kind).toBe(false);
    }
  });

  it('are each under 0.3 s but the whistles and the chorus (PLAN §13), at any seed and loudness', () => {
    // Many terriers' seeds, so a voice at the edge of its range is among them.
    const seeds = [0, 1, 7, 0xffffffff, seedOf(ID), ...Array.from({ length: 300 }, (_, k) => seedOf(k.toString(16).padStart(32, '0')))];
    for (const kind of ['bark', 'thump', 'whoosh', 'thud'] as const) {
      for (const seed of seeds) {
        for (const loudness of [0, 0.3, 1]) expect(length(scheduled({ kind, seed, loudness }).sources), `${kind} ${seed} ${loudness}`).toBeLessThan(0.3);
      }
    }
    // The whistles last longer, and the chorus may, but not long.
    for (const kind of ['whistleKickoff', 'whistleGoal', 'whistleEnd'] as const) {
      const s = length(scheduled({ kind, seed: 3, loudness: 1 }).sources);
      expect(s, kind).toBeGreaterThan(0.3);
      expect(s, kind).toBeLessThan(2);
    }
    for (const seed of [0, 3, 1234]) expect(length(scheduled({ kind: 'chorus', seed, loudness: 1 }).sources)).toBeLessThan(1);
  });

  it("gives each terrier a bark of its own, a little different in pitch and length, the same on every page", () => {
    const ids = Array.from({ length: 12 }, (_, k) => `${k.toString(16).padStart(2, '0')}${'0'.repeat(30)}`);
    const voices = ids.map((id) => barkVoice(seedOf(id)));
    for (const v of voices) {
      expect(v.pitch).toBeGreaterThanOrEqual(0.8);
      expect(v.pitch).toBeLessThanOrEqual(1.2);
      expect(v.seconds).toBeGreaterThanOrEqual(0.12);
      expect(v.seconds).toBeLessThanOrEqual(0.2);
    }
    // Each its own, and spread over the range rather than bunched in a corner of it.
    const pitches = voices.map((v) => v.pitch);
    const lengths = voices.map((v) => v.seconds);
    expect(new Set(pitches).size).toBe(ids.length);
    expect(new Set(lengths).size).toBe(ids.length);
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(0.2);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(0.04);
    // The same ID, the same bark on every page: the seed is FNV-1a of the ID alone (its published vectors).
    expect([seedOf(''), seedOf('a'), seedOf('foobar')]).toEqual([0x811c9dc5, 0xe40c292c, 0xbf9cf968]);
    expect(barkVoice(seedOf(ids[3]!))).toEqual(voices[3]);
    // And what's scheduled follows the voice: its pitch where the sawtooth starts, its length where it stops.
    for (const k of [0, 5]) {
      const v = voices[k]!;
      const { sources } = scheduled({ kind: 'bark', seed: seedOf(ids[k]!), loudness: 1 });
      const saw = sources.find((s): s is FakeOscillator => s instanceof FakeOscillator)!;
      expect(saw.type).toBe('sawtooth');
      expect(saw.frequency.first).toBeCloseTo(600 * v.pitch, 6);
      expect(saw.frequency.last).toBeLessThan(saw.frequency.first); // a falling pitch
      expect(length(sources)).toBeCloseTo(v.seconds, 9);
      // Noise in it: a buffer source of the context's noise.
      expect(sources.some((s) => s instanceof FakeBufferSource && s.buffer !== null)).toBe(true);
    }
  });

  it('thumps louder and lower the harder the hit', () => {
    const at = (loudness: number): { pitch: number; peak: number } => {
      const { ctx, sources } = scheduled({ kind: 'thump', seed: 1, loudness });
      const sine = sources.find((s): s is FakeOscillator => s instanceof FakeOscillator)!;
      const env = ctx.nodes.find((n): n is FakeGain => sine.outputs.includes(n) && n instanceof FakeGain)!;
      return { pitch: sine.frequency.first, peak: env.gain.peak };
    };
    const soft = at(0.1);
    const hard = at(1);
    expect(hard.pitch).toBeLessThan(soft.pitch);
    expect(hard.peak).toBeGreaterThan(soft.peak);
    expect(at(0).peak).toBeGreaterThan(0); // the softest is still heard
  });

  it('blows each whistle in its own pattern: one blast for a kickoff, a short and a long for a goal, three for the end', () => {
    const blasts = (kind: 'whistleKickoff' | 'whistleGoal' | 'whistleEnd'): number => {
      const { ctx, out } = scheduled({ kind, seed: 0, loudness: 1 });
      const env = ctx.nodes.find((n): n is FakeGain => n instanceof FakeGain && n.outputs.includes(out))!;
      return rises(env.gain);
    };
    expect([blasts('whistleKickoff'), blasts('whistleGoal'), blasts('whistleEnd')]).toEqual([1, 2, 3]);
    expect([BLASTS.whistleKickoff.length, BLASTS.whistleGoal.length, BLASTS.whistleEnd.length]).toEqual([1, 2, 3]);
    expect(BLASTS.whistleGoal[0]).toBeLessThan(BLASTS.whistleGoal[1]);
    // A trilled whistle: a second oscillator on the tone's pitch.
    const { ctx } = scheduled({ kind: 'whistleKickoff', seed: 0, loudness: 1 });
    const tone = ctx.sources.find((s): s is FakeOscillator => s instanceof FakeOscillator && s.type === 'triangle')!;
    expect(tone.frequency.inputs).toHaveLength(1);
  });

  it('sings a chorus of six barks, each its own voice', () => {
    const { sources } = scheduled({ kind: 'chorus', seed: 1234, loudness: 1 });
    const saws = sources.filter((s): s is FakeOscillator => s instanceof FakeOscillator && s.type === 'sawtooth');
    expect(saws).toHaveLength(6);
    expect(new Set(saws.map((s) => s.frequency.first.toFixed(3))).size).toBe(6);
    expect(new Set(saws.map((s) => s.startAt)).size).toBeGreaterThan(1); // not all at once
  });

  it("disconnects a cue's nodes once its last source has ended", () => {
    for (const kind of ALL) {
      const { ctx, sources } = scheduled({ kind, seed: 9, loudness: 1 });
      const ending = sources.filter((s) => s.onended !== null);
      expect(ending.length, kind).toBeGreaterThan(0);
      // Each sound's handler sits on its last source to stop.
      for (const s of ending) s.onended!();
      for (const n of ctx.nodes) expect(n.disconnects, `${kind}: a ${n.kind}`).toBeGreaterThan(0);
    }
  });

  it('makes the noise once for a context, a second long', () => {
    const ctx = new FakeContext('running');
    const out = new FakeGain();
    for (const kind of ['bark', 'thump', 'whoosh', 'thud'] as const) schedule(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, { kind, seed: 1, loudness: 1 }, AT);
    expect(ctx.buffers).toHaveLength(1);
    const b = ctx.buffers[0]!;
    expect(b.length).toBe(ctx.sampleRate);
    const data = b.getChannelData(0);
    expect(data.some((x) => x !== 0)).toBe(true);
    expect(data.every((x) => x >= -1 && x <= 1)).toBe(true);
    for (const s of ctx.sources) if (s instanceof FakeBufferSource) expect([s.buffer, s.loop]).toEqual([b, true]);
  });
});
