// PLAN §9's messages, their encoders and one total decoder (D-20; design
// §1.2, §5): [u8 type][payload], little-endian, at most messageMaxBytes.
// decode gives null for anything malformed, inconsistent, out of §5's
// bounds or trailing, never throws, and bounds every count by what remains
// and by WireLimits, so a message allocates at most a constant times its
// length (§5.6). It knows no sender: the session attributes each (§4.10).
// roslambo's src/core/protocol/messages.ts, with §1.2's changes: A.2's u16
// input; the history as present and same masks and the differing inputs;
// JOIN's pack and coat, and SWITCH; PEERS' role byte and cap; HELLO without
// "saved" and "holds a result"; RESULT_REQ, RESULT and SETTLED dropped;
// STATE's ID table and tick bounds (M3-Q27), its state through A.1's
// decodeState; an event checked against its sender's history (§5.3).
// The encoders write only what decode takes: they zero the fields that a
// timeline of kind none, a TICK without its own input and a missing vote
// leave unused, and leave out what no receiver could take (writeEvents,
// encodeState). They take the decoder's WireLimits too, the configuration's
// by default. decode isn't byte-canonical, and §5.8 asks only that what
// decodes re-encodes to bytes that decode to the same message: it also
// takes a history entry written out that equals the next newer, a sender's
// events in any order of backs and kinds, and a STATE input's kinds in any
// order. No caller compares bytes.

import { config, type Config } from '../../config';
import { BOT_SLOTS } from '../bot/bot-id';
import {
  decodeState, defaultParams, ENDED, isPlayerId, JOIN, LEAVE, type MatchState, READY, type SimParams, SWITCH, UNREADY,
} from '../sim/index';
import { Reader, Writer } from './bytes';

export { wireString } from './bytes';

export const PROTOCOL_VERSION = 1; // not a setting: D-20
export const NO_TICK = 0xffffffff; // not a setting
export const ZERO_HASH = '0000000000000000'; // not a setting
export const T = { HELLO: 0x01, REFUSE: 0x02, TICK: 0x10, FWD: 0x11, PEERS: 0x12, AGAIN: 0x13, STATE_REQ: 0x20, STATE: 0x21 } as const; // not a setting
export const ROLE = { KEEPER: 1, PLAYER: 2, SPECTATOR: 3, UNDECIDED: 4 } as const; // not a setting
export const TIMELINE_KIND = { NONE: 0, LIVE: 1 } as const; // not a setting
export const REFUSAL = { ACCEPTED: 0, PROTOCOL: 1, BUILD: 2, DUPLICATE: 3, SPECTATORS_FULL: 4 } as const; // not a setting
export const KIND = { JOIN: 1, LEAVE: 2, READY: 3, UNREADY: 4, SWITCH: 5 } as const; // not a setting

/** Wire kind k's event bit (sim/input.ts), at k − 1. */
const BITS = [JOIN, LEAVE, READY, UNREADY, SWITCH] as const;

// §5's sizes in bytes, each marked for the configuration scan.
const ID_BYTES = 16; // not a setting: a player ID's raw bytes
const HASH_BYTES = 8; // not a setting: a hash's, a build hash's and a timeline ID's
const NOT_OWN = 0x80; // not a setting: TICK's flags bit 7
const PHASE_SCALE = 65536; // not a setting: a clock phase's u16, in 65,536ths of a tick
const MASK_BITS = 16; // not a setting: TICK's u16 history masks
const EVENT_MIN = 2; // not a setting: an event's back and kind
const BOT_MIN = 23; // not a setting: a bot entry's ID, input, masks and event count
const INPUT_MIN = 4; // not a setting: a STATE input's index, input and event count
const STATE_HEAD = 28; // not a setting: STATE's fields and counts, its state and ID table aside

/** The bounds the decoder checks (§5.6), from the configuration. */
export interface WireLimits {
  readonly messageMaxBytes: number; readonly nameMaxBytes: number; readonly inputHistory: number;
  readonly botsMax: number;          // BOT_SLOTS
  readonly peersMax: number;         // meshPlayersMax + spectatorsMax − 1
  readonly historyTicks: number; readonly window: number; readonly delay: number;   // STATE's tick bounds (§5.5)
}

