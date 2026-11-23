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

import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, mountDist, smallViewport } from './lib/page';
import { decodePng } from './lib/png';

test.use({ viewport: smallViewport });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An ICO's directory: each image's size as the entry gives it, and as its PNG's header does. */
function icoImages(ico: Buffer): { entry: string; png: string }[] {
  expect([ico.readUInt16LE(0), ico.readUInt16LE(2)], 'an ICO header: reserved 0, type 1').toEqual([0, 1]);
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    const size = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    const image = ico.subarray(offset, offset + size);
    expect(image.subarray(0, 8).equals(PNG_SIGNATURE), `image ${i} is a PNG`).toBe(true);
    const png = decodePng(image);
    return { entry: `${ico[at] || 256}x${ico[at + 1] || 256}`, png: `${png.width}x${png.height}` };
  });
}

for (const served of ['vite preview', 'a subpath'] as const) {
  test(`the page links its icons relatively, served by ${served}`, async ({ page, baseURL, guard }) => {
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

    expect(icoImages(ico!.bytes), "the ICO's 16, 32 and 48 px images").toEqual(
      ['16x16', '32x32', '48x48'].map((size) => ({ entry: size, png: size })),
    );
    const touch = decodePng(apple!.bytes);
    expect([touch.width, touch.height], 'the touch icon').toEqual([180, 180]);
    expect(touch.rgba.filter((_, i) => i % 4 === 3 && touch.rgba[i] !== 255).length, "the touch icon's transparent pixels").toBe(0);

    // The SVG parses, and this engine draws it as an image.
    const drawn = await page.evaluate(async (url) => {
      const text = await (await fetch(url)).text();
      const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      const img = new Image();
      img.src = url;
      await img.decode();
      return { root: root.localName, images: root.querySelectorAll('image').length, width: img.naturalWidth, height: img.naturalHeight };
    }, links[1]!.url);
    expect(drawn.root).toBe('svg');
    expect(drawn.images, "the light tab's image and the dark tab's").toBe(2);
    expect(drawn.width * drawn.height).toBeGreaterThan(0);
  });
}
