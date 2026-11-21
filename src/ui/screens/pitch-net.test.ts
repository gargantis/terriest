import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config';
import { personId } from '../../core/bot/bot-id';
import type { ConfirmedEnd } from '../../core/session/index';
import type { RoomPeer } from '../../core/session/room-peer';
import { formatMatchId } from '../../core/match-id';
import type { Session } from '../../core/session/index';
import { findTerrier, IN_PLAY, type MatchState, type Pack, START_COUNTDOWN } from '../../core/sim/index';
import { TEST_BUILD } from '../../core/timeline/testing';
import type { UiCommand } from '../../input/source';
import type { Transport } from '../../net/transport';
import { PLACEHOLDER_LOOK } from '../../render/look';
import { FakeClock, fakePage } from '../clock-testing';
import { h } from '../dom';
import { cssDeclarations, cssLength, fake, type FakeDocument, type FakeElement, installDom, only, shownText } from '../dom-testing';
import { hudLayer } from '../hud';
import type { Layer, LayerFactory, PitchContext, PitchHost } from '../layer';
import { netLayer, OFFER_TEXT, WATCHING_TEXT } from '../layers/net';
import { type NetMatch, openNetMatch } from '../match';
import { FakeControls, FakeStage, FakeView, stateWith, StateMatch, testHost } from '../pitch-testing';
import { addBotButton, removeBotButton } from '../prematch';
import { World } from '../world-testing';
import { matchMenu } from './menu';
import { type PitchScreen, pitchScreen } from './pitch';
import type { Screen } from './screen';

// The pitch screen's phase-2 parts (M4's design §5.6–§5.8, §5.13, §5.14;
// PLAN D-12, D-28, D-30, D-39, C-36, L91), on the DOM fake: the networked
// Pre-match over a real networked Match on M3's network simulator, with
// Invite and its panel, each pack's Add a bot and Remove a bot for a player
// and a spectator alike, Remove shown only while this page hosts one there,
// and every bots' button locked by the start countdown with the focus kept;
// the networked notes, the watching notice and the other pack's offer;
// the graphics, stage.onGraphics as PitchContext's graphics, held inputs
// released and Practice paused while they're lost, the 5 s counted only
// while the page is visible, then the plain message with Leave over the
// pitch, and the pitch back in place of the message when they return; a
// spectator's follow along the ball and each terrier by the view key and
// the shoulders, which the screen hands the HUD's follow choice; and the
// stage's callback handed back on dispose.

vi.setConfig({ testTimeout: 60_000 });

const ME = personId(7, 0);
const OTHER = personId(7, 1);
const key = (kind: UiCommand['kind'], source: UiCommand['source'] = 'keyboard'): UiCommand => ({ kind, pressedAt: 0, source, repeat: false });
const LOST_MS = config.lostGraphicsSeconds * 1000;
const ROOM = 'TERR1ESTSCREENS20000V'; // a valid match ID (normalizeMatchId)

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

const menuLayer: LayerFactory = (hst: PitchHost) => matchMenu({ practice: hst.match.kind === 'practice', resume: () => hst.closeMenu(), settings: null, leave: () => hst.leave() });

/** A layer that keeps each context the screen hands it. */
function contexts(seen: PitchContext[]): LayerFactory {
  return (): Layer => ({ name: 'seen', el: null, frame: (ctx) => seen.push(ctx), run: (ctx) => seen.push(ctx) });
}

const button = (s: { el: HTMLElement }, test: string): FakeElement => only(s.el, `button[data-test="${test}"]`);
const shown = (s: { el: HTMLElement }, test: string): boolean => button(s, test).shown;

/** The graphics message's screen, by the shape results-hud's has: an alert with its Leave. */
function graphicsMessage(leave: () => void): Screen {
  return { el: h('section', { role: 'alert', 'data-message': 'graphics' }, h('h1', {}, 'The graphics stopped working'), h('button', { type: 'button', 'data-test': 'message-leave', onclick: leave }, 'Leave')), name: 'message' };
}

