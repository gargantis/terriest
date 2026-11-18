import { describe, expect, it } from 'vitest';
import { config } from '../../config';
import { decodeState, encodeState as encodeMatchState } from '../sim/codec';
import { JOIN, READY, SWITCH } from '../sim/input';
import { everyone, join, newMatch, tick as step } from '../sim/match-testing';
import { defaultParams } from '../sim/params';
import { genesis, IN_PLAY, type MatchState } from '../sim/state';
import {
  type BotEntry, decode, encodeAgain, encodeFwd, encodeHello, encodePeers, encodeRefuse, encodeState, encodeStateReq, encodeTick,
  type InputRecord, NO_TICK, ROLE, type SenderInput, type StateMsg, type Tick, TIMELINE_KIND, wireLimits, ZERO_HASH,
} from './messages';

// §5's sizes (D-18, D-20; design §5.1–§5.5): a TICK in 28 + 2m bytes and
// each bot in 23 + 2m more, HELLO in 51 + n, the small messages; and the
// largest STATEs, in play, in warm-up and at 12 senders a tick, each
// carrying every input tick under messageMaxBytes, with every input
// differing. D-20 estimated a TICK at 35 bytes; the load run measures the
// traffic (§8.5).

const P = defaultParams;
const L = wireLimits();
const id = (k: number): string => (k + 1).toString(16).padStart(32, '0');
const hash = 'a1b2c3d4e5f60718';
const utf8 = (s: string): number => new TextEncoder().encode(s).length;

/** A name of 32 bytes in 16 characters, within C-17's limits. */
const longName = (k: number): string => `${'é'.repeat(15)}${String.fromCharCode(0xe0 + k)}`;

/** A sender's input with its whole history present, the first m entries
 *  differing from the next newer and the rest the same. */
function held(input: number, m: number): SenderInput {
  const hist: number[] = [];
  let newer = input;
  for (let k = 0; k < L.inputHistory; k++) {
    const v = k < m ? (newer + 1) & 0xffff : newer;
    hist.push(v);
    newer = v;
  }
  return { input, present: 0xffff, hist, events: [] };
}

const tick = (own: SenderInput | null, bots: BotEntry[] = []): Omit<Tick, 'type'> =>
  ({ t: 600, own, voteTick: 580, voteHash: hash, phase: 0.5, bots });

/** 4 a side, both packs full of 32-byte names, in play. */
function eightInPlay(): MatchState {
  const m = newMatch(P, 4, 3);
  step(m, Array.from({ length: 8 }, (_, k) => join(id(k), k & 1, READY, { coat: k, name: longName(k) })));
  for (let n = 0; m.s.phase !== IN_PLAY && n < 1000; n++) step(m, everyone(m.s));
  expect(m.s.phase).toBe(IN_PLAY);
  return m.s;
}

/** A 2-a-side warm-up with two terriers, a few ticks in. */
function twoInWarmUp(): MatchState {
  const m = newMatch(P, 2);
  step(m, [join(id(0), 0, READY, { coat: 1, name: 'Ana' }), join(id(1), 1, 0, { coat: 2, name: 'Bo' })]);
  for (let k = 0; k < 4; k++) step(m, everyone(m.s));
  return m.s;
}

/** A warm-up with nobody in it yet, at a tick well into it. */
function emptyWarmUp(): MatchState {
  const s = genesis({ packSize: 4, matchMinutes: 3 }, P);
  s.tick = 5000;
  return s;
}

/** Records for ticks g + 1 … g + n: each sender's input every tick, every
 *  input differing, and each joiner's JOIN, with its name, and READY every
 *  30 ticks. */
function records(n: number, senders: readonly string[], joiners: readonly string[] = []): InputRecord[][] {
  const out: InputRecord[][] = [];
  for (let i = 0; i < n; i++) {
    out.push(senders.map((player, k) => {
      const x: InputRecord = { player, input: (i * senders.length + k + 1) & 0xffff, events: 0 };
      const j = joiners.indexOf(player);
      if (j >= 0 && i % 30 === 0) {
        x.events = JOIN | READY;
        x.joinPack = j & 1;
        x.coat = j;
        x.name = longName(j);
      }
      return x;
    }));
  }
  return out;
}

/** A STATE at s's tick, its records from g + 1 on, the clock `ahead` past
 *  g and the sender's final tick 255 past it: a late-vote repair (§5.5). */
function stateOf(s: MatchState, inputs: InputRecord[][], ahead = 267): { bytes: Uint8Array; kept: number } {
  const g = s.tick;
  return encodeState(
    { timeline: hash, senderTick: g + ahead, phase: 0.5, g, senderFinal: g + 255, state: encodeMatchState(s), inputs },
    s.terriers.map((x) => x.id),
  );
}

