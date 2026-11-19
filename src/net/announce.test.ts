import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { decode, encodePeers, type Hello, PROTOCOL_VERSION, ROLE, T, TIMELINE_KIND } from '../core/protocol/messages';
import { type Accepted, commonRefusal, type Refusal, type RoomPeer } from '../core/session/room-peer';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, hash64, type Pack } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode } from './loopback';
import type { Transport } from './transport';

// What a page announces, and when (P7's peer side; M3 phase 4's fixes; M3's
// design, research/m3/DESIGN.md, §4.9, §4.10, §5.4): no TICK, its own or a
// FWD, goes to a peer before that peer was told the timeline it's for, in
// this side's HELLO or a PEERS, and a page takes no TICK or FWD from a peer
// that announces another timeline, so no timeline takes another's inputs,
// JOINs, votes or clock samples, and pages that hear of the winner only
// from a spectator that forwards to them follow it; a merge weighs again,
// once it adopts, what it heard meanwhile, aging each announcement by the
// time since it came; it waits out a holder's one-STATE_REQ-per-
// resyncRetryMs limit rather than ask in vain; and an announcement gives the
// timeline's clock tick, how old it is, not the final tick a warm-up holds
// back. Each test fails without its rule. And a rogue that announces a
// made-up timeline in every PEERS, another each time, gets one STATE_REQ
// each stateRequestRetryMs, so builds at most one timeline that often, and
// keeps no page from an honest merge, where each of its PEERS built a
// timeline and its fakes held the page off the honest winner (reviewer F2).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const id = (k: number): string => personId(27, k);
/** A timeline ID of one hex digit sixteen times: the smaller digit is the smaller ID. */
const tl = (c: string): string => c.repeat(16);

/** The TICKs each page sent, by its player ID and the TICK's hash: the timeline it held then. */
type Sent = Map<string, string>;

/** A page that takes a TICK or a FWD on a timeline other than the one its sender sent it on, when the
 *  timeline it holds counts the inputs it took (receivedInputs). */
interface Leak {
  readonly at: number;
  readonly to: string;
  readonly from: string;
  readonly sentOn: string;
  readonly heldOn: string;
}

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. It
 *  keeps the timelines it took, in order, and the leaks it saw. */
class GameSession extends Session {
  /** The timelines it took, and when. */
  readonly at: { readonly id: string; readonly at: number }[] = [];
  readonly leaks: Leak[] = [];
  sent: Sent = new Map();
  private last = -1;

  override onMessage(peer: string, bytes: Uint8Array, now: number): void {
    const t = this.timeline;
    const before = t.stats.receivedInputs;
    const held = t.started ? t.id : '';
    super.onMessage(peer, bytes, now);
    if (this.timeline.started && (this.timeline !== t || held === '')) this.at.push({ id: this.timeline.id, at: now });
    if ((bytes[0] !== T.TICK && bytes[0] !== T.FWD) || this.timeline !== t || t.stats.receivedInputs === before) return;
    // A FWD: its origin's player ID, then its TICK.
    const from = bytes[0] === T.TICK ? idOf(peer) : [...bytes.subarray(1, 17)].map((x) => x.toString(16).padStart(2, '0')).join('');
    const tick = bytes[0] === T.TICK ? bytes : bytes.subarray(17);
    const sentOn = this.sent.get(`${from} ${hash64(tick)}`);
    if (sentOn !== undefined && sentOn !== held) this.leaks.push({ at: now, to: this.cfg.me, from, sentOn, heldOn: held });
  }

  /** The timelines it took, in order. */
  get took(): string[] {
    return this.at.map((x) => x.id);
  }

  /** When it took `t`, −1 if it didn't. */
  tookAt(t: string): number {
    return this.at.find((x) => x.id === t)?.at ?? -1;
  }

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
  }
}

type Node = LoopNode<GameSession>;
type Room = NetPump<LoopbackNet>;

