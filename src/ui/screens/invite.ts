// The link and the code to share (M4's design, research/m4/DESIGN.md,
// §1.43, §5.5, §5.7, §5.14; PLAN §11, L163, L190, C-15), on Created and
// behind Pre-match's Invite, so anyone in a match can bring more players:
// the link, this page's address with the match ID in its fragment, which
// never reaches a server, with Copy link and, where navigator.share exists,
// Share…; the code in groups of four (C-15), with Copy code. A refused
// clipboard write, which a browser may give any page, is caught and said,
// and what it was to copy selected for copying by hand; a share the player
// cancels is quiet: neither is ever a page error (§0's guard). The outcome
// is also the panel's data-copied, for the specs. roslambo's invitePanel,
// with those changes. New at M4.

import { formatMatchId, joinLink } from '../../core/match-id';
import { h, setText } from '../dom';
import { addStyle } from '../style';
import css from './invite.css?inline';

export interface InviteOptions {
  /** The page's address, whose fragment the link replaces: location.href by default. */
  readonly href?: string;
  /** navigator.clipboard by default; null for none, when Copy says so. */
  readonly clipboard?: Pick<Clipboard, 'writeText'> | null;
  /** navigator.share where it exists, by default; null for none, and then no Share…. */
  readonly share?: ((data: ShareData) => Promise<void>) | null;
}

/** What the panel says after a copy or its refusal. */
export const COPIED = { link: 'Link copied.', code: 'Code copied.' } as const;
export const NOT_COPIED = { link: 'Couldn’t copy: select the link instead.', code: 'Couldn’t copy: select the code instead.' } as const;

function pageNavigator(): Navigator | null {
  return typeof navigator === 'undefined' ? null : navigator;
}

function defaultClipboard(): Pick<Clipboard, 'writeText'> | null {
  return pageNavigator()?.clipboard ?? null;
}

function defaultShare(): ((data: ShareData) => Promise<void>) | null {
  const nav = pageNavigator();
  return nav !== null && typeof nav.share === 'function' ? (data) => nav.share(data) : null;
}

/** Selects an element's text, where the page can: the link's field by its own select(), the code by the
 *  window's selection, for copying by hand. */
function selectText(el: HTMLElement): void {
  const field = el as Partial<Pick<HTMLInputElement, 'select'>>;
  if (typeof field.select === 'function') {
    field.select();
    return;
  }
  el.ownerDocument.defaultView?.getSelection?.()?.selectAllChildren(el);
}

export function invitePanel(matchId: string, o: InviteOptions = {}): HTMLElement {
  addStyle(css);
  const link = joinLink(o.href ?? location.href, matchId);
  const code = formatMatchId(matchId);
  const clipboard = o.clipboard === undefined ? defaultClipboard() : o.clipboard;
  const share = o.share === undefined ? defaultShare() : o.share;

  const field = h('input', {
    type: 'text', readonly: true, value: link, spellcheck: 'false', 'data-test': 'invite-link',
    onfocus: () => selectText(field),
  });
  const codeText = h('p', { class: 'invite-code', 'data-test': 'invite-code' }, code);
  const said = h('p', { class: 'invite-said muted small', role: 'status', 'data-test': 'invite-said' });
  const panel = h('div', { class: 'invite', 'data-test': 'invite' });

  const copy = (what: 'link' | 'code', text: string, select: () => void): void => {
    const refused = (): void => {
      panel.setAttribute('data-copied', 'refused');
      setText(said, NOT_COPIED[what]);
      select();
    };
    if (clipboard === null) {
      refused();
      return;
    }
    let writing: Promise<void>;
    try {
      writing = clipboard.writeText(text);
    } catch {
      refused();
      return;
    }
    writing.then(() => {
      panel.setAttribute('data-copied', what);
      setText(said, COPIED[what]);
    }, refused);
  };

  const copyLink = h('button', { type: 'button', class: 'secondary', 'data-test': 'copy-link', onclick: () => copy('link', link, () => selectText(field)) }, 'Copy link');
  const copyCode = h('button', { type: 'button', class: 'secondary', 'data-test': 'copy-code', onclick: () => copy('code', code, () => selectText(codeText)) }, 'Copy code');
  const shareButton = share === null ? null : h('button', {
    type: 'button', class: 'secondary', 'data-test': 'share',
    onclick: () => {
      // A cancelled share rejects with an AbortError, and a refused one otherwise: quiet either way.
      try {
        share({ title: 'terriest', text: 'Join my terriest match', url: link }).catch(() => {});
      } catch {
        // A page that can't share now: nothing to say.
      }
    },
  }, 'Share…');

  panel.append(
    h('label', { class: 'field' }, h('span', {}, 'Link'), field),
    h('div', { class: 'invite-code-row' }, h('span', { class: 'muted small' }, 'Code'), codeText),
    h('div', { class: 'row' }, copyLink, shareButton, copyCode),
    said,
  );
  return panel;
}

/** The panel's buttons, in order, for a screen's nav (Q-17). */
export function inviteButtons(panel: HTMLElement): HTMLButtonElement[] {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>('button'));
}
