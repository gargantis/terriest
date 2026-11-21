import type { Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Inspection } from '../../src/main';
import { POLL_MS, waitForInspection, waitForScreen } from './page';

// The specs' waits for the hook (M4's design §9.1; e2e/lib/page.ts): a
// look every POLL_MS, never on animation frames, until what's waited for
// shows, each deadline on the monotonic clock, so a step of the machine's
// clock, which phase 1c measured a second ahead every 32 s, never ends a
// wait early.

/** A page whose hook reports `screens` in turn, a look each, the last again once they run out; its waits
 *  move a fake monotonic clock by their length, while the machine's clock steps a minute ahead each time
 *  it's read. */
function fakePage(screens: readonly string[]): { readonly page: Page; looks(): number } {
  let looks = 0;
  let mono = 0;
  let wall = 1.8e12;
  vi.spyOn(performance, 'now').mockImplementation(() => mono);
  vi.spyOn(Date, 'now').mockImplementation(() => (wall += 60_000));
  const page = {
    evaluate: async () => ({ screen: screens[Math.min(looks++, screens.length - 1)], match: null }) as unknown as Inspection,
    waitForTimeout: async (ms: number) => {
      mono += ms;
    },
  };
  return { page: page as unknown as Page, looks: () => looks };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the specs' waits for the hook (§9.1)", () => {
  it("go by the monotonic clock: the machine's clock stepping ahead ends none early", async () => {
    const p = fakePage(['home', 'home', 'home', 'home', 'settings']);
    const i = await waitForInspection(p.page, (x) => x.screen === 'settings', { what: 'Settings', timeoutMs: 1000 });
    expect([i.screen, p.looks()]).toEqual(['settings', 5]);
    const q = fakePage(['home', 'practice']);
    expect((await waitForScreen(q.page, 'practice', 1000)).screen).toBe('practice');
  });

  it('fail once the monotonic clock passes the deadline, a look every POLL_MS, saying where the page is', async () => {
    const p = fakePage(['home']);
    await expect(waitForInspection(p.page, (x) => x.screen === 'settings', { what: 'Settings', timeoutMs: 1000 }))
      .rejects.toThrow(/^Settings: not reached within 1000 ms \(screen home, no match\)$/);
    // Looks at 0, 50, …, 1000 ms, and the one at 1050 ms past the deadline.
    expect(p.looks()).toBe(1000 / POLL_MS + 2);
  });
});