/** Node n<k>'s player. */
const idOf = (node: string): string => id(Number(node.slice(1)));

/** One way, these ms for the pairs named n<k>|n<j>, else `base`, no jitter. */
function links(base: number, pairs: Record<string, number> = {}): (a: string, b: string) => LinkSpec {
  return (a, b) => ({ base: pairs[a < b ? `${a}|${b}` : `${b}|${a}`] ?? base, jitter: 0 });
}

/** The link, the TICKs it carries recorded with the timeline its page held when it sent them. */
function tagging(link: Transport, sent: Sent, me: string, held: () => string): Transport {
  const out = Object.create(link) as Transport;
  const tag = (bytes: Uint8Array): void => {
    if (bytes[0] === T.TICK && held() !== '') sent.set(`${me} ${hash64(bytes)}`, held());
  };
  out.send = (peer, bytes) => {
    tag(bytes);
    link.send(peer, bytes);
  };
  out.broadcast = (bytes) => {
    tag(bytes);
    link.broadcast(bytes);
  };
  return out;
}

/** Page k, its own input idle, its TICKs tagged in the room's `sent`. */
function node(room: Room, sent: Sent, k: number, o: { verify?: number } = {}): Node {
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P: defaultParams, B: defaultBotParams, net: NET, me: id(k), name: `P${k}`, coat: k % defaultParams.coatCount, build: TEST_BUILD,
          forwarding: true, mode, verify: o.verify ?? 0,
        };
        const box: { s: GameSession | null } = { s: null };
        const s = new GameSession(cfg, tagging(link as Transport, sent, id(k), () => (box.s?.timeline.started ? box.s.timeline.id : '')));
        box.s = s;
        s.sent = sent;
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

function room(base: number, pairs: Record<string, number> = {}): { room: Room; sent: Sent } {
  return { room: new NetPump(new LoopbackNet(1, links(base, pairs))), sent: new Map() };
}

/** Every pair of these nodes blocked but the given ones, written n<k>|n<j>. */
function blockAllBut(r: Room, ks: readonly number[], open: readonly string[]): void {
  for (const a of ks) for (const b of ks) if (a < b && !open.includes(`n${a}|n${b}`)) r.net.block(`n${a}`, `n${b}`);
}

/** k proposes timeline `t` at `at`, 1 minute, 2 a side, playing in `pack`. */
function proposes(r: Room, n: Node, at: number, t: string, pack: Pack): void {
  r.net.join(n, at, (now) => {
    n.session.propose(n.local(now), { packSize: 2, matchMinutes: 1 }, t);
    n.session.play(pack);
  });
}

/** One timeline at the end, held by every node, agreeing, with no problem, no leak and no verify mismatch. */
function expectOne(r: Room, nodes: readonly Node[], want: string): void {
  for (const n of nodes) expect([n.session.timeline.started, n.session.timeline.id], n.id).toEqual([true, want]);
  for (const n of nodes) expect(n.session.leaks, n.id).toEqual([]);
  for (const n of nodes) expect(n.session.timeline.stats.verifyMismatches, n.id).toBe(0);
  expect(r.problems).toEqual([]);
  expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
}

