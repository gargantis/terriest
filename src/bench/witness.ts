// The forced repair's witness (M4's design, research/m4/DESIGN.md, §1.53,
// §2.11, §8.3; M3-Q14, M4-Q16): a real Session and timeline in a dedicated
// module Worker, so the #test=frames page can lose its tallies and repair
// from a real STATE while its own thread does only a real page's work.
// src/bench/virtual-room.ts starts it, with repair=1 alone, as
// new Worker(new URL('./witness.ts', import.meta.url), { type: 'module' }):
// a chunk of its own, same-origin, so the CSP's script-src 'self' covers
// it, and nothing imports it (the lint's lazy-imports), but its own test.
// It plays one of the seven virtual players:
// - its session's connections are the page's and the other virtual
//   players', each through the room: what they send it comes by
//   postMessage with the delay its link would take, FIFO on each
//   connection, and what it sends goes back for the room's queue to the
//   page; an answer to a STATE_REQ the page sent another virtual player
//   goes out as from that player's connection (replyAs), as its own join's
//   ask of one is the page's to answer;
// - it joins the page's timeline from a STATE, as any joiner does, plays
//   its terrier with the bot brain on its own drawn head, readies as the
//   room's players do, votes, and answers the page's STATE_REQ from its
//   history;
// - after each timer run it posts the final ticks' hashes it took since the
//   last, so the room's players vote them (§8.3), and again from the tick a
//   STATE takes it back to, so they never vote a hash it no longer holds.
// Its timer and clock are the Worker's own: performance.now() there has an
// origin of its own, so every time it's handed is a delay from now.

import { defaultBotParams } from '../core/bot/brain';
import { scriptSampler } from '../core/bot/setups';
import { decode, type Hello, type StateMsg, T } from '../core/protocol/messages';
import { Session } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, WARM_UP } from '../core/sim/index';
import { browserClock, type Clock } from '../ui/clock';
import type { FromWitness, ToWitness, WitnessFigures } from './virtual-room';

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const FIGURES_EVERY_MS = 1000; // not a setting: the report's
const LOG_SHOWN = 60; // not a setting: the report's

/** What the witness needs of its scope: the Worker's own, or a test's. */
export interface WitnessScope {
  postMessage(m: FromWitness): void;
  onmessage: ((e: { readonly data: ToWitness }) => void) | null;
}

interface Inbound {
  readonly due: number;
  readonly from: string;
  readonly bytes: Uint8Array;
  readonly replyAs: string | null;
}

/** The witness on a scope, its timer and clock `clock`'s, whose time origin is `origin`: a message's due
 *  time comes on the origin it shares with the room's, the page's. */
