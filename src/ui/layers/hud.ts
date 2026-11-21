// The pitch's own layers (M4's design, research/m4/DESIGN.md, §1.38,
// §1.44, §1.45, §1.63, §12's extension points): the HUD (src/ui/hud.ts),
// the overlay's marks (src/ui/overlay.ts) and the match menu
// (src/ui/screens/menu.ts), which must be the layer named 'menu', since
// the pitch screen opens and closes it by that name. Phase 1's menu has
// Resume in Practice and Leave, and no Settings (settings: null); phase 2's
// results-hud and settings builders fill it out. Each layer is put over the
// pitch in this order, its stacking its CSS's z-index. New at M4, by the
// slice (1c).

import { hudLayer } from '../hud';
import type { LayerFactory } from '../layer';
import { overlayLayer } from '../overlay';
import { matchMenu } from '../screens/menu';

export const LAYERS: readonly LayerFactory[] = [
  hudLayer,
  overlayLayer,
  (h) => matchMenu({ practice: h.match.kind === 'practice', resume: () => h.closeMenu(), settings: null, leave: () => h.leave() }),
];
