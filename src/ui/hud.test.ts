import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { personId } from '../core/bot/bot-id';
import type { ConfirmedGoal } from '../core/session/index';
import { CELEBRATION, defaultParams, IN_PLAY, KICKOFF_COUNTDOWN, START_COUNTDOWN, WARM_UP } from '../core/sim/index';
import { installDom, only, shownText } from './dom-testing';
import { clockText, countdownText, hudLayer, percent, scoreText } from './hud';
import type { HudInspection } from './inspect';
import type { PitchContext } from './layer';
import { type Calls, drawnOf, FakeControls, FakeStage, FakeView, StateMatch, stateWith, testHost } from './pitch-testing';

// The HUD (M4's design §1.44, §5.8, §5.14, §9.2; PLAN D-8, D-14; L103, L111,
// L167): the clock's text, m:ss counting down and overtime counting up; each
// countdown's seconds and "Go!"; the score from the scoreboard, your pack
// marked; a player's meter and pounce wait; and each countdown and each goal
// announced once as it shows, a goal taken back as well.

const P = defaultParams;
const TPS = config.ticksPerSecond;
const ME = personId(7, 0);
const BOT = `${'b'.repeat(4)}${'0'.repeat(28)}`;

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

  it('reads the score and the gauges as the screen shows them', () => {
    expect(scoreText([2, 10])).toBe('2–10');
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
    expect(layer.inspect!()).toEqual({
      score: '1–2', clock: '1:00', countdown: '5', scorer: null, meter: 0.5, pounceWait: P.pounceWaitTicks / 4, graphics: 'ok', following: null,
    } satisfies HudInspection);
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
