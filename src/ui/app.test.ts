import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, type MatchRules, RULE_SETTINGS, type RuleSetting } from '../config';
import { defaultParams, findTerrier, IN_PLAY, LUNGING, paramsFor, START_COUNTDOWN, WARM_UP } from '../core/sim/index';
import type { UiCommand } from '../input/source';
import { REFUSAL, type Timeline } from '../core/session/index';
import type { TransportOptions } from '../net/transport';
import { MemoryStorage } from '../storage/kv';
import { RULES_KEY } from '../storage/schema';
import { browserLocation, STATUS_MOVES, statusMessage } from './app';
import { type AppRig, appRig, type AppRigOptions, Locks, ME, nowhere, type RecordingStage, refusing } from './app-testing';
import { FakeClock } from './clock-testing';
import { pageDevices } from './devices';
import { fake, FakeEvent, type FakeDocument, type FakeElement, FakeNode, installDom, only } from './dom-testing';
import type { TransportFactory } from './game';
import type { Inspection } from './inspect';
import type { HudInspection } from './inspect';
import type { MatchStatus } from './match-types';
import { PITCH_LAYERS, pitchLayers } from './layers/index';
import { NOT_KEPT } from './screens/home';
import { changedRules, NOT_SAVED as RULES_NOT_SAVED, RESET as RULES_RESET, rulesSummary, SAVED as RULES_SAVED } from './screens/rules';
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
// asking; each networked status to §5.10's message with its moves, the
// match left (statusMessage): a build or protocol refusal, a duplicate ID
// and no timeline 20 s after opening while none is held, never a keeper's,
// a peer's refusal for the spectators' cap, and a room that can't open;
// the players gone is app-net.test.ts's, and a JOIN given up the pitch's
// notice there, M4-Q39's three tested here and in src/net alone; the
// leave guard on the pitch screens alone, Practice's too; Home,
// Practice's setup, Pre-match, Match, Results, Play again and Leave, the
// stage and the frame loop on the pitch screen alone, each screen focused,
// the keyboard told which screen it's on, the page at its top; one
// announcements log for each match, kept across its screens; Results' Home
// leaving the match; the hook's match figures, the drawn head's apart from
// the final state's, a lunge latched, each match's from its opening, P11's
// count and the timer's gaps past the freeze and the stall; Settings'
// quality applied behind Home, a stage made at a change's first ask and the
// other kept, so twenty changes make one and two at most are alive, the
// unused one disposed once a pitch screen opens and its own prepare has
// settled, never mid-compile, a change off the pitch taking it back
// meanwhile (phase 2b), and one chosen in a match's Settings panel once the
// pitch screen goes, the hook reading the panel; Settings saying when the
// browser keeps nothing, from Home and in the match; the pad alone from
// Home to Settings and back, and to Practice's Pre-match, its pack size and
// length chosen by the d-pad's left and right on the way; the graphics
// message a networked match gets, and a context lost before the pitch
// screen; the page's fragment set by location.replace; and the page's own
// leave guard on the window before any room. The match rules (C-59; PLAN
// §10, §11): Practice's setup's and Propose's Rules row, Rules… to the
// Rules screen, a rule chosen there stored, and its Back to the setup with
// the pack size and the length chosen, Rules… focused, by pointer and by
// the pad alone; a Practice, its Play again and a proposal playing by
// them, the hook's meter its share of the match's own, Pre-match listing
// them; A.3's record read back by the browser's next page, Reset to
// defaults; a refused write saying so there and on Home; a joined match
// at the defaults until it holds its state; Rules… unable to act once
// Create is pressed, a Create pressed again from a later Propose served
// by the room the first asked for, and a room whose Propose has gone
// left; and the rules read again when Use here takes the game from
// another tab. And the layers' order and the page's devices. The
// networked screens over M3's network simulator are app-net.test.ts's,
// and the frame loop and its governor, in virtual time,
// src/ui/frame-loop.test.ts's (phase 2b).

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

