// The HUD (M4's design, research/m4/DESIGN.md, §1.44, §3.4, §5.8, §5.13,
// §5.14; PLAN §11, D-8, D-14, D-28, D-30, C-4, C-26; L103, L110, L111,
// L167): a layer over the pitch on Pre-match and Match.
// - The score, the scoreboard's, so a goal counts once its tick is
//   confirmed (D-14), each pack's in its colour and pattern, the viewer's
//   own pack marked in words.
// - The clock, m:ss counting down, and in overtime "Overtime" and its time
//   counting up from 0:00 (D-8, L111).
// - Each countdown's seconds, the start's and each kickoff's, from the drawn
//   match's phase and its start, and "Go!" as play begins.
// - A goal's banner over the pitch (L110, C-26): "Goal:" and the names of
//   the terriers credited, or "Own goal" when nobody is, from the goal's
//   latch for the rest of the celebration the drawn match shows; and "Goal
//   taken back" for the celebration's seen length once a repair withdraws
//   one (C-4).
// - A player's zoomies meter and pounce wait, from the drawn match's own
//   terrier (L167), so a pounce D-10 drops in its wait, or zoomies on an
//   empty meter (C-20), shows why.
// - A spectator's follow choice (L167, D-28, §3.4): Ball and a button for
//   each terrier drawn, by pack and spot, pack A's first, as Pre-match's
//   lists and Results order them, the one followed pressed; a tap on one,
//   and Q-17's next and prev, the view key's and the shoulders', going
//   along that order, each go through the host's setMode.
// - "Graphics were lost; restoring" while the stage's context is lost, as
//   PitchContext.graphics says (D-30), under the plain message once that
//   covers the pitch; the message and its 5 s are the pitch screen's.
// - The Menu button, which opens the match menu (screens/menu.ts).
// The score, the countdowns, the banner and the graphics note are heard,
// in polite live regions (L103, §5.14); every piece of text sits on an
// opaque backing, so axe judges its contrast (§5.14); the HUD's box keeps
// inside the safe area (§5.13); text and gauges are set only when they
// change, each frame and after each timer run, so the HUD keeps up while
// the graphics are lost. It announces each countdown, goal and withdrawal
// to the app's log as it shows them (§1.40), and reports for the hook what
// it wrote: the digits, the clock, the countdown and the banner shown, the
// meter's gauge, the graphics note and the follow choice pressed. Phase
// 1's by the shell; phase 2's results-hud adds the banner, the follow
// choice and the graphics note. New at M4.

import { config } from '../config';
import { shownName } from '../core/names';
import type { ConfirmedGoal } from '../core/session/index';
import { CELEBRATION, defaultParams, IN_PLAY, KICKOFF_COUNTDOWN, type Pack, type SimParams, START_COUNTDOWN } from '../core/sim/index';
import type { UiCommand } from '../input/source';
import type { CameraMode, DrawnMatch, DrawnTerrier } from '../render/frame';
import { h, setClass, setShown, setText } from './dom';
import css from './hud.css?inline';
import type { HudInspection } from './inspect';
import type { Layer, PitchContext, PitchHost } from './layer';
import { packName, packSwatch } from './screens/screen';
import { addStyle } from './style';

/** How long "Go!" shows once play begins. */
const GO_SECONDS = 1;
const SECONDS_PER_MINUTE = 60;

/** The note while the stage's context is lost (D-30, §5.8). */
export const GRAPHICS_NOTE = 'Graphics were lost; restoring';
/** A goal's banner when nobody is credited (L110). */
export const OWN_GOAL = 'Own goal';

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

/** A share as the gauges show it: whole percents, 0 to 100, so the DOM changes only when one does. */
export function percent(share: number): number {
  return Math.max(0, Math.min(100, Math.round(share * 100)));
}

/** Names as a sentence lists them: "Ada", "Ada and Bea", "Ada, Bea and Cy". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
}

/** A goal's banner (L110, C-26): "Goal:" and every terrier credited, each sharer of a shared goal, by its
 *  shown name; "Own goal" when nobody is credited. */
export function goalText(g: Pick<ConfirmedGoal, 'scorers'>, name: (id: string) => string): string {
  return g.scorers.length === 0 ? OWN_GOAL : `Goal: ${nameList(g.scorers.map(name))}`;
}

/** A withdrawal's banner (C-4): "Goal taken back", or "Goals taken back" when one change took back
 *  several, as a merge's arrival can. */
