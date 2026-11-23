import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botIds, personId } from '../../core/bot/bot-id';
import { PLACEHOLDER_LOOK } from '../../render/look';
import { cssDeclarations, cssLength, fake, type FakeDocument, type FakeElement, heardText, installDom, only, shownText } from '../dom-testing';
import { botWord, terrierSwatch } from './bot-head';
import { coatSwatch, packSwatch } from './screen';

// A bot's mark (the owner, 2026-11-23; PLAN §14's Names): a bot's swatch a
// robot's head, one SVG in the swatch's own box, its parts all inside it,
// the outline's ears at the box's sides and its antenna's ball at the top,
// none reaching into the outline's hole, the fill inside the hole with a
// gap all round; filled from the swatch's own colours, a coat's fur and
// markings, a pack's colour or its stripes; its outline the text's colour;
// a person's swatch as it was; and " bot" after a bot's name, heard and
// not seen. The places that use it test it there (Pre-match, Join, Results
// and the follow choice).

const LOOK = PLACEHOLDER_LOOK;
const ME = personId(7, 0);
const BOT = botIds(ME)[0]!;
const CSS = readFileSync(new URL('../screens.css', import.meta.url), 'utf8');

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

type Point = readonly [number, number];

/** A circular arc's points, from its start to its end, by SVG's endpoint parameters with no rotation. */
function arc(from: Point, r: number, large: boolean, sweep: boolean, to: Point, steps = 32): Point[] {
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const d2 = dx * dx + dy * dy;
  const radius = Math.max(r, Math.sqrt(d2));
  const k = Math.sqrt(Math.max(0, (radius * radius - d2) / d2)) * (large === sweep ? -1 : 1);
  const cx = k * dy + (from[0] + to[0]) / 2;
  const cy = -k * dx + (from[1] + to[1]) / 2;
  const a = Math.atan2(from[1] - cy, from[0] - cx);
  let turn = Math.atan2(to[1] - cy, to[0] - cx) - a;
  if (sweep && turn < 0) turn += 2 * Math.PI;
  if (!sweep && turn > 0) turn -= 2 * Math.PI;
  return Array.from({ length: steps + 1 }, (_, i) => [cx + radius * Math.cos(a + (turn * i) / steps), cy + radius * Math.sin(a + (turn * i) / steps)] as const);
}

/** A path's closed shapes, each its outline's points, arcs sampled: M, H, V, A and Z, absolute, as the head
 *  writes them; any other command fails the test. */
function shapes(d: string): Point[][] {
  const out: Point[][] = [];
  let at: Point = [0, 0];
  for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const n = (args ?? '').trim() === '' ? [] : args!.trim().split(/[\s,]+/).map(Number);
    if (cmd === 'M') out.push([(at = [n[0]!, n[1]!])]);
    else if (cmd === 'H') out.at(-1)!.push((at = [n[0]!, at[1]]));
    else if (cmd === 'V') out.at(-1)!.push((at = [at[0], n[0]!]));
    else if (cmd === 'A') {
      const to: Point = [n[5]!, n[6]!];
      expect([n[0], n[2]], `a circular arc, unturned: ${d}`).toEqual([n[1], 0]);
      out.at(-1)!.push(...arc(at, n[0]!, n[3] === 1, n[4] === 1, to).slice(1));
      at = to;
    } else if (cmd === 'Z') at = out.at(-1)![0]!;
    else throw new Error(`no command ${cmd} in a head's path`);
  }
  return out;
}

const bounds = (ps: readonly Point[]): { x0: number; y0: number; x1: number; y1: number } => ({
  x0: Math.min(...ps.map((p) => p[0])), y0: Math.min(...ps.map((p) => p[1])), x1: Math.max(...ps.map((p) => p[0])), y1: Math.max(...ps.map((p) => p[1])),
});
/** A closed shape's signed area: positive clockwise on the screen, whose y runs down. */
const area = (ps: readonly Point[]): number => ps.reduce((sum, p, k) => {
  const q = ps[(k + 1) % ps.length]!;
  return sum + (p[0] * q[1] - q[0] * p[1]) / 2;
}, 0);
const round = (b: ReturnType<typeof bounds>): number[] => [b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v * 1000) / 1000);

