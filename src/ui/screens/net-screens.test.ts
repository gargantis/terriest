import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../config';
import { botIds, botName, personId } from '../../core/bot/bot-id';
import { formatMatchId } from '../../core/match-id';
import { ENDED, IN_PLAY, type MatchSettings, type MatchState, type Pack, START_COUNTDOWN } from '../../core/sim/index';
import type { UiCommand } from '../../input/source';
import { PLACEHOLDER_LOOK } from '../../render/look';
import { cssDeclarations, fake, FakeEvent, type FakeDocument, type FakeElement, heardText, installDom, only, shownText } from '../dom-testing';
import { MemoryProfile, stateWith, StateMatch } from '../pitch-testing';
import { homeScreen, NOT_A_CODE } from './home';
import { COPIED, invitePanel, NOT_COPIED } from './invite';
import { joinScreen, joinStatus, playState, suggestedPack } from './join';
import { createdScreen, joinedText, playText, proposeScreen } from './propose';
import { focusScreen } from './screen';

// The networked screens' own parts (M4's design §1.43, §5.3, §5.5, §5.6,
// §5.14; PLAN §11, L163, L190, C-15, C-59, Q-17, M4-Q2), on the DOM fake:
// Home's Propose a match and Join with a code, a code taken in lowercase,
// dashes, spaces and Crockford's look-alikes, one that isn't a code said
// so and nothing joined; Propose's choices and Create, "Creating…" once
// pressed, the choices made by the pad's d-pad too (L82), and with the
// app's match rules their row as Practice's setup has it, its Rules…
// opening the Rules screen with the choices made, which its Back brings
// back, Rules… the focus (C-59);
// Created's link, code, joiners and choices; Join's "Connecting to the
// match…" until the state is held, then each pack with its places, a full
// pack's Play marked, the smaller suggested, the countdown's lock; the
// invite's Copy link and Copy code, a refused clipboard said and nothing
// thrown, Share… only where the browser shares; and the gamepad's commands
// on screens whose keys the browser keeps, the keyboard's Enter left to it.

const LOOK = PLACEHOLDER_LOOK;
const ME = personId(7, 0);
const ID = 'TERR1ESTJ01NBYC0DE006'; // a valid match ID (normalizeMatchId)
const pad = (kind: UiCommand['kind']): UiCommand => ({ kind, pressedAt: 0, source: 'gamepad', repeat: false });
const key = (kind: UiCommand['kind']): UiCommand => ({ kind, pressedAt: 0, source: 'keyboard', repeat: false });
const settle = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve();
};
/** What the app's match rules sum up to: any text, which Propose shows as it is (C-59). */
const SUMMARY = 'The rules as the app sums them up';

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

const mount = <S extends { el: HTMLElement }>(s: S): S => {
  dom.document.body.append(fake(s.el));
  return s;
};
const button = (el: FakeElement | HTMLElement, test: string): FakeElement => only(el, `button[data-test="${test}"]`);

