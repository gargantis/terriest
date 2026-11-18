// Little-endian writing, and total reading, for the wire protocol (PLAN §9,
// D-20; design §1.1). The reader never throws: a short or malformed buffer
// sets `bad`, and every later read returns zeros, '' or an empty copy.
// roslambo's src/core/protocol/bytes.ts, with terriest's changes: no i32,
// since nothing signed is sent; a string's limit is the configuration's
// displayNameMaxBytes, not a literal 32; a string is written as
// wireString(s) and read strictly with a leading U+FEFF kept, as A.1's codec
// reads names (design §5.7); and hex() writes zeros for anything but
// 2·size hex digits, where roslambo's parsed each pair on its own.

import { config } from '../../config';

const utf8 = new TextEncoder();
// Strict, and keeping a leading U+FEFF, which a name may start with (C-17).
// roslambo's left ignoreBOM false and dropped it, so every receiver would
// join a sender's JOIN under another name than the sender's (design §1.1).
const utf8Strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const HEX = '0123456789abcdef'; // not a setting

/** s as the wire carries it: itself if it's well-formed UTF-16, with no
 *  lone surrogate, and at most max bytes of UTF-8; else ''. TextEncoder
 *  writes a lone surrogate as U+FFFD, which would join as '' at its sender
 *  (C-17) and as U+FFFD at every receiver (design §5.7). */
export function wireString(s: string, max: number = config.displayNameMaxBytes): string {
  if (typeof s !== 'string') return '';
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    if (u >= 0xd800 && u <= 0xdfff) {
      // Only a high surrogate followed by a low one: a code point of 4 bytes.
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (u > 0xdbff || next < 0xdc00 || next > 0xdfff) return '';
      i++;
      bytes += 4;
    } else {
      bytes += u < 0x80 ? 1 : u < 0x800 ? 2 : 3;
    }
    if (bytes > max) return '';
  }
  return s;
}

/** A hex digit's value, either case; −1 for anything else. */
function nibble(c: number): number {
  if (c >= 48 && c <= 57) return c - 48; // '0'–'9'
  if (c >= 97 && c <= 102) return c - 87; // 'a'–'f'
  if (c >= 65 && c <= 70) return c - 55; // 'A'–'F'
  return -1;
}

export class Writer {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  // DataView's setters keep the low bits: a value outside the type wraps.
  u8(v: number): this {
    this.room(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
    return this;
  }

  u16(v: number): this {
    this.room(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
    return this;
  }

  u32(v: number): this {
    this.room(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
    return this;
  }

  bytes(b: Uint8Array): this {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }

  /** u8 byte length, then UTF-8 of wireString(s) (design §5.7). */
  string(s: string): this {
    const b = utf8.encode(wireString(s));
    return this.u8(b.length).bytes(b);
  }

  /** 2·size hex digits as size raw bytes; anything but hex writes 0. */
  hex(h: string, size: number): this {
    this.room(size);
    let ok = typeof h === 'string' && h.length === 2 * size;
    for (let i = 0; ok && i < h.length; i++) ok = nibble(h.charCodeAt(i)) >= 0;
    for (let i = 0; i < size; i++) {
      this.buf[this.length + i] = ok ? (nibble(h.charCodeAt(2 * i)) << 4) | nibble(h.charCodeAt(2 * i + 1)) : 0;
    }
    this.length += size;
    return this;
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class Reader {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  private pos = 0;
  bad = false;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** Where n more bytes start, or −1, and bad, if fewer remain. */
  private take(n: number): number {
    if (this.bad || !(Number.isInteger(n) && n >= 0 && n <= this.buf.length - this.pos)) {
      this.bad = true;
      return -1;
    }
    const at = this.pos;
    this.pos += n;
    return at;
  }

  u8(): number {
    const at = this.take(1);
    return at < 0 ? 0 : this.view.getUint8(at);
  }

  u16(): number {
    const at = this.take(2);
    return at < 0 ? 0 : this.view.getUint16(at, true);
  }

  u32(): number {
    const at = this.take(4);
    return at < 0 ? 0 : this.view.getUint32(at, true);
  }

  /** A copy of n bytes; bad, and empty, if fewer remain. */
  bytes(n: number): Uint8Array {
    const at = this.take(n);
    return at < 0 ? new Uint8Array(0) : this.buf.slice(at, at + n);
  }

  /** u8 length, then strict UTF-8 of at most max bytes, a leading U+FEFF
   *  kept; else bad. */
  string(max: number = config.displayNameMaxBytes): string {
    const n = this.u8();
    if (n > max) this.bad = true;
    const at = this.take(n);
    if (at < 0) return '';
    try {
      return utf8Strict.decode(this.buf.subarray(at, at + n));
    } catch {
      this.bad = true;
      return '';
    }
  }

  /** size bytes as 2·size lower-case hex digits; '' if bad. */
  hex(size: number): string {
    const at = this.take(size);
    if (at < 0) return '';
    let s = '';
    for (let i = 0; i < size; i++) {
      const x = this.buf[at + i]!;
      s += HEX[x >> 4]! + HEX[x & 15]!;
    }
    return s;
  }

  /** The bytes left to read: 0 once bad. */
  get remaining(): number {
    return this.bad ? 0 : this.buf.length - this.pos;
  }

  /** Read to the end without error. */
  get complete(): boolean {
    return !this.bad && this.pos === this.buf.length;
  }
}
