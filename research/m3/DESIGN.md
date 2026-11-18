# M3 design: timeline, networking, consensus and Practice

**Kept in the repo** from the start of M3's build, as the builders build from it, so that the plan's, the code's and the tests' citations of "design §…" can be followed. The text below is unchanged. Where the build differs from it, PLAN's M3 amendments say so and win. The orchestrator adopted every proposal in its §16, M3-Q1 to M3-Q28, which number its questions apart from PLAN's.

**For:** PLAN.md §17, "M3 — Timeline, networking, consensus and Practice", on the branch `m3-timeline-networking`, from main at a4ead1a.
**Written:** 2026-11-18, by M3's architect, for the builders who implement it, and revised the same day after three reviews: one for completeness, one for determinism, timing and feasibility, and one for the port, the protocol and the interfaces (the Revision log, at the end, gives each finding's outcome). Design only: nothing here is in the repo yet. Its §16 numbers its questions M3-Q1, M3-Q2 and so on, so they can't be mistaken for PLAN's Q-numbers.
**Read for it:** PLAN.md (§0, §1's settled rows, §3's C-rows, D-10 to D-25, D-31, D-37 to D-39 with their M0–M2 amendments, §6 to §10, §14 to §20, Appendix A); REQUIREMENTS.md (multiplayer, joining and packs, Practice, disconnects, platform, the Configuration table, the notes for the plan); research/m2/DESIGN.md, research/tuning/REPORT.md, research/spike/REPORT.md §5.3 and §8, research/audit/REPORT.md §9; terriest's `src/core/sim/**` (index, input, state, codec, hash, step, rules, valid, golden, scenes), `src/core/bot/**` (the brain's view ring, bot IDs, the marks' match driver), `src/core/match-id.ts`, `src/config.ts`, `src/config.test.ts`, `dev/tuning/model.ts` and its test, `src/main.ts`, `src/determinism.ts`, `eslint.config.mjs`, `scripts/eslint/config.test.mjs`, `playwright.config.ts`, `vitest.config.ts`, `e2e/lib/**`, `e2e/determinism.spec.ts`, `scripts/audit-dist.mjs`, `vendor/hermet/audit-dist.mjs`, `scripts/expected-licenses.json`, `scripts/licenses.mjs`, `third-party.json`, `public/_headers`, `docs/acceptance.md`, `CLAUDE.md`; roslambo's `src/core/timeline/timeline.ts`, `src/core/protocol/**`, `src/core/session/**`, `src/net/**` (loopback, trystero, room-config and every test), `src/nettest.ts`, `src/main.ts`, `src/ui/game.ts`, `src/ui/app.ts` (its Play again), `e2e/lib/browsers.ts`, `e2e/round.spec.ts`, `e2e/load.spec.ts`, `e2e/windows.spec.ts`, `e2e/play.spec.ts`, `research/relays/rounds.spec.ts`, its `package.json` and Playwright configs, and its PLAN's D-7 to D-16, D-23, D-27, Q-3, Q-7, Q-8, Q-15, Q-23, §8 and §9; hermet at 11283ca: `room-config.ts` and its test, `nostr-relay.mjs` and its test, `audit-dist.mjs`; Trystero 0.26.0 as installed: its type declarations, `handshake.mjs`, `room.mjs`, `peer.mjs`, `actions.mjs`, `shared-peer.mjs`, `strategy.mjs` and its data limits.
**Measured for it,** in Node 22.23.4 on the development machine, from scratch scripts outside the repo that import terriest's simulation read-only, medians of five rounds:
- a step of the wall scrum at 4 a side, settled 600 ticks: 27.7 µs (24.6–35.6); in the unit stage's whole matches M2 measured 40–42 µs a tick;
- `cloneState` at 8 terriers 0.51 µs; `encodeState` 3.3 µs (with its copy, 1,256 bytes with the scene's empty names); `hashState` 5.4 µs; `decodeState`, with `stateProblems`, 8.4 µs;
- `canonicalInputs` of 8 inputs 0.61 µs; `sameInputs` of two lists of 8, 1.48 µs;
- Trystero 0.26.0 with `@noble/secp256k1` 3.2.0, bundled and minified by the esbuild in `node_modules`: 75,120 bytes, 24,917 brotli at quality 11, 27,491 gzip at level 9;
- the wire decoder roslambo uses, `new TextDecoder('utf-8', { fatal: true })`, decodes U+FEFF followed by "Rex" (`ef bb bf 52 65 78`) to 3 code units; with `ignoreBOM: true`, as terriest's codec decodes names, to 4.

How to read it: a bare § number is this design's section, but for §16 and §17, which are PLAN's tests and milestones unless the text says this design's, and §20 and §21, PLAN's too; PLAN's other sections are written as PLAN §n, and D-, Q-, C-, P- and A. numbers, and L-numbers, are always PLAN's. §0 is the rules every builder follows. §1 is the module map. §2 to §11 answer the brief's items in order: the timeline, consensus, the session, the protocol, the net layer, the `#test=net` page, the tests, the correction measurement, the configuration and the dependencies. §12 is the build order, in six phases, with each builder's files. §13 to §16 are the gate's cost, the risks, the owner's steps and the questions for the plan. The Revision log closes it.

---

## 0. Rules every builder follows

- **Paths are PLAN §6's.** The timeline is `src/core/timeline/`, the protocol `src/core/protocol/`, the session `src/core/session/`, the transports `src/net/`, the match glue `src/ui/game.ts`, `src/ui/practice.ts` and `src/ui/clock.ts`, the page `src/nettest.ts` with its parameters in `src/nettest-params.ts`, routed from `src/main.ts`. The lint and the goldens depend on the paths (CLAUDE.md).
- **`src/core/**` is pure.** The timeline, protocol and session take time as an argument (`now`, in milliseconds, monotonic) and reach the network only through the `Link` they're handed. No timers, clocks, DOM, storage or network globals: the lint's `no-undef` with core's allowlist (`console`, `crypto`, `structuredClone`, `TextDecoder`, `TextEncoder`, `URL`) enforces it. `src/core` imports nothing outside `src/core` but `src/config.ts`, which the lint enforces from phase 2 (§1.36). `Map` and `Set` are allowed outside `src/core/sim` and `src/core/bot`, but anything whose order reaches the simulation goes through `canonicalInputs`, and anything whose order reaches a decision (a tally, a resync's candidates, a forwarder, an admission) sorts by ID with `<`.
- **The simulation is called only through `src/core/sim/index.ts`.** One `Sim` per pack size per timeline steps the final state and every predicted clone (D-11, PLAN §7.2's M2 note). Nothing outside the simulation writes to a `MatchState` except `step`, a STATE's decoded state, and the test-only corruptions the consensus tests make on purpose.
- **Only `src/net/trystero.ts` imports Trystero** (D-18, D-38); `src/net/room-config.ts` imports its types only, with `import type`. Nothing imports `src/net/trystero.ts` statically: `src/ui/game.ts` alone loads it, with `import('../net/trystero')`, when a networked match opens, so the Trystero chunk is never loaded by a normal page, the determinism page or Practice (L238, P10). The lint enforces both from phase 2 (§1.36).
- **No setting copies** (PLAN §7.4, CLAUDE.md). Every number the configuration gives is read from `config` through `netSettings()` (§1.13), `simParams()` or `botParams()`. A code constant that only looks like a setting (a message type, a role code, a wire offset, a bit) says `not a setting` on its line. `src/config.test.ts` scans `src` and `dev` for a setting's name holding a literal, so the timeline never declares `window = 12` or `RESYNC_RETRY_MS = 500`: it reads `cfg.window` and `cfg.resyncRetryMs`. Run `npx vitest run src/config.test.ts` early. §10 lists every setting M3 adds, all in phase 1. A builder that finds it needs another, in a phase where it doesn't own the configuration files (§12), leaves the literal with `// M3 setting pending: <key>` on its line and names it in its report; the phase's integration step moves it into `src/config.ts`, `src/config.test.ts`, `dev/tuning/model.ts` and A.4, and greps for the marker before the commit.
- **Deterministic decisions.** Whatever two peers must agree on (the final inputs, a tally's winner, a merge between timelines, which peer forwards) is a function of what was received, never of arrival order: inputs canonicalised by the simulation, a record's events merged order-free, votes counted per voter, ties broken by the smallest hash, then the smallest ID.
- **Tests never depend on wall time or the frame rate** (CLAUDE.md, C-6). The timeline, session and practice logic are tested in virtual time over `src/net/loopback.ts`. The glue in `src/ui/` takes a `Clock` and `PageEvents` (§1.23), so Node tests drive it with fake timers. End-to-end specs read logical state through the page's hook, trigger what they do from it, and take their timeouts from measured runs.
- **The gate contacts no public host** (§16, CLAUDE.md). Networked end-to-end specs use hermet's local relay on `127.0.0.1` and the `ice=local` room config; the `#test=net` page refuses to start without a relay it's given, and a production build of it takes only the curated relays or a loopback one (§6.7), so no test reaches a public relay by accident and no link can send a visitor to a host `third-party.json` doesn't list.
- **File ownership.** A builder edits only the files §12 gives it. In each phase, PLAN.md, `src/config.ts`, `src/config.test.ts`, `dev/tuning/model.ts`, `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` and `eslint.config.mjs` each have one named owner (§12). REQUIREMENTS.md is the owner's, and M3 edits none of it (§10, §15).
- **No builder imports a file another builder of the same phase is writing.** §12's phases are cut so that each builder imports only files that exist when its phase starts. Where two modules meet across a phase, the consumer declares the narrow interface it needs, by this design's shapes (`BotTimeline`, §1.11), and the later phase's test asserts that the provider satisfies it.
- **Parallel builders share one checkout.** Each keeps its files compiling, runs its own tests, `npx eslint <its files>` and `npx tsc --noEmit`, and stages only its own files. The full gate runs at each phase's integration step.
- **roslambo and hermet are read, never edited** (CLAUDE.md, §17). Ports copy code into terriest's own files, citing the source in the file's header, as M2's did.

---

## 1. Module map

For each file: its purpose, its exports (TypeScript signatures for everything another module calls), what it ports and what changes, and the plan items it implements. Owners are §12's builders: **protocol**, **timeline-parts**, **config**, **timeline**, **net-layer**, **bot-host**, **session**, **scoreboard**, **consensus**, **hosting**, **practice**, **net-glue**, **net-page**, **harness** and **settle**.

### 1.1 `src/core/protocol/bytes.ts`: new (protocol)

- **Purpose:** little-endian writing, and total reading: a short or malformed buffer sets `bad`, and every later read returns zeros.
- **Exports:**
  ```ts
  export class Writer {
    length: number;
    u8(v: number): this; u16(v: number): this; u32(v: number): this;
    bytes(b: Uint8Array): this;
    /** u8 byte length, then UTF-8 of wireString(s) (messages.ts). */
    string(s: string): this;
    /** 2·size hex digits as size raw bytes; anything but hex writes 0. */
    hex(h: string, size: number): this;
    done(): Uint8Array;
  }
  export class Reader {
    constructor(buf: Uint8Array);
    bad: boolean;
    u8(): number; u16(): number; u32(): number;
    /** A copy of n bytes; bad, and empty, if fewer remain. */
    bytes(n: number): Uint8Array;
    /** u8 length, then strict UTF-8 of at most config.displayNameMaxBytes bytes, a leading U+FEFF kept; else bad. */
    string(): string;
    hex(size: number): string;
    get remaining(): number;
    /** Read to the end without error. */
    get complete(): boolean;
  }
  ```
- **Ports:** roslambo's `src/core/protocol/bytes.ts`. **Changes:** no `i32` (nothing signed is sent); the string limit is `config.displayNameMaxBytes`, not a literal 32; strings are decoded with `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`, as `src/core/sim/codec.ts` decodes names. roslambo's decoder leaves `ignoreBOM` at its default, false, and so drops a leading U+FEFF, which C-17's rule lets a name start with: a sender would record its own JOIN with the U+FEFF and every receiver without it, a divergence (§5.7, A.1's "the decoder keeps a leading U+FEFF"). roslambo's `bytes(n)` already checks the length before it copies, and that stays.
- **Implements:** D-20 (decoders that never throw), PLAN §9's framing.

### 1.2 `src/core/protocol/messages.ts`: new (protocol)

- **Purpose:** PLAN §9's messages, their encoders, and one total decoder (§5 has every layout).
- **Exports:**
  ```ts
  export const PROTOCOL_VERSION = 1;              // not a setting: D-20
  export const NO_TICK = 0xffffffff;              // not a setting
  export const ZERO_HASH = '0000000000000000';
  export const T = { HELLO: 0x01, REFUSE: 0x02, TICK: 0x10, FWD: 0x11, PEERS: 0x12, AGAIN: 0x13, STATE_REQ: 0x20, STATE: 0x21 } as const;
  export const ROLE = { KEEPER: 1, PLAYER: 2, SPECTATOR: 3, UNDECIDED: 4 } as const;
  export const TIMELINE_KIND = { NONE: 0, LIVE: 1 } as const;
  export const REFUSAL = { ACCEPTED: 0, PROTOCOL: 1, BUILD: 2, DUPLICATE: 3, SPECTATORS_FULL: 4 } as const;
  export const KIND = { JOIN: 1, LEAVE: 2, READY: 3, UNREADY: 4, SWITCH: 5 } as const;

  /** The bounds the decoder checks (§5.6), from the configuration. */
  export interface WireLimits {
    readonly messageMaxBytes: number; readonly nameMaxBytes: number; readonly inputHistory: number;
    readonly botsMax: number;          // BOT_SLOTS
    readonly peersMax: number;         // meshPlayersMax + spectatorsMax − 1
    readonly historyTicks: number; readonly window: number; readonly delay: number;   // STATE's tick bounds (§5.5)
  }
  export function wireLimits(c?: Config): WireLimits;

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

  export function encodeHello(m: Omit<Hello, 'type'>): Uint8Array;
  export function encodeRefuse(reason: number): Uint8Array;
  export function encodeTick(m: Omit<Tick, 'type'>): Uint8Array;
  export function encodeFwd(origin: string, tick: Uint8Array): Uint8Array;
  export function encodePeers(players: readonly string[], role: number): Uint8Array;
  export function encodeAgain(): Uint8Array;
  export function encodeStateReq(tick: number, want: string): Uint8Array;
  /** The ID table built from the records; as many input ticks as fit in messageMaxBytes; kept says how many. */
  export function encodeState(m: Omit<StateMsg, 'type' | 'decoded' | 'roster' | 'others'>, roster: readonly string[]): { bytes: Uint8Array; kept: number };
  /** Total: anything malformed, inconsistent, out of §5's bounds or trailing is null, never an exception. */
  export function decode(bytes: Uint8Array, P?: SimParams, L?: WireLimits): Message | null;
  /** A string as the wire carries it: itself if well-formed UTF-16 within the name's byte limit, else ''. */
  export function wireString(s: string): string;
  ```
- **Ports:** roslambo's `src/core/protocol/messages.ts`. **Changes,** each PLAN §9's or D-20's unless marked: the u16 input; the history as a presence mask, a "same as the next newer" mask and only the differing inputs; JOIN with pack and coat; SWITCH; PEERS with the sender's role, and at most `peersMax` distinct IDs; HELLO without "saved" and "holds a result"; RESULT_REQ, RESULT and SETTLED dropped; STATE's records with u16 inputs and event payloads, indexing the state's terriers and an ID table (§5.5, this design); STATE's tick bounds (§5.5); an event checked against its sender's history (§5.3); `decode` validates STATE's state with `decodeState` and returns it decoded; `wireString` (§5.7) so a sender records its own JOIN name exactly as receivers decode it.
- **Implements:** PLAN §9, D-12's events, D-18's size, D-20, D-21's roles, A.1 (the STATE payload), A.2.

### 1.3 `src/core/timeline/inputs.ts`: new (timeline-parts)

- **Purpose:** the inputs known for each tick, by sender; the ticks a sender has said it has no input for; and the newest-tick input each sender has sent, which prediction repeats (D-11).
- **Exports:**
  ```ts
  /** One sender's input for one tick with its events: TickInput without the ID. Structurally
   *  messages.ts's EventPayload with the input, declared here so this file needs nothing from it. */
  export interface Recorded {
    input: number; events: number;
    joinPack?: number; coat?: number; name?: string; switchPack?: number;
  }
  export type PutResult = 'new' | 'merged' | 'same' | 'refused';
  export class InputStore {
    /** span: ticks kept, a power of two (netSettings' inputSpan, 1024), past the window §2.12 bounds. */
    constructor(span: number);
    get(id: string, t: number): Readonly<Recorded> | undefined;
    /** No record, and the sender said it has none for t: a clear present bit in its TICK (§2.2). */
    isAbsent(id: string, t: number): boolean;
    /** Tick t's records, or undefined; callers canonicalise. */
    at(t: number): ReadonlyMap<string, Readonly<Recorded>> | undefined;
    /** A record, unless one exists: then its events are OR-ed in, and a JOIN or SWITCH payload that
     *  differs keeps the one that sorts first, field by field (§5.6), so the result never depends on
     *  arrival order. An input for a record that events alone made sets its input. own: this browser's
     *  or one of its bots', which replaces whatever is stored (§4.10). Clears a mark. Updates newest(id)
     *  when t is at or after its tick (D-11). */
    put(id: string, t: number, r: Recorded, own?: boolean): PutResult;
    /** Events for (id, t): merged into its record, or a record of input 0 that events alone made, which a
     *  later put completes and which never moves newest (§2.5). */
    putEvents(id: string, t: number, e: Omit<Recorded, 'input'>): PutResult;
    /** The sender has no input for t; ignored where a record exists. True if newly marked. */
    markAbsent(id: string, t: number): boolean;
    /** Replaces tick t's records exactly, its marks cleared: a STATE's final ticks (D-11). */
    replace(t: number, records: readonly (Recorded & { readonly id: string })[]): void;
    /** The input of the newest tick received from id, which prediction repeats (D-11). */
    newest(id: string): { readonly tick: number; readonly input: number } | undefined;
    /** The first tick in (after, upTo] with neither a record nor a mark for id; upTo + 1 if none. */
    firstUnknown(id: string, after: number, upTo: number): number;
    /** Ticks at or before t are no longer needed, so their slots may be reused. A write for a tick
     *  whose slot still holds a needed one is refused (§2.12). */
    retire(t: number): void;
    clear(): void;
  }
  ```
- **Ports:** roslambo's `slots`, `slotTick` and `lastButtons` from `timeline.ts`. **Changes:** the record carries D-12's payloads; the merge is order-free (roslambo's last writer won); `newest` keeps its tick, so a history fill of an older tick never moves it; the marks (§2.2); records made by events alone (§2.5); own records replace (§4.10); no needed slot is ever evicted (roslambo's `slot(t)` cleared any slot holding another tick, §2.12).
- **Implements:** D-11's prediction rule, D-12, P4.

### 1.4 `src/core/timeline/history.ts`: new (timeline-parts)

- **Purpose:** the last `config.stateHistoryTicks` final states as A.1's bytes, with their hashes and rosters: what a vote, a tally, a late vote and a STATE reply read.
- **Exports:**
  ```ts
  export class FinalHistory {
    constructor(size: number);
    put(t: number, bytes: Uint8Array, hash: string, roster: readonly string[]): void;
    has(t: number): boolean;
    bytes(t: number): Uint8Array | null;
    hash(t: number): string;                 // '' if not held
    roster(t: number): readonly string[];    // [] if not held
    /** Forgets every tick after t: a STATE adopted at t, whose re-finalisation writes them again (§3.4). */
    dropAfter(t: number): void;
    clear(): void;
  }
  ```
- **Ports:** roslambo's `ringTick`, `ringBytes`, `ringHash` and `ringRoster`. **Changes:** `dropAfter`. **Implements:** D-11's 256-tick history, D-13.

### 1.5 `src/core/timeline/votes.ts`: new (timeline-parts)

- **Purpose:** votes by tick and voter, and D-13's tally.
- **Exports:**
  ```ts
  export interface TallyResult { readonly win: string; readonly agree: boolean; readonly split: boolean }
  export class VoteBook {
    /** size: the ticks it can hold, netSettings' inputSpan; the timeline checks each vote's window (§3.1). */
    constructor(size: number);
    /** Records or replaces voter's vote at t; false if t's slot still holds a needed tick (§2.12). */
    add(t: number, voter: string, hash: string): boolean;
    /** Ticks at or before t are no longer needed: their votes go, and their slots may be reused. */
    retire(t: number): void;
    /** D-13: one vote per voter that controls a terrier in roster (counts(voter)), the most votes
     *  winning, the smallest hash on a tie; null with no counted vote or no hash of mine. */
    tally(t: number, mine: string, counts: (voter: string) => boolean): TallyResult | null;
    /** The voters for hash at t other than me, sorted by ID: a resync's candidates. */
    voters(t: number, hash: string, me: string): string[];
  }
  ```
- **Ports:** roslambo's `votes`, `vote`, `tally` and `beginResync`'s candidate list. **Changes:** a ring by tick, so a vote for a far tick can't stay for the match (roslambo's map kept any `voteTick` until `tallyTo` passed it). **Implements:** D-13, C-10, C-16.

### 1.6 `src/core/timeline/clock.ts`: new (timeline-parts)

- **Purpose:** D-15's tick clock, with roslambo's M0 corrections and its 2026-10-25 fixes, plus Practice's pause and a re-anchor after a stall.
- **Exports:**
  ```ts
  export interface ClockConfig {
    readonly tickMs: number; readonly delay: number; readonly window: number;
    readonly settleMs: number;      // a peer's offset counts once heard this long
    readonly smoothing: number;     // each sample's weight in a peer's offset
    readonly gainPerTick: number;   // the rate's change for each tick of the median offset
    readonly rateMax: number;       // its limit either way
    readonly deadbandTicks: number; // no change within this offset
    readonly rebalanceMs: number;   // how often the median is taken
  }
  export class TickClock {
    constructor(cfg: ClockConfig);
    /** Fractional ticks at now; frozen while paused. */
    read(now: number): number;
    /** The clock reads `at` ticks at now, at the base rate. */
    set(now: number, at: number): void;
    pause(now: number): void;
    resume(now: number): void;
    readonly paused: boolean;
    /** A direct TICK's clock sample: the sender's t − d + phase, plus the one-way delay, against mine. A
     *  phase at its cap was sent catching up after a stall, and is no sample (roslambo, 2026-10-25). */
    sample(peer: string, t: number, phase: number, oneWayMs: number, now: number): void;
    heard(peer: string, now: number): void;
    forget(peer: string): void;
    /** Called every advance; every rebalanceMs, the median offset of peers heard for settleMs: past the
     *  late window's middle a jump, else a proportional rate with a deadband. */
    rebalance(now: number): 'jump' | 'rate' | null;
    readonly stats: { jumps: number; rateAdj: number; medianOffset: number };
  }
  ```
- **Ports:** roslambo's `clock`, `setRate`, the offset samples in `onTick`, `rebalance`. **Changes:** its literals (0.1, 0.005, 0.02, 1 and the 1,000 ms period) come from configuration (§10); the late window's middle, `window / 2`, is D-15's rule and says `not a setting`; samples come from direct TICKs only (§4.10); `pause`, `resume` and `set` are new, for D-22's Practice and §4.12's re-anchor.
- **Implements:** D-15, D-22's pausable clock.

### 1.7 `src/core/timeline/timeline.ts`: new (timeline)

- **Purpose:** roslambo's rollback lockstep with D-11's change: the predicted chain kept tick by tick, re-simulated only from the earliest tick whose base or inputs changed, and a changed base's steps spread over ticks at `spreadMaxStepsPerTick`. Votes, the tally, resyncs, STATE, the joiner's warm-up and the outbox of events (§2, §3).
- **Exports:**
  ```ts
  /** settings.ts's TimelineSettings: d, w and v (A.4), the 256-tick state history, the TICK's 16-tick
   *  history, the stores' span, the spread's cap (42), the joiner's warm-up, the resync's retry,
   *  stallSendTicks (Infinity in Practice, D-22) and the clock's settings. */
  export interface TimelineConfig extends TimelineSettings {
    readonly P: SimParams;
    readonly me: string;                  // this browser's player ID
    readonly mode?: 'incremental' | 'fullReplay';   // D-11: "the full replay is one flag away"
    /** Tests: 0 or absent, off; 1, after every advance; n, after every nth advance that moved the clock
     *  and every one that adopted a STATE or stepped a changed base (§2.7). */
    readonly verify?: number;
  }
  export interface TimelineOut {
    broadcast(bytes: Uint8Array): void;
    /** To one player's peer; false with no direct connection. */
    sendToPlayer(player: string, bytes: Uint8Array): boolean;
    /** To one connection, by transport peer ID. */
    sendToPeer(peer: string, bytes: Uint8Array): void;
  }
  /** A re-simulation that recomputed the drawn head's tick (D-16, §2.11): the measurement's, the match
   *  summary's and M4's input. Fired for every one, whether or not anything moved. */
  export interface Correction {
    readonly tick: number;                  // the drawn head's tick before the change
    readonly from: number;                  // the earliest tick re-simulated
    readonly before: Readonly<MatchState>;  // that tick's state as drawn
    readonly after: Readonly<MatchState>;   // and as recomputed
    readonly repair: boolean;               // the base came from a STATE: a resync or a late-vote repair
  }
  export interface TimelineStats {
    sent: number; received: number;
    late: number;                 // TICK inputs at or before the late boundary here
    lateBy: number[];             // lateBy[k]: inputs k + 1 ticks late, the last bin open-ended (D-16's count against w)
    lateAbsent: number;           // (sender, tick) finalised absent here whose input came later
    agree: number; disagree: number; split: number;
    resyncs: number; resyncMs: number[]; resyncFailed: number; lateVoteFlips: number;
    statesSent: number; statesTruncated: number;   // D-18: a STATE that dropped input ticks
    statesRefused: number;        // STATE_REQs not answered (§3.4)
    steps: number; maxStepsPerAdvance: number; spreadTicks: number; holds: number;
    reusedFinals: number; steppedFinals: number; rollbacks: number; corrections: number; verifyMismatches: number;
    jumps: number; rateAdj: number; medianOffset: number;
    warmMs: number; joinedAt: number;
    log: [number, string][];      // [local tick, event], the first 300
  }
  export class Timeline {
    constructor(cfg: TimelineConfig, out: TimelineOut);
    readonly cfg: TimelineConfig;
    readonly stats: TimelineStats;
    id: string;                   // the timeline's ID (roslambo D-12)
    started: boolean;
    localTick: number;
    finalTick: number;
    readonly final: Readonly<MatchState>;
    /** The drawn head and the one drawn before it (§2.8's contract): objects the timeline never writes
     *  again, never F; held while a spread's chain is behind the head they show. */
    readonly head: Readonly<MatchState>;
    readonly prevHead: Readonly<MatchState>;
    readonly headTick: number;
    sending: boolean;             // a player or a candidate
    controls: () => number;       // this browser's u16, sampled once a sent tick
    readonly bots: Map<string, () => number>;   // hosted bots' inputs, sampled once a sent tick (D-39, §4.8)
    agreedTo: number;             // the newest tick whose tally agreed, or had no other vote (D-14)
    readonly repairing: boolean;  // a resync outstanding, a spread or a warm-up under way
    readonly answering: boolean;  // false while a resync is outstanding (§3.4)
    onCorrection: ((c: Correction) => void) | null;
    start(now: number, settings: MatchSettings, id: string): void;
    advance(now: number): void;
    clock(now: number): number;
    alpha(now: number): number;   // how far into the head tick, 0..1; 1 while the head is held
    pause(now: number): void; resume(now: number): void; readonly paused: boolean;
    /** After a stall with no peer that ran on (§4.12): the clock goes on from localTick, skipping the gap. */
    reanchor(now: number): void;
    /** Events for `who`'s next input: this browser's player, or one of its bots. */
    queueEvent(who: string, e: EventPayload): void;
    requestState(peer: string): void;
    setOneWay(player: string, ms: number): void;
    /** direct: from the origin's own connection, not a FWD; only a direct TICK is a clock sample. */
    onTick(origin: string, m: Tick, now: number, direct: boolean): void;
    /** False when not answered (§3.4). */
    onStateReq(peer: string, m: StateReq, now: number): boolean;
    /** A STATE: adopted when joining (from the peer asked), or a solicited repair. True if taken. */
    onState(peer: string, m: StateMsg, oneWayMs: number, now: number): boolean;
    isConfirmed(t: number): boolean;
    hashAt(t: number): string;    // '' past finalTick or outside the history
    rosterAt(t: number): readonly string[];
    /** The input actually received for (id, t), bark bits and all; never a predicted one (D-16). */
    receivedInput(id: string, t: number): number | undefined;
    newestInput(id: string): { readonly tick: number; readonly input: number } | undefined;
    /** The local time a TICK from id last arrived, direct or forwarded. */
    heardAt(id: string): number | undefined;
  }
  ```
