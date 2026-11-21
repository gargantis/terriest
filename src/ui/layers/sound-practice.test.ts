import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioOut } from '../../audio/audio';
import { FakeAudioDocument, FakeAudioWindow, settle } from '../../audio/audio-testing';
import { personId } from '../../core/bot/bot-id';
import { BarkTracker, type ConfirmedEnd } from '../../core/session/index';
import { findTerrier, IN_PLAY, START_COUNTDOWN } from '../../core/sim/index';
import { TEST_BUILD } from '../../core/timeline/testing';
import { PLACEHOLDER_LOOK } from '../../render/look';
import { MatchView } from '../../render/view';
import { FakeClock, fakePage } from '../clock-testing';
import { fake, type FakeDocument, installDom } from '../dom-testing';
import type { CueKind } from '../inspect';
import { practiceMatch } from '../match';
import { FakeControls, FakeStage, testHost } from '../pitch-testing';
import { pitchScreen } from '../screens/pitch';
import { focusScreen } from '../screens/screen';
import { soundLayer } from './sound';

// The sound through a real Practice in virtual time (M4's design §5.4, §7;
// PLAN §13, D-14, D-16, D-32, Q-15): M3's PracticeGame on its timer, the
// real MatchView and BarkTracker, the pitch screen and the sound's layer on
// a fake context, a passive person against one bot, through the whole match
// to the confirmed end: the kickoff whistle at each play's start, the
// start's and each goal's kickoff; each confirmed goal's whistle and
// chorus once; the end whistle once, as Results come; the host's own bot's
// barks, from the inputs it recorded; yours at the press; and the menu
// pausing the sound with play. A whole match, so a file of its own (§16).

vi.setConfig({ testTimeout: 60_000 });

const ME = personId(7, 0);

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

describe('the sound over Practice (§7)', () => {
  it('whistles each kickoff, goal and the end once, and plays the bot\'s barks, yours, and nothing while paused', async () => {
    const clock = new FakeClock(1000);
    const match = practiceMatch({ me: ME, name: 'Ada', coat: 3, settings: { packSize: 1, matchMinutes: 1 }, build: TEST_BUILD, clock, page: fakePage() });
    const view = new MatchView(match, PLACEHOLDER_LOOK, () => ({ calmCamera: false, names: false }), new BarkTracker(ME));
    const calls: string[] = [];
    const stage = new FakeStage(calls);
    const ended: ConfirmedEnd[] = [];
    const win = new FakeAudioWindow({ state: 'suspended' });
    const out = new AudioOut(win, new FakeAudioDocument());
    const screen = pitchScreen({ ...testHost({ match, view, stage, controls: new FakeControls(calls) }), results: (e) => ended.push(e) }, [(h) => soundLayer(h, out)]);
    dom.document.body.append(fake(screen.el));
    await stage.finish();
    const decided = (kind: CueKind): number => out.inspect().decided[kind];
    const played = (kind: CueKind): number => out.inspect().played[kind];
    const t = (): typeof match.session.timeline => match.session.timeline;

    // Pre-match: the context waits for an input, so the prompt shows; a key starts it.
    screen.frame(clock.now());
    expect(out.inspect().prompt).toBe(true);
    win.fire('keydown');
    await settle();
    screen.frame(clock.now());
    expect([out.state, out.inspect().prompt]).toEqual(['running', false]);
    clock.until(() => findTerrier(t().final, ME) >= 0, 1000);
    focusScreen(screen);
    screen.ui({ kind: 'press', pressedAt: clock.now(), source: 'keyboard', repeat: false }); // Ready
    clock.until(() => t().head.phase === START_COUNTDOWN, 1000);
    expect(decided('whistleKickoff')).toBe(0);
    clock.until(() => t().head.phase === IN_PLAY, 6000);
    expect([decided('whistleKickoff'), played('whistleKickoff')]).toEqual([1, 1]);

    // Your bark at the press, as the controls tell the screen. The bot's barks may have come already.
    const barks = decided('bark');
    expect(played('bark')).toBe(barks);
    screen.ownBark(t().localTick + 2);
    expect([decided('bark'), played('bark')]).toEqual([barks + 1, barks + 1]);

    // The menu pauses Practice, and the sound with it: the context suspended, and nothing scheduled
    // while it's open, the page drawing on.
    screen.ui({ kind: 'menu', pressedAt: clock.now(), source: 'keyboard', repeat: false });
    screen.frame(clock.now());
    expect([match.paused, out.paused]).toEqual([true, true]);
    await settle();
    expect(out.state).toBe('waiting');
    const before = { ...out.inspect().played };
    const made = win.context.sources.length;
    for (let k = 0; k < 60; k++) {
      clock.advance(16);
      screen.frame(clock.now());
    }
    expect([out.inspect().played, win.context.sources.length, out.inspect().prompt]).toEqual([before, made, false]);
    screen.ui({ kind: 'menu', pressedAt: clock.now(), source: 'keyboard', repeat: false }); // closed again
    clock.advance(20);
    expect(out.paused).toBe(false);
    await settle();
    expect(out.state).toBe('running');

    // To the confirmed end, a frame drawn every 16 ms as the page would, each play's start in the head
    // noted as it shows.
    const starts = new Set<number>([t().head.phaseStart]);
    let drawn = clock.now();
    clock.until(() => {
      if (clock.now() - drawn >= 16) screen.frame((drawn = clock.now()));
      const H = t().head;
      if (H.phase === IN_PLAY) starts.add(H.phaseStart);
      return ended.length > 0;
    }, 240_000);
    expect(ended).toHaveLength(1);
    const goals = match.scoreboard.goals;
    expect(goals.length).toBeGreaterThan(0);
    expect([decided('whistleGoal'), decided('chorus')]).toEqual([goals.length, goals.length]);
    // Each play's start once, the first kickoff's and each goal's; and one end whistle, as Results came.
    expect(starts.size).toBeGreaterThan(goals.length - 1);
    expect(decided('whistleKickoff')).toBe(starts.size);
    expect([decided('whistleEnd'), played('whistleEnd')]).toEqual([1, 1]);
    // The bot barks on its own every few seconds (L327): found in the inputs this page recorded for it.
    expect(decided('bark')).toBeGreaterThan(barks + 1 + 5);
    // Bounces and pounces were heard too, the bot's play hitting the ball.
    expect(decided('thump')).toBeGreaterThan(0);
    const i = out.inspect();
    for (const k of Object.keys(i.decided) as CueKind[]) expect(i.played[k], k).toBeLessThanOrEqual(i.decided[k]);
    screen.dispose();
    match.close();
  });
});