describe("Home's matches with others (§5.3, L190)", () => {
  function home(): { el: FakeElement; went: string[]; joined: string[]; ui: (c: UiCommand) => void } {
    const went: string[] = [];
    const joined: string[] = [];
    const s = mount(homeScreen({
      profile: new MemoryProfile(ME), look: LOOK, persistent: () => true,
      propose: () => went.push('propose'), join: (id) => joined.push(id), practice: () => went.push('practice'), settings: () => went.push('settings'),
    }));
    return { el: fake(s.el), went, joined, ui: (c) => s.ui?.(c) };
  }
  const submit = (el: FakeElement): boolean => only(el, 'form').dispatchEvent(new FakeEvent('submit', { bubbles: true, cancelable: true }));

  it('offers Propose a match, Join with a code, Practice and Settings, in that order', () => {
    const { el, went } = home();
    expect(el.querySelectorAll('button').map((b) => b.getAttribute('data-test'))).toEqual(['propose', 'join', 'practice', 'settings']);
    button(el, 'propose').click();
    expect(went).toEqual(['propose']);
    expect(only(el, 'input[data-test="code"]').getAttribute('placeholder')).toBe('K7QM-2XDP-4TR8-WHZN-3VBC-7');
  });

  it("joins by a code typed in lowercase, with dashes, spaces and look-alikes, and says so of one that isn't a code, joining nothing", () => {
    const { el, joined } = home();
    const code = only(el, 'input[data-test="code"]');
    const error = only(el, '[data-test="code-error"]');
    expect(error.hidden).toBe(true);
    for (const typed of ['', 'TERR1ESTJ01NBYC0DE00', 'TERR1ESTJ01NBYC0DE007', 'TERR1ESTJ01NBYC0DE006X', 'hello']) {
      code.value = typed;
      expect(submit(el), typed).toBe(false); // the browser's own submission kept from the page
      expect([error.hidden, error.textContent, error.getAttribute('role')], typed).toEqual([false, NOT_A_CODE, 'alert']);
    }
    expect(joined).toEqual([]);
    code.value = ' terr-1est-j01n-byc0-de00-6 ';
    submit(el);
    code.value = 'TERRIESTJOINBYCODE006'; // I for 1, O for 0: Crockford's look-alikes
    submit(el);
    code.value = 'terr lest jo1n byco de00 6';
    submit(el);
    expect(joined).toEqual([ID, ID, ID]);
    expect(error.hidden).toBe(true);
  });

  it("moves among and presses its buttons by the gamepad, and leaves the keyboard's Enter to the browser (Q-17)", () => {
    const { el, went, ui } = home();
    ui(pad('down'));
    expect(dom.document.activeElement).toBe(button(el, 'propose'));
    ui(key('press'));
    expect(went).toEqual([]); // the browser presses it, by its own activation
    ui(pad('down'));
    ui(pad('down'));
    ui(pad('press'));
    expect(went).toEqual(['practice']);
  });

  it('shows neither where its host offers no matches with others', () => {
    const s = homeScreen({ profile: new MemoryProfile(ME), look: LOOK, persistent: () => true, practice: () => {}, settings: () => {} });
    const el = fake(s.el);
    expect(el.querySelectorAll('button').map((b) => b.getAttribute('data-test'))).toEqual(['practice', 'settings']);
    expect(el.querySelectorAll('form')).toHaveLength(0);
  });
});

