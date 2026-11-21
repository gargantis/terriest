import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, type FakeDocument, installDom, only, shownText } from '../dom-testing';
import {
  browserCopy, COPIED, COPY_REFUSED, figure, readoutLines, readoutText, REPAIR_SIZES_CAPTION, share, SIZES_CAPTION, sizeLines, summaryPanel,
} from './readout';
import { FakeCopy, quantiles, summaryOf } from './readout-testing';

// The Network figures on Results (M4's design §1.43, §5.9, §5.14, §9.1,
// §9.2; M3-Q24; M3's design §1.16, §9.4): each figure to 3 significant
// digits and each share as a percentage; a match with others' late inputs
// against the inputs received, its rollbacks, resyncs and corrections, a
// repair's apart; Practice's own, with none of those; each body's sizes;
// the same figures as Copy's lines; the panel, its sizes a table with
// headers; and Copy: the figures written and said so, or, refused, the
// figures selected and "Couldn't copy: select the figures instead" said,
// never a page error; and the page's own clipboard and selection.

const s = summaryOf({
  ticks: 3600, remoteInputs: 7200, late: 12, lateAbsent: 1, rollbacks: 40, corrections: 31, resyncs: 2, resyncFailed: 1,
  ball: quantiles(30, 2, 0.0123, 0.217, 1.2), remote: quantiles(60, 10, 0.0694, 0.25, 3), own: quantiles(30, 30, 0, 0, 0),
  headings: quantiles(60, 5, 2.5, 56.3, 120),
  repair: { count: 1, ball: quantiles(1, 0, 0.5, 0.5, 0.5), remote: quantiles(2, 1, 0.75, 0.75, 0.75), own: quantiles(1, 1, 0, 0, 0), headings: quantiles(2, 0, 10, 12, 12) },
});

describe("the figures' text (M3-Q24)", () => {
  it('writes each figure to 3 significant digits, as the correction report does, and each share as a percentage', () => {
    expect([0, 0.0004, 0.001, 0.0123456, 0.217, 1.2, 56.3, 999.4, 999.5, 1234.5].map(figure)).toEqual([
      '0', '< 0.001', '0.00100', '0.0123', '0.217', '1.20', '56.3', '999', '1000', '1235',
    ]);
    expect([share(12, 7200), share(0, 7200), share(3, 0)]).toEqual(['0.167%', '0%', '']);
  });

  it("lists a match with others' late inputs against the inputs received, its rollbacks, its resyncs and its corrections, a repair's apart", () => {
    expect(readoutLines(s, false).map((l) => `${l.label}: ${l.value}`)).toEqual([
      'Final ticks: 3600', 'Inputs received: 7200', 'Late inputs: 12 (0.167%)', 'Finalised absent, then arrived: 1 (0.0139%)', 'Rollbacks: 40',
      'Resyncs: 2, 1 failed', 'Corrections: 31', 'Corrections in repairs: 1',
    ]);
    // None received, a spectator's alone in a room: no share; and no failed resync to say.
    expect(readoutLines({ ...s, remoteInputs: 0, late: 0, lateAbsent: 0, resyncFailed: 0 }, false).map((l) => l.value)).toEqual([
      '3600', '0', '0', '0', '40', '2', '31', '1',
    ]);
  });

  it("lists Practice's own, with no late input, resync or repair, which its lone timeline never has", () => {
    expect(readoutLines(s, true).map((l) => `${l.label}: ${l.value}`)).toEqual(['Final ticks: 3600', 'Rollbacks: 40', 'Corrections: 31']);
  });

  it("gives each body's sizes: how many corrections moved it, then p50, p95 and max of those that did", () => {
    expect(sizeLines(s)).toEqual([
      { label: 'Ball (m)', moved: '28 of 30', p50: '0.0123', p95: '0.217', max: '1.20' },
      { label: 'Other terriers (m)', moved: '50 of 60', p50: '0.0694', p95: '0.250', max: '3.00' },
      { label: 'Your terrier (m)', moved: '0 of 30', p50: '0', p95: '0', max: '0' },
      { label: 'Other terriers’ headings (°)', moved: '55 of 60', p50: '2.50', p95: '56.3', max: '120' },
    ]);
  });

  it("copies the same figures as lines, a repair's sizes only in a match with others that had one", () => {
    const lines = readoutText(s, false).split('\n');
    expect(lines.slice(0, 9)).toEqual(['terriest network figures: a match with others', ...readoutLines(s, false).map((l) => `${l.label}: ${l.value}`)]);
    expect(lines.slice(9)).toEqual([
      `${SIZES_CAPTION}, moved and p50 / p95 / max of those moved:`,
      'Ball (m): 28 of 30 moved, 0.0123 / 0.217 / 1.20',
      'Other terriers (m): 50 of 60 moved, 0.0694 / 0.250 / 3.00',
      'Your terrier (m): 0 of 30 moved, 0 / 0 / 0',
      'Other terriers’ headings (°): 55 of 60 moved, 2.50 / 56.3 / 120',
      `${REPAIR_SIZES_CAPTION}, moved and p50 / p95 / max of those moved:`,
      'Ball (m): 1 of 1 moved, 0.500 / 0.500 / 0.500',
      'Other terriers (m): 1 of 2 moved, 0.750 / 0.750 / 0.750',
      'Your terrier (m): 0 of 1 moved, 0 / 0 / 0',
      'Other terriers’ headings (°): 2 of 2 moved, 10.0 / 12.0 / 12.0',
    ]);
    expect(readoutText({ ...s, repair: { ...s.repair, count: 0 } }, false).split('\n').length).toBe(1 + 8 + 5);
    const practice = readoutText(s, true).split('\n');
    expect([practice[0], practice.length]).toEqual(['terriest network figures: Practice', 1 + 3 + 5]);
  });
});

