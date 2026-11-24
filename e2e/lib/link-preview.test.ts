import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PREVIEW_TAGS, SITE } from './link-preview';

// index.html's link-preview tags (e2e/lib/link-preview.ts), read from the
// file itself, so a commit that changes one fails here, before the built
// page's spec runs: each tag once with its value, the URLs absolute on the
// site's own address, and the description short enough that a reader shows
// it whole. The checks are soft, so a file that lacks several tags reports
// each.

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'" };

/** Each <meta> and <link> in index.html's head, its comments aside, by its attributes, with HTML's entities decoded. */
function headTags(): Record<string, string>[] {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const head = (/<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const decode = (s: string): string => s.replace(/&(amp|quot|lt|gt|#39);/g, (_, e: string) => ENTITIES[e]!);
  return [...head.matchAll(/<(?:meta|link)\b([^>]*)>/g)].map((tag) =>
    Object.fromEntries([...tag[1]!.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1]!, decode(a[2]!)])),
  );
}

describe("index.html's link-preview tags", () => {
  const tags = headTags();
  /** The content of each meta, or the href of each link, that has `attr` set to `key`. */
  const values = (attr: string, key: string): (string | undefined)[] => tags.filter((t) => t[attr] === key).map((t) => (attr === 'rel' ? t['href'] : t['content']));

  it('carries each tag once, with its value', () => {
    for (const { attr, key, value } of PREVIEW_TAGS) expect.soft(values(attr, key), `${key}, once`).toEqual([value]);
  });

  it("puts every URL on the site's own address, absolute and over https, and keeps the description short", () => {
    const urls = { 'og:url': values('property', 'og:url')[0], 'og:image': values('property', 'og:image')[0], 'the canonical URL': values('rel', 'canonical')[0] };
    for (const [what, url] of Object.entries(urls)) {
      const absolute = url !== undefined && URL.canParse(url) && new URL(url).protocol === 'https:' && url.startsWith(SITE);
      expect.soft(absolute, `${what}, ${String(url)}: absolute, over https, on ${SITE}`).toBe(true);
    }
    const [description] = values('name', 'description');
    expect.soft(description?.length ?? Infinity, 'the description, which a reader may cut past about 155 characters').toBeLessThanOrEqual(155);
  });
});
