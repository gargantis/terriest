// The page's one keyboard terrier (design §9.3), by event.code, released on
// blur: W, A, S and D in eight directions; Space jumps; Shift is zoomies; E
// pounces; Q barks. The frame selector picks pitch, ball line or nose, and
// in the plan view pitch-frame W is +y. Each press counts once, mod 4 (A.2,
// D-10), from the terrier's previous input when the keyboard takes it over,
// so taking over presses nothing.

import { barkCount, encodeInput, FRAME_PITCH, jumpCount, pounceCount } from '../../src/core/sim/input';

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ'];

/** A.2's step for (a, b) in −1, 0, 1: the angle of a forward and b to the left. */
const STEPS: readonly (number | null)[] = [20, 16, 12, 24, null, 8, 28, 0, 4]; // by 3 · (a + 1) + (b + 1)

/** Keys typed into a field drive nothing. */
function typing(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox';
}

export class Keyboard {
  private readonly held = new Set<string>();
  private jump = 0;
  private pounce = 0;
  private bark = 0;

  attach(target: Window): void {
    target.addEventListener('keydown', (e) => {
      if (typing(e.target) || !KEYS.includes(e.code)) return;
      e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'Space') this.jump = (this.jump + 1) & 3;
        else if (e.code === 'KeyE') this.pounce = (this.pounce + 1) & 3;
        else if (e.code === 'KeyQ') this.bark = (this.bark + 1) & 3;
      }
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    target.addEventListener('blur', () => this.release());
  }

  /** Starts the press counters from a terrier's previous input (D-10). */
  adopt(prevInput: number): void {
    this.jump = jumpCount(prevInput);
    this.pounce = pounceCount(prevInput);
    this.bark = barkCount(prevInput);
  }

  release(): void {
    this.held.clear();
  }

  /** The u16 in a frame (A.2): in the pitch frame W is +y and D is +x; in
   *  the ball and nose frames W is forward and A is to the left. */
  input(frame: number): number {
    const h = (code: string): number => (this.held.has(code) ? 1 : 0);
    const x = h('KeyD') - h('KeyA');
    const y = h('KeyW') - h('KeyS');
    const [a, b] = frame === FRAME_PITCH ? [x, y] : [y, -x];
    const step = STEPS[3 * (a + 1) + (b + 1)] ?? null;
    return encodeInput({
      ...(step === null ? {} : { step, frame }),
      zoomies: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      jump: this.jump, pounce: this.pounce, bark: this.bark,
    });
  }

  /** What's held, for the readout. */
  describe(): string {
    const names: Readonly<Record<string, string>> = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', KeyE: 'E', KeyQ: 'Q' };
    return [...new Set([...this.held].map((k) => names[k] ?? k))].join(' ') || 'nothing held';
  }
}
