import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { findTerrier, IN_PLAY, LUNGING, START_COUNTDOWN, WARM_UP } from '../core/sim/index';
import type { UiCommand } from '../input/source';
import type { Timeline } from '../core/session/index';
import { MemoryStorage } from '../storage/kv';
import { browserLocation } from './app';
import { type AppRig, appRig, type AppRigOptions, Frames, Locks, ME, nowhere } from './app-testing';
import { FakeClock } from './clock-testing';
import { pageDevices } from './devices';
import { fake, FakeEvent, type FakeDocument, FakeNode, installDom, only } from './dom-testing';
import { FrameLoop } from './frame-loop';
import type { Inspection } from './inspect';
import type { HudInspection } from './inspect';
import { PITCH_LAYERS, pitchLayers } from './layers/index';
import { NOT_SAVED, SAVED } from './screens/settings';
import { FakeStage, StateMatch, stateWith, testHost, FakeView } from './pitch-testing';

// The app (M4's design §1.41, §1.47, §1.49, §1.63, §2.8, §5.1–§5.4,
// §5.7–§5.9, §6, §9.2's app.test row; PLAN §11, D-23, D-24, Q-15, Q-17;
// M4-Q1, M4-Q9, M4-Q30, M4-Q31, M4-Q38), on the screens' DOM fake, its
// timers and Practice in virtual time, with fakes for the tab lock's Web
// Locks, the leave guard, the canary and results-hud's message screens:
// the start-up order, the lock asked for first, the first screen before
// boot.started() and the compile after it has been painted, the canary
// after the compile in a task of its own, and with another tab holding the
// lock its message, no compile until Use here has taken it, and the tab it
// was taken from closing its match and saying so; the fragment's routes,
// #join= to Join and everything else Home, a hashchange leaving a match,
// the app's own replace ignored; the canary before Propose and Join, on
// demand, a failing one saying why and opening no room, Practice never
// asking; the leave guard on the pitch screens alone, Practice's too; Home,
// Practice's setup, Pre-match, Match, Results, Play again and Leave, the
// stage and the frame loop on the pitch screen alone, each screen focused,
// the keyboard told which screen it's on, the page at its top; one
// announcements log for each match, kept across its screens; Results' Home
// leaving the match; the hook's match figures, the drawn head's apart from
// the final state's, a lunge latched, each match's from its opening, P11's
// count and the timer's gaps past the freeze and the stall; Settings'
// quality re-creating the stage behind Home, the old one disposed only once
// its own prepare has settled, and one chosen in a match's Settings panel
// once the pitch screen goes, the hook reading the panel; Settings saying
// when the browser keeps nothing, from Home and in the match; the pad alone
// from Home to Settings and back, and to Practice's Pre-match; the graphics
// message a networked match gets, and a context lost before the pitch
// screen; the page's fragment set by location.replace; and the page's own
// leave guard on the window before any room. And the frame loop's phase-1
// fallback, every other frame drawn however long the gaps stay late, its
// log capped; the layers' order and the page's devices. The networked
// screens over M3's network simulator are app-net.test.ts's.

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

type Rig = AppRig;

const rig = (o: Omit<AppRigOptions, 'doc'> = {}): Rig => appRig({ doc: dom.document, ...o });

const look = (r: Rig): Inspection => r.test.inspect!();
/** The match the app holds, as the hook reads it: its timeline's drawn head and final state. */
const held = (r: Rig): Timeline => (r.app as unknown as { match: { session: { timeline: Timeline } } }).match.session.timeline;
const screenEl = (r: Rig): ReturnType<typeof fake> => only(r.root, '[id="screen"]');
const stageBox = (r: Rig): ReturnType<typeof fake> => only(r.root, '[id="stage"]');
const button = (r: Rig, test: string): ReturnType<typeof fake> => only(screenEl(r), `button[data-test="${test}"]`);
const press = (kind: UiCommand['kind'], pressedAt = 0): UiCommand => ({ kind, pressedAt, source: 'keyboard', repeat: false });
const pad = (kind: UiCommand['kind'], pressedAt = 0): UiCommand => ({ kind, pressedAt, source: 'gamepad', repeat: false });
const focused = (): string | null => dom.document.activeElement.getAttribute('data-test');
const hudOf = (i: Inspection): HudInspection => i.layers['hud'] as HudInspection;
/** A check or a radio as a click leaves it: checked, and a change event. */
const tick = (el: ReturnType<typeof fake>, on: boolean): void => {
  el.checked = on;
  el.dispatchEvent(new FakeEvent('change', { bubbles: true }));
};
const LOST_MS = config.lostGraphicsSeconds * 1000;
const settle = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve();
};

/** Runs ms of virtual time, an animation frame every `frameMs`, as a page's would come. */
function play(r: Rig, ms: number, frameMs = 50): void {
  for (let t = 0; t < ms; t += frameMs) {
    r.clock.advance(frameMs);
    r.frames.run();
  }
}

/** Plays until `cond` holds, at most ms. */
function playUntil(r: Rig, cond: () => boolean, ms: number, frameMs = 50): void {
  for (let t = 0; t < ms && !cond(); t += frameMs) play(r, frameMs, frameMs);
  if (!cond()) {
    const m = r.test.inspect!().match;
    throw new Error(`not reached within ${ms} ms of virtual time: ${JSON.stringify({ phase: m?.phase, tick: m?.localTick, score: m?.score, clock: m?.clock })}`);
  }
}

/** Home's Practice, then the setup's 1 a side and 1 minute, then Start. */
function startPractice(r: Rig): void {
  button(r, 'practice').click();
  const sel = (test: string): ReturnType<typeof fake> => only(screenEl(r), `select[data-test="${test}"]`);
  sel('pack-size').value = '1';
  sel('match-length').value = '1';
  button(r, 'start').click();
}

