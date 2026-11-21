// The sounds, made in code (PLAN D-32, §13; M4's design, research/m4/DESIGN.md,
// §1.28, §7): no sound file ships, so the dist audit's allowlist is enough.
// Each cue is a few Web Audio nodes scheduled at `at` on the context's clock,
// disconnected once its last source has stopped:
// - a bark: noise and a sawtooth through a band-pass whose centre falls, its
//   pitch and length a little different per terrier, seeded by its ID;
// - a thump: a low sine falling in pitch and a short low noise, louder and
//   lower for a harder hit, the cue's loudness;
// - a whoosh: noise through a band-pass that sweeps up and back down;
// - a thud: a lower sine than the thump's and a duller noise;
// - the whistles: a trilled pea whistle in blasts, each its own pattern: one
//   for a kickoff, a short and a long for a goal, three for the end;
// - a chorus: six barks in voices of its own seed, over half a second.
// Each is under 0.3 s but the whistles and the chorus (PLAN §13). The
// numbers here are the sounds' envelopes, the look's own and no setting
// (M4's design §0). Three-free. New at M4.

import type { CueKind } from '../ui/inspect';

/** A sound SoundCues decided (src/audio/cues.ts): its kind, a seed for its voice, and how loud, 0 to 1. */
export interface Cue {
  readonly kind: CueKind;
  readonly seed: number;
  readonly loudness: number;
}

/** A terrier's seed: its ID hashed (FNV-1a, 32 bits), so its bark sounds the same on every page. */
export function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32), 0 to 1: the same seed, the same sound. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** The quietest a sound plays at, of its full level, and the level an exponential fade ends at: an
 *  exponential ramp can neither start nor end at 0. */
const LEAST = 0.05;
const FADED = 0.001;
const level = (loudness: number): number => Math.max(LEAST, Math.min(1, Number.isFinite(loudness) ? loudness : 1));

const BARK = {
  /** The band-pass's centre, and the sawtooth's pitch, falling from top to end over the bark. */
  topHz: 1500, endHz: 650, voiceTopHz: 600, voiceEndHz: 320,
  q: 3, voiceMix: 0.35, attackSeconds: 0.008, peak: 0.5,
  /** A terrier's pitch factor and length: the least, and the span above it. */
  pitchLeast: 0.8, pitchSpan: 0.4, lengthLeast: 0.12, lengthSpan: 0.08,
};

const THUMP = {
  /** The sine's pitch, from top to end over the thump, each lower by its drop at full loudness. */
  topHz: 170, topDropHz: 80, endHz: 70, endDropHz: 25,
  lengthLeast: 0.12, lengthSpan: 0.08, attackSeconds: 0.004, peak: 0.25, peakRise: 0.65,
  /** The noise's slap: its low-pass, lower when harder, its length and its level. */
  slapHz: 1200, slapDropHz: 600, slapSeconds: 0.05, slapPeak: 0.1, slapRise: 0.3,
};

const WHOOSH = { fromHz: 500, topHz: 2600, endHz: 900, q: 1.2, topAt: 0.12, lengthSeconds: 0.26, attackSeconds: 0.1, peak: 0.35 };

const THUD = {
  topHz: 120, endHz: 45, lengthSeconds: 0.2, attackSeconds: 0.003, peak: 0.7,
  slapHz: 400, slapSeconds: 0.07, slapPeak: 0.3,
};

const WHISTLE = {
  /** A pea whistle: a triangle trilled by a sine on its pitch. */
  hz: 2900, trillHz: 32, trillDepthHz: 140,
  attackSeconds: 0.015, releaseSeconds: 0.03, gapSeconds: 0.12, peak: 0.28,
};

/** Each whistle's blasts, seconds, in order: its own pattern. */
export const BLASTS = {
  whistleKickoff: [0.45],
  whistleGoal: [0.16, 0.6],
  whistleEnd: [0.28, 0.28, 0.9],
} as const satisfies Readonly<Record<'whistleKickoff' | 'whistleGoal' | 'whistleEnd', readonly number[]>>;

const CHORUS = { voices: 6, spreadSeconds: 0.5, share: 0.55 };

/** A terrier's bark voice from its seed: a pitch factor on the bark's frequencies, and its length. */
export interface BarkVoice {
  readonly pitch: number;
  readonly seconds: number;
}

export function barkVoice(seed: number): BarkVoice {
  const r = generator(seed);
  return { pitch: BARK.pitchLeast + BARK.pitchSpan * r(), seconds: BARK.lengthLeast + BARK.lengthSpan * r() };
}

// --- The parts ---

