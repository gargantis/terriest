// The lock-up (dev/logo.html): the trotting terrier with its nearest foot on
// the baseline of "terriest", set in DejaVu Sans Bold, the system's default
// sans here and what the page's own system-ui, sans-serif resolves to; the
// game ships no font, and this draws the name to pixels. A round-joined
// stroke rounds the glyphs' corners. In the page, by its 2D canvas.

/** Straight 8-bit RGBA, rows from the top. */
export interface Rgba { readonly w: number; readonly h: number; readonly rgba: Uint8ClampedArray }

export interface LockupSpec {
  /** The mark at its drawn size, drawn 1:1. */
  readonly mark: Rgba;
  /** The mark's feet and its subject's box, in its unit square (the portrait's features). */
  readonly feet: number;
  readonly box: readonly [number, number, number, number];
  readonly text: string;
  /** A family the system has, which the lock-up refuses to draw without. */
  readonly family: string;
  readonly weight: number;
  readonly colour: number;
  readonly fontPx: number;
  /** In em: the stroke's width, which rounds the glyphs' corners. */
  readonly round: number;
  /** Px from the subject's right edge to the text's ink, and of clear margin all round. */
  readonly gap: number;
  readonly margin: number;
}

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** Whether the system has `family`: a canvas falls back silently, so text set in a missing family measures as text set
 *  in its fallback alone, with either fallback. One of them may be the family itself, so one difference is enough. */
export function hasFamily(family: string, weight: number): boolean {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const width = (font: string): number => {
    ctx.font = font;
    return ctx.measureText('terriest mmmwwwiii').width;
  };
  return ['monospace', 'serif'].some((generic) => width(`${weight} 72px "${family}", ${generic}`) !== width(`${weight} 72px ${generic}`));
}

export async function lockup(o: LockupSpec): Promise<Rgba & { readonly baseline: number }> {
  if (!hasFamily(o.family, o.weight)) throw new Error(`the lock-up is set in ${o.family}, which this system lacks`);
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(o.mark.rgba), o.mark.w, o.mark.h), { premultiplyAlpha: 'premultiply' });
  const S = o.mark.w;
  const font = `${o.weight} ${o.fontPx}px "${o.family}"`;
  const stroke = o.round * o.fontPx;
  const setText = (ctx: CanvasRenderingContext2D): void => {
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = stroke;
  };
  const probe = document.createElement('canvas').getContext('2d')!;
  setText(probe);
  const m = probe.measureText(o.text);
  const inkLeft = -m.actualBoundingBoxLeft - stroke / 2;
  const inkRight = m.actualBoundingBoxRight + stroke / 2;
  const ascent = m.actualBoundingBoxAscent + stroke / 2;
  const descent = m.actualBoundingBoxDescent + stroke / 2;
  // From the baseline at y = 0 and the subject's left edge at x = 0.
  const subjectWidth = (o.box[2] - o.box[0]) * S;
  const markTop = (o.box[1] - o.feet) * S;
  const markBottom = (o.box[3] - o.feet) * S;
  const textX = subjectWidth + o.gap - inkLeft;
  const top = Math.min(markTop, -ascent);
  const bottom = Math.max(markBottom, descent, 0);
  const W = Math.ceil(textX + inkRight + 2 * o.margin);
  const H = Math.ceil(bottom - top + 2 * o.margin);
  const baseline = Math.round(o.margin - top);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, Math.round(o.margin - o.box[0] * S), Math.round(baseline - o.feet * S));
  setText(ctx);
  ctx.fillStyle = css(o.colour);
  ctx.strokeStyle = css(o.colour);
  if (stroke > 0) ctx.strokeText(o.text, o.margin + textX, baseline);
  ctx.fillText(o.text, o.margin + textX, baseline);
  return { w: W, h: H, rgba: ctx.getImageData(0, 0, W, H).data, baseline };
}