const whole = (x: number, min: number, max: number): boolean => Number.isInteger(x) && x >= min && x <= max;

/** The configuration's bounds; botsMax is bot-id.ts's BOT_SLOTS, from
 *  src/config.ts's packSizeMax. Throws on a configuration the wire can't
 *  carry: a history wider than TICK's u16 masks, or a name, PEERS' list or
 *  a TICK's bots past a u8 count (design §10's checks), as derive() throws. */
export function wireLimits(c: Config = config): WireLimits {
  const L: WireLimits = {
    messageMaxBytes: c.messageMaxBytes,
    nameMaxBytes: c.displayNameMaxBytes,
    inputHistory: c.inputHistoryTicks,
    botsMax: BOT_SLOTS,
    peersMax: c.meshPlayersMax + c.spectatorsMax - 1,
    historyTicks: c.stateHistoryTicks,
    window: c.lateWindowTicks,
    delay: c.inputDelayTicks,
  };
  const problems: string[] = [];
  if (!whole(L.inputHistory, 0, MASK_BITS)) problems.push(`an input history of ${L.inputHistory} ticks doesn't fit TICK's ${MASK_BITS}-bit masks`);
  for (const [what, n] of [['a name', L.nameMaxBytes], ["PEERS' IDs", L.peersMax], ['the bots in a TICK', L.botsMax]] as const) {
    if (!whole(n, 0, 0xff)) problems.push(`${what}: ${n} doesn't fit a u8 count`);
  }
  if (problems.length > 0) throw new Error(`${problems.join('; ')} (design §5, §10)`);
  return Object.freeze(L);
}

const LIMITS = wireLimits();

/** §5.5's tick bounds: the most input ticks a STATE may carry, senderTick + d − g, while its ticks
 *  are inside them (g ≤ senderFinal ≤ senderTick, senderTick − g ≤ stateHistoryTicks + 2w + d), and
 *  −1 where they aren't, which no receiver takes. senderTick is the clock's, which can jump back
 *  past localTick or even finalTick (§1.6): an answer builds its records to at most this many, and
 *  none is sent at −1 (§3.4). */
export function stateRecordsMax(g: number, senderFinal: number, senderTick: number, L: WireLimits = LIMITS): number {
  const inside = g <= senderFinal && senderFinal <= senderTick && senderTick - g <= L.historyTicks + 2 * L.window + L.delay;
  return inside ? senderTick + L.delay - g : -1;
}

/** One input's roster events, as TickInput carries them (sim/input.ts, D-12). */
export interface EventPayload {
  events: number;            // JOIN | LEAVE | READY | UNREADY | SWITCH, sim/input.ts's bits
  joinPack?: number; coat?: number; name?: string;   // with JOIN
  switchPack?: number;                               // with SWITCH
}
/** An event the sender attaches for its own input at tick t − back. */
export interface TickEvent extends EventPayload { back: number }
/** A sender's input in a TICK: its own, or a hosted bot's. */
export interface SenderInput {
  input: number;             // A.2's u16, as sent
  present: number;           // bit k: hist[k], the input for tick t − 1 − k, is included; clear: the sender has none there
  hist: number[];            // HISTORY entries (config.inputHistoryTicks, 16); 0 where absent
  events: TickEvent[];
}
export interface BotEntry extends SenderInput { id: string }
export interface Hello {
  type: typeof T.HELLO; protocol: number; build: string; player: string; role: number;
  timeline: string; timelineKind: number; phase: number; finalTick: number; hash: string; name: string;
}
export interface Refuse { type: typeof T.REFUSE; reason: number }
export interface Tick {
  type: typeof T.TICK; t: number;
  own: SenderInput | null;   // null: a spectator that hosts bots (flags bit 7)
  voteTick: number; voteHash: string;
  phase: number;             // the sender's fraction of its tick at send time, 0..1
  bots: BotEntry[];
}
export interface Fwd { type: typeof T.FWD; origin: string; tick: Tick }
export interface Peers { type: typeof T.PEERS; players: string[]; role: number }
export interface Again { type: typeof T.AGAIN }
export interface StateReq { type: typeof T.STATE_REQ; tick: number; want: string }
/** One player's or bot's input for one tick, as STATE carries it. */
export interface InputRecord extends EventPayload { player: string; input: number }
export interface StateMsg {
  type: typeof T.STATE; timeline: string; senderTick: number; phase: number;
  g: number; senderFinal: number;
  state: Uint8Array;         // A.1's bytes at g
  decoded: MatchState;       // decodeState(state): the decoder already validated it
  roster: string[];          // decoded's terrier IDs, in list order: record indices below roster.length
  others: string[];          // the ID table: indices from roster.length on (§5.5)
  inputs: InputRecord[][];   // ticks g + 1, g + 2, …
}
export type Message = Hello | Refuse | Tick | Fwd | Peers | Again | StateReq | StateMsg;