describe("the messages' sizes (design §5)", () => {
  it('sends a TICK in 28 + 2m bytes, m the present inputs that differ, and each bot in 23 + 2m more (§5.3)', () => {
    // A held anchored input with its whole history present: 28 bytes.
    expect(encodeTick(tick(held(0x0123, 0))).length).toBe(28);
    for (let m = 0; m <= L.inputHistory; m++) expect(encodeTick(tick(held(0x4567, m))).length).toBe(28 + 2 * m);
    // Absent ticks cost nothing; one after an absent tick is written.
    expect(encodeTick(tick({ input: 1, present: 0, hist: new Array<number>(16).fill(0), events: [] })).length).toBe(28);
    expect(encodeTick(tick({ ...held(1, 0), present: 0b101 })).length).toBe(28 + 2);
    for (let m = 0; m <= L.inputHistory; m += 4) {
      const bot = { ...held(9, m), id: id(40) };
      expect(encodeTick(tick(held(3, 5), [bot])).length).toBe(28 + 2 * 5 + 23 + 2 * m);
      // A spectator hosting bots: no input of its own.
      expect(encodeTick(tick(null, [bot, { ...bot, id: id(41) }])).length).toBe(28 + 2 * (23 + 2 * m));
    }
    // Events: 2 bytes each, JOIN's pack, coat and name and SWITCH's pack more.
    const events = { ...held(3, 0), events: [{ back: 0, events: READY }, { back: 1, events: JOIN | SWITCH, joinPack: 0, coat: 3, name: 'Rex', switchPack: 1 }] };
    expect(encodeTick(tick(events)).length).toBe(28 + 2 + (2 + 2 + 1 + utf8('Rex')) + (2 + 1));
  });

  it('sends HELLO in 51 bytes and its name, and REFUSE, PEERS, AGAIN, STATE_REQ and FWD at theirs (§5.1–§5.4)', () => {
    for (const name of ['', 'Rex', longName(0), '\ufeffZoë']) {
      const b = encodeHello({
        protocol: 1, build: hash, player: id(1), role: ROLE.UNDECIDED, timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name,
      });
      expect(b.length).toBe(51 + utf8(name));
    }
    expect(utf8(longName(0))).toBe(config.displayNameMaxBytes);
    expect(encodeRefuse(2).length).toBe(2);
    for (const n of [0, 1, L.peersMax]) expect(encodePeers(Array.from({ length: n }, (_, k) => id(k)), ROLE.PLAYER).length).toBe(3 + 16 * n);
    expect(encodeAgain().length).toBe(1);
    expect(encodeStateReq(NO_TICK, ZERO_HASH).length).toBe(13);
    const t = encodeTick(tick(held(3, 2)));
    expect(encodeFwd(id(5), t).length).toBe(17 + t.length);
  });

  it("carries every input tick of the largest STATEs under messageMaxBytes: in play, in warm-up and at 12 senders a tick (§5.5, D-18)", () => {
    const play = eightInPlay();
    const warm = emptyWarmUp();
    expect(encodeMatchState(play).length).toBe(1512);
    expect(encodeMatchState(warm).length).toBe(120);
    const terriers = play.terriers.map((x) => x.id);
    const joiners = Array.from({ length: 8 }, (_, k) => id(100 + k));
    const candidates = joiners.slice(0, 4);
    // 269 records: from 255 ticks back to localTick + d. Then the bounds' most, senderTick + d − g.
    const most = L.historyTicks + 2 * L.window + L.delay + L.delay;
    const cases: [string, MatchState, InputRecord[][], number, number][] = [
      // 28 bytes of header and counts, the state, 33 bytes a record of 8 inputs: D-18's "about 10.4 KB".
      ['in play', play, records(269, terriers), 267, 28 + 1512 + 269 * 33],
      ['in play, at the bounds', play, records(most, terriers), most - L.delay, 28 + 1512 + most * 33],
      // The empty roster's 120 bytes, the 8 joiners in the table, and 72 JOINs of 36 bytes with their READYs.
      ['in warm-up', warm, records(269, joiners, joiners), 267, 28 + 120 + 8 * 16 + 269 * 33 + 72 * (36 + 1)],
      ['in warm-up, at the bounds', warm, records(most, joiners, joiners), most - L.delay, 28 + 120 + 8 * 16 + most * 33 + 80 * (36 + 1)],
      // 8 terriers and 4 candidates in the table, 49 bytes a record.
      ['at 12 senders', play, records(269, [...terriers, ...candidates]), 267, 28 + 1512 + 4 * 16 + 269 * 49],
      ['at 12 senders, at the bounds', play, records(most, [...terriers, ...candidates]), most - L.delay, 28 + 1512 + 4 * 16 + most * 49],
    ];
    for (const [what, s, inputs, ahead, size] of cases) {
      const { bytes, kept } = stateOf(s, inputs, ahead);
      expect([kept, bytes.length], what).toEqual([inputs.length, size]);
      expect(bytes.length, what).toBeLessThan(L.messageMaxBytes);
      const m = decode(bytes) as StateMsg | null;
      expect(m?.inputs, what).toEqual(inputs);
    }
    // The design's figures: 10,417 bytes, about 11.8 KB and about 14.8 KB.
    expect(stateOf(play, records(269, terriers)).bytes.length).toBe(10417);
    expect(Math.round(stateOf(warm, records(269, joiners, joiners)).bytes.length / 100) / 10).toBe(11.8);
    expect(Math.round(stateOf(play, records(269, [...terriers, ...candidates])).bytes.length / 100) / 10).toBe(14.8);
  });

  it('keeps only the records that fit, says how many, and tables only their IDs', () => {
    // Every candidate JOINs, named, in every tick: more than fits.
    const play = eightInPlay();
    const candidates = Array.from({ length: 4 }, (_, k) => id(100 + k));
    const terriers = play.terriers.map((x) => x.id);
    const inputs = records(269, [...terriers, ...candidates]).map((r) =>
      r.map((x) => (candidates.includes(x.player) ? { ...x, events: JOIN | SWITCH, joinPack: 1, coat: 2, name: longName(3), switchPack: 0 } : x)));
    const { bytes, kept } = stateOf(play, inputs);
    expect(bytes.length).toBeLessThanOrEqual(L.messageMaxBytes);
    expect(kept).toBeLessThan(inputs.length);
    // One more record would not have fitted: 8 inputs of 4 bytes, and 4 with a JOIN of 36 and a SWITCH of 2.
    const record = 1 + 8 * 4 + 4 * (4 + 36 + 2);
    expect(bytes.length + record).toBeGreaterThan(L.messageMaxBytes);
    const m = decode(bytes) as StateMsg;
    expect([m.inputs, m.others]).toEqual([inputs.slice(0, kept), candidates]);
    // A new ID every tick: the table's u8 count stops it at 255, the state's
    // roster empty.
    const warm = emptyWarmUp();
    const fresh = Array.from({ length: 300 }, (_, i) => [{ player: id(1000 + i), input: i, events: 0 }]);
    const t = stateOf(warm, fresh, 282);
    expect(t.kept).toBe(255);
    const back = decode(t.bytes) as StateMsg;
    expect([back.others.length, back.inputs.length, back.decoded.terriers.length]).toEqual([255, 255, 0]);
    expect(decodeState(back.state)).not.toBeNull();
    // With two terriers, indices stop at 255: 254 table entries.
    const two = twoInWarmUp();
    const u = stateOf(two, fresh, 282);
    expect(u.kept).toBe(254);
    expect((decode(u.bytes) as StateMsg).others).toEqual(fresh.slice(0, 254).map((r) => r[0]!.player));
  });

  it('fills a STATE to exactly messageMaxBytes, its header counted, and no further', () => {
    const two = twoInWarmUp();
    const n = encodeMatchState(two).length;
    expect(n).toBe(409);
    // 192 records of both terriers' JOINs with 32-byte names, 81 bytes each: 15,989 bytes with the
    // header's 28 and the state; then one JOIN whose name fills the rest, 9 bytes and the name.
    const join32 = (player: string, input: number, name: string): InputRecord => ({ player, input, events: JOIN, joinPack: 0, coat: 0, name });
    const ids = two.terriers.map((x) => x.id);
    const inputs = (last: string): InputRecord[][] => [
      ...Array.from({ length: 192 }, (_, i) => ids.map((p) => join32(p, i, 'x'.repeat(32)))),
      [join32(ids[0]!, 7, last)],
    ];
    expect(28 + n + 192 * 81).toBe(15989);
    const exact = stateOf(two, inputs('ab'), 282);
    expect([exact.kept, exact.bytes.length]).toEqual([193, L.messageMaxBytes]);
    expect((decode(exact.bytes) as StateMsg).inputs).toEqual(inputs('ab'));
    const over = stateOf(two, inputs('abc'), 282);
    expect([over.kept, over.bytes.length]).toEqual([192, 15989]);
  });

  it("caps a sender's events at the u8 count, 255 (§5.3)", () => {
    // 60 backs past the history, each with all five kinds: 300, of which 255 ride.
    const events = Array.from({ length: 60 }, (_, k) => ({ back: L.inputHistory + 1 + k, events: 31, joinPack: 0, coat: 0, name: '', switchPack: 0 }));
    const m = decode(encodeTick(tick({ input: 1, present: 0, hist: new Array<number>(16).fill(0), events }))) as Tick;
    const kinds = (e: number): number => [1, 2, 4, 8, 16].filter((b) => (e & b) !== 0).length;
    expect(m.own!.events.reduce((sum, e) => sum + kinds(e.events), 0)).toBe(255);
    expect(m.own!.events.map((e) => e.back)).toEqual(events.slice(0, 51).map((e) => e.back));
  });
});
