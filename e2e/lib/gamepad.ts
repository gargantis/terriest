// The gamepad's stub for the specs (M4's design, research/m4/DESIGN.md,
// §1.62, §9.1, §9.5; PLAN D-29, §16): an init script, run before the page's
// own, that has navigator.getGamepads report one pad of the standard
// mapping, its buttons and axes at rest, and the spec's hands on it,
// window.terriestPadStub, which the page never reads: it polls
// navigator.getGamepads() as it would a real pad's (src/input/gamepad.ts).
// press() holds a button until the hook's pad figures count its press, then
// lets go and waits for a poll that saw it go, so each press counts once,
// however often the page polls (§16); the pad's figures are at the hook's
// top level, so it presses on Results and Home as on the pitch. Each wait
// polls the hook every 50 ms, never on animation frames (C-6). New at M4.

import type { Page } from '@playwright/test';
import { PAD } from '../../src/input/gamepad';
import type { GamepadInspection } from '../../src/input/source';
import { inspect, POLL_MS } from './page';

export { PAD };

/** window.terriestPadStub: the spec's alone. */
export interface PadStub {
  /** A button's value, 0 to 1: pressed above 0, as the trigger's travel past gamepadTriggerFraction is zoomies. */
  set(button: number, value: number): void;
  /** The left stick's axes, each −1 to 1, screen y down: (0, −1) is up. */
  stick(x: number, y: number): void;
  /** The pad plugged in or out. */
  connected(on: boolean): void;
}

/** The init script: navigator.getGamepads() reports one connected pad of the standard mapping, its 17
 *  buttons and 4 axes at rest, which window.terriestPadStub moves. Playwright sends its source to the
 *  page, so it reads nothing from outside itself; with no argument, it stubs the page's own window. */
export function stubGamepad(w: object = globalThis): void {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const axes = [0, 0, 0, 0];
  const pad = { id: 'terriest stub (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes, buttons };
  const changed = (): void => {
    pad.timestamp += 1;
  };
  const stub = {
    set(button: number, value: number): void {
      const b = buttons[button];
      if (b === undefined || !(value >= 0 && value <= 1)) throw new RangeError(`no button ${button} to set to ${value}`);
      b.value = value;
      b.pressed = value > 0;
      b.touched = value > 0;
      changed();
    },
    stick(x: number, y: number): void {
      if (!(Math.abs(x) <= 1 && Math.abs(y) <= 1)) throw new RangeError(`the stick's axes are −1 to 1, not (${x}, ${y})`);
      axes[0] = x;
      axes[1] = y;
      changed();
    },
    connected(on: boolean): void {
      pad.connected = on;
      changed();
    },
  };
  const nav = (w as { readonly navigator: object }).navigator;
  Object.defineProperty(nav, 'getGamepads', { configurable: true, value: () => [pad.connected ? pad : null, null, null, null] });
  Object.defineProperty(w, 'terriestPadStub', { configurable: true, value: stub });
}

/** The stub, before the page loads: with installHook's and seedStorage's init scripts. */
export async function installGamepad(page: Page): Promise<void> {
  await page.addInitScript(stubGamepad);
}

// Each call to the stub is its own evaluate: Playwright sends a function's source, so each reads nothing
// from outside itself.

/** A button's value, held until changed. */
export function setButton(page: Page, button: number, value: number): Promise<void> {
  return page.evaluate(([b, v]) => {
    const s = (window as unknown as { readonly terriestPadStub?: PadStub }).terriestPadStub;
    if (s === undefined) throw new Error('no window.terriestPadStub: installGamepad goes in before load');
    s.set(b, v);
  }, [button, value] as const);
}

/** The left stick's axes, held until changed: (0, 0) lets go. */
export function setStick(page: Page, x: number, y: number): Promise<void> {
  return page.evaluate(([ax, ay]) => {
    const s = (window as unknown as { readonly terriestPadStub?: PadStub }).terriestPadStub;
    if (s === undefined) throw new Error('no window.terriestPadStub: installGamepad goes in before load');
    s.stick(ax, ay);
  }, [x, y] as const);
}

/** The pad plugged in or out. */
export function setConnected(page: Page, on: boolean): Promise<void> {
  return page.evaluate((c) => {
    const s = (window as unknown as { readonly terriestPadStub?: PadStub }).terriestPadStub;
    if (s === undefined) throw new Error('no window.terriestPadStub: installGamepad goes in before load');
    s.connected(c);
  }, on);
}

/** The page's pad figures, as the hook reports them on every screen. */
export async function padFigures(page: Page): Promise<GamepadInspection> {
  const g = (await inspect(page)).gamepad;
  if (g === null) throw new Error("the hook reports no pad: the page's devices make one at start-up");
  return g;
}

/** Polls the hook every 50 ms until `until` holds of the pad's figures. */
export async function waitForPad(page: Page, until: (g: GamepadInspection) => boolean, what: string, timeoutMs = 10_000): Promise<GamepadInspection> {
  const deadline = Date.now() + timeoutMs;
  for (let g = await padFigures(page); ; g = await padFigures(page)) {
    if (until(g)) return g;
    if (Date.now() > deadline) throw new Error(`${what}: not seen within ${timeoutMs} ms (pad ${JSON.stringify(g)})`);
    await page.waitForTimeout(POLL_MS);
  }
}

const pressesOf = (g: GamepadInspection, button: number): number => g.presses[String(button)] ?? 0;

/** One press (§1.62): the button held until the page's pad counts it, then let go, and a poll after that,
 *  so the next press of it is a rising edge again. */
export async function press(page: Page, button: number, timeoutMs = 10_000): Promise<void> {
  const before = pressesOf(await padFigures(page), button);
  await setButton(page, button, 1);
  await waitForPad(page, (g) => pressesOf(g, button) > before, `button ${button}'s press`, timeoutMs);
  await setButton(page, button, 0);
  const polls = (await padFigures(page)).polls;
  await waitForPad(page, (g) => g.polls > polls, `a poll with button ${button} let go`, timeoutMs);
}
