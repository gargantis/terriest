import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CANARY_EXPECTED } from '../canary-expected';
import { canaryHash } from '../core/sim/index';
import { canaryCheck, canaryOk } from './canary';

// The canary (M4's design §1.50, §1.54, §9.2's canary row; PLAN D-23,
// M4-Q5): the define the build gives src/canary-expected.ts is
// goldens.json's canary, which Node computes, so this browser's verdict is
// yes; a hash that differs says no; and each verdict is computed once, at
// its first call, then kept.

const goldens = JSON.parse(readFileSync(new URL('../core/sim/goldens.json', import.meta.url), 'utf8')) as { canary: string };

describe('the canary (D-23)', () => {
  it("expects goldens.json's canary, by the build's define, and Node computes it", () => {
    expect(CANARY_EXPECTED).toMatch(/^[0-9a-f]{16}$/);
    expect(CANARY_EXPECTED).toBe(goldens.canary);
    expect(canaryOk()).toBe(true);
  });

  it('says no to a browser whose hash differs, computing it once whatever it says', () => {
    let computed = 0;
    const hash = (): string => {
      computed++;
      return canaryHash();
    };
    const wrong = canaryCheck(goldens.canary.replace(/^./, (c) => (c === '0' ? '1' : '0')), hash);
    expect([wrong(), wrong(), computed]).toEqual([false, false, 1]);
    const right = canaryCheck(goldens.canary, hash);
    expect([right(), right(), computed]).toEqual([true, true, 2]);
  });
});
