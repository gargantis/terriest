// Test support for the sound (M4's design, research/m4/DESIGN.md, §1.27,
// §1.28, §7, §9.2): there's no Web Audio in Node, so a context that records
// what the synth builds, each node's connections, each source's start and
// stop, and each AudioParam's automation, and whose resume() the test makes
// run, refuse, throw or hang, as a browser's autoplay rules would; and a
// window and a document whose events the test fires. It keeps the rules the
// real API enforces that a sound could break silently or loudly: an
// exponential ramp to 0 throws a RangeError, as the real one does, and one
// from 0, which the real one holds at 0 for good, throws here too; a source
// starts once, at a time not in the past. Only tests import it, so no build
// bundles it. New at M4.

import type { AudioDocument, AudioWindow } from './audio';

export interface ParamEvent {
  readonly type: 'set' | 'linear' | 'exponential' | 'target';
  readonly value: number;
  readonly time: number;
}

/** An AudioParam: its value and the automation scheduled on it, in order. */
export class FakeParam {
  value: number;
  readonly events: ParamEvent[] = [];
  /** The nodes connected to it: a modulation, such as the whistle's trill. */
  readonly inputs: FakeNode[] = [];

  constructor(value: number) {
    this.value = value;
  }

  /** The value the last event leaves, or the value with none. */
  get last(): number {
    return this.events.at(-1)?.value ?? this.value;
  }

  /** The largest value it's set or ramped to. */
  get peak(): number {
    return Math.max(this.value, ...this.events.map((e) => e.value));
  }

  /** The value set first: a glide's start. */
  get first(): number {
    return this.events[0]?.value ?? this.value;
  }

  setValueAtTime(value: number, time: number): this {
    return this.event('set', value, time);
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.event('linear', value, time);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (!(value > 0 || value < 0)) throw new RangeError(`an exponential ramp to ${value}`);
    if (this.last === 0) throw new Error('an exponential ramp from 0 stays at 0');
    return this.event('exponential', value, time);
  }

  setTargetAtTime(value: number, time: number, _timeConstant: number): this {
    return this.event('target', value, time);
  }

  cancelScheduledValues(time: number): this {
    for (let k = this.events.length - 1; k >= 0; k--) if (this.events[k]!.time >= time) this.events.splice(k, 1);
    return this;
  }

  private event(type: ParamEvent['type'], value: number, time: number): this {
    if (!Number.isFinite(value) || !Number.isFinite(time) || time < 0) throw new RangeError(`${type} to ${value} at ${time}`);
    this.events.push({ type, value, time });
    return this;
  }
}

/** A node: what it's connected to, and whether it's been disconnected. */
export class FakeNode {
  readonly kind: string;
  readonly outputs: (FakeNode | FakeParam)[] = [];
  disconnects = 0;

  constructor(kind: string) {
    this.kind = kind;
  }

  connect<T extends FakeNode | FakeParam>(to: T): T {
    this.outputs.push(to);
    if (to instanceof FakeParam) to.inputs.push(this);
    return to;
  }

  disconnect(): void {
    this.outputs.length = 0;
    this.disconnects++;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);

  constructor() {
    super('gain');
  }
}

/** A scheduled source: an oscillator or a buffer's. */
export class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  offset = 0;
  onended: (() => void) | null = null;

  start(when = 0, offset = 0): void {
    if (this.startAt !== null) throw new Error(`a ${this.kind} started twice`);
    if (!(when >= 0)) throw new RangeError(`a ${this.kind} started at ${when}`);
    this.startAt = when;
    this.offset = offset;
  }

  stop(when = 0): void {
    if (this.startAt === null) throw new Error(`a ${this.kind} stopped before it started`);
    this.stopAt = when;
  }
}

export class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);

  constructor() {
    super('oscillator');
  }
}

export class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(c: number): Float32Array {
    const d = this.data[c];
    if (d === undefined) throw new RangeError(`no channel ${c}`);
    return d;
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);

  constructor() {
    super('buffer');
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
  readonly detune = new FakeParam(0);

  constructor() {
    super('filter');
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);

  constructor() {
    super('compressor');
  }
}

