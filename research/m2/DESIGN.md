# M2 design: simulation core, tuning and the bot brain

**Kept in the repo** at M2's review, as the builders built from it, so that the plan's, research/tuning/REPORT.md's and the code's citations of "design §…" and "M2's design" can be followed. The text below is unchanged. Where the build differs from it, PLAN's M2 amendments say so and win: §17's M2 entry lists them. Its §14 numbers its questions apart from PLAN's, so design §14's Q-1 is not PLAN's Q-1. bots-F1 and bots-F4, which comments cite, are findings of M2's review of phase 3: PLAN §16's restated fall-back mark and D-5's slip release record them.
**For:** PLAN.md §17, "M2 — Simulation core, tuning and the bot brain", on the branch `m2-simulation-core`.
**Written:** 2026-11-17, by M2's architect, for the builders who implement it, and revised the same day after two reviews, one for completeness and one for determinism and interfaces (the Revision log, at the end, gives each finding's outcome). Design only: nothing here is in the repo yet.
**Read for it:** PLAN.md in full (§6, §7, D-1 to D-16, D-23, D-27, D-38, D-39, §14, §16, §17, Appendix A, the C-rows); REQUIREMENTS.md's gameplay sections and Configuration table; the M0 spike's `src/sim/**`, its tests, `determinism.ts`, `e2e/determinism.spec.ts` and REPORT.md §4–§8; roslambo's `src/core/sim/**`, `src/core/bot/**`, `src/core/names.ts`, `src/core/timeline/timeline.ts`, `dev/tuning.*`, `dev/vitest.config.ts`, `src/main.ts`, `src/determinism.ts`, `e2e/determinism.spec.ts` and the PLAN rows terriest cites; terriest's M1 code (`src/config.ts`, `src/config.test.ts`, `src/core/sim/pitch.ts`, `eslint.config.mjs`, `scripts/eslint/config.test.mjs`, `CLAUDE.md`, `src/main.ts`, `src/render/**`, `public/boot.js`, `e2e/lib/*`, `playwright.config.ts`, `vitest.config.ts`, `tsconfig.json`).
**Measured for it,** in Node 22.23.4 on the development machine, from scratch scripts outside the repo that import the spike's simulation:
- a step costs 5.4–6.8 µs at 1 a side, 8.6–12.2 at 2, 11.5–12.4 at 3 and 15.8–19.8 at 4 in seeded open play (2.0–5.3 contacts a substep); REPORT.md §5.3 has the scrum, 27.8–31.2 µs a step in Node;
- the spike's golden suite, 37 scripts and 89,000 ticks, replays in 1.6 s; its 400-tick canary (the corner scrum) takes 12.8 ms; `cloneState` at 4 a side takes 0.94 µs;
- a shot into the goal's netting at A.5's 0.3 comes back onto the pitch during the celebration: a 5 m/s rolling shot ends with its centre at x = 19.33, in front of the goal line, a 5 m/s high shot at 16.84 and a 10 m/s high shot at 11.51; only 0 keeps every shot wholly behind the line (§9.6);
- a run-speed dribble from contact across the pitch counts one touch at a 0.6 m re-arm gap, and at 0.3.

How to read it: §0 is the rules every builder follows. §1–§10 answer the brief's items in order. §11 is the build order, with each builder's files. §12–§14 are the gate's cost, the risks and the questions for the plan. The Revision log closes it.

---

## 0. Rules every builder follows

- **Paths are §6's.** The simulation is `src/core/sim/`, the bots `src/core/bot/`, the page's test route `src/main.ts` and `src/determinism.ts`, the tuning page `dev/`. CLAUDE.md: the lint and, from M2, the golden files depend on them.
- **Exact operations** in `src/core/sim/**` and `src/core/bot/**`, tests aside (D-1, D-38, D-39): `+ − × ÷ %`, comparisons, bit operations, `Math.sqrt/abs/min/max/floor/ceil/round/trunc/fround/imul/clz32`, `Math.PI`. `Math` only as `Math.<name>`. No `**`, `Math.hypot`, `Math.sign`, `Math.atan2`, `Math.random`, `Date`, `performance`, `crypto`, `Intl`, `toLocale…` or `localeCompare`. The lint enforces this in shipped files, `scenes.ts` among them, and in the test support files there (`testing.ts`, `cases.ts`, `match-testing.ts`, `marks.ts`), which aren't `*.test.*`.
- **Arrays only** (§7.3, R-2). No `Map`, `Set`, `WeakMap` or `WeakSet` in `src/core/sim` or `src/core/bot`, outside their tests. A `Map` or `Set` iterates in insertion order, which can follow arrival order, and a per-object cache survives from one call to the next. With at most 9 bodies and about 12 inputs, a linear scan, or a binary search of an ID-sorted array, is as fast. The lint bans constructing them there (§1.24).
- **No setting copies** (§7.4, CLAUDE.md). Every number that a setting gives is read from `SimParams` or `BotParams`, which are built from `src/config.ts`. A code constant (a bit, phase, kind, version, polynomial coefficient, a scene's coordinate) carries `// not a setting: <what it is>` on its line. `src/config.test.ts`'s scan is the referee. In `src/core/sim` and `src/core/bot` it flags any non-whole literal (0.5 aside) equal to a setting or derived value, and any top-level constant equal to one, whole numbers included. It can't see a whole number inside a function, so there the rule holds by review: the bark gap is `BotParams.barkGapTicks`, never a local 60. Run it early: `npx vitest run src/config.test.ts`.
- **`step` depends only on its state and inputs.** The `Sim` object holds scratch arrays, reused so that `step` allocates nothing in its loop, but nothing it holds survives from one call to the next: `step` binds its slots from the state at the start of every call, and every scratch entry is written before it's read (§3). So one `Sim` can step any states in any order, as M3's timeline steps the final state and its predicted clones through one (D-11).
- **Index bodies by slot.** A terrier's slot is 2 × spot + pack, and the ball's is 2 × pack size. Code reads bodies through `sim.bodies`, `sim.terriers` and `slotOf`, never by list position. List index equals slot only while both packs are full, which a real match has from the start countdown on. Warm-up has holes, and so do the marks' test states (§2.3).
- **Plain data.** `MatchState` holds plain objects and arrays, with no classes, getters or methods, so `cloneState` copies it and the codec reads it.
- **Tests.** Use vitest, with fast-check for properties. The worker pool runs test *files* in parallel (vitest 4.1.12, about one worker per core: 11 here and 3 on CI), and a file's tests one after another, so long loops go in files of their own (§12). Long files set `vi.setConfig({ testTimeout: 120_000 })`, as the spike's did.
- **File ownership.** A builder edits only the files §11 gives it. In each phase, PLAN.md, REQUIREMENTS.md, CLAUDE.md, `src/config.ts`, `src/config.test.ts` and `eslint.config.mjs` each have one named owner. REQUIREMENTS.md is the owner's: no builder edits it, and the settle phase changes only values the owner has signed off (Q-10, §2's waiting row).
- **The spike is read, never imported** (D-36, CLAUDE.md). Nothing in the repo outside `research/spike/` imports it. M2 compares with it twice, for the bit pins (§4.1) and for the step's cost (§11), through a scratch script outside the repo, as this design's own measurements were made. It runs under Node's type stripping, with a resolve hook that adds `.ts` to the port's extensionless imports, so both simulations run in one process under one transform. Its outputs are pinned in tests or reported in the commit.
- **Goldens are emitted only at the integration steps §11 names,** with `TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens`, and the commit says so (CLAUDE.md).
- **Parallel builders share one checkout.** Each keeps its files compiling as it goes, runs its own tests, `npx eslint <its files>` and `npx tsc --noEmit`, and stages only its own files. The full gate runs at the phase's integration step, after all of the phase's builders are done (§11).

---

## 1. Module map

For each file: its purpose, exports (TypeScript signatures for everything another module calls), what it ports from and what changes, and the plan items. Owners are §11's builder names: **core-types**, **physics-port**, **rules**, **goldens**, **bot-brain**, **tuning-page**, **push-remedy** and **settle**.

### 1.1 `src/core/sim/math.ts`: new (core-types)

- **Purpose:** binary angles and exact trigonometry; roslambo's integer mixer, for seeded scripts and bot noise.
- **Exports:**
  ```ts
  export const TURN = 4294967296;        // not a setting: 2^32 binary-angle units a turn
  export const HALF_TURN = 2147483648;   // not a setting
  export const QUARTER_TURN = 1073741824; // not a setting
  /** out[0] = cos, out[1] = sin of a binary angle; exact operations (roslambo). */
  export function dir(angle: number, out: Float64Array): void;
  /** k/n of a turn: floor(k · 2^32 / n) >>> 0. */
  export function fractionOfTurn(k: number, n: number): number;
  /** Math.atan2(y, x) as a u32 binary angle; datan2(−y, −x) === (datan2(y, x) + 2^31) >>> 0 for every input. */
  export function datan2(y: number, x: number): number;
  /** b − a, in [−2^31, 2^31). */
  export function angleDiff(a: number, b: number): number;
  /** roslambo's scripts.ts mixer: a u32 from two integers. */
  export function mix(a: number, b: number): number;
  ```
