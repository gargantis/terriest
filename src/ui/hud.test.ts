import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { botName, personId } from '../core/bot/bot-id';
import type { ConfirmedGoal } from '../core/session/index';
import { CELEBRATION, defaultParams, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, START_COUNTDOWN, WARM_UP } from '../core/sim/index';
import type { UiCommand } from '../input/source';
import type { CameraMode } from '../render/frame';
import { cssDeclarations, cssLength, fake, type FakeDocument, FakeElement, installDom, only, shownText } from './dom-testing';
import {
  bannerText, clockText, countdownText, followed, followOrder, goalText, GRAPHICS_NOTE, hudLayer, nameList, nextFollow, OWN_GOAL, percent,
  takenBackText,
} from './hud';
import type { HudInspection } from './inspect';
import type { PitchContext } from './layer';
import { type Calls, drawnOf, FakeControls, FakeStage, FakeView, StateMatch, stateWith, testHost } from './pitch-testing';

// The HUD (M4's design §1.44, §3.4, §5.8, §5.13, §5.14, §9.2; PLAN D-8,
// D-14, D-28, D-30, C-4, C-26; L103, L110, L111, L167): the clock's text,
// m:ss counting down and overtime counting up; each countdown's seconds and
// "Go!"; the score from the scoreboard, your pack marked; a player's meter
// and pounce wait; each countdown and each goal announced once as it shows,
// a goal taken back as well. Phase 2's: the goal's banner, the scorers'
// names from the latch for the celebration's length, "Own goal" when nobody
// is credited, and "Goal taken back" after a withdrawal; the graphics note
// while the context is lost; a spectator's follow choice, Ball and each
// terrier by pack and spot, a tap and next and prev following one through
// setMode; each read back for the hook from what the HUD wrote; and where
// the CSS puts them.

const P = defaultParams;
const TPS = config.ticksPerSecond;
const ME = personId(7, 0);
const BOT = `${'b'.repeat(4)}${'0'.repeat(28)}`;
/** Its name, as its host's JOIN gives it (the owner, 2026-11-22). */
const BOT_NAME = botName(BOT);

describe("the HUD's texts", () => {
  it('reads the clock as m:ss left, a part second as a whole one, and overtime counting up from 0:00 (D-8, L111)', () => {
    expect(clockText(3 * 60 * TPS, false)).toBe('3:00');
    expect(clockText(3 * 60 * TPS - 1, false)).toBe('3:00');
    expect(clockText(179 * TPS, false)).toBe('2:59');
    expect(clockText(10 * TPS + 1, false)).toBe('0:11');
    expect(clockText(1, false)).toBe('0:01');
    expect(clockText(0, false)).toBe('0:00');
    expect(clockText(0, true)).toBe('Overtime 0:00');
    expect(clockText(TPS - 1, true)).toBe('Overtime 0:00');
    expect(clockText(61 * TPS, true)).toBe('Overtime 1:01');
  });

  it("reads each countdown's seconds from the drawn phase and its start, and Go! for the first second of play", () => {
    const at = (phase: number, since: number): string | null => countdownText({ phase: phase as 0, phaseStart: 100, time: 100 + since }, P);
    const start = P.startCountdownTicks / TPS;
    expect(at(START_COUNTDOWN, 0)).toBe(String(start));
    expect(at(START_COUNTDOWN, -0.5)).toBe(String(start)); // drawn half a tick before it starts: never more
    expect(at(START_COUNTDOWN, TPS - 0.1)).toBe(String(start));
    expect(at(START_COUNTDOWN, TPS)).toBe(String(start - 1));
    expect(at(START_COUNTDOWN, P.startCountdownTicks - 0.1)).toBe('1');
    expect(at(START_COUNTDOWN, P.startCountdownTicks + 3)).toBe('1'); // never 0
    expect(at(KICKOFF_COUNTDOWN, 0)).toBe(String(P.kickoffCountdownTicks / TPS));
    expect(at(IN_PLAY, 0)).toBe('Go!');
    expect(at(IN_PLAY, TPS - 0.1)).toBe('Go!');
    expect(at(IN_PLAY, TPS)).toBeNull();
    expect([at(WARM_UP, 0), at(CELEBRATION, 0)]).toEqual([null, null]);
  });

  it('reads the gauges as the screen shows them', () => {
    expect([percent(0.333), percent(0.5), percent(1.2), percent(-0.1)]).toEqual([33, 50, 100, 0]);
  });
});

