// The networked match's layers (M4's design, research/m4/DESIGN.md, §1.63,
// §5.6–§5.8, §12's extension points): an empty slot in phase 1, which
// phase 2's net-screens builder fills (the networked notes over the pitch,
// "This match is full, so you're watching it" among them). New at M4, by
// the slice (1c).

import type { LayerFactory } from '../layer';

export const LAYERS: readonly LayerFactory[] = [];