describe('the start-up order (§5.1, M4-Q38)', () => {
  it('asks for the tab lock, shows Home, adds the hook, says started, and only then, once Home has been painted, prepares the stage', async () => {
    const r = rig({ locks: new Locks() });
    expect(screenEl(r).children).toEqual([]);
    await r.app.start();
    expect(r.order).toEqual(['lock', 'started', 'screen terriest', 'hook']);
    expect(look(r).screen).toBe('home');
    expect(dom.document.activeElement.textContent).toBe('terriest'); // Home's heading (Q-17)
    // The stage's canvas, the image "The pitch", in the landmark's #stage, hidden off the pitch screens (M4-Q9).
    const canvas = only(stageBox(r), 'canvas');
    expect([canvas.getAttribute('role'), canvas.getAttribute('aria-label'), stageBox(r).hidden]).toEqual(['img', 'The pitch', true]);
    // The compile waits for a frame, then a task after it, so Home is painted first.
    expect(r.stages[0]!.prepares).toBe(0);
    r.frames.run();
    expect(r.stages[0]!.prepares).toBe(0);
    r.clock.advance(0);
    expect(r.stages[0]!.prepares).toBe(1);
    expect(look(r).startMs).toEqual({ started: 1000, prepared: null });
    r.clock.advance(250);
    await r.stages[0]!.finish();
    await settle();
    expect(look(r).startMs).toEqual({ started: 1000, prepared: 1250 });
    expect(r.test.hashAt!(0)).toBe(''); // no match held
    // The canary once the compile has finished, in a task of its own (D-23), computed once.
    expect(r.canaries).toEqual([]);
    r.clock.advance(0);
    expect(r.canaries).toEqual([true]);
    expect(r.guard.sets.every((on) => !on)).toBe(true); // Home asks nothing before the page goes
  });

  it("shows another tab's message while that tab holds the lock, preparing nothing until Use here takes it (D-24)", async () => {
    const locks = new Locks();
    const first = rig({ locks });
    await first.app.start();
    const second = rig({ locks, hash: '#join=TERR1ESTDESKT0PM30004' });
    await second.app.start();
    expect(second.order).toEqual(['lock', 'started', 'screen other-tab', 'hook']);
    expect(look(second)).toMatchObject({ screen: 'message', message: 'other-tab', match: null });
    expect(dom.document.activeElement.textContent).toBe('other-tab'); // its heading (§5.10)
    // No compile, no canary, no room, however long it waits: a page that can't play spends nothing.
    second.frames.run();
    second.clock.advance(5000);
    expect([second.stages[0]!.prepares, second.canaries, second.rooms]).toEqual([0, [], []]);
    // Nor does a link followed meanwhile route: a room here would put a second tab under the player's ID,
    // the duplicate the lock rules out (C-12).
    second.location.set('#join=TERR1ESTSCREENS20000V');
    second.clock.advance(0);
    await settle();
    expect([look(second).screen, look(second).message, second.rooms, second.canaries]).toEqual(['message', 'other-tab', [], []]);
    // The first tab plays Practice; Use here here takes the lock from it.
    startPractice(first);
    expect(look(first).screen).toBe('prematch');
    const timers = first.clock.pending;
    button(second, 'message-useHere').click();
    await settle();
    expect(second.order.at(-1)).toBe('steal');
    // The second routes its fragment, the link followed last, its Join's room opened at once, and starts
    // its compile behind it.
    expect(look(second).screen).toBe('join');
    expect(second.rooms.map((x) => x.matchId)).toEqual(['TERR1ESTSCREENS20000V']);
    second.frames.run();
    second.clock.advance(0);
    expect(second.stages[0]!.prepares).toBe(1);
    // The first hears it lost: its match closed, its timer stopped, and the same message, with Use here.
    expect(look(first)).toMatchObject({ screen: 'message', message: 'other-tab', match: null });
    expect(first.clock.pending).toBeLessThan(timers);
    expect(first.guard.active).toBe(false);
    // And back: the first's Use here takes it again; the second hears it lost and closes its room.
    button(first, 'message-useHere').click();
    await settle();
    expect(look(first).screen).toBe('home');
    expect(look(second)).toMatchObject({ screen: 'message', message: 'other-tab', match: null });
  });

  it('plays in every tab where the browser has no Web Locks', async () => {
    const r = rig();
    await r.app.start();
    expect([look(r).screen, r.order[0]]).toEqual(['home', 'lock']);
  });

  it("installs the page's own guard on the window before any room, whose listener then never hears a prompt the pitch answers, and asks nothing on Created or Join (§1.49, §5.11)", async () => {
    // The window, and a room's transport that adds its own beforeunload listener as it opens, as
    // Trystero's room.mjs does.
    const win = new EventTarget();
    const g = globalThis as { window?: unknown };
    const heard: string[] = [];
    g.window = win;
    let r: Rig;
    try {
      r = rig({
        realGuard: true,
        transport: (rooms) => (peer, now, o) => {
          win.addEventListener('beforeunload', () => heard.push(o.matchId));
          return nowhere(rooms)(peer, now, o);
        },
      });
    } finally {
      delete g.window;
    }
    const unload = (): boolean => {
      const e = new Event('beforeunload', { cancelable: true });
      win.dispatchEvent(e);
      return e.defaultPrevented;
    };
    await r.app.start();
    expect(unload()).toBe(false);
    // Created: the room open, nothing asked, the room's listener hears the page go.
    button(r, 'propose').click();
    button(r, 'create').click();
    await settle();
    expect(look(r).screen).toBe('created');
    const id = look(r).match!.matchId!;
    expect([unload(), heard]).toEqual([false, [id]]);
    // Pre-match: asked, and the event stopped before the room's listener, the guard's being the first.
    button(r, 'play-0').click();
    expect(look(r).screen).toBe('prematch');
    expect([unload(), heard]).toEqual([true, [id]]);
    // Join: nothing asked again.
    button(r, 'prematch-leave').click();
    only(screenEl(r), 'input[data-test="code"]').value = 'TERR1ESTJ01NBYC0DE006';
    only(screenEl(r), 'form').dispatchEvent(new FakeEvent('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(look(r).screen).toBe('join');
    expect([unload(), heard]).toEqual([false, [id, id, 'TERR1ESTJ01NBYC0DE006']]);
  });

  it('installs the leave guard before any room, asking only on Pre-match and Match, Practice\'s too (§1.49, M4-Q30)', async () => {
    const r = rig();
    await r.app.start();
    expect(r.guard.active).toBe(false);
    startPractice(r);
    expect([look(r).screen, r.guard.active]).toEqual(['prematch', true]);
    button(r, 'prematch-leave').click();
    expect([look(r).screen, r.guard.active]).toEqual(['home', false]);
    button(r, 'settings').click();
    expect(r.guard.active).toBe(false);
  });
});

describe("the fragment's routes (§5.2)", () => {
  it('goes to Join from a #join= link, its room opened at once, and Home from anything else, leaving a match', async () => {
    const r = rig({ hash: '#join=TERR1ESTDESKT0PM30004' });
    await r.app.start();
    expect(look(r).screen).toBe('join');
    expect(dom.document.activeElement.textContent).toBe('Join a match');
    await settle();
    expect(r.rooms.map((x) => x.matchId)).toEqual(['TERR1ESTDESKT0PM30004']); // opening a link counts as joining (C-32)
    expect(look(r).match).toMatchObject({ kind: 'net', matchId: 'TERR1ESTDESKT0PM30004', started: false });
    expect(r.canaries).toEqual([true]); // on demand: Join came before the compile finished
    // Join's Home leaves the room, clearing the fragment by location.replace.
    button(r, 'join-home').click();
    expect([look(r).screen, look(r).match, r.location.hash(), r.location.replaced]).toEqual(['home', null, '', ['#']]);
    const home = screenEl(r).children[0];
    r.clock.advance(0); // the replace's own hashchange, a task later: ignored, Home stays as it is
    expect(screenEl(r).children[0]).toBe(home);
    // Practice; then a fragment typed or followed: Home, the match left; Practice never set the fragment.
    startPractice(r);
    expect(look(r).screen).toBe('prematch');
    const timers = r.clock.pending;
    r.location.set('#anything');
    r.clock.advance(0);
    expect([look(r).screen, look(r).match]).toEqual(['home', null]);
    expect(r.clock.pending).toBe(timers - 1); // Practice's timeline timer, stopped with its match
    expect([r.location.hash(), r.location.replaced]).toEqual(['#anything', ['#']]);
    // A link to a match, and then a link to another: each its own Join, the first's room left.
    r.location.set('#join=TERR1ESTSCREENS20000V');
    r.clock.advance(0);
    await settle();
    expect([look(r).screen, look(r).match?.matchId]).toEqual(['join', 'TERR1ESTSCREENS20000V']);
    r.location.set('#join=TERR1ESTJ01NBYC0DE006');
    r.clock.advance(0);
    await settle();
    expect([look(r).screen, look(r).match?.matchId, r.rooms.length]).toEqual(['join', 'TERR1ESTJ01NBYC0DE006', 3]);
    // The link of the match held already: nothing new opened.
    r.location.set('#join=terr1estj01nbyc0de006');
    r.clock.advance(0);
    await settle();
    expect(r.rooms.length).toBe(3);
    // A join link that isn't one: Home.
    r.location.set('#join=TERR1ESTJ01NBYC0DE007');
    r.clock.advance(0);
    expect([look(r).screen, look(r).match]).toEqual(['home', null]);
  });

  it("joins by a code typed on Home, setting the fragment by replace, and says so of one that isn't a code, contacting nothing (L190)", async () => {
    const r = rig();
    await r.app.start();
    const code = only(screenEl(r), 'input[data-test="code"]');
    const submit = (): boolean => only(screenEl(r), 'form').dispatchEvent(new FakeEvent('submit', { bubbles: true, cancelable: true }));
    code.value = 'terr1est j01n byc0de007';
    expect(submit()).toBe(false); // the browser's own submission kept from the page
    expect([look(r).screen, r.rooms, r.location.replaced, r.canaries]).toEqual(['home', [], [], []]);
    expect(only(screenEl(r), '[data-test="code-error"]').hidden).toBe(false);
    code.value = 'terr-1est-j01n-byc0-de00-6'; // lowercase and dashes, as Created groups it
    submit();
    const join = screenEl(r).children[0];
    expect([look(r).screen, r.location.hash(), r.location.replaced]).toEqual(['join', '#join=TERR1ESTJ01NBYC0DE006', ['#join=TERR1ESTJ01NBYC0DE006']]);
    // Its own hashchange comes a task later, before the room has opened: ignored, so no second Join or room.
    r.clock.advance(0);
    await settle();
    expect([screenEl(r).children[0], r.rooms.map((x) => x.matchId)]).toEqual([join, ['TERR1ESTJ01NBYC0DE006']]);
    expect(look(r).match?.matchId).toBe('TERR1ESTJ01NBYC0DE006');
  });
});

describe("the page's own fragment (§5.2, D-38, PLAN §11)", () => {
  it('sets it by location.replace, never by assigning location.hash, which would add a history entry Back walks to an old match', () => {
    const g = globalThis as { location?: unknown; window?: unknown };
    const replaced: string[] = [];
    let assigned = 0;
    const loc = { href: 'https://terriest.test/play/#join=TERR1ESTDESKT0PM30004', replace: (u: string) => replaced.push(u) };
    Object.defineProperty(loc, 'hash', {
      get: () => '#join=TERR1ESTDESKT0PM30004',
      set: () => {
        assigned++;
      },
    });
    const win = new EventTarget();
    g.location = loc;
    g.window = win;
    try {
      browserLocation.replace('#join=TERR1ESTSCREENS20000V');
      browserLocation.replace('#');
      expect([replaced, assigned]).toEqual([['#join=TERR1ESTSCREENS20000V', '#'], 0]);
      expect([browserLocation.hash(), browserLocation.href()]).toEqual(['#join=TERR1ESTDESKT0PM30004', loc.href]);
      // Each hashchange hands on its new address's fragment, '' for none, until removed.
      const heard: string[] = [];
      const stop = browserLocation.onHashChange((h) => heard.push(h));
      const change = (newURL: string): void => {
        win.dispatchEvent(Object.assign(new Event('hashchange'), { newURL, oldURL: loc.href }));
      };
      change('https://terriest.test/play/#join=TERR1ESTJ01NBYC0DE006');
      change('https://terriest.test/play/');
      stop();
      change('https://terriest.test/play/#anything');
      expect(heard).toEqual(['#join=TERR1ESTJ01NBYC0DE006', '']);
    } finally {
      delete g.location;
      delete g.window;
    }
  });
});

describe('a room that opens once its screen has gone (§5.6)', () => {
  it("is closed, never held: Join's Home pressed while it was still opening", async () => {
    const r = rig({ hash: '#join=TERR1ESTDESKT0PM30004' });
    await r.app.start();
    expect(look(r).screen).toBe('join');
    button(r, 'join-home').click(); // before the room's transport has come
    await settle();
    expect(r.rooms.map((x) => x.matchId)).toEqual(['TERR1ESTDESKT0PM30004']); // it opened, then
    expect([look(r).screen, look(r).match]).toEqual(['home', null]);
    r.clock.advance(0); // the cleared fragment's own hashchange
    expect(r.clock.pending).toBe(0); // its timer stopped with it: no room runs behind Home
  });
});

describe('the canary before Propose and Join (§5.6, D-23, M4-Q31)', () => {
  it("says this browser can't play with others, from a link and from Propose, opening no room; Practice still plays", async () => {
    const r = rig({ hash: '#join=TERR1ESTDESKT0PM30004', canary: false });
    await r.app.start();
    await settle();
    expect(look(r)).toMatchObject({ screen: 'message', message: 'canary', match: null });
    expect(r.rooms).toEqual([]);
    // Practice, its fragment cleared, so a reload goes Home.
    button(r, 'message-practice').click();
    expect([look(r).screen, r.location.hash()]).toEqual(['practice', '']);
    button(r, 'back').click();
    button(r, 'propose').click();
    expect(look(r)).toMatchObject({ screen: 'message', message: 'canary' });
    button(r, 'message-home').click();
    expect(look(r).screen).toBe('home');
    expect([r.canaries, r.rooms]).toEqual([[false], []]); // computed once, and nothing contacted
    startPractice(r);
    expect(look(r).screen).toBe('prematch');
  });

  it('never asks it for Practice, before the compile has finished', async () => {
    const r = rig();
    await r.app.start();
    startPractice(r);
    play(r, 500);
    expect(r.canaries).toEqual([]);
    await r.stages[0]!.finish();
    await settle();
    r.clock.advance(1);
    expect(r.canaries).toEqual([true]); // start-up's, once the compile has finished
  });
});

describe('Practice through the screens (§5.3, §5.4, §5.7–§5.9, Q-15, Q-17)', () => {
  it('plays Home to Results and Play again, the stage and the frame loop on the pitch screen alone, one log for each match', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    expect(r.host().uiActive()).toBe('other');

    // Practice's setup, focused on its heading.
    button(r, 'practice').click();
    expect(look(r).screen).toBe('practice');
    expect(dom.document.activeElement.textContent).toBe('Practice');
    expect(r.host().uiActive()).toBe('other');
    const sel = (test: string): ReturnType<typeof fake> => only(screenEl(r), `select[data-test="${test}"]`);
    sel('pack-size').value = '1';
    sel('match-length').value = '1';
    button(r, 'start').click();

    // Pre-match: the stage shown, the loop running, Ready focused from the entry (§1.42).
    expect(look(r).screen).toBe('prematch');
    expect([stageBox(r).hidden, r.root.classList.contains('pitch'), r.frames.pending]).toEqual([false, true, 1]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    expect(r.host().uiActive()).toBe('pitch');
    await settle();
    let i = look(r);
    expect(i.match).toMatchObject({ kind: 'practice', me: ME, matchId: null, started: true, paused: false });
    expect(i.announcements).toMatchObject({ matchId: null, arrivalTick: 0, countdowns: [], goals: [], results: null });
    // Each layer's figures under its name: the HUD, the overlay, the menu and the networked notes among them.
    expect(Object.keys(i.layers)).toEqual(expect.arrayContaining(['hud', 'menu', 'overlay', 'net']));
    expect(i.layers['net']).toEqual({ watching: false, offer: null }); // Practice has no networked notes
    expect(i.controls).not.toBeNull();

    // A pounce in warm-up, which every control has (D-8): the lunge latched in the hook, and its use told
    // to the page's devices, whose watchers the hints are (§4.7).
    playUntil(r, () => look(r).match!.inRoster, 2000);
    expect(r.used).toEqual([]);
    r.device.pounce = true;
    playUntil(r, () => look(r).match!.mine!.lunges === 1, 2000);
    i = look(r);
    expect(i.match!.mine!.lastLungeTick).not.toBeNull();
    expect(i.controls!.presses.pounce).toBe(1);
    expect(r.used).toEqual(['keyboard pounce']);

    // The menu by Escape: the keyboard's screen is the menu's, and Practice pauses (Q-15); Escape again
    // closes it, the focus back on Ready.
    r.app.ui(press('menu'));
    expect([look(r).menu, r.host().uiActive(), look(r).match!.paused]).toEqual(['menu', 'menu', true]);
    r.app.ui(press('menu'));
    expect([look(r).menu, r.host().uiActive(), look(r).match!.paused]).toEqual(['closed', 'pitch', false]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');

    // Ready by Enter: the start countdown, then Match at the first kickoff's play (M4-Q8).
    playUntil(r, () => button(r, 'ready').getAttribute('aria-disabled') !== 'true', 2000);
    r.app.ui(press('press', r.clock.now()));
    playUntil(r, () => look(r).match!.phase === START_COUNTDOWN, 2000, 16);
    // The drawn head's phase, as the validated scripts time their holds: the final state's comes w ticks on.
    i = look(r);
    expect(i.match!.headTick - i.match!.phaseStart).toBeLessThan(config.lateWindowTicks);
    expect(i.match!.finalTick).toBeLessThan(i.match!.phaseStart);
    expect(i.screen).toBe('prematch');
    playUntil(r, () => look(r).screen === 'match', 8000);
    i = look(r);
    expect(i.match!.phase).toBe(IN_PLAY);
    expect(i.announcements!.countdowns.length).toBeGreaterThanOrEqual(1); // the start's, shown by the HUD

    // To the end, confirmed: Results, the stage hidden, the loop stopped, Play again focused (Q-17).
    // A passive person: the bot's goals stop the clock for 6.4 s each (§9.2's setups play the spec's).
    playUntil(r, () => look(r).screen === 'results', 240_000, 100);
    i = look(r);
    const firstLog = i.announcements!;
    expect([stageBox(r).hidden, r.root.classList.contains('pitch'), r.frames.pending]).toEqual([true, false, 0]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('again');
    expect(r.host().uiActive()).toBe('results');
    expect(i.controls).toBeNull();
    expect(i.layers).toEqual({});
    expect(i.match!.end).not.toBeNull();
    // Each goal the HUD showed, at its confirmed tick (D-14).
    expect(firstLog.goals.length).toBeGreaterThan(0);
    expect(firstLog.goals.every((g) => i.match!.goals.some((x) => x.tick === g.tick) && g.withdrawnAtMs === null)).toBe(true);
    expect(firstLog.results).not.toBeNull();
    expect(i.match!.timer).toMatchObject({ gapMaxMs: config.timelineTimerMs, gapsOverFreeze: 0, gapsOverStall: 0 });
    expect(i.match!.timer.runs).toBeGreaterThan(1000);
    expect(i.frames.frames).toBeGreaterThan(100);
    expect(i.frames.headHashMismatches).toBe(0); // P11, counted under the hook
    const t = i.match!.finalTick - 10;
    expect(r.test.hashAt!(t)).toMatch(/^[0-9a-f]{16}$/);

    // The pitch screen's controls gone with it: nothing reads the page's devices on Results.
    r.device.pounce = true;
    play(r, 200);
    expect(r.device.pounce).toBe(true);
    r.device.pounce = false;

    // Q-17's guard: a press at once is announced and dropped; one 0.5 s on plays again.
    r.app.ui(press('press', r.clock.now()));
    expect(look(r).screen).toBe('results');
    r.clock.advance(config.resultsPressGuardSeconds * 1000);
    r.app.ui(press('press', r.clock.now()));
    await settle();
    i = look(r);
    expect(i.screen).toBe('prematch');
    // A new log, the new match's, from its opening.
    expect(i.announcements).toMatchObject({ matchId: null, arrivalTick: 0, countdowns: [], goals: [], results: null });
    expect(i.match!.localTick).toBe(0);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    // And the match's own figures from its opening too (§1.40): its timer's runs and its latched lunges.
    const firstRuns = look(r).match!.timer.runs;
    expect(firstRuns).toBeLessThan(10);
    playUntil(r, () => look(r).match!.inRoster && look(r).match!.mine !== null, 2000);
    expect([look(r).match!.mine!.lunges, look(r).match!.mine!.lastLungeTick]).toEqual([0, null]);

    // Leave on Pre-match: Home, nothing held, the log kept until another match opens (§1.40).
    play(r, 500);
    button(r, 'prematch-leave').click();
    i = look(r);
    expect([i.screen, i.match, i.announcements?.arrivalTick, stageBox(r).hidden, r.frames.pending]).toEqual(['home', null, 0, true, 0]);
    expect(dom.document.activeElement.textContent).toBe('terriest');
  }, 30_000);

  it("announces Results' presses into the log it keeps, the guard's verdict with each (§4.9, M4-Q26)", async () => {
    // The whole match is the test above's; here the log is read on Results through a played match's end.
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    playUntil(r, () => button(r, 'ready').getAttribute('aria-disabled') !== 'true', 2000);
    button(r, 'ready').click();
    playUntil(r, () => look(r).screen === 'results', 240_000, 100);
    const shown = look(r).announcements!.results!.shownAtMs;
    r.app.ui(press('press', shown + 100));
    r.clock.advance(600);
    r.app.ui(press('right', r.clock.now())); // to Home
    r.app.ui(press('press', shown + 700));
    await settle();
    expect(look(r).screen).toBe('home');
    expect(look(r).announcements!.results!.presses).toEqual([
      { atMs: 100, source: 'keyboard', accepted: false },
      { atMs: 700, source: 'keyboard', accepted: true },
    ]);
    // Results' Home leaves the match (§5.11): none held, and Practice's Start opens another.
    expect(look(r).match).toBeNull();
    expect(r.test.hashAt!(0)).toBe('');
    startPractice(r);
    expect(look(r).screen).toBe('prematch');
    expect(look(r).match!.localTick).toBe(0);
  }, 30_000);

  it('counts under the hook each frame whose drawing changed the head (P11), the count kept once the pitch screen goes', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    play(r, 300);
    expect(look(r).frames.headHashMismatches).toBe(0);
    // A drawing that writes the head, as P11 forbids: each frame it draws is counted.
    const stage = r.stages[0]!;
    const draw = stage.draw.bind(stage);
    stage.draw = (f) => {
      const out = draw(f);
      held(r).head.ball.x += 0.001;
      return out;
    };
    play(r, 200);
    const n = look(r).frames.headHashMismatches;
    expect(n).toBeGreaterThan(0);
    button(r, 'prematch-leave').click();
    expect([look(r).screen, look(r).frames.headHashMismatches]).toEqual(['home', n]);
  });

  it("counts the timer's gaps past the freeze, d + w ticks, and past the stall's 2 s (D-15, D-31, §8.1)", async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    play(r, 500);
    expect(look(r).match!.timer).toMatchObject({ gapsOverFreeze: 0, gapsOverStall: 0 });
    r.clock.stall(300); // past d + w ticks, 233⅓ ms
    play(r, 100);
    let t = look(r).match!.timer;
    expect([t.gapsOverFreeze, t.gapsOverStall, t.gapMaxMs >= 300 && t.gapMaxMs < 2000]).toEqual([1, 0, true]);
    r.clock.stall(2100);
    play(r, 100);
    t = look(r).match!.timer;
    expect([t.gapsOverFreeze, t.gapsOverStall, t.gapMaxMs >= 2100]).toEqual([2, 1, true]);
  });
});

describe('the graphics lost, through the app (§5.8, D-30)', () => {
  it("keeps the play keys from a player while they're lost, then says so by the message, the hook reading it", async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    play(r, 300);
    expect([r.host().uiActive(), r.host().sampling()]).toEqual(['pitch', true]);
    r.stages[0]!.onGraphics!('lost');
    expect([r.host().uiActive(), r.host().sampling(), look(r).match!.paused]).toEqual(['spectator', false, true]);
    r.stages[0]!.onGraphics!('restored');
    expect([r.host().uiActive(), r.host().sampling(), look(r).match!.paused]).toEqual(['pitch', true, false]);
    r.stages[0]!.onGraphics!('lost');
    play(r, config.lostGraphicsSeconds * 1000 + 100);
    // Practice's own words, which say it waits (results-hud's PRACTICE_GRAPHICS), under the pitch screen's code.
    expect(look(r)).toMatchObject({ screen: 'message', message: 'graphics' });
    expect(only(screenEl(r), '[data-message="practice-graphics"]').shown).toBe(true);
    expect(r.host().uiActive()).toBe('other'); // the message's keys are the browser's
    expect(r.guard.active).toBe(true); // a match is still held, and asks before the page goes
    r.stages[0]!.onGraphics!('restored');
    expect([look(r).screen, look(r).message, r.host().uiActive()]).toEqual(['prematch', null, 'pitch']);
  });
});

describe('the graphics lost, through the app, beyond Practice (§5.8, §5.10, D-30)', () => {
  it("gives a networked match the message that says it goes on for the others, never Practice's", async () => {
    const r = rig();
    await r.app.start();
    button(r, 'propose').click();
    button(r, 'create').click();
    await settle();
    button(r, 'play-0').click();
    expect([look(r).screen, look(r).match!.kind]).toEqual(['prematch', 'net']);
    r.stages[0]!.onGraphics!('lost');
    play(r, LOST_MS + 100);
    expect(look(r)).toMatchObject({ screen: 'message', message: 'graphics' });
    expect(only(screenEl(r), '[data-message="graphics"]').shown).toBe(true);
    expect(screenEl(r).querySelectorAll('[data-message="practice-graphics"]')).toHaveLength(0);
  });

  it('shows a context lost on Home, which no pitch screen heard, on the Practice that follows: restoring, paused, then the message', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    // The stage keeps the loss it told nobody (src/render/scene.ts): Home has no onGraphics.
    expect(r.stages[0]!.onGraphics).toBeNull();
    r.stages[0]!.lost = true;
    startPractice(r);
    await settle();
    play(r, 50); // the HUD writes what a frame and a run hand it
    expect([hudOf(look(r)).graphics, look(r).match!.paused, r.host().sampling(), r.host().uiActive()]).toEqual(['restoring', true, false, 'spectator']);
    play(r, LOST_MS + 100);
    expect(look(r)).toMatchObject({ screen: 'message', message: 'graphics' });
    r.stages[0]!.lost = false;
    r.stages[0]!.onGraphics!('restored');
    play(r, 50);
    expect([look(r).screen, look(r).match!.paused, hudOf(look(r)).graphics]).toEqual(['prematch', false, 'ok']);
  });
});