describe('announcing the timeline held (P7, M3 phase 4)', () => {
  /** o holds b's timeline; x, which reaches o only through w, proposes c's at once, before meeting w;
   *  w meets o and x while it holds none, so its HELLO tells them of none, and joins b's, the better:
   *  b's ID is the smaller and the two are a tie. Then w's TICKs, or its FWDs of o's, reach x, on c's,
   *  and x's TICKs reach w, on b's. Each page tells the other the timeline before the first that's for
   *  it, and takes none from a page of another, so no timeline takes another's input; and x learns of
   *  b's from w at once, and moves there. */
  function told(play: boolean): void {
    const { room: r, sent } = room(40, { 'n0|n1': 15, 'n1|n2': 20 });
    const [o, w, x] = [node(r, sent, 0, { verify: 8 }), node(r, sent, 1), node(r, sent, 2)];
    blockAllBut(r, [0, 1, 2], ['n0|n1', 'n1|n2']);
    proposes(r, o, 0, tl('b'), 0);
    proposes(r, x, 100, tl('c'), 1);
    r.net.join(w, 200, () => (play ? w.session.play(1) : w.session.watch()));
    r.run(6000);
    expectOne(r, [o, w, x], tl('b'));
    expect(w.session.took).toEqual([tl('b')]);
    expect(x.session.took).toEqual([tl('b')]);
    // At once, not at w's next PEERS, peersEveryMs after its last.
    expect(x.session.tookAt(tl('b')) - w.session.tookAt(tl('b'))).toBeLessThan(NET.room.stateRequestRetryMs);
  }

  it('takes no FWD of another timeline: a watcher that told a peer of none tells it the timeline before its first FWD', () => told(false));

  it('takes no TICK of another timeline: a player that told a peer of none tells it the timeline before its first TICK', () => told(true));

  it('lets the pages that hear of the winner only from a spectator follow it', () => {
    // Two halves: n0 and n1 on a's timeline, 1.5 s older; n2 and n3 on b's. s, a watcher linked to n2
    // and n3, joins b's, and meets n0 and n1 at 3 s: it moves to a's, and its FWDs of their TICKs tell
    // n2 and n3, which reach a's holders only through it.
    const { room: r, sent } = room(40);
    const [a0, a1, b0, b1, s] = [0, 1, 2, 3, 4].map((k) => node(r, sent, k, k === 0 ? { verify: 8 } : {})) as [Node, Node, Node, Node, Node];
    blockAllBut(r, [0, 1, 2, 3, 4], ['n0|n1', 'n2|n3', 'n2|n4', 'n3|n4']);
    proposes(r, a0, 0, tl('a'), 0);
    r.net.join(a1, 200, () => a1.session.play(1));
    proposes(r, b0, 1500, tl('b'), 0);
    r.net.join(b1, 1700, () => b1.session.play(1));
    r.net.join(s, 2000, () => s.session.watch());
    r.net.at(3000, () => {
      r.net.unblock('n0', 'n4');
      r.net.unblock('n1', 'n4');
    });
    r.run(7000);
    expectOne(r, [a0, a1, b0, b1, s], tl('a'));
    expect(s.session.took).toEqual([tl('b'), tl('a')]);
    // At once, not at s's next PEERS, peersEveryMs after its last.
    for (const n of [b0, b1]) expect(n.session.tookAt(tl('a')) - s.session.tookAt(tl('a')), n.id).toBeLessThan(NET.room.stateRequestRetryMs);
  });

  it('weighs again, once a merge adopts, an announcement heard while it was under way, and moves on at once', () => {
    // Three timelines, a's the oldest, then b's, then c's, each 1.5 s apart. c's proposer meets b's
    // holder and, while its merge waits for b's STATE, a's holder, over a faster link: once it holds
    // b's, a's beats it, and its merge to a's goes at once, not at a's next PEERS.
    const { room: r, sent } = room(40, { 'n0|n2': 15, 'n1|n2': 60 });
    const [a, b, c] = [node(r, sent, 0, { verify: 8 }), node(r, sent, 1), node(r, sent, 2)];
    blockAllBut(r, [0, 1, 2], []);
    proposes(r, a, 0, tl('a'), 0);
    proposes(r, b, 1500, tl('b'), 1);
    proposes(r, c, 3000, tl('c'), 0);
    // c meets b at 4.12 s and asks it for its STATE, which comes at 4.24 s; it meets a at 4.16 s.
    r.net.at(4000, () => r.net.unblock('n1', 'n2'));
    r.net.at(4130, () => r.net.unblock('n0', 'n2'));
    r.run(8000);
    expect(c.session.took).toEqual([tl('b'), tl('a')]);
    expect(c.session.tookAt(tl('a')) - c.session.tookAt(tl('b'))).toBeLessThan(NET.room.stateRequestRetryMs);
    expectOne(r, [a, b, c], tl('a'));
  });

  it('ages an announcement by the time since it came, so one heard a while ago ranks as its timeline stands now', () => {
    // b's timeline is 1.2 s older than a's, beyond the tie, but has the larger ID; c's is the youngest.
    // c meets a's holder and asks it for its STATE, the ask 300 ms late; meanwhile it hears b's
    // holder's announcement. Once it holds a's, it weighs b's as it stands then: 1.2 s older, not
    // 0.8 s, a tie a's smaller ID would win.
    const { room: r, sent } = room(40, { 'n0|n2': 15, 'n1|n2': 60 });
    const [y, x, c] = [node(r, sent, 0, { verify: 8 }), node(r, sent, 1), node(r, sent, 2)];
    blockAllBut(r, [0, 1, 2], []);
    proposes(r, y, 300, tl('b'), 0);
    proposes(r, x, 1500, tl('a'), 1);
    proposes(r, c, 3000, tl('c'), 0);
    r.net.at(4000, () => {
      r.net.unblock('n1', 'n2');
      r.net.delayNext('n2', 'n1', (bytes) => bytes[0] === T.STATE_REQ, 300);
    });
    r.net.at(4130, () => r.net.unblock('n0', 'n2'));
    r.run(8000);
    expect(c.session.took).toEqual([tl('a'), tl('b')]);
    expect(c.session.tookAt(tl('b')) - c.session.tookAt(tl('a'))).toBeLessThan(NET.room.stateRequestRetryMs);
    expectOne(r, [y, x, c], tl('b'));
  });

  it("waits out a holder's one STATE_REQ per resyncRetryMs before asking it to merge, rather than ask in vain", () => {
    // j joins b's timeline from h, the only page it reaches; h then meets a's proposer, whose timeline
    // is 1.5 s older, and moves there within resyncRetryMs of answering j. j's merge must ask h again,
    // and waits until h would answer, rather than give up and wait for h's next PEERS.
    const { room: r, sent } = room(40);
    const [y, h, j] = [node(r, sent, 0, { verify: 8 }), node(r, sent, 1), node(r, sent, 2)];
    blockAllBut(r, [0, 1, 2], ['n1|n2']);
    proposes(r, y, 0, tl('a'), 0);
    proposes(r, h, 1500, tl('b'), 1);
    r.net.join(j, 3000, () => j.session.play(0));
    r.run(3000);
    r.until(() => j.session.timeline.started, 2000);
    const joinedAt = r.net.now;
    r.net.unblock('n0', 'n1');
    r.run(4000);
    expect(h.session.took).toEqual([tl('a')]);
    expect(j.session.took).toEqual([tl('b'), tl('a')]);
    // Once h would answer, resyncRetryMs after j's join asked it, not at h's next PEERS.
    expect(j.session.tookAt(tl('a')) - joinedAt).toBeGreaterThan(NET.timeline.resyncRetryMs - 100);
    expect(j.session.tookAt(tl('a')) - joinedAt).toBeLessThan(NET.room.stateRequestRetryMs);
    expectOne(r, [y, h, j], tl('a'));
  });

  it("announces the timeline's clock tick, how old it is, not the final tick a warm-up holds back", () => {
    // j's warm-up waits warmupMs for a watcher, which sends nothing, holding its final tick back.
    const { room: r, sent } = room(40);
    const [k, w, j] = [node(r, sent, 0), node(r, sent, 1), node(r, sent, 2)];
    proposes(r, k, 0, tl('a'), 0);
    r.net.join(w, 200, () => w.session.watch());
    r.net.join(j, 1000, () => j.session.play(1));
    r.until(() => j.session.timeline.started, 2000);
    r.run(NET.timeline.warmupMs / 2);
    const t = j.session.timeline;
    expect(t.warming, JSON.stringify(t.stats.log)).toBe(true);
    const h = j.session.hello();
    const clock = Math.floor(t.clock(j.local(r.net.now)));
    expect(h.finalTick).toBeGreaterThanOrEqual(clock - 1);
    expect(h.finalTick).toBeLessThanOrEqual(clock);
    expect(h.finalTick).toBeGreaterThan(t.finalTick + t.cfg.delay + t.cfg.window);
  });

  it("builds at most one timeline each stateRequestRetryMs for a rogue's flood of made-up announcements, and still merges to the honest winner", () => {
    // c and d hold a's timeline; e and f hold b's, 300 ms younger; e alone links the halves, from 2 s,
    // to both of c and d.
    // From 1 s, a rogue linked to e alone, its HELLO claiming b's, sends a PEERS every timer run, each
    // announcing another made-up timeline, far older than any.
    const { room: r, sent } = room(30);
    const [c, d, e, f] = [0, 1, 2, 3].map((k) => node(r, sent, k, k === 0 ? { verify: 8 } : {})) as [Node, Node, Node, Node];
    blockAllBut(r, [0, 1, 2, 3], ['n0|n1', 'n2|n3']);
    proposes(r, c, 0, tl('a'), 0);
    r.net.join(d, 100, () => d.session.play(1));
    proposes(r, e, 300, tl('b'), 0);
    r.net.join(f, 400, () => f.session.play(1));
    const rogue = r.net.add('r', (link) => new Rogue(link as Transport, tl('b')));
    for (const x of ['n0', 'n1', 'n3']) r.net.block('r', x);
    r.net.join(rogue, 1000);
    let k = 0;
    rogue.session.each = () => {
      const fake = { timeline: (k++ % 2 === 0 ? 'f1' : 'f2').repeat(8), timelineKind: TIMELINE_KIND.LIVE, finalTick: 4_000_000_000, hash: '0000000000000001' };
      if (rogue.session.joined.has('n2')) rogue.session.link.send('n2', encodePeers([], ROLE.SPECTATOR, fake));
    };
    r.net.at(2000, () => {
      r.net.unblock('n0', 'n2');
      r.net.unblock('n1', 'n2');
    });
    r.run(8000);
    // With the rogue still there, every page on a's.
    expectOne(r, [c, d, e, f], tl('a'));
    expect(k).toBeGreaterThan(1000);
    // e asked the rogue once in each merge, a merge each stateRequestRetryMs at most.
    const ms = r.net.now - 1000;
    expect(rogue.session.asks).toBeGreaterThan(0);
    expect(rogue.session.asks).toBeLessThanOrEqual(ms / NET.room.stateRequestRetryMs + 2);
  });
});

