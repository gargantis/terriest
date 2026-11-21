// Test support for the Network figures (M4's design, research/m4/DESIGN.md,
// §1.43, §5.9, §9.2; M3-Q24): a match summary with the figures a test
// sets, and a clipboard that keeps what it's given or refuses as the test
// says, with the selections made when it refused. Only tests import it, so
// no build bundles it. New at M4.

import type { MatchNetSummary, Quantiles } from '../../core/session/index';
import type { CopyEnv } from './readout';

/** A body's figures: count samples, zero of them 0, and the percentiles of the rest. */
export const quantiles = (count: number, zero: number, p50: number, p95: number, max: number): Quantiles => ({ count, zero, p50, p95, max });

const NONE = quantiles(0, 0, 0, 0, 0);

/** A summary of nothing but what the test sets. */
export function summaryOf(o: Partial<MatchNetSummary> = {}): MatchNetSummary {
  return {
    ticks: 0, remoteInputs: 0, late: 0, lateAbsent: 0, lateBy: [], rollbacks: 0, corrections: 0, resyncs: 0, resyncFailed: 0,
    ball: NONE, remote: NONE, own: NONE, headings: NONE, repair: { count: 0, ball: NONE, remote: NONE, own: NONE, headings: NONE },
    ...o,
  };
}

/** How the clipboard answers the next write: it takes it, rejects it, or throws as it's called. */
export type CopyAnswer = 'take' | 'reject' | 'throw';

/** A clipboard and a selection for Copy: each write kept, and each element it was asked to select. */
export class FakeCopy implements CopyEnv {
  answer: CopyAnswer = 'take';
  /** Whether select() manages to select. */
  selects = true;
  readonly written: string[] = [];
  readonly selected: HTMLElement[] = [];
  /** The write under way, which the test settles: null once answered. */
  private pending: { take: () => void; refuse: (e: unknown) => void } | null = null;
  /** Hold each write until settle(), so a test sees the panel while it waits. */
  hold = false;

  write(text: string): Promise<void> {
    if (this.answer === 'throw') throw new Error('NotAllowedError: the clipboard is refused');
    this.written.push(text);
    if (this.hold) return new Promise<void>((take, refuse) => (this.pending = { take, refuse }));
    return this.answer === 'take' ? Promise.resolve() : Promise.reject(new Error('NotAllowedError: the clipboard is refused'));
  }

  /** The held write answered, by this.answer. */
  settle(): void {
    const p = this.pending;
    this.pending = null;
    if (p === null) return;
    if (this.answer === 'take') p.take();
    else p.refuse(new Error('NotAllowedError: the clipboard is refused'));
  }

  select(el: HTMLElement): boolean {
    this.selected.push(el);
    return this.selects;
  }
}
