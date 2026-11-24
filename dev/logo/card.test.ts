import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_FILE, PREVIEW_TAGS, SITE } from '../../e2e/lib/link-preview';
import { decodePng } from '../../e2e/lib/png';
import { LOGO_FILES } from './files';
import { CARD } from './picks';

// The link-preview card (dev/logo/picks.ts' CARD), as the logo page draws it
// into public/og.png and the repo holds it: CARD's size, opaque, under
// 300 KB, the ground alone within `clear` px of its edges, and two blocks
// of ink, the lock-up and the line below it, the lock-up's inside the
// middle square less `clear` px a side, which a reader that crops the card
// to a square thumbnail keeps. And against the tags that name it
// (e2e/lib/link-preview.ts, whose own test reads them from index.html), so
// a new size, ground or line fails until the tags follow.

const tag = (key: string): string | undefined => PREVIEW_TAGS.find((t) => t.key === key)?.value;
const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** A block of rows with ink, anything but the ground: its first and last row, and its leftmost and rightmost ink. */
interface Block { y0: number; y1: number; x0: number; x1: number }

describe('the link-preview card', () => {
  it("is committed at CARD's size, opaque and small, its lock-up inside the middle square and all of it clear of the edges", () => {
    const bytes = readFileSync(new URL(`../../public/${CARD_FILE}`, import.meta.url));
    expect(bytes.length, 'bytes').toBeLessThan(300 * 1024);
    const png = decodePng(bytes);
    expect([png.width, png.height]).toEqual([CARD.w, CARD.h]);
    const ground = [CARD.ground >> 16, (CARD.ground >> 8) & 255, CARD.ground & 255];
    let notOpaque = 0;
    const blocks: Block[] = [];
    for (let y = 0; y < png.height; y++) {
      let x0 = -1;
      let x1 = -1;
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (png.rgba[i + 3] !== 255) notOpaque++;
        if (ground.some((v, k) => png.rgba[i + k] !== v)) {
          if (x0 < 0) x0 = x;
          x1 = x;
        }
      }
      if (x0 < 0) continue;
      const last = blocks.at(-1);
      if (last && last.y1 === y - 1) Object.assign(last, { y1: y, x0: Math.min(last.x0, x0), x1: Math.max(last.x1, x1) });
      else blocks.push({ y0: y, y1: y, x0, x1 });
    }
    expect(notOpaque, "pixels that aren't opaque").toBe(0);
    expect(blocks.length, 'blocks of ink: the lock-up, and the line below it').toBe(2);
    const c = CARD.clear;
    for (const b of blocks) {
      expect(b.x0 >= c && b.y0 >= c && b.x1 < CARD.w - c && b.y1 < CARD.h - c, `ink from (${b.x0}, ${b.y0}) to (${b.x1}, ${b.y1}), ${c} px inside the edges`).toBe(true);
    }
    const [left, right] = [(CARD.w - CARD.h) / 2 + c, (CARD.w + CARD.h) / 2 - c];
    const lockup = blocks[0]!;
    expect(lockup.x0 >= left && lockup.x1 < right, `the lock-up's ink, ${lockup.x0} to ${lockup.x1}, inside the middle square less ${c} px a side, ${left} to ${right}`).toBe(true);
  });

  it('is the file the tags name, at their size, on their theme colour, with the line their alt texts read', () => {
    expect(LOGO_FILES, 'a file the logo page writes').toContain(`public/${CARD_FILE}`);
    expect(tag('og:image')).toBe(`${SITE}${CARD_FILE}`);
    expect([tag('og:image:width'), tag('og:image:height')]).toEqual([String(CARD.w), String(CARD.h)]);
    expect(tag('theme-color'), "the card's ground").toBe(hex(CARD.ground));
    for (const key of ['og:image:alt', 'twitter:image:alt']) expect(tag(key), key).toContain(CARD.line.text);
  });
});