describe("a networked Pre-match's bots and Invite (§5.7, D-39)", () => {
  /** A proposer's networked Match at 2 a side over the loopback, on a clock the world runs. */
  async function proposer(world: World): Promise<{ match: NetMatch; clock: FakeClock }> {
    const clock = new FakeClock(world.now);
    world.tabs.push({ k: 0, me: ME, clock, page: fakePage(), rooms: new Map(), frozen: false } as never);
    const match = await openNetMatch({
      matchId: ROOM, me: ME, name: 'Ada', coat: 2, build: TEST_BUILD, relays: null, ice: 'local', clock, page: fakePage(),
      transport: (peer: RoomPeer, _now, o) => {
        const net = world.net(o.matchId);
        let link: Transport | null = null;
        net.join(net.add('p0', (l) => {
          link = l;
          return peer;
        }), world.now);
        return Promise.resolve(link!);
      },
    });
    match.propose({ packSize: 2, matchMinutes: 1 });
    return { match, clock };
  }

  function screenOver(match: NetMatch, playing: boolean): { screen: PitchScreen; stage: FakeStage; left: string[] } {
    const calls: string[] = [];
    const stage = new FakeStage(calls);
    const host = testHost({ match, view: new FakeView(calls, match), stage, controls: playing ? new FakeControls(calls) : null });
    const left: string[] = [];
    const screen = pitchScreen({
      ...host, leave: () => left.push('leave'), results: () => {}, invite: { href: 'https://terriest.test/', clipboard: null, share: null },
    }, [menuLayer, netLayer]);
    dom.document.body.append(fake(screen.el));
    return { screen, stage, left };
  }

  it("adds and removes this page's bots in either pack, shows Invite's link and code, and locks the bots' buttons from the countdown", async () => {
    const world = new World(61);
    const { match } = await proposer(world);
    match.play(0);
    const { screen, stage } = screenOver(match, true);
    await stage.finish();
    world.until(() => findTerrier(match.session.timeline.final, ME) >= 0, 3000);
    world.run(20);
    expect([shown(screen, 'invite-button'), only(screen.el, '[data-test="invite"]').shown]).toEqual([true, false]);
    // The invite closed, the pad's nav passes over its buttons, which a browser won't focus, to the bots'.
    button(screen, 'invite-button').focus();
    screen.ui(key('down', 'gamepad'));
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('add-bot-0');
    button(screen, 'invite-button').click();
    expect([only(screen.el, '[data-test="invite"]').shown, button(screen, 'invite-button').getAttribute('aria-expanded')]).toEqual([true, 'true']);
    expect(only(screen.el, '[data-test="invite-code"]').textContent).toBe(formatMatchId(ROOM));
    // Each pack's Add a bot; Remove only once this page hosts one there.
    expect([button(screen, 'add-bot-0').textContent, button(screen, 'add-bot-1').textContent]).toEqual(['Add a Blue bot', 'Add an Orange bot']);
    expect([shown(screen, 'remove-bot-0'), shown(screen, 'remove-bot-1')]).toEqual([false, false]);
    button(screen, 'add-bot-1').click();
    world.run(20);
    expect(shown(screen, 'remove-bot-1')).toBe(true);
    world.until(() => match.session.timeline.final.terriers.length === 2, 3000);
    world.run(20);
    // Pre-match's nav reaches them, after Ready, Switch pack, Leave and Invite (Q-17).
    const ready = button(screen, 'ready');
    ready.focus();
    for (const want of ['switch-pack', 'prematch-leave', 'invite-button', 'copy-link', 'copy-code', 'add-bot-0', 'add-bot-1', 'remove-bot-1']) {
      screen.ui(key('down'));
      expect(dom.document.activeElement.getAttribute('data-test')).toBe(want);
    }
    // Remove: the bot no longer wanted, Remove goes at once, the focus to its pack's Add, before the state
    // has taken the bot out (the session's rule, D-39); then its LEAVE does.
    screen.ui(key('press'));
    expect([shown(screen, 'remove-bot-1'), match.session.timeline.final.terriers.length]).toEqual([false, 2]);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('add-bot-1');
    world.until(() => match.session.timeline.final.terriers.length === 1, 3000);
    world.run(20);
    expect(shown(screen, 'remove-bot-1')).toBe(false);
    // Fill both packs with bots, Ready, and the countdown locks the roster: every bots' button says so.
    button(screen, 'add-bot-0').click();
    button(screen, 'add-bot-1').click();
    button(screen, 'add-bot-1').click();
    world.until(() => match.session.timeline.final.terriers.length === 4, 3000);
    world.run(20);
    expect([button(screen, 'add-bot-0').textContent, button(screen, 'add-bot-0').getAttribute('aria-disabled')]).toEqual(['Add a Blue bot: full', 'true']);
    button(screen, 'remove-bot-1').focus();
    button(screen, 'ready').click();
    world.until(() => match.session.timeline.head.phase === START_COUNTDOWN, 3000);
    world.run(20);
    expect(button(screen, 'remove-bot-1')).toMatchObject({ textContent: 'Remove an Orange bot: starting…' });
    expect(button(screen, 'remove-bot-1').getAttribute('aria-disabled')).toBe('true');
    expect(button(screen, 'add-bot-1').textContent).toBe('Add an Orange bot: starting…');
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('remove-bot-1'); // the focus stays (§1.42)
    screen.ui(key('press'));
    world.run(100);
    expect(match.session.timeline.final.terriers.length).toBe(4);
    screen.dispose();
    match.close();
  });

  it("offers a spectator the bots' buttons and Invite, but no Ready or Switch pack", async () => {
    const world = new World(67);
    const { match } = await proposer(world);
    match.watch();
    const { screen, stage } = screenOver(match, false);
    await stage.finish();
    world.run(100);
    expect([shown(screen, 'ready'), shown(screen, 'switch-pack'), shown(screen, 'invite-button'), shown(screen, 'add-bot-0')]).toEqual([false, false, true, true]);
    button(screen, 'add-bot-0').click();
    world.until(() => match.session.timeline.final.terriers.length === 1, 3000);
    world.run(20);
    expect(shown(screen, 'remove-bot-0')).toBe(true);
    screen.dispose();
    match.close();
  });

  it("reads the bots' buttons from the countdown's lock, a full pack and canAddBot, in that order", () => {
    const s = stateWith(1, 50, [{ id: ME, pack: 0 }]);
    const look = PLACEHOLDER_LOOK;
    expect(addBotButton(s, 0, look, 1, true)).toEqual({ enabled: true, text: 'Add an Orange bot' });
    expect(addBotButton(s, 0, look, 0, false)).toEqual({ enabled: false, text: 'Add a Blue bot: full' });
    expect(addBotButton(s, 0, look, 1, false)).toEqual({ enabled: false, text: 'Add an Orange bot: no place' });
    expect(addBotButton(s, START_COUNTDOWN, look, 1, true).text).toBe('Add an Orange bot: starting…');
    expect(addBotButton(null, null, look, 1, true)).toEqual({ enabled: true, text: 'Add an Orange bot' });
    expect(removeBotButton({ ...s, phase: START_COUNTDOWN }, START_COUNTDOWN, look, 0)).toEqual({ enabled: false, text: 'Remove a Blue bot: starting…' });
    expect(removeBotButton(s, 0, look, 0)).toEqual({ enabled: true, text: 'Remove a Blue bot' });
  });
});

