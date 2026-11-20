import { describe, expectTypeOf, it } from 'vitest';
import type { Timeline } from '../timeline/timeline';
import type { BarkTimeline } from './index';

// The barks' contract (M4's design §1.36): the bark tracker reads a
// BarkTimeline, which the timeline M3 built satisfies by its shape, so the
// view hands the tracker the timeline held. Checked by the typecheck.

describe("the barks' contract (M4)", () => {
  it('is met by the timeline', () => {
    expectTypeOf<Timeline>().toExtend<BarkTimeline>();
  });
});
