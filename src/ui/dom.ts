// The screens' element builder (M4's design, research/m4/DESIGN.md, §1.39,
// §5.14; PLAN D-30, L224): roslambo's src/ui/dom.ts, unchanged: h() makes
// an element whose text always goes in as text nodes, never as markup, so a
// name shows as typed (L224), and setText and setClass touch the DOM only
// on a change, so a frame's update costs nothing when nothing changed. New
// at M4: setEnabled, which marks a button that can't act yet aria-disabled
// with its reason as its label, never disabled, so it keeps the focus Q-17
// gives it and a screen reader hears why (§1.42); isEnabled, which the
// buttons' handlers and src/ui/nav.ts read; and cssColour, a look's colour
// as CSS.

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Sets text only when it changed, so per-frame updates cost nothing. */
export function setText(el: Element, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}

export function setClass(el: Element, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

/** Shows or hides an element by its hidden flag, writing only on a change. */
export function setShown(el: HTMLElement, on: boolean): void {
  if (el.hidden === on) el.hidden = !on;
}

/** A button that acts, reading its action, or one that can't act yet: aria-disabled, never disabled, so
 *  it keeps the focus, reading why ("Joining…"). text is what it reads either way (§1.42, §5.14). */
export function setEnabled(button: HTMLElement, on: boolean, text: string): void {
  setText(button, text);
  const marked = button.getAttribute('aria-disabled') === 'true';
  if (on && marked) button.removeAttribute('aria-disabled');
  else if (!on && !marked) button.setAttribute('aria-disabled', 'true');
}

/** Not marked aria-disabled by setEnabled: a click on a marked button, or the nav's press, does nothing. */
export function isEnabled(button: Pick<Element, 'getAttribute'>): boolean {
  return button.getAttribute('aria-disabled') !== 'true';
}

/** A look's colour, 0xRRGGBB, as CSS. */
export function cssColour(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}