describe('the gamepad alone, from Home (L82, Q-17, §4.4)', () => {
  it('reaches Settings and comes back, changing a setting on the way, then Practice\'s setup and its Pre-match', async () => {
    const r = rig();
    await r.app.start();
    // Home: its heading focused; the pad's downs go Propose, Join, Practice, Settings.
    for (let k = 0; k < 4; k++) r.app.ui(pad('down'));
    expect(focused()).toBe('settings');
    r.app.ui(pad('press'));
    expect(look(r).screen).toBe('settings');
    // Settings: Sound by the d-pad, off by Start, then Back, the last of its controls.
    for (let k = 0; k < 3; k++) r.app.ui(pad('down'));
    expect(focused()).toBe('sound');
    r.app.ui(pad('press'));
    expect([r.settings.get().sound, only(screenEl(r), '[data-test="settings-message"]').textContent]).toEqual([false, SAVED]);
    r.app.ui(pad('up'));
    r.app.ui(pad('up'));
    r.app.ui(pad('up'));
    expect(focused()).toBe('back');
    r.app.ui(pad('press'));
    expect(look(r).screen).toBe('home');
    // Practice's setup: Start by the d-pad and pressed.
    for (let k = 0; k < 3; k++) r.app.ui(pad('down'));
    expect(focused()).toBe('practice');
    r.app.ui(pad('press'));
    expect(look(r).screen).toBe('practice');
    r.app.ui(pad('down'));
    expect(focused()).toBe('start');
    r.app.ui(pad('press'));
    expect([look(r).screen, look(r).match!.kind]).toEqual(['prematch', 'practice']);
  });
});