describe('Propose and Created (§5.5, L163)', () => {
  it("offers the configuration's pack sizes and lengths, and creates once, reading Creating… meanwhile", () => {
    const made: MatchSettings[] = [];
    const went: string[] = [];
    const s = mount(proposeScreen({ create: (x) => made.push(x), home: () => went.push('home') }));
    const el = fake(s.el);
    expect([s.name, only(el, 'h1').textContent]).toEqual(['propose', 'Propose a match']);
    expect(only(el, 'select[data-test="pack-size"]').value).toBe(String(config.packSizeDefault));
    expect(only(el, 'select[data-test="match-length"]').value).toBe(String(config.matchLengthDefaultMinutes));
    expect(only(el, 'select[data-test="pack-size"]').querySelectorAll('option')).toHaveLength(config.packSizeMax - config.packSizeMin + 1);
    only(el, 'select[data-test="pack-size"]').value = '4';
    only(el, 'select[data-test="match-length"]').value = '10';
    const create = button(el, 'create');
    create.click();
    expect([create.textContent, create.getAttribute('aria-disabled')]).toEqual(['Creating…', 'true']);
    create.click();
    s.ui?.(pad('press'));
    expect(made).toEqual([{ packSize: 4, matchMinutes: 10 }]);
    button(el, 'back').click();
    expect(went).toEqual(['home']);
  });

  it("takes the gamepad's d-pad among its choices, Create and Back, its left and right stepping a focused choice, so a pad player proposes what it chose (L82)", () => {
    const made: MatchSettings[] = [];
    const went: string[] = [];
    const s = mount(proposeScreen({ create: (x) => made.push(x), home: () => went.push('home') }));
    const el = fake(s.el);
    const focused = (): string | null => dom.document.activeElement.getAttribute('data-test');
    const value = (test: string): string => only(el, `select[data-test="${test}"]`).value;
    s.ui?.(pad('down'));
    expect(focused()).toBe('pack-size');
    for (let k = config.packSizeDefault; k <= config.packSizeMax; k++) s.ui?.(pad('right')); // one past the last size
    s.ui?.(key('left')); // the browser's own arrows, never the nav too
    expect([focused(), value('pack-size')]).toEqual(['pack-size', String(config.packSizeMax)]);
    s.ui?.(pad('down'));
    s.ui?.(pad('left'));
    expect([focused(), value('match-length')]).toEqual(['match-length', String(config.matchLengthDefaultMinutes - 1)]);
    s.ui?.(pad('press')); // a select isn't pressed
    s.ui?.(pad('down'));
    expect(focused()).toBe('create');
    s.ui?.(key('press')); // the browser's own Enter there
    expect(made).toEqual([]);
    s.ui?.(pad('press'));
    expect(made).toEqual([{ packSize: config.packSizeMax, matchMinutes: config.matchLengthDefaultMinutes - 1 }]);
    s.ui?.(pad('down'));
    s.ui?.(pad('press'));
    expect(went).toEqual(['home']);
  });

  it("offers no Rules row without the app's match rules, and with them their summary and Rules…, between the choices and Create, which the pad's d-pad reaches and which opens the Rules screen with the choices as they stand (C-59, L82)", () => {
    expect(fake(proposeScreen({ create: () => {}, home: () => {} }).el).querySelectorAll('[data-test="rules"], [data-test="rules-summary"]')).toHaveLength(0);
    const made: MatchSettings[] = [];
    const opened: MatchSettings[] = [];
    const s = mount(proposeScreen({ create: (x) => made.push(x), home: () => {}, rules: { summary: () => SUMMARY, open: (c) => opened.push(c) } }));
    const el = fake(s.el);
    const summary = only(el, '[data-test="rules-summary"]');
    const rules = button(el, 'rules');
    expect([summary.textContent, rules.textContent, rules.getAttribute('aria-describedby'), rules.hasAttribute('data-focus')]).toEqual([SUMMARY, 'Rules…', summary.id, false]);
    const order: (string | null)[] = [];
    for (let k = 0; k < 5; k++) {
      s.ui?.(pad('down'));
      order.push(dom.document.activeElement.getAttribute('data-test'));
    }
    expect(order).toEqual(['pack-size', 'match-length', 'rules', 'create', 'back']);
    s.ui?.(pad('down'));
    s.ui?.(pad('right')); // a size larger
    s.ui?.(pad('down'));
    s.ui?.(pad('down'));
    s.ui?.(pad('press'));
    only(el, 'select[data-test="match-length"]').value = String(config.matchLengthMinMinutes);
    rules.click();
    expect([opened, made]).toEqual([[
      { packSize: config.packSizeDefault + 1, matchMinutes: config.matchLengthDefaultMinutes },
      { packSize: config.packSizeDefault + 1, matchMinutes: config.matchLengthMinMinutes },
    ], []]);
  });

  it('comes back from the Rules screen at the choices it went with, Rules… its focus, and creates with them (C-59)', () => {
    const chosen: MatchSettings = { packSize: config.packSizeMax, matchMinutes: config.matchLengthMinMinutes };
    const made: MatchSettings[] = [];
    const s = mount(proposeScreen({ create: (x) => made.push(x), home: () => {}, rules: { summary: () => SUMMARY, open: () => {} }, chosen }));
    const el = fake(s.el);
    expect(['pack-size', 'match-length'].map((t) => only(el, `select[data-test="${t}"]`).value)).toEqual([String(chosen.packSize), String(chosen.matchMinutes)]);
    expect(button(el, 'rules').getAttribute('data-focus')).toBe('');
    focusScreen(s);
    expect(dom.document.activeElement).toBe(button(el, 'rules'));
    button(el, 'create').click();
    expect(made).toEqual([chosen]);
  });

  it('shows the link and the code, says how many have joined, and offers Play in either pack, Watch and Leave at once', () => {
    let peers = 0;
    const acts: string[] = [];
    const s = mount(createdScreen({
      matchId: ID, look: LOOK, invite: { href: 'https://terriest.test/sub/path/#join=OLD', clipboard: null, share: null }, peers: () => peers,
      play: (p) => acts.push(`play ${p}`), watch: () => acts.push('watch'), leave: () => acts.push('leave'),
    }));
    const el = fake(s.el);
    expect([s.name, only(el, 'h1').textContent]).toEqual(['created', 'Share this match']);
    expect(shownText(el)).toContain('Keep this page open until someone joins');
    expect(only(el, 'input[data-test="invite-link"]').getAttribute('value')).toBe(`https://terriest.test/sub/path/#join=${ID}`);
    expect(only(el, '[data-test="invite-code"]').textContent).toBe('TERR-1EST-J01N-BYC0-DE00-6');
    const status = only(el, '[data-test="created-status"]');
    expect([status.textContent, status.getAttribute('role')]).toEqual(['Nobody has joined yet.', 'status']);
    peers = 2;
    s.update();
    expect(status.textContent).toBe('2 people have joined.');
    expect([joinedText(0), joinedText(1), joinedText(3)]).toEqual(['Nobody has joined yet.', '1 person has joined.', '3 people have joined.']);
    expect(button(el, 'play-0').textContent).toBe(playText(LOOK, 0));
    expect(playText(LOOK, 1)).toBe('Play in the Orange pack');
    for (const test of ['play-0', 'play-1', 'watch', 'created-leave']) button(el, test).click();
    expect(acts).toEqual(['play 0', 'play 1', 'watch', 'leave']);
  });
});

