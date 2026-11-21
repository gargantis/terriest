// Phones (PLAN D-30, L169, L170, C-37; M4's design, research/m4/DESIGN.md,
// §1.48, §5.13, §9.1's guard):
// - a phone is a coarse-pointer screen whose shorter side is under
//   phoneShortSideCssPx (isPhone);
// - held upright, Pre-match and Match say "Turn your phone sideways to
//   play", spectators' too; if it stays upright, the prompt adds that
//   rotation lock may be on, and on Android offers Play full screen, which
//   enters fullscreen and locks the orientation to landscape
//   (turnPromptLayer, the layer named 'turn' over each pitch);
// - a screen wake lock is held during Pre-match and Match, by that layer,
//   and on Created until someone joins, where the browser offers one,
//   requested again at each visibilitychange to visible, since the browser
//   drops it whenever the page is hidden (WakeLock).
// The wake lock's request, fullscreen's and the orientation lock's are
// refused by headless engines and by many phones: each refusal is caught
// and reported through the turn prompt's inspect(), never a console error
// or an unhandled rejection, and the page plays on without it. Where the
// page has no window, as in Node's tests, the prompt never shows and asks
// for nothing. The prompt's look is src/ui/touch.css's. New at M4.

import { config } from '../config';
import { browserPage, type PageEvents } from './clock';
import { h, setShown } from './dom';
import type { Layer, PitchHost } from './layer';
import { addStyle } from './style';
import css from './touch.css?inline';

/** How long the prompt shows before it adds the rotation lock and Play full screen: "if it stays
 *  upright" (D-30). A layout constant, as the HUD's "Go!" second is. */
export const UPRIGHT_HINT_MS = 4000;

/** What isPhone reads of a window. */
export interface PhoneWindow {
  matchMedia(query: string): { readonly matches: boolean };
  readonly screen: { readonly width: number; readonly height: number };
}

/** D-30's rule: a coarse pointer, and the screen's shorter side under phoneShortSideCssPx. */
const phoneBy = (coarse: boolean, screen: PhoneWindow['screen']): boolean =>
  coarse && Math.min(screen.width, screen.height) < config.phoneShortSideCssPx;

/** A phone (D-30): a coarse pointer, and the screen's shorter side under phoneShortSideCssPx. */
export function isPhone(w: PhoneWindow = window): boolean {
  return phoneBy(w.matchMedia('(pointer: coarse)').matches, w.screen);
}

