// The vote and golden hash (PLAN A.1, D-13): roslambo's src/core/sim/hash.ts,
// by way of the M0 spike's copy, unchanged (design §1.2). MurmurHash3 x86-32
// with two seeds, 0 and 0x9747B28C, written as 16 lower-case hex digits.
// Equal-length hex strings compare like the unsigned big-endian numbers they
// spell, which is the vote's tie-break order.

function murmur3(bytes: Uint8Array, len: number, seed: number): number {
  let h = seed | 0;
  const tail = len & ~3;
  for (let i = 0; i < tail; i += 4) {
    let k = bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  const rest = len & 3;
  if (rest > 0) {
    let k = 0;
    if (rest === 3) k ^= bytes[tail + 2]! << 16;
    if (rest >= 2) k ^= bytes[tail + 1]! << 8;
    k ^= bytes[tail]!;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
  }
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hex8(v: number): string {
  return v.toString(16).padStart(8, '0');
}

/** The hash of bytes[0, len). */
export function hash64(bytes: Uint8Array, len = bytes.length): string {
  return hex8(murmur3(bytes, len, 0)) + hex8(murmur3(bytes, len, 0x9747b28c));
}

/** A hash's 8 bytes, big-endian, into out at offset. */
export function hashToBytes(hash: string, out: Uint8Array, offset: number): void {
  for (let i = 0; i < 8; i++) out[offset + i] = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
}

/** The hash whose 8 bytes are at offset. */
export function bytesToHash(bytes: Uint8Array, offset: number): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += bytes[offset + i]!.toString(16).padStart(2, '0');
  return s;
}
