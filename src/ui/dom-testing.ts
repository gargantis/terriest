// Test support for the screens (M4's design, research/m4/DESIGN.md, §9.1,
// §9.2): a small DOM for Node, enough for src/ui/dom.ts's h() and the
// screens and layers built with it, so their tests run the real modules
// without a browser or a DOM library (M4 adds no dependency, §11). It keeps
// what the screens touch and the rules their behaviour rests on: an
// element's attributes, classes, style, hidden flag and text; the focus,
// which a hidden, detached or disabled element can't take, as in a
// browser, where Q-17's aria-disabled buttons keep it (§1.42); the
// window's scroll, each scrollTo and scrollIntoView recorded; and
// events dispatched through capture, target and bubble, with
// preventDefault and both stops, so src/ui/nav.ts's capture listeners act
// as they do on a page. Selectors are the simple ones the screens use: a
// tag, .class, [attr] and [attr="v"], compounded. And for the layout no
// Node test can draw, a stylesheet's declarations by selector and their
// lengths, so a test checks what the CSS asks of a box (cssDeclarations,
// cssLength); a browser confirms it. Only tests import it, so no build
// bundles it. New at M4.

export type Listener = (e: FakeEvent) => void;

interface Registered {
  readonly type: string;
  readonly fn: Listener;
  readonly capture: boolean;
}

/** An event as the screens read one. */
export class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly timeStamp: number;
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  immediateStopped = false;

  constructor(type: string, o: { bubbles?: boolean; cancelable?: boolean; timeStamp?: number } = {}) {
    this.type = type;
    this.bubbles = o.bubbles ?? false;
    this.cancelable = o.cancelable ?? false;
    this.timeStamp = o.timeStamp ?? 0;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }

  stopImmediatePropagation(): void {
    this.propagationStopped = true;
    this.immediateStopped = true;
  }
}

/** The top of the tree a node is in. */
function rootOf(node: FakeNode): FakeNode {
  let n = node;
  while (n.parentNode !== null) n = n.parentNode;
  return n;
}

/** What text and elements share: a place in the tree. */
export class FakeNode {
  parentNode: FakeElement | null = null;
  readonly ownerDocument: FakeDocument;
  protected readonly listeners: Registered[] = [];

  constructor(doc: FakeDocument) {
    this.ownerDocument = doc;
  }

  get textContent(): string {
    return '';
  }

  addEventListener(type: string, fn: Listener, o?: boolean | { capture?: boolean }): void {
    const capture = typeof o === 'boolean' ? o : o?.capture === true;
    if (!this.listeners.some((l) => l.type === type && l.fn === fn && l.capture === capture)) this.listeners.push({ type, fn, capture });
  }

  removeEventListener(type: string, fn: Listener, o?: boolean | { capture?: boolean }): void {
    const capture = typeof o === 'boolean' ? o : o?.capture === true;
    const k = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (k >= 0) this.listeners.splice(k, 1);
  }

  /** The DOM's dispatch: capture listeners from the root down, the target's own (capture first), then,
   *  for a bubbling event, the others from the parent up. True unless a listener prevented the default. */
  dispatchEvent(e: FakeEvent): boolean {
    e.target = this;
    const path: FakeNode[] = [];
    for (let n: FakeNode | null = this.parentNode; n !== null; n = n.parentNode) path.unshift(n);
    const run = (node: FakeNode, capture: boolean | null): void => {
      e.currentTarget = node;
      for (const l of [...node.listeners]) {
        if (l.type !== e.type || (capture !== null && l.capture !== capture)) continue;
        if (!node.listeners.includes(l)) continue;
        l.fn(e);
        if (e.immediateStopped) return;
      }
    };
    for (const n of path) {
      run(n, true);
      if (e.propagationStopped) return !e.defaultPrevented;
    }
    run(this, true);
    if (!e.immediateStopped) run(this, false);
    if (e.bubbles && !e.propagationStopped) {
      for (let k = path.length - 1; k >= 0; k--) {
        run(path[k]!, false);
        if (e.propagationStopped) break;
      }
    }
    e.currentTarget = null;
    return !e.defaultPrevented;
  }

  /** In the document's tree. */
  get isConnected(): boolean {
    return rootOf(this) === this.ownerDocument.documentElement;
  }
}

export class FakeText extends FakeNode {
  data: string;

  constructor(doc: FakeDocument, data: string) {
    super(doc);
    this.data = data;
  }

  override get textContent(): string {
    return this.data;
  }
}

class FakeClassList {
  private readonly el: FakeElement;

