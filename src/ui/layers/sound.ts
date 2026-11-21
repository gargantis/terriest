// The sound's layer (PLAN §13, D-14, D-16, D-32, Q-15; M4's design,
// research/m4/DESIGN.md, §1.27, §1.29, §1.38, §1.63, §5.8, §7, §12's
// extension points), named 'sound', over the pitch on Pre-match and Match:
// - after each timer run, the cues SoundCues decides, played on the page's
//   AudioOut: from the predicted head; from the scoreboard's changes, each
//   goal latched since the last run and the end once it's confirmed (D-14);
//   and from PitchContext.barks, the barks MatchView.run found in received
//   and recorded inputs (D-16). Another timeline, a merge's or a rejoin's,
//   resets the cues, so nothing replays from its adopted state (§7); and
//   what the scoreboard latched before the layer was made, while a joiner
//   read Join or before a role's new pitch screen, has had its whistle, or
//   came before this page could hear it, so none is blown again;
// - your own bark at the press, from Layer.ownBark, as the drawing shows it;
// - Settings' sound through SettingsSource.subscribe, and Practice's pause
//   (Q-15), on the AudioOut, each frame and each run;
// - "Press a key or tap for sound", on an opaque backing, while sound is on
//   and the context waits for a key or a tap (D-32), reported as the hook's
//   audio.prompt; a gamepad press may not start the context, and without Web
//   Audio there's no prompt.
// audioOut() is the page's one AudioOut, made by its first call, which the
// app makes at start-up (soundFollows), never by this module's import: a
// module's top-level code runs even where boot.js's checks fail, and
// CLAUDE.md's "sideEffects": false says what must run at start-up is called.
// Its inspect() is the hook's audio on every screen (§1.40). New at M4: the
// slice's empty slot (1c), filled by phase 2's sound builder.

import { AudioOut, type AudioDocument, type AudioWindow } from '../../audio/audio';
import { SoundCues } from '../../audio/cues';
import type { Cue } from '../../audio/synth';
import { config } from '../../config';
import type { ConfirmedEnd, ConfirmedGoal } from '../../core/session/index';
import type { SettingsSource } from '../../storage/schema';
import { h, setShown } from '../dom';
import type { Layer, LayerFactory, PitchContext, PitchHost } from '../layer';
import { addStyle } from '../style';
import css from './sound.css?inline';

const NO_GOALS: readonly ConfirmedGoal[] = Object.freeze([]);

/** Where there's no window, as in Node: no Web Audio, so state 'none'. */
const NO_WINDOW: AudioWindow = { addEventListener: () => {} };
const NO_DOCUMENT: AudioDocument = { visibilityState: 'hidden', addEventListener: () => {} };

let page: AudioOut | null = null;

/** The page's one AudioOut (D-32), made by the first call: the app's, at start-up. */
export function audioOut(): AudioOut {
  page ??= typeof window === 'undefined' || typeof document === 'undefined' ? new AudioOut(NO_WINDOW, NO_DOCUMENT) : new AudioOut(window, document);
  return page;
}

/** Settings' sound on the page's AudioOut, now and at each change, on every screen; returns its removal. The
 *  app calls it once at start-up, which makes the AudioOut then, so a key or a click on Home already starts
 *  its context. */
export function soundFollows(settings: SettingsSource, out: AudioOut = audioOut()): () => void {
  out.setEnabled(settings.get().sound);
  return settings.subscribe((s) => out.setEnabled(s.sound));
}

/** The prompt's words (D-32). */
export const SOUND_PROMPT = 'Press a key or tap for sound';

/** layers.sound in the hook (§1.40). */
export interface SoundInspection {
  readonly prompt: boolean;
}

export function soundLayer(host: PitchHost, out: AudioOut = audioOut()): Layer {
  addStyle(css);
  const match = host.match;
  const cues = new SoundCues(match.me, config.soundShiftTicksMax);
  const prompt = h('p', { class: 'sound-prompt', role: 'status', 'data-test': 'sound-prompt', hidden: true }, SOUND_PROMPT);

  let disposed = false;
  /** The timeline last seen, and its ID: another resets the cues. */
  let timeline: object | null = null;
  let timelineId = '';
  /** The scoreboard's goals' ticks at the last run, and its end: what's latched since is new, and what it
   *  held as the layer was made is not, so Watch on Join, or a role's new pitch screen, whistles none of
   *  it again (§7). */
  let goalTicks: number[] = match.scoreboard.goals.map((g) => g.tick);
  let end: ConfirmedEnd | null = match.scoreboard.end;

  const play = (list: readonly Cue[]): void => {
    for (const c of list) out.play(c);
  };

  /** Practice's pause, then the prompt: shown while sound is on and the context waits for an input. */
  const update = (): void => {
    if (disposed) return;
    out.setPaused(match.paused);
    const shown = out.enabled && out.waitsForInput;
    setShown(prompt, shown);
    out.setPrompt(shown);
  };

  /** The goals latched since the last run, in the scoreboard's order; null for none. */
  const goalsAdded = (): ConfirmedGoal[] | null => {
    const goals = match.scoreboard.goals;
    let same = goals.length === goalTicks.length;
    for (let k = 0; same && k < goals.length; k++) same = goals[k]!.tick === goalTicks[k];
    if (same) return null;
    const added = goals.filter((g) => !goalTicks.includes(g.tick));
    goalTicks = goals.map((g) => g.tick);
    return added;
  };

  const unsubscribe = host.settings.subscribe((s) => {
    out.setEnabled(s.sound);
    update();
  });
  out.setEnabled(host.settings.get().sound);
  update();

  return {
    name: 'sound',
    el: prompt,
    run(ctx: PitchContext): void {
      if (disposed) return;
      // The pause first, so a cue a paused run decides is counted but never scheduled.
      update();
      const t = match.session.timeline;
      if (t !== timeline || t.id !== timelineId) {
        if (timeline !== null) cues.reset();
        timeline = t;
        timelineId = t.id;
      }
      if (t.started) play(cues.fromHead(t.head));
      // The end as it arrives, not as it stands: one a rejoin's timeline keeps, its cues reset, isn't new.
      const e = match.scoreboard.end;
      play(cues.fromScore(goalsAdded() ?? NO_GOALS, e !== null && e !== end));
      end = e;
      play(cues.fromBarks(ctx.barks));
    },
    frame(): void {
      update();
    },
    ownBark(tick: number): void {
      if (disposed) return;
      play(cues.fromBarks([{ id: match.me, tick, own: true }]));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      // The page's sound outlives the screen: never left paused, nor with a prompt nobody shows.
      out.setPaused(false);
      out.setPrompt(false);
    },
    inspect: (): SoundInspection => ({ prompt: !prompt.hidden }),
  };
}

/** The sound's layer: src/ui/layers/index.ts composes it after the devices'. */
export const LAYERS: readonly LayerFactory[] = [(host) => soundLayer(host)];