/** A peer of the test's own: its HELLO claims a timeline it doesn't hold; it counts the STATE_REQs it's
 *  sent, answering none, and sends what the test hands it each timer run. */
class Rogue implements RoomPeer {
  readonly joined = new Set<string>();
  asks = 0;
  each: ((now: number) => void) | null = null;
  readonly link: Transport;
  private readonly claims: string;

  constructor(link: Transport, claims: string) {
    this.link = link;
    this.claims = claims;
  }

  hello(): Hello {
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: id(9), role: ROLE.SPECTATOR, timeline: this.claims,
      timelineKind: TIMELINE_KIND.LIVE, phase: 0, finalTick: 1, hash: '0123456789abcdef', name: 'R',
    };
  }

  checkHello(hello: Hello): Accepted | Refusal {
    return commonRefusal(hello, TEST_BUILD, id(9)) ?? { ok: true, hello };
  }

  onPeerJoin(peer: string): void {
    this.joined.add(peer);
  }

  onHandshakeFailed(): void {}

  onPeerLeave(peer: string): void {
    this.joined.delete(peer);
  }

  onRtt(): void {}

  onMessage(_peer: string, bytes: Uint8Array): void {
    if (decode(bytes)?.type === T.STATE_REQ) this.asks++;
  }

  advance(now: number): void {
    this.each?.(now);
  }
}