// --- Encoding ---

/** A clock phase, 0..1, as its u16: clamped, and 0 for NaN. */
const phaseBits = (p: number): number => (p > 0 ? Math.min(PHASE_SCALE - 1, Math.floor(p * PHASE_SCALE)) : 0);
/** Bits 0 to n − 1 of a u16 mask. */
const lowBits = (n: number): number => (n >= MASK_BITS ? 0xffff : (1 << n) - 1);

export function encodeHello(m: Omit<Hello, 'type'>): Uint8Array {
  // Kind none: a zero timeline ID, tick and hash (§5.1).
  const none = (m.timelineKind & 0xff) === TIMELINE_KIND.NONE;
  return new Writer()
    .u8(T.HELLO).u16(m.protocol).hex(m.build, HASH_BYTES).hex(m.player, ID_BYTES).u8(m.role)
    .hex(none ? ZERO_HASH : m.timeline, HASH_BYTES).u8(m.timelineKind).u8(m.phase)
    .u32(none ? 0 : m.finalTick).hex(none ? ZERO_HASH : m.hash, HASH_BYTES)
    .string(m.name).done();
}

export function encodeRefuse(reason: number): Uint8Array {
  return new Writer().u8(T.REFUSE).u8(reason).done();
}

function writePayload(w: Writer, e: EventPayload, kind: number): void {
  if (kind === KIND.JOIN) w.u8(e.joinPack ?? 0).u8(e.coat ?? 0).string(e.name ?? '');
  else if (kind === KIND.SWITCH) w.u8(e.switchPack ?? 0);
}

/** A sender's events: each kind of each, with its back and payload. Only
 *  what a receiver can take rides: a back from 0 to 255, at a tick its
 *  history doesn't mark absent (§5.3), each (back, kind) once, the first,
 *  and 255 of them at most. A repair that replaced the sender's own input
 *  at an event's tick leaves such an event, which would make every
 *  receiver refuse the whole TICK. */
function writeEvents(w: Writer, events: readonly TickEvent[], present: number, L: WireLimits): void {
  const H = L.inputHistory;
  const kept: [TickEvent, number][] = [];
  const done: number[] = []; // by back: the bits kept
  for (const e of events) {
    const back = e.back;
    if (!whole(back, 0, 0xff) || (back >= 1 && back <= H && (present & (1 << (back - 1))) === 0)) continue;
    for (let k = 0; k < BITS.length && kept.length < 0xff; k++) {
      const bit = BITS[k]!;
      if ((e.events & bit) === 0 || ((done[back] ?? 0) & bit) !== 0) continue;
      done[back] = (done[back] ?? 0) | bit;
      kept.push([e, k + 1]);
    }
  }
  w.u8(kept.length);
  for (const [e, kind] of kept) writePayload(w.u8(e.back).u8(kind), e, kind);
}

