// Practice (PLAN D-22, Q-15, P10, PLAN §8's Practice paragraph; M3's design,
// research/m3/DESIGN.md, §1.17, §6.4): a networked match's session and
// timeline over the local transport, so Practice runs a networked match's
// code path and contacts no one. This browser proposes, plays in the first
// pack and hosts every bot, each always ready, and with no other voter its
// timeline trusts its own state (D-22). The clock stops for the menu (Q-15);
// a gap over stallMs between timer runs, the start counting as run zero,
// stops it too, at the local tick, so none of the gap is caught up; a
// shorter catch-up records every tick's local inputs, under
// practiceSettings (D-22). Switch pack swaps the player with the other
// pack's newest bot in one tick: that bot's LEAVE, the player's
// SWITCH and a new bot's JOIN for the player's old pack, which D-12's order
// in a tick lands together (D-22). New at M3: roslambo's practice was a
// networked room with bots, which D-22 rejects. Pure: the caller passes
// `now` (ms, monotonic) and the link, Practice's LocalTransport.

import type { BotParams } from '../bot/brain';
import { findTerrier, JOIN, type MatchSettings, type Pack, READY, type SimParams, SWITCH, WARM_UP } from '../sim/index';
import type { HostedBot } from './bots';
import type { Link } from './room-peer';
import { Session } from './session';
import { type NetSettings, practiceSettings } from './settings';

export interface PracticeConfig {
  readonly P: SimParams;
  readonly B: BotParams;
  /** practiceSettings of it is what runs, whatever it's given, so a catch-up keeps every tick (D-22). */
  readonly net: NetSettings;
  readonly me: string;
  readonly name: string;
  readonly coat: number;
  readonly settings: MatchSettings;
  readonly build: string;
  /** Tests: the full replay (D-11) and the chain's checks (§2.7), as the session takes them. */
  readonly mode?: 'incremental' | 'fullReplay';
  readonly verify?: number;
}

/** What a timer run did: ran, catching up if it came late; stalled, a gap over stallMs stopped the
 *  clock instead (the glue opens the menu); paused, nothing (Q-15). */
export type PracticeRun = 'ran' | 'stalled' | 'paused';

const ID_BYTES = 8; // not a setting: a proposal's random bytes, as roslambo's randomTimelineId

/** A Practice timeline's ID: the bytes in the 16 lowercase hex characters every timeline ID takes,
 *  never all zero, which means none (PLAN §9). */
