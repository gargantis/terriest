import type { Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NetReport } from '../../src/nettest-params';
import { type NetPage, waitFor } from './browsers';

// The networked specs' wait (e2e/lib/browsers.ts's waitFor; M4's design
// §9.1): a look at each page's report every poll until what's waited for
// holds, its deadline on the monotonic clock, as e2e/lib/page.ts's waits,
// so the machine's clock, which phase 1c measured stepping a second ahead
// every 32 s, never ends a wait early. New at M4, by phase 2b's Wire step.

/** A #test=net page whose reports' final tick counts its looks; the machine's clock steps a minute ahead
 *  each time it's read, while the monotonic clock keeps its time. */
function netPage(): { readonly page: NetPage; looks(): number } {
  let looks = 0;
  let wall = 1.8e12;
  vi.spyOn(Date, 'now').mockImplementation(() => (wall += 60_000));
  const report = (): NetReport => ({
    me: '0'.repeat(32), role: 'player', phase: 0, overtime: false, score: [0, 0], clock: 0, finalTick: ++looks, peers: 1, stall: 'none',
    refused: null, refusedBy: null, duplicates: [],
  }) as unknown as NetReport;
  const page = { evaluate: async () => report() } as unknown as Page;
  return { page: { page, engine: 'chromium' } as unknown as NetPage, looks: () => looks };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the networked specs' wait (§9.1)", () => {
  it("goes by the monotonic clock: the machine's clock stepping ahead ends it none early", async () => {
    const p = netPage();
    const [r] = await waitFor([p.page], ([x]) => x!.finalTick >= 3, { timeoutMs: 5_000 });
    expect([r!.finalTick, p.looks()]).toEqual([3, 3]);
  });

  it('fails once the monotonic clock passes its deadline, saying where each page is', async () => {
    const p = netPage();
    const from = performance.now();
    await expect(waitFor([p.page], () => false, { timeoutMs: 300 })).rejects.toThrow(/^not reached within 300 ms\n {2}chromium 0000 \(player\): phase 0/);
    expect(performance.now() - from).toBeGreaterThanOrEqual(300);
  });
});