/** A refusal as the hook reports it: the exception's name (NotAllowedError, NotSupportedError, …). */
function refusal(e: unknown): string {
  const name = (e as { readonly name?: unknown } | null)?.name;
  if (typeof name === 'string' && name !== '' && name !== 'Error') return name;
  const message = (e as { readonly message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : String(e);
}

/** A promise that may refuse, a synchronous throw its refusal, and an API without a promise resolving. */
function attempt(f: () => Promise<void> | void): Promise<void> {
  try {
    return Promise.resolve(f());
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

// --- The wake lock ---

/** A held screen wake lock, as navigator.wakeLock.request('screen') resolves one. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}

export type WakeLockRequest = () => Promise<WakeLockSentinelLike>;

/** navigator.wakeLock.request('screen'), or null where the browser offers none. */
export function browserWakeLock(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): WakeLockRequest | null {
  const lock = (nav as { readonly wakeLock?: { request?: (type: 'screen') => Promise<WakeLockSentinelLike> } } | undefined)?.wakeLock;
  const request = lock?.request;
  return typeof request === 'function' ? () => request.call(lock, 'screen') : null;
}

export interface WakeLockInspection {
  readonly wanted: boolean;
  readonly state: 'off' | 'requesting' | 'held' | 'released' | 'refused' | 'unsupported';
  readonly requests: number;
  readonly refusals: number;
  readonly lastRefusal: string | null;
}

/** A screen wake lock, held while wanted and the page is visible (D-30). */
export class WakeLock {
  private readonly request: WakeLockRequest | null;
  private readonly page: PageEvents;
  private wanted = false;
  private state: WakeLockInspection['state'] = 'off';
  private sentinel: WakeLockSentinelLike | null = null;
  private pending = false;
  private requests = 0;
  private refusals = 0;
  private lastRefusal: string | null = null;
  private stopWatching: (() => void) | null = null;

  constructor(o: { readonly request?: WakeLockRequest | null; readonly page?: PageEvents } = {}) {
    this.request = o.request === undefined ? browserWakeLock() : o.request;
    this.page = o.page ?? browserPage;
  }

  /** Held from now while on, requested again whenever the page shows again; let go when off. */
  want(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (this.request === null) {
      this.state = on ? 'unsupported' : 'off';
      return;
    }
    if (on) {
      this.stopWatching = this.page.onVisibility(() => this.acquire());
      this.acquire();
    } else {
      this.stopWatching?.();
      this.stopWatching = null;
      this.drop();
    }
  }

  inspect(): WakeLockInspection {
    return { wanted: this.wanted, state: this.state, requests: this.requests, refusals: this.refusals, lastRefusal: this.lastRefusal };
  }

  private acquire(): void {
    const request = this.request;
    if (request === null || !this.wanted || this.sentinel !== null || this.pending || this.page.hidden()) return;
    this.pending = true;
    this.requests++;
    this.state = 'requesting';
    attempt(async () => {
      const s = await request();
      if (!this.wanted) {
        // Let go before it came: released at once, its refusal ignored.
        s.release().catch(() => {});
        return;
      }
      this.sentinel = s;
      this.state = 'held';
      s.addEventListener('release', () => {
        if (this.sentinel !== s) return;
        this.sentinel = null;
        this.state = 'released';
      });
    }).then(
      () => {
        this.pending = false;
      },
      (e: unknown) => {
        this.pending = false;
        this.refusals++;
        this.lastRefusal = refusal(e);
        this.state = 'refused';
      },
    );
  }

  private drop(): void {
    const s = this.sentinel;
    this.sentinel = null;
    this.state = 'off';
    s?.release().catch(() => {});
  }
}

// --- The turn prompt ---

/** What the turn prompt reads and asks of the page, so its tests need no browser. */
export interface PhonePage {
  /** isPhone's. */
  phone(): boolean;
  /** The viewport in portrait. */
  upright(): boolean;
  /** Android, where Play full screen is offered (D-30). */
  android(): boolean;
  /** fn on each change of the viewport's size or orientation; returns its removal. */
  onChange(fn: () => void): () => void;
  /** Fullscreen, which a browser may refuse. */
  enterFullscreen(): Promise<void>;
  /** The orientation locked to landscape, which a browser may refuse. */
  lockLandscape(): Promise<void>;
  /** A wake lock of the page's. */
  wakeLock(): WakeLock;
}

/** The page's own: a phone's checks, its fullscreen and its locks; with no window, a page that's no phone
 *  and offers none of them. */
export function browserPhone(w: Window | null = typeof window === 'undefined' ? null : window): PhonePage {
  if (w === null) {
    const none = (): Promise<void> => Promise.reject(new Error('no window'));
    return {
      phone: () => false, upright: () => false, android: () => false, onChange: () => () => {},
      enterFullscreen: none, lockLandscape: none, wakeLock: () => new WakeLock({ request: null }),
    };
  }
  // Kept, so a frame's check makes no new query: a media query list's matches follow the page.
  const coarse = w.matchMedia('(pointer: coarse)');
  const portrait = w.matchMedia('(orientation: portrait)');
  return {
    phone: () => phoneBy(coarse.matches, w.screen),
    upright: () => portrait.matches,
    android: () => /Android/i.test(w.navigator.userAgent),
    onChange: (fn) => {
      w.addEventListener('resize', fn);
      portrait.addEventListener('change', fn);
      return () => {
        w.removeEventListener('resize', fn);
        portrait.removeEventListener('change', fn);
      };
    },
    enterFullscreen: () => attempt(() => w.document.documentElement.requestFullscreen({ navigationUI: 'hide' })),
    lockLandscape: () =>
      attempt(() => {
        // Not in every engine's ScreenOrientation, nor in every lib's.
        const o = w.screen.orientation as unknown as { lock?: (orientation: string) => Promise<void> } | undefined;
        if (o === undefined || typeof o.lock !== 'function') throw new Error('NotSupportedError');
        return o.lock('landscape');
      }),
    wakeLock: () => new WakeLock({ request: browserWakeLock(w.navigator) }),
  };
}

/** Inspection.layers.turn. */
export interface TurnInspection {
  readonly phone: boolean;
  readonly upright: boolean;
  /** "Turn your phone sideways to play" shows. */
  readonly shown: boolean;
  /** It stayed upright: the rotation lock's line shows. */
  readonly still: boolean;
  /** Play full screen offered, on Android. */
  readonly fullscreenOffered: boolean;
  /** Play full screen's presses, and how each part went: 'entered', 'locked', or the refusal's name. */
  readonly presses: number;
  readonly fullscreen: string | null;
  readonly orientation: string | null;
  /** Pre-match's and Match's wake lock. */
  readonly wakeLock: WakeLockInspection;
}

/** The turn prompt over the pitch (§1.48, §5.13), players' and spectators', and the pitch's wake lock. */
export function turnPromptLayer(host: PitchHost, page: PhonePage = browserPhone()): Layer {
  addStyle(css);
  const clock = host.match.clock;
  const lock = page.wakeLock();
  lock.want(true);
  const still = h('p', { 'data-test': 'turn-still', hidden: true },
    "Still upright? Rotation lock may be on: turn it off, then turn your phone sideways.");
  const full = h('button', { type: 'button', class: 'primary', 'data-test': 'turn-fullscreen', hidden: true, onclick: () => playFullScreen() },
    'Play full screen');
  const el = h('div', { class: 'turn', role: 'alert', 'data-test': 'turn', hidden: true },
    h('h2', {}, 'Turn your phone sideways to play'), still, full);

  let shown = false;
  let stayed = false;
  let cancelStay: () => void = () => {};
  let presses = 0;
  let fullscreen: string | null = null;
  let orientation: string | null = null;
  let disposed = false;

  function update(): void {
    if (disposed) return;
    const want = page.phone() && page.upright();
    if (want === shown) return;
    shown = want;
    setShown(el, want);
    cancelStay();
    cancelStay = () => {};
    stayed = false;
    setShown(still, false);
    setShown(full, false);
    if (want) {
      cancelStay = clock.after(UPRIGHT_HINT_MS, () => {
        if (disposed || !shown) return;
        stayed = true;
        setShown(still, true);
        setShown(full, page.android());
      });
    }
  }

  /** Android's way out of a rotation lock (D-30): fullscreen, then landscape, each refusal kept. */
  function playFullScreen(): void {
    presses++;
    page.enterFullscreen().then(
      () => {
        fullscreen = 'entered';
        return page.lockLandscape().then(
          () => {
            orientation = 'locked';
          },
          (e: unknown) => {
            orientation = refusal(e);
          },
        );
      },
      (e: unknown) => {
        fullscreen = refusal(e);
      },
    ).catch(() => {});
  }

  const stopWatching = page.onChange(update);
  update();

  return {
    name: 'turn',
    el,
    // The page's events say when it turns; a frame catches a change none reported.
    frame: () => update(),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopWatching();
      cancelStay();
      lock.want(false);
    },
    inspect: (): TurnInspection => ({
      phone: page.phone(), upright: page.upright(), shown, still: stayed, fullscreenOffered: stayed && !full.hidden,
      presses, fullscreen, orientation, wakeLock: lock.inspect(),
    }),
  };
}
