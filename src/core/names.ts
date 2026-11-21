// Display names as typed and as shown (M4's design, research/m4/DESIGN.md,
// §1.35, §5.3, §6; PLAN C-17, D-12's M2 note): Home fits a typed name to the
// rule the simulation's cleanName keeps, so a JOIN's name is never dropped,
// and the screens label a terrier that has none. roslambo's
// src/core/names.ts, with terriest's rule: the code units a name may not
// hold are the simulation's isNameControl set and lone surrogates
// (src/core/sim/state.ts), and the limits are the configuration's, through
// SimParams. Pure. New at M4.

import { defaultParams, isNameControl, type SimParams } from './sim/index';

// UTF-16's surrogate ranges.
const HIGH_SURROGATE_FIRST = 0xd800;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

/** A code point's UTF-8 length. */
function utf8Bytes(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** The code units a name keeps: no isNameControl unit and no lone surrogate. */
function withoutRefused(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const u = input.charCodeAt(i);
    if (isNameControl(u)) continue;
    if (u >= HIGH_SURROGATE_FIRST && u < LOW_SURROGATE_FIRST) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= LOW_SURROGATE_FIRST && next <= LOW_SURROGATE_LAST) {
        out += input.slice(i, i + 2);
        i++;
      }
      continue;
    }
    if (u >= LOW_SURROGATE_FIRST && u <= LOW_SURROGATE_LAST) continue;
    out += input[i]!;
  }
  return out;
}

/** A typed name fitted to C-17's rule: control units and lone surrogates dropped, trimmed, cut on a code
 *  point to nameMaxChars code points and nameMaxBytes UTF-8 bytes, and trimmed again, so cleanName never
 *  drops it (D-12's M2 note): for any string s, nameAllowed(fitName(s)). */
export function fitName(input: string, P: SimParams = defaultParams): string {
  let out = '';
  let chars = 0;
  let bytes = 0;
  for (const c of withoutRefused(input).trim()) {
    const b = utf8Bytes(c.codePointAt(0)!);
    if (chars + 1 > P.nameMaxChars || bytes + b > P.nameMaxBytes) break;
    out += c;
    chars++;
    bytes += b;
  }
  return out.trim();
}

/** A terrier's label on the screens: its name, or for one without a name "Player" and four hex digits of
 *  its ID, which stays with its browser (roslambo's rule, M4's design §6). A bot's JOIN names it "Bot"
 *  and four hex digits already (D-39). */
export function shownName(name: string, id: string): string {
  return name !== '' ? name : `Player ${id.slice(0, 4).toUpperCase()}`;
}