describe('the HUD layer', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installDom().restore;
  });
  afterEach(() => {
    restore();
  });

  function hud(): { match: StateMatch; layer: ReturnType<typeof hudLayer>; host: ReturnType<typeof testHost>; ctx: (s?: typeof base) => PitchContext } {
    const calls: Calls = [];
    const base = stateWith(1, 100, [{ id: ME, pack: 1 }, { id: BOT, pack: 0 }]);
    const match = new StateMatch(ME, base);
    const view = new FakeView(calls, match);
    const host = testHost({ match, view, stage: new FakeStage(calls), controls: new FakeControls(calls) });
    const layer = hudLayer(host);
    const ctx = (s = match.state): PitchContext => ({
      match, drawn: drawnOf(s), out: null, frame: null, nowMs: 0, mode: view.mode, settings: host.settings.get(), graphics: 'ok', barks: [],
    });
    return { match, layer, host, ctx };
  }
  const goal = (tick: number, pack: 0 | 1, score: [number, number]): ConfirmedGoal => ({ tick, pack, ownGoal: false, scorers: [], score });

  it("shows the score, your pack marked, the clock, the countdown, and a player's gauges", () => {
    const { match, layer, ctx } = hud();
    const el = layer.el!;
    const s = { ...match.state, phase: START_COUNTDOWN, phaseStart: 100, clock: 60 * TPS } as typeof match.state;
    s.terriers = match.state.terriers.map((T) => (T.id === ME ? { ...T, meter: P.meterFull / 2, pounceWait: P.pounceWaitTicks / 4 } : T));
    match.board.score = [1, 2];
    layer.frame!(ctx(s));
    expect(shownText(only(el, '.hud-score'))).toBe('Blue1–Orange2yours');
    expect(only(el, '[data-test="hud-clock"]').textContent).toBe('1:00');
    expect(only(el, '[data-test="hud-countdown"]').textContent).toBe('5');
    expect(only(el, '[data-test="hud-countdown"]').hidden).toBe(false);
    expect(only(only(el, '[data-test="hud-meter"]'), '.hud-gauge-fill').style.getPropertyValue('--fill')).toBe('50%');
    expect(only(el, '[data-test="hud-meter"]').getAttribute('aria-valuenow')).toBe('50');
    expect(only(el, '[data-test="hud-pounce"]').getAttribute('aria-valuenow')).toBe('75');
    expect(only(el, '[data-test="hud-pounce"]').classList.contains('waiting')).toBe(true);
    expect(only(el, '[data-test="hud-score-said"]').textContent).toBe('Score: Blue 1, Orange 2. Your pack: Orange.');
    // Heard: the score and the countdowns in polite live regions; the score shown aria-hidden beside its words (§5.14).
    for (const live of ['hud-score-said', 'hud-countdown']) expect(only(el, `[data-test="${live}"]`).getAttribute('aria-live'), live).toBe('polite');
    expect(only(el, '.hud-score').getAttribute('aria-hidden')).toBe('true');
    // Each pack's score in its colour and its pattern (§5.8, L43).
    const swatches = only(el, '.hud-score').querySelectorAll('.swatch.pack');
    expect(swatches.map((w) => [w.className, w.style.getPropertyValue('--c')])).toEqual([
      ['swatch pack plain', '#2f6bd8'], ['swatch pack striped', '#f07a1a'],
    ]);
    // The hook's figures are what the HUD wrote: the digits, the clock, the countdown shown, the meter's gauge.
    expect(layer.inspect!()).toEqual({
      score: '1–2', clock: '1:00', countdown: '5', scorer: null, meter: 0.5, pounceWait: P.pounceWaitTicks / 4, graphics: 'ok', following: null,
    } satisfies HudInspection);
    // Out of the countdown, none shown, and none reported.
    layer.frame!(ctx({ ...s, phase: WARM_UP } as typeof s));
    expect([only(el, '[data-test="hud-countdown"]').hidden, (layer.inspect!() as HudInspection).countdown]).toEqual([true, null]);
    layer.frame!(ctx(s));
    // A spectator's: no gauges, no pack marked.
    const watching = { ...s, terriers: s.terriers.filter((T) => T.id !== ME) };
    layer.frame!(ctx(watching));
    expect(only(el, '.hud-gauges').hidden).toBe(true);
    expect(shownText(only(el, '.hud-score'))).toBe('Blue1–Orange2');
    expect((layer.inspect!() as HudInspection).meter).toBeNull();
  });

  it('announces each countdown once as it shows, and each goal as it latches and again as it is taken back (§1.40)', () => {
    const { match, layer, host, ctx } = hud();
    const at = (phase: number, phaseStart: number, tick: number) => ({ ...match.state, phase, phaseStart, tick }) as typeof match.state;
    layer.frame!(ctx(at(WARM_UP, 0, 100)));
    layer.frame!(ctx(at(START_COUNTDOWN, 100, 100)));
    layer.frame!(ctx(at(START_COUNTDOWN, 100, 160)));
    layer.frame!(ctx(at(IN_PLAY, 400, 400))); // Go! is no countdown
    match.board.goals.push(goal(900, 0, [1, 0]));
    layer.frame!(ctx(at(CELEBRATION, 900, 905)));
    layer.frame!(ctx(at(KICKOFF_COUNTDOWN, 1104, 1104)));
    layer.frame!(ctx(at(KICKOFF_COUNTDOWN, 1104, 1110)));
    match.clock.advance(250);
    match.board.goals.length = 0; // a repair took it back (C-4)
    layer.frame!(ctx(at(KICKOFF_COUNTDOWN, 1104, 1111)));
    expect(host.announced.map((a) => a.kind === 'countdown' ? `countdown ${a.phaseStart}` : a.kind === 'goal' || a.kind === 'goalWithdrawn' ? `${a.kind} ${a.tick}` : a.kind)).toEqual([
      'countdown 100', 'goal 900', 'countdown 1104', 'goalWithdrawn 900',
    ]);
    // Each goal's and withdrawal's time, the page clock's as it showed (AnnouncementLog's shownAtMs, withdrawnAtMs).
    expect(host.announced.flatMap((a) => (a.kind === 'goal' || a.kind === 'goalWithdrawn' ? [a.atMs] : []))).toEqual([1000, 1250]);
  });

  it("opens the menu from its Menu button", () => {
    const { layer, host } = hud();
    only(layer.el!, 'button[data-test="menu-button"]').click();
    expect(host.told).toEqual(['openMenu']);
  });
});