/** A second of white noise for each context, made once and looped from a seeded offset. */
const NOISE_SECONDS = 1;
const NOISE_SEED = 0x5eed;
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noises.get(ctx);
  if (b === undefined) {
    const n = Math.round(ctx.sampleRate * NOISE_SECONDS);
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = b.getChannelData(0);
    const r = generator(NOISE_SEED);
    for (let i = 0; i < n; i++) data[i] = 2 * r() - 1;
    noises.set(ctx, b);
  }
  return b;
}

/** A cue's nodes, disconnected once its last source has stopped. */
class Parts {
  private readonly nodes: AudioNode[] = [];
  private last: { readonly node: AudioScheduledSourceNode; readonly stop: number } | null = null;

  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /** A source of the cue's, started at `at` and stopped at `stop`. */
  run(node: AudioScheduledSourceNode, at: number, stop: number, offset?: number): void {
    if (offset === undefined) node.start(at);
    else (node as AudioBufferSourceNode).start(at, offset);
    node.stop(stop);
    if (this.last === null || stop >= this.last.stop) this.last = { node, stop };
  }

  done(): void {
    const last = this.last;
    if (last === null) return;
    const nodes = this.nodes;
    last.node.onended = () => {
      for (const n of nodes) n.disconnect();
    };
  }
}

/** A gain that's silent at `at`, rises to `peak` over `attack` seconds, and fades to nothing by `end`. */
function envelope(ctx: BaseAudioContext, parts: Parts, at: number, peak: number, attack: number, end: number): GainNode {
  const g = parts.add(ctx.createGain());
  g.gain.value = 0;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(FADED * peak, end);
  g.gain.setValueAtTime(0, end);
  return g;
}

function noiseSource(ctx: BaseAudioContext, parts: Parts): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  s.loop = true;
  return parts.add(s);
}