describe("Settings' render quality from Home (§2.8, D-33)", () => {
  it('re-creates the stage at once, preparing the new one behind Home, the old disposed only once its own prepare has settled', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    const [old] = r.stages;
    expect(old!.prepares).toBe(1); // under way, unsettled
    // Home scrolled down to its Settings, as a short window leaves it: Settings opens at its top (§5.14).
    dom.document.defaultView.scrollTo(0, 148);
    button(r, 'settings').click();
    expect(look(r).screen).toBe('settings');
    expect(dom.document.defaultView.scrollY).toBe(0);
    const low = only(screenEl(r), 'input[data-test="quality-low"]');
    low.checked = true;
    low.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(r.stages.map((s) => s.quality)).toEqual(['high', 'low']);
    const next = r.stages[1]!;
    expect(only(stageBox(r), 'canvas')).toBe(fake(next.canvas));
    expect(look(r).render.quality).toBe('low');
    expect(old!.disposed).toBe(false); // mid-compile: never disposed under it
    await old!.finish();
    await settle();
    expect(old!.disposed).toBe(true);
    expect(next.prepares).toBe(0);
    r.frames.run();
    r.clock.advance(0);
    expect(next.prepares).toBe(1);
    // A change that changes nothing makes no stage; one before a stage's prepare began disposes it at once.
    r.settings.set({ quality: 'low' });
    expect(r.stages.length).toBe(2);
    r.settings.set({ quality: 'high' });
    expect(r.stages.length).toBe(3);
    r.settings.set({ quality: 'low' });
    expect(r.stages.length).toBe(4);
    expect(r.stages[2]!.disposed).toBe(true); // its prepare hadn't begun
    expect(r.stages[2]!.prepares).toBe(0);
    // Back goes Home, at its top, where a Practice draws on the newest stage.
    dom.document.defaultView.scrollTo(0, 90);
    button(r, 'back').click();
    expect([look(r).screen, dom.document.defaultView.scrollY]).toEqual(['home', 0]);
  });
});

