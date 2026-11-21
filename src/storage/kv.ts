// What the stores need of localStorage (M4's design, research/m4/DESIGN.md,
// §1.31, §6; PLAN §10, D-24, D-38): the browser's storage, which may be
// missing or blocked; reads and writes that never throw, a failed write
// losing that write only; and an in-memory store for the tests. Only
// src/storage touches browser storage (D-38). roslambo's src/storage/kv.ts,
// but for its key listing and Base64, which its binary records needed and
// A.3's JSON records don't. New at M4.

export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage, or null where it's missing or blocked: the stores then keep their records in memory. */
export function browserStorage(): KeyValue | null {
  try {
    return localStorage;
  } catch {
    return null; // blocked by the browser's settings, or no Web Storage at all
  }
}

/** One write, or with null one removal. A failed write (a full quota, blocked storage) loses that write
 *  only: false, and nothing thrown (PLAN §10). */
export function tryWrite(kv: KeyValue | null, key: string, value: string | null): boolean {
  try {
    if (kv === null) return false;
    if (value === null) kv.removeItem(key);
    else kv.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** A key's value, or null when it's absent or the read fails. */
export function tryRead(kv: KeyValue | null, key: string): string | null {
  try {
    return kv?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** An in-memory KeyValue for the tests, whose writes can be made to fail as a full quota's do. */
export class MemoryStorage implements KeyValue {
  readonly data = new Map<string, string>();
  /** The next write throws, as a page closed mid-write or a quota just filled. */
  failNextWrite = false;
  /** Every write throws while set, as a full quota's do. */
  full = false;
  /** Every read throws while set, as blocked storage's do. */
  blocked = false;

  getItem(key: string): string | null {
    if (this.blocked) throw new Error('storage is blocked');
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.refuse();
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.refuse();
    this.data.delete(key);
  }

  private refuse(): void {
    if (this.blocked) throw new Error('storage is blocked');
    if (this.full) throw new Error('the quota is full');
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('closed mid-write');
    }
  }
}
