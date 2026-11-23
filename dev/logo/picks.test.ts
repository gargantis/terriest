import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { cssDeclarations } from '../../src/ui/dom-testing';
import { PAGE_DARK, PAGE_LIGHT } from './picks';

// The picks' page colours (dev/logo/picks.ts), which the dark tab's outline,
// the lock-ups' text and the phone icon's shadow take, are copies of
// index.html's own: read here from the page, so a new colour there fails
// until the picks take it too, and the logo page draws them again.

it("takes index.html's background and text colours", () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const style = /<style>([\s\S]*?)<\/style>/.exec(html);
  expect(style, "index.html's style").not.toBeNull();
  const body = cssDeclarations(style![1]!, 'body');
  const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;
  expect({ background: body['background'], color: body['color'] }).toEqual({ background: hex(PAGE_DARK), color: hex(PAGE_LIGHT) });
});
