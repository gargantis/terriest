// The render-quality setting (PLAN D-33; M4's design, research/m4/DESIGN.md,
// §1.19, §2.8): high caps the pixel ratio at 2, with MSAA; low caps it at 1,
// without MSAA, and simplifies the effects: fewer ropes in the nets (M1),
// half the dust, and fewer segments in the ball's sphere. The terriers keep
// theirs, so the drawing budget's triangle counts don't depend on the
// setting. The caps are src/config.ts's; the detail is the look's, drawing
// constants that no one tunes. From M4 the quality is the stored setting's
// (D-33, M4-Q4), which src/main.ts hands the stage and Home's Settings
// changes: M1's ?quality= is gone.

import { config, type RenderQuality } from '../config';

export interface QualityDetail {
  readonly quality: RenderQuality;
  readonly pixelRatioMax: number;
  /** Fixed when the WebGL context is made (D-33). */
  readonly msaa: boolean;
  /** Between the overhead net's ropes, and the goals' netting's. */
  readonly ropeSpacingMetres: number;
  readonly nettingSpacingMetres: number;
  /** The grass texture's anisotropic filtering, at most; the GPU may cap it lower. */
  readonly anisotropyMax: number;
  /** The dust's pool: the most puffs alive at once (M4's design §2.6, phase 3). */
  readonly dustPuffs: number;
  /** The ball's sphere: its segments round, and from pole to pole. */
  readonly ballWidthSegments: number;
  readonly ballHeightSegments: number;
}

const DETAIL = {
  high: { ropeSpacingMetres: 1, nettingSpacingMetres: 0.25, anisotropyMax: 8, dustPuffs: 64, ballWidthSegments: 40, ballHeightSegments: 28 },
  low: { ropeSpacingMetres: 2, nettingSpacingMetres: 0.5, anisotropyMax: 1, dustPuffs: 32, ballWidthSegments: 24, ballHeightSegments: 16 },
} as const;

export function qualityDetail(quality: RenderQuality): QualityDetail {
  return { quality, ...config.renderQuality[quality], ...DETAIL[quality] };
}
