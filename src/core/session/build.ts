// The build hash (PLAN D-21, C-13; M3's design, research/m3/DESIGN.md,
// §1.9, §4.3, M3-Q3): peers whose configuration, state codec, protocol or
// agreeing src/core sources differ would keep resyncing, so the handshake
// refuses them. roslambo's src/core/session/build.ts, which hashed the
// simulation's settings and the two versions, changed: the whole
// configuration, every setting by its path, so d, w and v are in it; and
// the build inputs, the build-time hash of the src/core sources peers agree
// on and of goldens.json (scripts/build-inputs.mjs), which the caller passes,
// since src/core imports nothing outside it but src/config.ts. Unit tests
// pass any string; the page passes src/build-info.ts's BUILD_INPUTS.

import type { Config } from '../../config';
import { PROTOCOL_VERSION } from '../protocol/messages';
import { CODEC_VERSION, hash64 } from '../sim/index';

/** Every setting's path in a configuration, a group's keys under the group's name; an array is one
 *  setting, as src/config.test.ts reads them. */
function settingPaths(value: unknown, prefix: string, out: string[]): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) settingPaths(v, prefix === '' ? k : `${prefix}.${k}`, out);
  } else {
    out.push(prefix);
  }
}

function valueAt(c: unknown, path: string): unknown {
  let v = c;
  for (const k of path.split('.')) v = (v as Record<string, unknown>)[k];
  return v;
}

/** 16 hex digits: hash64 of the UTF-8 of a JSON array of the codec's and the protocol's versions,
 *  every setting as [path, value] in path order, and the build inputs (D-21, design §1.9). */
export function buildHash(c: Config, buildInputs: string): string {
  const paths: string[] = [];
  settingPaths(c, '', paths);
  paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const text = JSON.stringify([CODEC_VERSION, PROTOCOL_VERSION, ...paths.map((p) => [p, valueAt(c, p)]), buildInputs]);
  return hash64(new TextEncoder().encode(text));
}
