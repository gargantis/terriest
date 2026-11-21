// The Network figures on Results (M4's design, research/m4/DESIGN.md, §1.43,
// §5.9, §5.14; M3-Q24; PLAN §17's M5 logging; M3's design §1.16, §9.4): the
// match summary a normal page keeps, shown and copied, so M5's runs can log
// each peer's from a normal page: the late inputs against the inputs
// received, the rollbacks, the resyncs, and the corrections' sizes, p50,
// p95 and max over those that moved each body, a repair's apart. Practice
// shows its own: its lone timeline takes no input from another browser, so
// it has no late input, resync or repair to show. The sizes are a table
// with headers (§5.14). Copy puts the same figures on the clipboard as
// plain lines; a refused write, or a page with no clipboard, says
// "Couldn't copy: select the figures instead" and selects them, so the
// player copies them by hand. It's never a page error: the refusal is
// caught and shown, and nothing is logged (§0, §9.1). summaryPanel takes
// the summary alone, not §1.43's TimelineStats beside it, since the summary
// holds every figure it shows, and gives back Copy's button with the panel
// for Results' nav. New at M4.

import type { CorrectionFigures, MatchNetSummary, Quantiles } from '../../core/session/index';
import { h, setText } from '../dom';
import { addStyle } from '../style';
import css from './readout.css?inline';

/** One figure: its label, its value as shown, and its data-test. */
export interface ReadoutLine {
  readonly label: string;
  readonly value: string;
  readonly test: string;
}

/** One body's correction sizes, as shown: how many of the corrections moved it, then p50, p95 and max
 *  over those. */
export interface SizeLine {
  readonly label: string;
  readonly moved: string;
  readonly p50: string;
  readonly p95: string;
  readonly max: string;
}

export const COPIED = 'Copied.';
export const COPY_REFUSED = 'Couldn’t copy: select the figures instead';
export const SIZES_CAPTION = 'Correction sizes outside repairs';
export const REPAIR_SIZES_CAPTION = 'Correction sizes in repairs';

/** A figure to 3 significant digits, as M3's correction report writes them ("0.217", "56.3"); 0 as "0",
 *  anything under a thousandth as "< 0.001", and a thousand or more whole. */
export function figure(v: number): string {
  if (v === 0) return '0';
  if (v < 0.001) return '< 0.001';
  if (v >= 999.5) return String(Math.round(v));
  return v.toPrecision(3);
}

/** n's share of `of` as a percentage, to 3 significant digits; '' when there's nothing to share. */
export function share(n: number, of: number): string {
  return of > 0 ? `${figure((100 * n) / of)}%` : '';
}

/** n, and its share of `of` when there is one: "12 (0.167%)". */
const counted = (n: number, of: number): string => {
  const s = share(n, of);
  return s === '' ? String(n) : `${n} (${s})`;
};

/** The figures above the sizes (M3-Q24): the final ticks taken; the inputs received and those that came
 *  late, each against them, networked only; the rollbacks; the resyncs, networked only; and the
 *  corrections, every one, with a repair's counted apart, networked only. */
export function readoutLines(s: MatchNetSummary, practice: boolean): ReadoutLine[] {
  const lines: ReadoutLine[] = [{ label: 'Final ticks', value: String(s.ticks), test: 'ticks' }];
  if (!practice) {
    lines.push(
      { label: 'Inputs received', value: String(s.remoteInputs), test: 'inputs' },
      { label: 'Late inputs', value: counted(s.late, s.remoteInputs), test: 'late' },
      { label: 'Finalised absent, then arrived', value: counted(s.lateAbsent, s.remoteInputs), test: 'late-absent' },
    );
  }
  lines.push({ label: 'Rollbacks', value: String(s.rollbacks), test: 'rollbacks' });
  if (!practice) {
    const failed = s.resyncFailed > 0 ? `, ${s.resyncFailed} failed` : '';
    lines.push({ label: 'Resyncs', value: `${s.resyncs}${failed}`, test: 'resyncs' });
  }
  lines.push({ label: 'Corrections', value: String(s.corrections), test: 'corrections' });
  if (!practice) lines.push({ label: 'Corrections in repairs', value: String(s.repair.count), test: 'repairs' });
  return lines;
}

/** Each body's sizes (M3's design §9.4): the ball's in 3D, the other terriers' positions, this browser's
 *  player's terrier's, and the other terriers' headings. */
export function sizeLines(f: CorrectionFigures): SizeLine[] {
  const line = (label: string, q: Quantiles): SizeLine => ({
    label, moved: `${q.count - q.zero} of ${q.count}`, p50: figure(q.p50), p95: figure(q.p95), max: figure(q.max),
  });
  return [
    line('Ball (m)', f.ball), line('Other terriers (m)', f.remote), line('Your terrier (m)', f.own), line('Other terriers’ headings (°)', f.headings),
  ];
}

