// A bot's mark on the screens (the owner, 2026-11-23; PLAN §14's Names):
// wherever a row names a terrier, Pre-match's pack lists, Join's, Results'
// table and a spectator's follow choice, a bot's swatch is a robot's head,
// one inline SVG in the swatch's own 18 × 18 box (screens.css' .swatch),
// with a ball-topped antenna and an ear on each side, so no row grows and
// nothing reaches past the swatch; a person's is as it was, a coat's round
// swatch or, in the follow choice, its pack's rounded square. The head is
// filled from the swatch's own colours, as the swatch shows them: a coat's
// fur with its markings' colour across the bottom right corner (L44), or,
// in the follow choice, its pack's colour, striped for a striped pack
// (L43). Its outline, ears and antenna are the text's colour, so a pressed
// follow button's dark text and a forced colour carry them, and a gap
// where the row's own ground shows parts the outline from the fill, so a
// white coat's head keeps its outline. After a bot's name, " bot" in
// visually hidden text, so a screen reader hears "Sensor bot" where a
// person's row reads as it did. A bot is told by its ID alone (isBot), as
// every page can. It replaces the "Bot" and four hex digits that named,
// and so marked, a bot before the robot dogs' names (M4's design §5.7).
// New at M4.

import { isBot } from '../../core/bot/bot-id';
import { h } from '../dom';

const SVG = 'http://www.w3.org/2000/svg';

// The head in the swatch's box, in its CSS px, which the viewBox's units are. The edges of the outline, its
// ears and antenna, and of the fill lie on whole and half pixels, so at a device scale of 2 every one is
// sharp, and at 1 the gap between the outline and the fill is a clean line, as is the antenna's stalk.
/** The swatch's box (screens.css' .swatch). */
const BOX = 18;
/** The outline's outer edge: a rounded rectangle across the box between the ears, under the antenna. */
const LEFT = 1.5;
const RIGHT = BOX - LEFT;
const TOP = 5.5;
const BOTTOM = 17.5;
const CORNER = 3;
/** The outline's width, and the gap inside it before the fill. */
const LINE = 1.5;
const GAP = 1;
/** Each ear: from the box's side into the outline, centred on the head. */
const EAR_HEIGHT = 5;
/** The antenna: its ball's radius, its top at the box's top, and its stalk's width, an even number of px
 *  about the box's middle, so its edges lie on whole pixels (the antenna's review). */
const BALL = 2;
const STALK = 2;
/** Where a coat's markings begin, as screens.css' linear-gradient(135deg, fur 58%, marking 58%) puts them:
 *  beyond the line u + v = 2 × 0.58 across the fill's box, u and v its width's and height's fractions. */
const SPLIT = 2 * 0.58 - 1;
/** A striped pack's stripes, as screens.css' repeating-linear-gradient(45deg, colour 0 4px, --fg 4px 7px). */
const STRIPE = 4;
const STRIPES = 7;

/** A rectangle in the box, its corners rounded. */
interface Rounded {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly r: number;
}

const inset = (b: Rounded, by: number): Rounded => ({ x0: b.x0 + by, y0: b.y0 + by, x1: b.x1 - by, y1: b.y1 - by, r: Math.max(0, b.r - by) });

/** The outline's outer edge, its inner edge, and the fill's. */
const OUTER: Rounded = { x0: LEFT, y0: TOP, x1: RIGHT, y1: BOTTOM, r: CORNER };
const INNER = inset(OUTER, LINE);
const FILL = inset(INNER, GAP);

/** A rounded rectangle's path, clockwise, or counter-clockwise to cut a hole under the nonzero rule. */
function rounded(b: Rounded, clockwise = true): string {
  const { x0, y0, x1, y1, r } = b;
  const arc = (x: number, y: number): string => `A${r} ${r} 0 0 ${clockwise ? 1 : 0} ${x} ${y}`;
  return clockwise
    ? `M${x0 + r} ${y0}H${x1 - r}${arc(x1, y0 + r)}V${y1 - r}${arc(x1 - r, y1)}H${x0 + r}${arc(x0, y1 - r)}V${y0 + r}${arc(x0 + r, y0)}Z`
    : `M${x0 + r} ${y0}${arc(x0, y0 + r)}V${y1 - r}${arc(x0 + r, y1)}H${x1 - r}${arc(x1, y1 - r)}V${y0 + r}${arc(x1 - r, y0)}Z`;
}