- **Ports:** roslambo's `src/core/timeline/timeline.ts`, which §2 follows step by step. **Changes:** §2.3–§2.12: the kept chain, the invalidation watermark and its rules, the marks, the reuse of predicted finals, the spread, the head's contract, silent terriers predicted absent, inputs masked to A.1's kept bits for the simulation, the late boundary measured on the clock outside a warm-up, the stores' windows, D-12's payloads, the correction observer, `pause`/`reanchor`, `verify` and `fullReplay`; §3: own votes refreshed by a repair, no vote sent and no STATE served while a resync is outstanding, and STATE answered only for what was asked. Its bots' inputs are accepted only when their IDs derive from the origin (roslambo Q-23).
- **Implements:** D-10, D-11 (with M0's spread), D-13, D-14's `isConfirmed`, D-15, D-16's corrections and received inputs, D-22's clock, D-31, P1–P3.

### 1.8 `src/core/session/room-peer.ts`: new (net-layer in phase 2; session from phase 3)

- **Purpose:** what a transport drives, and the checks every room peer makes.
- **Exports:**
  ```ts
  export type Refusal = { readonly ok: false; readonly reason: number };
  /** replaces: the peer ID of a silent connection this HELLO replaces (C-12). */
  export type Accepted = { readonly ok: true; readonly hello: Hello; readonly replaces?: string };
  export interface Link {
    send(peer: string, bytes: Uint8Array): void;
    broadcast(bytes: Uint8Array): void;
    /** Close one connection and refuse its peer ID from then on (roslambo §9.4). */
    drop?(peer: string): void;
  }
  export interface RoomPeer {
    hello(): Hello;
    /** peer: the transport's ID for the connection, so an admission holds its place until onPeerJoin or
     *  onHandshakeFailed (D-21, §4.3). */
    checkHello(hello: Hello, now: number, peer: string): Accepted | Refusal;
    /** The handshake completed; sent is the HELLO this side sent. */
    onPeerJoin(peer: string, hello: Hello, sent: Hello, now: number): void;
    /** A handshake this side accepted ended without a join: refused by the other side, timed out, or
     *  the peer went. Idempotent. */
    onHandshakeFailed(peer: string): void;
    onPeerLeave(peer: string): void;
    /** A pong: the connection is alive (C-12), and its round trip. */
    onRtt(peer: string, ms: number, now: number): void;
    onMessage(peer: string, bytes: Uint8Array, now: number): void;
    advance(now: number): void;
  }
  /** Protocol, build, this browser's own ID, and a bot's ID, which only ever rides in its host's TICK (D-21; roslambo D-16). */
  export function commonRefusal(hello: Hello, build: string, me: string): Refusal | null;
  ```
- **Ports:** roslambo's `src/core/session/room-peer.ts`. **Changes:** `now` and the peer ID in `checkHello`, `now` in `onPeerJoin` and `onRtt`, for C-12's silence and D-21's reservations; `onHandshakeFailed`; `replaces`; a bot's ID refused; `INVALID_LIMIT` moves to configuration (§10).

### 1.9 `src/core/session/build.ts`: new (session)

- **Exports:** `export function buildHash(c: Config, buildInputs: string): string;` — 16 hex digits.
- **What it hashes** (D-21, C-13): `hash64` of the UTF-8 of a JSON array, in this order: `CODEC_VERSION`, `PROTOCOL_VERSION`, every configuration path from `settingPaths`-style traversal of `c` with its value, sorted by path (so d, w and v are in it), and `buildInputs`: the build-time hash of every `src/core` source that decides what peers agree on, and `goldens.json` (§1.31). Unit tests pass any string for `buildInputs`; the page passes `BUILD_INPUTS`.
- **Ports:** roslambo's `build.ts`. **Changes:** the whole configuration, not the simulation's settings only, and the build inputs.

### 1.10 `src/core/session/roster.ts`: new (session)

- **Purpose:** D-21's and D-17's roster questions, pure.
- **Exports:**
  ```ts
  /** Whether player, or a bot derived from it, is in the roster (D-17, D-21). */
  export function inRoster(player: string, roster: ReadonlySet<string>, botIdsOf: (host: string) => readonly string[]): boolean;
  /** 2 × pack size − terriers. */
  export function freePlaces(s: Readonly<MatchState>): number;
  /** D-21: admit a HELLO from outside the roster? Only a peer that holds the state counts; it admits
   *  while the connected browsers outside the roster, those it has admitted whose handshakes are still
   *  under way, and itself if it's outside, number fewer than the spectator cap plus the free places. */
  export function admits(o: {
    readonly holdsState: boolean; readonly outsideConnected: number; readonly reserved: number;
    readonly selfOutside: boolean; readonly freePlaces: number; readonly spectatorsMax: number;
  }): boolean;
  /** D-21: on Watch, or a refusal as a player: the announced spectators and itself over the cap? */
  export function spectatorsOverCap(announcedSpectators: number, spectatorsMax: number): boolean;
  /** roslambo D-12 and Q-7, without saves: which of two timelines a room keeps. */
  export function beats(a: Hello, b: Hello): boolean;
  ```
- **Implements:** D-17, D-21, C-11, P7.

### 1.11 `src/core/session/bots.ts`: new (bot-host in phase 2; hosting from phase 4)

- **Purpose:** the bots this browser hosts (PLAN §14, D-39): their IDs, brains, JOIN, READY renewal, removal and adoption after a reload.
- **Exports:**
  ```ts
  /** What BotHost needs of a timeline, declared here so bot-host builds beside the timeline (§0);
   *  timeline.ts's Timeline satisfies it, which session's tests assert. */
  export interface BotTimeline {
    readonly final: Readonly<MatchState>; readonly head: Readonly<MatchState>; readonly headTick: number;
    readonly finalTick: number; readonly localTick: number;
    readonly cfg: { readonly delay: number };
    readonly bots: Map<string, () => number>;
    queueEvent(who: string, e: EventPayload): void;
  }
  export interface HostedBot {
    readonly id: string;
    pack: Pack;                // the pack it asks for; Play again may move it (D-12)
    brain: Brain;
    wanted: boolean;           // false once removed, until its LEAVE is final
    joinSentAt: number;        // local tick of its last JOIN, −1 if none pending
    readySentAt: number;       // local tick of its last READY, −1 if none
    leaveAt: number;           // the tick of its LEAVE, once removed
    triedOther: boolean;       // Play again: already fell back to the other pack
  }
  export class BotHost {
    constructor(me: string, P: SimParams, B: BotParams, room: RoomSettings);
    readonly hosted: HostedBot[];
    /** Before the start countdown, with a place in pack for it counting joins on their way. */
    canAdd(pack: Pack, s: Readonly<MatchState> | null, pendingInPack: number): boolean;
    add(pack: Pack, t: BotTimeline): HostedBot | null;      // JOIN | READY with botCoat and botName
    remove(pack: Pack, t: BotTimeline): boolean;            // the newest wanted bot in pack: its LEAVE
    removeAll(t: BotTimeline): void;                        // the host leaves before the countdown
    /** A timeline is held: this host's bots in its roster are hosted again, each brain's counters
     *  from its terrier's stored previous input (D-10, D-17). */
    adopt(t: BotTimeline): void;
    /** Each local tick: JOIN until the state shows it, READY again once a Ready has
     *  botReadyRenewTicks left, give up when its pack is full or the countdown began (Play again:
     *  the other pack first), unhost once a LEAVE is final. */
    tend(t: BotTimeline, hostLeft: boolean): void;
    /** A new timeline: every pending JOIN and READY is sent again. */
    reset(t: BotTimeline): void;
  }
  ```
- **Each bot's sampler,** the function `adopt` and `add` put in `t.bots`, thinks once per head tick: `think(brain, t.head)` when `t.headTick` differs from the tick it last thought on, and otherwise its last input, its press counters unchanged. So a catch-up's ticks, sent in one advance on one head, and a head held through a spread (§2.8) neither press twice nor shorten the brain's reaction (§4.8).
- **Ports:** roslambo's `HostedBot`, `addBot`, `removeBot`, `adoptBots` and `tendBots` from `session.ts`. **Changes:** packs; brains (`newBrain`, `think`) instead of `botButtons`, which were stateless; one think per head tick; READY renewed before the expiry, not after it (§4.8); Play again's pack fallback; a narrow timeline interface.
- **Implements:** D-39's hosting, PLAN §14, D-12's Play again for bots, C-41.

### 1.12 `src/core/bot/brain.ts` (changed), `src/core/bot/setups.ts` (new), `src/core/bot/bot-id.ts` and `marks.ts` (changed): bot-host

- **`brain.ts`:** `perceive`'s view ring is keyed by the state's tick, not by calls. Each entry records its tick; a repeated tick overwrites its own entry; the decision reads the newest entry at or before `tick − reactionTicks`, or the oldest it holds when none is that old, and its lead is the ticks between. M2's marks call `think` once a tick on consecutive ticks, where the two readings are the same entry, so every mark and the end-to-end setups count exactly as before, which phase 2's integration checks by running them unchanged. Over the timeline, a held head (§2.8) or a catch-up's skipped ticks then keep the 0.25 s reaction (D-39, A.4's Bot brain).
- **`setups.ts`** (new, exact operations and arrays only, as `src/core/bot`): §16's end-to-end scripts, moved out of `marks.ts` so that the `#test=net` page, `src/net/bots-setups.test.ts`, `src/net/practice.test.ts` and the marks run the same code:
  ```ts
  /** A.2 inputs of §16's setups: back, and sideways, in ball view. */
  export const BACK_IN_BALL_VIEW: number;      // encodeInput({ step: 16, frame: FRAME_BALL })
  export const SIDEWAYS_IN_BALL_VIEW: number;  // encodeInput({ step: 8, frame: FRAME_BALL })
  /** A person's u16: held for the first second of play after each kickoff, then nothing (§16). */
  export function heldFirstSecond(held: number, P: SimParams): (s: Readonly<MatchState>) => number;
  export type ScriptName = 'none' | 'back' | 'sideways' | 'brain';
  /** The page's own input for a script, sampled once a sent tick on the timeline's head as it stands
   *  then (headTick with it), its press counters starting from base, the terrier's stored previous
   *  input (D-10). 'brain' thinks once per head tick, as a hosted bot does. */
  export function scriptSampler(name: ScriptName, me: string, base: number, P: SimParams, B: BotParams):
    (head: Readonly<MatchState>, headTick: number) => number;
  ```
- **`bot-id.ts`** gains `personId(seed, k)`, moved from `marks.ts`, which re-exports it, so the page imports neither the marks nor their module's size.
- **`marks.ts`** imports `heldFirstSecond`, the two inputs and `personId` from them: the same code as before, moved.

### 1.13 `src/core/session/settings.ts`: new (config)

- **Purpose:** the configuration in the session's, timeline's and transport's units, built once, so tests and the measurement pass a changed copy (as `simParams` does for the simulation).
- **Exports:**
  ```ts
  export interface RoomSettings {
    readonly spectatorsMax: number; readonly meshPlayersMax: number;
    readonly duplicateSilentMs: number; readonly peersEveryMs: number;
    readonly stateRequestRetryMs: number; readonly eventRetryTicks: number;
    readonly floodTicksPerTick: number; readonly floodMs: number; readonly invalidMessagesMax: number;
    readonly abandonedMs: number; readonly connectionFailureMs: number; readonly handshakeTimeoutMs: number;
    readonly botReadyRenewTicks: number; readonly leaveGraceMs: number; readonly resyncRetryMs: number;
  }
  export interface TransportSettings {
    readonly maxReceiveBytes: number; readonly handshakeTimeoutMs: number; readonly pingEveryMs: number;
  }
  /** The timeline's settings; timeline.ts's TimelineConfig extends it with P, me, mode and verify. */
  export interface TimelineSettings {
    readonly delay: number; readonly window: number; readonly voteWindow: number;
    readonly history: number; readonly inputHistory: number; readonly spreadCap: number;
    /** The input store's and the vote book's span: the smallest power of two at least twice
     *  history + 2·window + delay (§2.12), 1024 at A.4's values. */
    readonly inputSpan: number;
    readonly warmupMs: number; readonly resyncRetryMs: number; readonly stallSendTicks: number;
    readonly clock: {
      readonly tickMs: number; readonly settleMs: number; readonly smoothing: number;
      readonly gainPerTick: number; readonly rateMax: number; readonly deadbandTicks: number;
      readonly rebalanceMs: number;
    };
  }
  export interface NetSettings {
    readonly tickMs: number;
    readonly timerMs: number;      // the glue's timer period (D-31)
    readonly stallMs: number;      // a longer gap between timer runs is a stall (A.4)
    readonly timeline: TimelineSettings;
    readonly room: RoomSettings;
    readonly transport: TransportSettings;
  }
  export function netSettings(c?: Config): NetSettings;
  /** Practice's: the same, but a catch-up records every tick's local input (D-22). */
  export function practiceSettings(n: NetSettings): NetSettings;
  ```
- **Implements:** PLAN §7.4's "nowhere else" for M3's settings (§10).

### 1.14 `src/core/session/session.ts`: new (session; hosting from phase 4)

- **Purpose:** one room's controller (§4): the handshake checks, refusals and admissions, the connection-to-player map, PEERS with roles, forwarding, joining and merging timelines, the local player's Play, Watch, Ready, Switch and Leave, bots through `BotHost`, returning players, stalls, the abandoned rule, Play again's preferences, and closing connections that misbehave.
- **Exports:**
  ```ts
  export interface AgainChoice {              // Play again (D-12): the previous match's choices
    readonly pack: Pack | null;               // null: it watched
    readonly bots: readonly { readonly pack: Pack }[];
    readonly againSeen: boolean;              // an AGAIN reached it in the previous room: join, don't propose (§4.9)
  }
  export interface SessionConfig {
    readonly P: SimParams; readonly B: BotParams; readonly net: NetSettings;
    readonly me: string; readonly name: string; readonly coat: number;
    readonly build: string; readonly forwarding: boolean;
    readonly mode?: 'incremental' | 'fullReplay'; readonly verify?: number;
    readonly again?: AgainChoice;
  }
  export type Refused = 'full' | 'started';
  export interface DuplicateHello {           // C-12's rule at work, for the report (F4's diagnosis)
    readonly player: string; readonly at: number; readonly verdict: number;
    readonly oldSilentMs: number;             // how long the old connection had been silent
    readonly oldLeftAt: number | null;        // when its leave arrived, if it has
  }
  export class Session implements RoomPeer {
    constructor(cfg: SessionConfig, link: Link);
    readonly cfg: SessionConfig;
    timeline: Timeline;                       // replaced by a merge or a rejoin
    readonly bots: BotHost;
    propose(now: number, settings: MatchSettings, timelineId: string): void;
    play(pack: Pack): void;
    watch(): void;
    ready(on: boolean): void;
    switchPack(): void;
    leave(): void;
    canAddBot(pack: Pack): boolean;
    addBot(pack: Pack): boolean;
    removeBot(pack: Pack): boolean;
    hostedBots(): readonly string[];
    /** A gap over stallMs between timer runs (§4.12): the timeline pauses, then rejoins from a peer
     *  whose clock ran on, or re-anchors. */
    stalled(now: number): void;
    readonly stall: 'none' | 'deciding' | 'rejoining';
    /** This browser's own input, sampled once a sent tick. */
    set controls(sample: () => number);
    /** This browser took control of its terrier from an adopted state (a join, a return, a rejoin, a
     *  merge), with that terrier's stored previous input: where the input source starts its press
     *  counters (D-10, §4.6). */
    onControl: ((base: number) => void) | null;
    role(): number;
    inRoster(): boolean;
    readonly refused: Refused | null;         // a JOIN given up (D-12): the UI offers the other pack, or watches
    readonly switchRefused: boolean;
    readonly returning: boolean;              // took control from the adopted state, skipping Join (D-17)
    readonly spectatorsFull: boolean;         // D-21's fifth spectator: the glue leaves the room (§4.5)
    readonly againSeen: boolean;              // an AGAIN arrived
    announceAgain(): void;
    abandoned(now: number): boolean;          // Q-16 (§4.7)
    failed(now: number): boolean;             // not a keeper, and no timeline after connectionFailureMs (PLAN §8)
    peerCount(): number;
    /** Each connected player ID and its announced role (HELLO, then PEERS). */
    connectedRoles(): ReadonlyMap<string, number>;
    readonly dropped: string[];               // connections this side closed (roslambo §9.4)
    readonly duplicates: DuplicateHello[];    // the first 50
    // RoomPeer: hello, checkHello, onPeerJoin, onHandshakeFailed, onPeerLeave, onRtt, onMessage, advance
  }
  ```
- **Ports:** roslambo's `src/core/session/session.ts`. **Changes:** packs, SWITCH and coats in JOIN; D-21's admission with reservations and the spectator count; C-12's replacement, with liveness from pongs; returning players and rejoins (D-17, §4.6); the stall rule (§4.12); the abandoned rule (Q-16); Play again's preferences and AGAIN's meaning (§4.9); bots through `BotHost`; no saves, results peers, witnesses or ledger; what a peer may say about whom (§4.10).
- **Implements:** PLAN §8's roles and a match's life, D-12, D-17, D-19, D-21, D-31, C-11, C-12, C-42, C-50, Q-16, P4, P5, P7.

### 1.15 `src/core/session/scoreboard.ts`: new (scoreboard; consensus from phase 4)

- **Purpose:** D-14's latch: goals and the end from confirmed ticks only, each goal once; what M4's score, celebration, whistle and Results read, and what P9's tests check.
- **Exports:**
  ```ts
  export interface ConfirmedGoal {
    readonly tick: number; readonly pack: Pack; readonly ownGoal: boolean;
    readonly scorers: readonly string[];      // terrier IDs, from the final state's scorers bits
    readonly score: readonly [number, number];
  }
  export interface ResultRow {
    readonly id: string; readonly name: string; readonly pack: Pack; readonly coat: number;
    readonly goals: number; readonly touches: number; readonly terriest: boolean; readonly bot: boolean;
  }
  export interface ConfirmedEnd {
    readonly tick: number; readonly score: readonly [number, number]; readonly winner: Pack | null;
    readonly rows: readonly ResultRow[];      // in (spot, pack) order
  }
  /** What the scoreboard reads of a timeline; timeline.ts's Timeline satisfies it. */
  export interface ScoreTimeline {
    readonly final: Readonly<MatchState>; readonly finalTick: number; readonly repairing: boolean;
    isConfirmed(t: number): boolean;
  }
  export class Scoreboard {
    readonly goals: ConfirmedGoal[];          // in tick order, each once
    end: ConfirmedEnd | null;
    /** The score as last confirmed: from the adopted state for a browser that arrived mid-match. */
    readonly score: readonly [number, number];
    /** After each advance. Withdraws a goal only when a completed repair's final state no longer has it (C-4). */
    update(t: ScoreTimeline): { readonly added: readonly ConfirmedGoal[]; readonly withdrawn: readonly ConfirmedGoal[] };
  }
  ```
- **Implements:** D-14, Q-7, C-4, C-50, P9.

### 1.16 `src/core/session/summary.ts`: new (scoreboard)

- **Purpose:** a match's network summary on a real page, for M5's acceptance runs (§17's "each peer's late inputs, rollbacks and correction sizes"), and the one definition of a correction's size that the measurement uses too (§9).
- **Exports:**
  ```ts
  export interface CorrectionSizes {
    readonly ball: number; readonly ballFlat: number;          // m: 3D and horizontal
    readonly remote: readonly { readonly metres: number; readonly degrees: number }[];   // each other terrier
    readonly own: { readonly metres: number; readonly degrees: number } | null;          // this browser's, if any
  }
  /** Position changes in 3D; heading changes the shorter way round, in degrees. */
  export function correctionSizes(c: Correction, me: string): CorrectionSizes;
  export interface Quantiles { readonly count: number; readonly zero: number; readonly p50: number; readonly p95: number; readonly max: number }
  export interface MatchNetSummary {
    readonly ticks: number; readonly remoteInputs: number;
    readonly late: number; readonly lateAbsent: number; readonly lateBy: readonly number[];
    readonly rollbacks: number; readonly corrections: number; readonly resyncs: number; readonly resyncFailed: number;
    readonly ball: Quantiles; readonly remote: Quantiles; readonly own: Quantiles; readonly headings: Quantiles;
  }
  /** Fed by onCorrection; percentiles from fixed log-spaced bins, so a long match keeps no list. */
  export class SummaryBuilder {
    constructor(me: string);
    add(c: Correction): void;
    summary(stats: TimelineStats): MatchNetSummary;
  }
  ```
- **Implements:** §17's M5 logging, through M4's readout (§8.1, M3-Q24).

### 1.17 `src/core/session/practice.ts`: new (practice)

- **Purpose:** Practice (D-22, Q-15): the same session and timeline over the local transport, the browser hosting every bot, a pausable clock, the stall rule and the pack swap.
- **Exports:**
  ```ts
  export interface PracticeConfig {
    readonly P: SimParams; readonly B: BotParams; readonly net: NetSettings;   // practiceSettings()
    readonly me: string; readonly name: string; readonly coat: number;
    readonly settings: MatchSettings; readonly build: string; readonly verify?: number;
  }
  export class PracticeSession {
    constructor(cfg: PracticeConfig, link: Link);
    readonly session: Session;
    /** Genesis; the player in pack A (Q-15); bots fill every other place, each always ready. */
    start(now: number, timelineId: string): void;
    ready(on: boolean): void;
    /** In one tick: the other pack's newest bot's LEAVE, the player's SWITCH and a new bot's JOIN for
     *  the player's old pack (D-12, D-22). Warm-up only; false otherwise. */
    switchPack(): boolean;
    pause(now: number): void;
    resume(now: number): void;
    readonly paused: boolean;
    /** One timer run. A gap over stallMs pauses and re-anchors the clock instead of catching up; a
     *  shorter one catches up, with this browser's input recorded for every tick (D-22). */
    advance(now: number): 'ran' | 'stalled' | 'paused';
    set controls(sample: () => number);
    /** Play again: a new Practice with the same settings, contacting no one (Q-15). */
    again(now: number): PracticeSession;
  }
  ```
- **Implements:** D-22, Q-15, P10, PLAN §8's Practice paragraph.

### 1.18 `src/net/transport.ts`: new (net-layer)

- **Exports:**
  ```ts
  /** What the glue needs of a room: Trystero's, or Practice's local one. */
  export interface Transport extends Link {
    peerCount(): number;
    readonly refusedBy: number | null;   // the last refusal this side received
    leave(): Promise<void>;
  }
  export type IceMode = 'default' | 'none' | 'local';
  export interface TransportOptions {
    readonly matchId: string;            // the Trystero room ID (REQUIREMENTS "Match ID")
    readonly relays: readonly string[];  // never empty
    readonly ice: IceMode;               // default: third-party.json's STUN; none: no ICE servers; local: none, and mDNS to loopback
    readonly turn?: readonly RTCIceServer[];
    readonly settings: TransportSettings;
  }
  ```

### 1.19 `src/net/room-config.ts`: new (net-layer)

- **Exports:**
  ```ts
  export const APP_ID = 'terriest';
  export const ACTION = 'terriest';      // not a setting: the one Trystero action (D-18)
  export const CURATED_RELAYS: string[];  // declaredUrls(third-party.json, 'signaling')
  export const STUN_URLS: string[];       // declaredUrls(third-party.json, 'stun')
  export function roomConfig(o: { readonly relays: readonly string[]; readonly ice: IceMode; readonly turn?: readonly RTCIceServer[]; readonly maxReceiveBytes: number }): JoinRoomConfig;
  ```
- **Ports:** roslambo's `src/net/room-config.ts`, through `vendor/hermet/room-config.ts`: a literal typed against `JoinRoomConfig`, the relays and STUN from `third-party.json`, `maxReceiveBytes` from configuration, `passive` always false, `loopbackMdns` only for `ice: 'local'`. TURN goes in `iceServers`, as roslambo's.
- **Implements:** D-18, §20.

### 1.20 `src/net/trystero.ts`: new (net-layer)

- **Purpose:** the only file that imports Trystero: one room, the two-round handshake, one binary action, pings, dropping a peer.
- **Exports:**
  ```ts
  export class TrysteroRoom implements Transport {
    constructor(o: TransportOptions, peer: RoomPeer, now: () => number);
    refusedBy: number | null;
    send(peer: string, bytes: Uint8Array): void;
    broadcast(bytes: Uint8Array): void;
    drop(peer: string): void;
    peerCount(): number;
    leave(): Promise<void>;
    /** "n of m relays reachable", for M4's Settings. */
    static relayHealth(): { open: number; total: number };
  }
  export function openRoom(o: TransportOptions, peer: RoomPeer, now: () => number): Transport;
  ```
- **Ports:** roslambo's `src/net/trystero.ts`. **Changes:** `appId` and the action `'terriest'`; the handshake timeout and the ping period from `TransportSettings`; `checkHello(theirs, now(), peerId)`; a handshake this side accepted that then fails, inside `onPeerHandshake` (the other side refused, or a receive rejected) or after it (Trystero's `onJoinError`, which reports a timed-out handshake by peer ID), calls `onHandshakeFailed(peerId)`; an accepted HELLO that `replaces` a silent connection drops that one first (C-12); every pong calls `onRtt`; the action's handler catches whatever the session throws, so nothing throws into Trystero, and rethrows it on a microtask, where it's the page's own uncaught error with its stack, which the e2e guard fails (§6.3); it leaves the room on `pagehide` as well as through Trystero's own `beforeunload` cleanup (§6.3, M3-Q20); no passive rooms.
- **Implements:** D-18, D-19's links, D-21's handshake, roslambo §9.4.

### 1.21 `src/net/local.ts`: new (net-layer)

- **Exports:** `export class LocalTransport implements Transport` with `refusedBy = null`, `peerCount() = 0`, `send` and `broadcast` that count and drop (`readonly offered: number`), `leave()` that resolves. It imports nothing from `src/net/trystero.ts` or Trystero.
- **Implements:** D-22, P10.

### 1.22 `src/net/loopback.ts`: new (net-layer)

- **Purpose:** the network simulator: an in-memory room in virtual time for the session tests and the correction measurement (§8.2).
- **Exports:**
  ```ts
  export function mulberry32(seed: number): () => number;
  export interface LinkSpec {
    readonly base: number;      // one-way ms
    readonly jitter: number;    // extra ms, uniform in [0, jitter)
    readonly loss?: number;     // the chance a message waits an extra round trip (2·base) on top
  }
  export interface NodeOptions { readonly clockOffset?: number; readonly drift?: number; readonly pingEveryMs?: number }
  export interface LoopNode<S extends RoomPeer = RoomPeer> {
    readonly id: string; readonly session: S;
    paceMs: number;             // between advance() calls: the timer, 1000 for a hidden page, Infinity frozen
    online: boolean;
    local(now: number): number;
    readonly neighbours: Set<string>;
  }
  export class LoopbackNet {
    /** latency(a, b, now): a link's spec when a message leaves, so a test can slow a link for a while. */
    constructor(seed: number, latency: (from: string, to: string, now: number) => LinkSpec);
    now: number; messages: number; bytes: number;
    readonly byType: Map<number, { messages: number; bytes: number }>;
    readonly nodes: Map<string, LoopNode>;
    readonly refusals: { from: string; to: string; reason: number }[];
    readonly drops: [string, string][];
    add<S extends RoomPeer>(id: string, make: (link: Link) => S, opts?: NodeOptions): LoopNode<S>;
    join(node: LoopNode, at: number, then?: (now: number) => void): void;
    leave(node: LoopNode, at: number): void;
    block(a: string, b: string): void;
    unblock(a: string, b: string): void;
    pace(node: LoopNode, at: number, ms: number): void;
    /** Loses the next message from `from` to `to` that `which` matches: D-11's lost-and-filled TICK. */
    dropNext(from: string, to: string, which: (bytes: Uint8Array) => boolean): void;
    /** Holds the next matching message ms longer; FIFO holds those behind it (§8.2's loss, on purpose). */
    delayNext(from: string, to: string, which: (bytes: Uint8Array) => boolean, ms: number): void;
    at(t: number, fn: () => void): void;
    run(until: number, stop?: () => boolean): void;
  }
  ```
- **Ports:** roslambo's `src/net/loopback.ts`. **Changes:** the handshake in two rounds over the link's latency, so a burst's handshakes overlap as Trystero's do (§6.2); pings every `pingEveryMs`, answered unless the peer is frozen; `loss`, with the FIFO rule turning it into head-of-line blocking (§8.2); `latency` gets `now`; `byType` for D-20's traffic; `dropNext` and `delayNext`; `now` and the peer ID passed to `checkHello`; an accepted `replaces` drops the old connection.
- **Implements:** §16's simulated network, D-16's measurement model.

### 1.23 `src/ui/clock.ts`: new (scoreboard)

- **Exports:**
  ```ts
  export interface Clock {
    now(): number;
    every(ms: number, fn: () => void): () => void;   // returns its cancel
    after(ms: number, fn: () => void): () => void;
  }
  export interface PageEvents {
    hidden(): boolean;
    onVisibility(fn: () => void): () => void;
  }
  export const browserClock: Clock;        // performance.now and setInterval
  export const browserPage: PageEvents;    // document.visibilityState and visibilitychange
  ```
- **`src/ui/clock-testing.ts`** (scoreboard): `FakeClock` (advances virtual time, firing timers in order, and can skip a gap to emulate a stall) and `fakePage()`, for `game.test.ts` and `src/ui/practice.test.ts`. Written in phase 3, so the two glue builders of phase 4 import it rather than declaring it.

### 1.24 `src/ui/game.ts`: new (net-glue)