/** A sender's present and same masks, its present inputs that differ from
 *  the next newer, k ascending, then its events (§5.3). The caller writes
 *  its input first, which hist[0] is compared with. */
function writeSender(w: Writer, x: SenderInput, L: WireLimits): void {
  const H = L.inputHistory;
  const present = x.present & lowBits(H);
  let same = 0;
  let newer = x.input & 0xffff;
  let newerPresent = true;
  const differ: number[] = [];
  for (let k = 0; k < H; k++) {
    if ((present & (1 << k)) === 0) {
      newerPresent = false;
      continue;
    }
    const v = (x.hist[k] ?? 0) & 0xffff;
    if (newerPresent && v === newer) same |= 1 << k;
    else differ.push(v);
    newer = v;
    newerPresent = true;
  }
  w.u16(present).u16(same);
  for (const v of differ) w.u16(v);
  writeEvents(w, x.events, present, L);
}

export function encodeTick(m: Omit<Tick, 'type'>, L: WireLimits = LIMITS): Uint8Array {
  const own = m.own;
  const voted = (m.voteTick >>> 0) !== NO_TICK; // as the u32 is written
  const w = new Writer()
    .u8(T.TICK).u32(m.t).u8(own ? 0 : NOT_OWN).u16(own ? own.input : 0)
    .u32(m.voteTick).hex(voted ? m.voteHash : ZERO_HASH, HASH_BYTES).u16(phaseBits(m.phase));
  // Without an input of the sender's own: no history and no events either.
  if (own) writeSender(w, own, L);
  else w.u16(0).u16(0).u8(0);
  w.u8(m.bots.length);
  for (const b of m.bots) writeSender(w.hex(b.id, ID_BYTES).u16(b.input), b, L);
  return w.done();
}

export function encodeFwd(origin: string, tick: Uint8Array): Uint8Array {
  return new Writer().u8(T.FWD).hex(origin, ID_BYTES).bytes(tick).done();
}

/** Each ID once, then the role (§5.4). */
export function encodePeers(players: readonly string[], role: number): Uint8Array {
  const ids = players.filter((p, i) => players.indexOf(p) === i);
  const w = new Writer().u8(T.PEERS).u8(ids.length);
  for (const p of ids) w.hex(p, ID_BYTES);
  return w.u8(role).done();
}

export function encodeAgain(): Uint8Array {
  return new Writer().u8(T.AGAIN).done();
}

export function encodeStateReq(tick: number, want: string): Uint8Array {
  return new Writer().u8(T.STATE_REQ).u32(tick).hex(want, HASH_BYTES).done();
}

/** A STATE input's events: their count, then each kind and its payload, as
 *  TICK's but without back (§5.5). */
function writeInputEvents(w: Writer, x: EventPayload): void {
  let n = 0;
  for (const bit of BITS) if ((x.events & bit) !== 0) n++;
  w.u8(n);
  for (let k = 0; k < BITS.length; k++) if ((x.events & BITS[k]!) !== 0) writePayload(w.u8(k + 1), x, k + 1);
}

/** The ID table built from the records; as many input ticks as fit in messageMaxBytes; kept says how many.
 *  At most stateRecordsMax of them too, so a clock that jumped back never
 *  makes an answer every receiver refuses; at −1, ticks outside §5.5's
 *  bounds, it keeps none, and no receiver takes it either. The table holds
 *  the kept records' IDs outside the roster, in the order they first
 *  appear, as decode requires. An input whose ID isn't a player's is left
 *  out, as canonicalInputs drops it, and so is an ID's second input in one
 *  tick. */