export function serveWitness(scope: WitnessScope, clock: Clock = browserClock, origin: number = performance.timeOrigin): void {
  let session: Session | null = null;
  let me = '';
  let replyAs: string | null = null;
  let stop: () => void = () => {};
  let readyAfter = 0;
  let readyAt = -1;
  /** The join of its terrier it last readied: a repair that moves its JOIN ends the session's wish (D-12). */
  let readiedFor = -1;
  let lastFinal = -1;
  let lastTimeline: unknown = null;
  let nextPingAt = 0;
  let nextFiguresAt = 0;
  const rtts = new Map<string, number>();
  const inbox: Inbound[] = [];
  const lastDue = new Map<string, number>();

  const fail = (e: unknown): void => {
    scope.postMessage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  };

  /** This side of a connection's handshake, as a transport's rounds end. */
  const join = (peer: string, hello: Hello, rttMs: number): void => {
    const s = session;
    if (s === null) return;
    const now = clock.now();
    const v = s.checkHello(hello, now, peer);
    if (!v.ok) {
      fail(new Error(`the witness refused ${peer}: reason ${v.reason}`));
      return;
    }
    s.onPeerJoin(peer, v.hello, s.hello(), now);
    s.onRtt(peer, rttMs, now);
    rtts.set(peer, rttMs);
  };

  const start = (m: Extract<ToWitness, { kind: 'init' }>): void => {
    const s = new Session({ P, B, net: NET, me: m.me, name: m.name, coat: m.coat, build: m.build, forwarding: true }, {
      send: (peer, bytes) => {
        // A STATE's tick and its sender's, read here, off the page's thread, for the report.
        const x = bytes[0] === T.STATE ? (decode(bytes, P) as StateMsg | null) : null;
        const at = origin + clock.now();
        scope.postMessage({ kind: 'send', to: peer, bytes, as: replyAs, at, ...(x === null ? {} : { state: { g: x.g, senderTick: x.senderTick } }) });
      },
      broadcast: (bytes) => scope.postMessage({ kind: 'broadcast', bytes, at: origin + clock.now() }),
    });
    session = s;
    me = m.me;
    readyAfter = m.readyAfterTicks;
    // Its terrier by the brain on its own drawn head, its press counters from the base a STATE hands (D-10).
    let sample = scriptSampler('brain', m.me, 0, P, B);
    s.controls = () => sample(s.timeline.head, s.timeline.headTick);
    s.onControl = (base) => {
      sample = scriptSampler('brain', m.me, base, P, B);
    };
    s.play(m.pack);
    for (const p of m.peers) join(p.peer, p.hello, p.rttMs);
    scope.postMessage({ kind: 'hello', hello: s.hello() });
    nextPingAt = clock.now() + NET.transport.pingEveryMs;
    stop = clock.every(NET.timerMs, () => {
      try {
        run(s);
      } catch (e) {
        stop();
        fail(e);
      }
    });
  };

  /** One timer run: what's due delivered in order, the advance, Ready, the round trips and the new finals. */
  const run = (s: Session): void => {
    const now = clock.now();
    while (inbox.length > 0 && inbox[0]!.due <= now) {
      const x = inbox.shift()!;
      replyAs = x.replyAs;
      try {
        s.onMessage(x.from, x.bytes, now);
      } finally {
        replyAs = null;
      }
    }
    s.advance(now);
    const t = s.timeline;
    // Ready readyAfter ticks after the final state shows its terrier, as the room's players do, and again
    // for each join of it a repair hands it, while it isn't ready in warm-up.
    const F = t.final;
    const k = t.started && F.phase === WARM_UP ? findTerrier(F, me) : -1;
    const T = k >= 0 ? F.terriers[k]! : null;
    if (T !== null && !(T.readyUntil > F.tick) && T.joinTick !== readiedFor) {
      if (readyAt < 0) readyAt = t.localTick + readyAfter;
      else if (t.localTick >= readyAt) {
        s.ready(true);
        readiedFor = T.joinTick;
        readyAt = -1;
      }
    }
    if (now >= nextPingAt) {
      nextPingAt = now + NET.transport.pingEveryMs;
      for (const [peer, ms] of rtts) s.onRtt(peer, ms, now);
    }
    if (now >= nextFiguresAt) {
      nextFiguresAt = now + FIGURES_EVERY_MS;
      scope.postMessage({ kind: 'figures', figures: figuresOf(s) });
    }
    // A STATE adopted, its repair's or its join's, or another timeline: its finals posted again from there, as
    // they're taken, so the room's players never vote a hash it no longer holds.
    if (t !== lastTimeline) {
      lastTimeline = t;
      lastFinal = -1;
    } else if (t.finalTick < lastFinal) {
      lastFinal = t.finalTick - 1;
    }
    if (t.started && t.finalTick > lastFinal) {
      const finals: [number, string][] = [];
      for (let g = Math.max(lastFinal + 1, t.finalTick - NET.timeline.history + 1); g <= t.finalTick; g++) {
        const hash = t.hashAt(g);
        if (hash !== '') finals.push([g, hash]);
      }
      lastFinal = t.finalTick;
      if (finals.length > 0) scope.postMessage({ kind: 'finals', finals });
    }
  };

  scope.onmessage = (e) => {
    const m = e.data;
    try {
      switch (m.kind) {
        case 'init':
          start(m);
          break;
        case 'join':
          join(m.peer, m.hello, m.rttMs);
          break;
        case 'message': {
          // On its own clock, and FIFO on its connection, as the room's links are.
          const due = Math.max(m.dueAt - origin, lastDue.get(m.from) ?? -Infinity);
          lastDue.set(m.from, due);
          let k = inbox.length;
          while (k > 0 && inbox[k - 1]!.due > due) k--;
          inbox.splice(k, 0, { due, from: m.from, bytes: m.bytes, replyAs: m.replyAs });
          break;
        }
        case 'close':
          stop();
          session = null;
          inbox.length = 0;
          break;
      }
    } catch (err) {
      fail(err);
    }
  };
}

/** Its timeline's figures, for the bench's report. */
function figuresOf(s: Session): WitnessFigures {
  const t = s.timeline;
  const x = t.stats;
  return {
    localTick: t.localTick, finalTick: t.finalTick,
    stats: {
      late: x.late, lateAbsent: x.lateAbsent, agree: x.agree, disagree: x.disagree, resyncs: x.resyncs, resyncFailed: x.resyncFailed, jumps: x.jumps,
      medianOffset: x.medianOffset, joinedAt: x.joinedAt, warmMs: x.warmMs, statesSent: x.statesSent, statesRefused: x.statesRefused,
    },
    log: x.log.slice(0, LOG_SHOWN).map(([tick, e]): [number, string] => [tick, e]),
  };
}

// The Worker's own start, in a worker's scope alone: on a page, or in a test, nothing runs.
const scopeType = (globalThis as { WorkerGlobalScope?: abstract new () => object }).WorkerGlobalScope;
if (scopeType !== undefined && globalThis instanceof scopeType) serveWitness(globalThis as unknown as WitnessScope);
