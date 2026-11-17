// The render-quality setting (PLAN D-33): high caps the pixel ratio at 2,
// with MSAA; low caps it at 1, without MSAA, and simplifies the effects,
// which at M1 means fewer ropes in the nets. The caps are src/config.ts's;
// the nets' detail is the look's. Settings arrive at M4 (§17), so until
// then the page takes it from the URL: ?quality=low or ?quality=high,
// high by default.

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
}

const DETAIL = {
  high: { ropeSpacingMetres: 1, nettingSpacingMetres: 0.25, anisotropyMax: 8 },
  low: { ropeSpacingMetres: 2, nettingSpacingMetres: 0.5, anisotropyMax: 1 },
} as const;

/** The quality a page's query string asks for: `quality=low` or `quality=high`, else the default. */
export function qualityFrom(search: string): RenderQuality {
  const asked = new URLSearchParams(search).get('quality');
  return asked === 'low' || asked === 'high' ? asked : config.renderQualityDefault;
}

export function qualityDetail(quality: RenderQuality): QualityDetail {
  return { quality, ...config.renderQuality[quality], ...DETAIL[quality] };
}
