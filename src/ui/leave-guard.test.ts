import { describe, expect, it } from 'vitest';
import { installLeaveGuard } from './leave-guard';

// The leave prompt (M4's design §1.49, §5.11, §9.2's leave-guard row; PLAN
// D-30, M3-Q20), on Node's own EventTarget, whose dispatch follows the
// DOM's, never on a hand-made fake: registered first and active, the guard
// asks (the event's default prevented, its returnValue set) and stops the
// event with stopImmediatePropagation, so a later listener on the same
// target, as Trystero's beforeunload listener is on the window, never hears
// it; inactive, it does nothing, and the later listener does.

/** As the DOM's BeforeUnloadEvent: Node's own Event, cancelable, its returnValue a string, '' until set. */
type BeforeUnload = Event & { readonly said: () => unknown };

function beforeUnload(): BeforeUnload {
  const e = new Event('beforeunload', { cancelable: true });
  Object.defineProperty(e, 'returnValue', { value: '', writable: true });
  return Object.assign(e, { said: () => (e as unknown as { returnValue: unknown }).returnValue });
}

/** A window with the guard installed first, then a later listener on it, as Trystero's room adds one. */
function windowWithRoom(): { target: EventTarget; guard: ReturnType<typeof installLeaveGuard>; heard: BeforeUnload[] } {
  const target = new EventTarget();
  const guard = installLeaveGuard(target);
  const heard: BeforeUnload[] = [];
  target.addEventListener('beforeunload', (e) => heard.push(e as BeforeUnload));
  return { target, guard, heard };
}

describe('the leave guard (§1.49)', () => {
  it("asks, and keeps the event from a later listener on the same target, while it's active", () => {
    const w = windowWithRoom();
    w.guard.set(true);
    expect(w.guard.active).toBe(true);
    const e = beforeUnload();
    const went = w.target.dispatchEvent(e);
    expect([went, e.defaultPrevented]).toEqual([false, true]); // asks
    expect(e.said()).not.toBe(''); // and says so, as older engines read it
    expect(w.heard).toEqual([]); // Trystero's listener never runs, so the room stays
  });

  it("does nothing while it's inactive: the page goes, and every later listener hears it", () => {
    const w = windowWithRoom();
    const e = beforeUnload();
    expect(w.target.dispatchEvent(e)).toBe(true);
    expect([e.defaultPrevented, e.said(), w.heard]).toEqual([false, '', [e]]);
    w.guard.set(true);
    w.guard.set(false); // Home again, after Leave
    const after = beforeUnload();
    w.target.dispatchEvent(after);
    expect([after.defaultPrevented, w.heard.length, w.guard.active]).toEqual([false, 2, false]);
  });

  it('leaves an event without a string returnValue as it is, and ignores every other event', () => {
    const w = windowWithRoom();
    w.guard.set(true);
    const plain = new Event('beforeunload', { cancelable: true }); // Node's own: a boolean returnValue
    w.target.dispatchEvent(plain);
    expect([plain.defaultPrevented, w.heard]).toEqual([true, []]);
    const other = new Event('pagehide', { cancelable: true });
    let heard = 0;
    w.target.addEventListener('pagehide', () => heard++);
    w.target.dispatchEvent(other);
    expect([other.defaultPrevented, heard]).toEqual([false, 1]);
  });

  it('stops only what follows it: a listener added before the guard still runs, which is why it goes first', () => {
    const target = new EventTarget();
    let before = 0;
    target.addEventListener('beforeunload', () => before++);
    const guard = installLeaveGuard(target);
    let after = 0;
    target.addEventListener('beforeunload', () => after++);
    guard.set(true);
    target.dispatchEvent(beforeUnload());
    expect([before, after]).toEqual([1, 0]);
  });
});