/** The outline, its ears and its antenna, each clockwise, so under the nonzero rule they make one shape and
 *  the inner edge's counter-clockwise path cuts the outline's hole; none reaches into the hole. */
function line(): string {
  const mid = BOX / 2;
  const ear = (TOP + BOTTOM) / 2 - EAR_HEIGHT / 2;
  return [
    rounded(OUTER),
    rounded(INNER, false),
    `M${mid - STALK / 2} ${BALL}H${mid + STALK / 2}V${INNER.y0}H${mid - STALK / 2}Z`,
    `M${mid - BALL} ${BALL}A${BALL} ${BALL} 0 0 1 ${mid + BALL} ${BALL}A${BALL} ${BALL} 0 0 1 ${mid - BALL} ${BALL}Z`,
    `M0 ${ear}H${INNER.x0}V${ear + EAR_HEIGHT}H0Z`,
    `M${INNER.x1} ${ear}H${BOX}V${ear + EAR_HEIGHT}H${INNER.x1}Z`,
  ].join('');
}

/** A coat's markings across the fill's bottom right corner, beyond SPLIT, its two ends to a hundredth of a px. */
function marking(): string {
  const { x0, y0, x1, y1, r } = FILL;
  const hundredths = (v: number): number => Math.round(v * 100) / 100;
  return `M${x1} ${hundredths(y0 + SPLIT * (y1 - y0))}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${hundredths(x0 + SPLIT * (x1 - x0))}Z`;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number>>, fill?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (fill !== undefined) el.style.setProperty('fill', fill);
  return el;
}

/** Each striped head's pattern, by an ID no other in the page has. */
let stripes = 0;

/** The fill: the swatch's colours, as its classes say it shows them (screens.css), from its own custom
 *  properties, which the SVG inherits. */
function fill(swatch: HTMLElement): SVGElement[] {
  const face = (paint: string): SVGPathElement => svg('path', { class: 'bot-face', d: rounded(FILL) }, paint);
  if (swatch.classList.contains('coat')) return [face('var(--fur)'), svg('path', { class: 'bot-marking', d: marking() }, 'var(--marking)')];
  if (!swatch.classList.contains('striped')) return [face('var(--c)')];
  const id = `bot-stripes-${++stripes}`;
  // Stripes at 45°: a tile's colour and --fg, turned so they run from top left to bottom right, as the swatch's.
  const pattern = svg('pattern', { id, patternUnits: 'userSpaceOnUse', width: STRIPES, height: STRIPES, patternTransform: 'rotate(-45)' });
  pattern.append(svg('rect', { width: STRIPE, height: STRIPES }, 'var(--c)'), svg('rect', { x: STRIPE, width: STRIPES - STRIPE, height: STRIPES }, 'var(--fg)'));
  const defs = svg('defs', {});
  defs.append(pattern);
  return [defs, face(`url(#${id})`)];
}

/** A terrier's swatch in a row that names it, `swatch` its coat's (coatSwatch) or, in the follow choice, its
 *  pack's (packSwatch): a person's as it is; a bot's a robot's head, drawn in the swatch's own box from its
 *  own colours, the swatch marked .bot so it paints nothing of its own (screens.css). */
export function terrierSwatch(swatch: HTMLElement, id: string): HTMLElement {
  if (!isBot(id)) return swatch;
  swatch.classList.add('bot');
  const head = svg('svg', { viewBox: `0 0 ${BOX} ${BOX}` });
  head.append(...fill(swatch), svg('path', { class: 'bot-line', d: line() }, 'currentColor'));
  swatch.append(head);
  return swatch;
}

/** What a screen reader hears right after a bot's name: " bot", visually hidden; nothing after a person's. */
export function botWord(id: string): HTMLElement | null {
  return isBot(id) ? h('span', { class: 'visually-hidden' }, ' bot') : null;
}