describe('Join (§5.6, M4-Q2)', () => {
  function join(): { s: ReturnType<typeof joinScreen>; el: FakeElement; chose: string[] } {
    const chose: string[] = [];
    const s = mount(joinScreen({ matchId: ID, look: LOOK, play: (p) => chose.push(`play ${p}`), watch: () => chose.push('watch'), home: () => chose.push('home') }));
    return { s, el: fake(s.el), chose };
  }
  const B = (k: number): string => personId(8, k);

  it('reads "Connecting to the match…", offering no choice, until a timeline is held', () => {
    const { s, el } = join();
    expect([s.name, only(el, 'h1').textContent, only(el, '[data-test="join-code"]').textContent]).toEqual(['join', 'Join a match', formatMatchId(ID)]);
    const status = only(el, '[data-test="join-status"]');
    expect([status.textContent, status.getAttribute('role')]).toEqual(['Connecting to the match…', 'status']);
    s.update(null);
    const m = new StateMatch(ME, stateWith(2, 100, []));
    m.started = false;
    s.update(m);
    expect([only(el, '.join-packs').hidden, button(el, 'watch').hidden, button(el, 'join-home').hidden]).toEqual([true, true, false]);
    expect(status.textContent).toBe('Connecting to the match…');
    // The pad meanwhile: its only choice is Home, the Play buttons inside the hidden packs passed over, so
    // the focus moves at all (Q-17, L82); and once the packs show, it reaches them.
    s.ui?.(pad('down'));
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('join-home');
    s.ui?.(pad('up'));
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('join-home');
    s.update(new StateMatch(ME, stateWith(2, 100, [])));
    s.ui?.(pad('down'));
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('play-0');
  });

  it("shows each pack's places and who's in it, the smaller suggested, a full pack's Play marked and pressing nothing", () => {
    const { s, el, chose } = join();
    const m = new StateMatch(ME, stateWith(2, 100, [{ id: B(0), pack: 0, name: 'Ada', coat: 2 }, { id: B(1), pack: 0, name: 'Bo' }, { id: B(2), pack: 1 }]));
    s.update(m);
    expect([only(el, '.join-packs').hidden, button(el, 'watch').hidden]).toEqual([false, false]);
    const coat = (k: number): string => LOOK.coats[k]!.name;
    expect(shownText(only(el, '[data-test="join-pack-0"]'))).toBe(`Ada${coat(2)}Bo${coat(0)}`);
    expect(shownText(only(el, '[data-test="join-pack-1"]'))).toBe(`Player ${B(2).slice(0, 4).toUpperCase()}${coat(0)}A free place`);
    expect(shownText(el)).toContain('2 of 2');
    // Blue is full: its Play aria-disabled, never disabled, saying so; Orange suggested.
    const blue = button(el, 'play-0');
    expect([blue.textContent, blue.getAttribute('aria-disabled'), blue.disabled]).toEqual(['Play in the Blue pack: full', 'true', false]);
    expect([button(el, 'play-1').classList.contains('primary'), blue.classList.contains('primary')]).toEqual([true, false]);
    blue.click();
    s.ui?.(pad('down'));
    s.ui?.(pad('press')); // the pad on Blue's Play: nothing
    expect(chose).toEqual([]);
    button(el, 'play-1').click();
    button(el, 'watch').click();
    button(el, 'join-home').click();
    expect(chose).toEqual(['play 1', 'watch', 'home']);
  });

  it("draws a bot's swatch as a robot's head and says \" bot\" after its name, a person's row as it was (the owner, 2026-11-23)", () => {
    const { s, el } = join();
    // Ada's first bot, a bot by its ID (isBot), beside her in pack A, and Bea in pack B.
    const bot = botIds(B(0))[0]!;
    const name = botName(bot, ['Ada']);
    s.update(new StateMatch(ME, stateWith(2, 100, [{ id: B(0), pack: 0, name: 'Ada', coat: 2 }, { id: bot, pack: 0, name, coat: 6 }, { id: B(1), pack: 1, name: 'Bea' }])));
    const coat = (k: number): string => LOOK.coats[k]!.name;
    const rows = [...only(el, '[data-test="join-pack-0"]').children, only(el, '[data-test="join-pack-1"]').children[0]!];
    expect(rows.map((li) => [only(li, '.swatch').className, only(li, '.swatch').querySelectorAll('svg').length])).toEqual([
      ['swatch coat', 0], ['swatch coat bot', 1], ['swatch coat', 0],
    ]);
    // Heard: " bot" right after the bot's name; seen: every row as it was.
    expect(rows.map((li) => li.children.map((c) => c.className))).toEqual([
      ['swatch coat', 'name', 'coat-name'], ['swatch coat bot', 'name', 'visually-hidden', 'coat-name'], ['swatch coat', 'name', 'coat-name'],
    ]);
    expect(rows.map((li) => heardText(li))).toEqual([`Ada${coat(2)}`, `${name} bot${coat(6)}`, `Bea${coat(0)}`]);
    expect(rows.map((li) => shownText(li))).toEqual([`Ada${coat(2)}`, `${name}${coat(6)}`, `Bea${coat(0)}`]);
  });

  it('suggests the first pack on a tie, and none once the countdown has locked the roster, every Play saying so', () => {
    const tie = stateWith(2, 100, [{ id: B(0), pack: 0 }, { id: B(1), pack: 1 }]);
    expect(suggestedPack(tie)).toBe(0);
    expect(suggestedPack(stateWith(2, 100, [{ id: B(0), pack: 0 }]))).toBe(1);
    expect(suggestedPack(stateWith(1, 100, [{ id: B(0), pack: 0 }, { id: B(1), pack: 1 }]))).toBeNull();
    const counting = { ...tie, phase: START_COUNTDOWN } as MatchState;
    expect(suggestedPack(counting)).toBeNull();
    expect(playState(counting, LOOK, 0)).toEqual({ enabled: false, text: 'Play in the Blue pack: the match has started' });
    const { s, el } = join();
    s.update(new StateMatch(ME, { ...tie, phase: IN_PLAY } as MatchState));
    expect(only(el, '[data-test="join-status"]').textContent).toBe('This match has started: you can watch it.');
    for (const p of [0, 1] as Pack[]) expect(button(el, `play-${p}`).getAttribute('aria-disabled')).toBe('true');
    expect(button(el, 'watch').hidden).toBe(false);
  });

  it("says of a match that has ended, its players on Results, that its results are there to see, every Play and Watch saying what they do there (C-50, phase 2d's review)", () => {
    const tie = stateWith(2, 100, [{ id: B(0), pack: 0 }, { id: B(1), pack: 1 }]);
    const ended = { ...tie, phase: ENDED } as MatchState;
    expect([suggestedPack(ended), joinStatus(ended)]).toEqual([null, 'This match has ended: you can see its results.']);
    expect(playState(ended, LOOK, 1)).toEqual({ enabled: false, text: 'Play in the Orange pack: the match has ended' });
    const { s, el, chose } = join();
    s.update(new StateMatch(ME, ended));
    expect(only(el, '[data-test="join-status"]').textContent).toBe('This match has ended: you can see its results.');
    for (const p of [0, 1] as Pack[]) {
      expect([button(el, `play-${p}`).getAttribute('aria-disabled'), button(el, `play-${p}`).textContent]).toEqual(['true', `${playText(LOOK, p)}: the match has ended`]);
    }
    // Watch, the only choice, beside the status, named for what it does: the results.
    expect([button(el, 'watch').textContent, only(el, '[data-test="watch-alone"]').hidden]).toEqual(['See the results', false]);
    button(el, 'watch').click();
    expect(chose).toEqual(['watch']);
    // A match in play is watched.
    s.update(new StateMatch(ME, { ...tie, phase: IN_PLAY } as MatchState));
    expect([only(el, '[data-test="join-status"]').textContent, button(el, 'watch').textContent]).toEqual(['This match has started: you can watch it.', 'Watch']);
  });

  it("says so when both packs are full, and puts Watch, the only choice, right under the status, first in the pad's nav (phase 2b's review, P8)", () => {
    const { s, el, chose } = join();
    const full = stateWith(1, 100, [{ id: B(0), pack: 0 }, { id: B(1), pack: 1 }]);
    expect(joinStatus(full)).toBe('Both packs are full: you can watch.');
    s.update(new StateMatch(ME, full));
    const status = only(el, '[data-test="join-status"]');
    expect(status.textContent).toBe('Both packs are full: you can watch.');
    // Watch next to the status, above the packs, so a short window shows it without scrolling.
    const order = (): string[] => el.querySelectorAll('button, [data-test="join-status"]').map((b) => b.getAttribute('data-test')!);
    expect(order()).toEqual(['join-status', 'watch', 'play-0', 'play-1', 'join-home']);
    expect(only(el, '[data-test="watch-alone"]').hidden).toBe(false);
    s.ui?.(pad('down'));
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('watch');
    s.ui?.(pad('press'));
    expect(chose).toEqual(['watch']);
    // A place freed: Watch back beside Home, the focus it had kept, and the packs first again.
    s.update(new StateMatch(ME, stateWith(1, 100, [{ id: B(0), pack: 0 }])));
    expect([status.textContent, order()]).toEqual(['Play in a pack, or watch.', ['join-status', 'play-0', 'play-1', 'watch', 'join-home']]);
    expect([only(el, '[data-test="watch-alone"]').hidden, dom.document.activeElement.getAttribute('data-test')]).toEqual([true, 'watch']);
    // And the match started: watching alone again.
    s.update(new StateMatch(ME, { ...full, phase: IN_PLAY } as MatchState));
    expect([status.textContent, order()[1]]).toEqual(['This match has started: you can watch it.', 'watch']);
  });
});

