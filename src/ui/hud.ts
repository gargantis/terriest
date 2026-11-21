// The HUD (M4's design, research/m4/DESIGN.md, §1.44, §5.8, §5.14; PLAN
// §11, D-8, D-14; L103, L111, L167): a layer over the pitch on Pre-match
// and Match. Phase 1's (shell):
// - the score, the scoreboard's, so a goal counts once its tick is
//   confirmed (D-14), each pack's in its colour and pattern, the viewer's
//   own pack marked in words;
// - the clock, m:ss counting down, and in overtime "Overtime" and its time
//   counting up from 0:00 (D-8, L111);
// - each countdown's seconds, the start's and each kickoff's, from the drawn
//   match's phase and its start, and "Go!" as play begins;
// - a player's zoomies meter and pounce wait, from the drawn match's own
//   terrier (L167), so a pounce D-10 drops in its wait, or zoomies on an
//   empty meter (C-20), shows why;
// - the Menu button, which opens the match menu (screens/menu.ts).
// The score and the countdowns are in polite live regions (L103, §5.14);
// every piece of text sits on an opaque backing, so axe judges its contrast
// (§5.14); text and gauges are set only when they change. It announces each
// countdown, goal and withdrawal to the app's log as it shows them (§1.40).
// Phase 2's results-hud adds the scorer's name, "Goal taken back", a
// spectator's follow choice and the graphics note. New at M4.

import { config } from '../config';
import { defaultParams, IN_PLAY, KICKOFF_COUNTDOWN, type Pack, type SimParams, START_COUNTDOWN } from '../core/sim/index';
import type { DrawnMatch } from '../render/frame';
import { h, setClass, setShown, setText } from './dom';
import css from './hud.css?inline';
import type { HudInspection } from './inspect';
import type { Layer, PitchContext, PitchHost } from './layer';
import { packName, packSwatch } from './screens/screen';
import { addStyle } from './style';

/** How long "Go!" shows once play begins. */
const GO_SECONDS = 1;
const SECONDS_PER_MINUTE = 60;

/** The clock's text (D-8, L111): m:ss left, a part second counting as a whole one, so it reads 0:00 at
 *  the end; in overtime "Overtime" and the whole seconds since it began. */
export function clockText(clockTicks: number, overtime: boolean): string {
  const tps = config.ticksPerSecond;
  const s = overtime ? Math.floor(clockTicks / tps) : Math.ceil(clockTicks / tps);
  const t = `${Math.floor(s / SECONDS_PER_MINUTE)}:${String(s % SECONDS_PER_MINUTE).padStart(2, '0')}`;
  return overtime ? `Overtime ${t}` : t;
}

/** A countdown's seconds left, the start's or a kickoff's, a part second counting as a whole one and
 *  never more than the countdown's own; "Go!" for the first second of play; else null. From the drawn
 *  match, whose phase shows from halfway through the tick before it starts (M4's design §2.2). */
export function countdownText(m: Pick<DrawnMatch, 'phase' | 'phaseStart' | 'time'>, P: SimParams = defaultParams): string | null {
  const tps = config.ticksPerSecond;
  const since = m.time - m.phaseStart;
  const length = m.phase === START_COUNTDOWN ? P.startCountdownTicks : m.phase === KICKOFF_COUNTDOWN ? P.kickoffCountdownTicks : null;
  if (length !== null) return String(Math.max(1, Math.min(Math.ceil(length / tps), Math.ceil((length - since) / tps))));
  if (m.phase === IN_PLAY && since < GO_SECONDS * tps) return 'Go!';
  return null;
}

export const scoreText = (score: readonly [number, number]): string => `${score[0]}–${score[1]}`;

/** A share as the gauges show it: whole percents, 0 to 100, so the DOM changes only when one does. */
export function percent(share: number): number {
  return Math.max(0, Math.min(100, Math.round(share * 100)));
}

/** A gauge, a meter by role, its visible label on its backing and its fill by --fill. */
function gauge(label: string, test: string): { el: HTMLElement; fill: HTMLElement } {
  const fill = h('span', { class: 'hud-gauge-fill' });
  const el = h('div', {
    class: 'hud-gauge', role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '100', 'data-test': test,
  }, h('span', { class: 'hud-gauge-label' }, label), h('span', { class: 'hud-gauge-bar' }, fill));
  return { el, fill };
}