- **Purpose:** one networked match in this tab: the session, its transport and its timer, the stall and visibility rules (D-31), the scoreboard, the match summary, traffic counts, and what the screens and the `#test=net` page need. M4 adds the screens around it.
- **Exports:**
  ```ts
  export interface NetGameOptions {
    readonly matchId: string; readonly me: string; readonly name: string; readonly coat: number;
    readonly build: string;
    readonly relays: readonly string[] | null;       // null: the curated relays, plus extraRelays
    readonly extraRelays?: readonly string[]; readonly turn?: readonly RTCIceServer[];
    readonly ice: IceMode;
    readonly net?: NetSettings;
    readonly clock?: Clock; readonly page?: PageEvents;
    /** Tests: a transport other than Trystero's. */
    readonly transport?: (peer: RoomPeer, now: () => number) => Promise<Transport>;
    readonly again?: AgainChoice;
    readonly verify?: number;
  }
  export interface Traffic {
    sent: number; received: number; sentBytes: number; receivedBytes: number;
    readonly byType: Record<number, { sent: number; received: number; sentBytes: number; receivedBytes: number }>;
  }
  export class NetGame {
    static open(o: NetGameOptions): Promise<NetGame>;  // imports src/net/trystero.ts dynamically
    /** Play again (§4.9): AGAIN in this room, the next room's NetGame (proposing there only if no AGAIN
     *  reached this one), and this one closed leaveGraceMs later. */
    playAgain(o: Omit<NetGameOptions, 'matchId' | 'again'>): Promise<NetGame>;
    readonly session: Session;
    readonly scoreboard: Scoreboard;
    readonly traffic: Traffic;                         // a counting Link round the transport, by type byte
    readonly tickCosts: number[];                      // ms per timer run that moved the clock: the load run's
    summary(): MatchNetSummary;
    propose(settings: MatchSettings): void;
    play(pack: Pack): void; watch(): void; ready(on: boolean): void; switchPack(): void;
    addBot(pack: Pack): boolean; removeBot(pack: Pack): boolean;
    set controls(sample: () => number);
    onControl: ((base: number) => void) | null;       // the session's, passed through (§4.6)
    failed(): boolean; refusal(): number | null; abandoned(): boolean;
    leave(): void;                                     // its LEAVEs go out, then close() after leaveGraceMs
    close(): void;
  }
  ```
- **Ports:** roslambo's `src/ui/game.ts`. **Changes:** no ledger, saves or witnesses; the timer and visibility through `Clock` and `PageEvents`; the stall checked on every timer run, not only on becoming visible (A.4's Timer stall), and handed to `session.stalled(now)` (§4.12); a fifth spectator leaves the room (§4.5); Play again (§4.9); the scoreboard and the summary updated after each advance; a counting link for the load run's traffic by type (§8.5).
- **Implements:** D-31, D-17's reload, D-21's spectator cap, PLAN §8's connection failure, Q-16.

### 1.25 `src/ui/practice.ts`: new (practice)

- **Exports:**
  ```ts
  export interface PracticeGameOptions {
    readonly me: string; readonly name: string; readonly coat: number;
    readonly settings: MatchSettings; readonly build: string;
    readonly net?: NetSettings; readonly clock?: Clock; readonly page?: PageEvents;
    /** The menu opens: a stall or a hidden page paused Practice (Q-15). */
    readonly onPause?: (why: 'stall' | 'hidden') => void;
  }
  export class PracticeGame {
    constructor(o: PracticeGameOptions);
    readonly practice: PracticeSession;
    readonly scoreboard: Scoreboard;
    pause(): void; resume(): void; readonly paused: boolean;
    ready(on: boolean): void;
    switchPack(): boolean;
    set controls(sample: () => number);
    again(): PracticeGame;
    close(): void;
  }
  ```
- **Implements:** D-22, Q-15's pause on a stall and on a hidden page, P10.

### 1.26 `src/nettest-params.ts`: new (net-glue)

- **Purpose:** the `#test=net` page's parameters, its hook's shapes, and the relays a build accepts (§6.7, §7), apart from the page so that `e2e/lib/browsers.ts` and the harness compile against them in the phase before the page exists.
- **Exports:** `NetParams`, `parseNetParams(hash: string, dev: boolean): NetParams | { error: string }`, `acceptedRelay(url: string, dev: boolean): boolean`, and the types `NetReport` and `NetHook` (§7.4). Tested by `src/nettest-params.test.ts`.

### 1.27 `src/nettest.ts`: new (net-page)

- **Purpose:** the `#test=net` page (§7): matches without the screens, over the real Trystero transport or Practice's local one, for M3's tests, the load run, and the owner's desktop check.
- **Exports:** `run(boot: Boot): void` (§7).
- **Ports:** roslambo's `src/nettest.ts`. **Changes:** packs, bots, the shared scripts, Practice, a DOM status for the owner's check, the hook on `window.terriestTest.net`, the relay rules; no canary until M4 wires it (§7.3).

### 1.28 `src/main.ts`: changed (net-page)

- `testPage() === 'net'` loads `./nettest` dynamically, as `determinism` is loaded. `TerriestTest` gains `net?: NetHook`, imported with `import type` from `./nettest-params`. A normal page is unchanged.

### 1.29 `src/net/dev-relay.ts`: new (net-layer)

- **Exports:** `export function devRelay(hostname: string): string | null;` — under `npm run dev:local`, `ws://<hostname>:<port>` from `import.meta.env.VITE_TERRIEST_LOCAL_RELAY_PORT`, else null.
- Imported only as `if (import.meta.env.DEV) { const { devRelay } = await import('./net/dev-relay'); … }`, so a production build drops the branch and never emits the chunk (PLAN §15's "read only under `import.meta.env.DEV`"), which the build's audit checks (§1.33).

### 1.30 `scripts/dev-local.mjs` and `package.json`'s `dev:local`: new (net-layer)

- `dev:local` is `node scripts/dev-local.mjs`: it starts `vendor/hermet/nostr-relay.mjs` on `127.0.0.1` at a free port, prints the port, and runs `vite` with `VITE_TERRIEST_LOCAL_RELAY_PORT` set; it closes the relay when Vite exits. Dev only: production never uses it (PLAN §15).

### 1.31 `scripts/build-inputs.mjs`, its test, `src/build-info.ts`, `src/build-info.d.ts`, `vite.config.ts`, `vitest.config.ts`: new or changed (net-layer)

- **`scripts/build-inputs.mjs`** exports `buildInputs(root): string`: the first 16 hex digits of SHA-256 over, in path order, each file's repo-relative path and bytes, for every `src/core/**/*.ts` but its `*.test.ts` and the three files peers may run in different versions without disagreeing, `src/core/bot/brain.ts`, `marks.ts` and `setups.ts` (a bot's or a script's inputs are inputs like a person's), plus `src/core/sim/goldens.json` (D-21, C-13, M3-Q3).
- **`vite.config.ts` and `vitest.config.ts`** define `__TERRIEST_BUILD_INPUTS__` as that string. Computed at build time, so `goldens.json` never enters the page's bundle, which `e2e/determinism.spec.ts` checks.
- **`src/build-info.ts`** exports `BUILD_INPUTS: string`, and **`src/build-info.d.ts`** declares the constant and `ImportMetaEnv.VITE_TERRIEST_LOCAL_RELAY_PORT`.
- **Test:** the hash changes when a simulation source, `goldens.json`, a timeline or protocol source, `src/core/bot/bot-id.ts` or a session file changes in a temporary copy; it ignores tests and `brain.ts`; and it equals what the page's bundle carries (`e2e/nettest.spec.ts`).

### 1.32 `scripts/expected-licenses.json`: changed (net-page)

- Gains `@trystero-p2p/core`, `@trystero-p2p/nostr` and `@noble/secp256k1` in the phase whose build first bundles `src/net/trystero.ts`, phase 5's, when `src/nettest.ts` brings `src/ui/game.ts` into the build (§11, §12): the audit fails an expected package that isn't bundled.

### 1.33 `scripts/dev-relay-audit.mjs`, its test, and `scripts/audit-dist.mjs`: new and changed (net-layer)

- **`dev-relay-audit.mjs`** exports `auditDevRelay(dist: string): string[]`: a problem for any file under `dist/` whose name starts with `dev-relay`, and for any shipped file that mentions `dev-relay` or `VITE_TERRIEST`. Vite replaces `import.meta.env.VITE_*` at build time and the URL is built at run time, so neither a bare address nor the variable's value would show a shipped dev relay; its chunk and its import would.
- **`audit-dist.mjs`** calls it after hermet's `runAuditDist` and fails the build on any problem. It already passes `ignoredHosts: ['stun']` for Trystero's STUN template, since M1 (D-37).
- **Test** (`scripts/dev-relay-audit.test.mjs`): a temporary `dist/` with a `dev-relay-<hash>.js` chunk, and one whose entry imports it, each fail; the real build's passes at the integration step.

### 1.34 `e2e/lib/browsers.ts`: new (net-glue)

- **Exports:**
  ```ts
  export type Engine = 'chromium' | 'firefox' | 'webkit';
  /** WebRTC between pages on one machine: Chromium without mDNS host candidates, Firefox with host
   *  addresses and loopback; Chromium also takes CHROMIUM_GL_ARGS (e2e/lib/gl.ts). */
  export function launch(engine: Engine): Promise<Browser>;
  export interface NetPage { readonly page: Page; readonly watch: PageWatch; readonly engine: Engine }
  /** A context and page: WebGL 2 asserted first, the hook installed, the page watched with only the
   *  base URL and the relay allowed (and extra prefixes, such as a dev server's ws:// origin), #test=net&…
   *  opened, and window.terriestTest.net awaited. */
  export function openNetPage(b: Browser, engine: Engine, base: string, relay: string | null, params: Readonly<Record<string, string | number>>, allowed?: readonly string[]): Promise<NetPage>;
  export function report(p: Page): Promise<NetReport>;
  export function hashAt(p: Page, t: number): Promise<string>;
  /** Polls report() until test(r) holds, failing at once when fail(r) names a reason, and on timeout with each page's phase, score and clock. */
  export function waitFor(pages: readonly NetPage[], test: (r: readonly NetReport[]) => boolean, o: { timeoutMs: number; fail?: (r: readonly NetReport[]) => string | null }): Promise<NetReport[]>;
  /** A fresh match ID for a room nobody else is in. */
  export function freshRoom(): string;
  /** An init script that counts RTCPeerConnection constructions as window.__rtcCount. */
  export function countPeerConnections(target: Page | BrowserContext): Promise<void>;
  ```
- **Ports:** roslambo's `e2e/lib/browsers.ts`. **Changes:** the guard's `watchPage` and `expectWebGL2` (CLAUDE.md's "Everywhere" and WebGL rules), `installHook`, the GL args, `freshRoom` from `src/core/match-id.ts`, `waitFor`.

### 1.35 The end-to-end specs: new (net-page)

- `e2e/match.net.spec.ts`: §8.4's scripted three-engine match.
- `e2e/nettest.spec.ts`, in each engine: a normal page has no net page, the net page's refusals, and the relay rules (§8.4).
- `e2e/practice-net.spec.ts`, Chromium only: Practice contacts nothing (§8.4).

### 1.36 `eslint.config.mjs`, `scripts/eslint/config.test.mjs` and its fixtures: changed (net-layer)

D-38's lint, extended for M3's two boundaries, each with a fixture its test lints, as D-38's "Testing the lint" asks:
- **`src/core` imports nothing outside `src/core` but `src/config.ts`:** a specifier that climbs out of `src/core` to anything else (`net`, `storage`, `ui`, `main`, `nettest`, `nettest-params`, `determinism`, `build-info`, and the existing `render`, `input`, `audio`) fails, statically and as `import()`. Today's `BROWSER_DIRS` names only `render`, `ui`, `input` and `audio`.
- **`src/net/trystero.ts` is never imported statically,** anywhere: an `import` or re-export whose specifier ends in `net/trystero` fails; `import('../net/trystero')` is allowed in `src/ui/game.ts` alone. A type-only import of it is allowed anywhere, as Trystero's own types are (D-18).

### 1.37 `dev/tuning/model.ts`: changed (config)

- **`NOT_TUNED`** gains each of §10's 19 keys with its reason, as M2 gave the M3 keys already there theirs ("the timeline's (D-11), M3", "the room's (D-21), M3", "the network's, M3"). None is a slider: neither `simParams` nor `botParams` reads any, which `dev/tuning/model.test.ts`'s "has a slider for exactly the settings simParams and botParams read" holds. Its other test, "puts every configuration key in the sliders or NOT_TUNED, never both", would otherwise fail at phase 1's first new key.

### 1.38 The runs outside the gate: new (harness)

- `dev/corrections.measure.ts` and `dev/corrections.vitest.config.ts`: the correction measurement (§9). Its own config, so the tuning metrics' command is unchanged.
- `dev/corrections.test.ts`: in the gate, the harness's loss model, its percentiles, bins and bootstrap on synthetic data.
- `e2e/load.run.ts` and `playwright.load.config.ts`: the 12-page load run (§8.5). Named `.run.ts`, so the gate's `playwright.config.ts`, which matches `*.spec.ts`, never runs it.
- `e2e/dev-local.run.ts` and `playwright.dev-local.config.ts`: the provisional settle of the owner's desktop connection, against `npm run dev:local` (§15).

### 1.39 The records: changed (settle)

- `src/config.ts`, `src/config.test.ts`, `dev/tuning/model.ts`, PLAN.md, `docs/acceptance.md`, README.md and CLAUDE.md, as §10 and §12's phase 6 say. `research/corrections/REPORT.md` and `results.json`, `research/load/results.json`, new. This design kept as `research/m3/DESIGN.md`, as M2's was. `src/core/session/index.ts`, new: what M4 imports from the session, as `src/core/sim/index.ts` is the simulation's.

### 1.40 The test files

Each is listed with its owner in §12, and mapped to the plan's properties and §16's items in §8. They are `src/core/protocol/{messages,fuzz,sizes}.test.ts`; `src/core/timeline/{inputs,history,votes,clock}.test.ts`, `timeline.test.ts`, `predict.test.ts`, `rollback.test.ts`, `spread.test.ts`; `src/core/session/{settings,build,roster,bots,scoreboard,summary}.test.ts`; `src/core/bot/setups.test.ts` and `brain.test.ts`'s new cases; `src/net/{loopback,room-config,third-party,local}.test.ts`; `src/net/{network,spectators,returning,misbehaving,stalls,consensus,replay,hidden,bots,bots-setups,abandoned,again,practice}.test.ts`; `src/ui/{game,practice}.test.ts`; `src/nettest-params.test.ts`; `scripts/build-inputs.test.mjs`, `scripts/dev-relay-audit.test.mjs`; `dev/corrections.test.ts`.

---

## 2. The timeline

roslambo's timeline, copied from its code (D-11), carries over with its M0 and 2026-10-25 fixes: the 16-tick history in every TICK; the joiner's warm-up; a joiner voting only once a tally agrees with it or after a resync; late votes counted while their tick is in the history; the clock's proportional correction, deadband, median and settling; STATE carrying the sender's clock; a TICK whose phase is at its cap not counting as a clock sample; "ahead" measured against the clock; after a stall, only the newest ticks' inputs sent; the tally counting only voters in this peer's own roster at the tick, a bot's host once; and JOIN, READY and UNREADY re-sent until the state shows them. What changes is below.

### 2.1 What the timeline holds

- **`F`, the final state,** at `finalTick`, as a `MatchState` object stepped in place by the timeline's one `Sim`.
- **The history** (§1.4): for each of the last `history` final ticks, A.1's bytes, their hash and the roster's IDs. Written at each finalisation by one `encodeState` (3.3 µs) and `hash64` of the copy, about 5–6 µs together at 8 terriers.
- **The predicted chain:** for each tick `u` in `(finalTick, validTo]`, an entry `{ state, used }`: the state after stepping `u`, its own object made by `cloneState` (0.51 µs), and `used`, the canonical `TickInput[]` the step took. A ring of `history` entries holds them; normally 12 to 14 are live.
- **`validTo`:** the last tick whose entry is valid. Entries after it must be recomputed. It never drops below `finalTick`.
- **The drawn head** (§2.8): `head`, `prevHead` and `headTick`, which the renderer reads, and which may be held while the chain is recomputed.
- **The inputs** (§1.3), per tick and sender, the marks (§2.2), and `newest(id)`.
- **Votes, the clock, the outbox** of events by sender, the resync in progress, the joiner's warm-up.

### 2.2 The simulation's inputs for a tick

- **Final inputs for tick `t`:** every record at `t`, each as `{ id, input: input & KEPT_BITS, events, …payload }`, canonicalised by `step`. A sender with no record is absent (D-10). Marks never reach a final tick: they're a prediction's.
- **Predicted inputs for tick `u`** (D-11), from the state the step starts from:
  - every record known at `u`, as above, events included;
  - for each terrier in that state with no record at `u`: if the sender has said it has no input for `u`, nothing; otherwise, if `newest(id)` is for a tick after `finalTick`, its input with no events; otherwise nothing, so it's predicted absent, as finalisation will make it (D-11's silent terriers).
- **The marks:** a TICK's present mask says, for each of the 16 ticks before its own, whether the sender has an input there. A clear bit means it has none, for good: a sender records its own input only when it sends that tick, and a tick it skipped after a stall (§2.4), or one before it first sent, never gets one. So the receiver marks `(sender, tick)` absent (`InputStore.markAbsent`), and prediction gives that tick what finalisation will. A record always beats a mark, so a mark can never make a final input. Since every TICK's history covers `d + w` (PLAN §7.4's check), every tick in `(finalTick, t]` of a sender whose TICK for `t` has arrived holds either a record or a mark while `finalTick` keeps pace, and only the ticks after the sender's newest are predicted from it; where a spread or a warm-up holds `finalTick` back further than the history reaches, `firstUnknown` covers the ticks between (§2.7).
- **The mask** (M3-Q12): the simulation reads only A.1's kept bits, 0–12, so the timeline hands it `input & KEPT_BITS`. A received input that differs from its prediction only in the bark counter or bit 15 then changes nothing the step sees: a reused final still matches, the re-simulation it would start is skipped (§2.7), and `sameInputs` compares what matters. The full u16 stays in the store, where `receivedInput` reads it for barks (D-16).
- **A predicted input never repeats a press** (D-10): it repeats the newest input with its press counters as they were, and the simulation acts only on a counter that changed since the terrier's stored previous input. So a press acts once, at its own tick, however often prediction repeats the input after it, and re-simulation can only move it to its true tick. `predict.test.ts` checks it, and that a TICK lost and filled from a later TICK's history leaves `newest` at the newer input, so no press acts twice (D-11).
- **Own inputs and hosted bots** are recorded when they're sent, for tick `n + d`, so they're always known, never predicted; the ticks a catch-up skips are marked absent for them too (§2.4).

### 2.3 One local tick, in order

`advance(now)`, called by the glue every `timerMs` (4 ms):

```
if not started or paused: return
if warming and (now ≥ warm.until or every expected sender heard): warming = false
target ← floor(clock(now))
budget ← spreadCap × max(1, target − localTick)                   // §2.8
while localTick < target:
    localTick ← localTick + 1
    if localTick > target − stallSendTicks: send(localTick, now)   // TICK for localTick + d (§2.4)
    else: markSkipped(localTick + d)                               // own and bots': absent for good
if not warming: budget −= finaliseToward(localTick − w, budget)      // §2.6
tallyTo(min(localTick − w − v, finalTick))                          // §3.2
if finalTick ≥ localTick − w or warming: budget −= predictToward(localTick, budget)   // §2.7; ≥, since tick 0 is final before localTick reaches w
expose()                                                            // §2.8: the drawn head, and onCorrection (§2.11)
clock.rebalance(now)                                                // every rebalanceMs (§1.6)
a resync's retry after resyncRetryMs; verify, as configured (§2.7)
```

A normal tick does no step to finalise, since the predicted entry is reused (§2.6), and one step to predict the new tick, plus a re-simulation from the earliest changed tick when a received input differs from its prediction. At a one-way delay of 80 ms that's about 4 more steps, once for each change of a remote input, as §9 measures. D-11's "usually 1–2 steps" holds for held inputs.

### 2.4 Sending

`send(n, now)` builds one TICK for tick `t = n + d`, as roslambo's does:
- **The own input,** if `sending`: `controls()` once, recorded with `put(me, t, …, own)` with the events the outbox holds for `me`, and its history: the presence and "same" masks over `t − 1 … t − 16` from the store, a clear present bit wherever this browser has no input of its own.
- **Each hosted bot's input,** `bots.get(id)()` once, recorded the same way. A bot's sampler thinks once per head tick (§1.11): every tick a catch-up sends in one advance reads the same head, so it gets the same input, its press counters unchanged.
- **Events** ride in every TICK until their tick is final here, as `back = t − e.t` (at most 255). A joiner's held warm-up or a spread repair keeps `finalTick` back, so an event can ride further back than the 16-tick history; §5.3 allows that.
- **The vote:** `(finalTick, hashAt(finalTick))` when `votesFor(finalTick)` holds and no repair is under way (§3.1); else `NO_TICK` and a zero hash.
- **The clock phase:** `clock(now) − n`, clamped below 1.
- **After a catch-up** of more than `stallSendTicks` local ticks, only the newest `stallSendTicks` are sent (A.4's Timer stall, D-10); the skipped ticks are finalised absent everywhere, and `markSkipped` marks them absent here for this browser and its bots, so its own prediction agrees. Practice sets `stallSendTicks` to Infinity, so a catch-up records every tick's local input (D-22).
- A JOIN's name is recorded as `wireString(name)` (§5.7), exactly what receivers decode.

### 2.5 Receiving a TICK

`onTick(origin, m, now, direct)`, after the session has attributed it (§4.10):

```
lo ← warming ? finalTick : max(finalTick, ⌊clock(now)⌋ − w)        // the late boundary (§2.8)
hi ← ⌊clock(now)⌋ + 2w + d                                         // "ahead", of the clock (roslambo)
take(origin, m.t, m.own) if m.own
for each bot entry b with b.id among botIds(origin): take(b.id, m.t, b)
the vote, if any: booked (§3.1), re-tallied if its tick was tallied
heard(origin); if direct and m.phase is below its cap: clock.sample(origin, …)

take(id, t, x):
    old ← the value id's unknown ticks are predicted with: newest(id).input & KEPT if newest(id).tick > finalTick, else absent
    record(id, t, x.input)                                          // its own input first,
    for k in 0 … 15: present bit k ? record(id, t − 1 − k, hist[k]) : mark(id, t − 1 − k)   // then its history,
    for each event e: recordEvents(id, t − e.back, e)               // then its events
    if that value now differs from old: touch(firstUnknown(id, finalTick, validTo))   // §2.7
```

- **The order matters:** an event finds its tick's record made by the input or the history first. An event whose tick still has no record (one further back than the history, whose input came on a path that hasn't delivered it yet) makes a record of input 0 by events alone, which the input completes when it comes (§1.3), so the result doesn't depend on which arrived first. If the input never comes in time, that record is final with input 0, as wrong as any input that's late here.
- **Each write** is kept only inside `(lo, hi]`; one at or before `lo` counts in `late` and `lateBy`, and one past `hi` is dropped (roslambo §9.3). The stores' own windows are §2.12's.

### 2.6 Finalisation, and reusing a prediction

```
finaliseToward(target, budget):
  while finalTick < target and budget > 0:
    t ← finalTick + 1
    ins ← finalInputs(t)
    if t ≤ validTo and sameInputs(ins, entry(t).used):
        F ← entry(t).state (cloned instead if the drawn head or prevHead is that object); discard entry(t)
        stats.reusedFinals++; verify, as configured                 // no step
    else:
        step(sim, F, ins); validTo ← t; budget −= 1; stats.steppedFinals++   // the base changed: t + 1 on is touched (§2.11)
    finalTick ← t
    store(t)          // bytes, hash and roster into the history; my vote if votesFor(t), replacing any (§3.1)
    for each terrier whose newest tick is t: touch(t + 1)           // from here it's predicted absent (§2.7)
    lateAbsent candidates: senders absent from ins that are in the roster (§9.3's count)
    retire(t − history) in the store and the vote book (§2.12)
```

- **The base changed** (D-11): stepping `F` with final inputs that differ from what entry `t` used means every later entry was computed from a different state, so `validTo ← t` invalidates them all. That covers "a newly final tick's inputs differ from those its prediction used", the silent terrier predicted from its last input and finalised absent included.
- **A terrier falls silent:** once `finalTick` reaches a sender's newest tick, D-11's rule predicts it absent from the next tick on, where it was predicted from its last input. The loop touches `t + 1` for each such terrier, so the chain follows the rule at once rather than at the next changed base. A hidden page, silent about a second between its bursts, costs one such re-simulation a burst.
- **During the joiner's warm-up,** finalisation is held (roslambo M0).

### 2.7 Prediction, rollback and re-simulation

```
predictToward(target, budget):
  for u from validTo + 1 to target, while budget > 0:
    base ← (u − 1 = finalTick) ? F : entry(u − 1).state
    used ← predictedInputs(u, base)            // §2.2
    s ← cloneState(base); step(sim, s, used)
    entry(u) ← { state: s, used }; validTo ← u; budget −= 1
```

**Invalidation:** every change to what a predicted tick would use lowers `validTo` to the tick before it (`touch(u)`: `validTo ← max(finalTick, min(validTo, u − 1))`, and the earliest touched tick is kept for §2.11). The list is what §2.2's rule reads: a tick's records, its marks, each sender's newest input, `finalTick`, and the base.
- **A record written at `u`** in `(finalTick, validTo]`, new, merged, completed or with a changed payload (`put` or `putEvents` returns `'new'` or `'merged'`): `touch(u)`, unless the resulting record equals the entry for that sender in `entry(u).used` field by field, as `sameInputs` compares one `TickInput` (masked input, events, pack, coat, name and switch pack), the common case of a held input, when the chain is already right. `verify` checks both branches.
- **A mark written at `u`:** `touch(u)`, unless `entry(u).used` has no entry for that sender.
- **A change in the value a terrier's unknown ticks are predicted with** (`take`'s `old` and the value after, §2.5): newest's input becoming another, absent becoming an input, or the reverse. `touch(firstUnknown(id, finalTick, validTo))`: the first tick after `finalTick` with neither a record nor a mark for it. With the marks that's normally the tick after its newest; where the history doesn't reach back to `finalTick`, held back by a spread or a warm-up, it's the first tick of that gap, so the ticks before the newest that no record or mark covers follow the new value too.
- **`finalTick` reaching a terrier's newest tick:** `touch(t + 1)` (§2.6).
- **Inputs imported from a STATE,** and the STATE's state itself: a changed base (§3.4).
- **Own inputs** are recorded for `n + d`, past the head, and touch nothing; nor do the marks `markSkipped` writes there.

The chain is re-simulated from `validTo + 1`, the earliest tick whose base or inputs changed, through the head (D-11). `stats.rollbacks` counts the re-simulations that changed an existing entry, and the correction observer reports the drawn head's before and after (§2.11).

**The full replay, one flag away** (D-11): `mode: 'fullReplay'` steps `F` for every final tick, never reusing, and recomputes the whole window from `F` every tick with the same `predictedInputs`, as roslambo recomputes it. The spread's budget still applies. Its final chain and its heads, outside a repair, are identical to the incremental mode's, which `replay.test.ts` checks scenario by scenario.

**`verify: n`** (tests only): after the advances it covers (§1.7), outside a repair, the timeline recomputes the window from `F` with `predictedInputs` and compares each entry's `hashState` and `used` with the incremental entry's, and each reused final as §2.6 says. Every mismatch counts in `stats.verifyMismatches` and logs its tick. §16's "every loopback scenario … with each tick's predicted chain checked against a full replay" is `verify` in every loopback test, on one node at `verify: 8` in each and on every node at `verify: 1` in `replay.test.ts` (§8.1).

### 2.8 Worst ticks, spread (D-11, M0), and the drawn head