export function encodeState(
  m: Omit<StateMsg, 'type' | 'decoded' | 'roster' | 'others'>, roster: readonly string[], L: WireLimits = LIMITS,
): { bytes: Uint8Array; kept: number } {
  // The ticks as the u32s are written.
  const most = stateRecordsMax(m.g >>> 0, m.senderFinal >>> 0, m.senderTick >>> 0, L);
  const R = roster.length;
  const index = new Map<string, number>(); // the roster's indices, then the table's
  roster.forEach((id, i) => {
    if (!index.has(id)) index.set(id, i);
  });
  const table: string[] = [];
  const records: Uint8Array[] = [];
  let size = STATE_HEAD + m.state.length;
  for (const inputs of m.inputs) {
    if (records.length >= most) break;
    const body = new Writer();
    const fresh: string[] = []; // this record's new table IDs
    const used: number[] = [];
    for (const x of inputs) {
      if (!isPlayerId(x.player)) continue;
      let i = index.get(x.player);
      if (i === undefined) {
        const f = fresh.indexOf(x.player);
        i = R + table.length + (f >= 0 ? f : fresh.push(x.player) - 1);
      }
      if (used.includes(i)) continue;
      used.push(i);
      body.u8(i).u16(x.input);
      writeInputEvents(body, x);
    }
    const k = table.length + fresh.length;
    const bytes = 1 + body.length + ID_BYTES * fresh.length;
    // u8 counts and indices, the u16 record count, and the message's limit (D-18).
    if (used.length > 0xff || k > 0xff || R + k > 0x100 || records.length === 0xffff || size + bytes > L.messageMaxBytes) break;
    size += bytes;
    for (const id of fresh) {
      index.set(id, R + table.length);
      table.push(id);
    }
    records.push(new Writer().u8(used.length).bytes(body.done()).done());
  }
  const w = new Writer()
    .u8(T.STATE).hex(m.timeline, HASH_BYTES).u32(m.senderTick).u16(phaseBits(m.phase))
    .u32(m.g).u32(m.senderFinal).u16(m.state.length).bytes(m.state).u8(table.length);
  for (const id of table) w.hex(id, ID_BYTES);
  w.u16(records.length);
  for (const r of records) w.bytes(r);
  return { bytes: w.done(), kept: records.length };
}

// --- Decoding ---

function readPayload(r: Reader, e: EventPayload, kind: number, L: WireLimits): void {
  if (kind === KIND.JOIN) {
    e.joinPack = r.u8();
    e.coat = r.u8();
    e.name = r.string(L.nameMaxBytes);
  } else if (kind === KIND.SWITCH) {
    e.switchPack = r.u8();
  }
}

/** A sender's events, one TickEvent per back in the order the backs first
 *  appear. Invalid: an unknown kind, a (back, kind) twice, and a back from 1
 *  to the history's length whose present bit is clear, since the sender says
 *  it has no input there; a back past the history is valid (§5.3). */
function readEvents(r: Reader, present: number, L: WireLimits): TickEvent[] | null {
  const n = r.u8();
  if (n * EVENT_MIN > r.remaining) return null;
  const out: TickEvent[] = [];
  const byBack: (TickEvent | undefined)[] = [];
  for (let i = 0; i < n; i++) {
    const back = r.u8();
    const kind = r.u8();
    if (r.bad || kind < KIND.JOIN || kind > KIND.SWITCH) return null;
    if (back >= 1 && back <= L.inputHistory && (present & (1 << (back - 1))) === 0) return null;
    const bit = BITS[kind - 1]!;
    let e = byBack[back];
    if (e === undefined) {
      e = { back, events: 0 };
      byBack[back] = e;
      out.push(e);
    }
    if ((e.events & bit) !== 0) return null;
    e.events |= bit;
    readPayload(r, e, kind, L);
  }
  return r.bad ? null : out;
}

/** A sender's masks, history and events, after its input (§5.3). Invalid:
 *  a mask bit past the history, a same bit whose present bit is clear or
 *  whose next newer input is absent. */
function readSender(r: Reader, input: number, L: WireLimits): SenderInput | null {
  const H = L.inputHistory;
  const present = r.u16();
  const same = r.u16();
  if (r.bad || ((present | same) & ~lowBits(H)) !== 0 || (same & ~present) !== 0) return null;
  const hist: number[] = [];
  let newer = input;
  let newerPresent = true;
  for (let k = 0; k < H; k++) {
    if ((present & (1 << k)) === 0) {
      hist.push(0);
      newerPresent = false;
      continue;
    }
    let v: number;
    if ((same & (1 << k)) !== 0) {
      if (!newerPresent) return null;
      v = newer;
    } else {
      v = r.u16();
    }
    hist.push(v);
    newer = v;
    newerPresent = true;
  }
  const events = readEvents(r, present, L);
  return events === null || r.bad ? null : { input, present, hist, events };
}