describe("Settings in a match's menu, through the app (§5.8, §6, PLAN §10, §11)", () => {
  /** A Practice's Pre-match, its compile done, and the menu's Settings panel open on it. */
  async function panelOpen(r: Rig): Promise<void> {
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    r.app.ui(press('menu'));
    r.app.ui(press('down'));
    expect(focused()).toBe('menu-settings');
    r.app.ui(press('press'));
  }

  it("reads 'settings' in the hook while the panel shows, and applies a quality it chose once the pitch screen goes, never under it (phase 2)", async () => {
    const r = rig();
    await panelOpen(r);
    expect([look(r).menu, look(r).match!.paused]).toEqual(['settings', true]);
    tick(only(screenEl(r), 'input[data-test="quality-low"]'), true);
    expect(r.settings.stored().quality).toBe('low');
    // The stage stays as it is while the pitch screen shows, the panel and the match after it.
    expect(r.stages.length).toBe(1);
    only(screenEl(r), 'button[data-test="back"]').click();
    expect([look(r).menu, look(r).match!.paused]).toEqual(['closed', false]);
    play(r, 200);
    expect([r.stages.length, look(r).render.quality]).toEqual([1, 'high']);
    // Leave: Home, and the new stage at the quality chosen, the old disposed once its prepare has settled.
    button(r, 'prematch-leave').click();
    expect([look(r).screen, r.stages.map((x) => x.quality), look(r).render.quality]).toEqual(['home', ['high', 'low'], 'low']);
    await settle();
    expect(r.stages[0]!.disposed).toBe(true);
  });

  it("says a change is in use for this visit alone when the browser keeps nothing, from Home's Settings and from the panel", async () => {
    const storage = new MemoryStorage();
    const r = rig({ storage });
    storage.full = true; // every write from now on refused, as a full quota's are
    await panelOpen(r);
    const sound = only(screenEl(r), 'input[data-test="sound"]');
    tick(sound, false);
    expect([r.settings.get().sound, only(screenEl(r), '[data-test="settings-message"]').textContent]).toEqual([false, NOT_SAVED]);
    only(screenEl(r), 'button[data-test="back"]').click();
    button(r, 'prematch-leave').click();
    button(r, 'settings').click();
    tick(only(screenEl(r), 'input[data-test="names"]'), true);
    expect(only(screenEl(r), '[data-test="settings-message"]').textContent).toBe(NOT_SAVED);
    // And once the browser keeps them again, saved.
    storage.full = false;
    tick(only(screenEl(r), 'input[data-test="names"]'), false);
    expect(only(screenEl(r), '[data-test="settings-message"]').textContent).toBe(SAVED);
  });
});