export const takenBackText = (count: number): string => (count > 1 ? 'Goals taken back' : 'Goal taken back');

/** The last withdrawal: how many goals it took back, and until when its banner shows, by the page clock. */
export interface TakenBack {
  readonly count: number;
  readonly untilMs: number;
}

/** The banner's text: the scorers of the latched goal the drawn match is celebrating, for the rest of
 *  its celebration (L110); else "Goal taken back" until its time is up; else none. A goal shows only once
 *  the scoreboard has latched it, so never before its tick is confirmed (D-14). */
export function bannerText(o: {
  readonly goals: readonly Pick<ConfirmedGoal, 'tick' | 'scorers'>[];
  readonly drawn: Pick<DrawnMatch, 'phase' | 'phaseStart'> | null;
  readonly name: (id: string) => string;
  readonly takenBack: TakenBack | null;
  readonly nowMs: number;
}): string | null {
  const m = o.drawn;
  const goal = m !== null && m.phase === CELEBRATION ? o.goals.find((g) => g.tick === m.phaseStart) : undefined;
  if (goal !== undefined) return goalText(goal, o.name);
  return o.takenBack !== null && o.nowMs < o.takenBack.untilMs ? takenBackText(o.takenBack.count) : null;
}

/** What a spectator follows: a terrier's ID, or null for the ball (D-28, L91). */
export type Follow = string | null;

/** What the camera follows in this mode, among the drawn roster's IDs: the mode's terrier while it's in
 *  the roster, else the ball, as src/render/view.ts draws it; undefined for any other mode. */
export function followed(mode: CameraMode, ids: readonly string[]): Follow | undefined {
  if (mode.kind !== 'spectator') return undefined;
  return mode.follow !== null && ids.includes(mode.follow) ? mode.follow : null;
}

/** The follow choice's next, or previous (§3.4): the ball, then each terrier in `ids`, the choice's order,
 *  round the ends; from a terrier no longer there as from the ball. */
export function nextFollow(current: Follow, ids: readonly string[], step: 1 | -1): Follow {
  const order: readonly Follow[] = [null, ...ids];
  const at = Math.max(0, order.indexOf(current));
  return order[(at + step + order.length) % order.length] ?? null;
}

/** The follow choice's terriers: by pack, pack A's first, then by spot, as Pre-match's lists and Results
 *  order them, so the view key goes along the buttons as they show. */
export function followOrder<T extends Pick<DrawnTerrier, 'pack' | 'spot'>>(terriers: readonly T[]): T[] {
  return [...terriers].sort((a, b) => a.pack - b.pack || a.spot - b.spot);
}

/** The HUD's layer, which takes two of Q-17's commands besides (§3.4, §4.4). */
export interface HudLayer extends Layer {
  /** next and prev on a spectator's screen, its view key's and the pad's shoulders': the follow choice's
   *  next or previous, a repeat doing nothing. True when it took the command: on a player's screen it
   *  takes neither. */
  ui(c: UiCommand): boolean;
}

/** A gauge, a meter by role, its visible label on its backing and its fill by --fill. */
function gauge(label: string, test: string): { el: HTMLElement; fill: HTMLElement } {
  const fill = h('span', { class: 'hud-gauge-fill' });
  const el = h('div', {
    class: 'hud-gauge', role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '100', 'data-test': test,
  }, h('span', { class: 'hud-gauge-label' }, label), h('span', { class: 'hud-gauge-bar' }, fill));
  return { el, fill };
}

