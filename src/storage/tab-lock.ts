// One game tab per browser (M4's design, research/m4/DESIGN.md, §1.34, §5.1,
// §6; PLAN D-24): roslambo's Web Lock (src/storage/tab-lock.ts), named
// terriest-game, which covers the whole app, Practice and watching
// included. The first tab takes it; a second finds it held, says so, and
// offers Use here, which steals it; the tab it was stolen from hears that
// its lock was taken, closes its match and says so. Without Web Locks
// (a very old browser) every tab plays, as roslambo's did. Changed from
// roslambo's: the locks are a parameter, so the tests hand in a fake; and
// a request refused before it was granted, as a sandboxed frame's is,
// plays as without Web Locks rather than leaving the page waiting. New at
// M4.

/** The lock's name (D-24). */
export const TAB_LOCK = 'terriest-game';

/** What holdTabLock needs of navigator.locks, which a test fakes. */
export interface TabLocks {
  request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown>;
}

/** The page's Web Locks, or null where the browser has none. */
export function browserLocks(): TabLocks | null {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function' ? navigator.locks : null;
}

/** Resolves true once this tab holds the lock, false if another tab does and `steal` is false. `onLost`
 *  runs if another tab steals it later. With steal, the lock is taken from whichever tab holds it. */
export function holdTabLock(steal: boolean, onLost: () => void, locks: TabLocks | null = browserLocks()): Promise<boolean> {
  if (locks === null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let granted = false;
    const options: LockOptions = steal ? { steal: true } : { ifAvailable: true };
    const refused = (): void => {
      // Stolen once held; refused before, the page plays as without Web Locks.
      if (granted) onLost();
      else resolve(true);
    };
    try {
      locks.request(TAB_LOCK, options, (lock) => {
        if (lock === null) {
          resolve(false);
          return undefined;
        }
        granted = true;
        resolve(true);
        return new Promise<void>(() => {}); // held until the page goes, or another tab steals it
      }).catch(refused);
    } catch {
      refused();
    }
  });
}