export function practiceTimelineId(random: Uint8Array): string {
  const bytes = Array.from({ length: ID_BYTES }, (_, k) => random[k] ?? 0);
  if (!bytes.some((b) => b !== 0)) bytes[ID_BYTES - 1] = 1;
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const freshId = (): string => practiceTimelineId(crypto.getRandomValues(new Uint8Array(ID_BYTES)));

/** The newest wanted bot hosted for pack, as BotHost.remove picks it. */
function newestIn(hosted: readonly HostedBot[], pack: Pack): HostedBot | null {
  for (let i = hosted.length - 1; i >= 0; i--) {
    const b = hosted[i]!;
    if (b.wanted && b.pack === pack) return b;
  }
  return null;
}

export class PracticeSession {
  /** As given, with practiceSettings applied to net. */
  readonly cfg: PracticeConfig;
  readonly session: Session;
  private readonly link: Link;
  private sample: () => number = () => 0;
  /** The last timer run, which a stall's gap is measured from: the start's, as run zero, so a page
   *  frozen before its first timer run stalls too (D-22, as NetGame counts it); a resume's after a
   *  pause. */
  private lastRun: number | null = null;

  constructor(cfg: PracticeConfig, link: Link) {
    const net = practiceSettings(cfg.net);
    this.cfg = { ...cfg, net };
    this.link = link;
    this.session = new Session(
      {
        P: cfg.P, B: cfg.B, net, me: cfg.me, name: cfg.name, coat: cfg.coat, build: cfg.build, forwarding: false,
        ...(cfg.mode !== undefined ? { mode: cfg.mode } : {}),
        ...(cfg.verify !== undefined ? { verify: cfg.verify } : {}),
      },
      link,
    );
  }

  /** The menu's pause, or a stall's (Q-15). */
  get paused(): boolean {
    return this.session.timeline.paused;
  }

  /** This browser's own input, sampled once a sent tick; again() passes it on. */
  set controls(sample: () => number) {
    this.sample = sample;
    this.session.controls = sample;
  }

  /** Genesis, now: the player JOINs the first pack (Q-15), and bots fill every other place, each with
   *  READY in its JOIN and renewed before it expires (C-41), so each is always ready. */
  start(now: number, timelineId: string = freshId()): void {
    const s = this.session;
    s.propose(now, this.cfg.settings, timelineId);
    this.lastRun = now;
    s.play(0);
    const size = this.cfg.settings.packSize;
    let added = 0;
    for (let k = 1; k < size; k++) if (s.addBot(0)) added++;
    for (let k = 0; k < size; k++) if (s.addBot(1)) added++;
    // BOT_SLOTS holds Practice's 7 at 4 a side and a spare for the swap (PLAN §14).
    if (added !== 2 * size - 1) throw new Error(`Practice at ${size} a side found places for ${added} bots`);
  }

  /** Ready or its cancel, as the session's: only once the player is in the final roster. */
  ready(on: boolean): void {
    this.session.ready(on);
  }

  /** Switch pack (Q-15, D-22): in one tick, the other pack's newest bot's LEAVE, the player's SWITCH
   *  and a new bot's JOIN | READY for the player's old pack, which D-12's order in a tick (LEAVE, then
   *  SWITCH, then JOIN) lands together, or, from the start countdown on, not at all. Warm-up only, once
   *  the player and that bot are in the final roster, and one swap at a time: the last one's bot gives
   *  its ID back only once its LEAVE is final (BOT_SLOTS). Not while the player's READY is on its way:
   *  every bot is ready, so it begins the start countdown, which a swap after it can't beat. False
   *  otherwise, with nothing queued. */
  switchPack(): boolean {
    const s = this.session;
    const t = s.timeline;
    const F = t.final;
    const me = this.cfg.me;
    if (!t.started || F.phase !== WARM_UP) return false;
    const at = findTerrier(F, me);
    if (at < 0 || (t.eventsInFlight(me) & (JOIN | SWITCH | READY)) !== 0) return false;
    const from = F.terriers[at]!.pack;
    const to: Pack = from === 0 ? 1 : 0;
    const bot = newestIn(s.bots.hosted, to);
    if (bot === null || findTerrier(F, bot.id) < 0 || (t.eventsInFlight(bot.id) & JOIN) !== 0) return false;
    // The new bot first: only it can fail, with no bot ID free, and then nothing is queued.
    if (s.bots.add(from, t) === null) return false;
    s.bots.remove(to, t);
    t.queueEvent(me, { events: SWITCH, switchPack: to });
    return true;
  }

  /** The menu opens (Q-15): the clock stops. After a gap over stallMs since the last timer run, it
   *  stops at the local tick instead, so none of the gap is caught up on resuming (D-22). */
  pause(now: number): void {
    const t = this.session.timeline;
    if (t.paused) return;
    if (this.lastRun !== null && now - this.lastRun > this.cfg.net.stallMs) t.reanchor(now);
    t.pause(now);
  }

  /** Resume, or the menu closes (Q-15): the clock goes on from where it stopped, and a stall's gap is
   *  measured from now. */
  resume(now: number): void {
    const t = this.session.timeline;
    if (!t.paused) return;
    t.resume(now);
    this.lastRun = now;
  }

  /** One timer run. A gap over stallMs since the last pauses Practice, its clock at the local tick,
   *  instead of catching up; a shorter one catches up, this browser's input and every bot's recorded
   *  for every tick, since practiceSettings sends them all (D-22). */
  advance(now: number): PracticeRun {
    const t = this.session.timeline;
    if (t.paused) return 'paused';
    if (this.lastRun !== null && now - this.lastRun > this.cfg.net.stallMs) {
      this.pause(now);
      this.lastRun = now;
      return 'stalled';
    }
    this.lastRun = now;
    this.session.advance(now);
    return 'ran';
  }

  /** Play again (Q-15): a new Practice with the same settings and link, started now, contacting no
   *  one. The controls go on to it; a sampler that reads this one's timeline is to be set again. */
  again(now: number, timelineId?: string): PracticeSession {
    const p = new PracticeSession(this.cfg, this.link);
    p.controls = this.sample;
    p.start(now, timelineId);
    return p;
  }
}