  constructor(el: FakeElement) {
    this.el = el;
  }

  private get tokens(): string[] {
    return this.el.className.split(/\s+/).filter((t) => t !== '');
  }

  contains(name: string): boolean {
    return this.tokens.includes(name);
  }

  add(...names: string[]): void {
    for (const n of names) if (!this.contains(n)) this.el.className = [...this.tokens, n].join(' ');
  }

  remove(...names: string[]): void {
    this.el.className = this.tokens.filter((t) => !names.includes(t)).join(' ');
  }

  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

/** Inline style: its custom properties by setProperty, and any property set directly (transform). */
export class FakeStyle {
  [key: string]: unknown;
  private readonly custom = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.custom.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.custom.get(name) ?? '';
  }
}

export class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly childNodes: FakeNode[] = [];
  readonly style = new FakeStyle();
  readonly classList: FakeClassList = new FakeClassList(this);
  className = '';
  hidden = false;
  tabIndex = -1;
  // A form control's state, so h() sets them as properties (src/ui/dom.ts).
  checked = false;
  disabled = false;
  private valueNow: string | null = null;
  private readonly attrs = new Map<string, string>();

  constructor(doc: FakeDocument, tag: string) {
    super(doc);
    this.tagName = tag.toUpperCase();
  }

  get value(): string {
    return this.valueNow ?? this.attrs.get('value') ?? '';
  }

  set value(v: string) {
    this.valueNow = v;
  }

  get id(): string {
    return this.attrs.get('id') ?? '';
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }

  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  /** As the DOM's: the children go, and the text, unless empty, is one text node. */
  override set textContent(s: string) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes.length = 0;
    if (s !== '') this.append(s);
  }

  getAttribute(k: string): string | null {
    if (k === 'class') return this.className;
    if (k === 'hidden' || k === 'disabled') return this.hasAttribute(k) ? '' : null;
    return this.attrs.get(k) ?? null;
  }

  /** hidden and disabled reflect their properties, as the DOM's do. */
  setAttribute(k: string, v: string): void {
    if (k === 'class') this.className = v;
    else if (k === 'hidden') this.hidden = true;
    else if (k === 'disabled') this.disabled = true;
    else this.attrs.set(k, String(v));
  }

  removeAttribute(k: string): void {
    if (k === 'hidden') this.hidden = false;
    if (k === 'disabled') this.disabled = false;
    this.attrs.delete(k);
  }

  hasAttribute(k: string): boolean {
    if (k === 'hidden') return this.hidden;
    if (k === 'disabled') return this.disabled;
    return k === 'class' ? this.className !== '' : this.attrs.has(k);
  }

  append(...nodes: (FakeNode | string)[]): void {
    for (const x of nodes) {
      const n = typeof x === 'string' ? new FakeText(this.ownerDocument, x) : x;
      if (n.parentNode !== null) n.parentNode.removeChild(n);
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }

  replaceChildren(...nodes: (FakeNode | string)[]): void {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes.length = 0;
    this.append(...nodes);
  }

  removeChild(n: FakeNode): FakeNode {
    const k = this.childNodes.indexOf(n);
    if (k < 0) throw new Error('not a child');
    this.childNodes.splice(k, 1);
    n.parentNode = null;
    return n;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  contains(other: FakeNode | null): boolean {
    for (let n = other; n !== null; n = n.parentNode) if (n === this) return true;
    return false;
  }

  /** Shown: neither it nor any ancestor hidden, and in the document. */
  get shown(): boolean {
    if (!this.isConnected || this.hidden) return false;
    for (let n = this.parentNode; n !== null; n = n.parentNode) if (n.hidden) return false;
    return true;
  }

  /** As a browser's: a hidden, detached or disabled element doesn't take the focus. */
  focus(_o?: { preventScroll?: boolean }): void {
    if (this.shown && !this.disabled) this.ownerDocument.activeElement = this;
  }

  /** Recorded in the window's scrolls: no layout here to scroll by. */
  scrollIntoView(o?: boolean | { block?: string }): void {
    this.ownerDocument.defaultView.scrolls.push({ intoView: this, block: typeof o === 'object' ? (o.block ?? 'start') : 'start' });
  }

  blur(): void {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }

  /** As HTMLElement.click(): a bubbling, cancelable click; a disabled control dispatches none. */
  click(timeStamp = 0): void {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true, timeStamp }));
  }

  querySelectorAll(selector: string): FakeElement[] {
    const tests = selector.split(',').map((s) => compile(s.trim()));
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      for (const c of el.children) {
        if (tests.some((t) => t(c))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** One compound selector: a tag, then any .class and [attr] or [attr="v"] parts. */
function compile(selector: string): (el: FakeElement) => boolean {
  const parts = selector.match(/^([a-zA-Z][a-zA-Z0-9-]*)?((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/);
  if (parts === null) throw new Error(`the fake DOM reads no selector like ${selector}`);
  const tag = parts[1]?.toUpperCase() ?? null;
  const tests: ((el: FakeElement) => boolean)[] = [];
  for (const m of (parts[2] ?? '').matchAll(/\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const [, cls, attr, value] = m;
    if (cls !== undefined) tests.push((el) => el.classList.contains(cls));
    else if (attr !== undefined) tests.push((el) => (value === undefined ? el.hasAttribute(attr) : el.getAttribute(attr) === value));
  }
  return (el) => (tag === null || el.tagName === tag) && tests.every((t) => t(el));
}

/** The document's window, as far as the screens use one: its scroll, each move recorded, and a computed
 *  style, with no layout behind it. */
export class FakeWindow {
  scrollX = 0;
  scrollY = 0;
  /** Each scrollTo and scrollIntoView, in order. */
  readonly scrolls: ({ readonly to: readonly [number, number] } | { readonly intoView: FakeElement; readonly block: string })[] = [];

  scrollTo(x: number, y: number): void {
    this.scrollX = x;
    this.scrollY = y;
    this.scrolls.push({ to: [x, y] });
  }

  getComputedStyle(_el: unknown): { readonly visibility: string } {
    return { visibility: 'visible' };
  }
}

export class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  readonly defaultView = new FakeWindow();
  activeElement: FakeElement;

  constructor() {
    super(null as unknown as FakeDocument);
    (this as { ownerDocument: FakeDocument }).ownerDocument = this;
    this.documentElement = new FakeElement(this, 'html');
    this.head = new FakeElement(this, 'head');
    this.body = new FakeElement(this, 'body');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }

  createTextNode(data: string): FakeText {
    return new FakeText(this, data);
  }
}

/** A fresh document as the global one, until restore(). */
export function installDom(): { readonly document: FakeDocument; restore(): void } {
  const g = globalThis as { document?: unknown };
  const before = g.document;
  const doc = new FakeDocument();
  g.document = doc;
  return {
    document: doc,
    restore: () => {
      if (before === undefined) delete g.document;
      else g.document = before;
    },
  };
}

/** A real-typed element as the fake it is. */
export const fake = (el: unknown): FakeElement => el as FakeElement;

/** The element's visible text, without its hidden descendants. */
export function shownText(el: FakeElement): string {
  if (el.hidden) return '';
  return el.childNodes.map((n) => (n instanceof FakeElement ? shownText(n) : n.textContent)).join('');
}

/** The one element under root matching selector: a test's failure if none or several. */
export function only(root: Element | FakeElement, selector: string): FakeElement {
  const all = fake(root).querySelectorAll(selector);
  if (all.length !== 1) throw new Error(`${all.length} elements match ${selector}`);
  return all[0]!;
}

/** A stylesheet's declarations for one selector, from every rule that lists it: comments dropped, later
 *  rules winning. Throws for a selector no rule lists, so a renamed class fails its test. */
export function cssDeclarations(css: string, selector: string): Readonly<Record<string, string>> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  let found = false;
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(',').map((x) => x.trim()).includes(selector)) continue;
    found = true;
    for (const d of m[2]!.split(';')) {
      const k = d.indexOf(':');
      if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim();
    }
  }
  if (!found) throw new Error(`no rule lists ${selector}`);
  return out;
}

/** A CSS length in px, in a box `within` px across: px, rem (16 px) and % lengths, and min() or max() of
 *  them. Throws on anything else, so a test never reads a length it can't. */
export function cssLength(value: string | undefined, within: number): number {
  const v = (value ?? '').trim();
  const fn = /^(min|max)\((.*)\)$/.exec(v);
  if (fn !== null) {
    const parts = fn[2]!.split(',').map((x) => cssLength(x, within));
    return fn[1] === 'min' ? Math.min(...parts) : Math.max(...parts);
  }
  const m = /^(-?\d+(?:\.\d+)?)(px|rem|%)$/.exec(v);
  if (m === null) throw new Error(`no length like ${v}`);
  const n = Number(m[1]);
  return m[2] === 'px' ? n : m[2] === 'rem' ? n * 16 : (n * within) / 100;
}
