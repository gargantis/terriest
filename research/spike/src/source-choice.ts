// Which simulation the page draws, from its URL:
//   ?script=<a golden script's name, or showcase>  (default showcase)
//   &pack=<1-4>      the showcase's pack size (default 4)
//   &slipOut=<rule>  a slip-out rule from src/sim/config.ts (default the script's)
// The default is the showcase at 4 a side: a kickoff, then seeded play that
// goes on through goals and kickoffs for as long as the page is open, under
// M0's pick of slip-out rule (42+flag). The scene draws only the main pitch,
// so scripts on D-4's second shape are refused here.

import { SLIP_OUT_RULES, type SlipOutName } from './sim/config.ts';
import { findScript, showcase } from './sim/scripts.ts';
import type { SimSourceOptions } from './sim/source.ts';

export interface SourceChoice {
  options: SimSourceOptions;
  script: string;
  packSize: number;
  slipOut: SlipOutName;
}

export function sourceChoice(q: URLSearchParams): SourceChoice {
  const name = q.get('script') ?? 'showcase';
  const slip = q.get('slipOut');
  if (slip !== null && !(slip in SLIP_OUT_RULES)) throw new Error(`no slip-out rule named ${slip}`);
  const slipOut = slip === null ? undefined : (slip as SlipOutName);
  if (name === 'showcase') {
    const pack = q.get('pack');
    const packSize = pack === null ? 4 : Number(pack);
    if (!Number.isInteger(packSize) || packSize < 1 || packSize > 4) throw new Error(`pack size ${pack} is outside 1-4`);
    const spec = showcase(packSize, slipOut);
    return { options: slipOut ? { packSize, slipOut } : { packSize }, script: spec.name, packSize, slipOut: spec.slipOut };
  }
  const spec = findScript(name);
  if (!spec) throw new Error(`no script named ${name}`);
  if (spec.pitch !== 'main') throw new Error(`${name} plays on D-4's second shape, which the scene doesn't draw`);
  if (q.get('pack') !== null && Number(q.get('pack')) !== spec.packSize) throw new Error(`${name} plays ${spec.packSize} a side`);
  return { options: slipOut ? { script: name, slipOut } : { script: name }, script: spec.name, packSize: spec.packSize, slipOut: slipOut ?? spec.slipOut };
}
