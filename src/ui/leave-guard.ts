// The leave prompt (M4's design, research/m4/DESIGN.md, §1.49, §5.11; PLAN
// D-30, M3-Q20, M4-Q30): one beforeunload listener, registered once at
// start-up, before any room exists, so it's the window's first. While it's
// active, on Pre-match and Match, Practice's too (M4-Q30), it asks before
// the page is left: preventDefault(), and returnValue set where the event
// has one, a string, as older engines read it; and
// stopImmediatePropagation(), which keeps the event from every later
// listener on the same target. Trystero's is one: @trystero-p2p/core's
// room.mjs adds its own to the window with addEventListener, and
// stopPropagation() would stop only other targets' listeners, not it. So
// Trystero doesn't leave the room while the player decides, and a page that
// goes leaves on pagehide (src/net/trystero.ts). Inactive, it does nothing,
// and the event reaches every later listener. Chrome on Android shows the
// prompt once the page has had a touch, and iOS Safari not at all (D-30).
// New at M4.

export interface LeaveGuard {
  /** Asks before the page is left while on: the app's, on Pre-match and Match. */
  set(active: boolean): void;
  readonly active: boolean;
}

/** What an engine that still reads returnValue shows, where it shows anything of the page's. */
const ASK = 'Leave the match?';

/** The guard on `target`, the window: its listener added now, so it must come before any room's. */
export function installLeaveGuard(target: Pick<EventTarget, 'addEventListener'>): LeaveGuard {
  let active = false;
  target.addEventListener('beforeunload', (e: Event) => {
    if (!active) return;
    e.preventDefault();
    // A BeforeUnloadEvent's returnValue is a string; another event's, a boolean, isn't one to set.
    const b = e as unknown as { returnValue: unknown };
    if (typeof b.returnValue === 'string') b.returnValue = ASK;
    e.stopImmediatePropagation();
  });
  return {
    set(on: boolean): void {
      active = on;
    },
    get active(): boolean {
      return active;
    },
  };
}