describe('the graphics (§5.8, D-30, C-36)', () => {
  function rig(o: { kind?: 'practice' | 'net'; player?: boolean } = {}): {
    match: StateMatch; stage: FakeStage; controls: FakeControls; screen: PitchScreen; seen: PitchContext[]; left: string[]; page: ReturnType<typeof fakePage>;
  } {
    const calls: string[] = [];
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }, { id: OTHER, pack: 1 }]));
    match.kind = o.kind ?? 'practice';
    const stage = new FakeStage(calls);
    const controls = new FakeControls(calls);
    const seen: PitchContext[] = [];
    const left: string[] = [];
    const page = fakePage();
    const host = testHost({ match, view: new FakeView(calls, match), stage, controls: o.player === false ? null : controls });
    const screen = pitchScreen({ ...host, leave: () => left.push('leave'), results: () => {}, page, graphicsMessage }, [menuLayer, contexts(seen)]);
    dom.document.body.append(fake(screen.el));
    return { match, stage, controls, screen, seen, left, page };
  }

  it("says they're restoring while lost, releasing what's held and pausing Practice, and resumes when they're back", async () => {
    const r = rig();
    await r.stage.finish();
    expect(r.stage.onGraphics).not.toBeNull();
    r.screen.frame(1000);
    expect([r.screen.graphics, r.seen.at(-1)!.graphics]).toEqual(['ok', 'ok']);
    r.stage.onGraphics!('lost');
    expect([r.screen.graphics, [...r.match.reasons], r.controls.releases, r.screen.message]).toEqual(['restoring', ['graphics'], 1, null]);
    r.screen.frame(1016);
    r.match.run();
    expect([r.seen.at(-2)!.graphics, r.seen.at(-1)!.graphics]).toEqual(['restoring', 'restoring']);
    expect(r.screen.inspect().graphics).toBe('restoring');
    r.match.clock.advance(LOST_MS - 1);
    expect(r.screen.message).toBeNull();
    r.stage.onGraphics!('restored');
    expect([r.screen.graphics, [...r.match.reasons], r.screen.message]).toEqual(['ok', [], null]);
    r.match.clock.advance(10);
    expect(r.screen.message).toBeNull(); // the count ended with the loss
    r.screen.dispose();
  });

  it('shows the plain message with Leave once lost for lostGraphicsSeconds of the page being visible, and the pitch again once back', async () => {
    const r = rig();
    await r.stage.finish();
    dom.document.body.append(fake(r.screen.el));
    r.stage.onGraphics!('lost');
    r.match.clock.advance(2000);
    // Hidden, the count stops: a hidden page's minute doesn't count toward the 5 s (D-30).
    r.page.hide();
    r.match.clock.advance(60_000);
    expect(r.screen.message).toBeNull();
    r.page.show();
    r.match.clock.advance(LOST_MS - 2000 - 1);
    expect(r.screen.message).toBeNull();
    r.match.clock.advance(1);
    expect([r.screen.message, r.screen.graphics]).toEqual(['graphics', 'lost']);
    const message = only(r.screen.el, '[data-message="graphics"]');
    expect(message.shown).toBe(true);
    expect(dom.document.activeElement.textContent).toBe('The graphics stopped working'); // its heading
    // Its keys are the message's: Escape opens no menu under it.
    r.screen.ui(key('menu'));
    expect(r.screen.menu).toBe('closed');
    // Back: the message goes, the pitch returns, Ready focused, Practice resumed.
    r.stage.onGraphics!('restored');
    expect([r.screen.message, r.screen.graphics, [...r.match.reasons]]).toEqual([null, 'ok', []]);
    expect(r.screen.el.querySelectorAll('[data-message="graphics"]')).toHaveLength(0);
    expect(dom.document.activeElement.getAttribute('data-test')).toBe('ready');
    // Lost again for good: the message's Leave leaves.
    r.stage.onGraphics!('lost');
    r.match.clock.advance(LOST_MS);
    button(r.screen, 'message-leave').click();
    expect(r.left).toEqual(['leave']);
    r.screen.dispose();
  });

  it('starts restoring when the context was lost before the screen was made, which the stage kept, and says so after lostGraphicsSeconds', async () => {
    // A context lost on Home, on Results, or between a role's two screens, was told to no screen: the stage
    // keeps it (src/render/scene.ts), and the next screen reads it as it's made (D-30).
    const calls: string[] = [];
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }, { id: OTHER, pack: 1 }]));
    const stage = new FakeStage(calls);
    stage.lost = true;
    const controls = new FakeControls(calls);
    const host = testHost({ match, view: new FakeView(calls, match), stage, controls });
    const screen = pitchScreen({ ...host, leave: () => {}, results: () => {}, page: fakePage(), graphicsMessage }, [menuLayer]);
    dom.document.body.append(fake(screen.el));
    expect([screen.graphics, [...match.reasons], controls.releases]).toEqual(['restoring', ['graphics'], 1]);
    match.clock.advance(LOST_MS);
    expect([screen.message, screen.graphics]).toEqual(['graphics', 'lost']);
    stage.lost = false;
    stage.onGraphics!('restored');
    expect([screen.message, screen.graphics, [...match.reasons]]).toEqual([null, 'ok', []]);
    screen.dispose();
  });

  it("leaves the stage's callback to a newer screen when an older one goes after it, as a role's rebuild does (§5.6)", () => {
    // Two screens over one stage, the newer made before the older goes, as the app's show() orders it.
    const calls: string[] = [];
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }]));
    match.kind = 'net';
    const stage = new FakeStage(calls);
    const make = (playing: boolean): PitchScreen => {
      const host = testHost({ match, view: new FakeView(calls, match), stage, controls: playing ? new FakeControls(calls) : null });
      return pitchScreen({ ...host, leave: () => {}, results: () => {}, page: fakePage(), graphicsMessage }, [menuLayer]);
    };
    const player = make(true);
    const spectator = make(false);
    player.dispose();
    expect(stage.onGraphics).not.toBeNull();
    stage.onGraphics!('lost');
    expect([player.graphics, spectator.graphics]).toEqual(['ok', 'restoring']);
    spectator.dispose();
    expect(stage.onGraphics).toBeNull();
  });

  it('never pauses a networked match, only releasing what is held, and hands the stage its callback back on dispose', async () => {
    const r = rig({ kind: 'net' });
    await r.stage.finish();
    r.stage.onGraphics!('lost');
    expect([r.screen.graphics, r.controls.releases]).toEqual(['restoring', 1]);
    // The fake records the reason; a networked Match's pause does nothing (src/ui/match.ts).
    r.screen.dispose();
    expect([r.stage.onGraphics, [...r.match.reasons]]).toEqual([null, []]);
    r.match.clock.advance(LOST_MS + 1);
    expect(r.screen.message).toBeNull();
  });
});

