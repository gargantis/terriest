import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../config';
import { personId } from '../../core/bot/bot-id';
import type { ConfirmedEnd, MatchNetSummary, ResultRow } from '../../core/session/index';
import { PLACEHOLDER_LOOK } from '../../render/look';
import { FakeClock } from '../clock-testing';
import { cssDeclarations, fake, FakeEvent, type FakeDocument, installDom, only, shownText } from '../dom-testing';
import type { Announcement } from '../inspect';
import { COPIED } from './readout';
import { FakeCopy, quantiles, summaryOf } from './readout-testing';
import { againText, outcomeText, resultLines, resultsScreen, scoreText, terriestText } from './results';
import { focusScreen } from './screen';

// Results (M4's design §1.43, §4.9, §5.9, §9.2; PLAN D-8, Q-17, C-26;
// M3-Q24, M4-Q26): the rows, pack A's first, each named as the screens name
// it; the final score, the outcome and the Terriest or Terriests; and the
// screen: Play again focused first, Q-17's guard for keys and a pointer
// alike, every press announced with its time since Results showed, Play
// again's label following an AGAIN, and the Network figures below
// everything else, a match with others' rows or Practice's own, read once as
// Results shows, their Copy among the nav's buttons.

const LOOK = PLACEHOLDER_LOOK;
const ME = personId(7, 0);
const BOT = `${'1a2b'}${'0'.repeat(28)}`;
const row = (id: string, pack: 0 | 1, o: Partial<ResultRow> = {}): ResultRow => ({
  id, name: '', pack, coat: 0, goals: 0, touches: 0, terriest: false, bot: false, ...o,
});
const end = (rows: ResultRow[], score: [number, number], winner: 0 | 1 | null): ConfirmedEnd => ({ tick: 4000, score, winner, rows });

describe("Results' rows and texts", () => {
  const rows = [
    row(BOT, 1, { name: 'Bot 1A2B', goals: 2, touches: 9, terriest: true, bot: true, coat: 4 }),
    row(ME, 0, { name: 'Ada', goals: 1, touches: 12 }),
    row(`${'cc'.repeat(2)}${'0'.repeat(28)}`, 0, { touches: 3 }),
  ];

  it("lists pack A's terriers first, then pack B's, each named as the screens name it (C-26)", () => {
    expect(resultLines(end(rows, [1, 2], 1), LOOK, ME)).toEqual([
      { id: ME, name: 'Ada', coat: 0, pack: 0, packName: 'Blue', goals: 1, touches: 12, terriest: false, you: true, bot: false },
      { id: rows[2]!.id, name: 'Player CCCC', coat: 0, pack: 0, packName: 'Blue', goals: 0, touches: 3, terriest: false, you: false, bot: false },
      { id: BOT, name: 'Bot 1A2B', coat: 4, pack: 1, packName: 'Orange', goals: 2, touches: 9, terriest: true, you: false, bot: true },
    ]);
  });

  it('says the score, who won and whether you did, and the Terriest or Terriests (D-8)', () => {
    expect(scoreText(end(rows, [1, 2], 1), LOOK)).toBe('Blue 1–2 Orange');
    expect(outcomeText(end(rows, [1, 2], 1), LOOK, ME)).toBe('Orange pack wins. Your pack lost.');
    expect(outcomeText(end(rows, [3, 2], 0), LOOK, ME)).toBe('Blue pack wins. Your pack won.');
    expect(outcomeText(end(rows, [1, 2], 1), LOOK, 'f'.repeat(32))).toBe('Orange pack wins.'); // a spectator's
    expect(outcomeText(end(rows, [2, 2], null), LOOK, ME)).toBe('The packs finished level.');
    expect(terriestText(end(rows, [1, 2], 1))).toBe('The Terriest: Bot 1A2B.');
    const level = rows.map((r) => ({ ...r, terriest: true }));
    expect(terriestText(end(level, [1, 2], 1))).toBe('The Terriests: Bot 1A2B, Ada and Player CCCC.');
    expect(terriestText(end(level.slice(0, 2), [1, 2], 1))).toBe('The Terriests: Bot 1A2B and Ada.');
    expect(terriestText(end([], [0, 0], null))).toBe('');
    expect([againText(false), againText(true)]).toEqual(['Play again', 'Join the next match']);
  });
});