- **The budget** is `spreadCap × max(1, ticks the clock moved in this call)` steps, 42 a tick to start (A.4). Finalisation spends it first, then prediction. A reused final costs no step.
- **What exceeds it:** only a changed base far back: a late-vote repair, up to about 270 steps, a joiner's warm-up longer than expected, and, if §9.6 lowers the cap under 42, a joiner's catch-up. A resync (about 30) fits one tick (C-2, M0). A normal tick's worst, a late input at the window's start, is `w + 1` = 13 steps, and §10's configuration check keeps the cap at least `w + 1`, so a normal tick is never spread.
- **The drawn head's contract:** `head` and `prevHead` are objects the timeline never writes again: an entry of the chain, which isn't written once entered, or a clone of `F` when the head is at the final tick. Neither is ever `F`, which finalisation steps in place, and a reused final never takes an object either one holds (§2.6). `expose()` moves them only when the recomputed chain reaches the tick the head shows: when `validTo > headTick`, `prevHead ← head`, `head ←` the state at `validTo` and `headTick ← validTo`; when `validTo = headTick` and that tick was recomputed, `head` takes the recomputed state at the same tick; otherwise all three hold, and `stats.holds` counts an advance whose clock moved while the head didn't. So a spread whose budget runs out mid-chain never moves the drawn head back. `alpha(now)` is `clock(now) − headTick`, clamped to 0..1.
- **While a repair is spread:**
  - `finalTick` lags `localTick − w`, and the drawn head holds. `alpha` is 1 while the head is held behind `localTick`, so the drawing pauses for at most `⌈270 / 42⌉` = 7 ticks, about 117 ms, then takes the corrected state as a correction, which M4's glide smooths (D-16).
  - `repairing` is true, so `isConfirmed(t)` is false for every `t` (D-14's latch waits), and no TICK carries a vote (§3.1).
  - Each hosted bot thinks once per head tick, so it holds its input through the hold (§1.11).
  - Inputs keep arriving and being sent. Tallies wait for `finalTick`, and late votes are ignored until the repair is done (roslambo).
- **The late boundary,** outside a joiner's warm-up, is `max(finalTick, ⌊clock(now)⌋ − w)`, measured on the clock as roslambo's "ahead" is. On an awake page that's `localTick − w`, the tick every other peer finalised on time, so an input they dropped as late is dropped here too: during a spread, whose `finalTick` lags, and on a hidden page, whose timers wake about once a second and whose `finalTick` is up to a second stale while messages keep arriving (D-31). roslambo's boundary, `finalTick` alone, let such a page take an input everyone else had finalised absent, and diverge when it woke. During a joiner's warm-up the boundary stays `finalTick`, since accepting inputs in flight is the warm-up's purpose (roslambo M0).
- **Hidden pages:** a page whose timers wake once a second advances about 60 ticks a call, so its budget is about 2,520 steps, and it catches up in the same call. Its frames aren't judged (D-31).
- **The cap is checked** by §9.6: the worst spread tick's time, measured over repeated forced repairs, against L286's 50 ms on M0's measured ratio for Chromium at 4× throttle, with M4's bench repeating it in the browser (M3-Q14).

### 2.9 Snapshots kept and restored exactly

- **Final states** are kept as A.1's bytes, and a STATE's state is restored with `decodeState`. The codec writes every field the step reads, −0 included, and refuses non-finite floats, so `decodeState(encodeState(s))` re-encodes to the same bytes and steps to the same hashes; the step holds nothing between calls (PLAN §7.2's M2 note). `timeline.test.ts` steps a decoded copy beside its original for 600 ticks of the wall scrum and the kickoff scripts, hash by hash.
- **Predicted states** are `cloneState` copies, never shared, never written after they're entered, except by `F` taking over the entry it reuses, which is never one the drawn head holds.
- **Nothing else is state:** the `Sim`'s scratch, the intents, the brain's memory and the clock aren't in the hash and never reach another peer.

### 2.10 Confirmation

`isConfirmed(t)` is `started && agreedTo ≥ t && !repairing` (roslambo D-10 as amended at its M4). `agreedTo` moves at each tally that agrees with this browser's hash or counts no other vote, and to the repaired tick when a resync completes (§3). D-14's latch reads it after each advance (§1.15, §3.5).

### 2.11 Corrections, the glide, w and d

- **The observer:** a correction is every re-simulation that recomputes the tick the drawn head shows. `expose()` (§2.8) fires `onCorrection({ tick: H, from, before, after, repair })` when it moves the head and the earliest tick touched since the last exposure is at or before `H`, the head's old tick: `before` is the head as drawn, `after` the recomputed state at `H`, `from` that earliest tick, and `repair` whether the base came from a STATE. It fires for every such recomputation, zero changes included, as §17's "at every rollback" reads: a changed input that belongs to a sitting or tumbling terrier can recompute a head that doesn't move (a bark alone recomputes nothing, §2.2). The consumer measures the change: §9 counts the zeros apart and decides on the moved bodies (§9.4), and M4's smoothing builds its offsets from the same events (D-16). Nothing in the timeline smooths: the simulation is never smoothed (L207).
- **The glide's values,** `smoothingMs` and `ownSmoothingMs` (A.4), are chosen by §9's rule from the measured corrections, and M4 checks them with the bench's virtual peers (D-16).
- **w = 12** (L340) and **d = 2** come from configuration; §9's rules confirm or change them. d changes only the build hash. w also changes `celebrationTicks`, held for `w + v` more ticks, so a change of w re-emits the goldens (CLAUDE.md).

### 2.12 The stores' windows

- **What's needed:** a record, a mark, a record made by events and a vote are kept for ticks in `(finalTick − history, ⌊clock(now)⌋ + 2w + d]` for inputs, and `(finalTick − history, ⌊clock(now)⌋ + w]` for votes: what a STATE reply, a late vote and a tally read, and what may arrive early (roslambo §9.3). The timeline drops a write outside them before it reaches a store (§2.5, §3.1).
- **Rings that never lose a needed tick:** the input store and the vote book are rings of `inputSpan` ticks (1024 at A.4's values: the smallest power of two at least twice `history + 2w + d`, so a page whose clock runs as much as 12 s past its final tick still fits, and a stall over 2 s is §4.12's anyway). A slot is reused only once its tick is retired, at or before `finalTick − history` (§2.6); a write for a tick whose slot still holds a needed one is refused, never evicting it. roslambo's ring cleared any slot holding another tick, and its vote map kept a vote for any tick until the tally passed it.
- **A STATE stays inside them:** its tick bounds (§5.5) keep `g`, `senderFinal`, `senderTick` and its records within the window, and `replace` refuses a tick outside it.

### 2.13 The tick clock on timers

The glue runs `advance` on a `timerMs` timer, never on animation frames (D-31). `TickClock` is roslambo's (§1.6). Practice's `pause` freezes it and `resume` re-anchors it where it stopped, so Practice never catches up across a pause (D-22). `reanchor` continues from `localTick` after a stall when no peer's clock ran on through it (§4.12).

---

## 3. Consensus

### 3.1 Votes in every TICK (D-13)

- **Recording its own vote:** `store(t)` books this browser's vote for `t` whenever `votesFor(t)` holds: it's confirmed (a joiner after its first agreeing tally or a resync), `t` is past its `quietUntil`, and it controls a terrier in its own roster at `t`, its player's or a bot it hosts (one vote however many). It does so whatever `repairing` says, replacing any vote of its own already booked for `t`. So a repair's re-finalisation replaces this browser's stale votes for the ticks it rewrites, as roslambo's `store` overwrote them for ticks not yet tallied.
- **Sending one:** a TICK carries `(finalTick, hash)` only when `votesFor(finalTick)` holds and no repair is under way: no resync outstanding, no spread, no warm-up. A browser that has lost a tally stops telling others its losing hashes until it holds the winner's.
- **Booking others':** a receiver books a vote under the sender's player ID, from the connection or the FWD's origin, never from the message's content, and only for a tick in §2.12's window. The vote's hash is 8 bytes on the wire and 16 hex digits in the book.

### 3.2 The tally

- At local tick `g + w + v`, 0.4 s after `g`, for each `g` up to `finalTick`: `VoteBook.tally(g, hashAt(g), counts)`, where `counts(voter)` is "the voter, or a bot derived from it, is in my roster at `g`" (D-13, roslambo M3 and Q-23).
- **Most votes win; the smallest hash on a tie,** compared as 16 hex digits, which order as the unsigned big-endian numbers they spell (A.1).
- **Outcomes:** no counted vote: this browser trusts itself, `agreedTo ← g` (a lone peer, Practice, a match of spectators). Agree: `agreedTo ← g`. Disagree: a resync from `g` (§3.4), unless one is under way.
- **Late votes** still count while their tick is in the history: each arriving vote for an already tallied tick re-tallies it, and a changed outcome starts a resync (`lateVoteFlips`), except during a repair or for a tick before the last repair's (roslambo M0).

### 3.3 Goals and the end only from confirmed ticks (D-14)

The simulation computes goals and the end in the state, predicted and final alike. The net's bulge is drawn from the predicted state (Q-7). Everything else waits for `isConfirmed`: the scoreboard (§1.15) latches each goal when its tick is confirmed, and the end when the end's tick is.

### 3.4 What a mismatch does: the STATE resync (A.1)

- **Asking:** a STATE_REQ `(g, winning hash)` to the voter for the winner with the smallest player ID that this browser reaches directly, then to the next every `resyncRetryMs` (500 ms). With none left, `resyncFailed`, and the next tally that disagrees tries again.
- **Answering** (`onStateReq`):
  - **Not while a resync is outstanding** (`answering` false): this browser's history from the tally it lost is known to lose, and a joiner shouldn't take its newest final state either. Nor while the session decides or rejoins after a stall (§4.12). The asker moves to its next candidate after `resyncRetryMs`, or a joiner to its next peer after `stateRequestRetryMs`.
  - **`(NO_TICK, zero)`,** a joiner's or a merge's: the newest final state.
  - **`(t, want)`:** only if `t ≤ finalTick`, the history holds `t` and its hash is `want` (or `want` is zero); otherwise no answer. roslambo sent its newest final state instead, which the asker always rejects as unasked (it checks `g`), so that answer was 10 KB wasted.
  - **What it sends:** the history's bytes at the tick; then every known input from that tick + 1 to `localTick + d`, as records with the ID table (§5.5); the sender's clock reading, never its stale `localTick` (roslambo 2026-10-25). As many input ticks as fit in 16,000 bytes; a STATE that drops any counts in `statesTruncated`, which D-18's size test pins at 0 for the largest cases (§5.5).
  - **How often:** at most one answer per requesting connection per `resyncRetryMs`, the faster of the two honest retries; the session counts the rest as invalid (§4.10).
- **Taking it:** only a solicited STATE: for this timeline's ID, at the asked tick, hashing to the winner, inside §5.5's bounds. Then:
  1. `F ← decoded state`, `finalTick ← g`, the history's entry at `g` replaced and every tick after it dropped (`dropAfter`), so nothing reads the losing lineage's hashes; `hashAt(t)` is '' past `finalTick` anyway;
  2. inputs up to the sender's final tick replace this browser's exactly, absences included; after it they're added (roslambo);
  3. `validTo ← g`; the steps to re-finalise up to the tick this browser had finalised, and to predict to `localTick`, run under the spread's budget (§2.8); each re-finalised tick books this browser's repaired vote in place of its stale one (§3.1), and tallies wait for `finalTick`;
  4. once caught up: `repairedFrom ← g`, `confirmed`, `agreedTo ← max(agreedTo, g)`, `stats.resyncs` and `resyncMs` recorded, `repairing` false, votes sent again.
- **Joining:** a browser without a timeline adopts the first STATE from a peer it asked (§4.2), with roslambo's warm-up: `localTick` set from the sender's clock and the one-way delay, finalisation held until every sender active in the STATE's inputs has been heard from or `warmupMs` has passed, votes off until a tally agrees.

### 3.5 The latch

`Scoreboard.update(t)` after each advance:
- **A goal:** when `F.lastGoalTick` is a tick `L` not yet latched, `t.isConfirmed(L)`, and `L` came after this browser's arrival or its celebration was under way when it arrived, latch `{ L, pack, ownGoal, scorers, score }` from `F`. Goals are at least a celebration and a kickoff countdown apart, 384 ticks, so the final state's last goal names each one while it's confirmable (A.1 keeps scorers until the next placement, 204 ticks after the goal, and the goal is confirmed 24 ticks after it).
- **Withdrawal** (C-4): only when a repair completes from `g < L` and the repaired `F.lastGoalTick ≠ L`. A repair reaches back at most 255 ticks, so only the last latched goal can be affected.
- **The end:** when `F.phase` is ended and `isConfirmed(F.phaseStart)`, the rows from `F` (`terriest`, `winner`, bots told apart by `isBot`). The end is terminal, so a browser that arrives later adopts it and confirms it with its first tally (C-50).
- **Arriving mid-match:** the latch starts from the adopted state's score; a goal whose celebration is under way is latched once confirmed, with its scorers (A.1).

### 3.6 Two voters, whose repairs mustn't cross (C-10)

With two voting browsers every disagreement is a tie that the smallest hash wins (C-10), tick by tick, so after a divergence each browser loses about half its tallies to the other's votes. If the dissenter B kept voting and kept serving its history, the other browser A, losing a tie to one of B's votes already sent, would ask B for its losing state while B waited for A's, and the two would swap states and go on differing. A request of A's crosses B's repair when A loses one of the ties in the ticks before B's repair can land, one fewer than the one-way delay in ticks: at 80 ms, about 4, so with a chance of about 1 − 2⁻⁴, over 90%, and again at the next divergence. Three rules stop it:
- B stops sending votes when it loses (§3.1), so only the votes it had already sent can mislead A: at most `v` ticks' worth;
- B answers no STATE_REQ while its resync is outstanding (§3.4), so A's resync for one of those ticks fails (`resyncFailed`) instead of adopting B's state, and A keeps the majority's;
- B's re-finalisation books its repaired votes in place of its stale ones (§3.1), so once B's repair is done every tally at both agrees.

A pays for a spurious loss with one failed resync, `resyncRetryMs` without confirming, once per divergence of B's. `consensus.test.ts` plays it at 1 a side, 30 and 80 ms, with a dropped input and seeds where the following ties favour the dissenter, and asserts one completed resync, no state adopted from the dissenter, and equal hashes within P3's bound; and a three-way split among three voters, where the smallest hash wins and two repair to it. roslambo's P3 tests used three players, so this path was untested there.

---

## 4. The session and the roster

### 4.1 Roles (PLAN §8)

| Role | Who | Sends TICKs | Votes | HELLO and PEERS role |
|---|---|---|---|---|
| Keeper | the proposer, before Play or Watch | no, unless it hosts bots | only with a bot in the roster | 1 |
| Undecided | connected, holding the state, choosing (Join) | no | no | 4 |
| Candidate | sent JOIN, not yet in the roster | yes | no | 2 |
| Player | in the roster | yes | yes | 2 |
| Spectator | chose Watch or was refused as a player | only for bots it hosts | once, while a bot of its is in the roster | 3 |

### 4.2 A match's life

1. **Propose:** genesis (pack size, match length, tick 0), `Session.propose(now, settings, timelineId)` with a random 8-byte ID, the keeper role. The glue sets `#join=` at M4.
2. **Join:** the browser connects as undecided, asks a live peer for STATE every `stateRequestRetryMs`, rotating among live peers in `beats` order (roslambo's `askToJoin`), and adopts it (§3.4).
3. **Play in a pack:** `play(pack)` queues `JOIN(pack, coat, wireString(name))` once a timeline is held, and again `eventRetryTicks` after it's final without the state showing the terrier. When a final tick shows that pack full or the start countdown begun, the JOIN is given up: `refused` is `'full'` or `'started'`, `sending` stops, and the UI offers the other pack or watches (D-12). Play again's preference falls back by itself (§4.9).
4. **Watch:** `watch()` makes it a spectator and counts (§4.5).
5. **Ready, Switch, Leave:** `ready(on)` as roslambo's `keepReady`, re-sent until the state shows it, the wish ended by its expiry or a new join. `switchPack()` queues `SWITCH(other)`, re-sent likewise, given up when a final tick shows the other pack full or the countdown begun (`switchRefused`); a switch cancels the Ready and ends the Ready wish (D-12). `leave()` queues LEAVE for the player and every hosted bot; LEAVE isn't re-sent (D-12), and the glue closes the room `leaveGraceMs` later, once the LEAVE is final at the sender.
6. **Warm-up, the start countdown, play, celebrations, kickoffs and the end** are the state's (PLAN §7.2).

### 4.3 The handshake: build hash, spectator count, duplicates (D-21)

`checkHello(hello, now, peer)`, in order:
1. **Protocol and build** (`commonRefusal`): a different protocol version or build hash gets REFUSE 1 or 2, "Reload to get the latest version". The build hash is §1.9's, so any change to a setting, the codec, the protocol, the agreeing `src/core` sources or the goldens keeps old and new builds apart (C-13).
2. **This browser's own ID, or a bot's:** REFUSE 3. A bot only ever rides in its host's TICK (D-39), and its ID is version 8, so every peer tells it from a person's (`isBot`): a HELLO under a bot's ID speaks for a bot that has no connection of its own, and its TICKs would race the host's entries for the same (bot, tick).
3. **A duplicate** (C-12): a HELLO whose player ID is already connected is accepted, with `replaces` naming the old connection, if that connection has been silent, with no message and no pong, for `duplicateSilentMs` (2 s); otherwise REFUSE 3, "This match is open in another tab or device". Each such HELLO is logged in `duplicates`, with how long the old connection had been silent and when its leave arrived, so a failure in the end-to-end reload says which rule refused it.
4. **Admission** (D-21), only for a HELLO whose player ID, and every bot derived from it, is outside this browser's final roster, and only when this browser holds the state:
   - **Counted:** the connected browsers outside the roster, the HELLOs from outside it this browser has admitted whose handshakes are still under way, and this browser if it's outside the roster too;
   - **admitted** while `admits(…)` holds, that count under `spectatorsMax + freePlaces(F)`. An admitted HELLO **reserves its place** under its transport peer ID until `onPeerJoin`, `onHandshakeFailed` or `handshakeTimeoutMs`, whichever comes first, so a burst of newcomers whose handshakes overlap can't all pass on the count from before the burst. In Trystero a handshake runs on its own for each peer and `onPeerJoin` comes at least a round trip after `checkHello`; without the reservation, C-11's "two handshakes at once can both pass" stays;
   - **otherwise** REFUSE 4.

   Every HELLO from outside the roster counts, whatever role it announces, where D-21's text names the undecided ones: a role is what a peer says of itself, so counting only role 4 would let any newcomer past the cap by announcing 3. The honest HELLOs from outside the roster that aren't undecided are a spectator's whose link re-forms, and a competing timeline's keeper, candidates and players in a merge; each brings back a browser the mesh already held, so the count admits it whenever the mesh is within its cap (M3-Q16). A browser without the state admits everyone, so two newcomers handshake without one (§16). A HELLO whose player ID or bots are in the roster is admitted whatever the counts: a returning player or bot host, which HELLOs as undecided (D-17).
5. Then both sides send their verdicts, as roslambo's two-round handshake (§6.3).

### 4.4 Player IDs, duplicates and the connection map (D-24, D-25)

- **The player ID** comes from the session's caller: at M4 the profile's, a `crypto.randomUUID()` made once and stored (D-25), never Trystero's per-load `selfId`, which the transport only maps to a player through HELLO (L347). At M3 the `#test=net` page derives its IDs from its parameters (§7.2).
- **One game tab** (D-24) is M4's tab lock. Without it, two tabs of one browser are one player ID twice, which C-12's rule below refuses while the first is alive.
- **A connection's liveness** is its last message or pong (`onRtt`). Pings go to every peer every `pingEveryMs` (1 s), at most half `duplicateSilentMs` (PLAN §7.4's check), so a live connection is never silent for 2 s, though a keeper, an undecided peer and a spectator send nothing but PEERS every 5 s, and Trystero's pings never reach `onMessage`. roslambo refused every duplicate, so it needed no such rule. A frozen or killed page answers no ping, so its connection does go silent, which is C-12's case.
- **An accepted `replaces`** drops the old connection (`link.drop`), whose page is gone or frozen. The player-to-peer map takes the new connection; FWD and votes from the old one stop with it.
- **A connection's leave** clears the player-keyed state, its PEERS entry, its clock samples and its one-way delay, only while that player still maps to the leaving connection. Under C-12 the replaced connection's leave can arrive after its replacement joined, and roslambo's `onPeerLeave` cleared `peersOf` whatever the map said.

### 4.5 Spectators (D-21, C-11)

- **Announced roles:** each browser announces its role in HELLO, and in PEERS when it changes and every `peersEveryMs` (PLAN §9's role byte).
- **On Watch, or when a JOIN is given up and the browser watches:** if this browser is outside the roster, with none of its bots in it, `spectatorsOverCap(announced spectators connected + 1, spectatorsMax)` sets `spectatorsFull`, and NetGame leaves the room: it stops its pending bots' JOINs and closes after `leaveGraceMs`. M4 shows "This match has the most spectators it can take", with Home (C-11). A browser whose bots are in the roster isn't outside it, so a bot host is never turned away and no bot loses its host. Two browsers that choose Watch within one message's delay can both pass, the accepted residual.
- **A REFUSE 4 from any peer** leaves the room the same way: that peer counted no place for it.
- **A peer lingering on Join** is undecided, not a spectator, so it doesn't turn a watcher away (§16).

### 4.6 Returning players and rejoins (D-10, D-17, L137, L215)

- **On adopting a STATE,** whether joining, returning after a reload, rejoining after a stall (§4.12), or taking the winner's timeline in a merge:
  - **the roster holds this browser's player ID:** it takes control at once, `sending` with no JOIN, and the session calls `onControl` with that terrier's stored previous input, from which the input source starts its press counters (D-10). On a page's first timeline that's a returning player (`returning`), and the UI skips Join (L215).
  - **it isn't in the roster, but this page pressed Play** before (a rejoin whose terrier the state removed after 3 s silent in warm-up, or a merge's losing side): it JOINs its pack again, given up as any JOIN is (D-12), as roslambo's frozen page "joins again at the end" and its merge's losing player joins again. L137's "if they come back, they join again like anyone else" is a reload's case: a fresh page that isn't in the roster starts undecided, on Join.
  - **its bots:** `BotHost.adopt` hosts again every bot derived from this browser's ID that's in the roster, each brain from its terrier's previous input, and `BotHost.reset` sends again the JOINs of wanted bots that aren't.
- **A resync,** which keeps the timeline, calls no `onControl`: D-10's counters delay a press the STATE dropped rather than repeat it.
- **The warm-up** doesn't expect inputs from this browser's own bots (roslambo).

### 4.7 Abandoned matches (Q-16, D-17)

- **`abandoned(now)`:** the final state is past warm-up and not ended, this browser controls no terrier (no own terrier it sends for, no hosted bot in the roster), and no TICK from a browser that does (its ID or a derived bot in the final roster) has arrived for `abandonedMs` (30 s), counting from this browser's arrival if that's later. The glue reports it; M4 shows "The players have left" with the score so far.
- **Once the final state is ended,** `abandoned` is false: the end is shown on Results (C-50), and a browser that arrives then adopts it from one still there (D-17's "after the end"), whoever has left. Otherwise a spectator still on Results 30 s after the players left would read both.
- **Before the start countdown** nothing is abandoned: silent players are removed by the state, and a match whose browsers all watch waits for players (L130, L163).

### 4.8 Bot hosting (D-39, PLAN §14)

- **Adding:** before the start countdown, one at a time, up to the pack's free places counting joins on their way (`canAddBot(pack)`). IDs are `botId(me, k)` for the first unused `k` of `BOT_SLOTS` (8: Practice's 7 and a spare). Each JOIN carries `botCoat(id)`, `botName(id)` and READY.
- **Each sent tick,** the timeline samples each bot once in `send`, for tick `n + d`, and the sampler thinks once per head tick (§1.11): `think(brain, timeline.head)`, the head as the advance found it. Every tick of a catch-up reads one head and gets one input, its press counters unchanged; a head held through a spread holds the bot's input too. The brain never runs in a re-simulation, so a replay pays nothing for it (C-2). Its view ring is keyed by tick (§1.12), so its reaction stays 0.25 s however the head moves.
- **Ready:** a host sends a bot's READY again once its Ready has `botReadyRenewTicks` left (10 s), so a bot is always ready (C-41). roslambo re-sent it only after it expired, which left the bot not ready for a moment.
- **Removing:** `removeBot(pack)` takes this browser's newest wanted bot in that pack: its LEAVE, then unhosted once the LEAVE is final here. A LEAVE that lands after the roster locked leaves the bot playing, hosted again (roslambo).
- **Its host away:** the bot gets no input, so the state removes it after 3 s in warm-up and sits it after 2 s from the start countdown on (D-12, D-16). A host that comes back adopts it (§4.6).
- **Inputs only from the host:** a receiver takes a bot's entry only when its ID is one of `botIds(origin)`, cached per origin (roslambo Q-23), and never a bot's of its own (§4.10).
- **Votes:** the host votes once while any bot of its, or its player, is in its roster (§3.1).

### 4.9 Play again (D-12, C-42)

- **Every press goes to the room `nextMatchId(previous)`** (D-12, roslambo Q-8): `NetGame.playAgain` sends AGAIN in the old room, opens the new room's NetGame with `again`, and closes the old one `leaveGraceMs` later, so its AGAIN goes out.
- **It proposes there,** genesis with the same settings, only if no AGAIN reached it in the old room; otherwise the match exists, and it joins it, as roslambo's Play again does (`if (!old.session.againSeen) g.propose(r.settings)`, and its PLAN: "If an AGAIN arrived, the next round already exists, so the browser joins it"). Two presses that each saw no AGAIN both propose, and their genesis states meet by the merge rule, the older winning (`beats`: a live timeline beats none; then the later final tick; then the smaller hash; then the smaller ID), so every press ends in one match (P7). A press that saw AGAIN, in a room whose presser then left at once, fails as any join does, with the connection-failure message after `connectionFailureMs`; accepted, as roslambo's.
- **The player** asks for its old pack; when a final tick shows it full, the other; when both are full, it watches. **A host's bots** likewise, but stay out when both are full. **A spectator** stays a spectator. **A press after the new match's start countdown has begun** watches it, with `refused = 'started'` for the note.
- **AGAIN** (§5) is also the hint M4's Results reads: the button can say the next match exists.

### 4.10 Forwarding, and what a peer may say (D-19, roslambo §9.4)

- **PEERS** lists the player IDs this browser is connected to, and its role.
- **Forwarding:** for a pair A and B without a link, the peer with the smallest player ID connected to both forwards A's TICKs to B inside FWD (roslambo D-14). A FWD is never forwarded again.
- **Acceptance,** checked by the session before anything reaches the timeline (M3-Q10):
  - **Attribution:** a TICK's own input and vote are its connection's player's; its bot entries only bots derived from that player.
  - **Never about this browser:** a TICK or FWD whose origin is this browser's ID or one of `botIds(me)`, and a FWD whose origin is a bot's ID, is dropped: no peer speaks for this browser, for its bots, or for a bot apart from its host. roslambo's timeline dropped only `origin === me`. This browser's own records also replace whatever the store holds (§1.3), so an input that slipped in can't decide its own final input.
  - **A FWD** is taken only for an origin this browser has no direct connection to, only from a connection whose latest PEERS lists that origin, and its bot entries only for bots derived from the origin. So a peer speaks only for browsers it says it's connected to, at most `peersMax` of them, never for made-up IDs beyond that. A FWD for a directly connected origin is redundant or forged, and its TICKs come directly anyway.
  - **PEERS** with more than `meshPlayersMax + spectatorsMax − 1` IDs, or a repeated one, is invalid (§5.4).
  - **Clock samples** come from direct TICKs only: a FWD's origin has no one-way delay here, and roslambo took its sample with a delay of 0.
  - **Floods:** a connection's own TICKs, and its FWDs for each origin apart, are each limited to `floodTicksPerTick` a tick: more than `floodTicksPerTick × ticksPerSecond × floodSeconds` (360) in the last `floodSeconds`, from a connection open that long, closes it. FWDs never count toward the forwarder's own TICKs, so an honest forwarder serving three origins stays under the limit. roslambo's window also asked that its oldest TICK be 0.9 of the window old; the connection's age does that job without a factor.
  - **STATE_REQ:** at most one answer per connection per `resyncRetryMs` (§3.4); the rest count as invalid.
  - **STATE:** a joining browser adopts only from a peer it asked; a started timeline takes only the STATE its resync asked for; both inside §5.5's bounds.
  - **Before the handshake completes,** messages are dropped.
  - **`invalidMessagesMax`** invalid messages close the connection, and the transport refuses that peer ID from then on (roslambo §9.3–§9.4, as enforced at its M5).

### 4.11 When the host or the keeper leaves

- **The keeper** gives the genesis state to the first browser that arrives, by STATE; after that every peer holds the match, and the keeper may leave (L130). If it leaves before anyone arrives, the match is gone (L131).
- **A bot host that leaves** before the start countdown takes its bots out with LEAVEs (PLAN §14); from the countdown on, its bots sit, and the abandoned rule applies once no browser that controls a terrier is heard (§4.7).
- **Any peer leaving** is `onPeerLeave`: its connection, its PEERS entry and its forwarding duties go (§4.4's guard); its terrier's inputs stop, and the state does the rest.

### 4.12 Stalls (D-31, A.4's Timer stall)

A gap over `stallMs` (2 s) between timer runs is a stall: the page was frozen, or the whole machine was. NetGame checks every timer run and calls `session.stalled(now)`:
1. **Deciding:** the timeline pauses: it sends no TICK and answers no STATE_REQ. For up to `stateRequestRetryMs` the session watches for a TICK, from any peer, for a tick past `localTick + d + w`. Its sender's clock ran on through this page's stall, since a page that stalled with it sends ticks near this one's.
2. **Rejoining** from the first such peer: a new timeline asks it for a STATE, then each other peer whose clock ran on, every `stateRequestRetryMs`, as a joiner does. The old timeline is kept until a STATE is adopted, which replaces it with §4.6's rules. If none is adopted once each has been asked, the session re-anchors as below.
3. **Re-anchoring,** with no peer whose clock ran on: the clock goes on from `localTick` (`Timeline.reanchor`), as Practice's does, and the page sends again (M3-Q9). When every page stalled together, as when a machine running them all pauses (the owner's `dev:local` check, the gate, the load run), every page re-anchors at the same point, and nobody is removed or rejoins.

roslambo's `rejoin()` dropped its timeline whenever any peer was live, and `live`, set by a HELLO's timeline or any TICK, is never cleared. So pages frozen together all dropped theirs, and none was left to answer. A hidden page's timers wake about once a second, under the 2 s, so it catches up instead and sends its newest 3 ticks (D-31). Practice pauses and opens its menu instead (D-22).

---

## 5. The protocol

One Trystero action, `'terriest'`, carrying `[u8 type][payload]`, little-endian, at most `messageMaxBytes` (16,000) bytes. A player ID is its 16 raw bytes, a hash 8 bytes, a tick a u32, a string a u8 byte length and strict UTF-8 of at most `displayNameMaxBytes` (32) bytes. The protocol version is 1 (D-20).

### 5.1 HELLO (0x01)

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | type |
| 1 | 2 | protocol version |
| 3 | 8 | build hash |
| 11 | 16 | player ID |
| 27 | 1 | role: 1 keeper, 2 player or candidate, 3 spectator, 4 undecided |
| 28 | 8 | timeline ID (zero for none) |
| 36 | 1 | timeline kind: 0 none, 1 live |
| 37 | 1 | phase (A.1's) |
| 38 | 4 | newest final tick |
| 42 | 8 | the hash at that tick |
| 50 | 1 + n | display name |

51 + n bytes. Invalid: a role outside 1–4, a kind outside 0–1, a phase outside 0–5, kind 0 with a non-zero timeline ID, tick or hash.

### 5.2 REFUSE (0x02)

`u8 reason`: 0 accepted (the handshake's second round), 1 protocol, 2 build, 3 duplicate or a bot's ID, 4 spectators full (counted by D-21). Anything else is invalid.

### 5.3 TICK (0x10)

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | type |
| 1 | 4 | t: the tick this input is for |
| 5 | 1 | flags: bit 7 set when the TICK carries no input of the sender's own (a spectator hosting bots); bits 0–6 zero |
| 6 | 2 | the sender's input, A.2's u16 (0 with bit 7) |
| 8 | 4 | vote tick (NO_TICK: none) |
| 12 | 8 | vote hash (zero with NO_TICK) |
| 20 | 2 | clock phase × 65,536 |
| 22 | 2 | history present: bit k, the input for t − 1 − k is included; clear, the sender has none there (§2.2) |
| 24 | 2 | history same: bit k, that input equals the next newer one (t − k: the TICK's own input for k = 0) |
| 26 | 2m | the present inputs whose same bit is clear, k ascending |
| … | 1 | event count e, then e events |
| … | 1 | bot count b, then b bot entries |

- **An event:** `u8 back`, `u8 kind`, then its payload: JOIN `u8 pack, u8 coat, string name`; SWITCH `u8 pack`; LEAVE, READY and UNREADY none. It belongs to the sender's input for tick `t − back`.
- **A bot entry:** a 16-byte ID and a u16 input, then the same present mask, same mask, inputs and events, for the same tick t.
- **Sizes:** 28 + 2m bytes for a TICK with no events or bots, so a held anchored input with its whole history present costs 28 bytes (D-20 estimated 35); each bot adds 23 + 2m. The load run measures the traffic (§8.5).
- **Invalid:** flags bits 0–6 set; bit 7 with a non-zero input, history or events; a same bit set where its present bit is clear, or where the next newer input is absent (for k = 0, where there's no own input); an event with `back` from 1 to `inputHistoryTicks` whose present bit `back − 1` is clear, since the sender says it has no input there; the same in a bot entry; an unknown event kind; a malformed name; more than `BOT_SLOTS` bot entries, or a bot ID repeated. An event further back than the history is valid: events ride until their tick is final at the sender, which a warm-up or a spread holds back (§2.4), and §2.5 finds or makes its record.
- Pack and coat bytes are any u8: the simulation ignores a pack other than 0 or 1 and reads a coat outside the list as 0 (D-12), and a name that breaks C-17's rule joins as the empty name. So every decoded TICK is a valid input to the simulation, which `fuzz.test.ts` checks by stepping decoded inputs.

### 5.4 FWD (0x11), PEERS (0x12), AGAIN (0x13), STATE_REQ (0x20)

- **FWD:** `16 origin player ID`, then a complete TICK, its type byte included; anything else inside is invalid.
- **PEERS:** `u8 n`, at most `meshPlayersMax + spectatorsMax − 1` (11), then `n × 16` distinct player IDs, then `u8 role` (1–4). PLAN §9 lists 2, 3 and 4; a keeper with peers announces 1 (M3-Q15).
- **AGAIN:** no payload.
- **STATE_REQ:** `u32 tick` (NO_TICK: the newest final), `8 wanted hash` (zero: any).

### 5.5 STATE (0x21)

| Field | Size |
|---|---|
| type | 1 |
| timeline ID | 8 |
| the sender's clock tick, floor of its clock, not its local tick | 4 |
| the clock's phase × 65,536 | 2 |
| g: the state's tick | 4 |
| the sender's newest final tick | 4 |
| the state's length, then A.1's bytes | 2 + n |
| k, then k × 16 IDs: the senders in the records that aren't among the state's terriers | 1 + 16k |
| m, then m tick records for g + 1 … g + m | 2 + … |

- **A tick record:** `u8 count`, then for each input: `u8 index` (below the state's terrier count, that terrier; from it on, the ID table's entries in order), `u16 input`, `u8 event count`, events as TICK's but without `back`.
- **Why the table:** in warm-up, every terrier that joined after `g`, every candidate and every candidate's bot is outside the state's roster in each record after `g`. Writing its 16-byte ID in each record, as the first draft did, made a record of 8 such inputs 161 bytes, so a late-vote repair from 255 ticks back would have been about 43 KB, and the encoder would have dropped most of its input ticks, which the repairer would then re-finalise from its own inputs and diverge again. With the table each ID costs 16 bytes once, and every input 4 bytes plus its events.
- **The decoder** decodes the state with `decodeState` and rejects the message if that fails or its tick isn't g, so no state `valid.ts` refuses ever comes from a peer (A.1). It also rejects: an index at or past the terrier count plus k; a table ID that isn't a player ID, is repeated or is one of the state's terriers; a record with more inputs than the terriers and the table hold, or an index twice; and anything outside **the tick bounds**: `g ≤ senderFinal ≤ senderTick`, `senderTick − g ≤ stateHistoryTicks + 2w + d`, and `m ≤ senderTick + d − g`. So no STATE carries a final tick, a clock or a record count that would push its writes outside §2.12's windows, though none of them is in the state's hash.
- **The encoder** builds the table from the records, writes as many tick records as fit in 16,000 bytes and reports how many it kept (D-18). A STATE that kept fewer than it has is a fault the size test excludes for every honest case; if it happens, the asker re-finalises the rest from its own inputs, may diverge again, and asks again.
- **The largest STATEs** (D-18), each built by `sizes.test.ts` with every input differing, asserting `kept` is every record:
  - **a late-vote resync's in play,** at 8 terriers with 32-byte names, from 255 ticks back to `localTick + d`: 269 records of 33 bytes, 8,877 bytes, plus the 1,512-byte state and 28 bytes of header and counts: 10,417 bytes, D-18's "about 10.4 KB";
  - **one in warm-up,** the state at `g` with an empty roster (120 bytes), 8 joiners with 32-byte names in the table (128 bytes), 269 records of 8 inputs, and each joiner's JOIN, with its name, re-sent every 30 ticks across them, more often than §4.2 re-sends one (72 JOINs of 36 bytes, with their READYs): about 11.8 KB;
  - **12 senders a tick,** 8 terriers and 4 candidates in the table: about 14.8 KB.
  The ID table keeps all three under 16,000, where the first draft's layout would have dropped most of the warm-up case's records.

### 5.6 The total decoder, bounded allocation, and who may speak

- **Total:** `decode` returns null for anything malformed, inconsistent, out of bounds or trailing, and never throws. The reader checks `remaining` before every read.
- **Bounded:** the 16,000-byte limit is checked first; every count is a u8 or a u16 bounded by what remains and by `WireLimits`, and every loop stops at `bad`. So a message allocates at most a constant times its length.
- **Who may speak:** the decoder has no notion of sender. §4.10 attributes each message to its connection's player, so a peer can send an input, a vote or a bot's input only for itself and its own bots, or, through FWD, for a browser its PEERS says it's connected to and this browser isn't, which the honour system covers (L203). Nobody speaks for this browser or its bots.
- **Merging one sender's events for one tick** (§1.3): OR-ed; a conflicting JOIN or SWITCH payload keeps the one that sorts first by (pack, coat, name), so two peers that received the same payloads agree whatever their order (M3-Q11).

### 5.7 Strings on the wire

`wireString(s)` is `s` when it's well-formed UTF-16, without a lone surrogate, and at most 32 UTF-8 bytes; otherwise ''. The writer writes `wireString(s)`, and the timeline records its own JOIN with the same, so a sender's own final input and every receiver's agree. Without it, a lone surrogate would be written as U+FFFD by `TextEncoder`, joining as '' on the sender (C-17) and as U+FFFD on every receiver, a divergence. The reader keeps a leading U+FEFF (§1.1), as A.1's decoder does, for the same reason: C-17 allows a name to start with one, and a decoder that dropped it would join every receiver's copy under another name than the sender's.

### 5.8 Fuzz tests (`fuzz.test.ts`)

- arbitrary bytes up to 16,000, mostly short (fast-check, at least 5,000 runs): `decode` never throws;
- every message type's valid encodings, truncated at every length, and with a byte appended: null;
- every byte of each valid encoding replaced by 0, 0xFF and its bit flips: no throw, and whatever decodes re-encodes to bytes that decode to the same message;
- random `Tick`, `StateMsg`, `Hello` and `Peers` values, any u16 input, any pack and coat byte, any well-formed name within the limit, names starting with U+FEFF among them, STATEs with ID tables and members mixed: `decode(encode(m))` equals `m`;
- TICKs whose events name a tick the history marks absent, or name the own input of a TICK without one: null; events further back than the history: valid;
- STATEs outside the tick bounds, or with a bad index or table: null;
- decoded TICKs turned into TickInputs and stepped through the simulation from random warm-up states: `step` never throws, and the state stays valid (D-12, the M2 property extended to the wire);
- a message over 16,000 bytes: null, before anything is read.

`messages.test.ts` adds a JOIN whose name starts with U+FEFF to the round trips, and `timeline.test.ts` checks that after a sender's own JOIN of such a name its state hash equals a receiver's.

---

## 6. The net layer

### 6.1 The transport interface

`Transport` (§1.18) is a `Link` with a peer count, the last refusal, and `leave()`. The session sees only `Link`. Three implement it: `TrysteroRoom`, `LocalTransport`, and the loopback's per-node link.

### 6.2 The loopback transport (tests)

§8.2. It runs the real handshake in two rounds over each link's latency: when a pair meets, both HELLOs leave; one one-way delay later each side's `checkHello(hello, now, peer)` runs and its verdict leaves; another one-way delay later both sides join if both accepted, and otherwise the refusal is recorded and a side that had accepted gets `onHandshakeFailed`. So a burst's handshakes overlap, as Trystero's do, and §4.3's reservations are tested where they matter; roslambo's loopback ran both checks and both joins in one event, where a race can't happen. It delivers messages after each link's latency, FIFO per link, in virtual time, and pings each neighbour every `pingEveryMs` of the pinger's timers, the pong answered on delivery unless the peer is frozen.

### 6.3 The Trystero transport

- **The room:** `joinRoom(roomConfig(…), matchId, { onPeerHandshake, onJoinError, handshakeTimeoutMs })` (D-18). The config is `vendor/hermet/room-config.ts`'s literal, typed against `JoinRoomConfig`: the relays (never empty), `iceServers` always set (STUN from `third-party.json` for `ice: 'default'`, empty for `'none'` and `'local'`, TURN from Settings appended), `maxReceiveBytes` 1 MiB, `passive: false`, and `_test_only_mdnsHostFallbackToLoopback` only for `'local'`.
- **The handshake,** two rounds, roslambo's: both sides send HELLO; each checks the other's (`checkHello(theirs, now(), peerId)`) and sends REFUSE with 0 or its reason; a side whose check failed throws, so Trystero drops the peer, and the other side records `refusedBy`. A handshake this side accepted that then fails calls `onHandshakeFailed(peerId)`: from inside `onPeerHandshake` when the other side's verdict refuses or a receive rejects, and from `onJoinError`, which Trystero 0.26.0 calls with the peer's ID when a handshake times out or fails after this side's part (`handshake.mjs`'s `failPeerHandshake`, through `strategy.mjs`). On join, a `replaces` drops the old connection first.
- **One action,** `'terriest'`, binary; every message is under Trystero 0.26.0's 16,384-byte frame with its 36-byte inline header, so nothing is ever chunked (§10's check). Its handler wraps `session.onMessage` in a catch: whatever the session throws never reaches Trystero, whose own handler would log "action handler error" (`actions.mjs`), and is rethrown on a microtask instead, the page's own uncaught error with its stack, which the e2e guard fails.
- **Pings** go to every peer every `pingEveryMs`, and each pong calls `onRtt(peer, ms, now())` (§4.4).
- **`drop(peer)`** closes that peer's RTCPeerConnection and refuses its Trystero peer ID from then on.
- **Leaving:** Trystero's own `beforeunload` cleanup leaves the room. `TrysteroRoom` also leaves on `pagehide`, so that M4's leave guard (D-30) may stop `beforeunload` from reaching Trystero while the player decides, without a page that stays losing its peers (M3-Q20). A page that reloads thus leaves through Trystero's leave action, and its peers see a leave, not a broken connection (§8.4).
- **Lazily loaded:** `NetGame.open` imports it with `import('../net/trystero')`, so its chunk, about 25 KB brotli with Trystero, loads only when a networked match opens (§11, L238).

### 6.4 The local transport (Practice)

`LocalTransport` (§1.21): no room, no peer connection, nothing leaves the page. Practice's TICKs are encoded and dropped, so Practice runs the same code path as a networked match (D-22). Practice's glue and session import nothing that reaches `src/net/trystero.ts` or Trystero, which `src/ui/practice.test.ts` checks over the static import graph and the lint holds (§1.36), and `e2e/practice-net.spec.ts` checks in the page (§8.4).

### 6.5 Forwarding

§4.10. PEERS on each change and every 5 s; FWD by the smallest-ID common neighbour, taken only from a peer whose PEERS lists the origin; duplicates are harmless, since the input store ignores a known input and merges events order-free.

### 6.6 The CSP, the dist audit, the local relay and `npm run dev:local` (PLAN §15, D-35, D-37)

- **The CSP** in `public/_headers` doesn't change: `connect-src 'self' wss: blob:` covers the curated relays and any a player adds; STUN, TURN and the peers go over WebRTC, which `connect-src` doesn't govern. The networked specs run on `vite preview`, which applies no headers; a networked run under the headers would get `ws://127.0.0.1:*` from the test server only, never in `public/_headers` (§16).
- **The dist audit:** `scripts/audit-dist.mjs` already passes `ignoredHosts: ['stun']`, since M1, for Trystero's built-in STUN template, which terriest never uses because it always sets `iceServers` (D-37). Trystero's default relays are bare host names, not URLs, which the audit doesn't read as hosts, as in roslambo's build at the same hermet pin, and neither is the bare `127.0.0.1` in Trystero's mDNS rewrite (`peer.mjs`), since hermet's URL pattern needs a scheme. M3 adds the expected licences (§11) and the dev-relay audit (§1.33): no `dev-relay` chunk, and no file that names one or `VITE_TERRIEST`. A bare-address check couldn't do that job: Trystero's code holds `127.0.0.1`, and the dev relay's URL is built at run time.
- **The local relay** is hermet's `nostr-relay.mjs`, on `127.0.0.1`, for the end-to-end specs, the load run and `dev:local`.
- **`npm run dev:local`** (§1.30): the dev server and the local relay. The `#test=net` page, and M4's screens, then use `ws://<the page's host name>:<port>` as their only relay, built from the page's own host name so that a Windows browser reaching WSL2 through `localhost` reaches the relay the same way. Its ICE is `'default'`, the production room config but for the relay, never `'local'`'s loopback rewrite, which works only for the specially launched test engines (PLAN §15; M3-Q4).

### 6.7 The relays the `#test=net` page accepts

`acceptedRelay(url, dev)` (§1.26):
- **In a dev build,** any `ws:` or `wss:` URL, and `dev:local`'s relay when none is given.
- **In a production build,** only `third-party.json`'s signalling URLs, which M5's relay check uses, or a `ws:` URL whose host is `127.0.0.1`, `localhost` or `[::1]`, which the gate's `vite preview` runs use. It compares a parsed URL's parts, so the chunk holds no URL-shaped loopback string for the audit to flag.
- **Anything else:** the page says so and contacts nothing. The page ships in the production bundle, and the CSP allows any `wss:` host, so without this a crafted link could send a visitor's browser to a relay `third-party.json` doesn't list (CLAUDE.md, §16). On terriest.com the CSP refuses `ws:` anyway.

---

## 7. The `#test=net` page and its hooks

### 7.1 What it is

`#test=net&…`, loaded as a chunk of its own by `src/main.ts`, like `#test=determinism`. It makes no WebGL context and draws nothing; its main landmark (`id="net"`) holds a heading, "Network test", and a status `<pre>` refreshed every 500 ms, so a person can read it by hand. It calls `boot.started()` once that landmark shows (D-30).

### 7.2 Its parameters

| Parameter | Meaning |
|---|---|
| `room` | a match ID, read with `normalizeMatchId`; missing or bad: the page says so and contacts nothing |
| `relay` | a `ws:` or `wss:` URL, the only relay, accepted as §6.7 says. Without it, `npm run dev:local`'s relay in a dev build; with neither, the page says so and contacts nothing |
| `ice` | `default`, `none` or `local` (§1.18); `local` when `relay` is given and `ice` isn't, as roslambo's `local: true` |
| `mode` | `net` (default) or `practice` |
| `k`, `seed` | this page's player ID, `personId(seed, k)` from `src/core/bot/bot-id.ts` (§1.12), so the end-to-end setups' IDs match M2's offline runs and the loopback's replay of them |
| `role` | `keeper` (proposes, then plays in `pack`, or watches without one), `player` (plays in `pack`), `spectator` |
| `pack` | 0 or 1 |
| `packSize`, `minutes` | the keeper's and Practice's genesis settings |
| `bots` | packs for bots to host, comma-separated, as `0,1,1` |
| `ready` | the match tick at or after which the page presses Ready, once its terrier is in the final roster; absent: never. A tick, not a time, so the start countdown begins at the same tick in every run, as `bots-setups.test.ts` replays it (§8.1) |
| `script` | the page's own input, from `src/core/bot/setups.ts` (§1.12), sampled once a sent tick on the timeline's head as it stands then: `none`; `back`, held back in ball view for the first second of play after each kickoff, then nothing (§16's three-engine setup); `sideways`, the Practice setup's; `brain`, the bot brain driving the page's own terrier (the load run and the owner's check) |
| `name`, `coat` | the display name (default `P<k>`) and coat (default `k` modulo the coat count) |

`parseNetParams` reads the fragment with `URLSearchParams`, which never throws on a malformed `%` escape, so a `#test=net&room=%` reports a bad room and the page still starts (the defect roslambo's router has, which terriest doesn't carry over). The page makes its script again, its press counters from the base, whenever the session's `onControl` hands one after an adoption (D-10, §4.6), so a page that reloads or rejoins presses nothing on return.

### 7.3 What it runs

- **No canary at M3.** D-23 wires the canary to Propose and Join at M4. Here it would also import `goldens.json` beside the determinism page, and the bundler could then move the file into a chunk both share, where `e2e/determinism.spec.ts`'s check that the determinism chunk holds the canary's hash would fail. M4 meets that when it wires the canary (§14 R-15).
- **`mode=net`:** `NetGame.open(…)` with the relay and ICE; the keeper proposes; `play`, `watch`, bots and Ready per the parameters; a fifth spectator leaves (§4.5).
- **`mode=practice`:** `PracticeGame` with the person in pack A and bots in every other place; Ready per `ready`. It never imports the Trystero chunk.

### 7.4 The hook

When `window.terriestTest` exists, set by a spec before load (`installHook`), the page adds `net: NetHook` to it once it has started. A normal page never has `window.terriestTest`, and a normal page never loads this chunk, so the hook never changes what a normal page does (CLAUDE.md). The types are `src/nettest-params.ts`'s (§1.26).

```ts
export interface NetHook {
  report(): NetReport;
  hashAt(t: number): string;     // '' if not held
}
export interface NetReport {
  me: string; role: string; mode: 'net' | 'practice'; build: string;
  started: boolean; timeline: string; localTick: number; finalTick: number; headTick: number;
  phase: number; phaseStart: number; overtime: boolean; clock: number; score: [number, number];
  roster: { id: string; pack: number; spot: number; sitting: boolean; lastInputTick: number; goals: number; touches: number }[];
  goals: { tick: number; pack: number; ownGoal: boolean; scorers: string[] }[];   // the scoreboard's
  end: { tick: number; score: [number, number]; winner: number | null; rows: ResultRow[] } | null;
  arrivedTick: number;           // the tick at which this page adopted or started the timeline
  peers: number; refused: string | null; refusedBy: number | null;
  returning: boolean; spectatorsFull: boolean; abandoned: boolean; failed: boolean;
  stall: 'none' | 'deciding' | 'rejoining';
  stats: Omit<TimelineStats, 'log' | 'resyncMs'> & { resyncMsMax: number };
  summary: MatchNetSummary;      // §1.16
  duplicates: DuplicateHello[];  // C-12's rule at work (§4.3)
  cpu: { mean: number; p95: number; max: number } | null;   // ms per timer run that moved the clock
  traffic: Traffic;              // messages and bytes, sent and received, by type (§1.24)
  rtcConnections: number | null; // window.__rtcCount, when a spec counts them
}
```

---

## 8. Tests

### 8.1 The properties and §16's items, by file

| Item | Where |
|---|---|
| **P1:** the same settings and final inputs give bit-identical states in Node and every engine | M2's goldens and the determinism page stand; `timeline.test.ts` (a decoded state steps as its original); `network.test.ts` and `e2e/match.net.spec.ts` compare every peer's hash at a common final tick |
| **P2:** honest peers that received every input within the late window agree on every final tick | `network.test.ts`: a proposer, three players and a late spectator play a 1-minute match to its confirmed end, every final hash equal, one end tick, no resync or disagreement (roslambo's) |
| **P3:** a dissenter holds the majority's state again within v ticks and a round trip (and the spread's ticks, M3-Q1) | `consensus.test.ts`: a corrupted float and a lost terrier (roslambo's two), and late-vote flips from 2 s back, in play and in warm-up with joiners outside the state's roster (§5.5), each repaired within the bound, the spread's steps a tick never over the cap; two voters at 1 a side, 30 and 80 ms, a dropped input and seeds where the following ties favour the dissenter: one completed resync, no state adopted from the dissenter, equal hashes within the bound (§3.6); a three-way split among three voters |
| **P4:** join order and packs agree whatever the arrival order | `network.test.ts`: six players JOIN at once over links of 10–150 ms; a pack's last place taken by two JOINs in one tick goes to the smaller ID everywhere, and the other gets `refused = 'full'` |
| **P5:** a missing pair with a common neighbour behaves like a full mesh | `network.test.ts`: a blocked pair stays in step with forwarding, and diverges without it (roslambo's); `bots.test.ts`: a host's bots forwarded |
| **P7:** two timelines in one room end as one | `network.test.ts`: two halves with blocked links, then joined, keep the older, and the losing side's players and bots JOIN again, back in their packs (roslambo's, with packs); `again.test.ts`: two Play-again presses at once, and a full room of 8 that play and 4 spectators pressing in a race, where nobody is refused with REFUSE 4 |
| **P8:** a mirrored kickoff stays mirrored | M2's `mirror.test.ts` stands |
| **P9:** a goal shows on every peer's scoreboard, once, at its confirmed tick | `consensus.test.ts`: every peer latches the same goals at the same ticks, none before its tick is confirmed, none twice, through a resync for a later tick after the goal shows; `e2e/match.net.spec.ts` compares every page's goals |
| **P10:** Practice sends nothing over any network | `practice.test.ts` and `src/ui/practice.test.ts` (no route to Trystero in the import graph; the local transport drops everything); `e2e/practice-net.spec.ts` (no peer connection, no request beyond the page's own) |
| roslambo's: the match carries on after the proposer leaves | `network.test.ts` |
| roslambo's: a player whose links are 300 ms one-way is repaired, and the others never split: no resync among them | `network.test.ts` |
| roslambo's: the confirmed end trails the end tick on every page, every page then confirms it, and AGAIN reaches every other page but not its sender | `network.test.ts` |
| roslambo's: a player who joins after the start countdown is refused into watching, and stops sending | `network.test.ts` |
| roslambo's thrust-flame test, as D-16's received inputs: `receivedInput` gives a page's own input exactly and others' as received, never a predicted one | `network.test.ts` |
| A pack's last place by two JOINs; a JOIN or SWITCH for a full pack given up; a switch's cancelled Ready staying cancelled | `network.test.ts` |
| A Ready whose TICKs arrive after its tick is final is re-sent, and one that expires stays expired | `network.test.ts` |
| Play again: a race; players and bots whose packs are full; a press after an AGAIN joins without proposing; a press after the new match's countdown watches | `again.test.ts` |
| The abandoned rule: a proposer who watches at once and waits 40 s; a spectator who arrives after the players have left, before the end (abandoned) and after it (Results, never abandoned) | `abandoned.test.ts` |
| A returning player skipping Join, into a match with 4 spectators | `returning.test.ts` |
| A browser arriving, or reloading, on Results takes the final state and shows the same results | `returning.test.ts` |
| Spectator counting: a burst of undecided peers arriving at once, their handshakes overlapping, stays within 8 + 4; a fifth spectator's connections close and the room holds 4; a peer lingering on Join doesn't turn a watcher away; two newcomers handshake without a state; a duplicate ID replacing a silent connection, refused while the connection answers pings (a live spectator's included), and a replacement surviving its old connection's late leave | `spectators.test.ts` |
| Stalls (§4.12): a page frozen 3 s in play rejoins from a peer and is in control again within 30 ticks (roslambo's); a page frozen 4 s in warm-up is removed, then JOINs its pack again (roslambo's); every page frozen together, then resumed, re-anchors, with nobody removed or rejoining, and every hash equal; one page left running while the rest freeze is the one the others rejoin from | `stalls.test.ts` |
| Hidden pages (D-31): one throttled to one timer a second never sits, in the final or the predicted state, is never removed or renumbered, keeps its Ready, and no page resyncs, jumps or changes its rate (roslambo's); players who join while the proposer's page is hidden keep everyone in, with no jump, late input or resync anywhere (roslambo's, the owner's report, which checks that STATE carries the clock); an input that arrives late everywhere while a hidden page sleeps leaves its hash equal to the others' | `hidden.test.ts` |
| A TICK lost and filled from the history leaves the predicted counters unchanged | `hidden.test.ts` (`dropNext`), and `predict.test.ts` at the timeline's level |
| A silent player's terrier, and a bot whose host is away, sit in every peer's predicted state within the sit threshold plus w ticks, and stand again when their inputs return | `hidden.test.ts` |
| Every loopback scenario with each tick's predicted chain checked against a full replay, a worst tick spread over several included | every loopback test runs one node at `verify: 8`; `replay.test.ts` runs every node at `verify: 1` through late inputs, absences, a join, a resync, a late-vote flip, a spread worst tick, a merge, forwarding, bots, a hidden page's bursts, a sender paced at 100 ms for a second and then at 4 ms with its inputs changing, a forced clock jump, a sender going silent, a returning player and Practice's catch-ups; and each again in `fullReplay` mode with identical final chains |
| Practice: a gap over 2 s pauses it; a shorter catch-up keeps every tick's local inputs | `practice.test.ts`, `src/ui/practice.test.ts` |
| Every message round-trips; fuzzing never makes a decoder throw | `messages.test.ts`, `fuzz.test.ts` |
| The largest STATEs carry every input tick: in play, in warm-up, and at 12 senders a tick | `sizes.test.ts` |
| A host's bots in its TICK, one vote per host, a host that reloads takes them back; Remove takes the newest; leaving takes the rest at once; inputs only from the host; one think per head tick in a catch-up | `src/net/bots.test.ts`, and `src/core/session/bots.test.ts` for `BotHost` alone |
| §16's three-engine setup ends decisively over the network, before the end-to-end match relies on it (R-7) | `src/net/bots-setups.test.ts`: the spec's exact setup, seed 7 with its ready tick, d, the spectator and the reload at their ticks, the reload's absence at 0.5, 2 and 5 s; and 10 more seeds with their start ticks shifted; at 30–60 ms. Each must end at 0:00 with the bot's pack ahead, and the slowest first goal is printed for the spec's timeout |
| §16's Practice setup ends with the bot's goal over the timeline | `practice.test.ts`: seed 7 and 10 more over the local transport, each to the bot's first confirmed goal, the slowest printed for `practice-net.spec.ts`'s timeout |
| The brain's view by tick: M2's marks and the end-to-end setups count exactly as before; a repeated tick or a skipped one keeps the reaction | M2's marks, unchanged, at phase 2's integration; `brain.test.ts` |
| Refusals: a mismatched build, a duplicate, a HELLO under a bot's ID, a fifth spectator; a late joiner refused into watching; a flood and garbage closing their connections | `network.test.ts`, `misbehaving.test.ts` |
| Forgeries: a TICK or FWD speaking for this browser or its bots, which never decides their final inputs or votes; a FWD for an origin its sender's PEERS doesn't list, or for a bot; a PEERS over the cap; repeated STATE_REQs; an unsolicited STATE; a STATE outside §5.5's bounds; a forwarder serving three origins isn't a flood | `misbehaving.test.ts` |
| The room config: exactly the curated relays and STUN, `iceServers` always set, an empty relay list refused, `'local'` alone rewriting mDNS | `room-config.test.ts`, `third-party.test.ts` |
| The page's relays: a production build refuses a foreign `wss:` relay and takes a curated or a loopback one | `src/nettest-params.test.ts`, `e2e/nettest.spec.ts` |
| The build hash: changes with any setting, the protocol, the codec and the build inputs | `build.test.ts`, `scripts/build-inputs.test.mjs` |
| The dev relay never ships | `scripts/dev-relay-audit.test.mjs`, and the build's audit |
| The match summary: its percentiles from its bins, and a correction's sizes | `summary.test.ts` |
| The lint's new bans | `scripts/eslint/config.test.mjs` |
| The configuration's new rows and checks, and every new key in NOT_TUNED | `src/config.test.ts` (§10), `dev/tuning/model.test.ts` |

### 8.2 The network simulator's model

- **Each link** has a one-way latency, a uniform jitter, and a loss chance. A message lost on the reliable channel is modelled as arriving late by an extra round trip, `2 × base`, on top of its own latency and jitter: the retransmission (§17's "an occasional extra round trip"). `delayNext` makes one such delay on purpose.
- **FIFO per link,** as a reliable ordered data channel: a message never overtakes an earlier one on its link, so the messages behind a lost one wait for it: head-of-line blocking, which is what makes a loss expensive.
- **Clocks:** each node has an offset and a drift, and its timers run every `paceMs`: 4, as in the browser; 1,000 for a hidden page; Infinity for a frozen one. Pings follow the pinger's timers, and a frozen page answers none.
- **The handshake** is the real one in two rounds (§6.2); a blocked pair never connects, so forwarding is exercised; `drop` blocks the pair.
- **Virtual time,** a seeded PRNG and a heap of events: every run repeats exactly, so a failure reproduces and the tests never depend on the machine's speed.
- **Counts:** messages and bytes, by type, for D-20's traffic.

### 8.3 The unit test files, briefly

- **Protocol** (`messages`, `fuzz`, `sizes`): §5.8, the sizes of §5.3 and §5.5.
- **Timeline parts** (`inputs`, `history`, `votes`, `clock`): the store's merge rule under every arrival order, an event before its input included; marks never beating a record; `newest` unmoved by an older tick or by events alone; the rings' retirement, and a write refused rather than evicting a needed tick; the tally's plurality, ties by the smallest hash, a bot's host counted once, a voter outside the roster ignored; the clock's samples, the cap phase ignored, the median, the jump, the rate limits, the rebalance period, `pause`, `resume` and `set`.
- **Timeline** (`timeline`, `predict`, `rollback`, `spread`): two or three timelines wired by a test pump in the same file, no transport. Prediction's rules, the marks included; a press acted once under re-simulation; a decoded state stepping as its original; rollbacks from the earliest changed tick, the chain compared with `fullReplay` tick by tick; reuse and its `verify` check; every invalidation path (§2.7) forced alone, a terrier falling silent and a gap before a sender's newest among them; the spread's budget per advance, the chain after it equal to a full replay, `isConfirmed` false throughout, and the drawn head held, never moved back and never `F`; the late boundary on the clock; own votes replaced by a repair; no STATE answered while a resync is outstanding.
- **Session and network** (`network`, `spectators`, `returning`, `misbehaving`, `stalls`, `consensus`, `replay`, `hidden`, `bots`, `bots-setups`, `abandoned`, `again`, `practice`): over `LoopbackNet`, 2 a side unless a test needs more, matches 1 minute long when one plays to the end, links of 30–60 ms with 20 ms of jitter unless the test is about latency, one node at `verify: 8` in each. Session's tests assert that `Timeline` satisfies `BotTimeline`, and scoreboard's that it satisfies `ScoreTimeline` (§0).
- **Bots** (`src/core/session/bots.test.ts`, `src/core/bot/setups.test.ts`, `brain.test.ts`): `BotHost` against a hand-pumped fake `BotTimeline`; the scripts against M2's definitions; the brain's tick-keyed view.
- **Glue** (`src/ui/game.test.ts`, `src/ui/practice.test.ts`): with `FakeClock` and `fakePage` (§1.23): a stall decides, rejoins or re-anchors; a hidden page keeps sending; Practice pauses on a stall and on hiding; `leave` closes after its grace; a fifth spectator leaves; Play again proposes only without AGAIN; the counting link; the import graph.
- **Harness** (`dev/corrections.test.ts`): its loss model holds FIFO, its percentiles, bins and bootstrap are right on synthetic data.

### 8.4 End to end

- **`e2e/match.net.spec.ts`** (the `net` project, once): §16's "M3's `#test=net` match".
  - **Setup:** the local relay; Chromium, Firefox and WebKit launched through `e2e/lib/browsers.ts`; one fresh room; seed 7. The pages are §16's three-engine setup without the screens: Chromium is the keeper, plays in pack A with `script=back` and hosts pack A's bot; Firefox and WebKit play in pack B with `script=none`; each presses Ready at tick 600 (`ready=600`), by which every page is in the roster on this machine; pack size 2, 1 minute (§16: decisive by setup). `bots-setups.test.ts` plays this setup over the loopback first (R-7).
  - **Mid-match,** triggered from logical state read through the hook, never from a sleep: a fourth page, in Chromium, joins as a spectator once the keeper's page reports play with under 50 s on the clock and no celebration under way (L281); WebKit's page reloads, and takes its terrier back, once the clock is under 35 s with no celebration under way (L282, D-17).
  - **Checks:** every page, the spectator and the reloaded one included, reaches the confirmed end at the same tick, with the same hash at a common final tick, the same score, rows and Terriest; pack A scored and the score isn't level; every page's latched goals agree at the same ticks, each once, filtered to goals after its arrival; the reloaded page reports `returning`, and its terrier's last input tick, in every page's final state, is within 30 ticks of the end's tick, so it was in control again; no page has a console error or a request outside the base URL and the relay (`expectEverywhere`).
  - **It fails at once** when any page's report shows overtime, printing each page's score and clock (§16: "a match level at 0:00 fails its test at once"); `waitFor`'s `fail` does it.
  - **Its timeout** comes from measured runs; a timeout reports each page's phase, score and clock, and the reloaded page's `duplicates`, which say whether C-12's rule refused its first HELLOs.
  - **The reload is built first on its own** (R-5): net-page lands it in a short test of the three engines (warm-up, the start countdown, WebKit reloading in play, to its takeover), runs that ten times in a row with `--repeat-each=10`, as roslambo's `windows.spec.ts` was run five times clean, and only then folds it into this spec. The short test isn't kept in the gate. The reloading page leaves through Trystero's leave action on `pagehide` (§6.3), so its peers see a leave, not a broken connection that Trystero would log as a peer error.
- **`e2e/nettest.spec.ts`,** in each engine: a normal page loads neither the nettest chunk nor the Trystero chunk, has no `window.terriestTest.net` without the hook, and its module holds no Trystero code; `#test=net` without a relay, with `room=%`, or with a `wss:` relay `third-party.json` doesn't list, shows its message, starts, and contacts nothing; and the page's build hash equals the one Node computes from the configuration and the checkout's `buildInputs`, so the bundle carries the sources' hash it was built from.
- **`e2e/practice-net.spec.ts`,** Chromium only (it skips the others): `#test=net&mode=practice` at 1 a side, seed 7, `script=sideways`, Ready at once, with `countPeerConnections`. Through the start countdown and play to the bot's first confirmed goal, its timeout from `practice.test.ts`'s slowest. Checks: no RTCPeerConnection constructed, no WebSocket, no request outside the page's origin, the Trystero chunk never requested, and the goal latched once. M4's §16 Practice plays the whole match through the screens.

### 8.5 The 12-page load run

- **Where:** outside the gate, `npx playwright test -c playwright.load.config.ts`, `e2e/load.run.ts`, against `vite preview` and the local relay, on a quiet machine, as roslambo's.
- **What:** 12 Chromium pages on one machine through `#test=net`: 8 players at 4 a side, each driving its own terrier with the brain (`script=brain`), and 4 spectators, in one match of the default 3 minutes, measured for `LOAD_SECONDS` (default 90) of play.
- **It checks:** every page connected to 11 peers; every page's hash equal at a common final tick; every page in the same phase.
- **It logs,** for each page: late inputs, disagreements, resyncs, clock jumps, steps per tick (mean and max), CPU per timer run (mean, p95, max), the match summary (§1.16), and traffic, messages and bytes a second by type, from NetGame's counting link (D-20's measurement). Raw reports to `research/load/results.json`; a row in `docs/acceptance.md`'s checks outside the gate, with the machine and the date.

---

## 9. The correction measurement (D-16, §17's M3 entry)

### 9.1 The method comes first

`research/corrections/REPORT.md`'s method section, this section's §9.2–§9.6 made concrete, is committed before anything is measured under it, as M2's tuning method was (research/tuning/REPORT.md). A run before that commit doesn't count. `dev/corrections.measure.ts` writes `research/corrections/results.json`, refusing to overwrite a committed one unless `TERRIEST_CORRECTIONS_OUT` names it, as the tuning metrics refuse.

### 9.2 The harness

- `npx vitest run --config dev/corrections.vitest.config.ts`, in Node, off the gate.
- **The match:** a real `Session`, `Timeline` and `BotHost` on every simulated browser, over `LoopbackNet`. One browser per terrier, `2 × pack size` browsers, each a player whose own terrier the bot brain drives (`scriptSampler('brain', …)` on its own head, as §4.8 drives a bot), so every other terrier is remote to it, as in a match of people (M3-Q2). Browser 0 proposes; the others join at 200 ms intervals and play, half in each pack; every one presses Ready at a fixed tick once in the roster. A 1-minute match from genesis to its confirmed end.
- **Seeds:** 6 per loss-free profile and 4 per lossy one, which seed the IDs (`personId`), the links' jitter and loss, and the clocks' offsets (uniform ±30 ms) and drifts (±0.1%).
- **The profiles:** pack size 1, 2, 3 and 4; one-way latency 30, 80 and 150 ms on every link, with 20 ms of jitter; d = 2 and d = 3; and loss 0, 0.1% and 0.5%, where each message, with that chance, waits an extra `2 × base`, FIFO holding the messages behind it (M3-Q13). 72 profiles, 336 matches.
- **Fixed:** w = 12, v = 12, the spread cap at 42, A.4's other values. `TERRIEST_CORRECTIONS_ONLY` picks profiles, as the tuning metrics' variables do.
- **Estimated cost:** 1.5–12 s a match here, by pack size and latency; about 30–40 minutes in all.

### 9.3 What it logs

- **At every correction** (§2.11), on every browser: whether it came from a repair; the ball's change of position (m, 3D and horizontal), each remote terrier's change of position (m, 3D) and of heading (degrees, the shorter way round), and the driven terrier's apart; the re-simulation's depth (`H − from + 1`); and whether anything moved at all. `correctionSizes` (§1.16) computes them, as the match summary does on a real page.
- **Per browser and match:** rollbacks a second; steps per advance (mean, p95, max); spread ticks; resyncs, failed resyncs, disagreements and late-vote flips.
- **Late inputs, against w = 12** (L340): each input that arrives after its tick is final here, by how many ticks late (`lateBy`), and `lateAbsent`, the (sender, tick) pairs finalised absent whose input arrived later, the ones that make a browser diverge; each as a count and as a share of the remote inputs received.
- **Traffic:** messages and bytes a second per browser.

### 9.4 What it reports

For each profile, pooled over its seeds:
- **corrections:** how many, how many moved nothing, and how many were a repair's;
- **for each body** (the ball, the remote terriers' positions and headings, the driven terrier's), over the corrections that moved it and weren't a repair's: p50, p95 and max, with each p95's bootstrap 90% interval over the profile's matches (1,000 resamples, seeded); and the repairs' corrections apart, with the same figures;
- **the late inputs'** count and share, `lateBy`'s histogram and `lateAbsent`; resyncs per browser-minute; steps per advance; traffic;
- **beside each lossy profile,** the model's reach: a retransmitted message lands in time when 3 × one-way + jitter ≤ (d + w) ticks of 16.7 ms, less the clocks' residual.

`REPORT.md` tabulates them and states each decision by its rule.

### 9.5 The rules (committed with the method)

The decisive figures are each p95 from the corrections that moved the body and weren't a repair's, at the loss-free profiles; the lossy profiles are reported, and decide only w's rule. A repair's correction is governed by w and the loss rate, not by prediction, so neither d nor the glide is chosen from it, and an extra tick of delay is never rewarded for doing the late window's job.

1. **d:** d = 3 replaces 2 only if, at the loss-free 80 ms profiles, the p95 ball correction falls by at least 25% at every pack size, and at each the bootstrap interval of that fall lies wholly above 25%. Otherwise d = 2 stays: an extra tick of input delay is paid by every player on every input, so it must buy a clear cut in what everyone sees move. Without loss the model expects d = 3 to cut the re-simulation's depth at 80 ms from about 4.4 ticks to 3.4, some 23%, so it expects d = 2 to stay, and a marginal result doesn't change it. A change of d changes the build hash only.
2. **The glide,** with rule 1's d, at the loss-free 80 ms profiles at every pack size, each p95 taken at the upper end of its interval:
   - **Bodies** (`smoothingMs`): the smallest of 50, 100, 150 and 200 ms such that the p95 ball correction (3D) and the p95 remote terrier correction, each divided by it, are at most 3 m/s, half the run speed, and the p95 remote heading correction divided by it is at most 1 turn a second, half the turn rate. A correction glided over that time then moves a drawn body at most half a run faster, and turns a drawn terrier at most half its turn rate faster, than the simulation, for p95 of corrections. If none passes, 200 ms, and the figures go to M4's check.
   - **Your own terrier** (`ownSmoothingMs`): the smallest of 25, 50 and 100 ms by the same rule on the driven terrier's corrections.
   - D-16's "bodies in contact share one decay" stands; M4 checks the values with the bench's virtual peers.
3. **w:** w = 12 is confirmed if, at every pack size, `lateAbsent` is at most 0.5% of the remote inputs and resyncs are at most 1 per browser-minute, at the loss-free 30 and 80 ms profiles and at the 30 ms profiles with either loss rate, which the model's reach covers. If one fails, w becomes the smallest of 14, 16 and 18 that passes, measured again at that w; rules 1 and 2 run again at it before `src/config.ts` is written; and the plan states its costs:
   - the goldens re-emitted, since `celebrationTicks` grows with w;
   - the confirmation delay, `(w + v) / 60` s, in Q-7's and REQUIREMENTS' "about 0.4 s";
   - a normal tick's worst, `w + 1` steps, against C-2's 13;
   - **past `16 − d`, the TICK's history widens:** every TICK's history must cover `d + w` (PLAN §7.4's check), and its u16 masks hold 16 ticks. So w = 14 fits at d = 2, but 16 and 18, or any w over 13 at d = 3, take u32 masks and a 32-tick history: protocol version 2, 4 more bytes a TICK and a bot entry, `inputHistoryTicks` 32 and its check with it. protocol's code reads the history's length from configuration, so the change is the masks' width and the version.

   **The lossy 80 and 150 ms profiles aren't decisive,** because the model already says what they'll show. At 80 ms one-way, a message delayed by a retransmission arrives 240–260 ms after it was sent, past the `(d + w) × 16.7` = 233 ms it has before its tick is final, so each lost packet makes its input late at the browser that lost it, which finalises it absent, diverges and resyncs: at 0.5% loss and 60 TICKs a second, about 0.3 a second on each incoming link, so about 2 a second at a browser with 7. The model's reach is about 71 ms one-way at w = 12, 82 ms at w = 14 and 93 ms at w = 16 (protocol 2), less the clocks' residual, which the 1-tick deadband leaves at up to 17 ms, so w = 14 would cover 80 ms only narrowly. Choosing among those is a trade for the owner, not one this rule should make by arithmetic on an assumed loss rate. Phase 6 writes the measured rates into the plan as a new C-row, with w = 12 and its residual, w = 14, w = 16 with protocol 2, and the unordered input channel (§21, roslambo D-13) as the options, each with its reach and its costs, and REQUIREMENTS' "about 0.4 s" for any change of w (M3-Q6, §15).

### 9.6 The cap check (D-11, "M3 checks the cap")

- **A forced repair:** the harness's last section plays a 4-a-side match into play in which one browser's links hold every message for a while, then deliver them, so it diverges, tallies alone, and repairs when the late votes arrive. The hold is set so the repair starts about 240 ticks back, near the 256-tick history's end, about 255 steps with prediction. It records the steps and the Node time of every advance of the repair, and of the worst normal advances around it.
- **Repeated 20 times,** with a garbage collection before each (`node --expose-gc`), since one maximum is mostly the tail: M0's 42 steps at 4× had a median of 5.03–6.97 ms and a maximum of 7.52–23.29 ms (research/spike/REPORT.md §5.3).
- **The rule:** the cap of 42 stands if the median, over the runs, of each run's worst spread advance in Node, times 6.3, M0's measured ratio of a drawn step at 4× throttle in Chromium to a step in Node (183–195 µs against 27.8–31.2 µs), is at most 25 ms, half of L286's 50 ms frame, leaving the other half for the tail M0 saw. The runs' maximum is reported beside it. Otherwise the cap becomes the largest value that meets it, but never below `w + 1` (§10's check); a cap under 42 also spreads a joiner's catch-up, which neither confirms nor votes while it runs (§2.8). If even `w + 1` fails, the figures go to M4's bench and the phone's run.
- **In the browser:** M4's frame bench repeats a forced repair in throttled Chromium with its virtual peers (M3-Q14).

### 9.7 Where the decisions go

`src/config.ts` (`inputDelayTicks`, `smoothingMs`, `ownSmoothingMs` and `spreadMaxStepsPerTick`, each changed only by its rule, and `lateWindowTicks` only if rule 3 fails at a decisive profile, never for the lossy residual), A.4's rows marked "M3, by measurement", PLAN D-11, D-16, §17's M3 entry and the new C-row, and `docs/acceptance.md`'s checks outside the gate. None is an attended step, since D-16 and §17 have them chosen from the measurement; the C-row's options are the owner's, and M4's check of the glide with the bench is the next look.

---

## 10. Config additions

`src/config.ts` lacks these. Each gets an A.4 row in PLAN.md, an entry in `src/config.test.ts`'s A4 map, so `documented()` finds it and its value, and an entry in `dev/tuning/model.ts`'s `NOT_TUNED` with its reason (§1.37), and the "nowhere else" scan finds no copy: the timeline, session, transports and glue read them only through `netSettings()`. The rows' wording is checked against `numbersIn`: each parses to exactly its keys' values, in order, and avoids "one", "twice" and "half".

| Key | Value | Unit | Source | A.4 row |
|---|---|---|---|---|
| `joinWarmupSeconds` | 0.5 | s | roslambo D-7, M0: a joiner holds finalisation until heard from every active player, at most 500 ms | "Join warm-up and the tick clock" |
| `clockSettleSeconds` | 2 | s | roslambo D-11, M0: an offset counts after 2 s | the same |
| `clockSmoothing` | 0.1 | of each sample | roslambo's EWMA | the same |
| `clockGainPerTick` | 0.005 | of the rate a tick of offset | roslambo D-11, M0: 0.5% a tick | the same |
| `clockRateMax` | 0.02 | of the rate | roslambo D-11, M0: at most 2% | the same |
| `clockDeadbandTicks` | 1 | ticks | roslambo D-11, M0 | the same |
| `clockRebalanceSeconds` | 1 | s | roslambo's rebalance, once a second (`now - lastRebalance >= 1000`) | the same |
| `resyncRetrySeconds` | 0.5 | s | roslambo §8.3: the next voter after 500 ms | "Resync and joining" |
| `stateRequestRetrySeconds` | 1 | s | roslambo's `JOIN_RETRY_MS` | the same |
| `eventRetryTicks` | 30 | ticks after d | roslambo §8.3's `delay + 30` | the same |
| `peersEverySeconds` | 5 | s | PLAN §9's PEERS, roslambo D-14 | "Gossip" |
| `pingEverySeconds` | 1 | s | roslambo's `PING_EVERY_MS` was 2 s; at most half `duplicateIdSilentSeconds`, for C-12's liveness (§4.4) | the same |
| `floodTicksPerTick` | 3 | TICKs a tick | roslambo §9.3 | "Misbehaving peers" |
| `floodSeconds` | 2 | s | roslambo §9.3 | the same |
| `invalidMessagesMax` | 20 | messages | roslambo §9.4 | the same |
| `stallSendTicks` | 3 | ticks | roslambo D-11's 2026-10-25 fix; D-10 cites it | "Timer stall", extended |
| `timelineTimerMs` | 4 | ms | roslambo's `ADVANCE_EVERY_MS`; D-31 | "Timeline timer", new |
| `leaveGraceSeconds` | 0.4 | s | roslambo's `LEAVE_GRACE_MS`, and its 500 ms close after AGAIN | "Leaving", new |
| `botReadyRenewSeconds` | 10 | s | PLAN §14, C-41: a bot is always ready | "Bot hosting", new |

**The rows,** as proposed (each checked against `numbersIn` while writing this design):
- **Join warm-up and the tick clock:** "a joiner holds finalisation until every active player has been heard from, at most 0.5 s; a peer's clock offset counts once heard for 2 s, smoothed by 0.1 of each new sample; the clock runs fast or slow by 0.5% for each tick of the median offset, at most 2%, with a 1-tick deadband, and checks the median every 1 s, jumping once it's past the middle of the late window (roslambo D-11, M0, M3)" → [0.5, 2, 0.1, 0.005, 0.02, 1, 1].
- **Resync and joining:** "a peer that lost a vote asks the next voter for the winning state after 0.5 s; a joiner asks the next peer that holds the match after 1 s; JOIN, SWITCH, READY and UNREADY go again once 30 ticks pass after their tick is final without the state showing them (roslambo §8.3, M3)" → [0.5, 1, 30].
- **Gossip:** "PEERS on each change and every 5 s, and a ping to each peer every 1 s (roslambo D-14, C-12, M3)" → [5, 1].
- **Misbehaving peers:** "more than 3 TICKs a tick from a sender, or from a forwarder for each origin apart, over 2 s from a connection open that long, or 20 invalid messages from a peer, close its connection (roslambo §9.3, §9.4, M3)" → [3, 2, 20].
- **Timer stall** (A.4's row, extended): "a gap over 2 s between timer runs: a networked page rejoins from a peer whose clock ran on, or goes on from its own tick if none did, and Practice opens its menu and pauses (D-22, D-31); after a shorter gap, a networked page sends only its newest 3 ticks' inputs (M3)" → [2, 3], keys `timerStallSeconds`, `stallSendTicks`.
- **Timeline timer:** "every 4 ms, never on animation frames (D-31, M3)" → [4].
- **Leaving:** "a page that leaves, or presses Play again, keeps its room for 0.4 s, so its LEAVE or its AGAIN goes out (roslambo, M3)" → [0.4].
- **Bot hosting:** "a host sends a bot's READY again once the bot's Ready has 10 s left, so a bot is always ready (C-41, M3)" → [10].
- **A duplicate ID replaces a connection** (A.4's row, reworded): "silent for 2 s: no message, and no answer to a ping (C-12, M3)" → [2].

**`derive()` doesn't change.** `netSettings()` converts the seconds to milliseconds, and to ticks where the session counts ticks (`botReadyRenewSeconds`), throwing on a time that isn't a whole number of ticks, as `derive()` does, and derives `inputSpan` (§1.13), its factors saying `not a setting`. So the simulation's and the brain's value scan gains no new derived value.

**New configuration checks** in `src/config.test.ts` (PLAN §7.4, marked M3), each with a planted bad value it must catch:
- **TICK's history:** `inputHistoryTicks` is 16, since TICK's u16 masks hold 16 ticks (§5.3), as `stickSteps` is held to A.2's bits. The existing check that it covers `d + w` then bounds w at 14 with d = 2, and 13 with d = 3: a larger w needs the wider history of §9.5's rule 3, and this check moves with it.
- **Trystero's frame:** `messageMaxBytes` plus Trystero 0.26.0's 36-byte inline header is at most its 16,384-byte frame, so no message is chunked; `maxReceiveBytes` is at least 16,384 (D-18). The two numbers are Trystero's, pinned exactly by A.6, and the check names them.
- **The spread:** `spreadMaxStepsPerTick` is at least `lateWindowTicks + 1`, so a normal tick's worst is never spread (D-11). A cap under 42 spreads a joiner's catch-up too, which §2.8 allows.
- **Bots stay ready:** `botReadyRenewSeconds` is under `readyExpirySeconds`, and over the time for a re-sent READY to land, `(d + w + eventRetryTicks) / ticksPerSecond`.
- **Leaving:** `leaveGraceSeconds` covers `(d + w)` ticks, so a LEAVE is final at its sender before the room closes.
- **After a stall:** `stallSendTicks` is from 1 to `lateWindowTicks`.
- **Liveness:** `pingEverySeconds` is at most half `duplicateIdSilentSeconds`, so a live connection answers a ping well within C-12's silence (§4.4).
- **Counts on the wire:** `displayNameMaxBytes` is at most 255, the wire string's u8 length (already true of A.1's byte; the check names the protocol too), and so are `meshPlayersMax + spectatorsMax − 1`, PEERS' u8 count, and `BOT_SLOTS`, TICK's bot count.

**Changed by measurement in phase 6, by §9's rules:** `inputDelayTicks`, `smoothingMs`, `ownSmoothingMs`, `spreadMaxStepsPerTick`, and `lateWindowTicks` only if rule 3 fails at a decisive profile; and their A.4 rows.

**Edits they need:**
- **PLAN only,** which Claude may edit, marked M3: A.4's seven new rows, its Timer stall row extended and its duplicate-ID row reworded; PLAN §7.4's eight checks.
- **REQUIREMENTS: none.** These are implementation constants. A change of w would make REQUIREMENTS' "about 0.4 s after the ball crosses the line" (L202, from Q-7) and the Goal celebration row's "3 s plus the confirmation delay" read a different number: the second stays true at any w; the first would need the owner's edit through a PLAN §2 row, which phase 6 proposes and doesn't make (§15).

---

## 11. Dependencies

- **Nothing to install.** `@trystero-p2p/nostr` 0.26.0 is in `package.json`'s dependencies since M1, with `@trystero-p2p/core` 0.26.0 and `@noble/secp256k1` 3.2.0 in the lockfile, all MIT, resolved then with `npm install --before` a week back (A.6). `ws` 8.22.2 is a dev dependency for hermet's relay. So M3 runs no `npm install`. If a builder finds otherwise, a change of dependencies resolves with `npm install --before=2026-11-11` (CLAUDE.md), and A.6 records it.
- **Licence notices:** `scripts/expected-licenses.json` becomes `["three", "@trystero-p2p/core", "@trystero-p2p/nostr", "@noble/secp256k1"]` in the commit whose build first bundles `src/net/trystero.ts`, phase 5's (§12), when `src/nettest.ts` brings `src/ui/game.ts` into the build. `dist/THIRD-PARTY-LICENSES.txt` then carries their texts, through hermet's writer at 11283ca (§20). README's licence paragraph already says so from M3.
- **Hosts:** `third-party.json` doesn't change: the six relays and two STUN servers are declared since M1. `src/net/room-config.ts` reads them, and `third-party.test.ts` pins them. `scripts/audit-dist.mjs`'s `ignoredHosts: ['stun']`, for Trystero's STUN template, is there since M1.
- **The bundle:** Trystero with `@noble/secp256k1` is about 75 KB minified and 25 KB brotli (measured, §0's header), in the Trystero chunk, loaded only when a networked match opens. The `#test=net` chunk holds the protocol, timeline, session, scoreboard, summary, glue, the brain and the setups' scripts; the page's own module doesn't grow at M3, since nothing on a normal page imports them yet. M4's per-chunk size plugin then counts the game chunk against PLAN §12's drawer shares (M3-Q19).

---

## 12. Build order

Six phases. Phases 1 to 5 run their builders in parallel, in one checkout, on disjoint files; phase 6 runs one builder. Each phase ends with an integration step: the full `npm run check` green, the lint clean, every test of the phase green, no `M3 setting pending` marker left (§0), and a commit. A builder never edits another builder's files in its phase, and imports only files that existed when its phase began (§0); a later phase changes an earlier phase's files only where it's named the owner below. Each phase names the owner of the configuration files (`src/config.ts`, `src/config.test.ts`, `dev/tuning/model.ts` and PLAN.md's A.4 and PLAN §7.4).

### Phase 1: foundations. Three builders in parallel

- **protocol**
  - **Files:** `src/core/protocol/{bytes,messages}.ts`, `messages.test.ts`, `fuzz.test.ts`, `sizes.test.ts`.
  - **Scope:** §1.1, §1.2, §5.
  - **Needs:** M2's simulation (`input.ts`, `codec.ts`, `state.ts`), `BOT_SLOTS` from `src/core/bot/bot-id.ts`, and `config` as it is: `wireLimits` reads `inputHistoryTicks`, `messageMaxBytes`, `displayNameMaxBytes`, `meshPlayersMax`, `spectatorsMax`, `stateHistoryTicks`, `lateWindowTicks` and `inputDelayTicks`, which exist.
- **timeline-parts**
  - **Files:** `src/core/timeline/{inputs,history,votes,clock}.ts` and their four tests.
  - **Scope:** §1.3–§1.6, §2.12's rings.
  - **Needs:** M2's simulation only. `Recorded` declares its payload fields itself (§1.3), structurally the same as protocol's `EventPayload`, so the two builders share no file.
- **config**
  - **Files:** `src/config.ts`, `src/config.test.ts`, `src/core/session/settings.ts` and `settings.test.ts`, `dev/tuning/model.ts` (`NOT_TUNED`), PLAN.md (A.4's rows and PLAN §7.4's checks, marked M3). The configuration files' owner.
  - **Scope:** §10, §1.13, §1.37. `settings.ts` declares `TimelineSettings`, `RoomSettings` and `TransportSettings` itself, by this design's shapes; phase 2's `TimelineConfig` extends `TimelineSettings`, and `TickClock` takes its `clock` with d and w added, so no later phase edits `settings.ts`.
- **Integration:** `npm run check` green; the protocol's round trips, fuzz and sizes; the parts' tests; `src/config.test.ts` with the new rows and checks, each check catching its planted value; `dev/tuning/model.test.ts` with every new key in `NOT_TUNED`.

### Phase 2: the timeline, the net layer and the bot host. Three builders in parallel

- **timeline**
  - **Files:** `src/core/timeline/timeline.ts`, `timeline.test.ts`, `predict.test.ts`, `rollback.test.ts`, `spread.test.ts`. The configuration files' owner.
  - **Scope:** §1.7, §2, §3.1–§3.4, §3.6.
  - **Needs:** phase 1.
- **net-layer**
  - **Files:** `src/core/session/room-peer.ts`; `src/net/{transport,room-config,trystero,local,loopback,dev-relay}.ts`; `src/net/{loopback,room-config,third-party,local}.test.ts`; `scripts/dev-local.mjs`; `scripts/build-inputs.mjs` and its test; `scripts/dev-relay-audit.mjs` and its test; `scripts/audit-dist.mjs`; `src/build-info.ts` and `src/build-info.d.ts`; `vite.config.ts`, `vitest.config.ts`; `package.json` (`dev:local`); `eslint.config.mjs`, `scripts/eslint/config.test.mjs` and its fixtures.
  - **Scope:** §1.8, §1.18–§1.22, §1.29–§1.31, §1.33, §1.36, §6. `trystero.ts` is typechecked and linted but bundled by nothing until phase 5's page brings `src/ui/game.ts` into the build, so the bundle and the expected licences don't change yet. `loopback.test.ts` drives a minimal `RoomPeer` of its own, and checks that a burst's handshakes overlap and that pings stop for a frozen node.
  - **Needs:** phase 1's protocol (`Hello`, `decode`).
- **bot-host**
  - **Files:** `src/core/session/bots.ts` and `src/core/session/bots.test.ts`; `src/core/bot/brain.ts` and `brain.test.ts`; `src/core/bot/setups.ts` and `setups.test.ts`; `src/core/bot/bot-id.ts`, `src/core/bot/marks.ts`.
  - **Scope:** §1.11, §1.12, §4.8: `BotHost` tested against a fake `BotTimeline` pumped by hand, with no session or network: IDs, coats and names, JOIN until the state shows it, READY renewed at 10 s left, removal, adoption after a reload with each brain's counters from the stored input, giving up when full or started, Play again's fallback, and one think per head tick; the brain's view keyed by tick; the setups' scripts moved; `personId` moved.
  - **Needs:** M2's brain and marks, phase 1's `settings.ts` and `EventPayload`. It imports nothing of phase 2's: `BotTimeline` is its own (§0).
- **Integration:** `npm run check` green; the timeline's tests, `fullReplay` and `verify` included, the spread at the cap, the drawn head never moved back and never `F`; the loopback, room-config, build-inputs, dev-relay-audit and lint tests; M2's marks and `marks-e2e-setups.test.ts` counting exactly as before; `npm run dev:local` starts the relay and the dev server, by hand once.

### Phase 3: the session and the scoreboard. Two builders in parallel

- **session**
  - **Files:** `src/core/session/{session,roster,build}.ts` and `room-peer.ts` (its owner from now on); `src/core/session/{build,roster}.test.ts`; `src/net/{network,spectators,returning,misbehaving,stalls}.test.ts`. The configuration files' owner.
  - **Scope:** §1.9, §1.10, §1.14, §4 but §4.8's `BotHost`, which it uses through §1.11's signatures; its tests assert that `Timeline` satisfies `BotTimeline`.
  - **Needs:** phases 1 and 2. The largest sitting of M3, but a port of roslambo's session with its tests as the guide. Its network tests need no bot behaviour beyond `BotHost`'s, which exists.
- **scoreboard**
  - **Files:** `src/core/session/{scoreboard,summary}.ts` and their tests; `src/ui/clock.ts` and `src/ui/clock-testing.ts`.
  - **Scope:** §1.15, §1.16, §1.23, §3.5. Its tests pump a real `Timeline` and assert that it satisfies `ScoreTimeline`.
  - **Needs:** phase 2's timeline.
- **Integration:** `npm run check` green; P1, P2, P4, P5 and P7's network half; the refusals, spectators with overlapping handshakes, returning players, stalls and misbehaving peers; the scoreboard's and the summary's tests.

### Phase 4: consensus, hosting, Practice and the glue. Four builders in parallel

- **consensus**
  - **Files:** `src/net/{consensus,replay,hidden}.test.ts`; fixes in `src/core/timeline/timeline.ts` and `src/core/session/scoreboard.ts`, which it owns in this phase.
  - **Scope:** P3, P9, §3.6, the replay checks, D-31's hidden pages, D-16's sitting.
- **hosting**
  - **Files:** `src/net/{bots,bots-setups,abandoned,again}.test.ts`; fixes in `src/core/session/{session,bots,roster}.ts`, which it owns in this phase. The configuration files' owner.
  - **Scope:** §4.7–§4.9, D-39's hosting, Q-16, C-42, and R-7's check that §16's three-engine setup ends decisively over the loopback, replayed exactly (§8.1), before the end-to-end match relies on it.
- **practice**
  - **Files:** `src/core/session/practice.ts`, `src/ui/practice.ts`, `src/net/practice.test.ts`, `src/ui/practice.test.ts`.
  - **Scope:** §1.17, §1.25, D-22, Q-15, P10, and the Practice setup's check (§8.1).
  - **Needs:** phase 3's `Session`, `Scoreboard`, `clock.ts` and `clock-testing.ts`.
- **net-glue**
  - **Files:** `src/ui/game.ts` and `game.test.ts`; `src/nettest-params.ts` and `src/nettest-params.test.ts`; `e2e/lib/browsers.ts`.
  - **Scope:** §1.24, §1.26, §1.34, §4.5's leaving, §4.9's flow, §4.12's detection, §6.7, §7.2's parsing, §7.4's types.
  - **Needs:** phase 3's `Session`, `Scoreboard`, `summary.ts` and `clock.ts`; phase 2's transports.
- **Integration:** `npm run check` green; P3, P9 and P10's unit half; the replay checks, and every loopback test with its verifying node; R-7's and Practice's setup checks, their slowest first goals recorded for phase 5's timeouts; the glue's tests.

### Phase 5: the page, the specs and the harness. Two builders in parallel

- **net-page**
  - **Files:** `src/nettest.ts`; `src/main.ts`; `scripts/expected-licenses.json`; `e2e/match.net.spec.ts`, `e2e/nettest.spec.ts`, `e2e/practice-net.spec.ts`. The configuration files' owner.
  - **Scope:** §1.27, §1.28, §1.32, §1.35, §7, §8.4, the reload built first on its own and run ten times (§8.4). `e2e/determinism.spec.ts` must still pass with the two test pages' chunks beside each other (§14 R-15).
  - **Needs:** phase 4's glue, parameters and `browsers.ts`.
- **harness**
  - **Files:** `dev/corrections.measure.ts`, `dev/corrections.vitest.config.ts`, `dev/corrections.test.ts`; `e2e/load.run.ts`, `playwright.load.config.ts`; `e2e/dev-local.run.ts`, `playwright.dev-local.config.ts`; `tsconfig.json` (the root configs in its `include`, which names `playwright.config.ts` alone today).
  - **Scope:** §1.38, §8.5, §9.2–§9.6's code. It measures nothing that counts: a smoke run of one small profile, and of the load run at 20 s, outside the gate, only to show they run.
  - **Needs:** phase 4's `browsers.ts` and `nettest-params.ts` to compile, and net-page's page to run the load run's smoke, which the integration step does.
- **Integration:** `npm run check` green, with `e2e/match.net.spec.ts` in the `net` project, `nettest.spec.ts` in three engines and `practice-net.spec.ts` in Chromium; P1–P5 and P7–P10 green; the build bundles Trystero with its three notices and no dev relay; the harness's smoke runs; the gate's wall time measured.

### Phase 6: measure and settle M3. One builder

- **settle**
  - **The method first:** `research/corrections/REPORT.md`'s method section committed before any measurement (§9.1).
  - **The measurement:** the correction runs, the repeated forced repair for the cap, the decisions by §9.5 and §9.6's rules, `results.json` and the report. A change of w re-emits the goldens with `TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens`, and the commit says so (CLAUDE.md).
  - **The load run:** `research/load/results.json`, and its row in `docs/acceptance.md`.
  - **The desktop connection:** the owner's two browsers through `npm run dev:local`, or, if that hasn't happened, the provisional settle of §15, logged owner-pending.
  - **The amendments,** each marked M3 and citing its evidence: D-11 (as built: the watermark and its rules, the marks, reuse, the spread, the drawn head's contract, the late boundary on the clock, the stores' windows), D-12 (Play again's proposal, §4.9), D-13 and C-10 (§3.6's two-voter rules), D-14 (the latch as built), D-16 (the glide, d, the corrections' definition), D-17 (returns and rejoins, §4.6; the abandoned rule ending at the end), D-18 (the largest STATEs measured, with the ID table), D-19 (FWD acceptance), D-20 (the layouts, the measured sizes and traffic), D-21 (as built: reservations, every outside HELLO counted, a bot's ID refused, liveness from pongs), D-22, D-31 (the stall rule), D-39 (the brain's view by tick, one think per head tick), PLAN §8 (P3's wording, M3-Q1), PLAN §9 (the layouts, the role byte, the STATE's ID table), PLAN §15 (`dev:local`, the runs' configs, the dev-relay audit), §16 (the tests as built and the gate's cost), §17's M3 entry and M4's readout line (M3-Q24), A.4, C-2 (the timeline's measured tick cost), C-11 and C-12 (as built), the new C-row for the loss reach (§9.5), and the answers to this design's questions, M3-Q1 to M3-Q28.
  - **The records:** `docs/acceptance.md` (the gate's wall time, the load run, the corrections, the M3 check); README (`dev:local`, the `#test=net` page, the load run, the correction measurement, privacy as of M3); CLAUDE.md (the `#test=net` page and `window.terriestTest.net`; the net spec's guard; the Trystero chunk loaded only by `NetGame.open`; `dev:local`; the dev-relay audit); `src/core/session/index.ts`; this design as `research/m3/DESIGN.md`.
  - The configuration files' owner.
- **Exit,** M3's (§17): P1–P5 and P7–P10 green; the end-to-end match green; Practice contacts nothing; the load run logged; the correction report with p50, p95 and max per profile and the late inputs, d and the glide chosen, w confirmed or amended, and the loss reach's C-row written; the desktop connection made or settled provisionally; `npm run check` green, its wall time logged.

### What may run in parallel, in short

- **Phase 1:** protocol, timeline-parts and config.
- **Phase 2:** timeline, net-layer and bot-host.
- **Phase 3:** session and scoreboard.
- **Phase 4:** consensus, hosting, practice and net-glue.
- **Phase 5:** net-page and harness.
- **Nothing else.** Phase 6 owns the measurement and the cross-cutting documents.

---

## 13. Gate cost

**Today:** about 2 minutes here (124.0 and 122.6 s at M2's exit: the unit stage 34 s, 50 files and 584 tests; the end-to-end tests 1.2–1.3 minutes, 14 in each engine), and 1 min 58 s on CI's first run (unit 35.7 s, end to end 1.1 minutes) (`docs/acceptance.md`).

| Stage | What M3 adds | CPU | Wall time added here (11 workers) | On CI |
|---|---|---|---|---|
| lint | about 55 files | — | +3–5 s | +4–6 s |
| typecheck | the same | — | +2–3 s | +3 s |
| unit: protocol and parts | fuzz and round trips, the parts | ≈ 6 s | | |
| unit: timeline | rollback, spread, `fullReplay` comparisons | ≈ 12 s | | |
| unit: network | about 85 loopback scenarios in 13 files, the setups' checks apart, 2 a side mostly, virtual time, one node in each at `verify: 8` and every node in `replay.test.ts` at 1 | ≈ 180–260 s | | |
| unit: the setups' checks | R-7's 13 matches and Practice's 11, in `bots-setups.test.ts` and `practice.test.ts` (split further if one runs much over 8 s) | ≈ 25 s | | |
| unit, in all | | ≈ 220–300 s | **+20–28 s**, set by the pool and the longest file, kept near 8 s | +50–70 s |
| build | two chunks, three notices, the dev-relay audit | — | +1–2 s | +1–2 s |
| e2e: `match.net.spec.ts` | one whole 1-minute match, three engines and a spectator, a reload, Ready at tick 600: about 105–120 s with joining and goals | — | **+105–120 s** | similar |
| e2e: `nettest.spec.ts` | 4 tests × 3 engines, a few seconds each | — | +12–18 s | similar |
| e2e: `practice-net.spec.ts` | Chromium, to the first confirmed goal | — | +12–15 s | similar |
| **Total** | | | **about +2.7–3.2 minutes: 4.7–5.2 minutes** | about 5–5.5 minutes |

**How M3 keeps it reasonable without weakening any check:**
- **One whole networked match** in the gate, which §16 asks for, carrying the spectator who joins mid-match and the reload too, instead of a match each.
- **The net pages draw nothing,** so three engines and a fourth page run at once without C-6's software-GL cost.
- **Practice's spec stops at its first confirmed goal,** since M4's §16 Practice plays the whole match through the screens; and it runs in Chromium only, as §16's Practice does.
- **Virtual time for the logic:** every property is a loopback test, seconds of CPU each; matches play to the end only where the property is about the end; the full replay checks every loopback test on one node, sampled every 8th advance and at every STATE and changed base, and every advance of every node in `replay.test.ts`, on scenarios a few seconds long; files are split so none runs much over 8 s, as M2 balanced its marks.
- **Outside the gate,** as §16 says: the correction measurement, the load run, the forced-repair cap check, the reload's ten-run proof and the desktop connection's settle.
- **Not taken:** fewer engines in the networked match, skipping its reload or its spectator, a match under 1 minute (the configuration's least), Playwright retries, or the loopback properties at fewer seeds than their tests state. Each would weaken a check §16 names, or hide a flake.

---

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **Rollback exactness:** a change to what prediction reads that doesn't lower `validTo`, a reused final that doesn't equal a stepped one, a predicted clone shared between entries, the drawn head moving back or holding `F`, state left in the `Sim`, or a decoded state that steps differently from its original. Peers would agree in tests that give every peer the same timing, and split in the field. | §2.7's invalidation list follows §2.2's rule input by input (records, marks, newest, `finalTick`, the base); `verify` in every loopback test, on one node sampled and on every node in `replay.test.ts`, through merges, forwarding, bots, hidden bursts, paced senders, clock jumps, silences, returns and Practice's catch-ups; `fullReplay` run beside each and compared tick by tick; each invalidation path forced alone in `rollback.test.ts`; §2.8's head contract tested in `spread.test.ts`; M2's "one `Sim`, many states" tests; a decoded state stepped beside its original; the codec's byte-for-byte round trips. |
| R-2 | **Timer and frame-rate dependence in tests:** a spec that sleeps a fixed time, or reads a state too early on a slow runner; Node tests that use real timers. | All logic in virtual time over the loopback; the glue tested with `FakeClock`; specs poll the hook for logical state, trigger the spectator and the reload from it, and take their timeouts from measured runs; the net pages draw nothing, so a slow GL path can't starve them. |
| R-3 | **WebRTC among Chromium, Firefox and WebKit under Playwright,** here and on CI under `xvfb-run`, through the local relay only. | roslambo's launch flags and `ice=local`'s loopback rewrite, with which roslambo's gate plays its three-engine round on this machine, in the same Playwright and engines; CI's first run showed the hosted runner holds three engines, and M3's first push shows whether it holds their WebRTC. The specs never use a public relay or STUN. If the hosted runner can't hold the networked match, C-6's rule applies: a labelled-partial `check:ci` leaves out exactly that spec, and the local gate stays the definition of done. |
| R-4 | **Re-simulation cost at w = 12** against C-2's tick cost, 28–42 µs a step at 4 a side here. | A normal tick is one step plus about 9 µs of encoding and hashing; the worst normal tick is 13 steps, about 0.5 ms here and about 3.3 ms at M0's 4× drawn ratio; a spread tick at the cap is about 2 ms here and about 13 ms at that ratio, against M0's measured maximum of 23.3 ms for 42 bare steps. §9.6 checks the cap over 20 runs; the brain never runs in a re-simulation. |
| R-5 | **Flaky network tests:** WebRTC setup times, the relay's timing, a reload's race with the duplicate rule, Trystero logging a peer error as a console error. roslambo reloaded only in Chromium, and its three-engine round has no reload. | One worker; generous connection waits by polling `peers`, never sleeps; the reload built first in a short test of its own and run ten times in a row before it joins the match (§8.4); the reloading page leaving through Trystero's leave action on `pagehide`; `duplicates` reporting which rule refused a HELLO; the session's exceptions kept out of Trystero's handler; a flake investigated, never retried or allowed; the seeded loopback reproduces any logic failure. |
| R-6 | **Hidden tabs and stalls** (D-31): a hidden page's bursts drag the clock or arrive late; a frozen page splits the match; pages frozen together find no one to rejoin from; Practice catching up a long pause. | roslambo's 2026-10-25 fixes ported (the clock's capped phase, the clock's "ahead", the newest 3 ticks); the late boundary on the clock (§2.8); the stall rule, which rejoins only from a peer whose clock ran on and keeps the old timeline until a STATE is adopted (§4.12); tested in `hidden.test.ts` and `stalls.test.ts`, every page frozen together included; Practice pauses on a stall and on hiding. |
| R-7 | **The end-to-end match isn't decisive over the network:** M2 validated the setup offline, where a bot decides from the state before its tick; over the timeline it decides from the head, d ticks later, and the countdown starts when the last Ready lands. | The brain's view keyed by tick and one think per head tick (§1.11, §1.12), so its reaction is the same however the head moves; Ready at a tick, not a time; `bots-setups.test.ts` replays the spec's exact setup over the loopback, the reload's absence swept, and 10 more seeds with shifted starts, all decisive before the spec relies on it; the spec fails at once on an overtime. |
| R-8 | **The late boundary:** an input dropped by every other peer accepted here while a repair lags or the page is hidden, or one accepted by them dropped here. | §2.8's boundary, `max(finalTick, ⌊clock⌋ − w)` outside a warm-up; `consensus.test.ts`'s late-vote repair with inputs in flight throughout; `hidden.test.ts`'s input late everywhere while a page sleeps; `verify` and the hashes against the majority after them. |
| R-9 | **The build hash misses a source** and old and new builds share a match (C-13), or includes something that changes per build machine. | `buildInputs` hashes repo-relative paths and bytes only, sorted, of every agreeing `src/core` source and `goldens.json` (M3-Q3); its test edits a simulation source, `goldens.json`, a timeline, protocol, bot-ID and session source in a temporary copy, and checks that tests and the brain don't count. |
| R-10 | **Parallel builders in one checkout,** four in phase 4. | Disjoint files, one owner per shared file per phase, and no import of a file a same-phase builder is writing (§0, §12); the narrow interfaces `BotTimeline` and `ScoreTimeline` asserted when their providers exist; builders keep their files compiling and stage only their own; the gate runs at each integration step. |
| R-11 | **The configuration scan's friction:** a timeline constant named like a setting. | §0's rule: read through `netSettings()`; builders run `src/config.test.ts` early; a failure names the file and line; a pending setting is marked and moved at integration. |
| R-12 | **Trystero's `beforeunload` cleanup** leaves the room even when M4's leave prompt keeps the page. | `TrysteroRoom` leaves on `pagehide` too, so M4's guard can stop `beforeunload`'s propagation (M3-Q20). |
| R-13 | **Head-of-line blocking** makes losses expensive at 80 ms and more: past the model's reach, about 71 ms one-way at w = 12, each lost packet costs its receiver a resync. | §9.5 measures it at three loss rates without letting it decide w by arithmetic, and phase 6 takes it to the owner as a C-row with its options and their reach: w = 14, w = 16 with protocol 2, and the unordered channel (§21's deferral). The protocol reads the history's length from configuration, so widening it is the masks and the version. |
| R-14 | **The gate grows to about 5 minutes.** | §13's measures; the wall time logged; nothing cut. |
| R-15 | **Chunks shared between test pages:** the net page and the determinism page both import the simulation, and the bundler may move shared modules into a common chunk. `e2e/determinism.spec.ts` checks that the determinism chunk holds the canary's hash and that the page's own module holds no golden. | The net page imports no `goldens.json` and computes no canary at M3 (§7.3); `nettest.spec.ts` checks that a normal page loads neither test chunk nor any chunk they share; net-page runs `e2e/determinism.spec.ts` at its integration step. M4, which moves the canary onto the app's path (D-23), meets the same check. |
| R-16 | **Two voters' repairs crossing:** with two voting browsers every tie goes to the smaller hash, and a dissenter that kept voting and serving its history could swap states with the other browser at each divergence, every 1-a-side match between two people (C-10). | §3.6's three rules: no vote sent and no STATE served while a resync is outstanding, and a repair's own votes replaced; tested at 1 a side at 30 and 80 ms with seeds chosen against it, and a three-way split at three voters. |
| R-17 | **Admission races:** concurrent handshakes all passing the count from before a burst, past 8 + 4. | Reservations held from `checkHello` to the join or the failure (§4.3), released by `onHandshakeFailed` and the handshake timeout; the loopback's handshake in two rounds, so a burst overlaps as Trystero's does; `spectators.test.ts`'s simultaneous arrivals. |
| R-18 | **Forged identities:** a peer writing inputs or votes for this browser or its bots, a HELLO under a bot's ID, FWDs for made-up origins growing per-origin state, moving the clock or adding unhosted terriers, STATE_REQs that make a peer send 10 KB at will, or a STATE whose unhashed fields push writes out of the stores' windows. | §4.10's rules (nothing about this browser or its bots, a bot's ID refused, FWD only for an origin its sender's PEERS lists, PEERS capped, clock samples direct only, floods per forwarder and origin, one STATE answer per connection per `resyncRetryMs`), §5.5's tick bounds and §2.12's windows; each forgery in `misbehaving.test.ts`. |
| R-19 | **The brain's change moves M2's marks:** `brain.ts` is M2's, and its marks and the end-to-end setups are validated counts. | The view keyed by tick reads the same entry as today's for one call per consecutive tick, which is how the marks call it; phase 2's integration runs every mark and `marks-e2e-setups.test.ts` unchanged, and any changed count stops the phase. |

---

## 15. Owner-only and attended steps

- **The relay check** writes to the public relays and waits for the owner's go-ahead (Q-14, §17). It's M5's: roslambo's probe and three-engine round through one relay at a time, which `#test=net` with `relay=wss://…` already supports, a curated relay being one a production build accepts (§6.7). M3 runs nothing against a public host.
- **The owner's desktop connection** (§16's "By hand", M3): two of the owner's desktop browsers on Windows open the `#test=net` page through `npm run dev:local`, one as keeper and one as player, at 1 a side with `script=brain`, and the status shows them connected, ticking and in agreement through a match. `docs/acceptance.md` gives the two addresses to paste, with a fixed room ID that only the local relay ever sees.
  - **If it hasn't happened** when M3's other exits are met, Claude settles it provisionally (§17's rule for attended steps): `npx playwright test -c playwright.dev-local.config.ts`, which starts `npm run dev:local` and opens the page in headless Chromium and Firefox, on C-6's GPU path, with `ice=none` so nothing public is contacted, and with the guard allowing the dev server's `ws://` origin for Vite's HMR client beside its `http://` base and the relay (M3-Q4). It's logged owner-pending in `docs/acceptance.md`, and the owner's own run lands before M5's deploy.
- **Pushes:** the M3 branch, and `main` after `/merge-to-main`, each with the owner's go-ahead (§17). A push of `main` runs CI, which now plays the networked match on the hosted runner.
- **The owner's sign-offs M3 may raise:**
  - **the loss reach's C-row** (§9.5): at one-way latencies past about 70 ms, each lost packet on the reliable ordered channel costs its receiver a resync, at the rate the measurement reports; the options are w = 12 and the residual, w = 14 (about 82 ms, 33 ms more confirmation delay, re-emitted goldens), w = 16 (about 93 ms, protocol version 2) and the unordered channel (§21). The owner picks; M3 doesn't wait for it, as §17's rule for attended steps allows, and w stays 12 until then.
  - **a change of w,** by §9.5's rule or the owner's pick, moves "about 0.4 s" in REQUIREMENTS' consensus line (L202, from Q-7); phase 6 proposes the PLAN §2 row and makes no REQUIREMENTS edit.
- **Nothing else:** no hermet change is needed (its room config, relay and audit serve as they are), no roslambo or amorfus change, and no dependency change.

---

## 16. Questions for the plan

Each has a proposed resolution, which phase 6's settle writes into PLAN.md, marked M3, unless the owner says otherwise. None needs a REQUIREMENTS edit, except M3-Q6's if w changes.

1. **M3-Q1. P3's bound and the spread.** P3 says a dissenter holds the majority's state again "within v ticks plus one round trip". A late-vote repair spread at 42 steps a tick takes up to 7 more ticks.
   - *Proposal:* P3 reads "within v ticks, one round trip, and the ticks D-11's spread takes, at most ⌈steps ÷ cap⌉". While a repair is spread, the drawing holds the last head, nothing is confirmed, no vote is sent, and inputs keep flowing (§2.8).
2. **M3-Q2. "Each pack's bots on different simulated browsers."** It can mean one bot per browser, or each pack's bots on a browser apart from the other pack's.
   - *Proposal:* one browser per terrier, each driving its own terrier with the brain, so every other terrier is remote, as in a match of people. It's the harder case for prediction and the real message shape.
3. **M3-Q3. What the build hash's source hash covers.** D-21 names "the `src/core/sim` sources". The timeline, protocol, session and bot IDs also decide what peers agree on: the late boundary, the payload merge, the mask, a name's decoding, which TICKs and FWDs reach the timeline, which bot entries count. Two builds differing there could share a match and keep resyncing (C-13).
   - *Proposal, built from phase 2:* every `src/core` source but its tests and the three files peers may safely run in different versions, `src/core/bot/brain.ts`, `marks.ts` and `setups.ts`, whose outputs are inputs like a person's; plus `goldens.json`; at build time through a Vite define, so the goldens never enter the page's bundle.
4. **M3-Q4. `dev:local`'s ICE, and the relay's address.** PLAN §15 says "the browsers' default ICE, never roslambo's `local: true`".
   - *Proposal:* production's ICE, STUN from `third-party.json`, with the local relay in place of the curated ones; the relay's URL built from the page's own host name and a dev-only port variable, so Windows browsers reaching WSL2 by `localhost` reach it. For Claude's provisional settle, `ice=none`, so it contacts nothing public, with the engines launched with roslambo's flags, and the guard allowing the dev server's `ws://` origin for Vite's HMR client.
5. **M3-Q5. Where the match glue lives at M3.** PLAN §6 puts `game.ts` and `practice.ts` in `src/ui/`, which M4 builds.
   - *Proposal:* M3 builds both now, without screens, with the timer and visibility injected (`Clock`, `PageEvents`, in `src/ui/clock.ts`), since the `#test=net` page, Practice's test and the load run need them; M4 adds the screens around them. The pure parts stay in `src/core/session/`.
6. **M3-Q6. When the measurement changes w.** D-16 has d and the glide chosen from the measurement; §17 says w is "confirmed or amended in this plan".
   - *Proposal:* §9.5's rules decide d and the glide from loss-free profiles. w is confirmed or changed by its rule at the loss-free profiles and the lossy ones the model's reach covers. Past that reach (about 71 ms one-way at w = 12, with loss), the measured cost goes to the owner as a new C-row, with w = 14, w = 16 and the unordered channel as options, since the model fixes the outcome there whatever is measured and a change of w moves REQUIREMENTS' "about 0.4 s" anyway. A change of w re-emits the goldens, and runs rules 1 and 2 again first. A w over `16 − d` also widens the TICK's history to 32 ticks, a protocol version 2, which the rule lists among its costs.
7. **M3-Q7. The `#test=net` page's hook.** CLAUDE.md's `window.terriestTest` is the normal page's, and the determinism page publishes its own global.
   - *Proposal:* the net page adds `net` to `window.terriestTest` only when a spec set it before load, and shows a DOM status for the owner's check; it publishes no global of its own. A normal page never loads its chunk.
8. **M3-Q8. M3's settings.** roslambo kept its clock gains and period, retries, flood limits and timer period as code constants; CLAUDE.md puts every setting in `src/config.ts`.
   - *Proposal:* the 19 keys of §10, in seven new A.4 rows, the extended Timer stall row and the reworded duplicate-ID row, with eight new configuration checks, and each key in `NOT_TUNED`, as M2 moved the bots' tunables into configuration. roslambo's flood factor, 0.9 of the window, goes: the connection's age does its job (§4.10).
9. **M3-Q9. A networked page after a stall.** A.4 says a networked page rejoins from a peer after a stall over 2 s. roslambo rejoined whenever any peer had ever been live, so pages frozen together all dropped their timelines and none could answer; with no peer, it kept its own and caught up every tick, which after a long stall is thousands of steps.
   - *Proposal:* §4.12: pause, and rejoin only from a peer whose clock ran on, shown by a TICK for a tick past `localTick + d + w` within `stateRequestRetryMs`, keeping the old timeline until a STATE is adopted; with none, re-anchor the clock at the local tick, as Practice's does.
10. **M3-Q10. Who may speak for whom.** roslambo's timeline dropped only a TICK whose origin was this browser's own ID, took a FWD for any other origin, took a clock sample from a FWD with a delay of 0, and, when joining, took any STATE.
    - *Proposal:* §4.10: nothing about this browser or its bots, and nothing for a bot apart from its host, so a HELLO under a bot's ID is refused; a FWD only for an origin with no direct connection here and only from a connection whose PEERS lists it; PEERS capped; clock samples from direct TICKs; floods counted per forwarder and origin; a joiner's STATE only from a peer it asked. Honest peers never send otherwise, and it bounds what one peer can say for another.
11. **M3-Q11. Conflicting event payloads.** roslambo merged a JOIN's name last-writer-wins, which depends on arrival order.
    - *Proposal:* events OR-ed, and a conflicting JOIN or SWITCH payload for one sender and tick keeps the one that sorts first by (pack, coat, name), as `canonicalInputs` resolves duplicate IDs; an event that arrives before its input makes a record its input completes (§2.5).
12. **M3-Q12. The bark bits and bit 15 in the simulation's inputs.** The simulation never reads them, but `sameInputs` compares whole inputs, so a bark would force a re-simulation.
    - *Proposal:* the timeline hands the simulation `input & KEPT_BITS`, and keeps the full u16 for `receivedInput` and barks.
13. **M3-Q13. The loss rate.** §17 says "an occasional extra round trip".
    - *Proposal:* three rates, 0, 0.1% and 0.5% a message, the last about one every 3 s on each link at 60 messages a second, with FIFO holding the messages behind a loss. d and the glide are chosen from the loss-free profiles; the lossy ones report what a loss costs (§9.5). The owner may name another rate; the method records the rates before measuring.
14. **M3-Q14. Checking the cap.** "M3 checks the cap" doesn't say where. M0 timed bare steps in throttled Chromium; the timeline adds encoding and hashing.
    - *Proposal:* M3 times a forced repair in Node 20 times, a garbage collection before each, and applies M0's measured ratio to the median of the runs' worst advance (§9.6); M4's frame bench repeats it in throttled Chromium with its virtual peers, where the page also draws.
15. **M3-Q15. The keeper's role byte in PEERS.** PLAN §9 lists 2, 3 and 4. A keeper with peers also sends PEERS.
    - *Proposal:* PEERS carries 1–4, as HELLO does. D-21's count reads only "outside the roster" and "announced spectator", so the keeper counts as outside the roster and not as a spectator.
16. **M3-Q16. D-21's admission count: "counting this one", "undecided", and handshakes in flight.**
    - *Proposal:* "this one" is the browser applying the check: it counts itself among the browsers outside the roster when it is outside, and never the newcomer, so a fifth spectator is refused with four connected. Every HELLO from outside the roster counts, whatever role it announces, where D-21 names the undecided, since a role is a peer's own claim; the honest non-undecided cases (a spectator's link re-forming, a merge's other timeline) bring back browsers the mesh already held, which `again.test.ts`'s full-room race checks. Handshakes this browser has admitted but not completed count too, until they join, fail or time out, so concurrent handshakes can't all pass (C-11).
17. **M3-Q17. Bots' Ready renewal.** roslambo re-sent a bot's READY after it expired, so for a moment the bot wasn't ready.
    - *Proposal:* re-sent once 10 s are left (`botReadyRenewSeconds`), so a bot is always ready (C-41).
18. **M3-Q18. What "heard" means for the abandoned rule** (Q-16).
    - *Proposal:* a TICK, direct or forwarded, from a browser whose ID or derived bots are in the final roster; its votes and PEERS don't count, since a browser that controls nothing sends those too. And nothing is abandoned once the final state is ended: Results show (C-50).
19. **M3-Q19. Where the game's code lands in the bundle.** PLAN §12's code-built drawer share, 23,747 B brotli, was M0's entry chunk without three.
    - *Proposal:* the protocol, timeline, session and brain go into the game's chunk, loaded with the screens at M4, and Trystero into its own, loaded by `NetGame.open`; M4's per-chunk plugin counts them, and PLAN §12's figure for the drawer is read as the drawer's code alone. M3's normal page doesn't change.
20. **M3-Q20. Trystero's `beforeunload` and D-30's leave prompt.** Trystero leaves every room in `beforeunload`, even when the page then stays.
    - *Proposal:* `TrysteroRoom` also leaves on `pagehide`, and M4's guard, registered before the room is made, stops `beforeunload` from reaching Trystero while it prompts. A page that stays keeps its peers; one that goes leaves on `pagehide`.
21. **M3-Q21. M3's exit properties.** §17 lists P1–P5 and P7–P10. P6 is roslambo's ante, which terriest doesn't have, and P11 is M4's drawing.
    - *Proposal:* as listed; P8 stays green from M2.
22. **M3-Q22. Practice's end-to-end test at M3.** §16's Practice plays a whole match through the screens, which are M4's; M3's exit asks that Practice contacts nothing.
    - *Proposal:* `e2e/practice-net.spec.ts` through `#test=net&mode=practice`, Chromium only, to the first confirmed goal, with the peer-connection count and the request guard; M4's §16 Practice then plays it whole through the screens.
23. **M3-Q23. What C-12's "sent nothing for 2 s" means.** A keeper, an undecided peer and a spectator send only PEERS every 5 s, and Trystero's pings never reach the session, so a live connection of theirs looks silent most of the time, and anyone who knows its player ID could replace it.
    - *Proposal:* silent means no message and no pong; pings every 1 s, at most half the 2 s (PLAN §7.4's check). A frozen or killed page answers no ping, which is C-12's case.
24. **M3-Q24. Real networks' figures for M5.** §17's M5 logs "each peer's late inputs, rollbacks and correction sizes" on the deployed site, but M3's figures live behind the test hook, which a normal page never has.
    - *Proposal:* M3 builds the match summary (§1.16) and `NetGame.summary()`; M4's Results, or its Settings, shows it with a Copy button; §17's M4 entry gains that line.
25. **M3-Q25. The brain over the timeline** (D-39). M2's brain counts its view by calls, and over the timeline a catch-up sends several ticks on one head, and a spread holds the head, so its reaction would shorten and it could press twice.
    - *Proposal:* its view keyed by tick, and a host thinking once per head tick (§1.11, §1.12), with M2's marks counting exactly as before.
26. **M3-Q26. Whether a Play-again press proposes.** D-12: "a browser joins the match there, or proposes it if none exists".
    - *Proposal:* as roslambo's: it proposes only if no AGAIN reached it in the old room, and joins otherwise; two that each saw none merge (§4.9).
27. **M3-Q27. STATE's input records.** PLAN §9 says "as roslambo, with u16 inputs in its input records". roslambo's records name an input from outside the state's roster by its 16-byte ID each time, which in warm-up pushes a late-vote repair past 16,000 bytes.
    - *Proposal:* an ID table in STATE's header, each record's inputs indexing the state's terriers and then the table (§5.5), with D-18's largest cases measured in play, in warm-up and at 12 senders a tick.
28. **M3-Q28. A player whose terrier is gone when it comes back** (D-17, L137). A page that rejoins after a stall, or loses a merge, can find its terrier removed.
    - *Proposal:* a page that pressed Play JOINs its pack again, as roslambo's does; a reload, a fresh page, starts on Join, as L137's "join again like anyone else" reads. Any adoption that finds its terrier re-bases the input source's counters from the stored previous input (D-10); a resync doesn't (§4.6).

---

## Revision log

Three reviews of the first draft, one for completeness, one for determinism, timing and feasibility, and one for the port, the protocol and the interfaces, found 42 issues. Each was checked against the sources: roslambo's code, tests and plan, terriest's M2 code and tests, Trystero 0.26.0 as installed, hermet at 11283ca, the plan and REQUIREMENTS. Every one held, at least in part, and the design is revised for each. Two are revised with a fix that differs from the one proposed (feasibility-F11, and part of completeness-M3-PLAY-AGAIN-PROPOSE), and parts of two are rejected (feasibility-F7's decoder rule as proposed, and port-fwd-origin-unbounded's computed forwarder), each for the reason given. Several are one issue seen from two or three sides: the invalidation rules (feasibility-F1, port-invalidation-incomplete); the bare-address check (completeness-M3-LOOPBACK-STRING-CHECK, port-nettest-127-check, feasibility-F10); the spread's floor (completeness-M3-SPREAD-CAP-CHECK, feasibility-F8); the correction events (completeness-M3-CORRECTION-EVENTS, feasibility-F12); the build inputs (feasibility-F9, port-build-inputs-scope); roslambo's tests (completeness-M3-ROSLAMBO-LOOPBACK-TESTS, port-roslambo-accuracy); and the configuration's owners (completeness-M3-CONFIG-LITERALS, port-same-phase-dependencies).

| Finding | Outcome | Note |
|---|---|---|
| completeness-M3-STATE-SIZE | Revised | Confirmed: a non-member's input cost 1 + 16 + 2 + 1 bytes, so in warm-up a record of 8 such inputs is 161 bytes and a repair from 255 ticks back about 43 KB, past the 89 or so records the encoder keeps. §5.5 adds the ID table: each ID once, every input 4 bytes. `sizes.test.ts` builds the warm-up worst case (an empty roster at `g`, 8 joiners with 32-byte names, JOINs every 30 ticks, 269 records), about 11.8 KB, and 12 senders a tick, about 14.8 KB; `consensus.test.ts` adds a warm-up late-vote repair (§8.1). M3-Q27. |
| completeness-M3-ROSLAMBO-LOOPBACK-TESTS | Revised | Confirmed against roslambo's `src/net/network.test.ts`: five tests unmapped and two mapped in part. §8.1 now maps each with its assertions: the proposer leaving, the 300 ms player, the confirmed end and AGAIN, the late joiner and the received inputs in `network.test.ts`; the frozen pages in a new `stalls.test.ts`; the hidden proposer while players join, and the throttled page's roster, Ready, resyncs, jumps and rate, in `hidden.test.ts`; P7's losing side back in their packs. §4.6 states the rejoin policy: a page that pressed Play JOINs its pack again, a reload starts on Join, and `onControl` re-bases the counters after any adoption but not after a resync (M3-Q28). |
| completeness-M3-TUNING-NOT-TUNED | Revised | Confirmed: `dev/tuning/model.test.ts` fails a key in neither list, and neither `simParams` nor `botParams` reads any new key. config owns `dev/tuning/model.ts` in phase 1 and puts all 19 keys in `NOT_TUNED` with their reasons (§1.37, §10, §12); every phase names that file's owner with the other configuration files. |
| completeness-M3-SPREAD-CAP-CHECK | Revised | Confirmed: D-11 and A.4 ask only that M3 check the cap. §10's check is now `cap ≥ w + 1`, and §2.8 and §9.6 say that a cap under 42 also spreads a joiner's catch-up, which neither confirms nor votes while it runs. The same issue as feasibility-F8's second part. |
| completeness-M3-LOOPBACK-STRING-CHECK | Revised | Confirmed: `node_modules/@trystero-p2p/core/dist/peer.mjs`'s `rewriteMdnsCandidatesToLoopback` holds " 127.0.0.1 $2 typ host", live under `ice=local`. The check moves to the build: `scripts/dev-relay-audit.mjs` fails a `dev-relay` chunk and any file naming one or `VITE_TERRIEST` (§1.33, §6.6). The page's relay rule compares a parsed URL's parts, so it adds no URL-shaped loopback string for the audit. With port-nettest-127-check and feasibility-F10. |
| completeness-M3-FIFTH-SPECTATOR | Revised | §4.5: `spectatorsFull`, or a REFUSE 4 from any peer, makes NetGame leave the room after `leaveGraceMs`, its pending bots' JOINs stopped; a browser whose bots are in the roster isn't outside it, so it's never counted and no bot loses its host. `spectators.test.ts` asserts that the fifth's connections close and the room holds 4. |
| completeness-M3-ABANDONED-AFTER-END | Revised | §4.7: `abandoned()` is false once the final state is ended, as D-17's "after the end" and L217 need; `abandoned.test.ts` covers a spectator arriving after the players left, before the end and after it; M3-Q18 says so. |
| completeness-M3-PLAY-AGAIN-PROPOSE | Revised; one part not taken | Confirmed in roslambo's `src/ui/app.ts` (`if (!old.session.againSeen) g.propose(r.settings)`) and its PLAN ("If an AGAIN arrived, the next round already exists, so the browser joins it"). §4.9: a press proposes only if no AGAIN reached it, which `AgainChoice.againSeen` carries into the new room. `again.test.ts` adds a press after AGAIN, which joins without proposing, beside the press after the countdown. M3-Q26. The fix's "and no live peer answers" isn't taken: waiting for an answer would delay every first press, roslambo's rule needs none, and a press that saw AGAIN, in a room whose presser left at once, fails as any join does. |
| completeness-M3-ADMISSION-ROLE | Revised: the broadening kept, and recorded | D-21's text names undecided HELLOs, but counting only role 4 would let any newcomer past the cap by announcing role 3, a claim about itself. §4.3 keeps counting every HELLO from outside the roster and says why: the honest HELLOs from outside it that aren't undecided bring back browsers the mesh already held. M3-Q16 records it, and `again.test.ts`'s Play-again race in a full room of 8 that play and 4 spectators asserts that nobody is refused with REFUSE 4. |
| completeness-M3-E2E-SETUP-SCRIPTS | Revised | §1.12's `src/core/bot/setups.ts` holds the scripts that M2's marks, the page and the loopback checks share, sampled on the timeline's head at sending time (§7.2). `bots-setups.test.ts` replays the spec's exact setup, seed 7 included; `practice.test.ts` checks Practice's setup over the local transport, seed 7 and 10 more, and gives `practice-net.spec.ts` its timeout (§8.1). With feasibility-F5. |
| completeness-M3-VERIFY-SCOPE | Revised | Every loopback test runs one node at `verify: 8`: every 8th advance that moved the clock, and every one that adopted a STATE or stepped a changed base. `replay.test.ts` runs every node at 1 through the merge, forwarding, bot, hidden-page, paced-sender, clock-jump, silent-sender, returning-player and Practice paths (§2.7, §8.1). §13 counts the cost. |
| completeness-M3-CORRECTION-EVENTS | Revised | The draft's §1.7 and §2.10 defined the event two ways. §2.11 now fires on every recomputation of the drawn head's tick, zeros included, as §17's "at every rollback" reads; §9.4 reports the zeros apart, and §9.5 decides on the corrections that moved each body. Reconciled with feasibility-F12, which asked for the other event definition but the same separation. |
| completeness-M3-CONFIG-LITERALS | Revised | Confirmed in roslambo's `timeline.ts` (`now - this.lastRebalance >= 1000`) and `session.ts` (`FLOOD_WINDOW_MS * 0.9`). `clockRebalanceSeconds` joins §10, 19 keys in all; the 0.9 goes, since the connection's age does its job (§4.10, M3-Q8). Every phase now names the configuration files' owner, and a builder that needs a setting it doesn't own marks it for the integration step (§0, §12). |
| completeness-M3-OVERTIME-FAILS-AT-ONCE | Revised | §8.4: the spec polls through `browsers.ts`'s `waitFor`, whose `fail` ends the test as soon as any page reports overtime, printing each page's score and clock. |
| completeness-M3-REAL-NETWORK-STATS | Revised | §1.16's `summary.ts` and `NetGame.summary()` keep each match's late inputs, rollbacks, resyncs and correction p50, p95 and max, from fixed bins, on a real page; M4 shows and copies it, a line §17's M4 entry gains (M3-Q24). |
| feasibility-F1 | Revised | Confirmed: D-11's rule reads `finalTick` and each sender's newest input, and the draft touched the chain neither when `finalTick` passed a silent sender's newest nor for the unrecorded ticks below an old newest. §2.6 touches `t + 1` for each terrier whose newest tick is `t`; §2.2 records a TICK's clear present bit as a mark that predicts the tick absent, as finalisation will (the finding's fix 2); §2.7 touches from `firstUnknown` when the predicted value changes, so a gap the history doesn't reach, where a spread or a warm-up holds `finalTick` back, is covered too (fix 3); `replay.test.ts` adds the paced sender, the clock jump and the silent sender under `verify` (fix 4). With port-invalidation-incomplete. |
| feasibility-F2 | Revised | Confirmed by the arithmetic: at 80 ms one-way a retransmitted message arrives 240–260 ms after it's sent, past the 233 ms `d + w` leaves, so there every loss is a late input and a resync, about 2 a second at a browser with 7 links at 0.5%, and w = 14's margin sits inside the clock's 1-tick deadband. §9.5 now chooses d and the glide at the loss-free profiles from non-repair corrections, tagged by `Correction.repair`; w's rule decides at the loss-free profiles and the 30 ms lossy ones; the loss rate is swept at 0, 0.1% and 0.5%; the lossy 80 and 150 ms profiles report the cost, and phase 6 takes the reach (about 71, 82 and 93 ms one-way at w = 12, 14 and 16) to the owner as a C-row, the unordered channel among the options (§15, M3-Q6, M3-Q13); a change of w runs rules 1 and 2 again. R-13 is restated. |
| feasibility-F3 | Revised | Confirmed: the draft's `votesFor` excluded a repairing browser, so its re-finalisation left its stale votes in the book, unlike roslambo's `store`, and a browser waiting for its repair still served its losing history, so two voters could swap states. §3.1 books the own vote at every store whatever `repairing` says, and sends one only when not repairing; §3.4 answers no STATE_REQ while a resync is outstanding, answers `(t, want)` only for a held final tick with that hash, and drops the history after an adopted `g`. §3.6 explains the two-voter case; `consensus.test.ts` adds 1 a side at 30 and 80 ms with seeds against it, and a three-way split. R-16. |
| feasibility-F4 | Revised | Confirmed in Trystero's `room.mjs`, `shared-peer.mjs` and `actions.mjs`, and in roslambo's specs, whose reload runs in Chromium only. §8.4: the reload is built first in a short three-engine test run ten times with `--repeat-each=10`, then folded into the match; the spectator and the reload trigger from logical state; the action handler is wrapped (§6.3); the reloading page leaves on `pagehide`; `Session.duplicates` reports C-12's verdicts with the old connection's silence and leave time. R-5. |
| feasibility-F5 | Revised | Confirmed in `brain.ts` (`perceive`'s ring indexed by `m.seen`) and `marks.ts` (one think a tick, for the next). §1.12 keys the view by tick, identical for M2's one call a tick, which phase 2's integration checks by running the marks unchanged; §1.11's sampler thinks once per head tick; the page's `ready` is a tick; `bots-setups.test.ts` replays the spec's exact setup with the reload's absence swept, and 10 more seeds with shifted starts. R-7, R-19, M3-Q25. |
| feasibility-F6 | Revised | Confirmed: roslambo's `setInput` drops only `t ≤ finalTick`, stale on a hidden page. §2.8's late boundary is `max(finalTick, ⌊clock(now)⌋ − w)` outside a warm-up; `hidden.test.ts` adds an input that arrives late everywhere while a page paced at 1,000 ms sleeps. R-8. |
| feasibility-F7 | Revised in part; the decoder rule rejected as proposed | As proposed, the rule would refuse honest TICKs: events ride until their tick is final at the sender, which a warm-up hold (up to 30 ticks) or a spread keeps further back than the 16-tick history. §5.3 makes an event invalid at `back` 0 without an own input and at `back` 1–16 where the present bit is clear, and valid beyond. §2.5 takes the own input, then the history, then the events (the fix's order), and an event with no record makes one of input 0 by events alone, which the input completes when it comes, so the result doesn't depend on arrival order. `fuzz.test.ts` and `inputs.test.ts` cover both. |
| feasibility-F8 | Revised | §9.6 repeats the forced repair 20 times with a garbage collection before each, decides on the median of the runs' worst spread advance and reports the maximum beside it; §10's floor is `w + 1` only. With completeness-M3-SPREAD-CAP-CHECK. M3-Q14. |
| feasibility-F9 | Revised | `buildInputs` covers the agreeing `src/core` sources from phase 2, not as a question for the settle (§1.31); M3-Q3 records the choice. With port-build-inputs-scope. |
| feasibility-F10 | Revised | Confirmed: Vite folds `import.meta.env.VITE_*` at build time, the dev relay's URL is built at run time, and Vite's HMR client opens a `ws://` socket that the guard's prefix match reports. The dev relay's absence is checked on `dist/` by `scripts/dev-relay-audit.mjs` (§1.33), and the provisional settle's guard allows the dev server's `ws://` origin (§15, M3-Q4). With completeness-M3-LOOPBACK-STRING-CHECK. |
| feasibility-F11 | Revised, with a different test of who ran on | Confirmed in roslambo's `session.ts`: `rejoin` on any live peer, `live` never cleared, and `onStateReq` silent without a timeline. §4.12 pauses and decides for up to `stateRequestRetryMs`, rejoins only from a peer that sent a TICK for a tick past `localTick + d + w`, keeps the old timeline until a STATE is adopted, and otherwise re-anchors. The proposed "a TICK since this page's stall ended" would count a TICK still in flight when a whole machine paused; a tick past the late window can only come from a clock that ran on. `stalls.test.ts` freezes every node together, and leaves one running. M3-Q9, R-6. |
| feasibility-F12 | Revised | §9.4 and §9.5: the zero samples reported apart and the rules decided on the bodies that moved; rule 2 names the ball's 3D change and adds a heading clause, half the turn rate (1 turn a second), as the position clause is half the run speed; each p95 that rules 1 and 2 compare has a bootstrap 90% interval, a marginal fall keeps d at 2, and the glide takes each p95 at its interval's upper end. The event's definition is completeness-M3-CORRECTION-EVENTS's: every recomputation fires, since §17 says "at every rollback", and the consumer measures it. |
| port-wire-bom-divergence | Revised | Confirmed in Node (§0's header) and in roslambo's `bytes.ts`. §1.1 decodes with `{ fatal: true, ignoreBOM: true }`, as the codec does, and §5.7 says why; `messages.test.ts` and `fuzz.test.ts` add names that start with U+FEFF, and `timeline.test.ts` checks a sender's own JOIN of one against a receiver's hash (§5.8). |
| port-local-ids-forgeable | Revised | Confirmed: roslambo's one guard was `if (origin === this.cfg.me) return` in `Timeline.onTick`, and the draft's restatement lost it. §4.10 drops TICK and FWD data about this browser or its bots, and FWDs whose origin is a bot; §4.3 refuses a HELLO under a bot's ID with REFUSE 3; §1.3's own records replace whatever is stored. `misbehaving.test.ts` adds the three forgeries. R-18. |
| port-fwd-origin-unbounded | Revised in part; the computed-forwarder rule rejected | §4.10 takes a FWD only from a connection whose latest PEERS lists the origin, caps PEERS at 11 distinct IDs (§5.4), takes clock samples from direct TICKs only, and counts floods per forwarder and origin, never adding FWDs to the forwarder's own TICKs. The stronger variant, a FWD only from the forwarder this browser computes, is rejected: it needs this browser's view of every neighbour's PEERS to match the forwarder's at each moment, and while a PEERS is in flight it would drop honest FWDs and make the inputs they carry late. The listed-origin rule bounds a peer to the browsers it claims, which the honour system covers (L203). `misbehaving.test.ts` covers each case. |
| port-invalidation-incomplete | Revised | feasibility-F1's issue from the port's side: (a) and (b) are fixed by §2.6's touch and by §2.2's marks with §2.7's `firstUnknown`; (c) by comparing the whole `TickInput`, payload included, in §2.7's held-input exception. `replay.test.ts` adds the silent sender, and the sender paced at 100 ms then 4 ms with its inputs changing, under `verify`. |
| port-admission-race | Revised | Confirmed in roslambo's `loopback.ts` (both checks and both joins in one event) and Trystero's `handshake.mjs` (`onPeerJoin` only after both sides' readiness). `checkHello` takes the peer ID and reserves an admission's place until `onPeerJoin`, `onHandshakeFailed` (from a handshake that fails inside `onPeerHandshake`, or Trystero's `onJoinError`) or `handshakeTimeoutMs` (§1.8, §4.3, §6.3); the loopback's handshake runs in two rounds over each link's latency (§6.2), so `spectators.test.ts`'s simultaneous arrivals can fail. R-17. |
| port-nettest-127-check | Revised | completeness-M3-LOOPBACK-STRING-CHECK's issue: the dev-relay audit checks for the chunk and its import, not a bare address (§1.33). |
| port-c12-silence-overlap | Revised | Confirmed: keepers, undecided peers and spectators send only PEERS every 5 s, Trystero's pings never reach `onMessage`, and roslambo's `onPeerLeave` cleared `peersOf` whatever `byPlayer` said. §4.4 takes liveness from any message or pong, pings every 1 s under PLAN §7.4's check against the 2 s silence, and clears player-keyed state on a leave only while the player still maps to that connection; the loopback pings (§6.2). `spectators.test.ts` adds a live spectator's duplicate refused and a replacement surviving its old connection's late leave. M3-Q23. |
| port-state-req-unlimited | Revised | §3.4 and §4.10: one answer per connection per `resyncRetryMs`, the rest counted as invalid; and no answer at all for a tick not held with the wanted hash, where roslambo sent its newest final state, which the asker always rejects. `misbehaving.test.ts` adds repeated requests. |
| port-ring-windows-unspecified | Revised | Confirmed in roslambo's `vote()` and `slot()`. §2.12 bounds what the stores keep and makes them rings that reuse only retired slots, refusing a write that would evict a needed tick (§1.3, §1.5); §5.5 bounds a STATE's `g`, `senderFinal`, `senderTick` and record count, which its hash doesn't cover. `fuzz.test.ts` and `inputs.test.ts` cover both. |
| port-build-inputs-scope | Revised | `buildInputs` hashes every `src/core` source but its tests and `brain.ts`, `marks.ts` and `setups.ts`, whose outputs are inputs like a person's; `build-inputs.test.mjs` edits `bot-id.ts` and a session file too (§1.31, M3-Q3). With feasibility-F9. |
| port-lint-gaps | Revised | Confirmed in `eslint.config.mjs`'s `BROWSER_DIRS` and `TRYSTERO` patterns. net-layer owns the lint and its test in phase 2 (§12): `src/core` imports nothing outside it but `src/config.ts`, and `src/net/trystero.ts` is never imported statically, its `import()` allowed in `src/ui/game.ts` alone, each rule with a fixture (§1.36). |
| port-nettest-relay-production | Revised | §6.7: a production build of the page takes only `third-party.json`'s signalling URLs or a loopback `ws:` URL, and otherwise says so and contacts nothing. `nettest-params.test.ts` and `nettest.spec.ts` check that a foreign `wss:` relay is refused. |
| port-same-phase-dependencies | Revised | The phases are recut so that no builder imports a file its phase is writing (§0, §12): `BotHost` moves to phase 2 behind its own `BotTimeline`; the scoreboard, the summary and `src/ui/clock.ts` with its test clock to phase 3; the glue, `nettest-params.ts` (`NetParams`, `NetReport`) and `browsers.ts` to phase 4; the page and the harness to phase 5; the settle to phase 6. Every phase names the configuration files' owner. NetGame's counting link gives `NetReport` and the load run their traffic by type (§1.24, §8.5). |
| port-head-contract | Revised | §2.8: `head` and `prevHead` are never `F` and never written again, and move only when the recomputed chain reaches the head's tick, so a spread never moves them back and a reused final never takes their objects. §1.11: a bot thinks once per head tick, so a catch-up's ticks and a held head neither press twice nor shorten its reaction, with §1.12's tick-keyed view. `spread.test.ts` and `bots.test.ts` check both. |
| port-roslambo-accuracy | Revised | Confirmed: roslambo's `Reader.bytes` already checks the length before it copies, and its `Timeline.onTick` drops `origin === me`. §1.1 and M3-Q10 are corrected, and the missing tests are ported with their assertions (completeness-M3-ROSLAMBO-LOOPBACK-TESTS). |

**Also corrected while revising:** §6.6 and §11 said the dist audit "starts using" `ignoredHosts: ['stun']` at M3; `scripts/audit-dist.mjs` has passed it since M1, its comment naming M3's Trystero bundle.