function filter(ctx: BaseAudioContext, parts: Parts, type: BiquadFilterType, hz: number, q?: number): BiquadFilterNode {
  const f = parts.add(ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = hz;
  if (q !== undefined) f.Q.value = q;
  return f;
}

/** A frequency that starts at `from` and falls or rises exponentially to `to` by `end`. */
function glide(p: AudioParam, at: number, from: number, end: number, to: number): void {
  p.setValueAtTime(from, at);
  p.exponentialRampToValueAtTime(to, end);
}

// --- The sounds ---

function bark(ctx: BaseAudioContext, out: AudioNode, seed: number, at: number, peak: number): void {
  const parts = new Parts();
  const v = barkVoice(seed);
  const end = at + v.seconds;
  const band = filter(ctx, parts, 'bandpass', BARK.topHz * v.pitch, BARK.q);
  glide(band.frequency, at, BARK.topHz * v.pitch, end, BARK.endHz * v.pitch);
  const voice = parts.add(ctx.createOscillator());
  voice.type = 'sawtooth';
  glide(voice.frequency, at, BARK.voiceTopHz * v.pitch, end, BARK.voiceEndHz * v.pitch);
  const mix = parts.add(ctx.createGain());
  mix.gain.value = BARK.voiceMix;
  const hiss = noiseSource(ctx, parts);
  const env = envelope(ctx, parts, at, peak, BARK.attackSeconds, end);
  hiss.connect(band);
  voice.connect(mix).connect(band);
  band.connect(env).connect(out);
  parts.run(hiss, at, end, generator(seed ^ NOISE_SEED)() * NOISE_SECONDS);
  parts.run(voice, at, end);
  parts.done();
}

function thump(ctx: BaseAudioContext, out: AudioNode, cue: Cue, at: number): void {
  const parts = new Parts();
  const l = level(cue.loudness);
  const end = at + THUMP.lengthLeast + THUMP.lengthSpan * l;
  const body = parts.add(ctx.createOscillator());
  body.type = 'sine';
  glide(body.frequency, at, THUMP.topHz - THUMP.topDropHz * l, end, THUMP.endHz - THUMP.endDropHz * l);
  body.connect(envelope(ctx, parts, at, THUMP.peak + THUMP.peakRise * l, THUMP.attackSeconds, end)).connect(out);
  const slapEnd = at + THUMP.slapSeconds;
  const slap = noiseSource(ctx, parts);
  slap.connect(filter(ctx, parts, 'lowpass', THUMP.slapHz - THUMP.slapDropHz * l))
    .connect(envelope(ctx, parts, at, THUMP.slapPeak + THUMP.slapRise * l, THUMP.attackSeconds, slapEnd))
    .connect(out);
  parts.run(body, at, end);
  parts.run(slap, at, slapEnd, generator(cue.seed)() * NOISE_SECONDS);
  parts.done();
}

function whoosh(ctx: BaseAudioContext, out: AudioNode, cue: Cue, at: number): void {
  const parts = new Parts();
  const end = at + WHOOSH.lengthSeconds;
  const band = filter(ctx, parts, 'bandpass', WHOOSH.fromHz, WHOOSH.q);
  band.frequency.setValueAtTime(WHOOSH.fromHz, at);
  band.frequency.exponentialRampToValueAtTime(WHOOSH.topHz, at + WHOOSH.topAt);
  band.frequency.exponentialRampToValueAtTime(WHOOSH.endHz, end);
  const air = noiseSource(ctx, parts);
  air.connect(band).connect(envelope(ctx, parts, at, WHOOSH.peak * level(cue.loudness), WHOOSH.attackSeconds, end)).connect(out);
  parts.run(air, at, end, generator(cue.seed)() * NOISE_SECONDS);
  parts.done();
}

function thud(ctx: BaseAudioContext, out: AudioNode, cue: Cue, at: number): void {
  const parts = new Parts();
  const l = level(cue.loudness);
  const end = at + THUD.lengthSeconds;
  const body = parts.add(ctx.createOscillator());
  body.type = 'sine';
  glide(body.frequency, at, THUD.topHz, end, THUD.endHz);
  body.connect(envelope(ctx, parts, at, THUD.peak * l, THUD.attackSeconds, end)).connect(out);
  const slapEnd = at + THUD.slapSeconds;
  const slap = noiseSource(ctx, parts);
  slap.connect(filter(ctx, parts, 'lowpass', THUD.slapHz)).connect(envelope(ctx, parts, at, THUD.slapPeak * l, THUD.attackSeconds, slapEnd)).connect(out);
  parts.run(body, at, end);
  parts.run(slap, at, slapEnd, generator(cue.seed)() * NOISE_SECONDS);
  parts.done();
}

function whistle(ctx: BaseAudioContext, out: AudioNode, blasts: readonly number[], at: number, loudness: number): void {
  const parts = new Parts();
  const peak = WHISTLE.peak * level(loudness);
  const env = parts.add(ctx.createGain());
  env.gain.value = 0;
  let t = at;
  for (const b of blasts) {
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + WHISTLE.attackSeconds);
    env.gain.setValueAtTime(peak, t + b - WHISTLE.releaseSeconds);
    env.gain.linearRampToValueAtTime(0, t + b);
    t += b + WHISTLE.gapSeconds;
  }
  const end = t - WHISTLE.gapSeconds;
  const tone = parts.add(ctx.createOscillator());
  tone.type = 'triangle';
  tone.frequency.value = WHISTLE.hz;
  const trill = parts.add(ctx.createOscillator());
  trill.type = 'sine';
  trill.frequency.value = WHISTLE.trillHz;
  const depth = parts.add(ctx.createGain());
  depth.gain.value = WHISTLE.trillDepthHz;
  trill.connect(depth).connect(tone.frequency);
  tone.connect(env).connect(out);
  parts.run(trill, at, end);
  parts.run(tone, at, end);
  parts.done();
}

/** Six barks in voices of the chorus's seed, each starting within half a second. */
function chorus(ctx: BaseAudioContext, out: AudioNode, cue: Cue, at: number): void {
  const r = generator(cue.seed);
  const peak = BARK.peak * CHORUS.share * level(cue.loudness);
  for (let k = 0; k < CHORUS.voices; k++) bark(ctx, out, Math.imul(cue.seed ^ (k + 1), 0x9e3779b1) >>> 0, at + CHORUS.spreadSeconds * r(), peak);
}

type Sound = (ctx: BaseAudioContext, out: AudioNode, cue: Cue, at: number) => void;

const SOUNDS: Readonly<Record<CueKind, Sound>> = {
  bark: (ctx, out, cue, at) => bark(ctx, out, cue.seed, at, BARK.peak * level(cue.loudness)),
  thump,
  whoosh,
  thud,
  whistleKickoff: (ctx, out, cue, at) => whistle(ctx, out, BLASTS.whistleKickoff, at, cue.loudness),
  whistleGoal: (ctx, out, cue, at) => whistle(ctx, out, BLASTS.whistleGoal, at, cue.loudness),
  whistleEnd: (ctx, out, cue, at) => whistle(ctx, out, BLASTS.whistleEnd, at, cue.loudness),
  chorus,
};

/** The cue's sound into `out`, starting at `at` on the context's clock. */
export function schedule(ctx: BaseAudioContext, out: AudioNode, cue: Cue, at: number): void {
  SOUNDS[cue.kind](ctx, out, cue, at);
}
