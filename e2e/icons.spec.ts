// The page's icons in every engine (the owner's pick of 2026-11-22, PLAN's
// status): the tab icon, favicon.ico with its 16, 32 and 48 px images and
// favicon.svg, which an engine that takes SVG icons prefers, and the phone's
// home-screen icon, apple-touch-icon.png, 180 × 180 and opaque, since iOS
// fills a transparent one with black. Each ships from public/, linked
// relatively from index.html, so the site works from a subpath (L232).
// Served two ways, as the smoke spec serves the page: by `vite preview`,
// and from a subpath, /a/b/ on the preview's own origin, answered from
// dist/ by interception with dist/_headers applied. Each test reads the
// started page's icon links, fetches each from the page by the URL the
// browser resolved, and reads what comes back; the guard fails it on any
// request outside the page's own base, an engine's own fetch of an icon
// included. But Playwright takes any request whose URL ends in
// /favicon.ico for the browser's own favicon fetch: it reports none, so
// the guard never sees one, and under interception it aborts it. So from
// the subpath the ICO is fetched with a query, which a static host
// ignores.
// What the SVG draws is read too, since it's the tab icon an engine that
// takes both shows. An SVG shown as an image loads nothing outside itself,
// so its two pictures are PNGs inside it, the light tab's the ICO's own
// 32 px, and the engine must draw it as that picture. Off the page,
// Chromium draws an SVG under the page's preferred colour scheme, so there
// the dark tab's picture is drawn under a dark one too; Firefox and WebKit
// draw the light one whatever the scheme, so there the dark one is read as
// a PNG alone.

import type { Page } from '@playwright/test';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, mountDist, smallViewport } from './lib/page';
import { decodePng } from './lib/png';

test.use({ viewport: smallViewport });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = 'data:image/png;base64,';

/** An ICO's directory: each image's size as the entry gives it and as its PNG's header does, and the PNG. */
function icoImages(ico: Buffer): { entry: string; size: string; png: Buffer }[] {
  expect([ico.readUInt16LE(0), ico.readUInt16LE(2)], 'an ICO header: reserved 0, type 1').toEqual([0, 1]);
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    const length = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    const png = ico.subarray(offset, offset + length);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE), `image ${i} is a PNG`).toBe(true);
    const image = decodePng(png);
    return { entry: `${ico[at] || 256}x${ico[at + 1] || 256}`, size: `${image.width}x${image.height}`, png };
  });
}

/** The share of an image's pixels that are opaque, from its RGBA. */
const opaqueShare = (rgba: ArrayLike<number>): number => {
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 255) opaque++;
  return opaque / (rgba.length / 4);
};

/** The largest difference between two images' channels, from their RGBA. */
const largestDifference = (a: readonly number[], b: readonly number[]): number =>
  a.length === b.length ? a.reduce((most, v, i) => Math.max(most, Math.abs(v - b[i]!)), 0) : Infinity;

/** What this engine draws of each image, loaded off the page and drawn on a 2D canvas `size` px square: RGBA. */
function drawn(page: Page, sources: readonly string[], size: number): Promise<number[][]> {
  return page.evaluate(
    ({ sources, size }) =>
      Promise.all(
        sources.map(async (src) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const g = canvas.getContext('2d', { willReadFrequently: true })!;
          g.drawImage(img, 0, 0, size, size);
          return Array.from(g.getImageData(0, 0, size, size).data);
        }),
      ),
    { sources, size },
  );
}

