// The pitch's layers, composed (M4's design, research/m4/DESIGN.md, §1.38,
// §1.63, §12's extension points): each later builder's layers come from a
// file of its own, so no two builders share one, and this one composes them
// in order: the HUD, the overlay and the menu (hud.ts), then the networked
// notes (net.ts), the devices' (devices.ts), the sound's (sound.ts) and the
// effects' (effects.ts). The pitch screen (src/ui/screens/pitch.ts) makes
// each from a host of its own. New at M4, by the slice (1c).

import type { Layer, LayerFactory, PitchHost } from '../layer';
import { LAYERS as DEVICES } from './devices';
import { LAYERS as EFFECTS } from './effects';
import { LAYERS as HUD } from './hud';
import { LAYERS as NET } from './net';
import { LAYERS as SOUND } from './sound';

/** Every layer over the pitch, in order: what the app hands pitchScreen. */
export const PITCH_LAYERS: readonly LayerFactory[] = [...HUD, ...NET, ...DEVICES, ...SOUND, ...EFFECTS];

/** The layers for one host, in order (§1.63's composition). */
export function pitchLayers(host: PitchHost): Layer[] {
  return PITCH_LAYERS.map((f) => f(host));
}
