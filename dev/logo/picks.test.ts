import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { cssDeclarations } from '../../src/ui/dom-testing';
import { PAGE_DARK, PAGE_LIGHT, PAGE_MUTED } from './picks';

// The picks' page colours (dev/logo/picks.ts), which the dark tab's outline,
// the lock-ups' text, the phone icon's shadow and the link-preview card
// take, are copies of index.html's own and the screens' muted text colour:
// read here from the page and src/ui/screens.css, so a new colour there
// fails until the picks take it too, and the logo page draws them again.

const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

it("takes index.html's background and text colours", () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const style = /<style>([\s\S]*?)<\/style>/.exec(html);
  expect(style, "index.html's style").not.toBeNull();
  const body = cssDeclarations(style![1]!, 'body');
  expect({ background: body['background'], color: body['color'] }).toEqual({ background: hex(PAGE_DARK), color: hex(PAGE_LIGHT) });
});

it("takes the screens' muted text colour", () => {
  const css = readFileSync(new URL('../../src/ui/screens.css', import.meta.url), 'utf8');
  expect(cssDeclarations(css, ':root')['--muted']).toBe(hex(PAGE_MUTED));
});
