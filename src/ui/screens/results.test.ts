import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../config';
import { personId } from '../../core/bot/bot-id';
import type { ConfirmedEnd, MatchNetSummary, ResultRow } from '../../core/session/index';
import { PLACEHOLDER_LOOK } from '../../render/look';
import { FakeClock } from '../clock-testing';
import { fake, FakeEvent, type FakeDocument, installDom, only, shownText } from '../dom-testing';
import type { Announcement } from '../inspect';
import { againText, outcomeText, resultLines, resultsScreen, scoreText, terriestText } from './results';
import { focusScreen } from './screen';

// Results (M4's design §1.43, §4.9, §5.9, §9.2; PLAN D-8, Q-17, C-26;
// M4-Q26): the rows, pack A's first, each named as the screens name it; the
// final score, the outcome and the Terriest or Terriests; and the screen:
// Play again focused first, Q-17's guard for keys and a pointer alike, every
// press announced with its time since Results showed, and Play again's label
// following an AGAIN.

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

  function results(practice: boolean): {
    screen: ReturnType<typeof resultsScreen>; clock: FakeClock; announced: Announcement[]; acts: string[]; again: { seen: boolean };
  } {
    const clock = new FakeClock(5000);
    const announced: Announcement[] = [];
    const acts: string[] = [];
    const again = { seen: false };
    const screen = resultsScreen({
      end: end([row(ME, 0, { name: 'Ada', goals: 3, terriest: true }), row(BOT, 1, { name: 'Bot 1A2B', bot: true, coat: 4 })], [3, 0], 0),
      practice, me: ME, look: LOOK, clock,
      againSeen: () => again.seen,
      summary: () => ({}) as MatchNetSummary,
      playAgain: () => acts.push('again'),
      home: () => acts.push('home'),
      announce: (a) => announced.push(a),
    });
    dom.document.body.append(fake(screen.el));
    return { screen, clock, announced, acts, again };
  }
  const press = (at: number, source: 'keyboard' | 'gamepad' = 'keyboard', repeat = false) => ({ kind: 'press' as const, pressedAt: at, source, repeat });

  it('shows the score, the outcome, the Terriest and a table of the rows with their headers, each coat named', () => {
    const { screen, clock } = results(true);
    const el = fake(screen.el);
    clock.advance(1000);
    expect(only(el, '[data-test="final-score"]').textContent).toBe('Blue 3–0 Orange');
    expect(only(el, '[data-test="outcome"]').textContent).toBe('Blue pack wins. Your pack won.');
    expect(only(el, '[data-test="terriest"]').textContent).toBe('The Terriest: Ada.');
    expect(el.querySelectorAll('th[scope="col"]').map((th) => th.textContent)).toEqual(['Terrier', 'Pack', 'Goals', 'Touches']);
    // Each coat by its name beside its swatch, never its colour alone (§5.14): Ada's coat 0, the bot's 4.
    expect(only(el, 'tbody').children.map((tr) => shownText(tr))).toEqual([
      `Ada${LOOK.coats[0]!.name}youTerriestBlue30`, `Bot 1A2B${LOOK.coats[4]!.name}Orange00`,
    ]);
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
