// The golden runs' inputs (PLAN §16 Determinism, D-23; design §1.15,
// §7.1): each tick's TickInputs from a run's spec, handed over reversed
// (P4), and a placed run's spec from its scene. Moved out of scripts.ts,
// unchanged, by M4's phase 2a (M4's design §1.50, M4-Q5), so the canary's
// replay, which the page's module holds, reaches none of the golden runs
// themselves: scripts.ts builds those at its top level, and re-exports
// scriptId and scriptTickInputs from here. It ships in the page's module
// and the determinism chunk, so exact operations only (D-1).

import { mirrorInput, type TickInput } from './input';
import { rankedIds, type Scene } from './placing';
import type { Coverage, ScriptCheck, ScriptInput, ScriptSpec } from './scripts';
import type { MatchState, Pack } from './state';

/** The last IDs asked for: every tick asks again, and rankedIds sorts. */
let idCache: { seed: number; players: number; ids: readonly [readonly string[], readonly string[]] } | null = null;

function idsFor(seed: number, players: number): readonly [readonly string[], readonly string[]] {
  if (idCache === null || idCache.seed !== seed || idCache.players !== players) idCache = { seed, players, ids: rankedIds(seed, players) };
  return idCache.ids;
}

/** Player (pack, rank)'s ID in a run. */
export function scriptId(spec: ScriptSpec, pack: Pack, rank: number): string {
  return idsFor(spec.seed, spec.players ?? spec.packSize)[pack]![rank]!;
}

const otherPack = (p: number): number => (p === 0 ? 1 : p === 1 ? 0 : p);

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The mirror of a player's input (P8): its u16 mirrored, and the packs its
 *  JOIN and SWITCH name swapped. */
function mirrorPlayer(x: ScriptInput | null): ScriptInput | null {
  if (x === null) return null;
  const m: Writable<ScriptInput> = { ...x, input: mirrorInput(x.input) };
  if (x.joinPack !== undefined) m.joinPack = otherPack(x.joinPack);
  if (x.switchPack !== undefined) m.switchPack = otherPack(x.switchPack);
  return m;
}

/** Tick t's TickInputs, handed over reversed (P4); s is the state before the tick. */
export function scriptTickInputs(spec: ScriptSpec, t: number, s: Readonly<MatchState>, out: TickInput[] = []): TickInput[] {
  out.length = 0;
  const players = spec.players ?? spec.packSize;
  const ids = idsFor(spec.seed, players);
  for (let pack = 1; pack >= 0; pack--) {
    for (let rank = players - 1; rank >= 0; rank--) {
      const x = spec.mirrored && pack === 1 ? mirrorPlayer(spec.input(0, rank, t, s)) : spec.input(pack as Pack, rank, t, s);
      if (x !== null) out.push({ id: ids[pack]![rank]!, ...x });
    }
  }
  return out;
}

// --- A placed run ---

const NOBODY: ScriptCheck[] = [];

/** A placed run: its scene's state at tick 0 (scenes.ts), its inputs the
 *  scene's, with no events. */
export function placed(name: string, scene: Scene, ticks: number, covers: Coverage, checks: readonly ScriptCheck[] = NOBODY, seed = 0): ScriptSpec {
  return {
    name, packSize: scene.packSize, matchMinutes: 0, ticks, start: scene, seed, mirrored: scene.mirrored,
    input: (pack, rank, t, s) => {
      const v = scene.input(pack, rank, t, s);
      return v === null ? null : { input: v, events: 0 };
    },
    covers, checks,
  };
}
