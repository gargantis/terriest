// The pitch's colours under M1's names, read from the placeholder look
// (src/render/look.ts), the M0 spike's, until M4's look book (PLAN §12,
// Q-11), so M1's pitch and the tuning page's drawing read them as before.
// Each pack has a colour and a pattern (L43), so the packs differ in
// pattern as well as colour, and a half and its goal carry the pack that
// defends it (L68). Pack A, 0, defends the goal at −x (D-4).

import { PLACEHOLDER_LOOK } from './look';

export type { Pattern } from './look';

export const PACKS = PLACEHOLDER_LOOK.packs;

export const SKY = PLACEHOLDER_LOOK.pitch.sky;
export const GRASS = PLACEHOLDER_LOOK.pitch.grass;
export const LINE = PLACEHOLDER_LOOK.pitch.line;
/** M1's walls above their padding; from C-57 the glass panes' colour. */
export const WALL_PANEL = PLACEHOLDER_LOOK.pitch.wallPanel;
export const ROPE = PLACEHOLDER_LOOK.pitch.rope;
export const NETTING = PLACEHOLDER_LOOK.pitch.netting;
/** White itself, which the striped frames and the glass's details, band and rail mix with: no look's choice. */
export const WHITE = 0xffffff;
