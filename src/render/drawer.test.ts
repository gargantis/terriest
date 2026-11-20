import { describe, expect, it } from 'vitest';
import { secondsSince, textureBytes } from './drawer';

// The drawer contract's two helpers (M4's design §1.2), the M0 spike's.

describe("the drawer contract's helpers (M4)", () => {
  it('times an animation from its start at a drawn time, never before it', () => {
    expect(secondsSince(90, 30, 60)).toBe(1);
    expect(secondsSince(30.5, 30, 60)).toBeCloseTo(1 / 120, 12);
    expect(secondsSince(29, 30, 60)).toBe(0);
  });

  it("counts an RGBA8 texture's bytes, with its whole mipmap chain if mipmapped", () => {
    expect(textureBytes(256, 256, false)).toBe(262144);
    // 256², 128², … 1², 4 bytes each.
    expect(textureBytes(256, 256, true)).toBe(349524);
    // A chain down to 1 × 1, the shorter side held at 1: 4 × 1, 2 × 1, 1 × 1.
    expect(textureBytes(4, 1, true)).toBe(28);
  });
});
