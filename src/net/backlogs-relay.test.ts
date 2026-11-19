import { describe, expect, it, vi } from 'vitest';
import { IN_PLAY } from '../core/sim/index';
import { NET, Rig, THAWS } from './freezes-testing';

// A forwarder's backlog (PLAN D-19; M3's design, research/m3/DESIGN.md,
// §4.10, §6.5; M3 phase 5a, harness-F1): page 3 can reach only page 2, which
// forwards its TICKs to pages 0 and 1 and theirs to it. Page 2 frozen, or
// its incoming messages held, takes a backlog of each origin's TICKs at
// once, and relayed only while an origin's count stays within half the
// limit, so a count by arrival stopped it relaying their live TICKs for up
// to floodMs. Counted by the ticks they carry, the pair's live inputs flow
// again within d + w ticks, and the receivers keep the forwarder.

vi.setConfig({ testTimeout: 120_000 });

const AT = 10_005; // not a setting: in play
const CHECK_MS = 3000; // not a setting: a rejoin's, then floodMs of relaying
// Past floodMs after the thaw or the release, and the outage's ticks out of the final history: page 3,
// which can ask only page 2, repairs last.
const AFTER_MS = 8000; // not a setting
const BLOCKED = [[0, 3], [1, 3]] as const; // not a setting: page 3's only link is to page 2

/** Page 2 frozen or held ms at `AT`: from d + w ticks after it ends, at each page, every final tick holds
 *  the inputs of the pages it reaches only through page 2; nothing is closed; every hash is equal. */
function relayed(seed: number, ms: number, how: 'frozen' | 'held', thaw: (typeof THAWS)[number] = 'timer'): void {
  const rig = new Rig({ seed, packSize: 2, thaw, blocked: BLOCKED });
  if (how === 'frozen') rig.freeze(2, AT, ms);
  else rig.hold(2, AT, ms);
  rig.runTo(AT - 5);
  expect(rig.final(0).phase).toBe(IN_PLAY);
  expect(rig.nodes.map((x) => x.neighbours.size)).toEqual([2, 2, 3, 1]);
  // Each page's clock tick at the end of the freeze or the hold.
  const end = AT + ms;
  const from: number[] = [];
  rig.net.at(end, () => rig.nodes.forEach((x, k) => (from[k] = Math.floor(x.session.timeline.clock(x.local(rig.net.now))))));
  // Read while the stores still hold those ticks, history of them back from the final tick.
  rig.runTo(end + CHECK_MS);
  const label = `seed ${seed}, page 2 ${how} ${ms} ms, ${thaw} first`;
  const id = (k: number): string => rig.nodes[k]!.session.cfg.me;
  for (const [at, origin] of [[0, 3], [1, 3], [3, 0], [3, 1]] as const) {
    const t = rig.nodes[at]!.session.timeline;
    const missing: number[] = [];
    for (let u = from[at]! + NET.timeline.delay + NET.timeline.window; u <= t.finalTick; u++) if (t.receivedInput(id(origin), u) === undefined) missing.push(u);
    expect(missing, `${label}: page ${origin}'s at page ${at}, from tick ${from[at]}: ${rig.logs()}`).toEqual([]);
  }
  rig.runTo(end + AFTER_MS);
  expect(rig.closed(), `${label}: ${rig.logs()}`).toEqual({ sessions: [[], [], [], []], transport: [] });
  rig.expectClean(label);
}

describe("a forwarder's backlog stops none of the pair's live inputs, and closes nothing (harness-F1)", () => {
  it.each(THAWS)('with the forwarder frozen 1.9, 2.5 and 4.5 s (thawing %s first)', (thaw) => {
    for (const [seed, ms] of [[21, 1900], [22, 2500], [23, 4500]] as const) relayed(seed, ms, 'frozen', thaw);
  });

  it("with the forwarder's incoming messages held 2.5, 4.5 and 8 s", () => {
    // Its PEERS go out meanwhile: each origin's count at the receivers must outlast them.
    for (const [seed, ms] of [[24, 2500], [25, 4500], [26, 8000]] as const) relayed(seed, ms, 'held');
  });
});
