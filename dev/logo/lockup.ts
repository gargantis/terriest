// The lock-up (dev/logo.html): the trotting terrier with its nearest foot on
// the baseline of "terriest", set in DejaVu Sans Bold, the system's default
// sans here and what the page's own system-ui, sans-serif resolves to; the
// game ships no font, and this draws the name to pixels. A round-joined
// stroke rounds the glyphs' corners. And the link-preview card: a lock-up
// on the page's ground with a line below it, the two centred. In the page,
// by its 2D canvas.

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

export interface CardSpec {
  /** The card's size in px, all of it the ground's colour but the lock-up and the line. */
  readonly w: number;
  readonly h: number;
  readonly ground: number;
  /** Px of ground the lock-up keeps inside the middle square's sides, and everything inside the card's edges. */
  readonly clear: number;
  /** The lock-up; its margin goes unused, as the card places it by its ink. */
  readonly lockup: LockupSpec;
  /** The line below the lock-up, in its family and weight, unstroked, `gap` px of ground between their inks. */
  readonly line: { readonly text: string; readonly fontPx: number; readonly colour: number; readonly gap: number };
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

/** A lock-up laid out: its ink's width and height, and a way to draw it with its ink's top left at (x, y), which
 *  returns the baseline it drew on. */
interface LaidOut {
  readonly w: number;
  readonly h: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): number;
}

async function layOut(o: LockupSpec): Promise<LaidOut> {
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
  return {
    w: textX + inkRight,
    h: bottom - top,
    draw(ctx, x, y) {
      const baseline = Math.round(y - top);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, Math.round(x - o.box[0] * S), Math.round(baseline - o.feet * S));
      setText(ctx);
      ctx.fillStyle = css(o.colour);
      ctx.strokeStyle = css(o.colour);
      if (stroke > 0) ctx.strokeText(o.text, x + textX, baseline);
      ctx.fillText(o.text, x + textX, baseline);
      return baseline;
    },
  };
}

export async function lockup(o: LockupSpec): Promise<Rgba & { readonly baseline: number }> {
  const l = await layOut(o);
  const W = Math.ceil(l.w + 2 * o.margin);
  const H = Math.ceil(l.h + 2 * o.margin);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const baseline = l.draw(ctx, o.margin, o.margin);
  return { w: W, h: H, rgba: ctx.getImageData(0, 0, W, H).data, baseline };
}

/** The link-preview card: the ground, and the lock-up with the line below it, centred by their inks, each on whole
 *  pixels. Refuses a lock-up wider than the middle square less `clear` each side, or a line or the two together that
 *  come within `clear` of the card's edges. */
export async function card(o: CardSpec): Promise<Rgba> {
  const l = await layOut(o.lockup);
  const c = document.createElement('canvas');
  c.width = o.w;
  c.height = o.h;
  const ctx = c.getContext('2d')!;
  const font = `${o.lockup.weight} ${o.line.fontPx}px "${o.lockup.family}"`;
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(o.line.text);
  const lineWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const height = l.h + o.line.gap + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const square = Math.min(o.w, o.h);
  if (l.w > square - 2 * o.clear) throw new Error(`the card's lock-up is ${l.w.toFixed(1)} px wide, past the middle square's ${square} px less ${o.clear} px a side`);
  if (lineWidth > o.w - 2 * o.clear) throw new Error(`the card's line is ${lineWidth.toFixed(1)} px wide, past the card's ${o.w} px less ${o.clear} px a side`);
  if (height > o.h - 2 * o.clear) throw new Error(`the card's lock-up and line are ${height.toFixed(1)} px tall, past its ${o.h} px less ${o.clear} px a side`);
  const top = Math.round((o.h - height) / 2);
  ctx.fillStyle = css(o.ground);
  ctx.fillRect(0, 0, o.w, o.h);
  l.draw(ctx, Math.round((o.w - l.w) / 2), top);
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = css(o.line.colour);
  ctx.fillText(o.line.text, Math.round((o.w - lineWidth) / 2 + m.actualBoundingBoxLeft), Math.round(top + l.h + o.line.gap + m.actualBoundingBoxAscent));
  return { w: o.w, h: o.h, rgba: ctx.getImageData(0, 0, o.w, o.h).data };
}