describe("the frame loop's phase-1 fallback (§1.47, §8.2, R-3)", () => {
  function loop(): { loop: FrameLoop; clock: FakeClock; frames: Frames; drawn: [number, number][] } {
    const clock = new FakeClock(0);
    const frames = new Frames();
    const drawn: [number, number][] = [];
    const l = new FrameLoop({ frame: (now, dt) => drawn.push([now, dt]), clock, stage: { setScale: () => {} }, frames });
    return { loop: l, clock, frames, drawn };
  }
  /** A frame of `ms`, the timer running every 4 ms through it, or held for the whole frame. */
  function frame(x: ReturnType<typeof loop>, ms: number, held: boolean): void {
    x.frames.run();
    if (held) {
      x.clock.advance(ms);
      x.loop.timerRan(x.clock.now(), null);
    } else {
      for (let t = 4; t <= ms; t += 4) {
        x.clock.advance(4);
        x.loop.timerRan(x.clock.now(), null);
      }
    }
  }

  it('draws every frame while the timer keeps its time, with the page clock and the time since the last frame drawn', () => {
    const x = loop();
    x.loop.start();
    for (let k = 0; k < 10; k++) frame(x, 16, false);
    expect(x.drawn.length).toBe(10);
    expect(x.drawn[0]).toEqual([0, 0]);
    expect(x.drawn[1]).toEqual([16, 16]);
    expect(x.loop.inspect()).toMatchObject({ frames: 10, scale: 1, skipping: false, actions: 0, log: [] });
  });

  it('skips the frame after one whose timer gap passed drawingLateTimerMs, so slow frames draw every other one, and recovers', () => {
    const x = loop();
    x.loop.start();
    frame(x, 16, false);
    frame(x, 16, false);
    expect(x.drawn.length).toBe(2);
    // Frames that hold the timer past the threshold: every other one drawn.
    const late = config.drawingLateTimerMs + 20;
    for (let k = 0; k < 8; k++) frame(x, k % 2 === 0 ? late : 4, k % 2 === 0);
    expect(x.drawn.length).toBe(2 + 4);
    expect(x.loop.skippedFrames).toBe(4);
    expect(x.loop.inspect()).toMatchObject({ skipping: true, actions: 1, log: [{ skipping: true, why: 'gaps', scale: 1 }] });
    // A gap just at the threshold isn't late.
    frame(x, config.drawingLateTimerMs, true);
    frame(x, 16, false);
    frame(x, 16, false);
    const f = x.loop.inspect();
    expect([f.skipping, f.actions, f.log.at(-1)!.why]).toEqual([false, 2, 'recovered']);
    expect(x.loop.skippedFrames).toBe(4);
  });

  it('draws every other frame while every timer gap is late, never none (§1.47)', () => {
    const x = loop();
    x.loop.start();
    // Each frame holds the timer past the threshold, as a page drawing too slowly does: the first draws, having
    // no gap before it, then every other one.
    for (let k = 0; k < 21; k++) frame(x, config.drawingLateTimerMs + 20, true);
    expect([x.drawn.length, x.loop.skippedFrames]).toEqual([11, 10]);
    expect(x.loop.inspect()).toMatchObject({ skipping: true, actions: 1 });
  });

  it('keeps the newest 200 of its log, and counts every action', () => {
    const x = loop();
    x.loop.start();
    const late = config.drawingLateTimerMs + 20;
    // On and off: a late frame, skipped, then two drawn on time, which end it; each action's time noted.
    const acted: number[] = [];
    const note = (): void => {
      const n = x.loop.inspect().actions;
      while (acted.length < n) acted.push(x.clock.now());
    };
    for (let k = 0; k < 150; k++) {
      for (const [ms, heldUp] of [[late, true], [4, false], [16, false]] as const) {
        x.frames.run();
        note();
        if (heldUp) {
          x.clock.advance(ms);
          x.loop.timerRan(x.clock.now(), null);
        } else {
          for (let t = 4; t <= ms; t += 4) {
            x.clock.advance(4);
            x.loop.timerRan(x.clock.now(), null);
          }
        }
      }
    }
    const f = x.loop.inspect();
    expect(acted.length).toBeGreaterThan(250);
    expect([f.actions, f.log.length]).toEqual([acted.length, 200]);
    expect(f.log.map((e) => e.atMs)).toEqual(acted.slice(-200));
  });

  it('runs only between start and stop, a new start drawing from a fresh time', () => {
    const x = loop();
    x.loop.start();
    frame(x, 16, false);
    x.loop.stop();
    expect(x.frames.pending).toBe(0);
    x.clock.advance(1000);
    x.loop.start();
    x.loop.start();
    expect(x.frames.pending).toBe(1);
    frame(x, 16, false);
    expect(x.drawn).toEqual([[0, 0], [1016, 0]]);
  });
});