export function hudLayer(host: PitchHost): Layer {
  addStyle(css);
  const P = defaultParams;
  const me = host.match.me;
  const look = host.look;
  const match = host.match;

  const goals = [h('span', { class: 'hud-goals' }, '0'), h('span', { class: 'hud-goals' }, '0')] as const;
  const yours = [h('span', { class: 'tag', hidden: true }, 'yours'), h('span', { class: 'tag', hidden: true }, 'yours')] as const;
  const side = (p: Pack): HTMLElement =>
    h('span', { class: `hud-pack hud-pack-${p}` }, packSwatch(look.packs[p]), h('span', {}, packName(look.packs[p])), goals[p], yours[p]);
  const said = h('p', { class: 'visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-test': 'hud-score-said' });
  const clock = h('span', { class: 'hud-clock', 'data-test': 'hud-clock' });
  const countdown = h('p', { class: 'hud-countdown', 'aria-live': 'polite', 'data-test': 'hud-countdown', hidden: true });
  const meter = gauge('Zoomies', 'hud-meter');
  const pounce = gauge('Pounce', 'hud-pounce');
  const gauges = h('div', { class: 'hud-gauges', hidden: true }, meter.el, pounce.el);
  const menu = h('button', { type: 'button', class: 'hud-menu', 'aria-label': 'Menu', 'data-test': 'menu-button', onclick: () => host.openMenu() }, '☰');
  const el = h('div', { class: 'hud', 'data-test': 'hud' },
    h('div', { class: 'hud-top' },
      h('div', { class: 'hud-score', 'aria-hidden': 'true' }, side(0), h('span', { class: 'hud-dash' }, '–'), side(1)),
      clock, menu),
    said, countdown, gauges);

  const shownGoals = new Set<number>();
  const shownCountdowns = new Set<number>();
  const shownPercent = { meter: -1, pounce: -1 };
  let state: HudInspection = { score: '0–0', clock: '', countdown: null, scorer: null, meter: null, pounceWait: null, graphics: 'ok', following: null };

  const setGauge = (g: { el: HTMLElement; fill: HTMLElement }, key: 'meter' | 'pounce', value: number): void => {
    if (shownPercent[key] === value) return;
    shownPercent[key] = value;
    g.el.setAttribute('aria-valuenow', String(value));
    g.fill.style.setProperty('--fill', `${value}%`);
  };

  /** Each goal latched since the last frame, and each withdrawn (C-4), into the log as it shows. */
  const announceGoals = (): void => {
    const latched = match.scoreboard.goals;
    for (const g of latched) {
      if (shownGoals.has(g.tick)) continue;
      shownGoals.add(g.tick);
      host.announce({ kind: 'goal', tick: g.tick, atMs: match.clock.now() });
    }
    for (const tick of [...shownGoals]) {
      if (latched.some((g) => g.tick === tick)) continue;
      shownGoals.delete(tick);
      host.announce({ kind: 'goalWithdrawn', tick, atMs: match.clock.now() });
    }
  };

  return {
    name: 'hud',
    el,
    frame(ctx: PitchContext): void {
      const score = match.scoreboard.score;
      const m = ctx.drawn;
      const mine = m?.terriers.find((t) => t.id === me) ?? null;
      setText(goals[0], String(score[0]));
      setText(goals[1], String(score[1]));
      for (const p of [0, 1] as const) setShown(yours[p], mine !== null && mine.pack === p);
      const yourPack = mine === null ? '' : ` Your pack: ${packName(look.packs[mine.pack])}.`;
      setText(said, `Score: ${packName(look.packs[0])} ${score[0]}, ${packName(look.packs[1])} ${score[1]}.${yourPack}`);
      announceGoals();
      const cd = m === null ? null : countdownText(m, P);
      if (m !== null && cd !== null && cd !== 'Go!' && !shownCountdowns.has(m.phaseStart)) {
        shownCountdowns.add(m.phaseStart);
        host.announce({ kind: 'countdown', phaseStart: m.phaseStart });
      }
      setShown(countdown, cd !== null);
      if (cd !== null) setText(countdown, cd);
      const time = m === null ? '' : clockText(m.clock, m.overtime);
      setText(clock, time);
      setClass(clock, 'overtime', m?.overtime === true);
      setShown(gauges, mine !== null);
      if (mine !== null) {
        setGauge(meter, 'meter', percent(mine.meter));
        setGauge(pounce, 'pounce', percent(1 - mine.pounceWait / P.pounceWaitTicks));
        setClass(pounce.el, 'waiting', mine.pounceWait > 0);
      }
      state = {
        score: scoreText(score), clock: time, countdown: cd, scorer: null,
        meter: mine === null ? null : percent(mine.meter) / 100, pounceWait: mine === null ? null : mine.pounceWait,
        graphics: ctx.graphics, following: null,
      };
    },
    inspect: (): HudInspection => state,
  };
}
