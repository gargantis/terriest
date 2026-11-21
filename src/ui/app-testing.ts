// Test support for the app (M4's design, research/m4/DESIGN.md, §1.41,
// §5.1, §5.2, §9.2's app row): an App on the screens' DOM fake, its timers
// and matches in virtual time, with a fake for each part the page would
// hand it: a stage that records its prepares, animation frames the test
// runs, a keyboard-like device, the fragment as a page's (its hashchange a
// task after the change), the leave guard, or the App's own on a window the
// test gives, one browser's Web Locks for its tabs, the canary,
// results-hud's message screens by their shape, the real screen wake lock
// over a browser that refuses it, and a room's transport: one that reaches
// no one, or the test's, M3's network simulator's
// (src/ui/world-testing.ts). Only tests import it, so no build bundles it.
// New at M4, by phase 2's net-screens.

import { personId } from '../core/bot/bot-id';
import { TEST_BUILD } from '../core/timeline/testing';
import type { Device, DeviceState } from '../input/source';
import type { TransportOptions } from '../net/transport';
import type { RenderInfo } from '../render/stage-types';
import { MemoryStorage } from '../storage/kv';
import { ProfileStore } from '../storage/profile';
import { SettingsStore } from '../storage/settings';
import { holdTabLock, type TabLocks } from '../storage/tab-lock';
import { App, type AppLocation, appRoot, type MessageScreens } from './app';
import { FakeClock, type FakePage, fakePage } from './clock-testing';
import type { DeviceHost, PageDevices } from './devices';
import { h } from './dom';
import { fake, type FakeDocument, type FakeElement } from './dom-testing';
import type { AnimationFrames } from './frame-loop';
import type { TransportFactory } from './game';
import type { TerriestTest } from './inspect';
import type { LeaveGuard } from './leave-guard';
import { WakeLock } from './phone';
import type { InviteOptions } from './screens/invite';
import { FakeStage } from './pitch-testing';

/** The rigs' player: seed 7's first, as the specs' profiles are seeded (§9.1). */
export const ME = personId(7, 0);

/** A stage that records its prepare and disposal, with a canvas and the figures the hook reads, the
 *  governor's scale among them (§8.2). */
export class RecordingStage extends FakeStage {
  override readonly canvas: HTMLCanvasElement;
  prepares = 0;
  disposed = false;
  scale = 1;
  readonly quality: 'high' | 'low';

  constructor(doc: FakeDocument, calls: string[], quality: 'high' | 'low') {
    super(calls);
    this.canvas = doc.createElement('canvas') as unknown as HTMLCanvasElement;
    this.quality = quality;
  }

  override prepare(): Promise<void> {
    this.prepares++;
    return super.prepare();
  }

  override info(): RenderInfo {
    return { quality: this.quality, frames: this.drawn.length, lost: this.lost, scale: this.scale } as RenderInfo;
  }

  override setScale(scale: number): void {
    this.scale = scale;
  }

  override dispose(): void {
    this.disposed = true;
  }
}

/** Animation frames the test runs. */
export class Frames implements AnimationFrames {
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
export class Pad implements Device {
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

/** The fragment as a page's: replace() sets it at once, and its hashchange comes a task later, as a browser
 *  fires it; set() is a fragment typed or followed, its hashchange likewise. */
export interface TestLocation extends AppLocation {
  set(hash: string): void;
  /** Each replace(), in order: the app's only way to set the fragment. */
  readonly replaced: string[];
}

export function testLocation(clock: FakeClock, start = ''): TestLocation {
  let hash = start;
  const listeners: ((hash: string) => void)[] = [];
  const replaced: string[] = [];
  const fire = (h: string): void => {
    clock.after(0, () => {
      for (const fn of listeners) fn(h);
    });
  };
  return {
    hash: () => hash,
    replace: (h: string) => {
      replaced.push(h);
      const next = h === '#' ? '' : h;
      if (next === hash) return;
      hash = next;
      fire(h);
    },
    href: () => `https://terriest.test/play/${hash}`,
    onHashChange: (fn) => {
      listeners.push(fn);
      return () => {};
    },
    set: (h: string) => {
      hash = h;
      fire(h);
    },
    replaced,
  };
}

export interface TestGuard extends LeaveGuard {
  /** Each set(), in order. */
  readonly sets: boolean[];
}

export function testGuard(): TestGuard {
  const sets: boolean[] = [];
  let active = false;
  return {
    set: (on) => {
      sets.push(on);
      active = on;
    },
    get active() {
      return active;
    },
    sets,
  };
}

/** One browser's Web Locks, shared by its tabs: ifAvailable is granted only a free lock; steal takes it,
 *  the holder's request rejecting with an AbortError (src/storage/tab-lock.test.ts's rules). */
export class Locks implements TabLocks {
  private holder: { readonly reject: (e: unknown) => void } | null = null;

  request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      queueMicrotask(() => {
        if (this.holder !== null && options.steal !== true) {
          Promise.resolve(callback(null)).then(resolve, reject);
          return;
        }
        this.holder?.reject(new DOMException('The lock was stolen', 'AbortError'));
        const me = { reject };
        this.holder = me;
        Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).then(resolve, reject);
      });
    });
  }
}

/** results-hud's message screens (src/ui/screens/message.ts), faked by their shape: each a section with
 *  its code in data-message, its code as its heading, and a button for each action handed to it. */