describe('the Network figures panel and Copy (§5.9, §5.14, §9.1)', () => {
  let dom: { readonly document: FakeDocument; restore(): void };
  beforeEach(() => {
    dom = installDom();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    dom.restore();
  });
  /** The clipboard's promise and the panel's own, settled. */
  const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

  function panel(practice = false, copy = new FakeCopy()): { p: ReturnType<typeof summaryPanel>; copy: FakeCopy; el: ReturnType<typeof fake> } {
    const p = summaryPanel(s, { practice, env: copy });
    dom.document.body.append(fake(p.el));
    return { p, copy, el: fake(p.el) };
  }

  it("heads the figures, lists the counts, and puts the sizes in tables with headers, a repair's apart (§5.14)", () => {
    const { el } = panel();
    expect([el.getAttribute('data-test'), el.getAttribute('aria-labelledby'), only(el, 'h2').id, only(el, 'h2').textContent]).toEqual([
      'readout', 'readout-title', 'readout-title', 'Network figures',
    ]);
    expect(el.querySelectorAll('dt').map((d) => d.textContent)).toEqual(readoutLines(s, false).map((l) => l.label));
    expect(el.querySelectorAll('dd').map((d) => d.textContent)).toEqual(readoutLines(s, false).map((l) => l.value));
    for (const [test, caption, f] of [['readout-sizes', SIZES_CAPTION, s], ['readout-repair-sizes', REPAIR_SIZES_CAPTION, s.repair]] as const) {
      const table = only(el, `table[data-test="${test}"]`);
      expect(only(table, 'caption').textContent).toBe(caption);
      expect(table.querySelectorAll('th[scope="col"]').map((th) => th.textContent)).toEqual(['Body', 'Moved', 'p50', 'p95', 'Max']);
      expect(only(table, 'tbody').children.map((tr) => tr.children.map((c) => c.textContent))).toEqual(
        sizeLines(f).map((z) => [z.label, z.moved, z.p50, z.p95, z.max]),
      );
      expect(only(table, 'tbody').querySelectorAll('th').map((th) => th.getAttribute('scope'))).toEqual(['row', 'row', 'row', 'row']);
    }
    expect([only(el, 'button[data-test="copy-figures"]').textContent, el.getAttribute('data-copy')]).toEqual(['Copy', 'idle']);
    // Practice's says whose they are, and has no repair's table.
    const practice = panel(true);
    expect(shownText(practice.el)).toContain('Practice’s own: its bots play in this browser, so no input comes late and nothing resyncs.');
    expect(practice.el.querySelectorAll('table').length).toBe(1);
  });

  it('copies the figures, saying so', async () => {
    const { p, copy, el } = panel();
    p.copy.click();
    await flush();
    expect(copy.written).toEqual([readoutText(s, false)]);
    const status = only(el, '[data-test="copy-status"]');
    expect([status.textContent, status.getAttribute('role'), el.getAttribute('data-copy'), p.state, copy.selected]).toEqual([COPIED, 'status', 'copied', 'copied', []]);
  });

  it("selects the figures when the clipboard refuses, saying Couldn't copy: select the figures instead, and is never a page error", async () => {
    const said = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => {
      unhandled.push(e);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      for (const answer of ['reject', 'throw'] as const) {
        const copy = new FakeCopy();
        copy.answer = answer;
        const { p, el } = panel(false, copy);
        p.copy.click();
        await flush();
        expect([only(el, '[data-test="copy-status"]').textContent, el.getAttribute('data-copy'), p.state], answer).toEqual([COPY_REFUSED, 'refused', 'refused']);
        expect(copy.selected, answer).toEqual([only(el, '[data-test="readout-figures"]')]);
      }
      expect(COPY_REFUSED).toBe('Couldn’t copy: select the figures instead');
      // Nothing selectable either: it still says what to do.
      const copy = new FakeCopy();
      copy.answer = 'reject';
      copy.selects = false;
      const { p } = panel(false, copy);
      p.copy.click();
      await flush();
      expect(p.state).toBe('refused');
      await flush();
      expect([...said.map((spy) => spy.mock.calls), unhandled]).toEqual([[], [], []]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('writes once while a write is on its way, and copies again after it', async () => {
    const copy = new FakeCopy();
    copy.hold = true;
    const { p, el } = panel(false, copy);
    p.copy.click();
    p.copy.click();
    expect([copy.written.length, el.getAttribute('data-copy'), only(el, '[data-test="copy-status"]').textContent]).toEqual([1, 'copying', '']);
    copy.settle();
    await flush();
    expect(p.state).toBe('copied');
    copy.hold = false;
    copy.answer = 'reject';
    p.copy.click();
    await flush();
    expect([copy.written.length, p.state]).toEqual([2, 'refused']);
  });
});

describe("the page's clipboard and selection (§5.9)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes through navigator.clipboard, and where the page has none refuses by rejecting, never by throwing', async () => {
    const written: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: (t: string) => (written.push(t), Promise.resolve()) } });
    await browserCopy.write('the figures');
    expect(written).toEqual(['the figures']);
    vi.stubGlobal('navigator', {});
    let refused: Promise<void> | null = null;
    expect(() => (refused = browserCopy.write('the figures'))).not.toThrow();
    await expect(refused).rejects.toThrow('no clipboard');
  });

  it("selects an element's contents through its document's selection, and says false where it can't", () => {
    const calls: string[] = [];
    const figures = {} as HTMLElement;
    const range = { selectNodeContents: (n: unknown) => calls.push(n === figures ? 'the figures in a range' : 'another range') };
    const selection = { removeAllRanges: () => calls.push('the old selection gone'), addRange: (r: unknown) => calls.push(r === range ? 'the range selected' : '?') };
    Object.assign(figures, { ownerDocument: { getSelection: () => selection, createRange: () => range } });
    expect(browserCopy.select(figures)).toBe(true);
    expect(calls).toEqual(['the figures in a range', 'the old selection gone', 'the range selected']);
    expect(browserCopy.select({ ownerDocument: { getSelection: () => null, createRange: () => range } } as unknown as HTMLElement)).toBe(false);
    expect(browserCopy.select({ ownerDocument: {} } as unknown as HTMLElement)).toBe(false); // no selection at all: caught
  });
});