describe('the invite (§5.5, §5.7, C-15)', () => {
  it('copies the link and the code, says so, and says what to do when the clipboard refuses, throwing nothing', async () => {
    const wrote: string[] = [];
    let refuse = false;
    const clipboard = {
      writeText: (t: string): Promise<void> => {
        wrote.push(t);
        return refuse ? Promise.reject(new DOMException('No clipboard here', 'NotAllowedError')) : Promise.resolve();
      },
    };
    const el = fake(invitePanel(ID, { href: 'https://terriest.test/#join=OLD', clipboard, share: null }));
    dom.document.body.append(el);
    // What a refusal selects for copying by hand: the link's field by its own select(), the code by the
    // window's selection.
    const selected: string[] = [];
    Object.assign(only(el, 'input[data-test="invite-link"]'), { select: () => selected.push('link') });
    Object.assign(dom.document.defaultView, { getSelection: () => ({ selectAllChildren: (n: FakeElement) => selected.push(n.getAttribute('data-test')!) }) });
    const said = only(el, '[data-test="invite-said"]');
    expect(said.getAttribute('role')).toBe('status');
    button(el, 'copy-link').click();
    await settle();
    expect([wrote, said.textContent, el.getAttribute('data-copied')]).toEqual([[`https://terriest.test/#join=${ID}`], COPIED.link, 'link']);
    button(el, 'copy-code').click();
    await settle();
    expect([wrote.at(-1), said.textContent, el.getAttribute('data-copied')]).toEqual(['TERR-1EST-J01N-BYC0-DE00-6', COPIED.code, 'code']);
    expect(selected).toEqual([]); // a copy that worked selects nothing
    refuse = true;
    button(el, 'copy-link').click();
    await settle();
    expect([said.textContent, el.getAttribute('data-copied')]).toEqual([NOT_COPIED.link, 'refused']);
    button(el, 'copy-code').click();
    await settle();
    expect([said.textContent, selected]).toEqual([NOT_COPIED.code, ['link', 'invite-code']]);
    // No clipboard at all: said at once.
    const none = fake(invitePanel(ID, { href: 'https://terriest.test/', clipboard: null, share: null }));
    button(none, 'copy-code').click();
    expect(only(none, '[data-test="invite-said"]').textContent).toBe(NOT_COPIED.code);
    // And one that throws as it's asked.
    const throwing = fake(invitePanel(ID, {
      href: 'https://terriest.test/', share: null,
      clipboard: { writeText: () => { throw new TypeError('not now'); } },
    }));
    button(throwing, 'copy-link').click();
    expect(only(throwing, '[data-test="invite-said"]').textContent).toBe(NOT_COPIED.link);
  });

  it('offers Share… only where the browser shares, a cancelled share quiet', async () => {
    expect(fake(invitePanel(ID, { href: 'https://terriest.test/', clipboard: null, share: null })).querySelectorAll('button[data-test="share"]')).toHaveLength(0);
    const shared: ShareData[] = [];
    const el = fake(invitePanel(ID, {
      href: 'https://terriest.test/', clipboard: null,
      share: (d) => {
        shared.push(d);
        return Promise.reject(new DOMException('The user cancelled', 'AbortError'));
      },
    }));
    expect(el.querySelectorAll('button').map((b) => b.textContent)).toEqual(['Copy link', 'Share…', 'Copy code']);
    button(el, 'share').click();
    await settle();
    expect(shared).toEqual([{ title: 'terriest', text: 'Join my terriest match', url: `https://terriest.test/#join=${ID}` }]);
  });

  it("keeps each group of four whole, on the invite and on Join, a line breaking only after a dash, the code's text unchanged (C-15, phase 2d's review)", () => {
    const groups = (el: FakeElement): string[] => el.children.map((c) => `${c.tagName.toLowerCase()}${c.classList.contains('code-group') ? '.code-group' : ''} ${c.textContent}`);
    const want = ['span.code-group TERR-', 'wbr ', 'span.code-group 1EST-', 'wbr ', 'span.code-group J01N-', 'wbr ', 'span.code-group BYC0-', 'wbr ', 'span.code-group DE00-', 'wbr ', 'span.code-group 6'];
    const invite = only(fake(invitePanel(ID, { href: 'https://terriest.test/', clipboard: null, share: null })), '[data-test="invite-code"]');
    const joined = only(fake(joinScreen({ matchId: ID, look: LOOK, play: () => {}, watch: () => {}, home: () => {} }).el), '[data-test="join-code"]');
    for (const el of [invite, joined]) expect([groups(el), el.textContent]).toEqual([want, formatMatchId(ID)]);
    // Each group on one line, and no rule left that breaks inside one.
    const read = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(cssDeclarations(read('../screens.css'), '.code-group')['white-space']).toBe('nowrap');
    expect([cssDeclarations(read('./invite.css'), '.invite-code')['word-break'], cssDeclarations(read('./join.css'), '.join-code')['word-break']]).toEqual([undefined, undefined]);
  });
});
