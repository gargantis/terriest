import { describe, expect, it } from 'vitest';
import { browserStorage, MemoryStorage, tryRead, tryWrite } from './kv';

// What the stores need of storage (M4's design §1.31, §9.2; PLAN §10): a
// read or a write never throws, and a failed write loses that write only.

describe('kv (PLAN §10)', () => {
  it("finds the page's storage, or none where reaching it throws, as blocked storage does", () => {
    const g = globalThis as Record<string, unknown>;
    const had = Object.getOwnPropertyDescriptor(g, 'localStorage');
    const kv = new MemoryStorage();
    try {
      Object.defineProperty(g, 'localStorage', { configurable: true, get: () => kv });
      expect(browserStorage()).toBe(kv);
      Object.defineProperty(g, 'localStorage', {
        configurable: true,
        get: () => {
          throw new Error('the operation is insecure');
        },
      });
      expect(browserStorage()).toBeNull();
    } finally {
      if (had === undefined) delete g['localStorage'];
      else Object.defineProperty(g, 'localStorage', had);
    }
    expect(tryWrite(null, 'k', 'v')).toBe(false);
    expect(tryRead(null, 'k')).toBeNull();
  });

  it('writes, reads and removes', () => {
    const kv = new MemoryStorage();
    expect(tryRead(kv, 'k')).toBeNull();
    expect(tryWrite(kv, 'k', 'v')).toBe(true);
    expect(tryRead(kv, 'k')).toBe('v');
    expect(tryWrite(kv, 'k', null)).toBe(true);
    expect(tryRead(kv, 'k')).toBeNull();
  });

  it('loses a failed write only: the record before it stays, and the next write lands', () => {
    const kv = new MemoryStorage();
    tryWrite(kv, 'k', 'first');
    kv.failNextWrite = true;
    expect(tryWrite(kv, 'k', 'second')).toBe(false);
    expect(tryRead(kv, 'k')).toBe('first');
    expect(tryWrite(kv, 'k', 'third')).toBe(true);
    expect(tryRead(kv, 'k')).toBe('third');
    kv.full = true;
    expect([tryWrite(kv, 'k', 'fourth'), tryWrite(kv, 'other', 'x'), tryRead(kv, 'k')]).toEqual([false, false, 'third']);
  });

  it('reads nothing, and throws nothing, from blocked storage', () => {
    const kv = new MemoryStorage();
    tryWrite(kv, 'k', 'v');
    kv.blocked = true;
    expect(tryRead(kv, 'k')).toBeNull();
    expect(tryWrite(kv, 'k', 'w')).toBe(false);
  });
});