/** What the context's resume() does: start it, refuse it as autoplay rules may, throw at once, or never
 *  settle, as an engine may hold it until an input. */
export type ResumeOutcome = 'run' | 'refuse' | 'throw' | 'hang';

/** An AudioContext that records what's made on it. */
export class FakeContext {
  state: 'suspended' | 'running' | 'closed';
  currentTime = 0;
  readonly sampleRate = 48000;
  readonly destination = new FakeNode('destination');
  /** Every node made on it, in order, the master's among them. */
  readonly nodes: FakeNode[] = [];
  readonly buffers: FakeBuffer[] = [];
  resumeWill: ResumeOutcome = 'run';
  resumes = 0;
  suspends = 0;

  constructor(state: 'suspended' | 'running' = 'suspended') {
    this.state = state;
  }

  /** The sources made on it, in order. */
  get sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }

  createGain(): FakeGain {
    return this.made(new FakeGain());
  }

  createOscillator(): FakeOscillator {
    return this.made(new FakeOscillator());
  }

  createBufferSource(): FakeBufferSource {
    return this.made(new FakeBufferSource());
  }

  createBiquadFilter(): FakeFilter {
    return this.made(new FakeFilter());
  }

  createDynamicsCompressor(): FakeCompressor {
    return this.made(new FakeCompressor());
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const b = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(b);
    return b;
  }

  resume(): Promise<void> {
    this.resumes++;
    switch (this.resumeWill) {
      case 'throw':
        throw new Error('resume() refused at once');
      case 'refuse':
        return Promise.reject(new Error('NotAllowedError: resume() refused'));
      case 'hang':
        return new Promise<void>(() => {});
      case 'run':
        return Promise.resolve().then(() => {
          if (this.state !== 'closed') this.state = 'running';
        });
    }
  }

  suspend(): Promise<void> {
    this.suspends++;
    return Promise.resolve().then(() => {
      if (this.state !== 'closed') this.state = 'suspended';
    });
  }

  /** The context as the DOM types it, for the code under test. */
  get asContext(): AudioContext {
    return this as unknown as AudioContext;
  }

  private made<T extends FakeNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
}

export interface Listened {
  readonly type: string;
  readonly fn: () => void;
  readonly options: AddEventListenerOptions | undefined;
}

/** A window: its AudioContext, absent or throwing as the test asks, the contexts it made, and its events. */
export class FakeAudioWindow implements AudioWindow {
  readonly AudioContext: (new () => AudioContext) | undefined;
  readonly contexts: FakeContext[] = [];
  readonly listeners: Listened[] = [];

  constructor(o: { readonly audio?: boolean; readonly throws?: boolean; readonly state?: 'suspended' | 'running' } = {}) {
    const made = this.contexts;
    this.AudioContext = o.audio === false ? undefined : (function AudioContext(): FakeContext {
      if (o.throws === true) throw new Error('no audio device');
      const c = new FakeContext(o.state ?? 'suspended');
      made.push(c);
      return c;
    } as unknown as new () => AudioContext);
  }

  /** The one context it made. */
  get context(): FakeContext {
    const c = this.contexts[0];
    if (c === undefined || this.contexts.length !== 1) throw new Error(`${this.contexts.length} contexts made`);
    return c;
  }

  addEventListener(type: string, fn: () => void, options?: AddEventListenerOptions): void {
    this.listeners.push({ type, fn, options });
  }

  fire(type: string): void {
    for (const l of [...this.listeners]) if (l.type === type) l.fn();
  }
}

/** A document whose visibility the test changes, each change telling its listeners. */
export class FakeAudioDocument implements AudioDocument {
  visibilityState: DocumentVisibilityState = 'visible';
  readonly listeners: (() => void)[] = [];

  addEventListener(_type: 'visibilitychange', fn: () => void): void {
    this.listeners.push(fn);
  }

  show(on: boolean): void {
    this.visibilityState = on ? 'visible' : 'hidden';
    for (const fn of [...this.listeners]) fn();
  }
}

/** Every pending promise callback run: the context's state changes, and resume()'s settling. */
export async function settle(): Promise<void> {
  for (let k = 0; k < 5; k++) await Promise.resolve();
}