describe("the pitch's layers and the page's devices (§1.63)", () => {
  it('composes the HUD, the overlay and the menu named menu, then the networked notes, before the other builders\' layers', () => {
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }]));
    const host = testHost({ match, view: new FakeView([], match), stage: new FakeStage([]), controls: null });
    const names = pitchLayers(host).map((l) => l.name);
    expect(PITCH_LAYERS.length).toBe(names.length);
    expect(names.slice(0, 4)).toEqual(['hud', 'overlay', 'menu', 'net']);
    expect(new Set(names).size).toBe(names.length); // each its own name in Inspection.layers
  });

  it("makes the keyboard once, which hands Q-17's keys to the app and reads the play keys only on a player's pitch", () => {
    const doc = dom.document;
    const target = Object.assign(new FakeNode(doc), { document: doc });
    let screen: 'pitch' | 'other' = 'other';
    const told: string[] = [];
    const devices = pageDevices({
      clock: new FakeClock(0), mirrored: () => false, sampling: () => false, used: () => {},
      ui: (c) => told.push(c.kind), uiActive: () => screen,
    }, target as unknown as Window);
    const key = (type: string, code: string): void => {
      target.dispatchEvent(Object.assign(new FakeEvent(type, { cancelable: true }), { code, repeat: false, ctrlKey: false, altKey: false, metaKey: false }));
    };
    // The keyboard first among the page's devices; phase 2's touch and pad beside it are the devices builder's.
    expect(devices.list()[0]!.kind).toBe('keyboard');
    key('keydown', 'Escape');
    key('keydown', 'KeyE');
    expect(told).toEqual(['menu']);
    expect(devices.list()[0]!.read().pounce).toBe(false);
    screen = 'pitch';
    key('keydown', 'KeyE');
    expect(devices.list()[0]!.read().pounce).toBe(true);
    devices.dispose();
    key('keydown', 'Escape');
    expect(told).toEqual(['menu']);
  });
});

