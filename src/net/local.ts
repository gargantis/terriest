// Practice's transport (design §1.21, §6.4; D-22, P10): no room, no peer
// connection, and nothing leaves the page. Practice runs a networked match's
// code path, so its TICKs are encoded and offered here, counted and
// dropped. It imports nothing that reaches src/net/trystero.ts or Trystero,
// which local.test.ts checks over its static import graph.

import type { Transport } from './transport';

export class LocalTransport implements Transport {
  readonly refusedBy: null = null;
  private count = 0;

  /** Messages offered, each dropped. */
  get offered(): number {
    return this.count;
  }

  send(_peer: string, _bytes: Uint8Array): void {
    this.count++;
  }

  broadcast(_bytes: Uint8Array): void {
    this.count++;
  }

  peerCount(): number {
    return 0;
  }

  leave(): Promise<void> {
    return Promise.resolve();
  }
}