/** The head in a bot's swatch: its SVG, its paths by class, each path's fill. */
function headOf(swatch: HTMLElement): { svg: FakeElement; paths: Record<string, FakeElement>; fills: Record<string, string> } {
  const svg = only(swatch, 'svg');
  const paths = Object.fromEntries(svg.querySelectorAll('path').map((p) => [p.className, p]));
  return { svg, paths, fills: Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, p.style.getPropertyValue('fill')])) };
}

describe("a bot's head (the owner, 2026-11-23)", () => {
  it("leaves a person's swatch as it was, and marks no person's name", () => {
    const coat = coatSwatch(LOOK, 2);
    expect(terrierSwatch(coat, ME)).toBe(coat);
    expect([fake(coat).className, fake(coat).childNodes.length]).toEqual(['swatch coat', 0]);
    const pack = packSwatch(LOOK.packs[1]);
    expect(terrierSwatch(pack, ME)).toBe(pack);
    expect([fake(pack).className, fake(pack).childNodes.length]).toEqual(['swatch pack striped', 0]);
    expect(botWord(ME)).toBeNull();
  });

  it("draws a bot's head in the swatch's own box, filled with its coat as the swatch shows it, its outline the text's colour", () => {
    const swatch = coatSwatch(LOOK, 6);
    const el = fake(terrierSwatch(swatch, BOT));
    expect(el).toBe(fake(swatch));
    // The swatch kept, marked a bot's, still hidden from a screen reader, its coat's colours on it as before.
    expect([el.className, el.getAttribute('aria-hidden')]).toEqual(['swatch coat bot', 'true']);
    expect([el.style.getPropertyValue('--fur'), el.style.getPropertyValue('--marking')]).toEqual(['#efe2c4', '#8a5a35']);
    // One SVG in it, its box the swatch's 18 × 18 (screens.css), which it fills, painting nothing past it.
    const { svg, fills } = headOf(swatch);
    expect([svg.namespaceURI, svg.getAttribute('viewBox')]).toEqual(['http://www.w3.org/2000/svg', '0 0 18 18']);
    expect(['width', 'height'].map((k) => cssLength(cssDeclarations(CSS, '.swatch')[k], 0))).toEqual([18, 18]);
    expect(cssDeclarations(CSS, '.swatch.bot > svg')).toEqual({ display: 'block', width: '100%', height: '100%', overflow: 'hidden' });
    // The fill from the swatch's own custom properties, which the SVG inherits; the outline, ears and antenna
    // in the text's colour, which a pressed follow button and a forced colour set.
    expect(fills).toEqual({ 'bot-face': 'var(--fur)', 'bot-marking': 'var(--marking)', 'bot-line': 'currentColor' });
    // The swatch paints nothing of its own: no ring, no corner, no background, a striped pack's included.
    for (const s of ['.swatch.bot', '.swatch.pack.striped.bot']) {
      expect(cssDeclarations(CSS, s), s).toEqual({ border: '0', 'border-radius': '0', background: 'none' });
    }
  });

  it('keeps every part inside the box, the ears at its sides and the ball at its top, the fill a gap inside the outline', () => {
    const { paths } = headOf(terrierSwatch(coatSwatch(LOOK, 0), BOT));
    const all = Object.values(paths).flatMap((p) => shapes(p.getAttribute('d')!)).flat();
    const out = all.filter(([x, y]) => x < -1e-9 || y < -1e-9 || x > 18 + 1e-9 || y > 18 + 1e-9);
    expect(out, 'points past the box').toEqual([]);
    // The outline: its ears reach the box's sides, its antenna's ball the box's top.
    const line = shapes(paths['bot-line']!.getAttribute('d')!);
    expect(round(bounds(line.flat()))).toEqual([0, 0, 18, 17.5]);
    // Its one counter-clockwise shape cuts the hole; none of the others but the outline's outer edge, which holds
    // it, reaches into the hole.
    const holes = line.filter((s) => area(s) < 0);
    expect(holes).toHaveLength(1);
    const hole = bounds(holes[0]!);
    expect(round(hole)).toEqual([3, 7, 15, 16]);
    const outer = line.filter((s) => area(s) > 0 && bounds(s).x0 <= hole.x0 && bounds(s).x1 >= hole.x1 && bounds(s).y0 <= hole.y0 && bounds(s).y1 >= hole.y1);
    expect(outer, "the outline's outer edge").toHaveLength(1);
    const into = line.filter((s) => area(s) > 0 && s !== outer[0]).map(bounds)
      .filter((b) => b.x0 < hole.x1 - 1e-9 && b.x1 > hole.x0 + 1e-9 && b.y0 < hole.y1 - 1e-9 && b.y1 > hole.y0 + 1e-9);
    expect(into, "parts reaching into the outline's hole").toEqual([]);
    // The fill inside the hole, a px in from its edge all round, so the row's ground shows between them and a
    // white coat's head keeps its outline; the markings inside the fill.
    const face = bounds(shapes(paths['bot-face']!.getAttribute('d')!).flat());
    expect(round(face)).toEqual([hole.x0 + 1, hole.y0 + 1, hole.x1 - 1, hole.y1 - 1]);
    const marking = bounds(shapes(paths['bot-marking']!.getAttribute('d')!).flat());
    expect(marking.x0 >= face.x0 && marking.y0 >= face.y0 && marking.x1 <= face.x1 && marking.y1 <= face.y1, JSON.stringify(marking)).toBe(true);
    // The markings across the bottom right corner, from 58% of the way along the fill's diagonal, as the swatch's
    // gradient starts them.
    expect(round(marking)).toEqual([5.6, 9.12, 14, 15]);
  });

  it("fills a pack's head with its colour, a striped pack's with its stripes, each pattern an ID of its own", () => {
    const blue = packSwatch(LOOK.packs[0]);
    expect(headOf(terrierSwatch(blue, BOT)).fills).toEqual({ 'bot-face': 'var(--c)', 'bot-line': 'currentColor' });
    expect([fake(blue).className, fake(blue).style.getPropertyValue('--c')]).toEqual(['swatch pack plain bot', '#2f6bd8']);
    const heads = [0, 1].map(() => {
      const orange = packSwatch(LOOK.packs[1]);
      const head = headOf(terrierSwatch(orange, botIds(ME)[1]!));
      expect([fake(orange).className, fake(orange).style.getPropertyValue('--c')]).toEqual(['swatch pack striped bot', '#f07a1a']);
      const pattern = only(head.svg, 'pattern');
      expect(head.fills).toEqual({ 'bot-face': `url(#${pattern.id})`, 'bot-line': 'currentColor' });
      // The swatch's stripes: 4 px of the pack's colour, then 3 of --fg, at 45°, as screens.css draws them.
      expect([pattern.getAttribute('patternUnits'), pattern.getAttribute('width'), pattern.getAttribute('patternTransform')]).toEqual(['userSpaceOnUse', '7', 'rotate(-45)']);
      expect(pattern.querySelectorAll('rect').map((r) => [r.getAttribute('x') ?? '0', r.getAttribute('width'), r.style.getPropertyValue('fill')])).toEqual([
        ['0', '4', 'var(--c)'], ['4', '3', 'var(--fg)'],
      ]);
      expect(cssDeclarations(CSS, '.swatch.pack.striped')['background']).toBe('repeating-linear-gradient(45deg, var(--c) 0 4px, var(--fg) 4px 7px)');
      return pattern.id;
    });
    expect(new Set(heads).size, 'two striped heads, two IDs').toBe(2);
  });

  it('says " bot" after a bot\'s name, heard and not seen', () => {
    const word = fake(botWord(BOT));
    expect([word.tagName, word.className, word.textContent]).toEqual(['SPAN', 'visually-hidden', ' bot']);
    const row = fake(dom.document.createElement('li'));
    row.append(fake(terrierSwatch(coatSwatch(LOOK, 0), BOT)), 'Sensor', word, 'white');
    expect([shownText(row), heardText(row)]).toEqual(['Sensorwhite', 'Sensor botwhite']);
  });
});