describe("the hook's match (§1.40)", () => {
  it('reads the drawn head for the phase, your terrier and the ball, the final state for the roster', async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    await settle();
    playUntil(r, () => look(r).match!.inRoster, 2000);
    let m = look(r).match!;
    expect(m.phase).toBe(WARM_UP);
    expect(m.roster.map((x) => x.id)).toContain(ME);
    expect(m.mine).toMatchObject({ anim: expect.any(Number), pounceWait: 0, meter: 1, lunges: 0, lastLungeTick: null });
    expect(m.mine!.anim).not.toBe(LUNGING);
    expect(m.own.skipped).toBe(0); // Practice sends every tick (§8.1)

    // Your terrier running at the ball: the head, w ticks on from the final state, has it elsewhere, and the
    // hook reads it there; the roster the final state's, its inputs w ticks older.
    r.device.direction = 0;
    play(r, 1000);
    const t = held(r);
    const H = t.head.terriers[findTerrier(t.head, ME)]!;
    const F = t.final.terriers[findTerrier(t.final, ME)]!;
    m = look(r).match!;
    expect([H.x, H.y]).not.toEqual([F.x, F.y]);
    expect([m.mine!.x, m.mine!.y, m.mine!.z]).toEqual([H.x, H.y, H.z]);
    expect(H.lastInputTick).not.toBe(F.lastInputTick);
    expect(m.roster.find((x) => x.id === ME)!.lastInputTick).toBe(F.lastInputTick);
    expect([m.phase, m.phaseStart, m.clock]).toEqual([t.head.phase, t.head.phaseStart, t.head.clock]);
    r.device.direction = null;

    // In play, the ball moving: the head's ball, not the final state's.
    playUntil(r, () => button(r, 'ready').getAttribute('aria-disabled') !== 'true', 2000);
    button(r, 'ready').click();
    playUntil(r, () => {
      const x = held(r);
      return x.head.phase === IN_PLAY && x.head.ball.x !== x.final.ball.x;
    }, 20_000);
    m = look(r).match!;
    const ball = held(r).head.ball;
    expect(m.ball).toEqual({ x: ball.x, y: ball.y, z: ball.z });
    expect(m.ball.x).not.toBe(held(r).final.ball.x);
  });
});