/** What Copy writes: the same figures, a line each, a repair's sizes only where there were any. */
export function readoutText(s: MatchNetSummary, practice: boolean): string {
  const sizes = (caption: string, f: CorrectionFigures): string[] => [
    `${caption}, moved and p50 / p95 / max of those moved:`,
    ...sizeLines(f).map((z) => `${z.label}: ${z.moved} moved, ${z.p50} / ${z.p95} / ${z.max}`),
  ];
  return [
    `terriest network figures: ${practice ? 'Practice' : 'a match with others'}`,
    ...readoutLines(s, practice).map((l) => `${l.label}: ${l.value}`),
    ...sizes(SIZES_CAPTION, s),
    ...(practice || s.repair.count === 0 ? [] : sizes(REPAIR_SIZES_CAPTION, s.repair)),
  ].join('\n');
}

/** Where Copy writes, and how it selects the figures when it can't. */
export interface CopyEnv {
  /** The clipboard's writeText: it rejects, or throws, where the page may not write. */
  write(text: string): Promise<void>;
  /** Selects el's text in the page, so the player can copy it by hand; false where it can't. */
  select(el: HTMLElement): boolean;
}

/** The page's: navigator.clipboard, which a page without one lacks, and the document's selection. */
export const browserCopy: CopyEnv = {
  write: (text) => {
    const clipboard: Clipboard | undefined = globalThis.navigator?.clipboard;
    return clipboard === undefined ? Promise.reject(new Error('no clipboard')) : clipboard.writeText(text);
  },
  select: (el) => {
    try {
      const doc = el.ownerDocument;
      const selection = doc.getSelection();
      if (selection === null) return false;
      const range = doc.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch {
      return false;
    }
  },
};

export type CopyState = 'idle' | 'copying' | 'copied' | 'refused';

export interface ReadoutPanel {
  readonly el: HTMLElement;
  /** Copy: Results' nav holds it beside Play again and Home (Q-17). */
  readonly copy: HTMLButtonElement;
  /** The last Copy's outcome, which its status says and the panel's data-copy reads. */
  readonly state: CopyState;
}

/** The Network figures, with Copy. */
export function summaryPanel(s: MatchNetSummary, o: { readonly practice: boolean; readonly env?: CopyEnv }): ReadoutPanel {
  addStyle(css);
  const env = o.env ?? browserCopy;
  const text = readoutText(s, o.practice);
  const sizeTable = (caption: string, test: string, f: CorrectionFigures): HTMLElement =>
    h('table', { class: 'readout-sizes', 'data-test': test },
      h('caption', {}, caption),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Body'), h('th', { scope: 'col', class: 'num' }, 'Moved'),
        h('th', { scope: 'col', class: 'num' }, 'p50'), h('th', { scope: 'col', class: 'num' }, 'p95'), h('th', { scope: 'col', class: 'num' }, 'Max'))),
      h('tbody', {}, ...sizeLines(f).map((z) => h('tr', {},
        h('th', { scope: 'row' }, z.label), h('td', { class: 'num' }, z.moved),
        h('td', { class: 'num' }, z.p50), h('td', { class: 'num' }, z.p95), h('td', { class: 'num' }, z.max)))));
  const figures = h('div', { class: 'readout-figures', 'data-test': 'readout-figures' },
    h('dl', {}, ...readoutLines(s, o.practice).flatMap((l) => [h('dt', {}, l.label), h('dd', { 'data-test': `readout-${l.test}` }, l.value)])),
    sizeTable(SIZES_CAPTION, 'readout-sizes', s),
    o.practice || s.repair.count === 0 ? null : sizeTable(REPAIR_SIZES_CAPTION, 'readout-repair-sizes', s.repair));
  const status = h('p', { class: 'readout-status', role: 'status', 'data-test': 'copy-status' });
  const copy = h('button', { type: 'button', class: 'secondary', 'data-test': 'copy-figures', onclick: () => void copyFigures() }, 'Copy');
  const el = h('section', { class: 'readout', 'aria-labelledby': 'readout-title', 'data-test': 'readout', 'data-copy': 'idle' },
    h('h2', { id: 'readout-title' }, 'Network figures'),
    o.practice ? h('p', { class: 'muted small' }, 'Practice’s own: its bots play in this browser, so no input comes late and nothing resyncs.') : null,
    figures,
    h('div', { class: 'row' }, copy, status));

  let state: CopyState = 'idle';
  const set = (next: CopyState, said: string): void => {
    state = next;
    el.setAttribute('data-copy', next);
    setText(status, said);
  };

  /** Copy's press: the figures on the clipboard, or, refused, selected for the player, and said either way. */
  async function copyFigures(): Promise<void> {
    if (state === 'copying') return;
    set('copying', '');
    let copied = true;
    try {
      await env.write(text);
    } catch {
      copied = false;
    }
    if (copied) {
      set('copied', COPIED);
      return;
    }
    try {
      env.select(figures);
    } catch {
      // Nothing selected: the message still says what to do.
    }
    set('refused', COPY_REFUSED);
  }

  return {
    el,
    copy,
    get state(): CopyState {
      return state;
    },
  };
}