- **Ports:** `research/spike/src/sim/angle.ts`, unchanged: roslambo's `dir` and `fractionOfTurn`, M0's `datan2` with its 15 Chebyshev coefficients. `mix` comes from the spike's `scripts.ts`.
- **Changes:** the file name is §6's ("math"). Each top-level numeric constant the scan would flag carries `not a setting`. The Taylor coefficient `C2 = -1 / 2` is one, since 0.5 is a setting's value.
- **Implements:** D-1, D-2 (with M0's 0.51-unit tolerance), and D-39's angles for the brain.
- **Tests (`math.test.ts`):**
  - the spike's `angle.test.ts`, with the bound at 0.51 units;
  - dir() of a half turn more is the exact negation;
  - exact axes, signed zeros and diagonals;
  - point symmetry on 300,000 vectors.

### 1.2 `src/core/sim/hash.ts`: new (core-types)

- **Purpose:** the vote and golden hash (A.1, D-13).
- **Exports:** `hash64(bytes: Uint8Array, len?: number): string` (16 lower-case hex digits), `hashToBytes(hash: string, out: Uint8Array, offset: number): void`, `bytesToHash(bytes: Uint8Array, offset: number): string`.
- **Ports:** roslambo's `src/core/sim/hash.ts`, by way of the spike's copy, unchanged: MurmurHash3 x86-32 with seeds 0 and 0x9747B28C.

### 1.3 `src/core/sim/input.ts`: new (core-types)

- **Purpose:** A.2's u16 input, and the per-tick input the simulation takes, with its roster events (D-10, D-12).
- **Exports:**
  ```ts
  // A.2's bits; each line marked `not a setting`.
  export const STEP_MASK = 0x1f, HELD = 0x20, FRAME_SHIFT = 6, ZOOMIES = 0x100;
  export const JUMP_SHIFT = 9, POUNCE_SHIFT = 11, BARK_SHIFT = 13;
  export const FRAME_PITCH = 0, FRAME_BALL = 1, FRAME_NOSE = 2;
  export const STEP_UNITS = 134217728;   // 2^27: one of A.2's 32 steps
  export const KEPT_BITS = 0x1fff;       // bits 0–12: what the state keeps of an input
  export interface InputParts { step?: number; frame?: number; zoomies?: boolean; jump?: number; pounce?: number; bark?: number }
  export function encodeInput(p: InputParts): number;
  export function frameOf(input: number): number;
  export function heldDirection(input: number): boolean;   // bit 5 set and frame ≠ 3
  export function stepOf(input: number): number;
  export function jumpCount(input: number): number;
  export function pounceCount(input: number): number;
  export function barkCount(input: number): number;        // M3 and M4 read it; the simulation never does
  /** A mirrored terrier's input (P8): a held pitch-frame step + 16; ball and nose frames unchanged. */
  export function mirrorInput(input: number): number;

  // Roster events (D-12), as bits; each line marked `not a setting`.
  export const JOIN = 1, LEAVE = 2, READY = 4, UNREADY = 8, SWITCH = 16;
  /** One browser's or bot's final (or predicted) input for one tick. Absent: not in the list. */
  export interface TickInput {
    readonly id: string;           // a player ID, 32 lower-case hex digits; a bot's is version 8 (D-39)
    readonly input: number;        // A.2's u16, masked to 16 bits when read; every value is valid
    readonly events: number;       // JOIN | LEAVE | READY | UNREADY | SWITCH
    readonly joinPack?: number;    // JOIN's pack byte; only 0 and 1 are valid
    readonly coat?: number;        // JOIN's coat byte; outside the list reads as coat 0
    readonly name?: string;        // JOIN's display name
    readonly switchPack?: number;  // SWITCH's pack byte; only 0 and 1 are valid
  }
  export function isPlayerId(id: string): boolean;
  /** The valid inputs, one per ID, in ID order, written into out, whose length it sets, so nothing
   *  from an earlier call stays. A duplicated ID keeps the copy whose content sorts first, field by
   *  field in the order above, so the result never depends on the order the inputs arrived in (P4). */
  export function canonicalInputs(inputs: readonly TickInput[], out?: TickInput[]): TickInput[];
  /** Whether two lists canonicalise equal, field by field: M3's "the inputs it would now use differ" (D-11). */
  export function sameInputs(a: readonly TickInput[], b: readonly TickInput[]): boolean;
  ```
- **Ports:** the spike's `input.ts`, and the shape of roslambo's `PlayerInput` from `rules.ts`.
- **Changes:**
  - roslambo's `buttons` becomes A.2's `input`;
  - JOIN gains `joinPack` and `coat`, and SWITCH, which is new, has `switchPack`. They're separate fields, as §9's events carry separate payloads. D-12 re-sends a JOIN until the state shows it, so a player who switches packs before then sends a JOIN and a SWITCH in one tick, each with its own pack (§6.1);
  - `canonicalInputs` breaks a tie between two copies of an ID by their content, not by arrival. roslambo's `canonical()` kept the first to arrive.
- **Implements:** A.2, D-7 (the frames), D-10, D-12, P4.
- **Tests (`input.test.ts`):**
  - encode and decode round-trip;
  - every u16 parses, and bits 13–15 change nothing the simulation reads;
  - `mirrorInput` turns a held pitch-frame step by 16 and leaves the other frames alone;
  - `canonicalInputs` is order-independent under shuffles and duplicates, drops bad IDs, doesn't mutate its input, and leaves `out` exactly as long as its result after a longer call;
  - a JOIN and a SWITCH in one input keep both packs.

### 1.4 `src/core/sim/state.ts`: new (core-types)

- **Purpose:** the canonical state (A.1, §7.1, D-9), genesis, cloning, roster helpers and the name rule.
- **Exports:** the types and constants of §2, plus:
  ```ts
  export function genesis(settings: MatchSettings, P?: SimParams): MatchState;  // throws on a pack size or length outside the configuration
  export function newTerrier(id: string, name: string, pack: Pack, coat: number, tick: number, P: SimParams): Terrier;
  export function cloneState(s: MatchState): MatchState;    // deep: ball, score, every terrier
  export function slotOf(t: Readonly<Terrier>): number;     // 2 · spot + pack
  export function ballSlot(packSize: number): number;       // 2 · packSize
  export function findTerrier(s: Readonly<MatchState>, id: string): number;  // list index, or −1
  export function packCount(s: Readonly<MatchState>, pack: Pack): number;
  export function sortTerriers(s: MatchState): void;        // (spot, pack) order
  /** A UTF-16 code unit a display name may not hold: C0 (U+0000–U+001F), DEL (U+007F) and C1 (U+0080–U+009F). */
  export function isNameControl(codeUnit: number): boolean;
  /** At most nameMaxChars code points and nameMaxBytes UTF-8 bytes, no isNameControl unit and no lone surrogate (C-17). */
  export function nameAllowed(name: string, P: SimParams): boolean;
  /** A JOIN's name if nameAllowed, else ''. */
  export function cleanName(name: string | undefined, P: SimParams): string;
  ```
- **Ports:** the spike's `state.ts` (`newTerrier`, `cloneState`), roslambo's `state.ts` (`genesis`) and `rules.ts` (`cleanName`).
- **Changes:**
  - the roster fields arrive (id, name, join tick, Ready);
  - the spike's per-tick intents (`driveOn`, `targetVx`, `targetVy`, `zooming`) leave the state for the `Sim`'s scratch (§2.3);
  - the clock and overtime arrive; `slipFrom` is a body slot (§2.3); the ball keeps its hit's velocity change (§2.3);
  - the name rule names its set. roslambo has two: its simulation rejects C0 and DEL (`/[\u0000-\u001f\u007f]/`), and its UI's `fitName` strips C1 too (`/[\u0000-\u001f\u007f-\u009f]/`). Here one predicate covers C0, DEL and C1, plus lone surrogates, which `TextEncoder` would write as U+FFFD, so a decoded name would differ from the joined one. M4's `src/core/names.ts` strips by `isNameControl` and drops lone surrogates before it fits a name to the limits, so `cleanName` never drops a fitted name.
- **Implements:** A.1, §7.1, D-9, D-25 (IDs as 32 hex digits), C-17.

### 1.5 `src/core/sim/params.ts`: new (core-types)

- **Purpose:** the configuration in the simulation's units, built once per configuration, so the tuning page and tests can pass a changed copy (Q-10) and no file in the simulation copies a setting.
- **Exports:**
  ```ts
  export interface SimParams {
    readonly config: Config;  readonly derived: Derived;  readonly pitch: Pitch;
    readonly substeps: number;            // 4 (D-3)
    readonly dt: number;                  // derived.substepSeconds, 1/240
    readonly tickSeconds: number;
    readonly gravityDt: number;           // g · dt
    readonly driveCapDt: number;          // acceleration · dt
    readonly idleFrictionDt: number;
    readonly rollingSlowdownDt: number;
    readonly ballRadius: number;  readonly ballInvMass: number;
    readonly terrierRadius: number;  readonly terrierInvMass: number;
    readonly runSpeed: number;  readonly zoomiesSpeed: number;  readonly noseReverse: number;
    readonly pounceSpeed: number;  readonly jumpSpeed: number;          // derived
    readonly turnPerTick: number;         // fractionOfTurn(turn rate, ticks a second), an integer
    readonly noseTurnPerTick: number;     // TURN · nose rate / ticks a second, not rounded (D-7)
    readonly overheadEnter2: number;  readonly overheadLeave2: number;  // squared horizontal centre distances
    readonly restitutionThreshold: number;
    readonly ballSurface: number;  readonly ballGoalNet: number;  readonly terrierBall: number;  readonly terrierRestitution: number;
    readonly iterations: number;  readonly positionPasses: number;  readonly floorInSolve: boolean;
    readonly slipCos: number;             // dir(fractionOfTurn(cone°, 360))[0], cos 42°
    readonly slipSpeed: number;
    readonly bowlingSpeed: number;  readonly rearmGap: number;
    readonly lungeTicks: number;  readonly pounceWaitTicks: number;  readonly tumbleTicks: number;
    readonly getUpTicks: number;  readonly guardTicks: number;
    readonly meterFull: number;  readonly meterDrain: number;  readonly meterRefill: number;
    readonly sitAfterTicks: number;  readonly removeAfterTicks: number;  readonly readyExpiryTicks: number;
    readonly startCountdownTicks: number;  readonly kickoffCountdownTicks: number;  readonly celebrationTicks: number;
    readonly ticksPerMinute: number;
    readonly kickoffSpots: readonly [SpotTable, SpotTable];
    readonly arrivalStep: number;         // D-8's 1 m (§10)
    readonly gaitUnitsPerMetre: number;   // TURN / gait cycle (§10)
    readonly runningMinSpeed: number;     // 0.2 m/s (§10)
    readonly coatCount: number;  readonly nameMaxChars: number;  readonly nameMaxBytes: number;
    readonly packSizeMin: number;  readonly packSizeMax: number;
    readonly matchMinutesMin: number;  readonly matchMinutesMax: number;
    readonly pushAssistCap: number;       // 0: off, and the rule is skipped (§4.4); added in phase 1
  }
  export function simParams(c?: Config): SimParams;   // throws as derive() does
  export const defaultParams: SimParams;              // simParams(config)
  ```
- **Ports:** the spike's `SimConfig` defaults (`config.ts`) and roslambo's `makeParams`. Each value is computed with the spike's own expression, so its bits are the same:
  - `dt = 1 / (60 · 4)`, as M1's `derive`;
  - `gravityDt = gravity · dt`, and likewise the drive's cap, idle friction and the rolling slowdown, as the spike's `C.gravity * dt`. Never `gravity / 240`: 9.8 / 240 is one ulp from 9.8 × (1/240);
  - `overheadEnter2 = 0.3 · 0.3` and `overheadLeave2 = 0.4 · 0.4` from the settings, as the spike's. 0.4 × 0.4 is 0.16000000000000003, not 0.16;
  - `turnPerTick = fractionOfTurn(2, 60)`, `noseTurnPerTick = 4294967296 · 1 / 60`;
  - the slip cone's cosine is `dir(fractionOfTurn(42, 360))[0]`;
  - the jump speed is `derive`'s `Math.sqrt(2 · 9.8 · 1)`.
- **Changes:** the spike's test switches (`drive`, `friction`, `rolling`) go away, and tests pass zeros instead: acceleration 0, idle friction 0, rolling slowdown 0. That gives the same bits (§4.1). The slip-out rule is the chosen one alone, so no rule table.
- **Implements:** §7.4's "every setting in `src/config.ts`", Q-10's "sliders for every setting", D-3, D-5, D-6, D-7.
- **Tests (`params.test.ts`):** M0's values come out bit for bit, each pinned with the spike's own expression, never with a rounded literal:
  - `dt` is `1 / (60 * 4)`, `turnPerTick` `fractionOfTurn(2, 60)` (143165576), `noseTurnPerTick` `4294967296 / 60`;
  - `gravityDt` is `9.8 * (1 / 240)`, `driveCapDt` `15 * (1 / 240)`, `idleFrictionDt` `8 * (1 / 240)`, `rollingSlowdownDt` `0.5 * (1 / 240)`;
  - `overheadEnter2` is `0.3 * 0.3` and `overheadLeave2` `0.4 * 0.4`;
  - `slipCos` is `dir(fractionOfTurn(42, 360))[0]`, and within 1e-15 of cos 42°; `jumpSpeed` is `Math.sqrt(2 * 9.8 * 1)`;
  - the celebration is 204 ticks;
  - a planted configuration changes only what it should;
  - an invalid one throws.

### 1.6 `src/core/sim/codec.ts` and `src/core/sim/valid.ts`: new (core-types; rules owns `valid.ts` from phase 3)

- **Purpose:** the canonical bytes (A.1): the hash input, M3's STATE payload; and the validity check that the decoder and the property tests use.
- **Exports:**
  ```ts
  // codec.ts
  export const CODEC_VERSION = 1;   // not a setting
  /** A copy. Throws on a float that isn't finite (NaN, ±Infinity) or a field out of its type (D-1),
   *  so every state it encodes also decodes. */
  export function encodeState(s: Readonly<MatchState>): Uint8Array;
  export function hashState(s: Readonly<MatchState>): string;           // hash64 over a shared buffer: no allocation
  /** Total: malformed, inconsistent or trailing bytes give null, never an exception (§9's decoders).
   *  Applies stateProblems. */
  export function decodeState(bytes: Uint8Array, P?: SimParams): MatchState | null;

  // valid.ts
  /** What makes a state invalid (§6.7's invariants); [] for a valid one. */
  export function stateProblems(s: Readonly<MatchState>, P?: SimParams): string[];
  ```
- **Ports:** the spike's `codec.ts` for the encoder and its shared buffer, and roslambo's `codec.ts` for decoding, its ID and name handling and its strict UTF-8 decoder.
- **Changes:** A.1 as fixed in §2.2: the roster's fields, the clock, the ball's hit Δv, no intents. Names are written with `TextEncoder.encodeInto` into the shared buffer, so hashing allocates nothing.
- **Who writes `valid.ts`:** core-types writes its structural checks in phase 1, and rules owns the file in phase 3, when it adds the checks the rules imply (§6.7 marks which). The validity rules live apart from the codec so that their phase-3 owner never edits a phase-1 file it doesn't own.
- **Implements:** A.1, D-1 (non-finite floats asserted), D-13, D-20 (decoders that never throw).
- **Tests (`codec.test.ts`):**
  - fast-check states round-trip byte for byte, −0 included;
  - NaN, +Infinity and −Infinity each refuse to encode, in a body, the ball's hit strength and its Δv;
  - `decodeState` never throws on random bytes, truncations or bit flips;
  - it rejects each invalid field (version, phase, pack size, pack, spot order, duplicate ID, coat, flags, slot, a slipping flag without a slot, timers, a non-finite float, trailing bytes);
  - different states hash differently.

### 1.7 `src/core/sim/pitch.ts`: changed (physics-port)

- **Purpose:** M1's pieces, plus M0's closest-point tests.
- **Adds:**
  ```ts
  export interface PieceHit { nx: number; ny: number; nz: number; depth: number }
  /** The sphere (c, r) against a piece: the normal from the piece toward the body, and the overlap (≥ 0). One-sided faces. */
  export function pieceContact(p: Piece, cx: number, cy: number, cz: number, r: number, out: PieceHit): boolean;
  /** Whether a centre is in the space the pieces enclose, with tol of slack (§16's fuzz). */
  export function insideRegion(shape: PitchShape, x: number, y: number, z: number, tol: number): boolean;
  export function deepestOverlap(pitch: Pitch, x: number, y: number, z: number, r: number): { depth: number; piece: string };
  ```
- **Ports:** the spike's `pitch.ts` (`pieceContact`, `toward`, `insideRegion`, `deepestOverlap`), adapted to M1's `PitchShape` names (`lengthMetres`, `cornerCutsMetres`, …).
- **Unchanged:** M1's exports, which `src/render/**` and `src/config.test.ts` import.
- **Tests (`pitch.test.ts`):** the spike's closest-point cases: a wall's face, behind a face, a post, the top netting, a quad's edge.

### 1.8 `src/core/sim/physics.ts`: new (physics-port)

- **Purpose:** D-5's solver, steps 1–7, over body *slots*.
- **Exports:**
  ```ts
  /** Counters for tests, the goldens and the metrics. Step writes them and never reads them. */
  export interface SolverStats {
    substeps: number; contacts: number; floorContacts: number; maxContacts: number; slipOuts: number;
    floorBounces: number;   // substeps in which support() bounced the ball off the floor
    pieceBounces: number;   // ball–piece contacts other than the floor, closing above the threshold (prepare)
    pushes: number;         // substeps with a terrier–ball contact whose impulse is positive after the solve (step.ts)
  }
  /** This tick's intents, by terrier slot: set in step 4, read in steps 5 and 7. Scratch, not state. */
  export interface Intents { readonly driveOn: Uint8Array; readonly zooming: Uint8Array; readonly targetVx: Float64Array; readonly targetVy: Float64Array }
  export class Physics {
    constructor(P: SimParams, packSize: number);
    readonly slots: number;      // 2 · packSize + 1
    readonly ball: number;       // the ball's slot, 2 · packSize
    /** Warm-up: the ball is immovable (§4.2). Setting it writes the ball's inverse mass, 0 or 1/m. */
    ballFixed: boolean;
    readonly stats: SolverStats;
    // This substep's contacts, in the fixed mirror-symmetric slot order; read by step.ts.
    cnt: number; ci: Int32Array; cj: Int32Array; cp: Int32Array;
    cnx: Float64Array; cny: Float64Array; cnz: Float64Array; closing: Float64Array; clambda: Float64Array;
    forcesAndIntegrate(bodies: readonly (Body | null)[], terriers: readonly (Terrier | null)[], intents: Intents): void;  // steps 1, 2
    detect(bodies: readonly (Body | null)[]): void;                    // step 3
    support(bodies: readonly (Body | null)[]): number;                 // step 4: the ball's bounce closing speed, or 0
    prepare(): void;                                                   // restitution targets, from the start-of-substep velocities
    solve(bodies: readonly (Body | null)[]): void;                     // step 5
    positions(bodies: readonly (Body | null)[]): void;                 // step 6
    slipOut(bodies: readonly (Body | null)[], terriers: readonly (Terrier | null)[]): number;  // step 7
    pushDirection(c: number, k: number): number;   // a binary angle, or −1 for a vertical push
    gap(bodies: readonly (Body | null)[], i: number, j: number): number;
    pieceSurface(c: number): number;               // −1 for a pair
  }
  ```
- **Ports:** `research/spike/src/sim/physics.ts`: the M0-validated solver, its order and its arithmetic, line for line (§4.1).
- **Changes, each structural (§4.2):**
  - a slot may be empty (a warm-up pack that isn't full, or a test's short pack);
  - empty slots are written, not skipped: the broad phase's `near` flag is 0 for an empty slot, so no flag from another state's call is ever read;
  - intents come from the `Intents` scratch, not from terrier fields;
  - `ballFixed`, with exactly the rules of §4.2;
  - values come from `SimParams`;
  - the bounce counters, and the rejected slip-out rules' branches go: `restitution0`, the switch on `flag`, and `noBounce`.
- **Implements:** D-3, D-4, D-5 as M0 amended it, C-3, C-21, A.4's solver rows.

### 1.9 `src/core/sim/movement.ts`: new (physics-port; push-remedy adds to it in phase 4)

- **Purpose:** step 4, inputs to intents (D-6, D-7, D-10), and step 7, timers and animation fields (D-9). Also the helpers that the substep's contact rules call.
- **Exports:**
  ```ts
  export function resolveIntents(sim: Sim, s: MatchState, t: number): void;   // step 4, every terrier
  export function endLunge(P: SimParams, T: Terrier): void;                    // lunge 0, the pounce wait starts
  export function tumble(sim: Sim, T: Terrier, slot: number): void;            // unless tumbled or guarded; ends a lunge; clears its intents
  export function recordPush(T: Terrier, angle: number, t: number): void;      // angle −1: none
  export function advanceTimers(sim: Sim, s: MatchState): void;                // step 7a
  export function animate(sim: Sim, s: MatchState, t: number): void;           // step 7b: phase and start, gait
  ```
- **Ports:** the spike's `step.ts`: `intents()` without its presence lines, which move to step 2; the timers block; `animate`, `endLunge`, `tumble` and `push`.
- **Changes:**
  - intents go to `sim.intents` by slot;
  - phases come from A.1's numbering, with the start countdown;
  - the gait's divisor is the ticks a second, and its threshold a setting (§10);
  - push-remedy adds §4.4's assist in phase 4, in this file alone.
- **Implements:** D-6, D-7, D-9, D-10, C-20, C-25, C-28.

### 1.10 `src/core/sim/rules.ts`: new (physics-port writes the M0 subset; rules completes it)

- **Purpose:** D-8 and D-12: events, presence, phases, kickoffs and arrivals, Q-8's bowling, goals and credit, the clock, the end and the Terriest.
- **Exports:**
  ```ts
  export function applyEvents(sim: Sim, s: MatchState, t: number): boolean;    // step 1 (§6.1); true if the roster or a slot changed
  export function applyPresence(sim: Sim, s: MatchState, t: number): boolean;  // step 2 (§6.2); true if a terrier was removed
  export function applyPhaseChanges(sim: Sim, s: MatchState, t: number): boolean; // step 3 (§6.3); true if it placed the terriers
  export function placeKickoff(sim: Sim, s: MatchState, t: number): void;      // D-8's placement, spots by ID rank (§6.4)
  export function placeArrival(sim: Sim, s: MatchState, T: Terrier, t: number): void;  // a warm-up arrival (§6.5); reads s, never sim.bodies
  /** Frees a slot: every terrier's slipping flag and slipFrom that name it clear. LEAVE, removal and SWITCH all call it (§6.1). */
  export function vacate(s: MatchState, slot: number): void;
  export function removeTerrier(s: MatchState, index: number): void;           // vacate its slot, then remove it
  export function bowled(P: SimParams, s: Readonly<MatchState>, T: Readonly<Terrier>): boolean;  // Q-8
  export function goalTest(sim: Sim, s: MatchState, t: number): void;          // every substep, in play
  export function scoreGoal(sim: Sim, s: MatchState, pack: Pack, t: number): void;  // credit, scorers, celebration
  export function advanceClock(sim: Sim, s: MatchState, t: number, beganInPlay: boolean): boolean;  // step 6 (§6.6); true if it placed
  export function winner(s: Readonly<MatchState>): Pack | null;                // null before the end, or level
  export function terriest(s: Readonly<MatchState>): number[];                 // list indices: most goals, then touches; ties share
  ```
- **Ports:** the spike's `step.ts` (`bowled`, `goal`, the phase changes) and `state.ts` (`placeKickoff`); roslambo's `rules.ts` for event handling, presence and Ready.
- **Changes:** packs, SWITCH, arrivals, the start countdown, the clock, overtime, the end, ranks by player ID, and one `vacate` for every way a slot is freed.
- **Implements:** D-8, D-12, D-16 (the away mark), Q-8, C-5, C-20, C-26, C-41, C-42 (in the state's part), L107–L112.
- **The split with physics-port:** physics-port writes the subset the M0 tests need:
  - `applyEvents` as a no-op returning false;
  - `applyPresence` with sitting only;
  - `applyPhaseChanges` with a countdown's end and a celebration's end to a kickoff;
  - `placeKickoff` by ID rank, `bowled`, `goalTest` and `scoreGoal`;
  - `advanceClock` as a no-op, and `winner` and `terriest`.

  rules completes the rest, `vacate` and `removeTerrier` included. The signatures above are final.

### 1.11 `src/core/sim/step.ts`: new (physics-port; rules may adjust its call sites in phase 3)

- **Purpose:** §7.2's tick order (§3).
- **Exports:**
  ```ts
  export interface Sim {
    readonly P: SimParams;
    readonly packSize: number;
    readonly physics: Physics;
    /** By slot: terriers, then the ball. Bound from the state at the start of every step, and again
     *  after a step that changes the roster or places the terriers (§3). */
    readonly bodies: (Body | null)[];
    readonly terriers: (Terrier | null)[];  // by terrier slot
    readonly intents: Intents;
    readonly ins: TickInput[];              // this tick's canonical inputs; its length is set every step
    readonly inputOf: Int32Array;           // by terrier slot: an index into ins, or −1 when absent; refilled by every bind
    /** After every substep: for tests and the tuning page only, never part of the output. */
    probe?: (s: Readonly<MatchState>, sub: number) => void;
  }
  export function makeSim(P: SimParams, packSize: number): Sim;
  /** Advances s by one tick, in place (roslambo's and M0's convention). Throws if s.packSize ≠ sim.packSize. */
  export function step(sim: Sim, s: MatchState, inputs: readonly TickInput[]): void;
  /** sim.bodies, sim.terriers and sim.inputOf from s. Every entry is written: null and −1 first, then each
   *  present terrier's slot, with its input found by binary search of the ID-sorted sim.ins. */
  export function bindSlots(sim: Sim, s: MatchState): void;
  ```
- **Ports:** the spike's `step.ts`: `step()`'s skeleton and `substep()`.
- **Changes:**
  - events, presence and the clock arrive as §7.2's steps 1, 2 and 6;
  - there are no module-level scratch arrays (the spike's `wasOnFloor`, `endsLunge` and `tumbles`): all scratch lives in the `Sim`;
  - the spike's per-state `WeakMap` body cache goes, and with it the guard it gave against a body list from another state. `step` binds on every call instead, so a `Sim` that steps the final state and then a predicted clone reads each one's own bodies;
  - the ENDED phase is terminal (§6.6).
- **Implements:** §7.2, D-5 step 8.
- **On §6's "`step(state, finalInputs) → state`":** this `step` mutates its state in place, as roslambo's and M0's do. A caller that needs the old state clones it first. That's what M3's timeline does, roslambo's `predict()` included: a clone costs 0.94 µs at 4 a side, against 16–30 µs for a step.

### 1.12 `src/core/sim/scenes.ts`: new (physics-port)

- **Purpose:** M0's scenes and the helpers that build them, in one place, so that physics-port's tests, the goldens, the canary, the cases, the marks, the tuning page and the metrics all run the same scenes. It ships, in the determinism chunk and from M4 with the canary, so it's linted under exact-ops and scanned as simulation code.
- **Exports:**
  ```ts
  /** Each pack's IDs for a seed, ascending, so member (pack, rank) has its pack's rank-th smallest ID
   *  and rank k of pack B mirrors rank k of pack A. */
  export function rankedIds(seed: number, perPack: number): readonly [readonly string[], readonly string[]];
  export interface PlacedOptions {
    readonly phase?: Phase;                        // IN_PLAY by default; KICKOFF_COUNTDOWN for pinches
    readonly members?: readonly [number, number];  // terriers in each pack; both full by default (§2.3's short packs)
    readonly seed?: number;                        // for rankedIds; 0 by default
    readonly matchMinutes?: number;                // a real clock; else 2^31 ticks, which no test reaches (R-7)
  }
  /** A match placed for a kickoff (§6.4) at tick 0: every member present, Ready 0, phaseStart 0. */
  export function placedMatch(P: SimParams, packSize: number, opts?: PlacedOptions): MatchState;
  export function place(s: MatchState, k: number, x: number, y: number, z?: number): void;   // list index k, at rest
  export function park(s: MatchState, k: number): void;     // a far corner of its own half
  export function placeBall(s: MatchState, x: number, y: number, z?: number, vx?: number, vy?: number, vz?: number): void;
  export function touchReach(P: SimParams): number;         // a standing terrier touching a resting ball, horizontally

  // Inputs, as A.2's u16.
  export const NOTHING = 0;                                 // not a setting
  export function pitchDir(step: number, zoomies?: boolean): number;
  export function ballDir(step: number, zoomies?: boolean): number;
  /** Member (pack, rank)'s u16 at tick t, or null when absent; s is the state before the tick. */
  export type SceneInput = (pack: Pack, rank: number, t: number, s: Readonly<MatchState>) => number | null;
  /** The spike's seeded play: spells of 23 ticks in the chosen frames, zoomies, and jumps and pounces from press counters. */
  export function chasey(seed: number, frames: 'ball' | 'all' | 'contact'): SceneInput;

  /** A placed scene: its state's setup and its inputs. */
  export interface Scene {
    readonly name: string;
    readonly packSize: number;
    readonly phase: Phase;
    readonly members?: readonly [number, number];
    readonly setup?: (s: MatchState, P: SimParams) => void;
    readonly input: SceneInput;
    readonly mirrored: boolean;                    // pack B's rank k sends mirrorInput of pack A's rank k
  }
  export function sceneStart(scene: Scene, P: SimParams, seed?: number): MatchState;
  /** Tick t's TickInputs for a scene's members, with their IDs, handed over reversed (P4). */
  export function sceneInputs(scene: Scene, s: Readonly<MatchState>, t: number, out?: TickInput[]): TickInput[];

  // M0's scenes, coordinates unchanged (the spike's scripts.ts, cases.ts and tests):
  export function pushScene(layout: 'train' | 'line' | 'round', m: number, frame: 'pitch' | 'ball'): Scene;
  export function pinchScene(packSize: number, zoomies?: boolean): Scene;     // the kickoff pinch (C-21), from its countdown
  export const SQUEEZE: Scene;  export const WALL_SCRUM: Scene;  export const CORNER_SCRUM: Scene;
  export const RESTING_BALL: Scene;  export const ROLLING_BALL: Scene;
  export function dribbleScene(frame: 'ball' | 'pitch', zoomies: boolean, runUp?: number, startSpeed?: number, stepOff?: number): Scene;
  export interface RestCase { packSize: number; thetaDeg: number; holding: 'ball frame' | 'pitch frame, opposite' | 'sitting'; offMirror?: boolean }
  /** A ball dropped from 1 cm onto terriers placed round it (§16's slip-out cases). */
  export function restScene(c: RestCase): Scene;
  ```
- **Ports:** the spike's `scripts.ts` (the placement helpers, the inputs, `chasey`, and the push, pinch, squeeze and scrum setups) and `cases.ts` (the rest and dribble setups). The spike's literal radii are read from `SimParams`; its coordinates stay, each marked `not a setting: a scene's coordinate` where the scan would flag it.
- **Short packs:** `members` lets a placed state hold fewer terriers than the pack size, in any phase. Warm-up has holes anyway. In play it's a test-only state: the empty-goal mark's (§8.5), which `stateProblems` reports (§6.7) and `step` handles, since everything indexes by slot (§0).
- **Why one file:** the spike's tests imported these from its `scripts.ts`, which M2's goldens own in phase 3, while physics-port's phase-2 tests, the step's timing and the bit pins need them first. Without one owner, two builders would write two push or scrum scenes, and the timing, the marks and the goldens could run different ones.

### 1.13 `src/core/sim/testing.ts`: new (physics-port)

Test support: not shipped, but linted and scanned as simulation code.

```ts
export function testId(k: number): string;     // 32 hex digits, increasing with k
/** placedMatch and makeSim with a changed configuration, then setup(). */
export function scenario(packSize: number, over?: Partial<Config>, setup?: (s: MatchState, P: SimParams) => void, opts?: PlacedOptions): { sim: Sim; s: MatchState };
export function run(sc: { sim: Sim; s: MatchState }, ticks: number, fn?: (k: number, t: number) => number | null): void;
export function kineticEnergy(s: Readonly<MatchState>, P: SimParams): number;
export function momentum(s: Readonly<MatchState>, P: SimParams): [number, number];
/** Every present body in slot order: x, y, z, vx, vy, vz as 16 hex digits each (the float64's
 *  big-endian bits), the floor flag as 0 or 1, and a terrier's heading as 8 hex digits; bodies joined by ':'. */
export function bodyBits(s: Readonly<MatchState>): string;
export function bodyHash(s: Readonly<MatchState>): string;    // hash64 of bodyBits's UTF-8 bytes: what the bit pins hold (§4.1)
export function mirrorMismatches(s: Readonly<MatchState>, limit?: number): string[];   // P8 by value (§7.6)
export const SECOND_SHAPE: PitchShape;   // D-4's: 50 × 30, cuts 6, 3, 6, 3, a 10 m mouth; each line `not a setting`
```

- **Ports:** the spike's `testing.ts`. Its placement helpers moved to `scenes.ts`.
- **Why the long clock:** the 36,000-tick bit-still scenes would otherwise reach 0:00 at a 10-minute length, on their last tick, and be placed for the overtime kickoff (§13, R-7).

### 1.14 `src/core/sim/cases.ts`: new (physics-port)

M0's run-2 cases, as functions that the slip-out and push tests, the tuning page and the metrics share, built on `scenes.ts`.

```ts
export function ballOnTerriers(c: RestCase, seconds?: number, over?: Partial<Config>): SlipResult;
export function kickoffPinch(packSize: number, zoomies?: boolean, seconds?: number, over?: Partial<Config>): SlipResult;
export function dribble(frame: 'ball' | 'pitch', zoomies: boolean, runUp?: number, over?: Partial<Config>, startSpeed?: number, stepOff?: number): DribbleResult;
export function pushTime(layout: 'train' | 'line' | 'round', m: number, frame: 'pitch' | 'ball', over?: Partial<Config>, limitTicks?: number): PushResult;
export const DOWN_METRES = 0.01;   // not a setting: §16's "within 1 cm of its resting height"
```

- **Ports:** the spike's `cases.ts`, for the chosen rule only. `ballOnTerriers` and `kickoffPinch` lose their `rule` argument, and the scenes come from `scenes.ts`. `DribbleResult` gains the touches counted, for the re-arm gap's metric (§9.6).

### 1.15 `src/core/sim/scripts.ts`, `golden.ts`, `goldens.json`: new (goldens)

- **Purpose:** the scripted runs, their hashes at checkpoints, what each run covers, and the canary (§7).
- **Exports:**
  ```ts
  // scripts.ts
  /** What a run must show, asserted from its result (§7.2): at least these counts, these phases seen, this ending. */
  export interface Coverage {
    readonly goals?: number; readonly pounces?: number; readonly tumbles?: number; readonly hits?: number;
    readonly bounces?: number;                     // floorBounces + pieceBounces
    readonly pushes?: number; readonly slipOuts?: number;
    readonly phases?: readonly Phase[];            // each seen at least once
    readonly overtime?: boolean;                   // seen, or never seen
    readonly end?: 'lead' | 'overtime';            // reached ENDED at 0:00 with a lead, or by an overtime goal
  }
  /** A state the run must reach: holds(s) after tick `tick`. */
  export interface ScriptCheck { readonly tick: number; readonly what: string; readonly holds: (s: Readonly<MatchState>) => boolean }
  export interface ScriptSpec {
    readonly name: string;
    readonly packSize: number;
    readonly matchMinutes: number;                 // a genesis run's length; a placed run's clock is 2^31
    readonly ticks: number;
    readonly start: 'genesis' | Scene;             // events from tick 1, or a placed scene (§1.12), whose phase, members and setup it takes
    readonly seed: number;                         // for the IDs (rankedIds)
    readonly mirrored: boolean;                    // pack B's rank-k terrier sends mirrorInput of pack A's rank-k
    /** Member (pack, rank)'s TickInput at tick t, without its ID, or null when absent; s is the state before the tick. */
    readonly input: (pack: Pack, rank: number, t: number, s: Readonly<MatchState>) => Omit<TickInput, 'id'> | null;
    readonly covers: Coverage;
    readonly checks?: readonly ScriptCheck[];
  }
  export function scriptTickInputs(spec: ScriptSpec, t: number, s: Readonly<MatchState>, out?: TickInput[]): TickInput[];  // reversed (P4)
  export const GOLDEN_SCRIPTS: readonly ScriptSpec[];
  export const CANARY_SCRIPT: ScriptSpec;
  // golden.ts
  export const CHECKPOINT_EVERY = 500;   // not a setting
  export interface GoldenResult {
    name: string; checkpoints: string[]; final: string;
    tick: number; phase: number; overtime: boolean; score: [number, number]; terriers: number;
    goals: number; pounces: number; tumbles: number; hits: number;    // events seen: score rises, lunges and tumbles begun, lastHitTick changes
    floorBounces: number; pieceBounces: number; pushes: number;      // the solver's counters (§1.8)
    contacts: number; maxContacts: number; slipOuts: number;
    phasesSeen: number;                  // bit p: phase p was seen at a tick's end
    overtimeSeen: boolean;
    unmet: string[];                     // the checks that didn't hold
  }
  export function replay(spec: ScriptSpec, P?: SimParams): GoldenResult;
  export function goldenSuite(P?: SimParams): GoldenResult[];
  export function canaryHash(P?: SimParams): string;
  /** What a run's fields say it didn't cover; [] when it covered its spec. */
  export function coverageProblems(spec: ScriptSpec, r: GoldenResult): string[];
  ```
  `goldens.json` is `{ codec, checkpointEvery, canary, runs: GoldenResult[] }`, as the spike's.
- **Ports:** the spike's `scripts.ts` and `golden.ts`, and roslambo's `scripts.ts` ID helpers and event scripting. Placed runs take their scenes from `scenes.ts`.
- **Changes:**
  - genesis scripts drive the rules through events;
  - IDs are ranked within packs, so mirrored pairs match by rank;
  - each run declares what it covers, and the test asserts it, so a run that stops covering its column fails even when its hash was re-emitted;
  - the counters split bounces and pushes from hits;
  - script coordinates avoid setting values or carry `not a setting`;
  - the second shape and the rejected slip-out rules leave the goldens (Q-14 of §14);
  - the canary is new (§7.3).
- **Implements:** §16 "Determinism", D-23.

### 1.16 `src/core/sim/index.ts`: new (settle)

The simulation's public face for M3 and M4. It re-exports `state` (with `isNameControl`, `nameAllowed` and `cleanName` for M4's `names.ts`), `input`, `params`, `codec` (`encodeState`, `decodeState`, `hashState`, `CODEC_VERSION`), `valid` (`stateProblems`), `hash64`, `math` (`TURN`, `HALF_TURN`, `QUARTER_TURN`, `dir`, `datan2`, `angleDiff`, `fractionOfTurn`), `step` (`Sim`, `makeSim`, `step`), `rules` (`winner`, `terriest`) and `golden` (`canaryHash`). Tests and the tuning page import modules directly.

### 1.17 `src/core/bot/bot-id.ts`: new (bot-brain)

```ts
export const BOT_SLOTS: number;    // 2 · config.packSizeMax: Practice's 7 bots and one spare
export function botId(host: string, k: number): string;    // version-8 UUID digits from hash64("terriest bot <host> <k> a/b")
export function botIds(host: string): string[];
export function isBot(id: string): boolean;                // id[12] === '8'
export function botName(id: string): string;               // "Bot " + four upper-case hex digits: passes cleanName
export function botCoat(id: string, coatCount: number): number;   // seeded by the ID (D-39)
export function botSeed(id: string): number;               // a u32 from the ID, for the brain's noise
```

- **Ports:** roslambo's `src/core/bot/bot.ts`: `botId`, `botIds`, `isBot`, `botName`, and their tests.
- **Changes:** the product string, the slot count, and the coat and seed functions, which are new. roslambo's `botButtons` and `styleOf` don't come.
- **Implements:** D-39, §14.

### 1.18 `src/core/bot/brain.ts`: new (bot-brain)

```ts
export interface BotParams { /* §8.4, from config through derive(): reactionTicks, aimNoiseUnits, zoomiesBeyond, pounceWithin,
                                pounceAlignUnits, supportMetres, defendMetres, barkEveryTicks, barkGapTicks (from barkMaxPerSecond),
                                stuckTicks, stuckMetres */ }
export function botParams(c?: Config): BotParams;
export interface Brain { readonly id: string /* plus host-local memory: §8.2 */ }
/** A brain for bot id, its counters started from the terrier's stored previous input (D-10). */
export function newBrain(id: string, prevInput: number, P: SimParams, B: BotParams): Brain;
/** The bot's u16 input for the tick after s (A.2, in the pitch frame), from the state alone. */
export function think(brain: Brain, s: Readonly<MatchState>): number;
```

- **Ports:** none. roslambo's `steer.ts` is a pursuit loop that uses `Math.atan2`, so the brain is new (D-39).
- **Implements:** D-39, Q-9, §14, L142, L327 (through the bark gap).

### 1.19 `src/core/bot/marks.ts`: new (bot-brain)

Test support for the pass marks: seeded setups, runs, the never-stuck detector, and the scripted people of §16's end-to-end setups (§8.5, §8.6).

### 1.20 `src/determinism.ts` (new) and `src/main.ts` (changed): goldens

- `src/determinism.ts`:
  ```ts
  export interface DeterminismReport {
    ms: number; canary: string; runs: GoldenResult[]; checkpointEvery: number;
    firstDifference: string; verdict: 'PASS' | 'FAIL'; userAgent: string;
  }
  declare global { interface Window { terriestDeterminism?: DeterminismReport } }
  export function run(boot: Boot): void;
  ```
  Ported from the spike's `src/determinism.ts` and roslambo's (§7.5).
- `src/main.ts`: before it makes a canvas, `start()` routes `#test=determinism` to `import('./determinism')` (§7.5).

### 1.21 `e2e/determinism.spec.ts`: new (goldens)

The cross-engine check, in each engine's project (§7.5). Ported from the spike's spec, without the separate Node replay: `golden.test.ts` replays the suite in Node in the unit stage, on x86 here and on CI's arm64 job.

### 1.22 `scripts/emit-goldens.mjs`, `scripts/emit-goldens.test.mjs` and `package.json`: goldens

- `package.json` gains `"emit-goldens": "node scripts/emit-goldens.mjs"`, which refuses without `TERRIEST_EMIT_GOLDENS=1` (§7.4).

### 1.23 The tuning page: tuning-page

- `dev/tuning.html` and `dev/tuning/{main,model,scenarios,draw,keyboard,recording}.ts`, with `dev/tuning/model.test.ts`.
- `dev/tuning.metrics.ts` and `dev/vitest.config.ts`.
- `vitest.config.ts` gains `'dev'` in its include, so `model.test.ts` runs in the gate. `*.metrics.ts` doesn't match `*.test.*`, so the metrics stay out of it.

§9 has the page.

### 1.24 `eslint.config.mjs` and its test: core-types

- **The ban** (§7.3, R-2). In the group for `src/core/sim` and `src/core/bot`, tests aside, `no-restricted-syntax` gains:
  - `NewExpression[callee.name=/^(Weak)?(Map|Set)$/]`;
  - `:matches(ClassDeclaration, ClassExpression)[superClass.name=/^(Weak)?(Map|Set)$/]`.

  Its message: "Arrays only in src/core/sim and src/core/bot: a Map or Set iterates in insertion order, which can follow arrival order (PLAN §7.3, R-2)." `globalThis.Map` is out of reach already, since the group bans the global object.
- **Where:** `groupRules` pushes it beside the Math and locale bans (`if (exact) syntax.push(...MATH_BANS, ...LOCALE_BANS, ...COLLECTION_BANS)`), so the group keeps one list of options for the rule, as the config's header requires.
- **Its test:** `scripts/eslint/fixtures/determinism.ts.fixture` gains a section for each construct (`new Map`, `new Set`, `new WeakMap`, `new WeakSet`, a class extending `Map`), and `scripts/eslint/config.test.mjs`'s `EXPECT` maps each to `{ [SYNTAX]: EXACT }`. Each then fails in the sim and bot groups, and lints clean everywhere else, the simulation's tests included.
- **Today's code:** nothing in `src/core/sim` constructs them (M1's `pitch.ts` doesn't). `src/config.test.ts` does, and it's outside the group.

### 1.25 The test files

| File | Owner | Covers |
|---|---|---|
| `src/core/sim/math.test.ts`, `input.test.ts`, `params.test.ts`, `codec.test.ts` | core-types | §1.1–§1.6 |
| `scripts/eslint/config.test.mjs` and its fixture | core-types | the collection ban (§1.24) |
| `src/core/sim/pitch.test.ts` | physics-port | `pieceContact` |
| `src/core/sim/contacts.test.ts` | physics-port | bit-still, bounces, settling, rolling (M0's `contacts.test.ts`); the warm-up ball (§4.2) |
| `src/core/sim/hits.test.ts` | physics-port | simultaneous hits, with M0's speeds pinned |
| `src/core/sim/push.test.ts` | physics-port; settle adds C-18's marks | push times |
| `src/core/sim/slipout.test.ts` | physics-port | §16's four slip-out cases under 42° with the flag |
| `src/core/sim/mirror.test.ts` | physics-port | P8 at every pack size on both shapes, pinches included |
| `src/core/sim/tunnel-main.test.ts`, `tunnel-second.test.ts` | physics-port | tunnelling and containment, split by shape for the worker pool |
| `src/core/sim/movement.test.ts` | physics-port | movement, frames, presses, L57, kickoffs and goals as M0 had them |
| `src/core/sim/step.test.ts` | physics-port | one `Sim` over alternating states and a clone; pack-size mismatch throws; probe order; the bit pins (§4.1) |
| `src/core/sim/rules.test.ts`, `events.test.ts` | rules | §6; D-12's event order; the goal tests at the frame and the netting (§6.8); vacated slots (§6.1); one `Sim` over two warm-up states |
| `src/core/sim/properties.test.ts` | rules | P4; `step` never throws; the state stays valid; every u16 is a valid input; short packs; stacked switches (§7.7) |
| `src/core/sim/golden.test.ts` | goldens | §7, each run's coverage included |
| `src/core/bot/bot-id.test.ts`, `brain.test.ts` | bot-brain | §8 |
| `src/core/bot/marks-empty-goal.test.ts`, `marks-regulation.test.ts`, `marks-regulation-1.test.ts` to `-4.test.ts`, `marks-fall-back.test.ts`, `marks-e2e-setups.test.ts` | bot-brain | the marks, one file each and the regulation mark's whole matches in four, for the pool (§8.5, §12) |
| `src/core/sim/assist.test.ts` | push-remedy | §4.4 |
| `src/core/sim/netting.test.ts` | settle | a goal stays in the net at the settled netting value (§9.6) |
| `dev/tuning/model.test.ts` | tuning-page | §9.5 |
| `scripts/emit-goldens.test.mjs` | goldens | it refuses without the variable |

---
## 2. The state

### 2.1 Types

```ts
// src/core/sim/state.ts. Every numeric constant below is marked `not a setting`.
export const WARM_UP = 0, START_COUNTDOWN = 1, KICKOFF_COUNTDOWN = 2, IN_PLAY = 3, CELEBRATION = 4, ENDED = 5;
export type Phase = typeof WARM_UP | typeof START_COUNTDOWN | typeof KICKOFF_COUNTDOWN | typeof IN_PLAY | typeof CELEBRATION | typeof ENDED;
export const STANDING = 0, RUNNING = 1, ZOOMING = 2, AIRBORNE = 3, LUNGING = 4, TUMBLED = 5, GETTING_UP = 6, SITTING = 7;
export type AnimPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ANIM_PHASES = ['standing', 'running', 'zooming', 'airborne', 'lunging', 'tumbled', 'gettingUp', 'sitting'] as const;
export const NEVER = 0xffffffff;   // a tick that never happened (A.1)

export interface Body {
  x: number; y: number; z: number;      // metres: the centre spot is the origin, x along the length, z up (D-4)
  vx: number; vy: number; vz: number;   // m/s
  onFloor: boolean;                     // set by step 4's support, and by placement
}
export interface Ball extends Body {
  lastHitTick: number;                  // NEVER until hit (D-9)
  lastHitStrength: number;              // that hit's closing speed, m/s
  lastHitDvx: number; lastHitDvy: number; lastHitDvz: number;  // that hit's velocity change, m/s: the squash's axis (§2.3); 0 until hit
  lastContactTick: number;              // NEVER until a terrier touches it: credit and Q-8
}
export interface Terrier extends Body {
  // identity
  id: string; name: string; pack: Pack; spot: number; coat: number;
  // lifecycle
  joinTick: number; readyUntil: number; lastInputTick: number;
  prevInput: number;                    // the previous present final input, bits 0–12 (D-10)
  // body
  heading: number;                      // u32 binary angle
  overheadRef: number;                  // the heading when ballOverhead set (D-7)
  sitting: boolean; zoomLocked: boolean; ballOverhead: boolean; slipping: boolean; touchingBall: boolean;
  slipFrom: number;                     // the slot slipped from, or −1 (§2.3)
  // timers, in ticks; the meter in half-ticks
  meter: number; pounceWait: number; lunge: number; tumble: number; guard: number;
  // counts
  touches: number; goals: number;
  // animation (D-9)
  anim: AnimPhase; animStart: number;
  gait: number;                         // u32 binary angle
  takeOffTick: number; landingTick: number;
  lastBallContactTick: number; lastTerrierContactTick: number;
  lastPushDir: number;                  // binary angle; 0 while lastPushTick is NEVER
  lastPushTick: number;
  headingChange: number;                // i32: this tick's change of heading
}
export interface MatchSettings { packSize: number; matchMinutes: number }
export interface MatchState {
  phase: Phase; phaseStart: number; overtime: boolean; tick: number;
  packSize: number;                     // set at genesis, then never changed
  matchLengthTicks: number;             // set at genesis, then never changed
  clock: number;                        // ticks left; in overtime, ticks since it began
  score: [number, number];
  lastGoalTick: number; lastGoalPack: Pack; ownGoal: boolean;
  scorers: number;                      // bit k: s.terriers[k]
  ball: Ball;
  terriers: Terrier[];                  // (spot, pack) order: A1, B1, A2, B2 … (§2.3)
}
```

### 2.2 The codec: A.1, fixed

Little-endian, in this order. The "Written" column gives §7.2's step (§3) that changes each field. "Place" is a kickoff placement (§6.4), "arrive" a warm-up arrival (§6.5), and "gen" genesis.

| Bytes | Field | Written |
|---|---|---|
| u16 | codec version = 1 | constant |
| u8 | phase: 0 warm-up, 1 start countdown, 2 kickoff countdown, 3 in play, 4 celebration, 5 ended | 3; 5 (a goal starts a celebration); 6 (the end, or the overtime kickoff) |
| u32 | phase start tick | with phase |
| u8 | overtime, 0 or 1 | 3 (a celebration ends level at 0:00), 6 |
| u32 | tick | end of the tick |
| u8 | pack size, 1–4 | gen |
| u32 | match length, ticks | gen: minutes × `ticksPerMinute` |
| u32 | clock | gen (= length); 6 |
| u8, u8 | score A, score B, saturating at 255 | 5 |
| u32, u8, u8 | last goal tick (NEVER), pack, own goal | 5; kept until the next goal (§14, Q-5) |
| u8 | scorers, bit k for `terriers[k]`; 0 for an own goal | 5; cleared at each placement |
| 6 × f64 | ball x, y, z, vx, vy, vz | 5; place |
| u8 | ball on the floor | 5 (support); place |
| u32, f64 | ball last hit tick, strength | 5, before the solve |
| 3 × f64 | ball last hit's velocity change, x, y, z | 5, after the solve, in the substep that sets the hit |
| u32 | ball last contact tick | 5, after the solve |
| u8 | n, at most 2 × pack size | 1, 2 |
| *per terrier, in (spot, pack) order:* | | |
| 16 × u8 | player ID | 1 (JOIN) |
| u8 + bytes | name, UTF-8, at most 32 bytes | 1 (JOIN, cleaned) |
| u8, u8, u8 | pack, spot, coat | 1 (JOIN, SWITCH, arrive); spot also at place (ID rank) |
| u32, u32, u32 | join tick; ready until (0: not ready); last tick with an input | 1; 1 and 3 (expiry); 1 and 2 |
| u16 | previous present final input, bits 0–12 | 4 |
| u32 | heading | 1 (arrive), 3 and 6 (place), 4 (turns) |
| u32 | overhead reference | 4, when the flag sets; place and arrive (= heading) |
| 6 × f64 | x, y, z, vx, vy, vz | 1 (arrive), 3 and 6 (place), 4 (jump, pounce), 5 |
| u8 | flags: bit 0 on the floor, 1 sitting, 2 zoomies locked out, 3 ball overhead, 4 slipping, 5 touching the ball; 6–7 zero | 2 (sitting), 4, 5; place |
| u8 | slipped from: 0 none, else 1 + a slot | 5; place; cleared when that slot is vacated (1, 2) |
| u16 | zoomies meter, half-ticks: full 360, drains 2, refills 1 | 4; place and arrive (full) |
| 4 × u16 | pounce wait, lunge, tumble, guard | 4 (pounce), 5 (lunge end, tumble), 7; place and arrive (0) |
| u16, u8 | touches (saturating at 65,535), goals (at 255) | 5 |
| u8, u32 | animation phase, its start tick | 7; place and arrive |
| u32 | gait | 7 |
| u32, u32 | take-off tick, landing tick | 4 (jump), 5 (per substep) |
| u32, u32 | last ball contact tick, last terrier contact tick | 5 |
| u32, u32 | last push direction, last push tick | 5 |
| i32 | heading change this tick | 4; place (0) |

**Size:** 30 bytes of header, 89 for the ball and 1 for n. Then 142 bytes per terrier plus its name: 1,512 bytes at 8 terriers with 32-byte names, A.1's "about 1.5 KB".

### 2.3 What A.1 left open, which M2 fixes

1. **The flags byte:**
   - A.1's "lunging" flag goes, since the lunge timer already says it: a redundant bit would be one more thing for `decodeState` to check against the timer.
   - Its separate "touching the ball" byte folds into bit 5.
   - Bits 6–7 must be zero.
2. **The spike's intents leave the state.** It encoded `driveOn`, `zooming` and the drive's target. Step 4 rewrites all four before anything reads them, so they aren't state. They become `sim.intents`, by slot. The P8 comparison loses them too.
3. **Slipped from is a slot:**
   - A terrier's slot is 2 × spot + pack, and the ball's is 2 × pack size.
   - A.1 counted list indices, which stop matching the solver's mirror slots when a warm-up pack isn't full.
   - With full packs, from the start countdown on in a real match, list index and slot are the same, so P8's mirror is `slot ^ 1`, with the ball's its own.
   - Slipping is set exactly when slipped-from names a slot, and never the terrier's own.
4. **Unset ticks are NEVER:**
   - take-off, landing, both contact ticks, the last push, the ball's last hit and last contact, the last goal;
   - `lastPushDir` is 0 while `lastPushTick` is NEVER;
   - `readyUntil` 0 is "not ready", as A.1 says.
5. **Counters saturate:** touches at 65,535, goals and scores at 255, the overtime clock at 2³² − 1. So `encodeState` never sees a field outside its type.
6. **Holes, and the test-only short packs:**
   - In warm-up a pack can have fewer terriers than the pack size, and its spots can have gaps after a LEAVE.
   - The list stays in (spot, pack) order with unique slots.
   - From the start countdown on, a real match has both packs full and locked, so list index k is slot k.
   - A test state may hold a short pack in play (`placedMatch`'s `members`, §1.12). It's the empty-goal mark's, with nobody defending (§8.5). `stateProblems` reports it, so `decodeState` refuses it and it never comes from a peer, but `step` and the brain handle it, because they index by slot (§0).
7. **The scorers bitmask** indexes the list, which during play is the slot order.
8. **Codec order:** A.1's, with the fixes above.
9. **The ball keeps its hit's direction** (D-9, L101):
   - D-9 keeps the last hit's tick and strength, for the squash and the thump. A squash also needs an axis: vertical off the floor, along a wall's normal, along the line to a terrier.
   - The velocity after the hit gets the axis wrong for glancing hits and for a rolling ball's floor bounce, and the drawer keeps no history to recover it (D-27).
   - So the ball keeps the velocity change of the substep that set its last hit, from after step 2 to after step 5: the impulses and the floor's bounce, not gravity.
   - In a mirrored state its horizontal parts are ±0, since mirrored impulses cancel exactly, so P8 holds. The fixed warm-up ball's change is 0, which the drawer reads as no axis.
   - The largest contact's normal would break P8 instead: in a mirrored pinch A_k's and B_k's contacts tie, and keeping one keeps one side's (§14, Q-22).

### 2.4 What isn't in the state

- **Barks.** The simulation ignores the bark counter (D-10).
- **A bot flag.** The ID says it (roslambo D-27).
- **Spectators** (§7.1).
- **The intents** (§2.3).
- **The contact list and the solver's statistics.**
- **The pushing pose's 8 ticks.** D-27 draws it from `lastBallContactTick` (§10).

---

## 3. `step()`, in §7.2's order

```
step(sim, s, inputs):
  if s.packSize ≠ sim.packSize: throw
  t = s.tick + 1
  if s.phase = ENDED: s.tick = t; return                         // terminal (§6.6)
  canonicalInputs(inputs, sim.ins)                               // valid IDs, one each, ID order; sim.ins.length set
  bindSlots(sim, s)                                              // every call: no binding from another state's step is read

  1. Events              changed = rules.applyEvents(sim, s, t)   reads s and sim.ins only
                         warm-up only: LEAVE, then SWITCH, then JOIN, each in ID order; then READY, then UNREADY (§6.1)
                         if changed: bindSlots
  2. Presence            removed = rules.applyPresence(sim, s, t)
                         lastInputTick; warm-up: remove after 180 silent ticks; from the start countdown: sit after 120 (§6.2)
                         if removed: bindSlots
  3. Phase changes       placed = rules.applyPhaseChanges(sim, s, t)
                         Ready expiry; the start countdown (+ placement); a countdown's end → in play;
                         a celebration's end → kickoff countdown, overtime kickoff (+ placement), or ENDED (§6.3)
                         if placed: bindSlots                    // the start countdown's placement ranks spots by ID
     if s.phase = ENDED: s.tick = t; return
     beganInPlay = s.phase = IN_PLAY
  4. Inputs to intents   movement.resolveIntents(sim, s, t)       (§5)
  5. Physics             sim.physics.ballFixed = s.phase = WARM_UP   // writes the ball's inverse mass (§4.2)
                         for sub in 0 … substeps − 1: substep(sim, s, t); take-off and landing ticks; sim.probe?.(s, sub)
  6. The clock           placed = rules.advanceClock(sim, s, t, beganInPlay)     (§6.6)
                         if placed: bindSlots                    // the overtime kickoff; its ranks, and so its slots, are unchanged
  7. Timers, animation   movement.advanceTimers(sim, s); movement.animate(sim, s, t)
  s.tick = t
```

**Binding.** `bindSlots` runs first in every call, so the bodies, terriers and inputs `step` reads are this state's, whatever the `Sim` stepped before. It runs again only after a step that changed the roster or placed the terriers: in play, once a tick. It writes every entry: each slot null and each `inputOf` −1, then each present terrier's slot, with its input found by a binary search of the ID-sorted `sim.ins`. The step-1 helpers, `placeArrival` among them, read `s` and `sim.ins` only, since a JOIN adds a terrier that `sim.bodies` holds only after the re-bind.

`substep` ports the spike's `substep()` without changing its order, with slots in place of indices. "inPlay" is read at the start of each substep, since a goal changes the phase within a tick:

```
substep(sim, s, t):
  inPlay = s.phase = IN_PLAY; pounces = inPlay or s.phase = WARM_UP
  P.forcesAndIntegrate(bodies, terriers, intents)          // D-5 steps 1, 2
  keep the ball's velocity                                 // Sim scratch, for the hit's change (§2.3)
  P.detect(bodies)                                         // step 3; in warm-up, none of the ball's piece templates (§4.2)
  hit = P.support(bodies)                                  // step 4: the ball's bounce speed, or 0
  P.prepare()
  // Before the solve, found from the contacts as detected, then applied, so no contact's order counts:
  for each contact c:
    terrier i, ball:   hit = max(hit, closing if > 0.3 m/s); if inPlay and bowled(P, s, T_i): tumble i; if T_i lunging: lunge ends
    terriers i, j:     if pounces and rivals: a lunging one tumbles the other (both, if both lunge); a lunging one's lunge ends
    terrier, a piece other than the floor: its lunge ends
    ball, a piece other than the floor:    hit = max(hit, closing if > 0.3 m/s)
  apply the lunge ends, then the tumbles (each once, guard and tumble respected)
  if hit > 0: ball.lastHitTick = t; ball.lastHitStrength = hit
  P.solve(bodies)                                          // step 5
  if hit > 0: ball.lastHitDv = the ball's velocity − the kept one   // the impulses and the floor's bounce, not gravity
  P.positions(bodies); P.slipOut(bodies, terriers)         // steps 6, 7
  // After it:
  for each contact c:
    terrier, ball:   T.lastBallContactTick = t; ball.lastContactTick = t; a new episode sets touchingBall, + 1 touch if inPlay
                     if clambda[c] > 0: this substep is a push (stats.pushes, once a substep)
    terriers i, j:   both lastTerrierContactTick = t
    clambda[c] > 0, not the floor: recordPush for each terrier in it, with pushDirection(c, k)
  each terrier: touchingBall clears at a surface gap ≥ the re-arm gap;
                slipping clears, with slipFrom −1, once the body in its slipFrom slot is on the floor, or the slot is empty
  if s.phase = IN_PLAY: rules.goalTest(sim, s, t)          // the first goal of the tick counts (§6.8)
```

**Roster events and their order (D-12):**
- **Kinds:** JOIN (`joinPack`, coat, name), LEAVE, READY, UNREADY, SWITCH (`switchPack`), as bits of `TickInput.events`.
- **When:** in warm-up only. From the start countdown on the roster is locked, so every event is ignored, LEAVE included (roslambo).
- **Order:** LEAVE, then SWITCH, then JOIN, each kind in player-ID order over the canonical list, then READY, then UNREADY. A place that a LEAVE or SWITCH frees can be taken in the same tick (D-22's pack swap).

**How bots' inputs enter:**
- A bot's input is an ordinary `TickInput` with the bot's ID. At M3 its host sends it in its TICK (D-39). Offline it comes from `think()`, in the bot marks, the tuning page and the metrics.
- The simulation can't tell a bot from a person. A bot is "always ready" because its host sends `JOIN | READY` and re-sends READY before it expires, as roslambo's `tendBots` does (M3).
- A host that is away sends nothing, so its bots go silent and sit after 120 ticks.
- `think()` runs once per local tick on the host, never inside the timeline's re-simulations, so the brain adds nothing to the 13-step replay (C-2). Its own cost is measured (§9.6): Practice's host runs 7 brains a tick.

---

## 4. Physics

### 4.1 What ports unchanged: the M0-validated solver

`research/spike/src/sim/physics.ts` ports line for line, in order and arithmetic. That's D-5 as M0 built and measured it, at the settings M0 kept:
- **Step 1, forces.** The drive moves the horizontal velocity toward its target by at most 15 m/s² × dt. A slipping terrier's drive component toward the body it slipped from is held off. Idle friction is 8 m/s² × dt, reaching exactly 0 when no direction is held, or the terrier is tumbled or sitting. Both act only on the floor and never during a lunge. Gravity acts on every body. The ball's rolling slowdown is 0.5 m/s² on the floor, to exactly 0.
- **Step 2, integration:** semi-implicit Euler. Each body's velocity at the start of the substep, before the forces, is kept for restitution.
- **Step 3, detection:** every pair and every body against every piece, through the fixed slot templates. Each template is a contact and its mirror: bodies A1, B1, A2, B2 … then the ball, with a body's mirror `k ^ 1` and the ball its own. Pieces sit beside their mirrors. Each piece has its bound box, and the exact broad phase lets a body clear of the walls by its reach test only the planes. Coincident centres take +z.
- **Step 4, the floor as support:**
  - a body touching the floor and not moving up sits at z = radius with vz = 0;
  - the ball, if closing faster than 0.3 m/s, bounces at 0.7 instead;
  - a terrier never bounces.
- **Step 5, impulses:**
  - accumulated normal impulses, clamped so the total never pulls, with mass-weighted effective masses;
  - Gauss–Seidel over the slots, both contacts of a slot computed from the same velocities and then applied;
  - 8 iterations, each a forward sweep and a back sweep;
  - the restitution target applies only above a 0.3 m/s closing speed. The ball keeps 0.7 off the walls, the overhead net and the frame, the goal netting's configured fraction (0.3 at A.5's start; settle tunes it, §9.6), 0.5 against a terrier, and terriers 0.3 off each other and the walls;
  - the floor takes part with no bounce;
  - no friction.
- **Step 6, positions:** 2 passes over the same slots, the floor included, by mass-weighted fractions of each overlap.
- **Step 7, slip-out:** M0's rule. A terrier on the floor with a body above it within 42° of vertical, found from step 3's contacts at the positions after step 6, has its speed away from the bodies above raised to at least 2 m/s, or along its heading if it's exactly centred. Its slipping flag stores the body it slipped from, the ball if the ball is above it.

**Acceptance: the port reproduces M0's figures to the digits REPORT.md prints.** physics-port's tests pin each one:
- **bit-still:** three scenes for 36,000 ticks each, settled from 1 µm overlaps, with their contacts counted;
- **bounces:** the floor at 0.6973–0.7031 of √(2gh), within 1%; walls, net, a post and the crossbar at 0.7 ± 1e-10; the back netting at its configured fraction, read from `SimParams`, so a tuned value moves the test with it (no bounce at 0); a terrier against the ball at 0.5, so 3, 4.5 and 5 m/s from hits at 6, 9 and 10 m/s; terriers at 0.3; no bounce at or below 0.3 m/s;
- **rolling:** within 1e-12 m/s a substep, and an exact stop;
- **simultaneous hits:** parallel, from the floor, 2.656, 3.571, 3.810 and 3.685 m/s; level, 3.000, 4.354, 4.999 and 5.213. Momentum moves by at most 1e-9, and kinetic energy never rises;
- **pushes:**
  - one pusher 1.225 s, two in a train 0.779 s, four in a train 0.575 s;
  - side by side, in the pitch frame and then the ball frame: two round the ball 0.829 and 2.033 s, two on a line 0.833 and 2.033 s, four round the ball 0.721 and 1.313 s, four on a line 0.758 and 0.921 s;
- **slip-out:** a rest case's worst at most 1.5 s on the spike's subset; two sitting terriers within 0.5 s (0.471 s); no dribble slips out; pinches mirrored.

**And the bits, pinned.** These are the same physics on the same scenes, so a faithful port moves the bodies by the same bits. Printed digits can't show that: a parameter computed another way moves an ulp (§1.5), C-21's window is only 1.2° wide, and the gate no longer re-runs M0's sweeps (§12).
- **The record:** once, in phase 2, the scratch script of §0 imports the spike and records `bodyHash` (§1.13, the same format, computed over the spike's state) for six scenes, at ticks 1, 60 and 600. Each runs under the spike's kept settings (flag42, 8 iterations, 2 passes), which are the port's defaults at phase 2.
- **At M0's values, always:** the port's side runs under a configuration copy at M0's values, written out in `step.test.ts`, where the scan doesn't look. So settle's tuning never moves the pins: they check the port, not the tuning.
- **The scenes:** `RESTING_BALL`, `ROLLING_BALL`, `pushScene('train', 1, 'pitch')`, `pinchScene(2)` from its countdown, `WALL_SCRUM` and `dribbleScene('ball', false)`, each with the spike's own coordinates and inputs.
- **The pins:** `step.test.ts` holds the 18 hex strings, with the spike's commit and this method in a comment beside them.
- **A mismatch** is a port bug, found before the first emit. It's never fixed by re-pinning.

**The spike's test switches** (`drive`, `friction` and `rolling` set to false) become settings of 0 in a configuration copy, with the same bits:
- **Acceleration 0:** the drive's cap is 0, so its step is 0, and v + 0 = v for every v but −0, which no hit test holds.
- **Idle friction 0:** `slow()` multiplies by (sp − 0)/sp, which is exactly 1.
- **Rolling slowdown 0:** the same as idle friction.

### 4.2 What changes in the port: structural only

- **Slots.**
  - `Physics` is built for 2 × pack size terrier slots and the ball's.
  - A slot may be empty while a warm-up pack isn't full, or in a test's short pack, and `bodies[slot]` is then `null`.
  - Every loop skips empty slots: forces, detection's pair and piece tests, support, slip-out. A template's test returns at once when either of its slots is empty.
  - Empty slots are still written where scratch is kept by slot: the broad phase's `near` is 0 for one, so no flag from another state's call is read. A body's start-of-substep velocity is written for every present slot.
  - A template whose mirror slot is empty finds one contact, which is the spike's "off mirror" case already.
- **Intents.** The drive reads `intents.driveOn[slot]` and `intents.targetVx/Vy[slot]`, not terrier fields.
- **The slipping hold-off.** The drive reads the body in its `slipFrom` slot only when that slot isn't empty. `vacate` (§6.1) keeps every `slipFrom` naming a present body, so this is a backstop that never fires in a valid state, which the property tests check (§7.7).
- **`ballFixed`.** In warm-up the ball is "fixed on the centre spot and never moves or bowls" (D-8). It must stay exactly still and finite, so it takes part in exactly these, and in nothing else:
  - **Detection:** none of the ball's piece templates, the floor's included. On the centre spot it could touch only the floor, at depth 0, which `pieceContact`'s `h > r` test lets through. Against a static piece, an immovable body has no effective mass: the spike's `prepare()` would compute 1/(0 + 0) = Infinity, and `impulseStep` Infinity × 0 = NaN, which `applyImpulse`'s `d === 0` test doesn't stop. Its pairs with terriers are detected as usual. The ball is its own mirror, so dropping all its piece templates keeps the order mirror-symmetric.
  - **Forces, integration and support (steps 1, 2 and 4):** skipped, so its position and velocity aren't touched. Its start-of-substep velocity is still recorded, and is 0.
  - **Impulses and position passes (steps 5 and 6):** its inverse mass is 0. A terrier–ball contact's effective mass is the terrier's, 1/w_terrier. The terrier bounces off at the terrier–ball restitution and is moved out by the whole overlap. The ball gains ±0 from every impulse and every move, and +0 + −0 is +0, so its bits never change.
  - So no contact has two immovable sides: every contact the solver sees in warm-up has a terrier in it.
  - **Its records:** its contacts set the pushing pose's ticks and the hit's tick and strength, and its hit's change is 0 (§2.3). Touches count only in play, and bowling is in play only.
  - **Each tick:** `ballFixed` is set from the phase before the substeps, and setting it writes the ball's inverse mass, 0 or 1/m. So nothing carries from another state's call.
  - **Its test** (`contacts.test.ts`, phase 2): a 2-a-side warm-up state with one slot empty. For 600 ticks the three terriers run at the ball at zoomies speed, jump onto it and pounce into it. The ball's position, velocity and floor flag keep their bits, every float stays finite, the terriers' contacts with it set their ticks, and a terrier running straight in at speed v leaves at 0.5 v. The "warm-up" golden hashes the same rules in every engine (§7.1).
- **Values come from `SimParams`.** The radius and inverse mass by slot are set at construction.
- **The rejected rules' branches go:** `restitution0`, `noBounce`, and the `flag` and `speed > 0` switches. The flag is always on.
- **`MARGIN = 0.01`**, the broad phase's slack, is marked `not a setting`, because the broad phase changes no contact.

### 4.3 What's around the solver: in `movement.ts` and `rules.ts`, ported from the spike's `step.ts`

- **Pounce (D-6):**
  - a new pounce press with no lunge or pounce wait, not tumbled, in warm-up or in play, sets the horizontal velocity to 10 m/s along the heading and keeps the vertical;
  - lunge = 18 ticks;
  - during the lunge, the heading is locked, jumps are refused, and neither the drive nor friction acts;
  - a contact with the ball, a terrier or a non-floor piece ends it, found before the solve;
  - its end starts the 90-tick wait;
  - from the floor or in the air.
- **Tumble (D-6):**
  - a lunging terrier tumbles a rival it touches; two lunging into each other both tumble. Only in warm-up and in play, never in a celebration (D-8);
  - Q-8's bowling, in play only (§6.9);
  - `tumble` does nothing to a terrier already tumbled or guarded;
  - otherwise it sets 90 ticks, ends any lunge, and clears the terrier's intents for the rest of the tick;
  - when it reaches 0, a 90-tick guard;
  - the get-up is the last 30 ticks;
  - a tumbled terrier can't act and slides under idle friction, and the ball still bounces off it.
- **Idle friction:** step 1, when `driveOn` is clear: no direction held, tumbled, sitting, or in a countdown or the end.
- **Sitting (D-16):**
  - set in step 2, from the start countdown on, after 120 silent ticks;
  - cleared by the terrier's next present input;
  - a sitting terrier can't act, is pushed under idle friction, can be tumbled, and sits again once up (the animation's order).
- **Zoomies (D-6):** step 4. A terrier zooms when:
  - it runs, a direction and zoomies are held, and in the nose frame f > 0;
  - its meter isn't empty and it isn't locked out;
  - it's on the floor and not lunging.

  The meter drains 2 half-ticks a tick while zooming and otherwise refills 1, to 360. The terrier is locked out when the meter empties while zooming, until an input that doesn't hold zoomies (or an absent one, which holds nothing).
- **Jump (D-6):** a new jump press, in warm-up or in play, on the floor and not lunging, sets vz = √(2g × 1 m), clears the floor flag and sets the take-off tick. A jump and a pounce in the same tick: the jump first.
- **Landing:**
  - step 4's support keeps a landing terrier on the floor with vz = 0 from any height (L312);
  - each substep compares the floor flag with the substep before: leaving the floor sets `takeOffTick` = t, and arriving sets `landingTick` = t.

### 4.4 The C-18 remedy: push-remedy, phase 4

Q-10 and C-18 ask the tuning page to compare remedies for pushers side by side. In ball view, the default, two abreast are slower than one pusher (2.033 s against 1.225 s), because each drives at the ball's centre and pushes forward only while the ball is under 6·cos φ.

- **What's built:** C-18's second candidate, "a ball-frame target whose component along the ball's travel is run speed". It's a steering rule (D-7), with no change to the solver.
- **The rule:**
  - in the ball frame, with a forward step held (step 0, 31 or 1) and the terrier touching the ball (`touchingBall`);
  - when the ball's horizontal speed is over 0.3 m/s, its direction u, and the direction to the ball d gives cos φ = d·u > 0;
  - the target speed becomes min(cap, base / cos φ), where base is the run or zoomies speed, still along d;
  - so its component along u is the base speed until the cap binds.
- **The setting:** `pushAssistCapMetresPerSecond`, 0 by default.
  - 0 is off, and off skips the rule entirely: no target changes, and the goldens don't either. A literal min(0, …) would stop every pusher, so the code never takes it.
  - On, the cap is at least the zoomies speed, so the assist never slows a pusher below its base speed. A configuration check says so (§10).
  - core-types adds the key, its A.5 row, its map entry and `SimParams.pushAssistCap` in phase 1. So push-remedy edits only `movement.ts` and `assist.test.ts` in phase 4, and the tuning page lists the key from its start.
- **Mirror symmetry:** d and u negate together, so cos φ is equal and P8 holds.
- **Exact:** one `Math.sqrt` and one division.
- **Not built:** terrier–ball friction. It changes the M0-validated solver, and the plan's model found it worse in ball view (C-18). It's built only if the owner asks, or the assist misses the marks at settle.
- **Tests (`assist.test.ts`):**
  - off, the goldens are unchanged without a re-emit;
  - on, two and four abreast in the ball frame beat their off times, and one pusher is unchanged, since it's on the ball's travel;
  - energy never rises in the hits with the assist on;
  - P8 holds at every pack size with it on.

---

## 5. Movement, steering and presses

### 5.1 A.2's u16, every value valid

| Bits | Field |
|---|---|
| 0–4 | direction step, 0–31, counter-clockwise from the frame's forward (2²⁷ units a step) |
| 5 | a direction is held |
| 6–7 | frame: 0 pitch, 1 ball line, 2 nose; 3 reads as no direction held |
| 8 | zoomies held |
| 9–10 | jump press counter |
| 11–12 | pounce press counter |
| 13–14 | bark press counter: never read by the simulation, and cleared from `prevInput` (`KEPT_BITS` = 0x1fff) |
| 15 | 0 when sent; ignored when read |

- **Masking:** `step` masks every input to 16 bits, `(x >>> 0) & 0xffff`. So every number, and every u16 in particular, is a valid input.
- **The fuzz test** (`properties.test.ts`) steps every u16 in a stride of 7, as the spike's did, plus random ones, in every phase. It checks that nothing throws, no NaN appears and the state stays valid, and that inputs differing only in bits 13–15 give equal hashes.

### 5.2 Step 4, per terrier, in list order (D-6, D-7, D-10)

1. **The input:** present if `sim.inputOf[slot] ≥ 0`, else absent. An absent input reads as 0: no direction, no zoomies, no presses.
2. **New presses:** in a present input, a jump or pounce counter that differs from the one in `prevInput`. Then `prevInput = input & KEPT_BITS`. An absent input leaves `prevInput` unchanged, so the next present input is compared with the last present one.
3. **The ball-overhead flag and its reference (D-7),** for every terrier every tick, whatever its frame, from the positions at the start of the tick:
   - h² is the horizontal centre distance squared;
   - if the flag is clear and h² < 0.3², it sets and `overheadRef = heading`;
   - if it's set and h² > 0.4², it clears.
4. **What the phase allows (D-8):**
   - `canAct` = not tumbled and not sitting;
   - `run` = canAct, in warm-up, in play or in a celebration;
   - `turn` = canAct, in any phase but ended. That includes countdowns ("turn on their spots");
   - `press` = canAct, in warm-up or in play.

   A press that can't act is still consumed in step 2, so it's dropped, never deferred (D-10).
5. **Zoomies' release:** if the input doesn't hold zoomies, the lockout clears.
6. **The direction, in its frame (D-7):** with step k, k × 2²⁷ is the step's angle.
   - **Pitch frame:** the target angle is k × 2²⁷, from +x.
   - **Ball frame:** forward is `overheadRef` while the flag is set, else `datan2(ball.y − y, ball.x − x)`. The target angle is forward + k × 2²⁷.
     - A held step under an overhead ball turns the terrier once, to the reference plus the step, and holds there: it never chases its own heading (L75).
   - **Both of those frames turn:** if `turn` and not lunging, diff = angleDiff(heading, target); a |diff| of at most `turnPerTick` snaps to the target, otherwise the heading moves by ± `turnPerTick` (2 turns/s). The drive's direction is `dir(target)` and its scale 1.
   - **Nose frame:** (f, s) = dir(k × 2²⁷).
     - If `turn` and not lunging, the heading moves by round(s × `noseTurnPerTick`), on the floor or in the air.
     - The drive's direction is `dir(heading)`.
     - The speed is f × run speed for f > 0, or f × zoomies speed while zooming; f × 3 m/s for f < 0, so back brakes and then reverses; and 0 for f = 0, which with the drive on brakes at 15 m/s².
7. **`headingChange`** = angleDiff(old heading, new heading).
8. **Zoomies and the meter** (§4.3); `intents.zooming[slot]`.
9. **Jump, then pounce** (§4.3).
10. **The drive:**
    - `intents.driveOn[slot] = run && held`;
    - the target is the speed times the drive's direction;
    - the speed is run speed, or zoomies speed while zooming, in the pitch and ball frames; the nose frame's as above;
    - push-remedy's assist adjusts the speed here (§4.4).

**C-47** (holding sideways in ball view spirals out, about 0.3 m a lap) is accepted, as D-7 allows. The tuning page shows the drift per lap (§9). An inward correction would be a new setting for the owner to ask for.

### 5.3 D-10's press counters

- **A press acts once:** for each new count, compared with the previous present input. A counter that jumps 2 or 3 in one tick acts once, and one that goes round the full 4 in a tick acts none: A.2's 2-bit counters can't say more.
- **Prediction never repeats a press:** M3 predicts the last input, whose counters equal `prevInput` once it has acted.
- **A tap shorter than a tick still counts:** the counter changed between two samples.
- **Absent ticks:** after 1 or 13 of them, the next present input acts its new count once.
- **A returning player:** its browser starts its counters from the adopted state's `prevInput`, so its first input acts nothing. So does a bot's brain (`newBrain(id, prevInput)`).
- **Tests:** `movement.test.ts` (ported) and `properties.test.ts`.

---
## 6. Rules: D-8, D-12

### 6.1 Events, step 1, warm-up only

Over the canonical inputs, which are in ID order:

1. **LEAVE:** a member is removed (`removeTerrier`). That frees its place. It first vacates the member's slot: `vacate` clears every terrier's slipping flag and `slipFrom` that name it.
2. **SWITCH:** applies to a member when its `switchPack` is 0 or 1 and isn't its own, and that pack has fewer than pack-size terriers. Then:
   - its old slot is vacated, as for a LEAVE, since its slot changes with its pack;
   - its pack changes, and its Ready is cancelled (`readyUntil = 0`, D-12);
   - it arrives in the new pack (§6.5), its body reset as an arrival's: at rest, timers 0, meter full, flags clear, its own slipping clear and `slipFrom` −1;
   - otherwise it's ignored. The session gives up on it at M3.
3. **JOIN:** applies to a non-member when its `joinPack` is 0 or 1 and that pack has a free place. Then:
   - a new terrier with this ID, `cleanName(name)`, the pack, and its coat if it's an integer in [0, `coatCount`), else 0;
   - `joinTick = lastInputTick = t`, `readyUntil = 0`, `prevInput = 0`, counts 0;
   - it arrives (§6.5).

   Two JOINs for a pack's last place in one tick: the first in ID order takes it.
4. **READY:** a member's `readyUntil = t + 3600`.
5. **UNREADY:** a member's `readyUntil = 0`. READY and UNREADY in one input leave it not ready, as roslambo's do.
6. **Then** `sortTerriers`, and step re-binds the slots (§3).

Three more cases:
- **A non-member's events other than JOIN** are ignored, and so are a member's JOIN and an absent ID's (it has no entry).
- **A JOIN and a SWITCH in one input** each keep their own pack. For a non-member, the SWITCH comes first in the order and is ignored, then the JOIN applies with `joinPack`. The session re-sends the SWITCH until the state shows it (D-12), so the switch lands a tick later. For a member, the JOIN is ignored and the SWITCH applies.
- **A LEAVE plus a JOIN** re-joins the ID in `joinPack`.

**Why every freed slot is vacated:** a terrier that another lands on slips from the upper body's slot, and keeps `slipFrom` until that body is on the floor. If the upper one leaves, is removed or switches, its slot empties, or another arrival takes it in the same tick. The drive would then read an empty slot in the next substep and throw on every peer, or hold off toward the wrong body. One `vacate` for all three keeps every `slipFrom` naming a present body. `events.test.ts` checks it: B lands on A in warm-up and A slips from B's slot; B switches packs, in one test, and leaves and is replaced by a JOIN in the same tick, in another; nothing throws, and A's `slipFrom` is −1.

### 6.2 Presence, step 2

- **Present:** each terrier with an input this tick gets `lastInputTick = t` and `sitting = false`.
- **Warm-up:** a terrier with t − `lastInputTick` ≥ 180 is removed (roslambo Q-15), its slot vacated first. Then `sortTerriers`.
- **From the start countdown on:** an absent terrier with t − `lastInputTick` ≥ 120 sits. So a LEAVE during the start countdown, which is ignored, sits its terrier 2 s later, on its spot (L138, D-16).

### 6.3 Phase changes, step 3, in this order

1. **Ready expiry,** in warm-up: `readyUntil ≠ 0` and t ≥ `readyUntil` → 0.
2. **The start countdown:** in warm-up, both packs at pack size, and every terrier's `readyUntil > t`. Then START_COUNTDOWN, phaseStart = t, and the kickoff placement. Bots are ready by their host's READY (§3).
3. **A countdown's end:**
   - START_COUNTDOWN with t − phaseStart ≥ 300, or KICKOFF_COUNTDOWN with t − phaseStart ≥ 180;
   - then IN_PLAY, phaseStart = t.
4. **A celebration's end:** CELEBRATION with t − phaseStart ≥ 204 (3 s seen plus w + v, Q-7). Then:
   - in overtime, ENDED;
   - else, at clock 0 with the packs not level, ENDED;
   - else, at clock 0 and level, a goal in the last tick having levelled it: overtime = true, clock = 0, KICKOFF_COUNTDOWN and the placement;
   - else, KICKOFF_COUNTDOWN and the placement.

### 6.4 The kickoff placement (D-8)

At the start of each countdown, in step 3 or 6:
- **Spots:** within each pack, terriers sorted by player ID, a string compare of the 32 lower-case hex digits, take spots 0, 1, … in that order. A bot's ID derives from its host's, so the rule covers bots. Then `sortTerriers`, and step re-binds the slots (§3).
- **The ball** is at rest at (0, 0, R), on the floor.
- **Each terrier, sitting ones included:**
  - at rest on its spot: pack A's from A.5, pack B's their point mirror, at z = r on the floor;
  - heading `datan2(−y, −x)`, toward the centre, with `overheadRef` = heading and the overhead flag clear;
  - slipping clear and `slipFrom` −1;
  - zoomies lockout clear, meter full;
  - pounce wait, lunge, tumble and guard 0;
  - touching clear, `headingChange` 0;
  - anim SITTING or STANDING, with `animStart = t` if it changed.
- **Unchanged:** `prevInput` (D-10), counts, contact, take-off, landing and push ticks. Those are animation history: D-16 drops smoothing across a kickoff.
- **The match:** `scorers = 0`.
- **The tick's intents** are cleared, so step 7 doesn't animate a terrier just placed as running.
- **Mirrors:** pack B's spot k is pack A's spot k negated, exactly, so a mirrored kickoff starts mirrored (P8).

### 6.5 Warm-up arrivals (D-8)

A JOIN, or a SWITCH into the other pack:
1. **The spot** is the pack's lowest spot index that no member holds.
2. **The candidate** is that spot's point, pack A's from A.5 or pack B's mirror, at z = r.
3. **Clear** means strictly apart from every body there now: each other terrier's centre more than 2r away, and the ball's more than R + r, in 3D. That includes the terriers placed earlier in the same tick, so it reads `s.terriers` and `s.ball`, never `sim.bodies`, which step binds again only after step 1 (§3).
4. **If the spot is clear,** the terrier goes there.
5. **Otherwise,** it steps from the spot toward its own goal line, x − 1 m for pack A and x + 1 m for pack B, at the same y. It takes the first point that is clear and inside the floor plan by r (`insideFloorPlan(shape, x, y, r)`).
6. **If no point is clear before it leaves the floor plan,** it goes on the spot, and the position passes push it out (D-5).
7. **Its body:** at rest, facing the ball (`datan2(−y, −x)`), meter full, timers 0, flags clear, `slipFrom` −1, `overheadRef` = heading, anim STANDING with `animStart = t`. Facing the ball is M2's choice; D-8 doesn't say.
8. **Its spot** is the one it arrived on, until the start countdown's placement ranks the pack by ID.

### 6.6 The clock, step 6, and the end

- **When it runs:** only if the tick began in play, which means in play after step 3. So the clock counts exactly the ticks played, the countdown's last tick not among them.
- **In overtime** it counts up, saturating.
- **Otherwise** it counts down by 1. When it reaches 0 with the phase still IN_PLAY, so no goal this tick:
  - with the packs not level: ENDED, phaseStart = t;
  - level: overtime = true, clock = 0, KICKOFF_COUNTDOWN, phaseStart = t, and the placement.
- **A goal in the tick that brings the clock to 0** has already started its celebration in step 5, so step 6 leaves the phase alone, and the celebration's end decides (§6.3). That's L107.
- **The clock stops** from a goal until the next kickoff countdown ends, because it runs only in ticks that begin in play.
- **ENDED is terminal.** Later ticks only advance the tick (§3). So the state a browser arriving at Results takes is the final one, unchanged (C-50, D-17). roslambo's frozen round is the same. D-8 doesn't say what terriers may do once the match has ended (§14, Q-2).
- **`winner(s)`:** in ENDED, the pack with more goals.
- **`terriest(s)`:** the list indices with the most goals, then the most touches; terriers still level share it. Own goals credit nobody (L112).

### 6.7 What every valid state keeps: `valid.ts`'s `stateProblems`

**Structural,** written by core-types in phase 1:
- The phase is 0–5. The pack size is within the configuration. The match length is positive.
- n ≤ 2 × pack size, with each pack at most the pack size.
- The list is strictly in (spot, pack) order, with spot < pack size.
- IDs are unique, and `isPlayerId`.
- Names pass `cleanName` unchanged.
- Coats are < `coatCount`.
- Every float is finite: positions, velocities, the ball's hit strength and its hit's change.
- Flag bits 6–7 are clear.
- `slipFrom` is −1, the ball's slot, or another present terrier's slot, and `slipping` is set exactly when `slipFrom` isn't −1.
- The meter is ≤ 360.
- Timers are within their maxima: lunge ≤ 18, wait ≤ 90, tumble ≤ 90, guard ≤ 90.
- Anim is 0–7.
- `scorers` < 2ⁿ.

**From the rules,** added by rules in phase 3, which owns the file from then on:
- Overtime only in a phase from the kickoff countdown on.
- Outside overtime the clock is at most the match length. `genesis` checks the length's 1–10 minutes; a placed test state's 2³¹-tick length and clock are valid.
- From the start countdown on, both packs are full. A real match can't break it: the start countdown needs full packs, and nothing leaves after it. The marks' short packs break it on purpose (§2.3), and are never encoded for a peer.
- `readyUntil` is 0 or at most the tick plus the Ready expiry; `joinTick` and `lastInputTick` are at most the tick.

`decodeState` applies all of them, so a peer's STATE can't put a state that breaks `step` into the timeline.

### 6.8 Goals, credit and the scorers (D-8)

- **The test,** every substep, in play only: the ball's centre more than its radius behind a goal line, x < −(20 + R) or x > 20 + R. Only the mouth lets it there, which the fuzz checks.
- **The pack that scores** is the one attacking that goal: pack B for the −x goal, pack A for the +x.
- **Credit:** the scorers are the terriers whose `lastBallContactTick` equals the ball's `lastContactTick`, the latest contact, at tick granularity, among those attacking that goal.
  - Several of them share it, each counting a goal (C-26).
  - If none attacks that goal, it's an own goal and credits nobody, but it still counts for the attacking pack (L108).
- **Recorded:**
  - `score[pack]++` and `lastGoalTick = t`;
  - `lastGoalPack`, `ownGoal = (scorers = 0)` and `scorers`;
  - each scorer's `goals++`;
  - CELEBRATION, phaseStart = t.
- **The first goal of the tick counts.** The ball is out of play from then on: later substeps aren't in play, so they count no touch and test no goal.
- **The scorers bitmask** clears at the next placement. The tick, pack and own-goal flag stay for the net's bulge (D-9).
- **Tests** (`rules.test.ts`, §16's "goal tests at the posts, the crossbar and the netting"), on the main pitch and on `SECOND_SHAPE`, from placed states with every terrier parked:
  - a ball sent onto each post and onto the crossbar from in front, rolling and in the air, bounces off and doesn't score;
  - a ball sent over the crossbar, against the end wall above the mouth, bounces back and doesn't score;
  - a ball sent through the mouth into the back netting, each side netting and the top netting scores once. It scores in the substep its centre first passes the line by R, and the score stays at 1 through the celebration while it meets the netting;
  - credit, own goals, shared credit, the scorers, and a goal in the tick that brings the clock to 0 (L107).

### 6.9 Touches, the re-arm gap and Q-8

- **Touches:** a terrier–ball contact sets `touchingBall`. If the flag was clear, that's a new episode, and in play it counts a touch.
  - Every contact counts, from tumbled and sitting terriers included.
  - The flag clears once the surfaces are 0.6 m apart (`gap ≥ rearmGap`, A.5) and at a placement.
- **Bowling (Q-8), in play only:** the ball's horizontal velocity along the horizontal line from the ball to the terrier, read before the contact is settled, at 4 m/s or more. A horizontal offset of 0 reads as 0.
  - **Exempt:** a lunging terrier, and the terrier that touched the ball last, whose `lastBallContactTick` equals the ball's (not NEVER).
  - **Also never bowled:** a terrier already tumbled or guarded.
- **Pounce tumbles** come from rivals' contacts in warm-up and in play, never a packmate's.

### 6.10 What each phase allows

| Phase | Run, zoomies | Turn | Jump, pounce | Pounce tumbles | Bowling, touches, goals | Ball |
|---|---|---|---|---|---|---|
| Warm-up | yes | yes | yes | rivals | no | fixed (§4.2) |
| Start or kickoff countdown | no: placed, at rest; held directions act from the first tick of play | yes | dropped | no | no | at rest |
| In play | yes | yes | yes | rivals | yes | physical |
| Celebration | yes, zoomies included (§14, Q-3) | yes | dropped | no | no | physical |
| Ended | no; terminal | no | no | no | no | frozen |

---

## 7. Determinism

### 7.1 The goldens: §16's list, each with its checkpoints and its coverage

Checkpoints come every 500 ticks, with the final hash, the run's counters and its event counts (§1.15).
- **Genesis runs** play a match through the rules from tick 0. Their IDs come from `rankedIds`, their JOINs from tick 1 and READYs a few ticks later.
- **Placed runs** start from a scene's state (§1.12), in play with a 2³¹-tick clock unless the table says otherwise.
- **The last column is asserted,** not only described: it's each run's `covers` and `checks` (§1.15, §7.2).

| Run | Start | Pack size | Ticks | Checkpoints | Covers, asserted (§16) |
|---|---|---|---|---|---|
| match 1 | genesis, 1 minute | 1 | 4,500 | 9 | a pack size, all three frames (`chasey 'all'`); a goal and the kickoff after it |
| match 4 | genesis, 1 minute | 4 | 4,500 | 9 | the same at 4 a side, with zoomies; a goal, a pounce and a tumble |
| regulation end | genesis, 1 minute | 1 | 4,500 | 9 | pack A's terrier holds at the +x goal from the whistle and scores, then nothing is held: the clock reaches 0 with A ahead, and the match ends with no overtime |
| overtime | genesis, 1 minute | 1 | 5,000 | 10 | regulation 0–0 with nothing held; the overtime kickoff; a scripted push into the +x goal; the overtime goal's celebration; ENDED |
| roster | genesis, 1 minute | 2 | 6,000 | 12 | JOINs to each pack; a JOIN to a full pack; bad pack bytes (2, 255); a bad coat (200); bad names (21 characters, 33 bytes, a control character, a C1 character, a lone surrogate); SWITCH with and without room; a JOIN and a SWITCH in one input; LEAVE and re-JOIN in one tick; two JOINs for one last place; READY, UNREADY, an expiry at 60 s; a removal after 180 silent ticks; then the start countdown, a LEAVE during it (ignored), a terrier sitting after 120 silent ticks and standing again. Each outcome is a check at its tick |
| warm-up | genesis, 1 minute | 2 | 2,400 | 4 | 1,200 ticks of warm-up play: terriers run and jump into the fixed ball, and a pounce tumbles a rival; then READY, the start countdown and play. Checked: the ball's body bits at the centre spot through warm-up, a warm-up tumble, warm-up contacts with the ball |
| mirrored kickoff 1, 2, 3, 4 | genesis | 1–4 | 3,000 each | 6 each | each pack size; a mirrored kickoff (P8's runs, hashed); seeded `'contact'` play |
| resting ball | placed | 1 | 3,000 | 6 | a resting ball |
| rolling ball | placed | 1 | 3,000 | 6 | the rolling slowdown |
| push 1, train 4, abreast 2 ball frame, abreast 4 ball frame | placed | 1, 4, 2, 4 | 600 each | 1 each | pushes (C-18) |
| squeeze | placed | 1 | 1,200 | 2 | a squeeze |
| pinch 2; pinch 4, zoomies | placed (kickoff countdown) | 2, 4 | 1,500 each | 3 each | the kickoff pinch and its slip-out (C-21): slip-outs seen |
| scrum at the wall; scrum in the corner | placed | 4 | 3,000 each | 6 each | the densest contacts (C-2's script) |
| pounces and tumbles | placed | 2 | 3,000 | 6 | pounces, pounce tumbles, Q-8's bowling |
| nose frame | placed | 2 | 2,000 | 4 | vehicle-style steering, forward, reverse and turning |
| goals and own goals | placed | 1 | 3,000 | 6 | a goal, an own goal, credit, the celebration, a kickoff |
| long run | genesis, 3 minutes | 4 | 10,000 | 20 | everything, `chasey 'all'` |
| canary | placed | 4 | 300 | 0, final only | D-23 (§7.3) |

That's about 87,000 ticks, against the spike's 89,000. In Node the spike's took 1.6 s, so this suite should take about 1.5–2 s in Node and in each engine (the spike's took 1.7–2.9 s an engine).

**Why "regulation end" is its own run:** a 1-minute genesis run spends about 3,900 ticks on its JOINs, the 300-tick start countdown and 3,600 ticks of play, and each goal adds 384 (the celebration and the kickoff countdown). So match 1 and match 4 reach 0:00 within 4,500 ticks only if they score at most once, and the long run never does. A scripted lead is the only way a golden is sure to end in regulation.

**Notes for the scripts:**
- **Arrival order:** `scriptTickInputs` hands each tick's inputs over reversed, as roslambo's do, so P4 is exercised every tick.
- **IDs:** `rankedIds(seed, n)` gives each pack's IDs in ascending order, so member (pack, rank) has the rank-th smallest ID of its pack, and in a mirrored script rank k of pack B mirrors rank k of pack A.
- **Seeds:** the goldens builder picks each seeded run's seed, or adjusts its script, until its coverage passes, as for the canary (§7.3). The seeds are then fixed, and a later change that loses a run's coverage fails the test.
- **Not in the goldens:**
  - D-4's second shape: P8 and the tunnelling fuzz run it in unit tests (§14, Q-14);
  - the bot brain: the goldens would change whenever it's tuned, which is why D-39 keeps bots out of the simulation.
- **The config scan:** a script coordinate that equals a setting's value carries `not a setting: a script's coordinate`, or is written from `SimParams` (`R + r`).

### 7.2 `goldens.json` and `golden.test.ts`

```json
{ "codec": 1, "checkpointEvery": 500, "canary": "<16 hex>", "runs": [ { "name": "...", "checkpoints": [], "final": "...", ... } ] }
```

- It's committed at `src/core/sim/goldens.json`.
- `golden.test.ts` replays the suite once per process, shares it among its tests, and compares with the file checkpoint by checkpoint, then run by run, counters included.
- **Each run's coverage:** `coverageProblems(spec, result)` is empty for every run. That covers:
  - its counts, at least as many as its `covers` names: goals, pounces, tumbles, hits, bounces (floor and piece), pushes and slip-outs;
  - the phases it names, each seen at a tick's end;
  - overtime seen, or never seen;
  - how it ended;
  - and each check at its tick, the roster run's outcomes among them.

  So a run that stops covering its column fails, even if its hash was re-emitted.
- **The canary's coverage** is in its `covers`: a push, a bounce off the floor or a piece, a pounce, a tumble and a goal (§7.3).
- The same file is checked in each engine (§7.5), on CI's arm64 (`npm test`), and from M3 by the build hash (D-21).
- **That nothing carries between calls** is `step.test.ts`'s and `events.test.ts`'s check (§7.7, R-14), not this file's: one `Sim` steps two different states and a mid-run clone in turn, and every tick's hash matches a fresh `Sim` per state.

### 7.3 The canary (D-23)

- **The run:** 4 a side, placed in play, for 300 ticks:
  - the ball 4 m in front of pack B's goal mouth;
  - pack A's four behind it, holding at it in the ball frame, with zoomies in spells;
  - pack B's four off its flanks, pouncing on a schedule into pack A's terriers and the ball.
- **It must contain** pushes, a wall or floor bounce, a pounce, a tumble and a goal. Its `covers` asserts each from the run's counters: `pushes` ≥ 1, `floorBounces` + `pieceBounces` ≥ 1, `pounces` ≥ 1, `tumbles` ≥ 1 and `goals` ≥ 1. A plain hit count can't stand in for them, since a terrier's hit, a floor bounce and a wall bounce all set it alike. The goldens builder tunes the setup until those pass.
- **Cost:** about 10 ms in Node (the spike's 400-tick canary took 12.8 ms), so about 40 ms on a 4×-throttled phone.
- **When it runs:** wiring it to Propose and Join is M4's (D-23, §16's "A failed canary"). M2's determinism page computes it, and `canaryHash()` is ready for the module's start-up. M4 decides whether it runs at start-up or once before Propose and Join first show.

### 7.4 `emit-goldens`

- `package.json`: `"emit-goldens": "node scripts/emit-goldens.mjs"`.
- **The script:**
  - without `TERRIEST_EMIT_GOLDENS=1`, it prints "Refusing to rewrite src/core/sim/goldens.json: set TERRIEST_EMIT_GOLDENS=1 to re-emit it on purpose" and exits 1 (CLAUDE.md);
  - with it, it runs `vitest run src/core/sim/golden.test.ts` in a child process with `TERRIEST_EMIT_GOLDENS=1` and `TERRIEST_EMIT_GOLDENS_BY_SCRIPT=1`.
- **`golden.test.ts`:**
  - writes the file only when both variables are set, and only when every run's coverage passes, so an emit can't record a run that has stopped covering its column;
  - fails if only the first is set, saying to use `npm run emit-goldens`. So a stray exported variable can never let `npm run check` rewrite the goldens and pass.
- **`scripts/emit-goldens.test.mjs`** checks the refusal and its exit code.

### 7.5 The `#test=determinism` page and its spec

- **The route in `src/main.ts`:** if `new URLSearchParams(location.hash.slice(1)).get('test') === 'determinism'`, `start(boot)` runs `(await import('./determinism')).run(boot)` and returns before it makes a canvas. Without that fragment, the page does exactly what M1's did.
  - The dynamic import takes a plain string (D-38), so the goldens, the scripts and the rest of the simulation load as a chunk of their own and never weigh on the pitch's download.
  - M3's `#test=net` and M4's `#test=frames` hang off the same parse.
- **`src/determinism.ts`'s `run(boot)`:**
  - makes `<main id="determinism"><h1>Determinism</h1><pre>Replaying …</pre></main>`, then calls `boot.started()`. That removes the loading message, so there's one main landmark at a time, and cancels the 20 s load timeout;
  - after a 50 ms timeout, so the message paints, it runs `goldenSuite()` and `canaryHash()`;
  - it compares them with the bundled `goldens.json`, counters, coverage and unmet checks included, and publishes `window.terriestDeterminism` (a `DeterminismReport`);
  - it sets `html[data-determinism]` to `pass` or `fail` and prints the verdict, so the page can be opened by hand in any browser: real Safari at M5 (Q-12) or your desktop browsers;
  - it needs no WebGL and makes no request beyond its chunk.
- **The page's own global:** `window.terriestDeterminism` exists only on this page (roslambo's `roslamboDeterminism`). The normal page's `window.terriestTest` hook doesn't change.
- **The page's text:** no string in the chunk starts with `/` or looks like a host, which the dist audit would fail.
- **`e2e/determinism.spec.ts`,** in each engine's project (not `*.net.spec.ts`, so `playwright.config.ts` runs it once per engine):
  - imports `test` from `e2e/lib/guards.ts`, so a console error or an outside request fails it;
  - calls `expectWebGL2` first, as every spec does (CLAUDE.md);
  - goes to `./#test=determinism` and waits for `data-boot="started"`, then for `window.terriestDeterminism`, polling every 250 ms with a 150 s timeout and `test.setTimeout(180_000)`;
  - compares every run with `src/core/sim/goldens.json`, read from disk: the first differing checkpoint by name and tick, then the whole run;
  - checks the canary and `html[data-determinism] = pass`.

### 7.6 P8: mirrored runs compared by value

`mirrorMismatches(s)` compares each pair (A_k, B_k) = `terriers[2k], terriers[2k + 1]` with `===`, so +0 matches −0:
- **Positions and velocities:** x and y negated, z equal.
- **Angles:** `heading`, `overheadRef`, and `lastPushDir` (only once pushed) + 2³¹, `>>> 0`.
- **`prevInput`:** `mirrorInput` of A's.
- **`slipFrom`:** −1 and the ball's slot stay, and a terrier slot becomes `slot ^ 1`.
- **Every other field equal:** spot, joinTick, readyUntil, lastInputTick, onFloor, sitting, zoomLocked, ballOverhead, slipping, touchingBall, meter, the four timers, touches, goals, anim, animStart, gait, takeOffTick, landingTick, both contact ticks, lastPushTick and headingChange.
  - Integer headings make `headingChange` equal exactly.
- **Except identity and pack:** id, name, coat and pack.
- **The ball** has its x, y, vx, vy, `lastHitDvx` and `lastHitDvy` each equal to their own negation, so ±0.

`mirror.test.ts` runs it after every substep through `sim.probe`, from a kickoff countdown, at every pack size, on the main pitch and `SECOND_SHAPE`:
- seeded inputs in all three frames, pack B's through `mirrorInput`;
- the pinches;
- with the slip-out firing.

`assist.test.ts` repeats it with the assist on. The goldens are what check bits across engines; P8 checks the mirror.

### 7.7 The property and fuzz tests: `properties.test.ts` (rules)

- **P4:**
  - random rosters of 1–12 IDs;
  - random event bits, `joinPack`, `switchPack` and coats as any byte, a JOIN and a SWITCH together and apart, random names (long, control characters, C1 characters, emoji, lone surrogates), and random u16 inputs, for 300 ticks from genesis;
  - each tick's list shuffled two ways and duplicated;
  - the hashes are equal every tick.
- **`step` never throws, and the state stays valid:**
  - the same generators, plus every u16 in a stride of 7, at every phase;
  - warm-up states with terriers stacked on each other and slipping, then LEAVEs, removals and SWITCHes of the upper and the lower ones;
  - every 10 ticks, `stateProblems(s)` is empty, and `encodeState(decodeState(encodeState(s)))` equals `encodeState(s)` byte for byte. So no `slipFrom` ever names an empty slot, and the drive's backstop (§4.2) never fires;
  - the ball is `insideRegion` with 0.11 m of slack, about a substep's travel at 25 m/s.
- **Short packs:** in-play states with one pack short, as the marks build them, step under the same generators without throwing, and `stateProblems` finds nothing in them but the full-pack rule.
- **Non-finite floats:** `encodeState` refuses NaN and ±Infinity anywhere, and every state it encodes decodes.
- **The bark bits never reach the hash:** inputs differing only in bits 13–15 give equal states.
- **A press after 1 and 13 absent ticks acts once;** a returning player's first input acts none (D-10).
- **Size:** fast-check at its default 100 runs a property, with short runs, about 3.5 s in all.

**One `Sim`, many states** (R-14). `step.test.ts` (phase 2) steps one `Sim` over two different in-play states, the wall scrum and a seeded kickoff, and a clone of the first taken at tick 100, in turn, tick by tick. Each tick's hash must match the same state stepped by a fresh `Sim` of its own. `events.test.ts` (phase 3) does the same with two warm-up states taking JOINs, SWITCHes and arrivals in the same ticks.

---

## 8. Bots

### 8.1 What the brain is

- **Where it runs:** on the host only (D-39). It reads the state, the predicted head at M3, and returns the u16 input a person would send, in the pitch frame.
- **Its memory is its own:** counters, a perception ring, noise and stuck tracking. Nothing it holds is in the state.
- **No time but the state's:** it uses no clock, `Math.random` or `crypto`.
- **Exact operations:** under exact-ops (D-38), with `dir`, `datan2`, `fractionOfTurn` and `mix` from `src/core/sim/math.ts`. Its seeded marks therefore count the same on x86, arm64 and in every engine.
- **Slots:** it reads bodies by slot and skips empty ones, so the empty-goal mark's short pack is an ordinary state to it (§0).

### 8.2 `think(brain, s)` each tick

1. **Find its terrier** by ID. If it's absent, or the phase is ENDED, return 0.
2. **Perceive,** into a ring of `reactionTicks` + 1 entries:
   - the ball's x, y, z, vx and vy;
   - each present slot's x, y and pack;
   - the entry the bot decides from is the one `reactionTicks` (15) old, or the oldest it has, so a fresh brain acts on what it sees at once;
   - its own position and heading are read now.
3. **Phases:**
   - **Warm-up:** wander. Seeded spells of directions, as the scenes' `chasey`, with zoomies one spell in four and no pounces.
   - **Countdowns:** hold the pitch-frame step toward the ball, so it turns on its spot to face it; held directions act from the first tick of play.
   - **Celebration:** hold nothing.
4. **In play, roles by distance rank within the pack (Q-9),** from the delayed perception, by horizontal distance to the ball, ties to the lower slot:
   - **The nearest:**
     - **CHASE** while no rival is nearer the ball than it is.
       - The approach point is behind the ball on the line from the attacked goal's centre, R + r + 0.3 m back from its centre.
       - If the bot is on the goal side of the ball, it goes round by a side waypoint, R + r + 1 m off the ball on its own side, and never through the ball's footprint.
       - Once behind it and aligned, its target is the ball's centre, which pushes it goalward.
     - **FALL_BACK** when a rival is nearer.
       - Its target Q is the point 3 m from the ball toward its own goal's centre, on the segment between them.
       - Once goal-side of the ball and within 1.5 m of Q, it meets the ball from there: it chases with its own goal in place of the attacked goal, which clears the ball away from it (L142).
   - **The second: SUPPORT.** `supportMetres` behind the ball, toward its own goal, clamped inside the floor plan by 1 m.
   - **The rest: DEFEND.** On the line from its own goal's centre to the ball, `defendMetres` out from the goal line.
5. **Steering:**
   - the step is `((datan2(target − me) + noise + 2²⁶) >>> 27) & 31`, rounded to the nearest of 32;
   - the noise is redrawn every `reactionTicks` from `mix(seed, period)` as a uniform offset of up to ± `aimNoiseUnits`, and the seed is `botSeed(id)`. Mirrored bots have different IDs, so they diverge (§16);
   - within 0.5 m of a SUPPORT or DEFEND target it holds nothing.
6. **Zoomies:** held in CHASE or FALL_BACK while the target is over `zoomiesBeyond` (5 m) away. Released for a tick when the meter is empty and locked out.
7. **Pounce:** the counter goes up in CHASE when:
   - the ball's surface is within `pounceWithin` (2 m);
   - the heading is within `pounceAlignUnits` (20°) both of the line to the ball and of the ball-to-goal line;
   - the ball's centre is under 2 m up;
   - the terrier has no lunge and no wait.

   **Jump:** the counter goes up when the ball is in the air, its centre 1–2.5 m up and within 1.5 m horizontally. That's D-39's "a jump or a pounce when the ball is in reach and lined up with the goal".
8. **Bark:** the counter goes up about every `barkEveryTicks` (5 s). Each next bark is drawn from `mix(seed, n)`, uniformly within `barkGapTicks` either side of `barkEveryTicks` after the last. `barkGapTicks` comes from the Bark setting (`barkMaxPerSecond`, L327), a second today, so the jitter is a second either way, and no bark comes within the gap of the last. A configuration check keeps `botBarkEverySeconds` at least two gaps (§10).
9. **Unstick:** if it has held a direction for `stuckTicks` (2 s) without its centre leaving a `stuckMetres` (0.5 m) circle, it holds the opposite step for 30 ticks, with a jump, then resumes. That's well inside the mark's 5 s.

**Counters:** jump, pounce and bark count mod 4, starting from `prevInput`'s (D-10).

### 8.3 Bot IDs (from roslambo)

- **IDs:** version-8 UUID digits, derived from the host's ID and the slot. So a host finds its bots again after a reload, and a receiver checks that a bot's inputs come from its host (M3). `isBot` reads digit 12.
- **Coats:** seeded by the ID (D-39), sent in the bot's JOIN by its host. `BOT_SLOTS` is 2 × 4, so Practice's 7 bots fit.

### 8.4 Its settings (§10)

- **Rows:** `botReactionSeconds` (0.25, which exists), `botAimNoiseDegrees`, `botZoomiesBeyondMetres`, `botPounceWithinMetres`, `botPounceAlignDegrees`, `botSupportMetres`, `botDefendMetres`, `botBarkEverySeconds`, `botStuckSeconds` and `botStuckMetres`. The bark gap is the existing Bark setting, `barkMaxPerSecond`.
- **Derived:** `derive()` gains `botBarkEveryTicks`, `botStuckTicks` and `barkGapTicks`, the ticks of 1 / `barkMaxPerSecond`, each through its whole-ticks check. `botParams` reads them.
- **Code constants** (the role codes, the 0.3 m approach slack, the 1 m side offset, the 3 m fall-back point, the 30-tick escape) are marked `not a setting: the brain's geometry`, or promoted to settings if tuning moves them.

### 8.5 Q-9's marks: test design

Each mark runs over 100 seeds. A seed picks the hosts' IDs, through `botIds(hostOf(seed))`, so it sets the bots' IDs, coats and noise, and it picks the placements, through `mix`.

| File | Mark (§16) | Setup | Runs | Asserts | CPU here |
|---|---|---|---|---|---|
| `marks-empty-goal.test.ts` | Empty goal | 1 a side, placed in play, with pack B empty (`members: [1, 0]`, a test-only short pack, §2.3): nobody defending. The bot and the resting ball at seeded points, each centre at least 2 m plus its radius inside the floor plan, apart | 100, each for the whole 1,200 ticks, past any goal | ≥ 95 score for the bot's pack within 20 s; never stuck, in any tick | ≈ 1–2 s |
| `marks-regulation.test.ts` | A goal in regulation: the count | genesis, 2 a side, 3 minutes, four bots, `JOIN \| READY` at tick 1, READY again every 50 s | 100, each until its first goal or 0:00 | ≥ 90 have a goal before the clock reaches 0 | ≈ 4–6 s |
| `marks-regulation-1.test.ts` to `-4.test.ts` | Never stuck, through the regulation mark's whole matches | the same 100 matches, 25 seeds a file | each whole, to ENDED, through any overtime up to 3,600 ticks of overtime play | never stuck, for every bot in every tick | ≈ 5–7 s each |
| `marks-fall-back.test.ts` | The fall-back (L142) | placed in play at each pack size 1–4, every terrier a bot. Seeded ball; a pack-B rival nearer the ball than pack A's nearest bot; pack A on the attacking side | 4 × 100 × 45 ticks | per size, ≥ 90 where pack A's nearest bot is moving toward a point between the ball and its goal at reaction + 0.5 s (§8.6) | ≈ 1 s |
| `marks-e2e-setups.test.ts` | Not a §16 mark: §16's end-to-end setups, which M3's and M4's specs rest on | (a) The three-engine match: genesis, 2 a side, 1 minute. Pack A is a scripted person, holding back in ball view (step 16) for the first 60 ticks of play after each kickoff and then nothing, and one bot it hosts; pack B is two scripted people holding nothing, present every tick. (b) Practice: genesis, 1 a side, 1 minute. Pack A is a scripted person, holding sideways in ball view (step 8) for the first 60 ticks of play after each kickoff and then nothing; pack B is a bot | 25 seeds each, whole matches | every run ends at 0:00 with the bot's pack ahead: not level, and not in overtime. The slowest first goal's play time is printed, for M4's spec timeouts | ≈ 2 s |

- **"Never stuck"** is checked over every tick of the first two marks' runs, as §16 says: the empty-goal mark's whole 20 s, and the regulation mark's whole matches, in the four shard files.
- **The count and the shards play the same seeds** from the same states, so the count's runs are, bit for bit, the first part of the shards' runs. The count stays a file of its own because a count over 100 runs can't be split across files without changing the mark.
- **The end-to-end setups:** in both, every run must be decisive, since an end-to-end match plays one seed it can't choose and "a match level at 0:00 fails its test at once" (§16). Their rivals stand idle in the bot's path, where the fall-back can fire, which no §16 mark tries. So a brain that can't score past them fails here, at M2, and not first in M4's slowest specs.
- **`brain.test.ts`:**
  - the roles at each rank;
  - the fall-back trigger;
  - the reaction delay: a world change at tick T changes the decision at T + 15;
  - mirrored bots diverge within 2 s;
  - countdowns face the ball, and warm-up wanders;
  - counters start from `prevInput`, and a press is one count;
  - barks at most once a second, and the gap follows the setting: at 2 barks a second, never within 30 ticks;
  - `think` is deterministic for a seed.

### 8.6 The metrics, defined so that they don't depend on the brain

- **Stuck:** a bot holding a direction, not sitting, tumbled or lunging, and not in a countdown, whose centre stays within 0.5 m of where that streak began for 300 ticks. The streak restarts whenever a condition breaks or the bot leaves the circle.
- **The fall-back's "moving toward a point between the ball and its own goal":**
  - Q is the point 3 m from the ball toward its own goal's centre, on that segment, or the goal's centre if the segment is shorter;
  - at 0.25 + 0.5 s after the setup, the bot passes if it's within 1.5 m of Q, or its horizontal speed is at least 1 m/s with its velocity within 45° of Q − its position;
  - 45°, 1 m/s and 1.5 m are this design's starting values. Q-9 says the marks' values are tuned at M2, and settle records them in §16.
- **The scripted people** of the end-to-end setups send A.2 inputs as a browser would, present every tick, so they never sit.

### 8.7 Runtime in the gate

- **CPU:** about 30–40 s in all, in ten files of at most about 7 s; the regulation mark's whole matches are about 25 s of it. With the worker pool, about 7 s of wall time here, and about 25 s on CI's 3 workers.
- **Nothing moves off the gate.** The metrics also sweep the regulation matches at candidate brain settings, for tuning (§9.6), but the gate plays them whole at the settled ones.

---
## 9. The tuning page

### 9.1 What it is

- **Where:** `dev/tuning.html`, served by `npm run dev` at `/dev/tuning.html`, never built. `vite.config.ts` builds `index.html` alone.
- **What it runs:** the real simulation, `simParams`, `makeSim`, `genesis`, `step` and the bot brain, at 60 ticks a second on an animation-frame accumulator, as roslambo's tuning page does.
- **Changing a setting** restarts the scene.

### 9.2 How it draws: canvas 2D

- **Why not three:** D-38 and CLAUDE.md keep three to `src/render/**`, and M1's renderer draws only the empty pitch. A tuning page on three would either import three outside `src/render`, or wait for M4's drawers. roslambo's tuning page also drew on "a simple canvas".
- **The plan view (x–y),** from `pitch.outline`, `halves` and `goals`:
  - terriers as r-circles with a heading tick, the pack's colour and an outline of the drawn 0.6 × 0.5 m box;
  - the ball as an R-circle, shaded by its height;
  - contact normals, optionally.
- **The side elevation (x–z),** at true scale:
  - the floor, the walls' and net's 6 m, the posts and crossbar;
  - terriers and the ball as circles.

  It shows hops, lifts, pinches and slip-outs.
- **A close-up** 8 m wide around the ball, in elevation, for a push's contact angle and the drawn box against the ball (D-27's fit, for when the collider is tuned).

### 9.3 Its controls

- **A scenario picker** (`dev/tuning/scenarios.ts`), built on `scenes.ts` and `cases.ts`, so it runs the scenes the tests and metrics run:
  - a kickoff at each pack size, with bots or seeded `chasey`;
  - C-18's push layouts in both frames, with a readout of the time to 95% of run speed;
  - a ball dropped on pushers;
  - two sitting terriers;
  - a dribble at a run and at zoomies speed, with the lowest hop angle seen;
  - simultaneous hits, with the ball's speed;
  - a bowling shot;
  - shots into the goal's netting, with how far each comes back (§9.6);
  - a 2-a-side bot match.
- **One keyboard terrier,** by `event.code`, released on blur: W, A, S and D in eight directions; Space jumps; Shift is zoomies; E pounces; Q barks. A frame selector picks pitch, ball line or nose. In the plan view, pitch-frame W is +y.
- **The other terriers** are scripted or bot-driven.
- **Pause, step a tick, speed ×0.25–×2, reset.**
- **Record and stop** (§9.4).
- **The readouts:**
  - the phase, clock and score;
  - contacts a substep, slip-outs, and the step's µs, timed by `performance.now`, which is allowed in `dev/`;
  - the ball's speed and height;
  - C-47's drift per lap while sideways is held in ball view.
- **Sliders for every setting the simulation and the brain read** (`dev/tuning/model.ts`), grouped as bodies, bounces, forces, movement, actions, rules, solver, slip-out, bots and the push assist.
  - Each has a key path, label, minimum, maximum and step, and defaults to `config`.
  - The kickoff spots take a JSON field, checked for being inside the floor plan and apart.
  - The push assist is a switch and a cap slider from the zoomies speed up, since 0 is off and a cap that's on is at least the zoomies speed (§4.4).
  - Settings the simulation and the brain don't read are listed in `NOT_TUNED` with the reason: cameras, network, page and timeline, and `terrierFloorRestitution`, fixed by L312 and D-5 step 4 (a landing terrier never bounces, and a configuration check keeps it 0, §10). `model.test.ts` fails a configuration key that is in neither list.
  - A value `derive()` rejects, such as a lunge that isn't a whole number of ticks, shows its error and keeps the last good scene.

### 9.4 How its values reach the configuration (Q-10), and its recordings

- **Copy settings** writes two snippets:
  - the changed keys as a TypeScript object for `src/config.ts`;
  - the PLAN A.4 and A.5 rows, and the Configuration table's rows, in their wording.
- **The values ride in the URL fragment,** written with `location.replace`, so a tuned scene can be reloaded and shared. The page touches no storage.
- **The values land** by settle's commit: `src/config.ts`, PLAN's A.4 and A.5, and REQUIREMENTS' table only for what the owner signs off (§14, Q-1). The commit re-emits the goldens and re-runs the marks, as Q-10 says. `src/config.test.ts`'s table check fails until the code and the tables agree.
- **Recordings,** for M4's look book, which "replays matches recorded from the tuning page and the bots" (§12), and for `e2e/fixtures/`. `dev/tuning/recording.ts`:
  ```ts
  export interface Recording {
    readonly format: 1;                                    // not a setting
    readonly codec: number;                                // CODEC_VERSION
    readonly config: Config;                               // the whole configuration the run used, not a difference from today's
    readonly start: string;                                // encodeState of the first state, as hex
    readonly ticks: readonly (readonly TickInput[])[];     // each tick's canonical inputs
    readonly final: string;                                // hashState of the last state
  }
  export interface Recorder {
    tick(inputs: readonly TickInput[]): void;              // the inputs step is given, canonicalised as step does
    stop(last: Readonly<MatchState>): Recording;
  }
  /** Throws if stateProblems(s) isn't empty: such a start couldn't be replayed. */
  export function startRecording(s: Readonly<MatchState>, c: Config): Recorder;
  /** Steps a fresh Sim from the start; throws on another codec, a start decodeState refuses, or a final hash that differs. */
  export function replay(r: Recording): MatchState;
  ```
  - **Stop** offers the recording as a JSON download through an object URL, so the page still touches no storage.
  - **It keeps the whole configuration,** so a recording replays the same after settle moves the defaults.
  - **A start `stateProblems` rejects,** such as a short pack in play, can't be recorded, and the control says why.

### 9.5 `dev/tuning/model.test.ts`, in the gate

- Every configuration key is a slider or `NOT_TUNED`.
- The defaults equal `config`.
- A snippet round-trips into a configuration `simParams` accepts.
- The fragment round-trips.
- A seeded 2-a-side bot match recorded for 600 ticks replays to its final hash, and replaying it under one changed setting doesn't.

### 9.6 `dev/tuning.metrics.ts`, off the gate

Run it with `npx vitest run --config dev/vitest.config.ts`, as roslambo's `tune.metrics.ts`. It writes `research/tuning/results.json`, and refuses to overwrite it without `TERRIEST_TUNING_OUT`. It runs:
- all of M0's push layouts in both frames, with the assist off and on;
- §16's slip-out cases, plus the 2,880-dribble sweep's lowest hop angle and the sitting pair's time. That's C-21's 42°–43.2° window, rechecked whenever the collider, the drive or friction moves;
- k = 1–4 hits;
- C-5's bowling examples: a zoomies push's leaving speed, a dribble at a run, a pounce from the air; and tumbles by bowling a minute in seeded 2- and 4-a-side bot matches;
- the netting rebound, the touches per push episode, the time down under alternating pounces, a 3 m/s ball's roll, head-on terriers, and D-4's overhang and box reach, for the table below;
- the bot marks at candidate brain settings, and all 100 regulation matches at full length;
- the step's µs on the wall scrum in Node with 8 TickInputs a tick, against M0's 27.8–31.2; and `think()`'s µs a bot in 4-a-side bot matches, since Practice's host runs 7 brains a tick.

Its tables are the evidence for a provisional settlement: `research/tuning/REPORT.md`, written by settle, as roslambo's `research/tuning/REPORT.md` was.

**Q-10's values: what decides each.** For each value M2 tunes, the metric and the rule are fixed here, before anything is measured, as M0's revisit fixed its rule before timing. settle writes them into `research/tuning/REPORT.md`'s method first. When the owner tunes, the owner's values replace Claude's. Claude's are provisional and logged owner-pending (§17). The default rule is to keep A.5's or REQUIREMENTS' value unless a named check fails. Then it takes the candidate nearest that passes, and the report gives both.

| Value | Start | Metric | Check | Rule |
|---|---|---|---|---|
| Kickoff spots | A.5's table | the configuration's checks (inside, apart, mirrored); the pinch at each pack size; the regulation mark; the end-to-end setups | the pinch comes down within 1.5 s, mirrored; the marks and setups pass; the 1-a-side spot stays on y = 0, where §16's Practice setup needs it | keep |
| Rolling slowdown | 0.5 m/s² | a 3 m/s ball's roll (A.5 says 9 m); the push times, which include it; its effect on the netting rebound | §16's push marks: one pusher 1.2 s ± 10%, four in a train 0.6 s ± 10% | keep, unless a push mark fails. Its effect on the netting is reported; it's small (below) |
| Terrier bounce | 0.3 | terriers meeting head-on at run speed; the scrum's contacts a substep and step µs; the slip-out cases and pinches | the slip-out cases and pinches pass | keep, unless they fail |
| Re-arm gap | 0.6 m | the touches counted while a terrier pushes from contact for 2 s, at a run and at zoomies speed, in both frames; a ball shot against a wall from 2 m and met again on its rebound | a push from contact counts one touch; the rebound met again counts a second | keep, unless one fails. The architect's scratch run found a run-speed dribble counts one touch at 0.6 m and at 0.3 m |
| Tumble guard | 1.5 s | a still terrier's share of time tumbled while two rivals pounce into it in turn as soon as each can, for 30 s | after every get-up it's up for at least the guard | keep. The share, a half at a 1.5 s tumble, is reported for the owner |
| Collider size | r = 0.25 m | D-4's overhang, (0.6 − 2r)/2 = 5 cm; the drawn box's reach toward a floor push's contact (D-4: 14 cm); the slip-out window (the four cases, the dribble sweep's lowest hop angle); the push times | the window stays open: the four cases pass; the push marks hold | keep, unless one fails. A change is reported for M4's pushing pose (D-27) |
| Drive and idle friction | 15 m/s² (REQUIREMENTS), 8 m/s² | run speed from rest (REQUIREMENTS: 0.4 s); a pusher moving an idle terrier (D-6: 3.5 m/s²); the slip-out window; the push times | the window stays open; the push marks hold | keep both. The acceleration is REQUIREMENTS', so it changes only with the owner |
| Goal netting | 0.3 | the netting rebound: shots at 5 and 10 m/s, at 0°, 20° and 35° in plan, rolling, high (centre 2 m up) and lobbed (4 m/s up), nobody near; the ball's least \|x\| from the goal to the celebration's end | the ball stays wholly behind the line: its centre more than R behind it | the largest of 0.3, 0.2, 0.15, 0.1, 0.05, 0.02 and 0 that passes (see below) |
| Bowling speed | 4 m/s (REQUIREMENTS) | C-5's examples; tumbles by bowling a minute in seeded bot matches | REQUIREMENTS' note holds: a pounce from the air sends a resting ball off at 4 m/s or more, and a ball dribbled at a run bowls | keep, unless one fails. It's REQUIREMENTS' value, so a change goes to the owner |
| Side-by-side pushers, and the remedy | — | push times for two and four, round the ball and on a line, in both frames, with the assist off and at caps of the zoomies speed and two above it | with the assist on, two and four abreast in ball view beat one pusher's 1.225 s, and one pusher's time doesn't change | keep the assist at the smallest cap that passes, and set the marks at the measured times plus 10%, as §16's ±10%. If no cap passes, the assist goes, the marks are the measured times without it plus 10%, and C-18 goes to the owner (§14, Q-13) |
| Q-9's mark values | §8.6's | — | — | keep §8.6's starting values and record them in §16. They define the measures; the brain is tuned to meet them, not they to the brain |

**The netting, measured ahead.** The architect's scratch run of the spike's solver, with nobody near the shot:
- at A.5's 0.3, a 5 m/s rolling shot ends the celebration with its centre at x = 19.33, in front of the goal line; a 5 m/s high shot at 16.84; and a 10 m/s high shot at 11.51, 8.5 m out onto the pitch;
- at 0.1, the worst 5 m/s shot ends at 20.07, its centre still behind the line, and the worst 10 m/s shot at 18.20;
- at 0.02, every centre stays behind the line, the worst at 20.73, but part of the ball comes back out;
- only 0 keeps every shot wholly behind the line;
- a rolling slowdown of 1 or 2 m/s² instead of 0.5 moves the worst 10 m/s case by less than 0.6 m, because the worst shots bounce on the floor, where the slowdown doesn't act.

So the rule settles 0 unless the port measures otherwise. `netting.test.ts` (settle) then holds the settled value in the gate, at its check, or at the owner's, if the owner settles a livelier net (§14, Q-21). The test can't land earlier: at A.5's 0.3 it fails.

### 9.7 Lint and the scan

`dev/` gets hermet's base lint and the config test's name scan.
- Its sliders hold key paths as strings.
- The metrics' candidate lists are keyed `{ key, values }`, never by a setting's name. A property named `rearmGapMetres` that holds an array would be flagged.

---

## 10. Config additions

`src/config.ts` lacks these values today. Each gets a PLAN table row and a `src/config.test.ts` map entry, so that the table check (`documented()`) names it and its values, and nothing in the simulation or the brain copies it.

| Key | Value | Unit | Source | Row (PLAN) | Added by |
|---|---|---|---|---|---|
| `warmUpArrivalStepMetres` | 1 | m | D-8: "in 1 m steps from the spot toward its own goal line" | A.4, new: "Warm-up arrivals" | core-types |
| `gaitCycleMetres` | 0.6 | m | M0's `gaitPerMetre = TURN / 0.6` (D-9's gait) | A.4, new: "Gait and running" | core-types |
| `runningMinSpeedMetresPerSecond` | 0.2 | m/s | M0's `animate`: running from 0.2 m/s or with the drive on | A.4, the same row | core-types |
| `botAimNoiseDegrees` | 10 | ° either way | Q-9's "aim noise seeded per bot", value M2's | A.4, "Bot brain", which replaces "Bot reactions" | core-types; bot-brain tunes |
| `botZoomiesBeyondMetres` | 5 | m | D-39 "zoomies to reach the ball" | A.4, "Bot brain" | the same |
| `botPounceWithinMetres` | 2 | m | D-39 "when the ball is in reach" | A.4, "Bot brain" | the same |
| `botPounceAlignDegrees` | 20 | ° | D-39 "lined up with the goal" | A.4, "Bot brain" | the same |
| `botSupportMetres` | 5 | m | Q-9 "supports behind the ball" | A.4, "Bot brain" | the same |
| `botDefendMetres` | 6 | m | Q-9 "defend between the ball and their goal" | A.4, "Bot brain" | the same |
| `botBarkEverySeconds` | 5 | s | D-39 "a bark now and then" | A.4, "Bot brain" | the same |
| `botStuckSeconds` | 2 | s | the brain's own unstick, inside §16's 5 s mark | A.4, "Bot brain" | the same |
| `botStuckMetres` | 0.5 | m | §16's "within 0.5 m" | A.4, "Bot brain" | the same |
| `pushAssistCapMetresPerSecond` | 0, off | m/s | C-18's ball-frame target (§4.4) | A.5, new: "Ball-frame push assist (C-18)" | core-types, in phase 1; settle keeps or removes it |

- **`derive()`** gains `ticksPerMinute` (60 × ticks a second), `botBarkEveryTicks`, `botStuckTicks` and `barkGapTicks` (the ticks of 1 / `barkMaxPerSecond`), each through its whole-ticks check.
- **Four new configuration checks** in `src/config.test.ts`, each with a planted bad value it must catch, as §7.4's are. settle records them in §7.4, marked M2:
  - `stickSteps` is 32, since A.2's five step bits fix it. Today nothing ties the stick setting to the input format;
  - `terrierFloorRestitution` is 0. L312 says a landing terrier never bounces, and D-5 step 4 has no terrier floor bounce to read it with, so a non-zero value would be a setting the simulation silently ignores;
  - `pushAssistCapMetresPerSecond` is 0 or at least `zoomiesSpeedMetresPerSecond` (§4.4);
  - `botBarkEverySeconds` is at least 2 / `barkMaxPerSecond`, so a bot's jittered barks never come within the bark gap (§8.2).
- **Not added at M2:** D-27's pushing-pose 8 ticks. The drawer is its first reader, so it goes into A.4 at M4, from M0's `PUSH_TICKS`. M2's code never reads it: the pose is drawn from `lastBallContactTick`, which is in the state.
- **The rows' wording,** which `src/config.test.ts`'s `numbersIn` parses in order. It reads "one", "twice" and "half" as numbers, so the rows avoid those words, and it strips references such as "D-8", "Q-9" and "M0":
  - **Warm-up arrivals:** "the pack's next free spot if it's clear, else the first clear point in 1 m steps from it toward the pack's own goal line, else the spot itself (D-8)" → [1].
  - **Gait and running:** "the gait turns a cycle per 0.6 m run on the floor; a terrier draws as running from 0.2 m/s, or while its drive is on (D-9, M0)" → [0.6, 0.2].
  - **Bot brain:** "reacts after 0.25 s, with aim noise up to 10° either way, seeded per bot; zooms at a ball over 5 m away; pounces when the ball's surface is within 2 m and lined up within 20°; supports 5 m behind the ball; defends 6 m out from its goal line; barks about every 5 s; turns away after 2 s held within 0.5 m (Q-9, D-39)" → [0.25, 10, 5, 2, 20, 5, 6, 5, 2, 0.5]. Its map entry lists the keys in that order.
  - **Ball-frame push assist (C-18):** "off: its speed cap is 0 m/s, which turns it off; on, the cap is at least the zoomies speed; compared on the tuning page" → [0].
- **How the scan accepts them:**
  - they're read only through `simParams` or `botParams`, so no file in `src/core/sim` or `src/core/bot` holds their values;
  - their values (1, 0.6, 0.2, 10, 5, 2, 20, 6, 0.5, 0) are already other settings' values, so they make no new collision for code constants, which carry `not a setting` anyway.
- **Edits they need:**
  - **PLAN only:** A.4's three rows, and A.5's one row, which Claude may edit, marked "M2".
  - **REQUIREMENTS: none.** These are implementation constants, not Configuration rows.
  - **REQUIREMENTS for the tuned values:** the five TBDs Q-10 tunes (kickoff spots, rolling slowdown, terrier bounce, re-arm gap, tumble guard), and any value the owner changes that REQUIREMENTS gives (acceleration, turn rate, bowling speed, the netting's wording, the collider through "Terrier"), go into REQUIREMENTS' Configuration table only with the owner's sign-off. That's Q-10's waiting §2 row, and REQUIREMENTS is the owner's (§14, Q-1).

---

## 11. Build order

Five phases.
- **Phases 1 and 2 are the shared core** every later builder needs: the state types, codec, hash, maths and the lint, then the step, the physics port and the scenes. They're split into two sittings, one after the other, because each is a sitting's work. Phase 2 needs phase 1's types before it starts.
- **Phases 1, 2 and 5** run one builder each. **Phases 3 and 4** run their builders in parallel, in one checkout, on disjoint files.
- **Each phase ends with an integration step:** the full `npm run check` green, the lint clean, every test of the phase green, and a commit.
- **A builder never edits another builder's files in its phase.** A later phase may change an earlier phase's files only where it's named as the owner below.

### Phase 1: core types. One builder, **core-types**

- **Files:**
  - `src/core/sim/{math,hash,input,state,params,codec,valid}.ts` and their tests (§1.1–§1.6);
  - `src/config.ts`: §10's keys, the push assist's among them, and `derive()`'s four additions;
  - `src/config.test.ts`: the A4 map's "Warm-up arrivals", "Gait and running", and "Bot brain" in place of "Bot reactions"; the A5 map's "Ball-frame push assist (C-18)"; §10's four checks;
  - `eslint.config.mjs`, `scripts/eslint/config.test.mjs` and its fixture (§1.24);
  - PLAN.md: A.1 as §2.2 fixes it, marked M2; A.4's three rows; A.5's assist row.
- **Needs:** M1.
- **Exit:**
  - `npm run check` green;
  - `math.test.ts` (D-2's bounds and symmetries), `input.test.ts`, `params.test.ts` (M0's values, bit for bit) and `codec.test.ts` (round trips, totality, non-finite floats refused) green;
  - `src/config.test.ts` green, with the new rows and checks;
  - the collection ban failing in the sim and bot groups, and passing everywhere else.

### Phase 2: the physics and step port. One builder, **physics-port**

- **Files:** `src/core/sim/{pitch,physics,movement,rules,step,scenes,testing,cases}.ts`. `rules.ts` is the M0 subset of §1.10. Tests: `pitch`, `contacts`, `hits`, `push`, `slipout` (42° with the flag only), `mirror`, `tunnel-main`, `tunnel-second`, `movement` and `step`, `.test.ts` each.
- **Needs:** phase 1's types and `SimParams`.
- **Exit:**
  - `npm run check` green;
  - every M0 figure in §4.1 reproduced and pinned, and the 18 bit pins matching the spike's (§4.1);
  - the warm-up ball still and finite (§4.2);
  - one `Sim` over alternating states and a clone, matching fresh `Sim`s (§7.7);
  - P8 at every pack size on both shapes;
  - the fuzz never leaves the pitch;
  - **the step's cost** (R-6): the scratch script of §0 runs the wall scrum, with 8 TickInputs a tick, through the port's step and the spike's, alternating, in 10 rounds of 3,000 ticks each after a 600-tick warm-up. The port's median must be at most 5% over the spike's. The builder measures it and reports it in the commit; the gate doesn't assert it.

  The largest sitting of M2, but a port with known answers.

### Phase 3: rules, goldens and bots. Three builders in parallel

- **rules**
  - **Files:** `src/core/sim/rules.ts` (completed), `src/core/sim/valid.ts` (the rules' checks; its owner from now on), `src/core/sim/step.ts` (call sites only, if needed), `src/core/sim/rules.test.ts`, `events.test.ts`, `properties.test.ts`, and a helper of its own, `src/core/sim/match-testing.ts`.
  - **Scope:** §6 in full, and §7.7.
  - **Needs:** phases 1 and 2.
- **goldens**
  - **Files:** `src/core/sim/{scripts,golden}.ts`, `golden.test.ts`, `goldens.json`; `src/determinism.ts`; `src/main.ts`; `e2e/determinism.spec.ts`; `scripts/emit-goldens.mjs` and `.test.mjs`; `package.json`.
  - **Scope:** §7.1–§7.5.
  - **Needs:** phase 2, and the event API of §1.3 and §6.1. It writes the genesis scripts against that API while rules completes it, and emits only at the integration step.
- **bot-brain**
  - **Files:** `src/core/bot/{bot-id,brain,marks}.ts`, `bot-id.test.ts`, `brain.test.ts`, `marks-empty-goal.test.ts`, `marks-regulation.test.ts` and its four shards, `marks-fall-back.test.ts` and `marks-e2e-setups.test.ts`. Plus, alone in this phase, the bot keys' values in `src/config.ts`, the "Bot brain" entry in `src/config.test.ts` and A.4's "Bot brain" row in PLAN.md.
  - **Scope:** §8.
  - **Needs:** phase 2. The empty-goal and fall-back marks run on placed states, so they can be done in parallel. The regulation mark and the end-to-end setups need rules' start countdown, clock and kickoffs, and are validated at the integration step.
- **Integration:**
  1. rules and bot-brain finish;
  2. goldens runs `TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens` and says so in the commit;
  3. if a mark or an end-to-end setup fails, bot-brain tunes its own keys, and nothing else. A setup that still fails goes to §14 as a question for §16;
  4. the step's cost again, the same way, now with events, presence, the clock and the binding: at most 5% over the spike's. `think()`'s µs a bot is reported beside it;
  5. `npm run check` green, with `e2e/determinism.spec.ts` passing in Chromium, Firefox and WebKit;
  6. the gate's wall time measured (§12).

### Phase 4: the tuning page and the push remedy. Two builders in parallel

- **tuning-page**
  - **Files:** `dev/tuning.html`, `dev/tuning/{main,model,scenarios,draw,keyboard,recording}.ts`, `dev/tuning/model.test.ts`, `dev/tuning.metrics.ts`, `dev/vitest.config.ts`, `vitest.config.ts` (`'dev'` in its include).
  - **Scope:** §9.
  - **Needs:** phase 3's API: no file of it changes. The push assist's key has existed since phase 1.
- **push-remedy**
  - **Files:** `src/core/sim/movement.ts` (the assist) and `src/core/sim/assist.test.ts`, nothing else.
  - **Scope:** §4.4.
- **Integration:**
  - `npm run check` green with the goldens unchanged: the assist is off, so there's no re-emit;
  - the tuning page loads under `npm run dev` with no console error and steps every scenario, which tuning-page checks headless once, outside the gate. A recording made there replays to its final hash;
  - `model.test.ts` green, its slider list naming the assist.

### Phase 5: settle M2. One builder, **settle**

- **Scope:**
  - **The method first:** `research/tuning/REPORT.md`'s method section, with §9.6's metric, check and rule for each value, committed before anything is measured.
  - **The values:** the owner's if they tune on the page, otherwise Claude's by §9.6's rules, provisional and logged owner-pending, as §17's rule for attended steps says. They go into `src/config.ts` and PLAN's A.4 and A.5, and into REQUIREMENTS' table only for what the owner signs off (§14, Q-1).
  - **The netting:** its value by §9.6's rule, and `netting.test.ts`, which holds it in the gate: at the settled value, every netting shot of the metric keeps the ball wholly behind the line through the celebration, or meets the owner's check if the owner settles another (§14, Q-21).
  - **The C-18 remedy:** keep the assist with a cap, or remove its code, key, row, check and test.
  - **The marks:** C-18's side-by-side marks in §16 and in `push.test.ts`; Q-9's mark values in §16; any threshold the tuning moved.
  - **The re-checks:**
    - the slip-out window (C-21), against the metrics;
    - the marks and the end-to-end setups, re-run;
    - the step's cost, re-timed against the spike;
    - the goldens, re-emitted, with the commit saying so;
    - the bit pins stay as they are: they run under a configuration copy at M0's values, written out in `step.test.ts`, so they check the port, and tuning never moves them.
  - **PLAN's M2 amendments,** each marked M2 and citing its evidence: D-5, D-7, D-8, D-9 (the ball's hit change), D-12 (the separate packs), D-23, D-38 (the collection ban), D-39, §7.4 (the new checks), §16, P8's wording, A.1, A.4, A.5, and §17's M2 status line.
  - **The record:**
    - `research/tuning/REPORT.md` from the metrics;
    - `docs/acceptance.md`: M2's tuning row, settled or owner-pending; the gate's wall time; the step's cost against the spike;
    - the README: the tuning page and its recordings, `emit-goldens`, the determinism page by hand;
    - CLAUDE.md: the tuning page, `window.terriestDeterminism`, the `emit-goldens` double guard, the marks' cost, and the arrays-only rule.
  - **`src/core/sim/index.ts`.**
- **Needs:** everything above.
- **Exit,** M2's exit (§17):
  - every simulation test and golden green in Node and all three engines;
  - the bots at their marks;
  - the values tuned and recorded;
  - `npm run check` green, its wall time logged.

### What may run in parallel, in short

- **Phase 3:** rules, goldens and bot-brain.
- **Phase 4:** tuning-page and push-remedy.
- **Nothing else.** Phases 1 and 2 are the shared core every later builder imports, and phase 5 owns the cross-cutting documents.

---

## 12. Gate cost

**Today:** 76.4 s, the median of three runs (`docs/acceptance.md`). The end-to-end tests are about 60 s of it, so lint, public-scan, typecheck, the unit tests and the build are about 16 s.

| Stage | What M2 adds | CPU | Wall time added here (11 workers) | On CI (3 workers) |
|---|---|---|---|---|
| lint | about 50 files, the exact-ops group and its collection ban included | — | +2–3 s | +3–4 s |
| typecheck | the same files | — | +1–2 s | +2 s |
| unit: ported M0 tests | contacts 5, hits 0.3, push 0.6, the chosen slip-out rule 1.5, mirror 4, tunnelling 12 (two files), movement 2, pitch 0.1, math 1.3, step and its bit pins 0.6 | ≈ 28 s | | |
| unit: new tests | params, input and codec 2; rules and events 2.5; properties 3.5; golden 2–4 (the suite once a process); assist 1; model 0.3; the lint fixture 0.5 | ≈ 13 s | | |
| unit: bot marks | empty goal 1.5; the regulation count 4–6; its four shards 5–7 each; fall-back 1; the end-to-end setups 2; brain 1 | ≈ 30–40 s | | |
| unit, in all | | ≈ 71–81 s | **+7–9 s**, set by the pool and the longest file, about 7 s | +24–28 s |
| build | the determinism chunk and `goldens.json` | — | +1 s | +1 s |
| e2e | `determinism.spec.ts` × 3 engines: about 1 s to load, plus 2–4 s of suite each, one worker | — | **+10–14 s** | +12–16 s |
| **Total** | | | **about +21–29 s: 97–105 s** | |

**How M2 keeps it reasonable without weakening any check:**
- **Balance the worker pool.** No file runs much over 7 s: tunnelling splits by shape, each bot mark is a file of its own, the regulation mark's whole matches run in four files of 25, and the golden suite runs once per process and is shared among its tests. The pool parallelises files, so a balanced split costs nothing in coverage.
- **No duplicate replays.** Codec round-trips reuse states built in their own file, never the golden suite, and only `golden.test.ts` replays it. The one repeat is deliberate: the regulation count replays the first part of the shards' matches, because a count over 100 runs can't be split across files.
- **Only the chosen slip-out rule in the gate.** M0's 15 rejected candidates were research. §16's four cases run under 42° with the flag, which is what §16 asks. The window's bounds, which are measurements, move to the metrics, still run at every tuning change (C-21). The bit pins (§4.1) catch a port that drifts from M0 without them.
- **Bots never run in the browsers.** The determinism page replays the suite once per engine.
- **The end-to-end tests keep one worker,** for C-6's software GL. The determinism spec draws nothing, so it gains nothing from the GPU path either.
- **Not taken:** fewer seeds, shorter bit-still scenes, the goldens in one engine only, or the regulation mark's runs cut short at their first goal. Each would weaken a check §16 names.

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **Exact-ops traps:** `Math.hypot` or `Math.sign` in the brain; `**`; `Math.random` for noise; `toFixed` or `toLocale…` in a name; a minifier folding a constant. The lint matches names only (D-1, D-38). | The lint, with `Math` only as `Math.<name>`, in sim, bot and their test support. Noise comes from `mix`. The determinism page replays the production bundle in every engine, so a minifier fold shows as a mismatch. The bot marks run on CI's arm64. |
| R-2 | **Iteration order:** contacts, events, inputs, arrivals, kickoff ranks, list sorting, `Map`/`Set` iteration, `sort` comparators. A hidden order dependency passes in Node and splits on arrival order. | Contacts follow the slot templates; events, the canonical inputs and the kickoff ranks are in ID order; the list is in (spot, pack) order. Arrays only: the lint bans constructing a `Map`, `Set`, `WeakMap` or `WeakSet` in the simulation and the brain (§1.24). P4's property shuffles and duplicates every tick; the scripts hand inputs over reversed; a duplicated ID resolves by content. IDs compare as strings with `<`, never `localeCompare`. |
| R-3 | **The mirror symmetry:** slots with warm-up holes, `ballFixed`, the assist, the kickoff ranks, signed zeros, the ball's hit change. P8 must stay exact from every kickoff. | The solver's slot templates are unchanged, and the warm-up holes are only the "off mirror" case M0 handled. The fixed ball drops all its piece templates, and it's its own mirror. The hit change's horizontal parts are ±0 in a mirrored state. P8 runs after every substep at every pack size, on both shapes, through pinches and slip-outs, with the assist on and off, compared with `===`. Script IDs are ranked so mirrored pairs match. |
| R-4 | **float64 codec stability:** a −0 written as +0, a NaN or an infinity, a u32 field holding a float, a negative written unsigned, a name's bytes, aliasing in `cloneState`. | A `DataView` set little-endian, with −0 kept and tested. A non-finite float refuses to encode, and decoding rejects it, so every encodable state decodes. Integer fields go through `>>> 0` or `\| 0`, `headingChange` as i32. Counters saturate. `encodeInto` the UTF-8, and names with lone surrogates are refused at the JOIN. `cloneState` deep-copies the ball, the score and every terrier, which a test checks by mutating a clone. Byte-for-byte round trips run under fast-check. |
| R-5 | **The port drifts from M0's physics** through slots, intents, params or the test switches, and the M0 validation no longer holds. | §4.1's figures are pinned to REPORT.md's digits, and the bodies' bits to the spike's own at six scenes (§4.1). Each parameter is computed with the spike's expression, and `params.test.ts` pins it so. The switches become zeros with the same bits. The goldens are new, but every behaviour test from M0 is in, with the same numbers. |
| R-6 | **The tick's cost** (C-2, the 13-step replay): the step gains canonicalisation, events, presence and slot binding, and M0's drawn reading had no margin (3.49–4.60 ms at 4×). | No allocation in `step`, all scratch in the `Sim`. Canonicalisation sorts at most about 12 entries in place. Slots bind once a tick in play, with a binary search per terrier. The brain runs once a local tick, never in replays. The step is timed against the spike's in the same process, alternating, at phases 2 and 3: at most 5% over, fixed before the phase closes. The metrics re-time it at every tuning, with `think()`. M3's D-11 usually steps 1–2 ticks, not 13. |
| R-7 | **Clocks in physics tests:** a 36,000-tick bit-still scene at a 10-minute length reaches 0:00 on its last tick and is placed for an overtime kickoff. | `placedMatch` and placed scripts set a 2³¹-tick clock, which `stateProblems` allows. The ENDED phase is terminal, and tests that need the clock use genesis. |
| R-8 | **The bots' runtime and their marks:** about 30–40 s of CPU in the gate; marks or end-to-end setups that fail at the starting values; a brain tuned to the marks that plays poorly against people. | Ten files, none much over 7 s, so about 7 s of wall time here. bot-brain tunes its own keys at the integration step. The metrics sweep candidates. Your play test at M4 (Q-9) sets the level, the reaction and the noise. |
| R-9 | **Parallel builders in one checkout:** a half-written file breaks another builder's typecheck, or two builders edit PLAN.md. | Disjoint files, and named owners for PLAN.md, `src/config.ts`, `src/config.test.ts` and `eslint.config.mjs` per phase. The push assist's key lands in phase 1, so phase 4's builders share none of them. Builders keep their files compiling and stage only their own. The gate runs at each phase's integration step, and the goldens are emitted only there. |
| R-10 | **The config scan's friction:** every code constant, scene coordinate and test-support literal in `src/core/sim` and `src/core/bot` may be flagged. | §0's rule: read from `SimParams`, or mark the line `not a setting: <what>`. Builders run `src/config.test.ts` early. A failure there names the file and line. |
| R-11 | **Tuning moves the slip-out window** (C-21's 42°–43.2°): a new collider, drive or idle friction closes it. | The gate runs the four cases at the tuned values; the metrics measure the window's bounds at each change. If it closes, the M0 alternative with restitution 0 needs a §2 row first (D-5), which goes to you. |
| R-12 | **The determinism page** times out in a slow engine, or the dist audit flags a string in its chunk. | The suite is about the spike's size, 1.7–2.9 s an engine. The spec allows 150 s. Script names hold no `/` and no host-like text, and the build runs the audit. |
| R-13 | **M3's needs not met by the step's API:** the event shapes, the prediction comparison, roster lookups, the ended phase. | §1.3's `TickInput` with `canonicalInputs` and `sameInputs`, `findTerrier`, `packCount`, `joinTick`, and `winner` and `terriest` are designed from roslambo's timeline and session code and D-11 to D-17. JOIN and SWITCH carry their own packs, as their wire events do. §3 says how bots' inputs enter. The plan records the event shapes in D-12 (§14, Q-10). |
| R-14 | **State left in the `Sim` between calls.** M3's timeline steps the final state and its predicted clones through one `Sim` (D-11). A slot binding, an input map, a broad-phase flag, a velocity snapshot or the ball's inverse mass read before it's written on this call would carry one state's bodies into another's step. Peers would diverge, and no test that gives each state its own `Sim` would notice. | `step` binds its slots at the start of every call, and `bindSlots` and `canonicalInputs` write every entry. Detection writes `near` for empty slots. `ballFixed` is set every tick and writes the ball's inverse mass. The step-1 helpers read `s`, never `sim.bodies`. `step.test.ts` and `events.test.ts` step one `Sim` over alternating states and a clone, compared tick by tick with fresh `Sim`s (§7.7). |
| R-15 | **Goals spring back out** (C-48): at A.5's 0.3, a 5 m/s shot ends the celebration in front of the goal line, and a 10 m/s high shot 8.5 m out. | §9.6's metric and rule, fixed before measuring; `netting.test.ts` at the settled value; your call on how lively the net may be (Q-10, §14 Q-21). |

---

## 14. Questions for the plan

Each has a proposed resolution, which settle writes into PLAN.md, marked M2, unless you say otherwise. None needs a REQUIREMENTS edit but Q-1's sign-offs, and Q-21's wording if you sign off its value.

1. **Where do provisionally tuned values go before you sign them off?**
   - Q-10 records tuned values in the Configuration table, and §2's row waits for "the values you sign off". If you aren't free, §17 has Claude settle them by measurement.
   - `src/config.test.ts` takes a value the table gives over A.5's. So a provisional change to a value REQUIREMENTS gives (acceleration, turn rate, bowling speed, run speed) can't be recorded without editing REQUIREMENTS.
   - *Proposal:*
     - provisional values go into PLAN's A.5 and A.4, marked "M2, provisional by measurement (research/tuning/REPORT.md)", and are logged owner-pending in `docs/acceptance.md`;
     - REQUIREMENTS' TBDs stay until you sign them off, which then applies §2's row;
     - a value REQUIREMENTS gives isn't changed provisionally, only proposed in the report.
2. **What may terriers do once the match has ended?** D-8 doesn't say.
   - *Proposal:* ENDED is terminal. Later ticks only advance the tick, so the final state stays as it was, for Results and for a browser arriving there (D-17, C-50). That's roslambo's frozen round.
3. **Is zoomies allowed in a celebration?** D-8 says "run, turn and bark".
   - *Proposal:* yes, as part of running, which is what M0 did. The meter refills to full at the next kickoff anyway.
4. **When does the clock count a tick?** §7.2 says "if the tick began in play", and step 3 can start play within the tick.
   - *Proposal:* "began in play" means in play after step 3. Then the clock counts exactly the ticks played, from the first tick of play, and a goal in the last of them still brings it to 0 (L107).
5. **Which of the last goal's fields clear at a kickoff placement?** §7.1's parenthesis can be read as all four; A.1 clears only the scorers.
   - *Proposal:* A.1's reading. The tick, pack and own-goal flag stay until the next goal, for the net's bulge (D-9). The scorers clear.
6. **A.1's open fields** (§2.3): drop the redundant lunging flag; fold "touching the ball" into the flags; the spike's intents leave the state; slipped-from counts slots; NEVER for unset ticks; counters saturate; the ball's hit change (Q-22).
   - *Proposal:* amend A.1 as §2.2 has it, before the first goldens.
7. **Warm-up arrivals,** which D-8 leaves open in four details:
   - which way the arrival faces;
   - whether "clear" includes touching;
   - what "before the end wall" measures;
   - how long the arrival keeps its spot.
   - *Proposal* (§6.5):
     - it faces the ball, at rest, as a placed terrier is;
     - "clear" is strictly apart from every body;
     - it stays inside the floor plan by its radius;
     - it holds the spot it arrived on until the start countdown's placement ranks its pack by ID;
     - a LEAVE, a removal or a SWITCH vacates the slot it frees: every slipping flag naming it clears.
8. **The warm-up ball,** "fixed on the centre spot and never moves or bowls" (D-8).
   - *Proposal:* immovable, by exactly the rules of §4.2. None of its piece templates is detected, the floor's included. It's skipped in the forces, integration and support. Its inverse mass is 0 in the impulses and the position passes, so a terrier's contact with it has the terrier's effective mass, and the ball gains only ±0. Terriers bounce off it at the terrier–ball restitution. Its contacts set the pushing pose's ticks and the hit's tick and strength, and count no touches.
   - The first draft said only "infinitely heavy in steps 5 and 6". With its floor contact still detected, that gave an effective mass of 1/(0 + 0) and a NaN velocity in the first substep.
9. **How long is a regulation-mark run?**
   - §16 says "2-a-side bot matches at the default 3 minutes. At least 90 have a goal before the clock reaches 0", and "never stuck" applies to "the first two marks' runs".
   - *Proposal:* the runs are whole matches, as §16 says, and nothing is narrowed (§8.5).
     - Four files play the 100 matches whole, 25 each, through any overtime up to a cap, and check "never stuck" in every tick.
     - One more file counts the goals before 0:00, with each run ending at its first goal, which is the same as the whole run's first part, bit for bit.
     - That's about 25 s more CPU than first-goal runs alone, in files of about 7 s: about 1 s more wall time here, and about 10 s on CI.
   - *The first draft* ended every run at its first goal and moved the whole matches to the metrics. That narrowed "never stuck" to the start of each match, which the gate's rule doesn't allow without you.
10. **The simulation's per-tick input,** which M3's protocol and timeline must produce.
    - *Proposal:* record in D-12:
      - one `TickInput` per present ID, with a u16, event bits, JOIN's pack, coat and name, and SWITCH's pack, in fields of their own, as §9's events carry them;
      - a JOIN and a SWITCH may arrive in one tick, since a JOIN is re-sent until the state shows it. For a non-member the SWITCH is ignored and the JOIN applies; the SWITCH is re-sent and lands a tick later;
      - duplicates are resolved by content, so arrival order never matters (P4);
      - absent means no entry.
11. **Are the bot's tunables settings?** roslambo kept its bots' style in `steer.ts`. terriest's "every setting in `src/config.ts`" and its scan push them into the configuration.
    - *Proposal:* yes. One A.4 row, "Bot brain", replaces "Bot reactions" (§10). The bark gap reads the Bark setting. M4's play test then changes them in one place (Q-9).
12. **The fall-back mark's measure:** "is moving toward a point between the ball and its own goal".
    - *Proposal* (§8.6):
      - the point Q is 3 m from the ball toward its goal's centre;
      - the bot passes at 0.75 s if it's within 1.5 m of Q, or moving at 1 m/s or more within 45° of it;
      - the thresholds are recorded in §16 with Q-9's other values.
13. **C-18's remedy.** C-18 names two candidates.
    - *Proposal:*
      - build only the ball-frame push assist, a steering rule behind a setting that is off by default (§4.4);
      - build terrier–ball friction, which changes the M0-validated solver and was worse in ball view in the plan's model, only if the assist misses the side-by-side marks or you ask for it;
      - remove whichever isn't adopted before M2's exit;
      - if neither reaches the marks, §2 restates L11 and L56, which is yours.
14. **Goldens on D-4's second shape.** §16's list doesn't name it, and M0 had two such runs.
    - *Proposal:* the main pitch only, in the goldens. P8, the tunnelling fuzz and the goal tests run the second shape in unit tests, so its arithmetic is checked, and the determinism page stays its size.
15. **`emit-goldens` and a stray variable.** With `TERRIEST_EMIT_GOLDENS=1` exported in a shell, a test-based emitter would let `npm run check` rewrite the goldens and pass.
    - *Proposal:* the golden test writes only when the emit script has also set `TERRIEST_EMIT_GOLDENS_BY_SCRIPT=1`, and fails otherwise. Record it in §15 and CLAUDE.md.
16. **The determinism page's hook.** CLAUDE.md's `window.terriestTest` is the normal page's.
    - *Proposal:* the page publishes `window.terriestDeterminism` and `html[data-determinism]`, as roslambo's publishes `roslamboDeterminism`. It calls `boot.started()` once its landmark shows, and makes no WebGL context. Record it in CLAUDE.md's Tests section.
17. **The canary's content and size.** D-23 asks for "pushes, bounces, pounces, tumbles and a goal".
    - *Proposal:* 300 ticks at 4 a side, from a placed state near pack B's goal, about 10 ms in Node. Its coverage is asserted by its counters, pushes and bounces each counted apart from hits (§7.3). M4 decides when it runs.
18. **The stick's steps and A.2.** `stickSteps` is a setting, but A.2's five bits fix 32.
    - *Proposal:* a configuration check that it's 32 (§10).
19. **A ball pressed into a wall sits 0.13 mm up, with its floor flag clear** (REPORT.md §9, which leaves the tolerance to M2).
    - *Proposal:* no tolerance. It's bit-still, the flag only gates the rolling slowdown and the jump, and in the open L57's steady push keeps it set.
20. **The pushing pose's 8 ticks** (D-27, M0).
    - *Proposal:* add them to A.4 at M4 with the drawer, their first reader. M2 needs nothing for them: the state's `lastBallContactTick` is the drawer's input.
21. **How lively may the goal's netting be?** (C-48, Q-10.) At A.5's 0.3, a goal comes back out during the celebration: a 5 m/s shot ends in front of the line, and a 10 m/s high shot 8.5 m out (§9.6).
    - *Proposal:* settle measures it with §9.6's metric and adopts the largest candidate that keeps every shot wholly behind the line, which the spike's solver says is 0 at today's rolling slowdown. A gate test then holds it (`netting.test.ts`). With your sign-off, REQUIREMENTS' Ball bounce row then reads "the goal's netting keeps none of its speed into it, and all of its speed along it"; until then A.5 holds the value, marked provisional.
    - *Alternative:* a livelier net, such as 0.02, which keeps every centre behind the line but lets part of the ball back out, with the gate test's check relaxed to match.
22. **Which way was the ball hit?** (D-9, L101.) A squash needs an axis, and the state keeps only the hit's tick and strength.
    - *Proposal:* A.1's ball keeps the velocity change of the substep that set its last hit, from after step 2 to after step 5: the impulses and the floor's bounce, not gravity. That's three float64s, 24 bytes a state, added before the first goldens (§2.3). A floor bounce squashes vertically and a wall bounce along its normal. P8 holds, since a mirrored state's horizontal parts are ±0, and the fixed warm-up ball's change is 0, which draws no axis.
    - *Alternative:* the drawer squashes along the velocity after the hit, recorded in D-9 and D-27 as drawing only, and accepts the error for glancing hits and for a rolling ball's floor bounce. Adding the field later would re-emit every golden and change what peers send.
23. **States no match can reach, for the empty-goal mark.** §16's "one bot … nobody defending" is 1 a side with pack B empty in play, which a real match never has.
    - *Proposal:* allow it in test states only (§2.3). `stateProblems` keeps its full-pack rule, so such a state never decodes from a peer. `step` and the brain handle it, because everything indexes by slot, and the property tests step such states.
    - *Alternative:* keep pack B's terrier, parked. But anywhere on the pitch it's a rival nearer the ball in some seeds, and the brain's fall-back reacts to it, which changes the mark.
24. **Four more configuration checks** (§10): the stick's 32 steps, the terrier's floor bounce at 0, the push assist's cap, and the bots' bark spacing.
    - *Proposal:* record them in §7.4, beside the plan's own checks.
25. **Arrays only, enforced.** §7.3 bans `Map` and `Set` iteration in `src/core/sim`, by review.
    - *Proposal:* the lint bans constructing `Map`, `Set`, `WeakMap` and `WeakSet` in `src/core/sim` and `src/core/bot`, outside their tests (§1.24). Record it in D-38 and CLAUDE.md.

---

## Revision log

Two reviews of the first draft, one for completeness and one for determinism and interfaces, found 27 issues. Each was checked against the sources: the spike's code, roslambo's, M1's, the plan and REQUIREMENTS. Every one held, and the design is revised for each. Four pairs are the same issue, seen from each side. None was rejected.

| Finding | Outcome | Note |
|---|---|---|
| completeness-F1 | Revised | Confirmed in the spike's code: `pieceContact` keeps an h = r floor contact, `prepare()` computes 1/(0 + 0), and `impulseStep` gives Infinity × 0 = NaN, which `applyImpulse` passes on. §4.2 now names exactly what the fixed ball takes part in: no piece templates, no forces, integration or support, inverse mass 0 in its pair contacts. A phase-2 warm-up test and a "warm-up" golden check it. §14 Q-8 is restated. The same issue as risk-F2. |
| completeness-F2 | Revised | Measured with the spike's solver: at 0.3, a 5 m/s rolling shot ends the celebration at x = 19.33, a 5 m/s high shot at 16.84, a 10 m/s high shot at 11.51; only 0 keeps every shot wholly in, and the rolling slowdown barely matters. §9.6 adds the netting metric and its rule. settle adds `netting.test.ts` at the settled value, which can't land earlier since 0.3 fails it. §13 R-15, §14 Q-21. |
| completeness-F3 | Revised | §9.6 now has a metric, a check and a rule for every Q-10 value, fixed before measuring, with "keep A.5's unless a named check fails" as the default. settle writes them into REPORT.md's method first (§11). |
| completeness-F4 | Revised | §6.8 lists the goal tests: each post and the crossbar don't score; the back, side and top netting each score once, in the substep the centre passes the line by R; a ball over the crossbar against the end wall doesn't score. On both shapes. |
| completeness-F5 | Revised | `SolverStats` counts floor bounces, piece bounces and push substeps apart from hits (§1.8), the goldens record them, and the canary asserts each (§7.3). |
| completeness-F6 | Revised | Each run's coverage is now asserted from its recorded fields and checks (`covers`, `checks`, `coverageProblems`), the roster run's outcomes included, and the emit refuses a run that fails it. Match 1 and match 4 no longer claim a whole match. A scripted "regulation end" run reaches 0:00 with a lead (§7.1, §7.2). |
| completeness-F7 | Revised | The regulation mark plays whole matches in four shard files and checks never-stuck in every tick; a fifth file counts the goals before 0:00. §16 is unchanged, and §14 Q-9 is restated. The same issue as risk-F11. |
| completeness-F8 | Revised | Chosen: a test-only short pack (`placedMatch`'s `members`), which `stateProblems` reports and `step` handles by slot (§1.12, §2.3, §6.7). Parking pack B's terrier was rejected, since the brain's fall-back reacts to any rival (§14 Q-23). The property tests step short-pack states (§7.7). |
| completeness-F9 | Revised | Confirmed: the spike's `drive()` dereferences `bodies[t.slipFrom]`. LEAVE, removal and SWITCH all call `vacate` (§1.10, §6.1); the mover's own flags clear; the drive and the substep's clear treat an empty slot as gone. `events.test.ts` has the switch-while-slipping case. The same issue as risk-F3. |
| completeness-F10 | Revised | `TickInput` has separate `joinPack` and `switchPack` (§1.3), as §9's wire events have separate payloads. §6.1 says how a JOIN and a SWITCH in one input apply, and §14 Q-10 is restated. |
| completeness-F11 | Revised | `BotParams.barkGapTicks` comes from `barkMaxPerSecond` through `derive()`. The jitter is the gap either way, so no new setting, and a configuration check keeps the period at least two gaps (§8.2, §8.4, §10). |
| completeness-F12 | Revised | `terrierFloorRestitution` goes in `NOT_TUNED` with L312's reason, and a configuration check keeps it 0 (§9.3, §10). Wiring it into `support()` was rejected: L312 fixes the value, so a slider would only offer a rule break. |
| completeness-F13 | Revised | The set is named: C0, DEL and C1, as roslambo's `fitName` strips them, plus lone surrogates. `isNameControl` and `nameAllowed` are exported for M4's `names.ts` (§1.4, §1.16). |
| completeness-F14 | Revised | The lint bans constructing `Map`, `Set`, `WeakMap` and `WeakSet` in the sim and bot group, with a fixture in `scripts/eslint/config.test.mjs`, owned by core-types in phase 1 (§0, §1.24). The same issue as risk-F7. |
| completeness-F15 | Revised | The tuning page records runs: the whole configuration, the start state's bytes, each tick's inputs and the final hash, downloaded with no storage, and `model.test.ts` replays one (§9.3–§9.5). M4's look book reads them. |
| completeness-F16 | Revised | `marks-e2e-setups.test.ts` plays both of §16's end-to-end setups, the three-engine match and Practice, over 25 seeds each, and asserts every match ends decisively for the bot's pack (§8.5). |
| risk-F1 | Revised | `bindSlots` runs first in every step and again only after a roster change or a placement. `canonicalInputs` sets its length, and `bindSlots` writes every entry; step-1 helpers read `s` only (§1.11, §3). The check is now one `Sim` over alternating states and a clone, against fresh `Sim`s, in `step.test.ts` and `events.test.ts` (§7.7). §13 R-14. |
| risk-F2 | Revised | As completeness-F1. The fix drops the fixed ball's piece templates, and keeps inverse mass 0 for its pairs only. The phase-2 test and the "warm-up" golden are the ones suggested. |
| risk-F3 | Revised | As completeness-F9: one `vacate` for LEAVE, removal and SWITCH, the mover's own flags cleared, a backstop in the drive, a rules test, and stacked terriers in the property tests' SWITCH generators. |
| risk-F4 | Revised | New `src/core/sim/scenes.ts`, physics-port's in phase 2, shipped and scanned. It holds M0's scenes, placement helpers, inputs and `chasey`, so every consumer runs the same scenes (§1.12). |
| risk-F5 | Revised | core-types adds the assist's key, row, map entry and `SimParams.pushAssistCap` in phase 1. 0 skips the rule entirely, and a cap that's on must be at least the zoomies speed, a configuration check (§4.4, §10, §11). |
| risk-F6 | Revised | `stateProblems` moves to `valid.ts`: core-types writes its structural checks, and rules owns it from phase 3. `encodeState` refuses every non-finite float, so every state it encodes decodes (§1.6, §6.7). |
| risk-F7 | Revised | As completeness-F14. |
| risk-F8 | Revised | Confirmed in Node: 9.8 × (1/240) ≠ 9.8/240, and 0.4 × 0.4 ≠ 0.16. `params.test.ts` pins each product with the spike's expression (§1.5). 18 body-bit pins at six M0 scenes, recorded from the spike by a scratch script outside the repo, since nothing in the repo may import the spike (CLAUDE.md), check "the same bits" (§4.1). They run at M0's values, so tuning doesn't move them. |
| risk-F9 | Revised | The step is timed against the spike's in one process, alternating, on the wall scrum with 8 TickInputs a tick, at phases 2 and 3: at most 5% over (§11). Binding is once a tick in play. `think()`'s µs is in the metrics (§9.6). |
| risk-F10 | Revised | Option 1: the ball keeps its hit's velocity change, from after step 2 to after step 5, as three float64s, mirror-safe by construction, added to A.1 before the first goldens (§2.1–§2.3, §7.6). §14 Q-22 offers option 2 as the alternative. |
| risk-F11 | Revised | As completeness-F7. The cost is about 25 s of CPU in four files of about 7 s: about 1 s more wall time here and about 10 s on CI (§8.7, §12). |
