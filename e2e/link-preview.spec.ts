// The page's link-preview tags in every engine (the owner's request of
// 2026-11-23, PLAN's status): what a chat app or a social site reads when a
// link to the game is pasted (e2e/lib/link-preview.ts), from the started
// page that `vite preview` serves. Each tag is there once with its value,
// and og:image's URL and the canonical one are absolute, on the site's own
// address, since an unfurler reads the page alone; those checks are soft,
// so a page that lacks several tags reports each. Then the card og:image
// names, fetched from the page's own server at the path og:image gives: a
// PNG, 1200 × 630 as og:image:width and og:image:height say, and opaque,
// since a reader shows a transparent card on a ground of its own. The page
// never requests the tags' URLs: the guard fails the test on any request
// outside the preview's own base, so none reaches the site.

import { expect, expectWebGL2, test } from './lib/guards';
import { PREVIEW_TAGS, SITE } from './lib/link-preview';
import { expectStarted, smallViewport } from './lib/page';
import { decodePng } from './lib/png';

test.use({ viewport: smallViewport });

test('the page carries its link-preview tags, and its own server serves the card they name', async ({ page, baseURL, guard }) => {
  await expectWebGL2(page);
  guard.allowed = [baseURL!];
  await page.goto(baseURL!);
  await expectStarted(page);

  const head = await page.evaluate(() =>
    [...document.head.querySelectorAll('meta, link')].map((e) => ({
      name: e.getAttribute('name'),
      property: e.getAttribute('property'),
      rel: e.getAttribute('rel'),
      value: e.getAttribute(e.localName === 'link' ? 'href' : 'content'),
    })),
  );
  /** The content of each meta, or the href of each link, that has `attr` set to `key`. */
  const values = (attr: 'name' | 'property' | 'rel', key: string): (string | null)[] => head.filter((t) => t[attr] === key).map((t) => t.value);
  for (const { attr, key, value } of PREVIEW_TAGS) expect.soft(values(attr, key), `${key}, once`).toEqual([value]);
  const [image] = values('property', 'og:image');
  const [canonical] = values('rel', 'canonical');
  const originOf = (url: string | null | undefined): string | null => (url && URL.canParse(url) ? new URL(url).origin : null);
  expect.soft(originOf(image), "og:image's URL: absolute, on the site's own address").toBe(new URL(SITE).origin);
  expect.soft(originOf(canonical), "the canonical URL: absolute, on the site's own address").toBe(new URL(SITE).origin);

  // The card, fetched from the page, so the guard sees the request, at og:image's path under the page's own base.
  expect(image, 'og:image, which names the card').toBeTruthy();
  const url = new URL(new URL(image!, SITE).pathname.slice(1), baseURL).href;
  const got = await page.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, type: r.headers.get('content-type'), bytes: Array.from(new Uint8Array(await r.arrayBuffer())) };
  }, url);
  expect(got.status, `${url}'s status`).toBe(200);
  expect(got.type, `${url}'s type`).toBe('image/png');
  const card = decodePng(Buffer.from(got.bytes));
  expect([card.width, card.height], 'the card, 1200 × 630').toEqual([1200, 630]);
  expect([String(card.width), String(card.height)], "the card's size, as og:image:width and og:image:height give it").toEqual([
    values('property', 'og:image:width')[0], values('property', 'og:image:height')[0],
  ]);
  expect(card.rgba.filter((v, i) => i % 4 === 3 && v !== 255).length, "the card's pixels that aren't opaque").toBe(0);
});
