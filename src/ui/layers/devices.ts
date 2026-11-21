// The devices' layers over the pitch (M4's design, research/m4/DESIGN.md,
// §1.22, §1.26, §1.48, §1.63, §4.3, §4.7, §5.13; PLAN D-29, D-30, L83,
// L169, L170, C-52), in this order:
// - 'touch': the page's touch control layer (src/input/touch.ts) put over
//   this pitch, shown for a player, never a spectator, once the page has
//   had a touch. One layer of the page's serves every pitch screen, so the
//   newest screen's layer owns it, and an older one going never hides it;
// - 'hints': for each kind of input, the first time it's used on this
//   pitch screen, a panel listing its six controls, each line clearing once
//   that control has been used, the panel gone once all six have; the
//   kind used last that has lines left shows. The profile keeps each kind's
//   bitmask (src/input/hints.ts, M4-Q28), so a cleared line stays cleared
//   after a reload, and Settings' "Show control hints again" brings them
//   back, read again from the profile at each timer run. On Windows the
//   keyboard's panel says how to turn off the Sticky Keys shortcut (C-52).
//   Its uses come from the controls' onUsed through the page's devices
//   (src/ui/devices.ts), a player's alone;
// - 'turn': the phone's turn prompt and the pitch's wake lock
//   (src/ui/phone.ts).
// The page's devices are found with currentDevices(): a layer is made from
// the pitch's host alone. Their look is src/ui/touch.css's. New at M4: an
// empty slot by the slice (1c), filled by phase 2's devices builder.

import { HintTracker, INPUT_KINDS } from '../../input/hints';
import type { Control, InputKind } from '../../input/source';
import type { TouchControls } from '../../input/touch';
import { currentDevices, type LayerDevices } from '../devices';
import { h, setShown, setText } from '../dom';
import type { Layer, LayerFactory, PitchHost } from '../layer';
import { turnPromptLayer } from '../phone';
import { addStyle } from '../style';
import css from '../touch.css?inline';

/** Each kind's panel: its title, and each control's key, button or gesture with what it does. */
const HINTS: Readonly<Record<InputKind, { readonly title: string; readonly lines: Readonly<Record<Control, readonly [string, string]>> }>> = {
  keyboard: {
    title: 'Keyboard controls',
    lines: { run: ['W A S D', 'run'], zoomies: ['Shift', 'zoomies'], jump: ['Space', 'jump'], pounce: ['E', 'pounce'], bark: ['Q', 'bark'], view: ['C', 'switch view'] },
  },
  touch: {
    title: 'Touch controls',
    lines: {
      run: ['The stick', 'run'], zoomies: ['The stick past its rim', 'zoomies'], jump: ['Jump', 'jump'], pounce: ['Pounce', 'pounce'],
      bark: ['Bark', 'bark'], view: ['View', 'switch view'],
    },
  },
  gamepad: {
    title: 'Gamepad controls',
    lines: {
      run: ['Left stick', 'run'], zoomies: ['Right trigger', 'zoomies'], jump: ['Bottom button', 'jump'], pounce: ['Left button', 'pounce'],
      bark: ['Top button', 'bark'], view: ['Right shoulder', 'switch view'],
    },
  },
};

/** C-52: the README's way out, shorter. */
const STICKY_KEYS =
  'On Windows, five presses of Shift open the Sticky Keys prompt, which stops your terrier: turn off its shortcut in Settings, under ' +
  'Accessibility, Keyboard, Sticky keys (Ease of Access, Keyboard on Windows 10).';

/** Windows, by the browser's own report, where the keyboard's panel adds the Sticky Keys line. */
export function onWindows(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  const n = nav as { readonly userAgent?: unknown; readonly userAgentData?: { readonly platform?: unknown } } | undefined;
  const platform = n?.userAgentData?.platform;
  if (typeof platform === 'string' && platform !== '') return platform === 'Windows';
  return typeof n?.userAgent === 'string' && /Windows/.test(n.userAgent);
}

/** Inspection.layers.hints. */
export interface HintsInspection {
  /** The kind whose panel shows, or null. */
  readonly shown: InputKind | null;
  /** Its lines: the controls it still lists, in the panel's order. */
  readonly lines: readonly Control[];
  /** The Sticky Keys line shows (C-52). */
  readonly sticky: boolean;
  /** The kinds used on this pitch screen, the last used last. */
  readonly seen: readonly InputKind[];
  /** Each kind's bitmask as the tracker holds it: the profile's (M4-Q28). */
  readonly used: Readonly<Record<InputKind, number>>;
}

