// The input source the match samples (PLAN D-10, D-29, A.2, L327, L342,
// R-6; M4's design, research/m4/DESIGN.md, §1.25, §4.1, §4.5, §4.6, §4.8,
// M4-Q24, M4-Q25): this page's devices merged into A.2's u16, once for each
// tick it sends, on the timeline's timer, never on an animation frame
// (D-31). Each sample reads every device once (the gamepad polls there):
// - the direction is the device's whose direction changed most recently and
//   still holds one, anchored by src/input/anchoring.ts: the ball frame in
//   ball view, the pitch frame read from the yaw in chase view, read again
//   when the view or the device changes; a held, unmoved direction gives
//   the same u16 tick after tick, so the timeline's prediction holds (L342);
// - zoomies is held on any device;
// - jump, pounce and bark are 2-bit press counters, each advanced once if
//   any device reported a press since the last sample: at most one step a
//   sampled tick, so a burst in one tick acts once, as the simulation would
//   act on a counter that moved 2 or 3, and four presses never look like
//   none (M4-Q25);
// - a bark within the bark gap of the last one sent is dropped and counted
//   (L327); one sent tells onBark at once, so it's drawn and heard at the
//   press (§2.5);
// - the view press switches the view through onView and never goes into the
//   input; it's handled first, so the switch's re-read is in the same input.
// The rebase at onControl (D-10, §4.6) starts the jump and pounce counters
// from the terrier's stored input and the bark counter at 0, since barks
// aren't stored and peers' bark rule takes the first input after a gap as
// its baseline (M4-Q24), and keeps what's held. The first sample after it
// acts none of the presses its devices kept from before it, such as one
// made while the page was rejoining, which would otherwise act at the
// return, or bark on this page alone. So a page that reloads or rejoins
// presses nothing on its return; a view press still switches the view.
// For the hook it keeps each held
// direction's span as sampled, and the key-to-screen figure: from the event
// time a device reports for the change a read first shows to the first
// frame drawn at or past the tick that input is for (R-6). A Controls is
// one pitch screen's: the figures are over that screen. New at M4.

import { config, derived } from '../config';
import { encodeInput, jumpCount, pounceCount } from '../core/sim/input';
import type { MatchState } from '../core/sim/state';
import type { ViewMode } from '../render/frame';
import { anchor, newAnchor, screenStep } from './anchoring';
import type { Control, ControlsApi, ControlsInspection, Device, DeviceState, InputKind } from './source';

export interface ControlsOptions {
  /** This viewer's view now. */
  readonly view: () => ViewMode;
  /** MatchView.yaw, the rig's at the drawn head's tick: chase view's read (§3.1). */
  readonly yaw: () => number;
  /** The view control was pressed: the screen switches the view, and calls viewChanged. */
  readonly onView?: () => void;
  /** A control was used on a kind of device: the hints (§1.26). Run and zoomies when they start. */
  readonly onUsed?: (kind: InputKind, c: Control) => void;
  /** Your bark went into the input for `tick`: the pitch screen draws it at once (MatchView.ownBark) and
   *  tells each layer (Layer.ownBark), so the sound plays it too (§2.5). */
  readonly onBark?: (tick: number) => void;
}

const DEGREES_PER_TURN = 360;
/** What the hook keeps, the most recent: holds, frames' latencies, and samples waiting for a frame. */
const HOLDS_KEPT = 1024;
const LATENCIES_KEPT = 4096;
const WAITING_KEPT = 256;

const NEUTRAL: Pick<DeviceState, 'direction' | 'stickStep'> = { direction: null, stickStep: null };

/** One device and what the controls saw of it at its last read. */
interface Tracked {
  readonly device: Device;
  /** Its step then, its stick's or its keys' exact one; null: no direction. */
  step: number | null;
  zoomies: boolean;
  /** When its direction last changed, as the controls' count of changes then. */
  changed: number;
}

interface Hold {
  readonly step: number;
  readonly frame: number;
  readonly from: number;
  to: number | null;
}