describe("the goal's banner and the follow choice's order (L110, C-4, C-26, §3.4)", () => {
  const BEA = personId(7, 1);
  const names: Readonly<Record<string, string>> = { [ME]: 'Ada', [BOT]: BOT_NAME, [BEA]: 'Bea' };
  const name = (id: string): string => names[id] ?? '?';

  it("names every terrier credited, each sharer of a shared goal, and says Own goal when nobody is", () => {
    expect([nameList([]), nameList(['Ada']), nameList(['Ada', 'Bea']), nameList(['Ada', 'Bea', 'Cy'])]).toEqual(['', 'Ada', 'Ada and Bea', 'Ada, Bea and Cy']);
    expect(goalText({ scorers: [ME] }, name)).toBe('Goal: Ada');
    expect(goalText({ scorers: [ME, BEA] }, name)).toBe('Goal: Ada and Bea');
    expect(goalText({ scorers: [] }, name)).toBe(OWN_GOAL);
    expect(OWN_GOAL).toBe('Own goal');
    expect([takenBackText(1), takenBackText(2)]).toEqual(['Goal taken back', 'Goals taken back']);
  });

  it("shows a latched goal's scorers while the drawn match celebrates it, then Goal taken back until its time is up, a celebration first", () => {
    const at = (phase: number, phaseStart: number): { phase: 0; phaseStart: number } => ({ phase: phase as 0, phaseStart });
    const none = { goals: [{ tick: 900, scorers: [ME] }], name, takenBack: null, nowMs: 0 };
    expect(bannerText({ ...none, drawn: at(CELEBRATION, 900) })).toBe('Goal: Ada');
    expect(bannerText({ ...none, drawn: at(CELEBRATION, 950) })).toBeNull(); // a celebration of a goal not latched (D-14)
    expect(bannerText({ ...none, drawn: at(KICKOFF_COUNTDOWN, 1104) })).toBeNull(); // the celebration over
    expect(bannerText({ ...none, drawn: null })).toBeNull();
    const back = { count: 1, untilMs: 3000 };
    expect(bannerText({ ...none, drawn: at(IN_PLAY, 400), takenBack: back, nowMs: 2999 })).toBe('Goal taken back');
    expect(bannerText({ ...none, drawn: at(IN_PLAY, 400), takenBack: back, nowMs: 3000 })).toBeNull();
    expect(bannerText({ ...none, drawn: at(CELEBRATION, 900), takenBack: back, nowMs: 1000 })).toBe('Goal: Ada');
  });

  it("cycles the ball and then each terrier in the choice's order, by pack and spot, round the ends, from a terrier gone as from the ball", () => {
    const drawn = [{ id: 'a0', pack: 0, spot: 0 }, { id: 'b0', pack: 1, spot: 0 }, { id: 'a1', pack: 0, spot: 1 }, { id: 'b1', pack: 1, spot: 1 }] as const;
    expect(followOrder(drawn).map((d) => d.id)).toEqual(['a0', 'a1', 'b0', 'b1']);
    expect(drawn.map((d) => d.id)).toEqual(['a0', 'b0', 'a1', 'b1']); // left as it was
    const ids = ['a', 'b', 'c'];
    expect([nextFollow(null, ids, 1), nextFollow('a', ids, 1), nextFollow('c', ids, 1)]).toEqual(['a', 'b', null]);
    expect([nextFollow(null, ids, -1), nextFollow('a', ids, -1), nextFollow('b', ids, -1)]).toEqual(['c', null, 'a']);
    expect([nextFollow('gone', ids, 1), nextFollow('gone', ids, -1), nextFollow(null, [], 1)]).toEqual(['a', 'c', null]);
    // What the camera follows: the terrier while it's in the roster, else the ball, as the view draws it.
    expect(followed({ kind: 'spectator', follow: 'b' }, ids)).toBe('b');
    expect(followed({ kind: 'spectator', follow: 'gone' }, ids)).toBeNull();
    expect(followed({ kind: 'spectator', follow: null }, ids)).toBeNull();
    expect(followed({ kind: 'player', view: 'ball', terrier: 'a' }, ids)).toBeUndefined();
  });
});

