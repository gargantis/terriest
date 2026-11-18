// Recordings (design §9.4), for M4's look book, which replays matches
// recorded from the tuning page and the bots (PLAN §12), and for
// e2e/fixtures/: the whole configuration a run used, its first state's
// canonical bytes, each tick's canonical inputs, and the last state's hash.
// The page offers one as a JSON download through an object URL, so it
// touches no storage. It keeps the whole configuration, not a difference
// from today's, so a recording replays the same after settle moves the
// defaults.

import { type Config, config } from '../../src/config';
import { CODEC_VERSION, decodeState, encodeState, hashState } from '../../src/core/sim/codec';
import { canonicalInputs, type TickInput } from '../../src/core/sim/input';
import { simParams } from '../../src/core/sim/params';
import type { MatchState } from '../../src/core/sim/state';
import { makeSim, step } from '../../src/core/sim/step';
import { stateProblems } from '../../src/core/sim/valid';

export const RECORDING_FORMAT = 1;

export interface Recording {
  readonly format: typeof RECORDING_FORMAT;
  readonly codec: number; // CODEC_VERSION
  readonly config: Config; // the whole configuration the run used
  readonly start: string; // encodeState of the first state, as hex
  readonly ticks: readonly (readonly TickInput[])[]; // each tick's canonical inputs
  readonly final: string; // hashState of the last state
}

export interface Recorder {
  /** The inputs step is given, canonicalised as step does. */
  tick(inputs: readonly TickInput[]): void;
  stop(last: Readonly<MatchState>): Recording;
  /** Ticks recorded so far. */
  readonly length: number;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.slice(2 * k, 2 * k + 2), 16);
  return out;
}

/** Records from s on, under c. Throws if stateProblems(s) isn't empty: such
 *  a start, a short pack in play among them, couldn't be replayed. */
export function startRecording(s: Readonly<MatchState>, c: Config): Recorder {
  const problems = stateProblems(s, simParams(c));
  if (problems.length > 0) throw new Error(`this state can't be recorded, since it couldn't be replayed: ${problems.join('; ')}`);
  const start = toHex(encodeState(s));
  const ticks: TickInput[][] = [];
  return {
    get length() {
      return ticks.length;
    },
    tick(inputs) {
      ticks.push(canonicalInputs(inputs, []).map((x) => ({ ...x })));
    },
    stop(last) {
      return { format: RECORDING_FORMAT, codec: CODEC_VERSION, config: c, start, ticks, final: hashState(last) };
    },
  };
}

/** Steps a fresh Sim from the recording's start through its inputs. Throws
 *  on another format or codec, a start decodeState refuses, or a final hash
 *  that differs. */
export function replay(r: Recording): MatchState {
  if (r.format !== RECORDING_FORMAT) throw new Error(`a recording of format ${String(r.format)}, not ${RECORDING_FORMAT}`);
  if (r.codec !== CODEC_VERSION) throw new Error(`a recording of codec ${r.codec}, not ${CODEC_VERSION}`);
  const P = simParams(r.config);
  const bytes = fromHex(r.start);
  const s = bytes && decodeState(bytes, P);
  if (!s) throw new Error("the recording's start doesn't decode under its configuration");
  const sim = makeSim(P, s.packSize);
  for (const inputs of r.ticks) step(sim, s, inputs);
  const final = hashState(s);
  if (final !== r.final) throw new Error(`the replay's final hash, ${final}, isn't the recording's, ${r.final}`);
  return s;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys the current configuration has that a recorded one lacks, by path. */
function missingKeys(have: unknown, want: unknown, prefix = ''): string[] {
  if (!isObject(want)) return [];
  if (!isObject(have)) return [prefix];
  return Object.keys(want).flatMap((k) => (k in have ? missingKeys(have[k], want[k], prefix ? `${prefix}.${k}` : k) : [prefix ? `${prefix}.${k}` : k]));
}

/** A downloaded recording's text, checked for its shape. Throws on JSON that
 *  isn't one, or one recorded before a setting today's configuration has. */
export function parseRecording(text: string): Recording {
  const r: unknown = JSON.parse(text);
  if (!isObject(r)) throw new Error('not a recording');
  if (r.format !== RECORDING_FORMAT) throw new Error(`a recording of format ${String(r.format)}, not ${RECORDING_FORMAT}`);
  if (typeof r.codec !== 'number' || typeof r.start !== 'string' || typeof r.final !== 'string' || !/^[0-9a-f]{16}$/.test(r.final)) {
    throw new Error("a recording's codec, start or final hash is missing");
  }
  if (!isObject(r.config)) throw new Error('a recording without its configuration');
  const missing = missingKeys(r.config, config);
  if (missing.length > 0) throw new Error(`recorded before these settings existed: ${missing.join(', ')}`);
  const ticks = r.ticks;
  const isInput = (x: unknown): boolean => isObject(x) && typeof x.id === 'string' && typeof x.input === 'number' && typeof x.events === 'number';
  if (!Array.isArray(ticks) || !ticks.every((t) => Array.isArray(t) && t.every(isInput))) throw new Error("a recording's ticks aren't lists of inputs");
  return r as unknown as Recording;
}