describe("each status to its message (§5.10, §9.2's app row, M4-Q39)", () => {
  const LINK = 'TERR1ESTDESKT0PM30004';
  /** A duplicate's refusal stands once it has outlasted a lingering connection's silence and a handshake (C-12). */
  const DUPLICATE_HOLD_MS = (config.duplicateIdSilentSeconds + config.handshakeTimeoutSeconds) * 1000;
  /** A status as NetGame's adapter reports it, nothing amiss but `s`. */
  const status = (s: Partial<MatchStatus> = {}): MatchStatus => ({
    refusal: null, failed: false, abandoned: false, refused: null, switchRefused: false, returning: false,
    spectatorsFull: false, leaving: false, closed: false, peers: 0, againSeen: false, ...s,
  });
  /** The message showing: its code, and its buttons in order, as the fake makes one per move handed it. */
  const shown = (r: Rig): { code: string | null; moves: string[] } => {
    const section = only(screenEl(r), 'section[data-test="message"]');
    return { code: section.getAttribute('data-message'), moves: section.querySelectorAll('button').map((b) => b.getAttribute('data-test')!) };
  };
  /** Join by the link, its room on `transport`, then `ms` of timer runs. */
  async function joined(transport: (rooms: TransportOptions[]) => TransportFactory, ms = 100): Promise<Rig> {
    const r = rig({ hash: `#join=${LINK}`, transport });
    await r.app.start();
    expect(look(r).screen).toBe('join');
    await settle();
    play(r, ms);
    await settle();
    return r;
  }

  it("routes each status by §5.10's table, a refusal and the failure only while no timeline is held, a duplicate only once it has stood", () => {
    const cases: [Partial<MatchStatus>, boolean, boolean, string | null][] = [
      [{}, false, false, null], [{}, true, false, null],
      [{ refusal: REFUSAL.BUILD }, false, false, 'build'], [{ refusal: REFUSAL.PROTOCOL }, false, false, 'build'],
      // A duplicate's refusal waits out a lingering connection's silence and a handshake, unless the
      // attempt has failed by then (C-12).
      [{ refusal: REFUSAL.DUPLICATE }, false, false, null], [{ refusal: REFUSAL.DUPLICATE }, false, true, 'duplicate'],
      [{ refusal: REFUSAL.DUPLICATE, failed: true }, false, false, 'duplicate'], [{ failed: true }, false, false, 'connect'],
      // A keeper's own timeline, held from genesis: a joiner of another version it refused, or that
      // refused it, never ends its match (D-21).
      [{ refusal: REFUSAL.BUILD }, true, false, null], [{ refusal: REFUSAL.DUPLICATE }, true, true, null],
      // NetGame took this page out of a full room, whenever (C-11).
      [{ spectatorsFull: true, refusal: REFUSAL.SPECTATORS_FULL }, false, false, 'spectators'], [{ spectatorsFull: true }, true, false, 'spectators'],
      [{ abandoned: true }, true, false, 'left'],
      // A JOIN given up is the pitch's notice, never a message (M4-Q39).
      [{ refused: 'full' }, true, false, null], [{ refused: 'started' }, true, false, null],
    ];
    for (const [s, held, stood, code] of cases) expect([s, held, stood, statusMessage(status(s), held, stood)]).toEqual([s, held, stood, code]);
    expect(STATUS_MOVES).toEqual({
      build: ['home'], connect: ['tryAgain', 'home'], left: ['home'], spectators: ['tryAgain', 'home'], duplicate: ['tryAgain', 'home'],
    });
  });

  it('says "Couldn\'t connect" with no timeline 20 s after the room opened, Try again opening the link again and Home leaving it (PLAN §8)', async () => {
    const r = await joined(nowhere, config.connectionFailureSeconds * 1000 - 200);
    expect(look(r).screen).toBe('join'); // still connecting, just short of 20 s
    play(r, 300);
    expect(look(r)).toMatchObject({ screen: 'message', message: 'connect', match: null });
    expect(shown(r)).toEqual({ code: 'connect', moves: ['message-tryAgain', 'message-home'] });
    expect(dom.document.activeElement.textContent).toBe('connect'); // its heading (§5.10)
    // The match left, its timer stopped with its room; the fragment still the link's, so a reload opens it again.
    play(r, 1000);
    expect([r.clock.pending, r.location.hash(), r.location.replaced, r.guard.active]).toEqual([0, `#join=${LINK}`, [], false]);
    // Try again: Join, its room opened again.
    button(r, 'message-tryAgain').click();
    await settle();
    expect([look(r).screen, look(r).match?.matchId, r.rooms.map((x) => x.matchId)]).toEqual(['join', LINK, [LINK, LINK]]);
    play(r, config.connectionFailureSeconds * 1000 + 100);
    expect(look(r).message).toBe('connect');
    // Home: the fragment cleared.
    button(r, 'message-home').click();
    expect([look(r).screen, r.location.hash(), r.location.replaced]).toEqual(['home', '', ['#']]);
  });

  it('says "A different version" for a build or protocol refusal while no timeline is held, with Home alone (D-21)', async () => {
    for (const reason of [REFUSAL.BUILD, REFUSAL.PROTOCOL]) {
      const r = await joined((rooms) => refusing(rooms, reason));
      expect(look(r)).toMatchObject({ screen: 'message', message: 'build', match: null });
      expect(shown(r)).toEqual({ code: 'build', moves: ['message-home'] });
      button(r, 'message-home').click();
      expect([look(r).screen, r.location.hash()]).toEqual(['home', '']);
    }
  });

  it("says this match is open in another tab or window once a duplicate ID's refusal has stood a lingering connection's silence and a handshake, with Try again and Home (C-12)", async () => {
    const r = await joined((rooms) => refusing(rooms, REFUSAL.DUPLICATE));
    // Refused from the first timer run, and still connecting just short of the hold, its refusal the hook's.
    expect([look(r).screen, look(r).match?.refusal]).toEqual(['join', REFUSAL.DUPLICATE]);
    play(r, DUPLICATE_HOLD_MS - 200);
    expect([look(r).screen, look(r).message]).toEqual(['join', null]);
    play(r, 300);
    expect(look(r)).toMatchObject({ screen: 'message', message: 'duplicate', match: null });
    expect(shown(r)).toEqual({ code: 'duplicate', moves: ['message-tryAgain', 'message-home'] });
    button(r, 'message-tryAgain').click();
    await settle();
    expect([look(r).screen, r.rooms.length]).toEqual(['join', 2]);
    play(r, DUPLICATE_HOLD_MS + 100);
    expect(look(r).message).toBe('duplicate'); // refused again, held again
  });

  it('says the match has the most spectators it can take once a peer refused this page for the cap, with Try again and Home (C-11)', async () => {
    const r = await joined((rooms) => refusing(rooms, REFUSAL.SPECTATORS_FULL));
    expect(look(r)).toMatchObject({ screen: 'message', message: 'spectators', match: null });
    expect(shown(r)).toEqual({ code: 'spectators', moves: ['message-tryAgain', 'message-home'] });
    button(r, 'message-tryAgain').click();
    await settle();
    expect([look(r).screen, r.rooms.length]).toEqual(['join', 2]);
  });

  it("keeps a keeper's match whatever refused it: Created and its Pre-match stay, its timeline held from genesis (D-21)", async () => {
    const r = rig({ transport: (rooms) => refusing(rooms, REFUSAL.BUILD) });
    await r.app.start();
    button(r, 'propose').click();
    button(r, 'create').click();
    await settle();
    play(r, 500);
    expect([look(r).screen, look(r).message, look(r).match?.started]).toEqual(['created', null, true]);
    button(r, 'play-0').click();
    play(r, 500);
    expect([look(r).screen, look(r).message]).toEqual(['prematch', null]);
  });

  it("says it couldn't open the match when a room can't open, from Join and from Create, rather than leave either waiting or say connect's words (phase 2d's review)", async () => {
    const fails = (rooms: TransportOptions[]): TransportFactory => (_peer, _now, o) => {
      rooms.push(o);
      return Promise.reject(new Error('no transport here'));
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await joined(fails);
      expect(look(r)).toMatchObject({ screen: 'message', message: 'open', match: null });
      expect(shown(r).moves).toEqual(['message-tryAgain', 'message-home']);
      expect(r.location.hash()).toBe(`#join=${LINK}`); // so a reload opens it again
      button(r, 'message-tryAgain').click();
      await settle();
      expect([look(r).message, r.rooms.length]).toEqual(['open', 2]);
      // Create's: Try again back to Propose.
      button(r, 'message-home').click();
      expect(r.location.hash()).toBe('');
      button(r, 'propose').click();
      button(r, 'create').click();
      await settle();
      expect(look(r)).toMatchObject({ screen: 'message', message: 'open', match: null });
      button(r, 'message-tryAgain').click();
      expect(look(r).screen).toBe('propose');
      // Each failure reported, as the page says so on screen: never the page's own error, which the gate's
      // guard would fail for a load a player's network dropped (§0).
      expect([errors.mock.calls.length, warnings.mock.calls.map((c) => c[0])]).toEqual([0, Array(3).fill('The match could not be opened:')]);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it('closes at once a match it leaves holding no timeline, with no LEAVE to send, so Try again opens a room of its own (phase 2d\'s review)', async () => {
    const events: string[] = [];
    const recording = (rooms: TransportOptions[]): TransportFactory => (_peer, _now, o) => {
      rooms.push(o);
      const n = rooms.length;
      events.push(`open ${n}`);
      return Promise.resolve({ send: () => {}, broadcast: () => {}, peerCount: () => 0, refusedBy: null, leave: () => {
        events.push(`leave ${n}`);
        return Promise.resolve();
      } });
    };
    const r = await joined(recording, config.connectionFailureSeconds * 1000 + 100);
    expect(look(r).message).toBe('connect');
    // The room left with the message, not a grace later.
    expect(events).toEqual(['open 1', 'leave 1']);
    button(r, 'message-tryAgain').click();
    await settle();
    expect(events).toEqual(['open 1', 'leave 1', 'open 2']);
    // Join's Home while connecting: the same, at once.
    button(r, 'join-home').click();
    expect(events).toEqual(['open 1', 'leave 1', 'open 2', 'leave 2']);
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
    expect(i.match).toMatchObject({ kind: 'practice', me: ME, matchId: null, started: true, paused: false, peers: 0 });
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
    // Practice's setup: 1 a side and 1 minute by the d-pad's left on each select, then Start pressed.
    for (let k = 0; k < 3; k++) r.app.ui(pad('down'));
    expect(focused()).toBe('practice');
    r.app.ui(pad('press'));
    expect(look(r).screen).toBe('practice');
    r.app.ui(pad('down'));
    expect(focused()).toBe('pack-size');
    for (let k = config.packSizeDefault; k > config.packSizeMin; k--) r.app.ui(pad('left'));
    r.app.ui(pad('down'));
    expect(focused()).toBe('match-length');
    for (let k = config.matchLengthDefaultMinutes; k > config.matchLengthMinMinutes; k--) r.app.ui(pad('left'));
    // Then the match rules' Rules…, before Start (C-59).
    r.app.ui(pad('down'));
    expect(focused()).toBe('rules');
    r.app.ui(pad('down'));
    expect(focused()).toBe('start');
    r.app.ui(pad('press'));
    expect([look(r).screen, look(r).match!.kind]).toEqual(['prematch', 'practice']);
    playUntil(r, () => look(r).match!.inRoster, 2_000);
    const m = look(r).match!;
    // 1 a side, the person in A and a bot in B, and 1 minute on the clock (Q-15).
    expect([config.packSizeMin, m.roster.map((x) => x.pack), m.clock]).toEqual([1, [0, 1], config.matchLengthMinMinutes * 60 * config.ticksPerSecond]);
  });
});

describe("Settings' render quality from Home (§2.8, D-33)", () => {
  /** The stages not disposed. */
  const alive = (r: Rig): string[] => r.stages.filter((s) => !s.disposed).map((s) => s.quality);
  /** The stage whose canvas is in #stage. */
  const shownStage = (r: Rig): RecordingStage => r.stages.find((s) => fake(s.canvas) === only(stageBox(r), 'canvas'))!;
  /** Home, its stage prepared, then Settings. */
  async function settingsOpen(r: Rig): Promise<void> {
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    button(r, 'settings').click();
  }

  it('applies at once: a stage at the new quality made at the first change, prepared behind the screen, the old one kept, and a change back swapping to it', async () => {
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
    await old!.finish();
    await settle();
    expect([old!.disposed, next.disposed]).toEqual([false, false]); // the old one kept, mid-compile or not
    expect(next.prepares).toBe(0);
    r.frames.run();
    r.clock.advance(0);
    expect(next.prepares).toBe(1); // behind the screen, once it has been painted (M4-Q38)
    // A change that changes nothing makes no stage; a change back swaps to the kept one, its prepare
    // done, and makes none.
    r.settings.set({ quality: 'low' });
    expect(r.stages.length).toBe(2);
    r.settings.set({ quality: 'high' });
    expect([r.stages.length, shownStage(r), look(r).render.quality]).toEqual([2, old, 'high']);
    r.frames.run();
    r.clock.advance(0);
    expect([old!.prepares, next.prepares, alive(r)]).toEqual([1, 1, ['high', 'low']]);
    // Back goes Home, at its top, where a Practice draws on the stage shown; both kept, prepared, while
    // Home and Settings show, so Settings again swaps back to low and makes none.
    await next.finish();
    await settle();
    dom.document.defaultView.scrollTo(0, 90);
    button(r, 'back').click();
    expect([look(r).screen, dom.document.defaultView.scrollY, alive(r)]).toEqual(['home', 0, ['high', 'low']]);
    button(r, 'settings').click();
    tick(only(screenEl(r), 'input[data-test="quality-low"]'), true);
    expect([r.stages.length, shownStage(r), alive(r)]).toEqual([2, next, ['high', 'low']]);
  });

  it('makes one stage for twenty changes, two alive at most, and disposes the unused one when Practice opens, once its own prepare has settled', async () => {
    const r = rig();
    await settingsOpen(r);
    for (let k = 0; k < 20; k++) {
      const quality = k % 2 === 0 ? 'low' : 'high';
      tick(only(screenEl(r), `input[data-test="quality-${quality}"]`), true);
      expect([look(r).render.quality, shownStage(r).quality], `change ${k + 1}`).toEqual([quality, quality]);
      expect(alive(r).length, `change ${k + 1}`).toBeLessThanOrEqual(2);
      r.frames.run(); // a frame and a task between changes: a stage shown then begins its prepare
      r.clock.advance(0);
    }
    expect([r.stages.map((s) => s.quality), r.stages.map((s) => s.prepares), alive(r)]).toEqual([['high', 'low'], [1, 1], ['high', 'low']]);
    // Practice at high: the low stage, mid-compile, is disposed only once its prepare has settled.
    button(r, 'back').click();
    startPractice(r);
    await settle();
    expect([look(r).screen, alive(r)]).toEqual(['prematch', ['high', 'low']]);
    await r.stages[1]!.finish();
    await settle();
    expect(alive(r)).toEqual(['high']);
    expect(look(r).render.quality).toBe('high');
  });

  /** Off the pitch, high shown and nothing kept: a stage made at `q`, its prepare begun, then `back` shown
   *  again while that one compiles. */
  function compiling(r: Rig, q: 'high' | 'low', back: RecordingStage): RecordingStage {
    r.settings.set({ quality: q });
    const s = r.stages.at(-1)!;
    r.frames.run();
    r.clock.advance(0);
    r.settings.set({ quality: back.quality });
    expect([s.quality, s.prepares, s.disposed, shownStage(r)]).toEqual([q, 1, false, back]);
    return s;
  }

  it('disposes a kept stage whose prepare never began as Practice opens, and keeps one still compiling until it settles with a pitch screen showing', async () => {
    const r = rig();
    await settingsOpen(r);
    const [high] = r.stages;
    // Low, then high again before a frame: low's prepare never begins, and Practice disposes it at once.
    r.settings.set({ quality: 'low' });
    r.settings.set({ quality: 'high' });
    const [, low] = r.stages;
    button(r, 'back').click();
    startPractice(r);
    expect([low!.prepares, low!.disposed, alive(r)]).toEqual([0, true, ['high']]);
    button(r, 'prematch-leave').click();
    // A low stage compiling as Practice opens is kept; Home again before it settles, and it stays when it
    // does, off the pitch, so a change to low swaps to it and makes no third stage.
    const fresh = compiling(r, 'low', high!);
    startPractice(r);
    await settle();
    expect(alive(r)).toEqual(['high', 'low']);
    button(r, 'prematch-leave').click();
    await fresh.finish();
    await settle();
    expect(alive(r)).toEqual(['high', 'low']);
    r.settings.set({ quality: 'low' });
    expect([r.stages.length, shownStage(r)]).toEqual([3, fresh]);
    // The next Practice, at low, disposes high, prepared long since, at once.
    startPractice(r);
    expect([alive(r), look(r).render.quality]).toEqual([['low'], 'low']);
  });

  it('never disposes a kept stage that a change took back while it compiled, though it settles under the pitch it then draws', async () => {
    const r = rig();
    await settingsOpen(r);
    const [high] = r.stages;
    const low = compiling(r, 'low', high!);
    // Practice opens with low compiling: kept, its disposal waiting on its prepare.
    button(r, 'back').click();
    startPractice(r);
    await settle();
    button(r, 'prematch-leave').click();
    // Low asked for again before it settles: taken back, high kept in its place; the next Practice draws
    // on low and disposes high at once.
    r.settings.set({ quality: 'low' });
    startPractice(r);
    expect([shownStage(r), alive(r)]).toEqual([low, ['low']]);
    // Its prepare settles under that Practice: the stage it draws on stays.
    await low.finish();
    await settle();
    expect([low.disposed, alive(r), look(r).render.quality]).toEqual([false, ['low'], 'low']);
  });

  it("draws a kept stage swapped back in at the governor's scale, not the one it last drew a pitch at (§2.8, §8.2)", async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    const high = r.stages[0]!;
    expect(high.prepares).toBe(1); // begun, and left compiling
    // A Practice on it while it compiles, each frame holding the timer past drawingLateTimerMs, until the
    // governor's step down reaches it.
    startPractice(r);
    for (let k = 0; k < 100 && high.scale === 1; k++) {
      r.frames.run();
      r.clock.stall(config.drawingLateTimerMs + 20);
    }
    expect(high.scale).toBeLessThan(1);
    // Home, and low chosen: a stage made at low, high kept; a Practice at low draws at full scale, high kept
    // while it compiles.
    button(r, 'prematch-leave').click();
    button(r, 'settings').click();
    r.settings.set({ quality: 'low' });
    const low = r.stages[1]!;
    r.frames.run();
    r.clock.advance(0);
    button(r, 'back').click();
    startPractice(r);
    r.frames.run();
    expect([low.scale, look(r).frames.scale]).toEqual([1, 1]);
    button(r, 'prematch-leave').click();
    // High settles off the pitch, so it stays kept, at the scale it was left at; chosen again, it's swapped
    // back in, and the next Practice's first frame draws it at the governor's full scale.
    await high.finish();
    await settle();
    expect([alive(r), high.scale < 1]).toEqual([['high', 'low'], true]);
    r.settings.set({ quality: 'high' });
    expect(r.stages.length).toBe(2);
    startPractice(r);
    r.frames.run();
    expect([shownStage(r), high.scale, look(r).frames.scale, look(r).render.scale]).toEqual([high, 1, 1, 1]);
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
    // Leave: Home, and the new stage at the quality chosen, the old kept while no pitch screen shows,
    // then disposed by the next Practice's opening, its prepare long settled.
    button(r, 'prematch-leave').click();
    expect([look(r).screen, r.stages.map((x) => x.quality), look(r).render.quality]).toEqual(['home', ['high', 'low'], 'low']);
    await settle();
    expect(r.stages.map((x) => x.disposed)).toEqual([false, false]);
    startPractice(r);
    expect(r.stages.map((x) => x.disposed)).toEqual([true, false]);
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

describe("the frame loop's governor, through the app (§1.47, §8.2, D-31)", () => {
  it("steps drawing down on a shown page's late timer gaps, and judges nothing while the page is hidden", async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    startPractice(r);
    // Frames holding the timer past drawingLateTimerMs for a second: a step down, on the gaps alone, as
    // Practice sends every tick (D-22), applied to the stage at the next frame drawn.
    const held = config.drawingLateTimerMs + 20;
    for (let t = 0; t <= 1000; t += held) {
      r.frames.run();
      r.clock.stall(held);
    }
    r.frames.run();
    const down = look(r).frames;
    expect([down.actions, down.log.at(-1)?.why, r.stages[0]!.scale]).toEqual([1, 'gaps', down.scale]);
    expect(down.scale).toBeLessThan(1);
    // Hidden, its timers woken about once a second (D-31): nothing judged, nor the gap ending as it shows.
    r.page.hide();
    r.clock.throttle = 1000;
    r.clock.advance(5000);
    r.clock.throttle = null;
    r.page.show();
    for (let k = 0; k < 20; k++) {
      r.frames.run();
      r.clock.advance(16);
    }
    expect(look(r).frames.actions).toBe(1);
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

describe('the match rules through the app (C-59; PLAN §10, §11, A.3)', () => {
  /** Rule k's first choice that isn't its default. */
  const other = (k: RuleSetting): number => (config.matchRules[k] as readonly number[]).find((v) => v !== config[k])!;
  /** The shortest zoomies meter on offer, shorter than the build's. */
  const METER = config.matchRules.zoomiesFullSeconds[0];
  const RUN = other('runSpeedMetresPerSecond');
  const COUNTDOWN = other('kickoffCountdownSeconds');
  const text = (r: Rig, test: string): string => only(screenEl(r), `[data-test="${test}"]`).textContent;
  const sel = (r: Rig, test: string): FakeElement => only(screenEl(r), `select[data-test="${test}"]`);
  /** A button that says it can't act, as setEnabled leaves one. */
  const unable = (r: Rig, test: string): boolean => button(r, test).getAttribute('aria-disabled') === 'true';
  /** Each rule's select as the Rules screen shows it, in A.1's order. */
  const shownRules = (r: Rig): string[] => RULE_SETTINGS.map((k) => sel(r, `rule-${k}`).value);
  /** Each rule's value under `rules`, as its select shows it: its own, else its default. */
  const valuesOf = (rules: MatchRules): string[] => RULE_SETTINGS.map((k) => String(rules[k] ?? config[k]));
  /** Home's note that the browser isn't keeping what's chosen (PLAN §10), shown. */
  const notKept = (r: Rig): boolean => !only(screenEl(r), '[data-test="not-kept"]').hidden;
  /** On the Rules screen, rule k's choice v, as a person's choice leaves its select: its value, then its change. */
  function choose(r: Rig, k: RuleSetting, v: number): void {
    const s = sel(r, `rule-${k}`);
    s.value = String(v);
    s.dispatchEvent(new FakeEvent('change', { bubbles: true }));
  }

  it("offers them on Practice's setup: Rules… to the Rules screen, a rule chosen there stored, Back to the setup with its choices and Rules… focused, and Start playing by them", async () => {
    const r = rig();
    await r.app.start();
    // The compile done, so the pitch screen draws and the HUD writes what it's drawn.
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    button(r, 'practice').click();
    expect([look(r).screen, text(r, 'rules-summary')]).toEqual(['practice', 'The defaults']);
    // The pack size and the length away from their defaults, for Back to bring back.
    sel(r, 'pack-size').value = String(config.packSizeMin);
    sel(r, 'match-length').value = String(config.matchLengthMinMinutes);
    button(r, 'rules').click();
    expect(look(r).screen).toBe('rules');
    expect(dom.document.activeElement.textContent).toBe('Rules'); // its heading (Q-17)
    // A select a rule, in A.1's order, its choices the configuration's, each at its default, the one option
    // marked so; Reset with nothing to do.
    expect(screenEl(r).querySelectorAll('select').map((s) => s.getAttribute('data-test'))).toEqual(RULE_SETTINGS.map((k) => `rule-${k}`));
    expect(shownRules(r)).toEqual(valuesOf({}));
    for (const k of RULE_SETTINGS) {
      const options = sel(r, `rule-${k}`).querySelectorAll('option');
      expect(options.map((o) => o.value), k).toEqual((config.matchRules[k] as readonly number[]).map(String));
      expect(options.filter((o) => o.textContent.endsWith(' (default)')).map((o) => o.value), k).toEqual([String(config[k])]);
    }
    expect(unable(r, 'rules-reset')).toBe(true);
    // The shortest zoomies meter: stored at once, the status line saying so, Reset able to act.
    const rules = { zoomiesFullSeconds: METER };
    choose(r, 'zoomiesFullSeconds', METER);
    expect([r.rules.get(), text(r, 'rules-message'), unable(r, 'rules-reset')]).toEqual([rules, RULES_SAVED, false]);
    // Back: the setup with its choices, Rules… focused, the rule in its summary.
    button(r, 'back').click();
    expect(look(r).screen).toBe('practice');
    expect([sel(r, 'pack-size').value, sel(r, 'match-length').value]).toEqual([String(config.packSizeMin), String(config.matchLengthMinMinutes)]);
    expect(focused()).toBe('rules');
    expect(text(r, 'rules-summary')).toBe(rulesSummary(rules));
    expect(text(r, 'rules-summary')).toContain(`Zoomies meter ${METER} s`);
    // Start: a Practice of those choices under the rule, its timeline stepping by the rule's parameters.
    button(r, 'start').click();
    await settle();
    expect([look(r).screen, look(r).match!.settings]).toEqual([
      'prematch', { packSize: config.packSizeMin, matchMinutes: config.matchLengthMinMinutes, rules },
    ]);
    const t = held(r);
    expect(t.final.rules).toEqual(rules);
    expect(t.params).toBe(paramsFor(rules));
    expect(t.params.meterFull).toBeLessThan(defaultParams.meterFull);
    // The person's terrier with the rule's full meter, which the hook and the HUD read as full.
    playUntil(r, () => look(r).match!.inRoster, 2000);
    play(r, 100);
    const F = t.final;
    expect(F.terriers[findTerrier(F, ME)]!.meter).toBe(t.params.meterFull);
    expect([look(r).match!.mine!.meter, hudOf(look(r)).meter]).toEqual([1, 1]);
    // Pre-match lists the rule, from the match's state.
    const listed = only(screenEl(r), '[data-test="prematch-rules"]');
    expect([listed.hidden, listed.textContent]).toEqual([false, `This match’s rules: ${changedRules(rules)[0]}.`]);
    expect(listed.textContent).toContain(`Zoomies meter ${METER} s`);
  });

  it("works the Rules screen by the gamepad alone, from Practice's setup and back to its Start (L82, Q-17)", async () => {
    const r = rig();
    await r.app.start();
    for (let k = 0; k < 3; k++) r.app.ui(pad('down'));
    r.app.ui(pad('press'));
    // The setup's d-pad: the pack size, the length, then Rules…, before Start.
    for (let k = 0; k < 3; k++) r.app.ui(pad('down'));
    expect([look(r).screen, focused()]).toEqual(['practice', 'rules']);
    r.app.ui(pad('press'));
    expect(look(r).screen).toBe('rules');
    // The first rule's select, a choice on by the d-pad's right: stored as a person's choice is.
    const first = RULE_SETTINGS[0]!;
    const choices = config.matchRules[first] as readonly number[];
    const next = choices[choices.indexOf(config[first]) + 1]!;
    r.app.ui(pad('down'));
    expect(focused()).toBe(`rule-${first}`);
    r.app.ui(pad('right'));
    expect([r.rules.get(), text(r, 'rules-message')]).toEqual([{ [first]: next }, RULES_SAVED]);
    // Round the ends to Back, the last of its controls: the setup, Rules… focused, and on to Start.
    r.app.ui(pad('up'));
    expect(focused()).toBe('back');
    r.app.ui(pad('press'));
    expect([look(r).screen, focused()]).toEqual(['practice', 'rules']);
    r.app.ui(pad('down'));
    expect(focused()).toBe('start');
    r.app.ui(pad('press'));
    expect([look(r).screen, look(r).match!.settings.rules]).toEqual(['prematch', { [first]: next }]);
  });

  it("keeps them in this browser, A.3's record, for its next page, and Reset to defaults sets every rule to its default (PLAN §10)", async () => {
    const storage = new MemoryStorage();
    const r = rig({ storage });
    await r.app.start();
    button(r, 'practice').click();
    button(r, 'rules').click();
    expect(storage.getItem(RULES_KEY)).toBeNull(); // nothing written before a rule is chosen
    choose(r, 'kickoffCountdownSeconds', COUNTDOWN);
    choose(r, 'runSpeedMetresPerSecond', RUN);
    // The whole record at each change: the rules alone, each as its value, in A.1's order.
    const rules = { runSpeedMetresPerSecond: RUN, kickoffCountdownSeconds: COUNTDOWN };
    expect(storage.getItem(RULES_KEY)).toBe(JSON.stringify({ v: 1, rules }));
    // The browser's next page, over the same storage: its setup's summary and its Rules screen read them back.
    const next = rig({ storage });
    await next.app.start();
    button(next, 'practice').click();
    expect(text(next, 'rules-summary')).toBe(`Run speed ${RUN} m/s; Kickoff countdown ${COUNTDOWN} s`);
    button(next, 'rules').click();
    expect(shownRules(next)).toEqual(valuesOf(rules));
    expect(unable(next, 'rules-reset')).toBe(false);
    // Reset to defaults: every rule at its default, the record none, the status saying so, Reset with nothing
    // more to do; and the setup's summary the defaults again.
    button(next, 'rules-reset').click();
    expect(shownRules(next)).toEqual(valuesOf({}));
    expect([next.rules.get(), storage.getItem(RULES_KEY), text(next, 'rules-message'), unable(next, 'rules-reset')]).toEqual([
      {}, JSON.stringify({ v: 1, rules: {} }), RULES_RESET, true,
    ]);
    button(next, 'back').click();
    expect(text(next, 'rules-summary')).toBe('The defaults');
  });

  it("says a rule is in use for this visit alone when the browser keeps nothing, there and on Home, until a write succeeds (PLAN §10)", async () => {
    const storage = new MemoryStorage();
    const r = rig({ storage });
    await r.app.start();
    expect(notKept(r)).toBe(false);
    storage.full = true; // every write refused from now on, as a full quota's are
    button(r, 'practice').click();
    button(r, 'rules').click();
    choose(r, 'runSpeedMetresPerSecond', RUN);
    // In force on this page, unwritten, and said so.
    expect([r.rules.get(), r.rules.persistent, storage.getItem(RULES_KEY), text(r, 'rules-message')]).toEqual([
      { runSpeedMetresPerSecond: RUN }, false, null, RULES_NOT_SAVED,
    ]);
    button(r, 'back').click();
    expect(text(r, 'rules-summary')).toBe(`Run speed ${RUN} m/s`);
    button(r, 'back').click();
    expect([look(r).screen, notKept(r)]).toEqual(['home', true]);
    // Its words name the rules among what isn't kept, the settings having been kept.
    expect([r.settings.persistent, text(r, 'not-kept')]).toEqual([true, NOT_KEPT]);
    expect(NOT_KEPT).toContain('rules');
    // Kept again: the next change writes the whole record, saying so, and Home's note goes.
    storage.full = false;
    button(r, 'practice').click();
    button(r, 'rules').click();
    choose(r, 'kickoffCountdownSeconds', COUNTDOWN);
    expect([r.rules.persistent, text(r, 'rules-message')]).toEqual([true, RULES_SAVED]);
    expect(storage.getItem(RULES_KEY)).toBe(JSON.stringify({ v: 1, rules: { runSpeedMetresPerSecond: RUN, kickoffCountdownSeconds: COUNTDOWN } }));
    button(r, 'back').click();
    button(r, 'back').click();
    expect([look(r).screen, notKept(r)]).toEqual(['home', false]);
  });

  it("plays Practice's Play again by the same rules (Q-15)", async () => {
    const r = rig();
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    // The shortest kickoff countdown, set in the store the Rules screen sets and Start reads.
    const rules = { kickoffCountdownSeconds: COUNTDOWN };
    r.rules.set(rules);
    startPractice(r);
    await settle();
    const first = held(r);
    expect([first.final.rules, first.params]).toEqual([rules, paramsFor(rules)]);
    playUntil(r, () => button(r, 'ready').getAttribute('aria-disabled') !== 'true', 2000);
    button(r, 'ready').click();
    playUntil(r, () => look(r).screen === 'results', 240_000, 100);
    expect(look(r).match!.settings.rules).toEqual(rules);
    r.clock.advance(config.resultsPressGuardSeconds * 1000);
    r.app.ui(press('press', r.clock.now()));
    await settle();
    // The new match's Pre-match: a timeline of its own, from its genesis, under the same rules.
    const t = held(r);
    expect([look(r).screen, t === first, t.localTick]).toEqual(['prematch', false, 0]);
    expect([look(r).match!.settings, t.final.rules]).toEqual([{ packSize: 1, matchMinutes: 1, rules }, rules]);
    expect(t.params).toBe(paramsFor(rules));
  });

  it('offers them on Propose too, Back bringing its choices back, and Create proposes them: a room opened, the held match under them, its Pre-match listing them', async () => {
    const r = rig();
    await r.app.start();
    button(r, 'propose').click();
    expect([look(r).screen, text(r, 'rules-summary')]).toEqual(['propose', 'The defaults']);
    sel(r, 'pack-size').value = String(config.packSizeMax);
    sel(r, 'match-length').value = String(config.matchLengthMaxMinutes);
    button(r, 'rules').click();
    expect(look(r).screen).toBe('rules');
    choose(r, 'runSpeedMetresPerSecond', RUN);
    button(r, 'back').click();
    expect([look(r).screen, sel(r, 'pack-size').value, sel(r, 'match-length').value, focused(), text(r, 'rules-summary')]).toEqual([
      'propose', String(config.packSizeMax), String(config.matchLengthMaxMinutes), 'rules', `Run speed ${RUN} m/s`,
    ]);
    // Create: the room opened, genesis proposed under the rules, Created.
    button(r, 'create').click();
    await settle();
    const rules = { runSpeedMetresPerSecond: RUN };
    const m = look(r).match!;
    expect([look(r).screen, m.kind, r.rooms.map((x) => x.matchId)]).toEqual(['created', 'net', [m.matchId]]);
    expect(m.settings).toEqual({ packSize: config.packSizeMax, matchMinutes: config.matchLengthMaxMinutes, rules });
    const t = held(r);
    expect([t.started, t.final.rules, t.final.packSize]).toEqual([true, rules, config.packSizeMax]);
    expect(t.params).toBe(paramsFor(rules));
    // Its Pre-match lists them, so whoever joins sees what the match plays by.
    button(r, 'play-0').click();
    play(r, 100);
    const listed = only(screenEl(r), '[data-test="prematch-rules"]');
    expect([look(r).screen, listed.hidden, listed.textContent]).toEqual(['prematch', false, `This match’s rules: Run speed ${RUN} m/s.`]);
  });

  it('reports a match it joins at the defaults until it holds its state, whatever rules this browser stored', async () => {
    const r = rig({ hash: '#join=TERR1ESTDESKT0PM30004' });
    r.rules.set({ runSpeedMetresPerSecond: RUN });
    await r.app.start();
    await settle();
    expect(look(r).screen).toBe('join');
    expect(look(r).match).toMatchObject({ kind: 'net', started: false, settings: { packSize: config.packSizeDefault, matchMinutes: config.matchLengthDefaultMinutes } });
    expect(look(r).match!.settings.rules).toBeUndefined();
  });

  /** A room's transport that reaches no one, each room's open waiting till the test lets it through, as a
   *  slow relay's would: let() lets the oldest through; each room left, by its match ID, in `left`. */
  function lateRooms(): {
    readonly transport: (rooms: TransportOptions[]) => TransportFactory; readonly waiting: number; readonly left: string[]; let(): void;
  } {
    const waiting: (() => void)[] = [];
    const left: string[] = [];
    return {
      transport: (rooms) => (peer, now, o) => new Promise((resolve, reject) => {
        waiting.push(() => {
          nowhere(rooms)(peer, now, o).then((t) => resolve({
            ...t, leave: () => {
              left.push(o.matchId);
              return t.leave();
            },
          }), reject);
        });
      }),
      get waiting() {
        return waiting.length;
      },
      left,
      let: () => waiting.shift()!(),
    };
  }
  /** Microtask turns until `cond` holds, at most a few settles: a room's open is a chain of them. */
  const settled = async (cond: () => boolean): Promise<void> => {
    for (let k = 0; k < 10 && !cond(); k++) await settle();
  };
  /** The buttons on the screen reading "Creating…". */
  const creating = (r: Rig): FakeElement[] => screenEl(r).querySelectorAll('button').filter((b) => b.textContent === 'Creating…');

  it("keeps Rules… from acting once Create is pressed, and serves a Create pressed again from a later Propose with the room the first asked for, by that Propose's choices and the rules as they stand (C-59's review)", async () => {
    const rooms = lateRooms();
    const r = rig({ transport: rooms.transport });
    const rules = { runSpeedMetresPerSecond: RUN };
    r.rules.set(rules);
    await r.app.start();
    button(r, 'propose').click();
    button(r, 'create').click();
    await settled(() => rooms.waiting === 1);
    // Creating…: Rules… says it can't act, and a click on it leaves Propose and its Create as they are.
    expect([look(r).screen, creating(r).length, unable(r, 'rules'), rooms.waiting]).toEqual(['propose', 1, true, 1]);
    button(r, 'rules').click();
    expect([look(r).screen, creating(r).length]).toEqual(['propose', 1]);
    // Back to Home, and Propose a match again while the first room is still on its way: other choices, and
    // Rules… able to act there, a second rule chosen, Back keeping the choices.
    button(r, 'back').click();
    expect(look(r).screen).toBe('home');
    button(r, 'propose').click();
    expect([creating(r).length, unable(r, 'rules')]).toEqual([0, false]);
    sel(r, 'pack-size').value = String(config.packSizeMax);
    sel(r, 'match-length').value = String(config.matchLengthMaxMinutes);
    button(r, 'rules').click();
    choose(r, 'kickoffCountdownSeconds', COUNTDOWN);
    button(r, 'back').click();
    const both = { ...rules, kickoffCountdownSeconds: COUNTDOWN };
    expect([look(r).screen, sel(r, 'pack-size').value, sel(r, 'match-length').value, text(r, 'rules-summary')]).toEqual([
      'propose', String(config.packSizeMax), String(config.matchLengthMaxMinutes), rulesSummary(both),
    ]);
    // Create again: no second room asked for.
    button(r, 'create').click();
    await settle();
    expect([look(r).screen, creating(r).length, unable(r, 'rules'), rooms.waiting, look(r).match]).toEqual(['propose', 1, true, 1, null]);
    // The first room opens: it serves the Create on screen, with that Propose's choices and the rules as
    // they stand.
    rooms.let();
    await settled(() => look(r).screen === 'created');
    const m = look(r).match!;
    expect([look(r).screen, m.kind, m.started, r.rooms.map((x) => x.matchId), r.location.hash()]).toEqual([
      'created', 'net', true, [m.matchId], `#join=${m.matchId}`,
    ]);
    expect(m.settings).toEqual({ packSize: config.packSizeMax, matchMinutes: config.matchLengthMaxMinutes, rules: both });
    const t = held(r);
    expect([t.final.packSize, t.final.rules]).toEqual([config.packSizeMax, both]);
    expect(t.params).toBe(paramsFor(both));
    // One room, kept, and nothing left reading "Creating…".
    play(r, 500);
    expect([rooms.waiting, r.rooms.length, rooms.left, look(r).screen, creating(r).length]).toEqual([0, 1, [], 'created', 0]);
  });

  it("closes a room that opens once its Create's Propose has gone, leaving no Create reading Creating…, and a Create on the Propose that shows opens its own (C-59's review)", async () => {
    const rooms = lateRooms();
    const r = rig({ transport: rooms.transport });
    await r.app.start();
    button(r, 'propose').click();
    button(r, 'create').click();
    await settled(() => rooms.waiting === 1);
    // Back, and Propose again, pressing nothing there before the first room opens: it's left, never held.
    button(r, 'back').click();
    button(r, 'propose').click();
    rooms.let();
    await settled(() => rooms.left.length === 1);
    expect(rooms.left).toEqual([r.rooms[0]!.matchId]);
    expect([look(r).screen, look(r).match, creating(r).length, unable(r, 'create'), unable(r, 'rules'), r.location.hash()]).toEqual([
      'propose', null, 0, false, false, '',
    ]);
    r.clock.advance(0);
    expect(r.clock.pending).toBe(0); // its timer stopped with it: no room runs behind Propose
    // A Create there opens a room of its own.
    button(r, 'create').click();
    await settled(() => rooms.waiting === 1);
    rooms.let();
    await settled(() => look(r).screen === 'created');
    expect([look(r).screen, r.rooms.length, look(r).match?.matchId]).toEqual(['created', 2, r.rooms[1]!.matchId]);
  });

  it("reads the rules again when Use here takes the game from another tab, so its setup, its next change and its Start keep that tab's (D-24)", async () => {
    const locks = new Locks();
    const storage = new MemoryStorage();
    const a = rig({ locks, storage });
    await a.app.start();
    // Tab B, opened while A plays: the other tab's message, its store read as the browser's record stood.
    const b = rig({ locks, storage });
    await b.app.start();
    expect(look(b)).toMatchObject({ screen: 'message', message: 'other-tab' });
    // Tab A chooses a rule on its Rules screen, stored at once.
    button(a, 'practice').click();
    button(a, 'rules').click();
    choose(a, 'runSpeedMetresPerSecond', RUN);
    const theirs = { runSpeedMetresPerSecond: RUN };
    expect(storage.getItem(RULES_KEY)).toBe(JSON.stringify({ v: 1, rules: theirs }));
    // B takes the game: its Practice's setup sums A's rule up, and its Rules screen shows it chosen.
    button(b, 'message-useHere').click();
    await settle();
    expect([look(b).screen, look(a).message]).toEqual(['home', 'other-tab']);
    button(b, 'practice').click();
    expect(text(b, 'rules-summary')).toBe(rulesSummary(theirs));
    button(b, 'rules').click();
    expect(shownRules(b)).toEqual(valuesOf(theirs));
    // B's next change keeps A's rule in the record.
    choose(b, 'kickoffCountdownSeconds', COUNTDOWN);
    const both = { runSpeedMetresPerSecond: RUN, kickoffCountdownSeconds: COUNTDOWN };
    expect([b.rules.get(), storage.getItem(RULES_KEY)]).toEqual([both, JSON.stringify({ v: 1, rules: both })]);
    // And its Start plays by them.
    button(b, 'back').click();
    expect(text(b, 'rules-summary')).toBe(rulesSummary(both));
    button(b, 'start').click();
    await settle();
    expect([look(b).screen, look(b).match!.settings.rules, held(b).final.rules]).toEqual(['prematch', both, both]);
    expect(held(b).params).toBe(paramsFor(both));
  });
});