export interface DeviceLayerOptions {
  /** On Windows (C-52): the browser's report, by default. */
  readonly windows?: () => boolean;
}

/** The devices' layers, finding the page's devices with `devices` as each pitch screen is made. */
export function deviceLayers(devices: () => LayerDevices | null, o: DeviceLayerOptions = {}): readonly LayerFactory[] {
  const windows = o.windows ?? (() => onWindows());
  return [
    (host) => touchLayer(host, devices()),
    (host) => hintsLayer(host, devices(), windows),
    (host) => turnPromptLayer(host),
  ];
}

export const LAYERS: readonly LayerFactory[] = deviceLayers(currentDevices);

/** Which pitch screen's touch layer owns the page's control layer: the newest's. */
const owners = new WeakMap<TouchControls, object>();

function touchLayer(host: PitchHost, devices: LayerDevices | null): Layer {
  const touch = devices?.touch ?? null;
  if (touch === null) return { name: 'touch', el: null };
  const me = {};
  owners.set(touch, me);
  // Players on touch screens; a spectator plays no controls (§4.3, L167).
  const player = host.controls !== null;
  const show = (): void => {
    if (owners.get(touch) === me) touch.setVisible(player);
  };
  show();
  return {
    name: 'touch',
    el: touch.el,
    // Each frame, so Settings' mirrored layout follows at once, its panel open or not.
    frame: show,
    dispose(): void {
      if (owners.get(touch) !== me) return;
      owners.delete(touch);
      touch.setVisible(false);
    },
    inspect: () => touch.inspect(),
  };
}

function hintsLayer(host: PitchHost, devices: LayerDevices | null, windows: () => boolean): Layer {
  addStyle(css);
  const profile = host.profile;
  /** The profile's masks as this layer last read or wrote them, to see another screen's change. */
  let known = profile.get().hints;
  const tracker = new HintTracker(known, (used) => {
    profile.update((p) => ({ ...p, hints: used }));
    known = profile.get().hints;
  });
  const title = h('h2', {});
  const list = h('ul', {});
  const note = h('p', { class: 'hints-note', 'data-test': 'hints-sticky', hidden: true }, STICKY_KEYS);
  const el = h('div', { class: 'hints', 'data-test': 'hints', hidden: true }, title, list, note);
  const seen: InputKind[] = [];
  let shown: InputKind | null = null;
  let drawn = '';

  /** Another screen's change to the profile's masks, Settings' Show control hints again among them:
   *  true if there was one. */
  const resync = (): boolean => {
    const now = profile.get().hints;
    if (INPUT_KINDS.every((k) => now[k] === known[k])) return false;
    known = now;
    tracker.sync(now);
    return true;
  };

  /** The kind used last that has lines left, or none. */
  const pick = (): InputKind | null => {
    for (let k = seen.length - 1; k >= 0; k--) if (tracker.remaining(seen[k]!).length > 0) return seen[k]!;
    return null;
  };

  /** The panel, its DOM touched only when what it shows changes. */
  const render = (): void => {
    shown = pick();
    const lines = shown === null ? [] : tracker.remaining(shown);
    const key = shown === null ? '' : `${shown}|${lines.join(',')}`;
    if (key === drawn) return;
    drawn = key;
    setShown(el, shown !== null);
    if (shown === null) return;
    const hints = HINTS[shown];
    setText(title, hints.title);
    list.replaceChildren(...lines.map((c) =>
      h('li', { 'data-control': c }, h('span', { class: 'hints-key' }, hints.lines[c][0]), `: ${hints.lines[c][1]}`)));
    setShown(note, shown === 'keyboard' && windows());
  };

  const stop = devices?.onUsed((kind, c) => {
    // A spectator's screen has no controls, and so no hints.
    if (host.controls === null) return;
    resync();
    tracker.use(kind, c);
    const k = seen.indexOf(kind);
    if (k >= 0) seen.splice(k, 1);
    seen.push(kind);
    render();
  }) ?? (() => {});

  return {
    name: 'hints',
    el,
    run(): void {
      if (resync()) render();
    },
    dispose: () => stop(),
    // What it shows, read back from what it wrote: the panel's lines and the Sticky Keys line.
    inspect: (): HintsInspection => ({
      shown: el.hidden ? null : shown,
      lines: el.hidden ? [] : Array.from(list.querySelectorAll('li'), (li) => li.getAttribute('data-control') as Control),
      sticky: !el.hidden && !note.hidden, seen: [...seen], used: tracker.used(),
    }),
  };
}