for (const served of ['vite preview', 'a subpath'] as const) {
  test(`the page links its icons relatively, served by ${served}`, async ({ page, baseURL, browserName, guard }) => {
    await expectWebGL2(page);
    const base = served === 'vite preview' ? baseURL! : new URL('a/b/', baseURL).href;
    guard.allowed = [base];
    if (served === 'a subpath') await mountDist(page, base);
    await page.goto(base);
    await expectStarted(page);

    const links = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon" i], link[rel~="apple-touch-icon" i]')].map((l) => ({
        rel: l.rel, href: l.getAttribute('href'), sizes: l.getAttribute('sizes'), type: l.getAttribute('type'), url: l.href,
      })),
    );
    expect(links.map(({ rel, href, sizes, type }) => ({ rel, href, sizes, type }))).toEqual([
      { rel: 'icon', href: 'favicon.ico', sizes: '32x32', type: null },
      { rel: 'icon', href: 'favicon.svg', sizes: null, type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: 'apple-touch-icon.png', sizes: null, type: null },
    ]);
    for (const { href, url } of links) {
      expect(href, 'a relative href: no scheme, no root').not.toMatch(/^(?:[a-z][a-z\d+.-]*:|\/)/i);
      expect(url, `${href} resolved under the page's own base`).toBe(new URL(href!, base).href);
    }

    // Each fetched from the page, by the URL the browser resolved, so the guard sees the requests.
    const fetched = (url: string): string => (served === 'a subpath' && url.endsWith('/favicon.ico') ? `${url}?fetched` : url);
    const got = await page.evaluate(
      (urls) =>
        Promise.all(
          urls.map(async (url) => {
            const r = await fetch(url);
            return { status: r.status, type: r.headers.get('content-type'), bytes: Array.from(new Uint8Array(await r.arrayBuffer())) };
          }),
        ),
      links.map((l) => fetched(l.url)),
    );
    const [ico, svg, apple] = got.map((g) => ({ ...g, bytes: Buffer.from(g.bytes) }));
    expect(got.map((g) => g.status)).toEqual([200, 200, 200]);
    expect(ico!.type).toMatch(/^image\/(?:x-icon|vnd\.microsoft\.icon)$/);
    expect(svg!.type).toMatch(/^image\/svg\+xml(?:;|$)/);
    expect(apple!.type).toBe('image/png');

    const images = icoImages(ico!.bytes);
    expect(images.map(({ entry, size }) => ({ entry, size })), "the ICO's 16, 32 and 48 px images").toEqual(
      ['16x16', '32x32', '48x48'].map((size) => ({ entry: size, size })),
    );
    for (const { size, png } of images) expect(opaqueShare(decodePng(png).rgba), `the ICO's ${size} image's opaque share`).toBeGreaterThan(0.25);
    const touch = decodePng(apple!.bytes);
    expect([touch.width, touch.height], 'the touch icon').toEqual([180, 180]);
    expect(touch.rgba.filter((_, i) => i % 4 === 3 && touch.rgba[i] !== 255).length, "the touch icon's transparent pixels").toBe(0);

    // The SVG parses, and its two pictures are PNGs inside it: the light tab's, the ICO's own 32 px, and the dark tab's.
    const parsed = await page.evaluate((text) => {
      const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      return { root: root.localName, hrefs: [...root.querySelectorAll('image')].map((image) => image.getAttribute('href') ?? '') };
    }, svg!.bytes.toString('utf8'));
    expect(parsed.root).toBe('svg');
    expect(parsed.hrefs.map((href) => href.slice(0, PNG_DATA_URL.length)), "the light tab's picture and the dark tab's, each a PNG in the SVG").toEqual([
      PNG_DATA_URL, PNG_DATA_URL,
    ]);
    const [light, dark] = parsed.hrefs.map((href) => Buffer.from(href.slice(PNG_DATA_URL.length), 'base64'));
    expect(light!.equals(images.find(({ size }) => size === '32x32')!.png), "the light tab's picture is the ICO's 32 px").toBe(true);
    const darkImage = decodePng(dark!);
    expect([darkImage.width, darkImage.height], "the dark tab's picture").toEqual([32, 32]);
    expect(opaqueShare(darkImage.rgba), "the dark tab's picture's opaque share").toBeGreaterThan(0.25);
    expect(dark!.equals(light!), "the dark tab's picture isn't the light tab's").toBe(false);

    // And this engine draws the SVG as the light tab's picture, as a light tab shows it.
    const svgUrl = links[1]!.url;
    const [asSvg, asLight] = await drawn(page, [svgUrl, parsed.hrefs[0]!], 32);
    expect(opaqueShare(asSvg!), "the drawn SVG's opaque share").toBeGreaterThan(0.25);
    expect(largestDifference(asSvg!, asLight!), "the drawn SVG against the light tab's picture").toBeLessThanOrEqual(2);
    // Chromium, under a dark scheme, as the dark tab's picture.
    if (browserName === 'chromium') {
      await page.emulateMedia({ colorScheme: 'dark' });
      const [asSvgDark, asDark] = await drawn(page, [svgUrl, parsed.hrefs[1]!], 32);
      expect(largestDifference(asSvgDark!, asDark!), "the drawn SVG under a dark scheme against the dark tab's picture").toBeLessThanOrEqual(2);
    }
  });
}