/** The pct-th percentile of sorted values by nearest rank, or null with none. */
function percentile(sorted: readonly number[], pct: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(1, Math.ceil((sorted.length * pct) / 100)) - 1]!;
}

export class Controls implements ControlsApi {
  private readonly o: ControlsOptions;
  private readonly tracked: Tracked[] = [];
  private readonly anchored = newAnchor();
  private changes = 0;
  private lastDevice: Device | null = null;
  private lastView: ViewMode | null = null;
  // A.2's press counters, and the tick of the last bark sent.
  private jump = 0;
  private pounce = 0;
  private bark = 0;
  private lastBarkTick: number | null = null;
  // The hook's figures.
  private readonly presses = { jump: 0, pounce: 0, bark: 0, view: 0 };
  private barksDropped = 0;
  private lastInput: number | null = null;
  private base: number | null = null;
  private firstAfterBase: number | null = null;
  private awaitingFirst = false;
  private readonly holds: Hold[] = [];
  private open: Hold | null = null;
  private lastTick: number | null = null;
  /** Inputs a device's event changed, by their tick, until a frame is drawn at or past it. */
  private readonly waiting: { readonly tick: number; readonly atMs: number }[] = [];
  private readonly latencies: number[] = [];
  private latencyCount = 0;

  constructor(o: ControlsOptions) {
    this.o = o;
  }

  add(d: Device): void {
    if (!this.tracked.some((t) => t.device === d)) this.tracked.push({ device: d, step: null, zoomies: false, changed: 0 });
  }

  remove(d: Device): void {
    const k = this.tracked.findIndex((t) => t.device === d);
    if (k >= 0) this.tracked.splice(k, 1);
  }

  /** The u16 for tick `tick`, the one being sent: sampled once a sent tick, on the timeline's timer
   *  (D-29). The head and its tick aren't read: the input is the devices' alone. */
  sample(_head: Readonly<MatchState>, _headTick: number, tick: number): number {
    const steps = config.stickSteps;
    let chosen: Tracked | null = null;
    let chosenState: DeviceState | null = null;
    let zoomies = false;
    let jump = false;
    let pounce = false;
    let bark = false;
    let view = false;
    let changedAt: number | null = null;
    for (const t of this.tracked) {
      const s = t.device.read();
      const kind = t.device.kind;
      const step = s.direction === null ? null : (s.stickStep ?? screenStep(s.direction, steps));
      if (step !== t.step) {
        if (t.step === null) this.used(kind, 'run');
        t.step = step;
        t.changed = ++this.changes;
      }
      if (s.zoomies && !t.zoomies) this.used(kind, 'zoomies');
      t.zoomies = s.zoomies;
      zoomies ||= s.zoomies;
      if (s.jump) this.used(kind, 'jump');
      if (s.pounce) this.used(kind, 'pounce');
      if (s.bark) this.used(kind, 'bark');
      if (s.view) this.used(kind, 'view');
      jump ||= s.jump;
      pounce ||= s.pounce;
      bark ||= s.bark;
      view ||= s.view;
      if (s.changedAtMs !== null && (changedAt === null || s.changedAtMs < changedAt)) changedAt = s.changedAtMs;
      if (step !== null && (chosen === null || t.changed > chosen.changed)) {
        chosen = t;
        chosenState = s;
      }
    }
    if (view) {
      this.presses.view++;
      this.o.onView?.();
    }
    const mode = this.o.view();
    const device = chosen?.device ?? null;
    // Another device's direction reads the screen again, as a switch of view does (viewChanged), and
    // ball view leaves chase view nothing to keep (src/input/anchoring.ts).
    if (device !== null && device !== this.lastDevice) this.anchored.reread = true;
    this.lastView = mode;
    this.lastDevice = device;
    const held = anchor(mode, chosenState ?? NEUTRAL, this.o.yaw(), this.anchored, steps, (config.chaseRereadDegrees * steps) / DEGREES_PER_TURN);
    // The first sample after a rebase: the presses read are from before it (§4.6).
    if (this.awaitingFirst) jump = pounce = bark = false;
    if (jump) {
      this.jump = (this.jump + 1) & 3;
      this.presses.jump++;
    }
    if (pounce) {
      this.pounce = (this.pounce + 1) & 3;
      this.presses.pounce++;
    }
    let barked = false;
    if (bark) {
      // A tick before the last bark's is another timeline's: the gap starts again.
      const last = this.lastBarkTick;
      if (last !== null && tick >= last && tick - last < derived.barkGapTicks) {
        this.barksDropped++;
      } else {
        this.bark = (this.bark + 1) & 3;
        this.lastBarkTick = tick;
        this.presses.bark++;
        barked = true;
      }
    }
    const input = encodeInput({ ...(held ?? {}), zoomies, jump: this.jump, pounce: this.pounce, bark: this.bark });
    this.track(held, tick);
    if (changedAt !== null && input !== this.lastInput) {
      this.waiting.push({ tick, atMs: changedAt });
      if (this.waiting.length > WAITING_KEPT) this.waiting.shift();
    }
    if (this.awaitingFirst) {
      this.firstAfterBase = input;
      this.awaitingFirst = false;
    }
    this.lastInput = input;
    if (barked) this.o.onBark?.(tick);
    return input;
  }