describe("the HUD layer's goals, graphics and follow choice (§5.8, D-28, D-30, C-4, L110, L167)", () => {
  let dom: { readonly document: FakeDocument; restore(): void };
  beforeEach(() => {
    dom = installDom();
  });
  afterEach(() => {
    dom.restore();
  });

  const BEA = personId(7, 1);
  const WATCHER = personId(9, 0);
  const goal = (tick: number, scorers: string[], ownGoal = false): ConfirmedGoal => ({ tick, pack: 0, ownGoal, scorers, score: [1, 0] });

  /** A HUD over Ada and Bea in pack A and a bot in pack B, for Ada, or for a spectator; its setMode the
   *  pitch screen's, which sets the view's mode. */
  function rig(o: { spectator?: boolean } = {}) {
    const calls: Calls = [];
    const base = stateWith(2, 100, [{ id: ME, pack: 0, name: 'Ada' }, { id: BOT, pack: 1, name: BOT_NAME }, { id: BEA, pack: 0, name: 'Bea' }]);
    const match = new StateMatch(o.spectator === true ? WATCHER : ME, base);
    const view = new FakeView(calls, match);
    view.mode = o.spectator === true ? { kind: 'spectator', follow: null } : { kind: 'player', view: 'ball', terrier: ME };
    const modes: CameraMode[] = [];
    const host = {
      ...testHost({ match, view, stage: new FakeStage(calls), controls: o.spectator === true ? null : new FakeControls(calls) }),
      setMode: (m: CameraMode) => {
        modes.push(m);
        view.mode = m;
      },
    };
    const layer = hudLayer(host);
    dom.document.body.append(fake(layer.el));
    const ctx = (s: MatchState = match.state, x: Partial<PitchContext> = {}): PitchContext => ({
      match, drawn: drawnOf(s), out: null, frame: null, nowMs: 0, mode: view.mode, settings: host.settings.get(), graphics: 'ok', barks: [], ...x,
    });
    const seen = (): HudInspection => layer.inspect!() as HudInspection;
    return { match, view, host, layer, ctx, modes, seen, el: fake(layer.el) };
  }
  const phased = (s: MatchState, phase: number, phaseStart: number, tick: number): MatchState => ({ ...s, phase, phaseStart, tick }) as MatchState;

  it("shows the scorers' names over the pitch from the goal's latch for its celebration, Own goal when nobody is credited, heard, and read back", () => {
    const r = rig();
    const banner = only(r.el, '[data-test="hud-banner"]');
    expect([banner.getAttribute('aria-live'), banner.getAttribute('aria-atomic')]).toEqual(['polite', 'true']);
    const celebrating = phased(r.match.state, CELEBRATION, 900, 905);
    r.layer.frame!(r.ctx(celebrating)); // the head celebrates a goal its scoreboard hasn't latched (D-14)
    expect([banner.hidden, r.seen().scorer]).toEqual([true, null]);
    r.match.board.goals.push(goal(900, [ME, BEA]));
    r.layer.frame!(r.ctx(celebrating));
    expect([banner.hidden, banner.textContent, r.seen().scorer]).toEqual([false, 'Goal: Ada and Bea', 'Goal: Ada and Bea']);
    r.layer.frame!(r.ctx(phased(celebrating, KICKOFF_COUNTDOWN, 1104, 1104)));
    expect([banner.hidden, r.seen().scorer]).toEqual([true, null]);
    r.match.board.goals.push(goal(2000, [], true));
    r.layer.frame!(r.ctx(phased(celebrating, CELEBRATION, 2000, 2010)));
    expect([banner.hidden, r.seen().scorer]).toEqual([false, 'Own goal']);
    // After a timer run too, with no frame drawn.
    r.layer.run!(r.ctx(phased(celebrating, IN_PLAY, 2200, 2200)));
    expect([banner.hidden, r.seen().scorer]).toEqual([true, null]);
  });

  it("says Goal taken back for the celebration's seen length once a repair withdraws a goal (C-4), a goal celebrating meanwhile first", () => {
    const r = rig();
    const banner = only(r.el, '[data-test="hud-banner"]');
    const play = phased(r.match.state, IN_PLAY, 400, 950);
    r.match.board.goals.push(goal(900, [ME]));
    r.layer.frame!(r.ctx(phased(play, CELEBRATION, 900, 950)));
    expect(banner.textContent).toBe('Goal: Ada');
    r.match.board.goals.length = 0; // a repair took it back
    r.match.clock.advance(100);
    r.layer.frame!(r.ctx(play));
    expect([banner.hidden, r.seen().scorer]).toEqual([false, 'Goal taken back']);
    r.match.clock.advance(config.celebrationSeenSeconds * 1000 - 1);
    r.layer.frame!(r.ctx(play));
    expect(r.seen().scorer).toBe('Goal taken back');
    r.match.clock.advance(1);
    r.layer.frame!(r.ctx(play));
    expect([banner.hidden, r.seen().scorer]).toEqual([true, null]);
    // Two taken back at once, as a merge's arrival can; then a goal latched meanwhile celebrates first.
    r.match.board.goals.push(goal(1500, [ME]), goal(1900, [BOT]));
    r.layer.frame!(r.ctx(play));
    r.match.board.goals.length = 0;
    r.layer.frame!(r.ctx(play));
    expect(r.seen().scorer).toBe('Goals taken back');
    r.match.board.goals.push(goal(2400, [BOT]));
    r.layer.frame!(r.ctx(phased(play, CELEBRATION, 2400, 2405)));
    expect(r.seen().scorer).toBe(`Goal: ${BOT_NAME}`);
    expect(r.host.announced.filter((a) => a.kind === 'goalWithdrawn').length).toBe(3);
  });

  it('says Graphics were lost; restoring while the context is lost, after a timer run too, reading back its state (D-30)', () => {
    const r = rig();
    const note = only(r.el, '[data-test="hud-graphics"]');
    expect(note.getAttribute('role')).toBe('status');
    r.layer.frame!(r.ctx());
    expect([note.hidden, r.seen().graphics]).toEqual([true, 'ok']);
    r.layer.frame!(r.ctx(undefined, { graphics: 'restoring' }));
    expect([note.hidden, note.textContent, r.seen().graphics]).toEqual([false, GRAPHICS_NOTE, 'restoring']);
    expect(GRAPHICS_NOTE).toBe('Graphics were lost; restoring');
    r.layer.run!(r.ctx(undefined, { graphics: 'lost' })); // no frame drawn meanwhile: the timer's run carries it
    expect([note.hidden, r.seen().graphics]).toEqual([false, 'lost']);
    r.layer.run!(r.ctx(undefined, { graphics: 'ok' }));
    expect([note.hidden, r.seen().graphics]).toEqual([true, 'ok']);
  });

  it("offers a spectator Ball and each terrier by name, by pack and spot, the one followed pressed, a tap following one through setMode", () => {
    const r = rig({ spectator: true });
    const follow = only(r.el, '[data-test="hud-follow"]');
    r.layer.frame!(r.ctx());
    expect([follow.hidden, follow.getAttribute('role'), follow.getAttribute('aria-label')]).toEqual([false, 'group', 'Follow']);
    expect(r.match.state.terriers.map((T) => T.id)).toEqual([ME, BOT, BEA]); // the state's own order: by spot, then pack
    const buttons = follow.querySelectorAll('button');
    expect(buttons.map((b) => [b.getAttribute('data-follow'), only(b, '.hud-follow-name').textContent])).toEqual([
      ['ball', 'Ball'], [ME, 'Ada'], [BEA, 'Bea'], [BOT, BOT_NAME],
    ]);
    // The one followed by a check mark too, never by colour alone, seen but not heard (§5.14).
    expect(buttons.map((b) => shownText(b))).toEqual(['✓Ball', 'Ada', 'Bea', BOT_NAME]);
    expect(only(buttons[0]!, '.hud-follow-check').getAttribute('aria-hidden')).toBe('true');
    // Each terrier's with its pack's swatch, in its colour and pattern (L43).
    expect(buttons.slice(1).map((b) => only(b, '.swatch').className)).toEqual(['swatch pack plain', 'swatch pack plain', 'swatch pack striped']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    expect([r.seen().following, r.seen().meter]).toEqual(['ball', null]);
    buttons[2]!.click();
    expect(r.modes).toEqual([{ kind: 'spectator', follow: BEA }]);
    // Pressed at once, before the next frame, and read back so.
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false']);
    expect(buttons.map((b) => shownText(b))).toEqual(['Ball', 'Ada', '✓Bea', BOT_NAME]);
    expect(r.seen().following).toBe(BEA);
    r.layer.frame!(r.ctx());
    expect(r.seen().following).toBe(BEA);
    buttons[0]!.click();
    r.layer.frame!(r.ctx());
    expect([r.modes.at(-1), r.seen().following]).toEqual([{ kind: 'spectator', follow: null }, 'ball']);
    // The list made once for a roster that hasn't changed.
    expect(follow.querySelectorAll('button')[1]).toBe(buttons[1]);
  });

  it("brings each newly followed choice into the list's view, sideways, once as it's pressed, never every frame (phase 2b's review, P5)", () => {
    const r = rig({ spectator: true });
    const scrolls = dom.document.defaultView.scrolls;
    r.layer.frame!(r.ctx());
    const intoView = (): string[] => scrolls.flatMap((x) => ('intoView' in x ? [`${x.intoView.getAttribute('data-follow')} ${x.block}`] : []));
    // Ball, pressed as the list is made.
    expect(intoView()).toEqual(['ball nearest']);
    const cmd = (kind: UiCommand['kind']): UiCommand => ({ kind, pressedAt: 0, source: 'keyboard', repeat: false });
    r.layer.ui(cmd('next'));
    r.layer.frame!(r.ctx());
    r.layer.frame!(r.ctx());
    r.layer.ui(cmd('next'));
    r.layer.frame!(r.ctx());
    only(r.el, `[data-follow="${BOT}"]`).click();
    r.layer.frame!(r.ctx());
    expect(intoView()).toEqual(['ball nearest', `${ME} nearest`, `${BEA} nearest`, `${BOT} nearest`]);
  });

  it('scrolls a newly followed choice into view once every check mark is as it will be drawn, cycling either way, so the box it brings in is its last (P5, phase 2d)', () => {
    const r = rig({ spectator: true });
    r.layer.frame!(r.ctx());
    const list = only(r.el, '.hud-follow-list');
    // At each scroll, the choices whose check mark shows: a mark widens its button, so a box measured before
    // the new one shows, or the old one goes, isn't the one drawn (at 640 × 360 the last ended 18 px out).
    const marked: string[] = [];
    const scroll = vi.spyOn(FakeElement.prototype, 'scrollIntoView').mockImplementation(function (this: FakeElement) {
      const on = list.querySelectorAll('button').filter((b) => !only(b, '.hud-follow-check').hidden).map((b) => b.getAttribute('data-follow'));
      marked.push(`${this.getAttribute('data-follow')}: ${on.join(' ')}`);
    });
    try {
      const cmd = (kind: UiCommand['kind']): UiCommand => ({ kind, pressedAt: 0, source: 'keyboard', repeat: false });
      for (const kind of ['next', 'next', 'prev', 'prev', 'prev'] as const) r.layer.ui(cmd(kind));
      only(r.el, `[data-follow="${BEA}"]`).click();
      expect(marked).toEqual([`${ME}: ${ME}`, `${BEA}: ${BEA}`, `${ME}: ${ME}`, 'ball: ball', `${BOT}: ${BOT}`, `${BEA}: ${BEA}`]);
    } finally {
      scroll.mockRestore();
    }
  });

  it("cycles what a spectator follows on next and prev, the view key's and the shoulders', a repeat doing nothing; a player's HUD has no choice and takes neither", () => {
    const r = rig({ spectator: true });
    r.layer.frame!(r.ctx());
    const ids = [ME, BEA, BOT]; // the buttons' order
    const cmd = (kind: UiCommand['kind'], repeat = false): UiCommand => ({ kind, pressedAt: 0, source: kind === 'next' ? 'keyboard' : 'gamepad', repeat });
    const follows = (): (string | null)[] => r.modes.map((m) => (m.kind === 'spectator' ? m.follow : 'not a spectator'));
    expect([r.layer.ui(cmd('next')), r.layer.ui(cmd('next')), r.layer.ui(cmd('next', true))]).toEqual([true, true, true]);
    expect(follows()).toEqual([ids[0], ids[1]]);
    for (let k = 0; k < 3; k++) r.layer.ui(cmd('prev'));
    expect(follows().slice(2)).toEqual([ids[0], null, ids[2]]); // back round the ball to the last
    r.layer.frame!(r.ctx());
    expect(r.seen().following).toBe(ids[2]);
    expect(r.layer.ui(cmd('press'))).toBe(false);
    const p = rig();
    p.layer.frame!(p.ctx());
    expect([only(p.el, '[data-test="hud-follow"]').hidden, p.seen().following]).toEqual([true, null]);
    expect([p.layer.ui(cmd('next')), p.layer.ui(cmd('prev')), p.modes]).toEqual([false, false, []]);
  });

  it("shows Ball followed once the terrier followed leaves the roster, as the view follows the ball then, and keeps the focus on a choice when the list changes", () => {
    const r = rig({ spectator: true });
    r.layer.frame!(r.ctx());
    const pick = (id: string) => only(r.el, `button[data-follow="${id}"]`);
    pick(BEA).focus();
    pick(BEA).click();
    r.layer.frame!(r.ctx());
    expect(r.seen().following).toBe(BEA);
    const without = { ...r.match.state, terriers: r.match.state.terriers.filter((T) => T.id !== BEA) } as MatchState;
    r.layer.frame!(r.ctx(without));
    expect(r.seen().following).toBe('ball');
    expect(dom.document.activeElement.getAttribute('data-follow')).toBe('ball'); // its button gone: the ball's has the focus
    // Bea comes back: the list made again, the focus kept on the button it was on.
    pick(BOT).focus();
    r.layer.frame!(r.ctx());
    expect([r.seen().following, dom.document.activeElement.getAttribute('data-follow')]).toEqual([BEA, BOT]);
    expect(r.modes.length).toBe(1); // the leaving and the return chose nothing
  });
});

describe("the HUD's places (§5.8, §5.13, §5.14; a browser confirms them)", () => {
  const css = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');

  /** Pre-match's panel's rule, from the stylesheet that holds it: src/ui/prematch.css from phase 2, the
   *  pitch screen's before. */
  const panelRule = (): Readonly<Record<string, string>> => {
    const file = ['./prematch.css', './screens/pitch.css'].find((f) => existsSync(new URL(f, import.meta.url)) && /\.prematch\s*\{/.test(css(f)));
    if (file === undefined) throw new Error('no stylesheet holds Pre-match\'s panel');
    return cssDeclarations(css(file), '.prematch');
  };

  it("keeps the graphics note and the follow choice left of Pre-match's panel, the note under the top bar, at the gate's size and a phone's", () => {
    const panel = panelRule();
    const below = cssLength(cssDeclarations(css('./hud.css'), '.hud-top').top, 0) + cssLength(cssDeclarations(css('./screens.css'), 'button')['min-height'], 0);
    for (const selector of ['.hud-graphics', '.hud-follow']) {
      const d = cssDeclarations(css('./hud.css'), selector);
      for (const [w, h] of [[640, 360], [667, 375], [915, 412], [1280, 720]] as const) {
        const panelLeft = w - cssLength(panel.right, w) - cssLength(panel.width, w);
        expect(cssLength(d.left, w) + cssLength(d['max-width'], w), `${selector} at ${w} × ${h}`).toBeLessThan(panelLeft);
      }
    }
    expect(cssLength(cssDeclarations(css('./hud.css'), '.hud-graphics').top, 360)).toBeGreaterThan(below);
    // The choice takes taps, though the HUD over the pitch takes none.
    expect([cssDeclarations(css('./hud.css'), '.hud')['pointer-events'], cssDeclarations(css('./hud.css'), '.hud-follow')['pointer-events']]).toEqual(['none', 'auto']);
  });

  it("keeps a goal's banner right of the control hints at their widest while they show, at the gate's size, a phone's and wider (phase 2b's review, P2)", () => {
    // The gate's scripted matches have no person scoring, so no spec meets a long scorer's name under the hints:
    // the stylesheets' boxes, by their own lengths.
    const hints = cssDeclarations(css('./touch.css'), '.hints');
    const band = cssDeclarations(css('./hud.css'), '.hud-centre');
    const banner = cssDeclarations(css('./hud.css'), '.pitch-screen:has(> .hints:not([hidden])) .hud-banner');
    expect([banner['justify-self'], cssDeclarations(css('./hud.css'), '.hud-banner')['overflow-wrap']]).toEqual(['end', 'anywhere']);
    for (const w of [640, 667, 915, 1280, 1920]) {
      const hintsRight = cssLength(hints.left, w) + cssLength(hints['max-width'], w);
      const across = w - cssLength(band.left, w) - cssLength(band.right, w);
      const bannerLeft = w - cssLength(band.right, w) - cssLength(banner['max-width'], across);
      expect(bannerLeft, `${w} wide`).toBeGreaterThan(hintsRight);
    }
  });

  it('keeps the HUD inside the safe area, and every piece of its text on an opaque backing', () => {
    const sides = ['top', 'right', 'bottom', 'left'].map((s) => `env(safe-area-inset-${s}, 0px)`).join(' ');
    expect(cssDeclarations(css('./hud.css'), '.hud').inset).toBe(sides);
    for (const selector of ['.hud-score', '.hud-clock', '.hud-countdown', '.hud-banner', '.hud-graphics', '.hud-follow-label', '.hud-gauge-label']) {
      expect(cssDeclarations(css('./hud.css'), selector).background, selector).toBe('var(--bg)');
    }
  });
});