export function hudLayer(host: PitchHost): HudLayer {
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
  const banner = h('p', { class: 'hud-banner', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-test': 'hud-banner', hidden: true });
  const graphics = h('p', { class: 'hud-graphics', role: 'status', 'data-test': 'hud-graphics', hidden: true }, GRAPHICS_NOTE);
  const meter = gauge('Zoomies', 'hud-meter');
  const pounce = gauge('Pounce', 'hud-pounce');
  const gauges = h('div', { class: 'hud-gauges', hidden: true }, meter.el, pounce.el);
  const followList = h('div', { class: 'hud-follow-list' });
  const follow = h('div', { class: 'hud-follow', role: 'group', 'aria-label': 'Follow', 'data-test': 'hud-follow', hidden: true },
    h('span', { class: 'hud-follow-label', 'aria-hidden': 'true' }, 'Follow'), followList);
  const menu = h('button', { type: 'button', class: 'hud-menu', 'aria-label': 'Menu', 'data-test': 'menu-button', onclick: () => host.openMenu() }, '☰');
  const el = h('div', { class: 'hud', 'data-test': 'hud' },
    h('div', { class: 'hud-top' },
      h('div', { class: 'hud-score', 'aria-hidden': 'true' }, side(0), h('span', { class: 'hud-dash' }, '–'), side(1)),
      clock, menu),
    said, h('div', { class: 'hud-centre' }, countdown, banner), graphics, gauges, follow);

  const shownGoals = new Set<number>();
  const shownCountdowns = new Set<number>();
  const shownPercent = { meter: -1, pounce: -1 };
  let takenBack: TakenBack | null = null;
  /** The follow choice's buttons, the ball's first, each with its check mark, and the drawn roster they
   *  were made from. */
  let choices: { readonly value: Follow; readonly el: HTMLButtonElement; readonly check: HTMLElement }[] = [];
  let rosterIds: readonly string[] = [];
  let rosterKey: string | null = null;
  let state: HudInspection = { score: '0–0', clock: '', countdown: null, scorer: null, meter: null, pounceWait: null, graphics: 'ok', following: null };

  const setGauge = (g: { el: HTMLElement; fill: HTMLElement }, key: 'meter' | 'pounce', value: number): void => {
    if (shownPercent[key] === value) return;
    shownPercent[key] = value;
    g.el.setAttribute('aria-valuenow', String(value));
    g.fill.style.setProperty('--fill', `${value}%`);
  };

  /** Each goal latched since the last look, and each withdrawn (C-4), into the log as it shows; a
   *  withdrawal's banner from now. */
  const announceGoals = (): void => {
    const latched = match.scoreboard.goals;
    const now = match.clock.now();
    for (const g of latched) {
      if (shownGoals.has(g.tick)) continue;
      shownGoals.add(g.tick);
      host.announce({ kind: 'goal', tick: g.tick, atMs: now });
    }
    let withdrawn = 0;
    for (const tick of [...shownGoals]) {
      if (latched.some((g) => g.tick === tick)) continue;
      shownGoals.delete(tick);
      withdrawn++;
      host.announce({ kind: 'goalWithdrawn', tick, atMs: now });
    }
    if (withdrawn > 0) takenBack = { count: withdrawn, untilMs: now + config.celebrationSeenSeconds * 1000 };
  };

  /** A terrier's name as the screens show it, from the drawn roster, else the final state's. */
  const nameOf = (m: DrawnMatch | null, id: string): string => {
    const t = match.session.timeline;
    const T = m?.terriers.find((d) => d.id === id) ?? (t.started ? t.final.terriers.find((F) => F.id === id) : undefined);
    return shownName(T?.name ?? '', id);
  };

  /** A choice's button: its check mark, seen while it's pressed and never heard, since aria-pressed says so;
   *  a terrier's pack's swatch; and its name. */
  const choice = (value: Follow, text: string, pack: Pack | null): { value: Follow; el: HTMLButtonElement; check: HTMLElement } => {
    const check = h('span', { class: 'hud-follow-check', 'aria-hidden': 'true', hidden: true }, '✓');
    const el = h('button', {
      type: 'button', class: 'hud-follow-choice', 'aria-pressed': 'false', 'data-follow': value ?? 'ball', onclick: () => choose(value),
    }, check, pack === null ? null : packSwatch(look.packs[pack]), h('span', { class: 'hud-follow-name' }, text));
    return { value, el, check };
  };

  /** The follow choice's buttons, by followOrder, made again only when the roster's IDs, names, packs or
   *  spots change; the focus, if one had it, kept on its value's, else the ball's. */
  const listRoster = (drawn: readonly Pick<DrawnTerrier, 'id' | 'name' | 'pack' | 'spot'>[]): void => {
    const terriers = followOrder(drawn);
    const key = terriers.map((d) => `${d.id}/${d.pack}/${d.spot}/${d.name}`).join(',');
    if (key === rosterKey) return;
    rosterKey = key;
    const active = el.ownerDocument.activeElement;
    const focused = choices.find((c) => c.el === active);
    rosterIds = terriers.map((d) => d.id);
    choices = [choice(null, 'Ball', null), ...terriers.map((d) => choice(d.id, shownName(d.name, d.id), d.pack))];
    followList.replaceChildren(...choices.map((c) => c.el));
    if (focused !== undefined) (choices.find((c) => c.value === focused.value) ?? choices[0]!).el.focus({ preventScroll: true });
  };

  /** The button for `value` pressed, its check mark shown, and only it: never by colour alone (§5.14). A
   *  newly pressed one is brought into the list's view, which scrolls sideways, so cycling past its edge
   *  never leaves what's followed out of sight (phase 2b's review, P5). */
  const press = (value: Follow): void => {
    for (const c of choices) {
      const on = c.value === value;
      if (c.el.getAttribute('aria-pressed') !== String(on)) {
        c.el.setAttribute('aria-pressed', String(on));
        if (on) c.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      setShown(c.check, on);
    }
  };

  /** A choice made: shown at once, and so read back, and handed to the view (§3.4). */
  function choose(value: Follow): void {
    press(value);
    state = { ...state, following: following() };
    host.setMode({ kind: 'spectator', follow: value });
  }

  /** What the follow choice shows followed: 'ball' or a terrier's ID; null while it isn't shown. */
  const following = (): string | null => {
    if (follow.hidden) return null;
    const c = choices.find((x) => x.el.getAttribute('aria-pressed') === 'true');
    return c === undefined ? null : (c.value ?? 'ball');
  };

  /** The graphics note's state as written: 'ok' while it's hidden. */
  const graphicsShown = (): HudInspection['graphics'] =>
    graphics.hidden ? 'ok' : graphics.getAttribute('data-graphics') === 'lost' ? 'lost' : 'restoring';

  const update = (ctx: PitchContext): void => {
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
    setShown(countdown, cd !== null);
    if (cd !== null) setText(countdown, cd);
    // Each countdown into the log once it shows (§1.40).
    if (m !== null && cd !== null && cd !== 'Go!' && !countdown.hidden && !shownCountdowns.has(m.phaseStart)) {
      shownCountdowns.add(m.phaseStart);
      host.announce({ kind: 'countdown', phaseStart: m.phaseStart });
    }
    const shownBanner = bannerText({ goals: match.scoreboard.goals, drawn: m, name: (id) => nameOf(m, id), takenBack, nowMs: match.clock.now() });
    setShown(banner, shownBanner !== null);
    if (shownBanner !== null) setText(banner, shownBanner);
    const time = m === null ? '' : clockText(m.clock, m.overtime);
    setText(clock, time);
    setClass(clock, 'overtime', m?.overtime === true);
    setShown(gauges, mine !== null);
    if (mine !== null) {
      setGauge(meter, 'meter', percent(mine.meter));
      setGauge(pounce, 'pounce', percent(1 - mine.pounceWait / P.pounceWaitTicks));
      setClass(pounce.el, 'waiting', mine.pounceWait > 0);
    }
    // The graphics note while the context is lost, its state on it for the hook (D-30).
    const lost = ctx.graphics !== 'ok';
    if (lost && graphics.getAttribute('data-graphics') !== ctx.graphics) graphics.setAttribute('data-graphics', ctx.graphics);
    setShown(graphics, lost);
    // A spectator's follow choice, the one the camera follows pressed (§3.4).
    const spectating = ctx.mode.kind === 'spectator';
    setShown(follow, spectating);
    if (spectating) {
      listRoster(m?.terriers ?? []);
      press(followed(ctx.mode, rosterIds) ?? null);
    }
    // What it shows, read back from what it wrote: the digits, the countdown and the banner shown, the
    // meter's gauge, the note and the choice pressed.
    state = {
      score: `${goals[0].textContent}–${goals[1].textContent}`, clock: clock.textContent ?? '', countdown: countdown.hidden ? null : countdown.textContent,
      scorer: banner.hidden ? null : banner.textContent, meter: gauges.hidden ? null : shownPercent.meter / 100,
      pounceWait: mine === null ? null : mine.pounceWait, graphics: graphicsShown(), following: following(),
    };
  };

  return {
    name: 'hud',
    el,
    frame: update,
    run: update,
    ui(c: UiCommand): boolean {
      const mode = host.view.mode;
      if (mode.kind !== 'spectator' || (c.kind !== 'next' && c.kind !== 'prev')) return false;
      if (!c.repeat) choose(nextFollow(followed(mode, rosterIds) ?? null, rosterIds, c.kind === 'next' ? 1 : -1));
      return true;
    },
    inspect: (): HudInspection => state,
  };
}