export const FAKE_MESSAGES: MessageScreens<string> = {
  MESSAGES: { canary: 'canary', 'other-tab': 'other-tab', graphics: 'graphics' },
  PRACTICE_GRAPHICS: 'practice-graphics',
  messageScreen: (code, act) => ({
    el: h('section', { role: 'alert', 'data-message': code, 'data-test': 'message' },
      h('h1', {}, code),
      ...Object.entries(act).map(([k, fn]) => h('button', { type: 'button', 'data-test': `message-${k}`, onclick: fn }, k))),
    name: 'message',
  }),
};

/** A room's transport that reaches no one, each room's options noted. */
export function nowhere(rooms: TransportOptions[]): TransportFactory {
  return (_peer, _now, o) => {
    rooms.push(o);
    return Promise.resolve({ send: () => {}, broadcast: () => {}, peerCount: () => 0, refusedBy: null, leave: () => Promise.resolve() });
  };
}

export interface AppRig {
  readonly app: App;
  readonly root: FakeElement;
  readonly clock: FakeClock;
  readonly page: FakePage;
  readonly frames: Frames;
  readonly stages: RecordingStage[];
  readonly calls: string[];
  readonly test: TerriestTest;
  readonly settings: SettingsStore;
  readonly location: TestLocation;
  readonly device: Pad;
  /** The devices' host, as the app made it. */
  host(): DeviceHost;
  /** started(), the screen and the hook as boot saw them, and each lock request: 'lock' or 'steal'. */
  readonly order: string[];
  readonly guard: TestGuard;
  /** The canary's computations, each its verdict. */
  readonly canaries: boolean[];
  /** Each room the app opened, by the transport's options. */
  readonly rooms: TransportOptions[];
  /** Each wake lock wish, in order. */
  readonly wakes: boolean[];
  /** Each control the controls reported used, as the page's devices heard it (PageDevices.used): 'kind control'. */
  readonly used: string[];
  /** Each write a Copy made. */
  readonly copied: string[];
}

export interface AppRigOptions {
  readonly doc: FakeDocument;
  readonly hash?: string;
  /** One browser's locks, for two tabs; none: no Web Locks. */
  readonly locks?: TabLocks;
  readonly canary?: boolean;
  readonly clock?: FakeClock;
  /** The browser's storage: a tab's own, or one two tabs share. */
  readonly storage?: MemoryStorage;
  /** This page's player: ME by default. */
  readonly me?: string;
  /** The rooms' transport: none reaches anyone by default. */
  readonly transport?: (rooms: TransportOptions[]) => TransportFactory;
  /** The hook a spec would set: the relay and ICE among it. */
  readonly test?: TerriestTest;
  /** The App installs its own leave guard, on the global window the test has set, as a page's does
   *  (installLeaveGuard); the rig's guard is then left unused. */
  readonly realGuard?: boolean;
}

/** An App in the document `doc`, with every fake, its landmark hidden until boot says started. */
export function appRig(o: AppRigOptions): AppRig {
  const calls: string[] = [];
  const order: string[] = [];
  const clock = o.clock ?? new FakeClock(1000);
  const page = fakePage();
  const frames = new Frames();
  const stages: RecordingStage[] = [];
  const makeStage = (q: 'high' | 'low'): RecordingStage => {
    const s = new RecordingStage(o.doc, calls, q);
    stages.push(s);
    return s;
  };
  const root = fake(appRoot());
  // index.html hides the landmark until boot.js says started: nothing in it takes the focus till then.
  root.hidden = true;
  o.doc.body.append(root);
  const storage = o.storage ?? new MemoryStorage();
  const settings = new SettingsStore(storage, { reducedMotion: () => false, qualityDefault: () => 'high' });
  const me = o.me ?? ME;
  const profile = new ProfileStore(storage, () => me, () => 3);
  const test: TerriestTest = o.test ?? {};
  const location = testLocation(clock, o.hash ?? '');
  const device = new Pad();
  let deviceHost: DeviceHost | null = null;
  const used: string[] = [];
  const devices = (hostOf: DeviceHost): PageDevices => {
    deviceHost = hostOf;
    return { list: () => [device], gamepad: () => null, used: (k, c) => used.push(`${k} ${c}`), dispose: () => {} };
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
  const guard = testGuard();
  const canaries: boolean[] = [];
  const rooms: TransportOptions[] = [];
  const wakes: boolean[] = [];
  const copied: string[] = [];
  const invite: InviteOptions = {
    clipboard: { writeText: (text) => { copied.push(text); return Promise.resolve(); } },
    share: null,
  };
  const first = makeStage(settings.get().quality);
  // The real wake lock, which this browser refuses, as headless engines do: its refusal for the hook.
  const wakeLock = new WakeLock({ request: () => Promise.reject(new DOMException('No wake lock here', 'NotAllowedError')), page });
  const app = new App({
    root: root as unknown as HTMLElement, stage: first, makeStage, profile, settings, test, build: TEST_BUILD, clock, page, boot,
    location, devices, frames, messages: FAKE_MESSAGES, invite,
    ...(o.realGuard === true ? {} : { guard }),
    wake: {
      want: (on) => {
        wakes.push(on);
        wakeLock.want(on);
      },
      inspect: () => wakeLock.inspect(),
    },
    lock: (steal, onLost) => {
      order.push(steal ? 'steal' : 'lock');
      return holdTabLock(steal, onLost, o.locks ?? null);
    },
    canary: () => {
      const ok = o.canary ?? true;
      canaries.push(ok);
      return ok;
    },
    transport: (o.transport ?? nowhere)(rooms), devRelay: () => Promise.resolve(null),
  });
  return {
    app, root, clock, page, frames, stages, calls, test, settings, location, device, host: () => deviceHost!, order, guard, canaries, rooms, wakes,
    used, copied,
  };
}