describe("a spectator's follow (D-28, L91)", () => {
  it("moves along the HUD's choice, the ball and each terrier by pack and spot, on the view key and the shoulders, round the ends", async () => {
    const calls: string[] = [];
    const two = stateWith(2, 100, [{ id: ME, pack: 0 }, { id: OTHER, pack: 1 }, { id: personId(7, 2), pack: 0 }]);
    const match = new StateMatch(personId(7, 9), two);
    const view = new FakeView(calls, match);
    const stage = new FakeStage(calls);
    const host = testHost({ match, view, stage, controls: null });
    const screen = pitchScreen({ ...host, results: (_e: ConfirmedEnd) => {} }, [hudLayer, menuLayer]);
    await stage.finish();
    screen.frame(16); // the HUD lists the drawn roster
    const followed = (): string | null => (view.mode.kind === 'spectator' ? view.mode.follow : 'player');
    expect(followed()).toBeNull(); // the ball's, from the start
    const order = [ME, personId(7, 2), OTHER, null];
    for (const want of order) {
      screen.ui(key('next'));
      expect(followed()).toBe(want);
    }
    screen.ui(key('prev', 'gamepad'));
    expect(followed()).toBe(OTHER);
    expect(host.told.at(-1)).toBe('setMode spectator');
    screen.ui({ ...key('next'), repeat: true }); // a held key's repeat moves nothing
    expect(followed()).toBe(OTHER);
    screen.dispose();
  });

  it("does nothing on a player's 'next', whose view the view control switches", async () => {
    const calls: string[] = [];
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }]));
    const view = new FakeView(calls, match);
    const stage = new FakeStage(calls);
    const host = testHost({ match, view, stage, controls: new FakeControls(calls) });
    const screen = pitchScreen({ ...host, results: () => {} }, [hudLayer, menuLayer]);
    await stage.finish();
    screen.frame(16);
    const before = view.mode;
    screen.ui(key('next'));
    expect(view.mode).toBe(before);
    screen.dispose();
  });
});

