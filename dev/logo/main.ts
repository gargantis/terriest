// dev/logo.html's module (the owner's logo and icons of 2026-11-22, PLAN's
// status): draws the picks (picks.ts) from the game's own terrier in the
// look the page draws, PAGE_LOOK, by src/render/portrait.ts, makes each
// size by its own resampler (post.ts), and sets the lock-ups (lockup.ts).
// Draw shows them here, on a light ground and a dark one; for
// e2e/logo.run.ts, which writes the files, window.logo.render() hands them
// over. Dev only: the build never takes it, and it stores nothing.

import { PAGE_LOOK } from '../../src/render/look';
import { type PortraitFeatures, Portraits } from '../../src/render/portrait';
import { lockup, type Rgba } from './lockup';
import { LOCKUP, LOCKUP_MARK, LOCKUPS, PAGE_DARK, PAGE_LIGHT, SHOTS } from './picks';
import { applyPost, toBytes } from './post';

/** An image as page.evaluate hands it over: straight 8-bit RGBA, base64. */
export interface LogoImage { readonly w: number; readonly h: number; readonly b64: string }

export interface LogoRender {
  /** Each output and lock-up, by name. */
  readonly images: Readonly<Record<string, LogoImage>>;
  /** What drew: Portraits.info(). */
  readonly gl: Record<string, unknown>;
  /** Each shot's drawing and read-back, and the whole render's, in ms. */
  readonly shotsMs: readonly number[];
  readonly totalMs: number;
}

declare global {
  interface Window {
    /** e2e/logo.run.ts's way in. */
    logo?: { render(): Promise<LogoRender> };
  }
}

const portraits = new Portraits(PAGE_LOOK);

/** Every output and lock-up, by name, and each shot's time. */
async function draw(): Promise<{ images: Record<string, Rgba>; shotsMs: number[] }> {
  const images: Record<string, Rgba> = {};
  const features: Record<string, PortraitFeatures> = {};
  const shotsMs: number[] = [];
  for (const shot of SHOTS) {
    const p = portraits.shoot(shot.scene);
    shotsMs.push(p.ms);
    for (const o of shot.outputs) {
      const r = applyPost(p.image, o.size, o.post, p.features);
      images[o.name] = { w: r.img.w, h: r.img.h, rgba: new Uint8ClampedArray(toBytes(r.img).buffer) };
      features[o.name] = r.features;
    }
  }
  const mark = images[LOCKUP_MARK]!;
  const { feet, box } = features[LOCKUP_MARK]!;
  if (feet === null) throw new Error("the lock-up's mark has no feet to stand on the baseline");
  delete images[LOCKUP_MARK];
  for (const l of LOCKUPS) images[l.name] = await lockup({ ...LOCKUP, mark, feet, box, colour: l.colour });
  return { images, shotsMs };
}

function b64(bytes: Uint8ClampedArray): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function render(): Promise<LogoRender> {
  const t0 = performance.now();
  const { images, shotsMs } = await draw();
  const out: Record<string, LogoImage> = {};
  for (const [name, im] of Object.entries(images)) out[name] = { w: im.w, h: im.h, b64: b64(im.rgba) };
  return { images: out, gl: portraits.info(), shotsMs, totalMs: Math.round(performance.now() - t0) };
}

window.logo = { render };

// --- For a person: Draw, and the pictures on a light ground and a dark one, small ones also magnified ---

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

function figure(name: string, im: Rgba): HTMLElement {
  const f = document.createElement('figure');
  for (const ground of [PAGE_LIGHT, PAGE_DARK]) {
    const c = document.createElement('canvas');
    c.width = im.w;
    c.height = im.h;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(im.rgba), im.w, im.h), 0, 0);
    c.style.background = css(ground);
    // Small ones at 1x and four times; large ones fit the column.
    if (im.w <= 48) {
      const big = c.cloneNode() as HTMLCanvasElement;
      big.getContext('2d')!.drawImage(c, 0, 0);
      big.style.width = `${4 * im.w}px`;
      big.className = 'pixels';
      f.append(c, big);
    } else {
      c.className = 'fit';
      f.append(c);
    }
  }
  const caption = document.createElement('figcaption');
  caption.textContent = `${name}, ${im.w} × ${im.h}`;
  f.append(caption);
  return f;
}

const button = document.querySelector<HTMLButtonElement>('#draw')!;
const status = document.querySelector<HTMLElement>('#status')!;
button.addEventListener('click', () => {
  button.disabled = true;
  status.textContent = 'Drawing…';
  const t0 = performance.now();
  void draw()
    .then(({ images }) => {
      const pictures = document.querySelector<HTMLElement>('#pictures')!;
      pictures.replaceChildren(...Object.entries(images).map(([name, im]) => figure(name, im)));
      status.textContent = `Drawn in ${((performance.now() - t0) / 1000).toFixed(1)} s on ${String(portraits.info()['renderer'])}.`;
    })
    .catch((e: unknown) => {
      status.textContent = `Couldn't draw: ${String(e)}`;
    })
    .finally(() => {
      button.disabled = false;
    });
});
document.documentElement.dataset['ready'] = 'yes';