/** A TICK after its type byte (§5.3). */
function readTick(r: Reader, L: WireLimits): Tick | null {
  const t = r.u32();
  const flags = r.u8();
  const input = r.u16();
  const voteTick = r.u32();
  const voteHash = r.hex(HASH_BYTES);
  const phase = r.u16() / PHASE_SCALE;
  // Flags bits 0–6 zero, and a zero hash with no vote.
  if (r.bad || (flags & ~NOT_OWN) !== 0 || (voteTick === NO_TICK && voteHash !== ZERO_HASH)) return null;
  let own: SenderInput | null = null;
  if ((flags & NOT_OWN) === 0) {
    own = readSender(r, input, L);
    if (own === null) return null;
  } else if (input !== 0 || r.u16() !== 0 || r.u16() !== 0 || r.u8() !== 0) {
    return null; // bit 7 with an input, a history or events
  }
  const n = r.u8();
  if (n > L.botsMax || n * BOT_MIN > r.remaining) return null;
  const bots: BotEntry[] = [];
  for (let k = 0; k < n; k++) {
    const id = r.hex(ID_BYTES);
    const x = readSender(r, r.u16(), L);
    if (x === null || bots.some((b) => b.id === id)) return null;
    bots.push({ id, ...x });
  }
  return r.bad ? null : { type: T.TICK, t, own, voteTick, voteHash, phase, bots };
}

/** HELLO after its type byte (§5.1). 16 raw bytes always spell a player ID
 *  (D-25), here and in PEERS and STATE's table. */
function readHello(r: Reader, L: WireLimits): Hello | null {
  const protocol = r.u16();
  const build = r.hex(HASH_BYTES);
  const player = r.hex(ID_BYTES);
  const role = r.u8();
  const timeline = r.hex(HASH_BYTES);
  const timelineKind = r.u8();
  const phase = r.u8();
  const finalTick = r.u32();
  const hash = r.hex(HASH_BYTES);
  const name = r.string(L.nameMaxBytes);
  if (r.bad || role < ROLE.KEEPER || role > ROLE.UNDECIDED || timelineKind > TIMELINE_KIND.LIVE || phase > ENDED) return null;
  if (timelineKind === TIMELINE_KIND.NONE && (timeline !== ZERO_HASH || finalTick !== 0 || hash !== ZERO_HASH)) return null;
  return { type: T.HELLO, protocol, build, player, role, timeline, timelineKind, phase, finalTick, hash, name };
}

/** PEERS after its type byte: at most peersMax distinct IDs and a role
 *  from 1 to 4, a keeper's 1 included (§5.4, M3-Q15). */
function readPeers(r: Reader, L: WireLimits): Peers | null {
  const n = r.u8();
  if (n > L.peersMax || ID_BYTES * n + 1 > r.remaining) return null;
  const players: string[] = [];
  for (let k = 0; k < n; k++) {
    const p = r.hex(ID_BYTES);
    if (players.includes(p)) return null;
    players.push(p);
  }
  const role = r.u8();
  return r.bad || role < ROLE.KEEPER || role > ROLE.UNDECIDED ? null : { type: T.PEERS, players, role };
}

/** A STATE input's events, into x: as TICK's without back. */
function readInputEvents(r: Reader, x: EventPayload, L: WireLimits): boolean {
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const kind = r.u8();
    if (r.bad || kind < KIND.JOIN || kind > KIND.SWITCH || (x.events & BITS[kind - 1]!) !== 0) return false;
    x.events |= BITS[kind - 1]!;
    readPayload(r, x, kind, L);
  }
  return !r.bad;
}