describe('the networked notes (§5.6, M4-Q39)', () => {
  /** A networked match over a set state, its refusal and its roster the test's. */
  class Refused extends StateMatch {
    refused: 'full' | 'started' | null = 'full';
    readonly played: number[] = [];

    override get session(): Session {
      return { ...super.session, inRoster: () => false } as unknown as Session;
    }

    override status(): ReturnType<StateMatch['status']> {
      return { ...super.status(), refused: this.refused };
    }

    override play(p?: Pack): void {
      if (p !== undefined) this.played.push(p);
      this.refused = null;
    }
  }

  it('has none in Practice, and on a networked page shows the watching notice and the offer while a JOIN is given up', () => {
    const calls: string[] = [];
    const practice = new StateMatch(ME, stateWith(1, 100, [{ id: OTHER, pack: 0 }]));
    const quiet = netLayer(testHost({ match: practice, view: new FakeView(calls, practice), stage: new FakeStage(calls), controls: null }));
    expect([quiet.el, quiet.inspect!()]).toEqual([null, { watching: false, offer: null }]);
    const net = new Refused(ME, stateWith(1, 100, [{ id: OTHER, pack: 0 }]));
    net.kind = 'net';
    const layer = netLayer(testHost({ match: net, view: new FakeView(calls, net), stage: new FakeStage(calls), controls: null }));
    dom.document.body.append(fake(layer.el!));
    const el = fake(layer.el!);
    expect([el.shown, el.getAttribute('role'), layer.inspect!()]).toEqual([true, 'status', { watching: true, offer: 1 }]);
    // A place in the other pack: the notice says so, never that the match is full (§5.6).
    expect(el.textContent).toBe(`${OFFER_TEXT}Play in the Orange pack`);
    expect(el.textContent).not.toContain('full,');
    only(el, 'button[data-test="play-other"]').click();
    expect(net.played).toEqual([1]);
    layer.run!({} as PitchContext);
    expect([el.shown, layer.inspect!()]).toEqual([false, { watching: false, offer: null }]);
    // A started match: watching, nothing offered.
    net.refused = 'started';
    net.state = { ...net.state, phase: IN_PLAY } as MatchState;
    layer.run!({} as PitchContext);
    expect([el.shown, layer.inspect!(), only(el, 'button[data-test="play-other"]').shown]).toEqual([true, { watching: true, offer: null }, false]);
    // No place to offer: the match is full, and the notice says so.
    expect(shownText(el)).toBe(WATCHING_TEXT);
  });

  it("keeps the notice inside the safe area, below the sound's prompt and the HUD's graphics note while either shows (§5.13, D-32)", () => {
    const css = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');
    const net = css('../layers/net.css');
    /** A one-line note's bottom, as index.html's body sets lines (16px/1.5): its top, line, padding and border. */
    const bottom = (d: Readonly<Record<string, string>>): number =>
      cssLength(d.top, 360) + cssLength(d['font-size'] ?? '16px', 360) * 1.5 + 2 * cssLength(d.padding!.split(' ')[0], 360) + 2 * cssLength(d.border!.split(' ')[0], 360);
    const prompt = cssDeclarations(css('../layers/sound.css'), '.sound-prompt');
    const note = cssDeclarations(css('../hud.css'), '.hud-graphics');
    const notes = cssDeclarations(net, '.net-notes');
    const top = (selector: string): number => cssLength(cssDeclarations(net, selector).top, 360);
    expect(top('.net-notes')).toBe(cssLength(prompt.top, 360)); // where the prompt is: moved only while it shows
    expect(top('.pitch-screen:has(> .sound-prompt:not([hidden])) > .net-notes')).toBeGreaterThanOrEqual(bottom(prompt));
    expect(top('.pitch-screen:has(.hud-graphics:not([hidden])) > .net-notes')).toBeGreaterThanOrEqual(bottom({ ...note, border: '1px' }));
    // The note's rule comes later, so it wins when both show.
    expect(net.indexOf('.pitch-screen:has(.hud-graphics')).toBeGreaterThan(net.indexOf('.pitch-screen:has(> .sound-prompt'));
    // Inside the safe area, the HUD's own insets, each 0 at the gate's sizes.
    expect(notes.left).toContain('env(safe-area-inset-left, 0px)');
    expect(notes.top).toContain('env(safe-area-inset-top, 0px)');
  });
});