describe('the Results screen (Q-17, M4-Q26)', () => {
  let dom: { readonly document: FakeDocument; restore(): void };
  beforeEach(() => {
    dom = installDom();
  });
  afterEach(() => {
    dom.restore();
  });

  function results(practice: boolean, figures: MatchNetSummary = summaryOf()): {
    screen: ReturnType<typeof resultsScreen>; clock: FakeClock; announced: Announcement[]; acts: string[]; again: { seen: boolean };
    copy: FakeCopy; summaries: { read: number };
  } {
    const clock = new FakeClock(5000);
    const announced: Announcement[] = [];
    const acts: string[] = [];
    const again = { seen: false };
    const copy = new FakeCopy();
    const summaries = { read: 0 };
    const screen = resultsScreen({
      end: end([row(ME, 0, { name: 'Ada', goals: 3, terriest: true }), row(BOT, 1, { name: 'Bot 1A2B', bot: true, coat: 4 })], [3, 0], 0),
      practice, me: ME, look: LOOK, clock,
      againSeen: () => again.seen,
      summary: () => {
        summaries.read++;
        return figures;
      },
      playAgain: () => acts.push('again'),
      home: () => acts.push('home'),
      announce: (a) => announced.push(a),
      copy,
    });
    dom.document.body.append(fake(screen.el));
    return { screen, clock, announced, acts, again, copy, summaries };
  }
  const press = (at: number, source: 'keyboard' | 'gamepad' = 'keyboard', repeat = false) => ({ kind: 'press' as const, pressedAt: at, source, repeat });

  it('shows the score, the outcome, the Terriest and a table of the rows with their headers, each coat named', () => {
    const { screen, clock } = results(true);
    const el = fake(screen.el);
    clock.advance(1000);
    expect(only(el, '[data-test="final-score"]').textContent).toBe('Blue 3–0 Orange');
    expect(only(el, '[data-test="outcome"]').textContent).toBe('Blue pack wins. Your pack won.');
    expect(only(el, '[data-test="terriest"]').textContent).toBe('The Terriest: Ada.');
    const table = only(el, 'table[data-test="results"]');
    expect(table.querySelectorAll('th[scope="col"]').map((th) => th.textContent)).toEqual(['Terrier', 'Pack', 'Goals', 'Touches']);
    // Each coat by its name beside its swatch, never its colour alone (§5.14): Ada's coat 0, the bot's 4.
    expect(only(table, 'tbody').children.map((tr) => shownText(tr))).toEqual([
      `Ada${LOOK.coats[0]!.name}youTerriestBlue30`, `Bot 1A2B${LOOK.coats[4]!.name}Orange00`,
    ]);
    // Each row's header a table cell like the others, so the row's rule and the "you" band run level across
    // it: the flex layout on a box inside the cell, never on the cell (phase 2d's review).
    const css = readFileSync(new URL('./results.css', import.meta.url), 'utf8');
    expect(only(table, 'tbody').children.map((tr) => tr.children[0]!.children.map((c) => c.className))).toEqual([['name-row'], ['name-row']]);
    expect(cssDeclarations(css, '.results th.name .name-row')['display']).toBe('flex');
    expect(() => cssDeclarations(css, '.results th.name'), 'no rule of its own for the cell').toThrow(/no rule lists/);
    // Play again and Home right under the end, before the Terriest and the table, so the button focused
    // first shows on a short window however many rows there are (Q-17, §5.9).
    const order = el.children.map((c) => c.getAttribute('data-test') ?? (c.querySelector('[data-test="again"]') !== null ? 'buttons' : c.tagName.toLowerCase()));
    expect(order.slice(0, 5)).toEqual(['h1', 'results-said', 'buttons', 'p', 'terriest']);
    expect(order.indexOf('results')).toBeGreaterThan(order.indexOf('buttons'));
    // The Network figures below everything else (§5.9's "Below them").
    expect(order.at(-1)).toBe('readout');
    screen.dispose!();
  });

  it("shows a match with others' figures, its late inputs, resyncs and repairs among them, and Practice's own without them, each read once as Results shows (M3-Q24)", () => {
    const figures = summaryOf({
      ticks: 3600, remoteInputs: 7200, late: 12, lateAbsent: 1, rollbacks: 40, corrections: 31, resyncs: 1,
      ball: quantiles(30, 2, 0.0123, 0.217, 1.2), repair: { ...summaryOf().repair, count: 1, ball: quantiles(1, 0, 0.5, 0.5, 0.5) },
    });
    const net = results(false, figures);
    const shown = (r: typeof net): string[] =>
      only(fake(r.screen.el), '[data-test="readout"]').querySelectorAll('dd').map((dd) => `${dd.getAttribute('data-test')} ${dd.textContent}`);
    expect(shown(net)).toEqual([
      'readout-ticks 3600', 'readout-inputs 7200', 'readout-late 12 (0.167%)', 'readout-late-absent 1 (0.0139%)', 'readout-rollbacks 40',
      'readout-resyncs 1', 'readout-corrections 31', 'readout-repairs 1',
    ]);
    expect(only(fake(net.screen.el), '[data-test="readout-repair-sizes"]').tagName).toBe('TABLE');
    net.clock.advance(5000);
    expect(net.summaries.read).toBe(1);
    net.screen.dispose!();
    const practice = results(true, figures);
    expect(shown(practice)).toEqual(['readout-ticks 3600', 'readout-rollbacks 40', 'readout-corrections 31']);
    expect(fake(practice.screen.el).querySelectorAll('[data-test="readout-repair-sizes"]')).toEqual([]);
    practice.screen.dispose!();
  });

  it('holds Copy among its buttons, so the keys and the pad reach it and press it, under the guard as Play again and Home are (Q-17, M4-Q26)', async () => {
    const { screen, copy, announced } = results(false, summaryOf({ ticks: 99 }));
    const el = fake(screen.el);
    const button = only(el, 'button[data-test="copy-figures"]');
    focusScreen(screen);
    const guard = config.resultsPressGuardSeconds * 1000;
    screen.ui!({ kind: 'down', pressedAt: 5100, source: 'gamepad', repeat: false });
    screen.ui!({ kind: 'down', pressedAt: 5150, source: 'gamepad', repeat: false });
    expect(dom.document.activeElement).toBe(button);
    screen.ui!(press(5200)); // inside the guard
    button.dispatchEvent(new FakeEvent('pointerdown', { bubbles: true, timeStamp: 5300 }));
    button.click(5000 + guard + 10);
    await new Promise((r) => setTimeout(r, 0));
    expect(copy.written).toEqual([]);
    screen.ui!(press(5000 + guard, 'gamepad'));
    await new Promise((r) => setTimeout(r, 0));
    expect(copy.written.length).toBe(1);
    expect(copy.written[0]).toContain('Final ticks: 99');
    expect(only(el, '[data-test="copy-status"]').textContent).toBe(COPIED);
    expect(announced.filter((a) => a.kind === 'press').map((a) => a.kind === 'press' && a.accepted)).toEqual([false, false, true]);
    screen.dispose!();
  });

  it('says the end in a polite live region, filled just after it shows, the focus staying on Play again (§5.14)', () => {
    const { screen, clock } = results(true);
    const el = fake(screen.el);
    focusScreen(screen);
    const said = only(el, '[data-test="results-said"]');
    expect([said.getAttribute('role'), said.getAttribute('aria-live'), said.getAttribute('aria-atomic')]).toEqual(['status', 'polite', 'true']);
    // Empty as it comes into the page, which a screen reader doesn't read out, then filled, which it does.
    expect(said.textContent).toBe('');
    clock.advance(1000);
    expect(shownText(said)).toBe('Blue 3–0 OrangeBlue pack wins. Your pack won.');
    expect(dom.document.activeElement).toBe(only(el, 'button[data-test="again"]'));
    screen.dispose!();
  });

  it("focuses Play again first, and acts only on a press that began the guard's 0.5 s after it showed, by key, pad or pointer, announcing each", () => {
    const { screen, announced, acts } = results(true);
    const el = fake(screen.el);
    const again = only(el, 'button[data-test="again"]');
    const home = only(el, 'button[data-test="home"]');
    focusScreen(screen);
    expect(dom.document.activeElement).toBe(again);
    const guard = config.resultsPressGuardSeconds * 1000;
    expect(announced).toEqual([{ kind: 'results', atMs: 5000 }]);
    screen.ui!(press(5000 + guard - 1)); // a jump mashed at the final whistle
    screen.ui!(press(5100, 'gamepad'));
    again.dispatchEvent(new FakeEvent('pointerdown', { bubbles: true, timeStamp: 5200 }));
    again.click(5000 + guard + 50); // a tap that began inside the guard, let go after it
    expect(acts).toEqual([]);
    screen.ui!(press(5000 + guard, 'keyboard', true)); // a key held through it: a repeat, never a press
    expect(acts).toEqual([]);
    screen.ui!(press(5000 + guard));
    expect(acts).toEqual(['again']);
    screen.ui!({ kind: 'right', pressedAt: 6000, source: 'gamepad', repeat: false });
    expect(dom.document.activeElement).toBe(home);
    home.dispatchEvent(new FakeEvent('pointerdown', { bubbles: true, timeStamp: 6100 }));
    home.click(6150);
    expect(acts).toEqual(['again', 'home']);
    expect(announced.slice(1)).toEqual([
      { kind: 'press', atMs: guard - 1, source: 'keyboard', accepted: false },
      { kind: 'press', atMs: 100, source: 'gamepad', accepted: false },
      { kind: 'press', atMs: 200, source: 'pointer', accepted: false },
      { kind: 'press', atMs: guard, source: 'keyboard', accepted: true },
      { kind: 'press', atMs: 1100, source: 'pointer', accepted: true },
    ]);
    screen.dispose!();
  });

  it("reads Join the next match once an AGAIN has arrived, in a networked match, and stops looking when it goes", () => {
    const { screen, clock, again } = results(false);
    const button = only(fake(screen.el), 'button[data-test="again"]');
    expect(button.textContent).toBe('Play again');
    again.seen = true;
    clock.advance(300);
    expect(button.textContent).toBe('Join the next match');
    screen.dispose!();
    expect(clock.pending).toBe(0);
    const practice = results(true);
    practice.clock.advance(1000);
    expect(practice.clock.pending).toBe(0); // Practice has no AGAIN to look for
    practice.screen.dispose!();
    // Gone before it was said: nothing left waiting.
    const quick = results(true);
    quick.screen.dispose!();
    expect(quick.clock.pending).toBe(0);
  });
});
