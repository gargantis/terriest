import { describe, expect, it, vi } from 'vitest';
import { type Config, config } from '../../config';
import { PROTOCOL_VERSION } from '../protocol/messages';
import { CODEC_VERSION } from '../sim/index';
import { buildHash } from './build';

// The build hash (PLAN D-21, C-13; M3's design, research/m3/DESIGN.md, §1.9,
// §8.1, M3-Q3): 16 hex digits, the same for the same inputs whatever the
// configuration's key order, and different for any change to a setting, the
// protocol's version, the codec's or the build inputs.

const INPUTS = '0123456789abcdef';

/** Every setting's path: its keys, and a group's keys under the group's name; an array is one. */
function paths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

const hasNumber = (v: unknown): boolean => typeof v === 'number' || (Array.isArray(v) && v.some(hasNumber));

/** A copy of the configuration with one setting changed: a number by 1, a boolean flipped, a string
 *  lengthened, an array's first number by 1. */
function planted(path: string): Config {
  const c = structuredClone(config) as unknown as Record<string, unknown>;
  const keys = path.split('.');
  let o = c;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  const last = keys[keys.length - 1]!;
  const change = (v: unknown): unknown => {
    if (typeof v === 'number') return v + 1;
    if (typeof v === 'boolean') return !v;
    if (typeof v === 'string') return `${v}x`;
    if (Array.isArray(v)) {
      const k = v.findIndex(hasNumber);
      return v.map((x, i) => (i === k ? change(x) : x));
    }
    throw new Error(`no change for ${path}`);
  };
  o[last] = change(o[last]);
  return c as unknown as Config;
}

describe('buildHash (D-21)', () => {
  it('is 16 hex digits, the same for the same configuration and inputs', () => {
    const h = buildHash(config, INPUTS);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(buildHash(structuredClone(config) as Config, INPUTS)).toBe(h);
  });

  it("doesn't depend on the configuration's key order", () => {
    const reversed = Object.fromEntries(Object.entries(config).reverse()) as unknown as Config;
    expect(Object.keys(reversed)[0]).not.toBe(Object.keys(config)[0]);
    expect(buildHash(reversed, INPUTS)).toBe(buildHash(config, INPUTS));
  });

  it('changes with every setting, d, w and v among them, each to a hash of its own (C-13)', () => {
    const all = paths(config);
    expect(all).toEqual(expect.arrayContaining(['inputDelayTicks', 'lateWindowTicks', 'voteWindowTicks', 'pitch.lengthMetres', 'kickoffSpotsMetres', 'renderQuality.low.msaa']));
    const base = buildHash(config, INPUTS);
    const hashes = new Map<string, string>();
    for (const p of all) {
      const h = buildHash(planted(p), INPUTS);
      expect(h, p).not.toBe(base);
      hashes.set(h, p);
    }
    expect(hashes.size).toBe(all.length);
  });

  it('changes with the build inputs: the agreeing src/core sources and goldens.json (M3-Q3)', () => {
    expect(buildHash(config, 'fedcba9876543210')).not.toBe(buildHash(config, INPUTS));
    expect(buildHash(config, '')).not.toBe(buildHash(config, INPUTS));
  });

  it("changes with the protocol's version and the codec's", async () => {
    const base = buildHash(config, INPUTS);
    vi.resetModules();
    vi.doMock('../protocol/messages', async (original) => ({ ...(await original<object>()), PROTOCOL_VERSION: PROTOCOL_VERSION + 1 }));
    const protocol = (await import('./build')).buildHash(config, INPUTS);
    vi.doUnmock('../protocol/messages');
    vi.resetModules();
    vi.doMock('../sim/index', async (original) => ({ ...(await original<object>()), CODEC_VERSION: CODEC_VERSION + 1 }));
    const codec = (await import('./build')).buildHash(config, INPUTS);
    vi.doUnmock('../sim/index');
    vi.resetModules();
    expect(new Set([base, protocol, codec]).size).toBe(3);
    expect((await import('./build')).buildHash(config, INPUTS)).toBe(base);
  });
});
