// The devices' layers (M4's design, research/m4/DESIGN.md, §1.22, §1.26,
// §1.48, §1.63, §12's extension points): an empty slot in phase 1, which
// phase 2's devices builder fills (the touch controls, the control hints
// and the phone's turn prompt). New at M4, by the slice (1c).

import type { LayerFactory } from '../layer';

export const LAYERS: readonly LayerFactory[] = [];
