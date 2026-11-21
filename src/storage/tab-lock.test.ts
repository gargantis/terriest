import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserLocks, holdTabLock, TAB_LOCK, type TabLocks } from './tab-lock';

// One game tab (M4's design §1.34, §5.1, §6, §9.2's tab-lock row; PLAN
// D-24), against a fake navigator.locks with the Web Locks rules
// holdTabLock relies on: ifAvailable is granted only a free lock, else
// called with null; steal takes the lock from its holder, whose request
// rejects with an AbortError; a held lock is kept until its callback's
// promise settles. Each callback is called a microtask after its request,
// as a browser's is, never inside it.

/** One browser's locks, for the tabs that share them. */
class FakeLocks implements TabLocks {
  readonly requests: { readonly name: string; readonly options: LockOptions }[] = [];
  private holder: { readonly reject: (e: unknown) => void } | null = null;

  request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> {
    this.requests.push({ name, options });
    return new Promise((resolve, reject) => {
      queueMicrotask(() => {
        if (this.holder !== null && options.steal !== true) {
          if (options.ifAvailable === true) Promise.resolve(callback(null)).then(resolve, reject);
          else reject(new Error('the fake grants only ifAvailable and steal'));
          return;
        }
        this.holder?.reject(new DOMException('The lock was stolen', 'AbortError'));
        const me = { reject };
        this.holder = me;
        Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).then(
          (v) => {
            if (this.holder === me) this.holder = null;
            resolve(v);
          },
          reject,
        );
      });
    });
  }
}

const settle = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tab lock, terriest-game (D-24)", () => {
  it('is held by the first tab and found held by a second, which asks only if it is available', async () => {
    const locks = new FakeLocks();
    const lost: string[] = [];
    expect(await holdTabLock(false, () => lost.push('first'), locks)).toBe(true);
    expect(await holdTabLock(false, () => lost.push('second'), locks)).toBe(false);
    expect(locks.requests).toEqual([
      { name: TAB_LOCK, options: { ifAvailable: true } },
      { name: TAB_LOCK, options: { ifAvailable: true } },
    ]);
    expect(TAB_LOCK).toBe('terriest-game');
    await settle();
    expect(lost).toEqual([]);
  });

  it("moves to a tab that steals it, Use here's, and tells the tab it was taken from, once", async () => {
    const locks = new FakeLocks();
    const lost: string[] = [];
    expect(await holdTabLock(false, () => lost.push('first'), locks)).toBe(true);
    expect(await holdTabLock(false, () => lost.push('second'), locks)).toBe(false);
    expect(await holdTabLock(true, () => lost.push('second'), locks)).toBe(true);
    expect(locks.requests.at(-1)).toEqual({ name: TAB_LOCK, options: { steal: true } });
    await settle();
    expect(lost).toEqual(['first']);
    // And back again: the first tab's own Use here.
    expect(await holdTabLock(true, () => lost.push('first'), locks)).toBe(true);
    await settle();
    expect(lost).toEqual(['first', 'second']);
    // A third tab finds it held still.
    expect(await holdTabLock(false, () => lost.push('third'), locks)).toBe(false);
  });

  it('plays in every tab without Web Locks, and when a request is refused before it was granted', async () => {
    const lost: string[] = [];
    expect(await holdTabLock(false, () => lost.push('none'), null)).toBe(true);
    // A sandboxed frame's SecurityError, or any refusal before the grant: the page plays, nothing lost.
    const refusing: TabLocks = { request: () => Promise.reject(new DOMException('No locks here', 'SecurityError')) };
    expect(await holdTabLock(false, () => lost.push('refused'), refusing)).toBe(true);
    const throwing: TabLocks = {
      request: () => {
        throw new TypeError('no such method');
      },
    };
    expect(await holdTabLock(true, () => lost.push('threw'), throwing)).toBe(true);
    await settle();
    expect(lost).toEqual([]);
  });

  it("finds the page's navigator.locks, or none", () => {
    const locks = new FakeLocks();
    vi.stubGlobal('navigator', { locks });
    expect(browserLocks()).toBe(locks);
    vi.stubGlobal('navigator', {});
    expect(browserLocks()).toBeNull();
    vi.stubGlobal('navigator', undefined);
    expect(browserLocks()).toBeNull();
  });
});
