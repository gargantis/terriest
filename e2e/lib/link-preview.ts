// The link-preview tags in index.html's head (the owner's request of
// 2026-11-23, PLAN's status): what a chat app or a social site reads when a
// link to the game is pasted, Open Graph's tags, X's card, the description,
// the canonical address and the theme colour, each with its value. Their
// URLs are absolute, on the site's own address, since an unfurler reads the
// page alone; the page itself never requests them. The card, public/og.png,
// is drawn by the logo page (dev/logo.html), whose test checks it against
// these. e2e/link-preview.spec.ts reads the tags from the built page in each
// engine, and link-preview.test.ts from index.html itself.

/** The site's own address, which every URL in the tags is on. */
export const SITE = 'https://terriest.com/';

/** The card's path under the site's root, where public/ ships. */
export const CARD_FILE = 'og.png';

/** The page's description, and its card's, for a reader that shows it. */
export const DESCRIPTION =
  'Two packs of small dogs corral a giant rubber ball into goals. Play in your browser against bots, or with friends by link, up to 4 a side.';

/** What the card shows, for a reader that can't see it. */
export const CARD_ALT = 'A cream terrier in a blue bandana trots beside the name terriest. Below it: Two packs of small dogs. One giant ball.';

/** A tag in the head: a meta by its name or its property, or a link by its rel, and its content or its href. */
export interface PreviewTag {
  readonly attr: 'name' | 'property' | 'rel';
  readonly key: string;
  readonly value: string;
}

/** Each tag, in index.html's order; each is there once. */
export const PREVIEW_TAGS: readonly PreviewTag[] = [
  { attr: 'name', key: 'description', value: DESCRIPTION },
  { attr: 'property', key: 'og:title', value: 'terriest' },
  { attr: 'property', key: 'og:description', value: DESCRIPTION },
  { attr: 'property', key: 'og:site_name', value: 'terriest' },
  { attr: 'property', key: 'og:type', value: 'website' },
  { attr: 'property', key: 'og:url', value: SITE },
  { attr: 'property', key: 'og:locale', value: 'en' },
  { attr: 'property', key: 'og:image', value: `${SITE}${CARD_FILE}` },
  { attr: 'property', key: 'og:image:type', value: 'image/png' },
  { attr: 'property', key: 'og:image:width', value: '1200' },
  { attr: 'property', key: 'og:image:height', value: '630' },
  { attr: 'property', key: 'og:image:alt', value: CARD_ALT },
  { attr: 'name', key: 'twitter:card', value: 'summary_large_image' },
  { attr: 'name', key: 'twitter:image:alt', value: CARD_ALT },
  { attr: 'name', key: 'theme-color', value: '#1d2b1f' },
  { attr: 'rel', key: 'canonical', value: SITE },
];
