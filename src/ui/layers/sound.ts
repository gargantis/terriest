// The sound's layer (M4's design, research/m4/DESIGN.md, §1.27, §1.29,
// §1.63, §7, §12's extension points): an empty slot in phase 1, which
// phase 2's sound builder fills (the cues after each timer run, your bark
// at the press, and "Press a key or tap for sound"). New at M4, by the
// slice (1c).

import type { LayerFactory } from '../layer';

export const LAYERS: readonly LayerFactory[] = [];