/** STATE after its type byte (§5.5). Its state is decodeState's at g, so no
 *  state valid.ts refuses comes from a peer (A.1). Invalid besides: ticks
 *  outside the bounds, stateRecordsMax's, none of which is in the state's
 *  hash; a table ID repeated or among the terriers; an index past the
 *  terriers and the table, or twice in a record. And a table that isn't the
 *  encoder's: each entry used, first used in order, so whatever decodes
 *  re-encodes to the same message (§5.8). */
function readState(r: Reader, P: SimParams, L: WireLimits): StateMsg | null {
  const timeline = r.hex(HASH_BYTES);
  const senderTick = r.u32();
  const phase = r.u16() / PHASE_SCALE;
  const g = r.u32();
  const senderFinal = r.u32();
  const state = r.bytes(r.u16());
  const most = stateRecordsMax(g, senderFinal, senderTick, L);
  if (r.bad || most < 0) return null;
  const decoded = decodeState(state, P);
  if (decoded === null || decoded.tick !== g) return null;
  const roster = decoded.terriers.map((x) => x.id);
  const R = roster.length;
  const k = r.u8();
  if (ID_BYTES * k > r.remaining) return null;
  const others: string[] = [];
  for (let i = 0; i < k; i++) {
    const id = r.hex(ID_BYTES);
    if (roster.includes(id) || others.includes(id)) return null;
    others.push(id);
  }
  const m = r.u16();
  if (r.bad || m > most || m > r.remaining) return null;
  const inputs: InputRecord[][] = [];
  const seenIn = new Int32Array(R + k).fill(-1); // the record that last used each index
  let unused = 0; // the first table entry no record has used yet
  for (let j = 0; j < m; j++) {
    const n = r.u8();
    if (n > R + k || INPUT_MIN * n > r.remaining) return null;
    const record: InputRecord[] = [];
    for (let i = 0; i < n; i++) {
      const at = r.u8();
      if (r.bad || at >= R + k || seenIn[at] === j) return null;
      seenIn[at] = j;
      if (at >= R) {
        if (at - R > unused) return null;
        if (at - R === unused) unused++;
      }
      const x: InputRecord = { player: at < R ? roster[at]! : others[at - R]!, input: r.u16(), events: 0 };
      if (!readInputEvents(r, x, L)) return null;
      record.push(x);
    }
    inputs.push(record);
  }
  if (r.bad || unused !== k) return null;
  return { type: T.STATE, timeline, senderTick, phase, g, senderFinal, state, decoded, roster, others, inputs };
}

/** Total: anything malformed, inconsistent, out of §5's bounds or trailing is null, never an exception. */
export function decode(bytes: Uint8Array, P: SimParams = defaultParams, L: WireLimits = LIMITS): Message | null {
  // The limit first, before anything is read (§5.6).
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > L.messageMaxBytes) return null;
  const r = new Reader(bytes);
  let m: Message | null;
  switch (r.u8()) {
    case T.HELLO:
      m = readHello(r, L);
      break;
    case T.REFUSE: {
      const reason = r.u8();
      m = reason <= REFUSAL.SPECTATORS_FULL ? { type: T.REFUSE, reason } : null;
      break;
    }
    case T.TICK:
      m = readTick(r, L);
      break;
    case T.FWD: {
      // An origin, then a complete TICK, its type byte included (§5.4).
      const origin = r.hex(ID_BYTES);
      const tick = r.u8() === T.TICK ? readTick(r, L) : null;
      m = tick && { type: T.FWD, origin, tick };
      break;
    }
    case T.PEERS:
      m = readPeers(r, L);
      break;
    case T.AGAIN:
      m = { type: T.AGAIN };
      break;
    case T.STATE_REQ:
      m = { type: T.STATE_REQ, tick: r.u32(), want: r.hex(HASH_BYTES) };
      break;
    case T.STATE:
      m = readState(r, P, L);
      break;
    default:
      return null;
  }
  return m !== null && r.complete ? m : null;
}