  /** The session's onControl (D-10, M3's D-17): the jump and pounce counters from the terrier's stored
   *  input, the bark counter at 0, what's held kept, and no press acted at the next sample. */
  rebase(base: number): void {
    this.jump = jumpCount(base);
    this.pounce = pounceCount(base);
    this.bark = 0;
    this.base = base;
    this.firstAfterBase = null;
    this.awaitingFirst = true;
  }

  /** Blur, a hidden page, the menu, lost graphics: every device lets go (§4.8), and no input waits for a
   *  frame, which a hidden page wouldn't draw. */
  release(): void {
    for (const t of this.tracked) t.device.release();
    this.waiting.length = 0;
  }

  /** Switching view reads the held direction again (D-29). */
  viewChanged(): void {
    this.anchored.reread = true;
  }

  /** After each frame, the drawn time's tick: each input waiting for it gives its key-to-screen time. */
  frameDrawn(tick: number, atMs: number): void {
    let k = 0;
    while (k < this.waiting.length) {
      const w = this.waiting[k]!;
      if (w.tick > tick) {
        k++;
        continue;
      }
      const ms = atMs - w.atMs;
      if (this.latencies.length < LATENCIES_KEPT) this.latencies.push(ms);
      else this.latencies[this.latencyCount % LATENCIES_KEPT] = ms;
      this.latencyCount++;
      this.waiting.splice(k, 1);
    }
  }

  inspect(): ControlsInspection {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return {
      devices: this.tracked.map((t) => t.device.kind), view: this.lastView,
      lastInput: this.lastInput, base: this.base, firstAfterBase: this.firstAfterBase,
      presses: { ...this.presses }, barksDropped: this.barksDropped,
      latencyMs: { count: this.latencyCount, p50: percentile(sorted, 50), p95: percentile(sorted, 95) },
      holds: this.holds.map((h) => ({ step: h.step, frame: h.frame, from: h.from, to: h.to })),
    };
  }

  private used(kind: InputKind, c: Control): void {
    this.o.onUsed?.(kind, c);
  }

  /** The held direction's span: a new step or frame, or none, ends the last at the tick before. */
  private track(held: { readonly step: number; readonly frame: number } | null, tick: number): void {
    const open = this.open;
    if (open !== null && (held === null || held.step !== open.step || held.frame !== open.frame)) {
      open.to = this.lastTick;
      this.open = null;
    }
    if (held !== null && this.open === null) {
      const h: Hold = { step: held.step, frame: held.frame, from: tick, to: null };
      this.holds.push(h);
      if (this.holds.length > HOLDS_KEPT) this.holds.shift();
      this.open = h;
    }
    this.lastTick = tick;
  }
}
