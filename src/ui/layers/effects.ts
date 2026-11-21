// The effects' layers (M4's design, research/m4/DESIGN.md, §1.45, §1.63,
// §12's extension points): an empty slot in phase 1, which phase 3's
// effects builder fills (names over the others, and the away marks). New
// at M4, by the slice (1c).

import type { LayerFactory } from '../layer';

export const LAYERS: readonly LayerFactory[] = [];
