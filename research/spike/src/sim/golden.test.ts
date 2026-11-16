import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CODEC_VERSION } from './codec';
import { canaryHash, CHECKPOINT_EVERY, goldenSuite, type GoldenResult } from './golden';
import { GOLDEN_SCRIPTS } from './scripts';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN §16 Determinism, M0 run 1: the scripted runs hash identically, every
// 500 ticks, until the goldens are re-emitted on purpose:
//   TERRIEST_SPIKE_EMIT_GOLDENS=1 npx vitest run src/sim/golden.test.ts
// The browsers' check replays the same suite through the production bundle
// and compares with the same file.
const file = fileURLToPath(new URL('./goldens.json', import.meta.url));

interface Goldens { codec: number; checkpointEvery: number; canary: string; runs: GoldenResult[] }

describe('goldens', () => {
  const runs = goldenSuite();
  const canary = canaryHash();

  if (process.env.TERRIEST_SPIKE_EMIT_GOLDENS === '1') {
    it('emits goldens.json', () => {
      const out: Goldens = { codec: CODEC_VERSION, checkpointEvery: CHECKPOINT_EVERY, canary, runs };
      writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
    });
    return;
  }

  it('covers every script, with a checkpoint every 500 ticks', () => {
    expect(runs.map((r) => r.name)).toEqual(GOLDEN_SCRIPTS.map((s) => s.name));
    for (let i = 0; i < runs.length; i++) expect(runs[i]!.checkpoints.length).toBe(Math.floor(GOLDEN_SCRIPTS[i]!.ticks / CHECKPOINT_EVERY));
  });

  it('replays the same, run twice in one process', () => {
    expect(goldenSuite().map((r) => r.final)).toEqual(runs.map((r) => r.final));
  }, 120_000);

  it('matches goldens.json, checkpoint by checkpoint', () => {
    expect(existsSync(file), 'goldens.json is missing: emit it').toBe(true);
    const want = JSON.parse(readFileSync(file, 'utf8')) as Goldens;
    expect(want.codec).toBe(CODEC_VERSION);
    expect(want.checkpointEvery).toBe(CHECKPOINT_EVERY);
    expect(runs.map((r) => r.name)).toEqual(want.runs.map((r) => r.name));
    for (let i = 0; i < runs.length; i++) {
      const first = runs[i]!.checkpoints.findIndex((h, k) => h !== want.runs[i]!.checkpoints[k]);
      expect(first, `${runs[i]!.name}: first differing checkpoint`).toBe(-1);
      expect(runs[i]).toEqual(want.runs[i]);
    }
    expect(canary).toBe(want.canary);
  }, 120_000);
});
