import { describe, expect, it } from 'vitest';
import { FakeClock, fakePage } from './clock-testing';

// The glue's test clock and page (M3's design §1.23, §8.3; PLAN D-31, C-6),
// before phase 4's src/ui/game.test.ts and src/ui/practice.test.ts rely on
// them for the stall and hidden-page rules: timers in due order and then
// the order they were set, now() reading the due time, a stall running each
// overdue timer once, a throttle waking at whole multiples, the guards, and
// a page that dispatches as the DOM does (reviewer CLK-1).

describe('FakeClock', () => {
  it('fires in due order, then set order; now() is the due time; after(0) inside runs after those already due', () => {
    const c = new FakeClock();
    const log: string[] = [];
    c.after(10, () => log.push(`a@${c.now()}`));
    c.after(5, () => {
      log.push(`b@${c.now()}`);
      c.after(5, () => log.push(`d@${c.now()}`));
    });
    c.after(10, () => {
      log.push(`c@${c.now()}`);
      c.after(0, () => log.push(`e@${c.now()}`));
    });
    c.advance(20);
    expect(log).toEqual(['b@5', 'a@10', 'c@10', 'd@10', 'e@10']);
    expect([c.now(), c.pending]).toEqual([20, 0]);
  });

  it('runs an interval every period, lets it cancel itself, and keeps its cadence', () => {
    const c = new FakeClock();
    let n = 0;
    const stop = c.every(4, () => n++);
    c.advance(1000);
    expect(n).toBe(250);
    stop();
    c.advance(100);
    expect(n).toBe(250);
    let m = 0;
    const self: { stop: (() => void) | null } = { stop: null };
    self.stop = c.every(3, () => {
      m++;
      if (m === 2) self.stop!();
    });
    c.advance(30);
    expect([m, c.pending]).toEqual([2, 0]);
  });

  it('stalls as a frozen page does: each overdue timer once, an interval once, then a period on', () => {
    const c = new FakeClock();
    const at: number[] = [];
    c.every(4, () => at.push(c.now()));
    c.advance(8);
    c.stall(3000);
    c.advance(8);
    expect(at).toEqual([4, 8, 3008, 3012, 3016]);
  });

  it('throttles as a hidden page does: once at each whole multiple, then on time again', () => {
    const c = new FakeClock();
    const at: number[] = [];
    c.every(4, () => at.push(c.now()));
    c.throttle = 1000;
    c.advance(3500);
    expect(at).toEqual([1000, 2000, 3000]);
    c.throttle = null;
    c.advance(10);
    expect(at).toEqual([1000, 2000, 3000, 3500, 3504, 3508]);
  });

  it('refuses to move from inside a timer, and stays usable after a timer throws', () => {
    const c = new FakeClock();
    let err: unknown = null;
    c.after(1, () => {
      try {
        c.advance(1);
      } catch (e) {
        err = e;
      }
    });
    c.advance(2);
    expect(String(err)).toMatch(/never from inside/);
    c.advance(1);
    expect(c.now()).toBe(3);
    c.after(1, () => {
      throw new Error('boom');
    });
    expect(() => c.advance(2)).toThrow('boom');
    c.advance(1);
    expect(c.now()).toBeGreaterThanOrEqual(5);
    expect(() => c.every(0, () => undefined)).toThrow(RangeError);
    expect(() => c.advance(Infinity)).toThrow(RangeError);
  });

  it('runs until a condition holds, a millisecond at a time, and says when it never does', () => {
    const c = new FakeClock();
    let hit = false;
    c.after(37, () => (hit = true));
    c.until(() => hit, 100);
    expect(c.now()).toBe(37);
    expect(() => c.until(() => false, 10)).toThrow(/not reached/);
  });
});

describe('fakePage', () => {
  it('dispatches as the DOM does: once a change, a listener removed by an earlier one not called', () => {
    const p = fakePage();
    const log: string[] = [];
    const offB = p.onVisibility(() => log.push(`b:${p.hidden()}`));
    p.onVisibility(() => {
      log.push(`a:${p.hidden()}`);
      offB();
    });
    expect(p.listeners).toBe(2);
    p.hide();
    p.hide();
    p.show();
    expect(log).toEqual(['b:true', 'a:true', 'a:false']);
    expect(p.listeners).toBe(1);
    expect(fakePage(true).hidden()).toBe(true);
  });
});
