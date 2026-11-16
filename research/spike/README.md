# terriest M0 spike

The throwaway physics and rendering spike of [PLAN.md](../../PLAN.md) §17 M0. It builds just enough of the exact-ops simulation and of a three.js page to measure what the plan's amendments rest on: determinism across Node, Chromium, Firefox and WebKit, contact behaviour, tick cost, draw counts and download sizes, and what the content security policy and the dist audit must allow. Its findings, each with its number, go in `REPORT.md`.

Nothing in terriest's `src/` imports it, and the product code is written fresh from M1 (D-36). It has its own `package.json` and toolchain, since hermet's lint base ignores `research/`.

## Layout

| Path | What |
|---|---|
| `src/contract.ts` | the sim/scene contract: what the simulation shows the scene, and how the scene advances it |
| `src/sim/` | the simulation, exact operations only (D-1) |
| `src/sim/lint-fixtures/` | planted lint violations, linted only by `test/eslint-config.test.ts` |
| `src/scene/` | the three.js scene; it reads the simulation only through `src/contract.ts` |
| `src/main.ts`, `index.html` | the page: the scene drawing the simulation, or a test mode |
| `src/source-choice.ts` | which simulation the page draws, from its URL |
| `src/determinism.ts` | the `?test=determinism` mode: the golden suite in the browser (run 1) |
| `src/cost.ts`, `src/cost-page.ts` | run 3's tick-cost harness, and its `?test=cost` mode |
| `src/solver-settings.ts` | the solver's four switchable settings, named by a short spec (the cost revisit) |
| `scripts/` | the stand-in model's generator, the tick cost in Node, the audit, sizes and tokenizer checks; `scripts/revisit/`, the cost revisit's drivers |
| `test/` | tests of the toolchain itself: the lint config, `_headers` and the static server |
| `e2e/serve.mjs` | the static server: `dist/` with `public/_headers` applied as Cloudflare would |
| `e2e/` | Playwright specs, in Chromium, Firefox and WebKit |
| `results/` | raw results behind the report; `results/revisit/`, the cost revisit's; `results/tmp/` isn't tracked |

## Run

From this folder, with Node 22.12 or later:

```sh
npm install          # .npmrc sets legacy-peer-deps, as roslambo's does
npm run dev          # the Vite dev server
npm run lint         # ESLint, with the simulation's rules below
npm run typecheck    # tsc --noEmit
npm test             # vitest, in Node
npm run build        # vite build, into dist/
npm run preview      # vite's own server for dist/ at http://127.0.0.1:4329/, without the headers
node e2e/serve.mjs   # dist/ with public/_headers applied, at http://127.0.0.1:4329/
npm run e2e          # builds, serves dist/ through e2e/serve.mjs, and runs every spec
```

- **Browsers:** Playwright 1.64.1's Chromium, Firefox and WebKit are already installed on this machine, so don't run `npx playwright install`.
- **Firefox** draws WebGL only while `DISPLAY` or `WAYLAND_DISPLAY` is set. WSLg sets both; elsewhere, run the specs under `xvfb-run -a`.
- **Software WebGL:** every engine draws in software (SwiftShader in Chromium, llvmpipe in Firefox and WebKit) unless `GALLIUM_DRIVER=d3d12` is set, with ANGLE's GL flags for Chromium (research/audit/REPORT.md §2).

### The page

By default it draws the showcase: a 4-a-side kickoff that plays on, 8 terriers, under M0's slip-out pick (42° and the slipping flag). The simulation advances by the clock, 60 ticks a second, and the scene draws on animation frames. URL parameters:

| Parameter | What |
|---|---|
| `script` | a golden script's name from `src/sim/scripts.ts`, or `showcase` (the default); scripts on D-4's second shape are refused, since the scene draws only the main pitch |
| `pack` | the showcase's pack size, 1 to 4 (default 4) |
| `slipOut` | a slip-out rule from `src/sim/config.ts` (default the script's) |
| `quality` | `high` (default) or `low` (D-33) |
| `seconds`, `warmup` | the frame-time window and its warm-up (default 30 and 2); the verdict shows on the page |
| `camera=spectator` | a high side view instead of the ball view behind terrier 0 |
| `frameWork` | busy work in every frame, in ms, to hold the frame rate down |
| `test=determinism` | the golden suite and the canary instead, with the verdict against `goldens.json` (also `#test=determinism`) |
| `test=cost` | run 3's harness instead: `script`, `ticks`, `runs`, `draw=0` or `1`, and `solver`, a solver spec (below) |

The model drawer draws the terriers when `window.spikeTest.modelUrl` is set before the page loads; the specs serve the generated stand-in there by interception (`node scripts/make-standin.mjs` writes a copy to `results/tmp/`).

### M0's runs

| Run | Command | Results |
|---|---|---|
| 1, engine goldens | `npx playwright test e2e/determinism.spec.ts` | `results/determinism-{chromium,firefox,webkit,node}.json` |
| 2, contact behaviour | `TERRIEST_SPIKE_MEASURE=1 npx vitest run src/sim/measure.test.ts` | `results/sim.json` |
| 3, cost | `npx playwright test e2e/cost.spec.ts` (Chromium and Node, about 5 minutes); Node alone: `node scripts/cost-node.mjs [--mode tight\|paced]` | `results/cost.json` |
| 4, the page in three engines at once | `npx playwright test e2e/page.spec.ts` | `results/page.json` |
| 5, the audit | `npm run build && node scripts/audit.mjs --app-options`; sizes: `npm run build && node scripts/sizes.mjs` | printed; `--json <file>` to keep |

Each Playwright command builds `dist/` and serves it first. `e2e/scene.spec.ts` checks the scene in each engine on its own, and `e2e/smoke.spec.ts` that the page loads.

**Recording a measurement round:** `node scripts/m0-run.mjs --name <name> [--wait-load 4] [--results <files>] -- <command>` runs any of the commands above and appends to `results/runs-log.json` what it ran under: `uptime` before, the load average and the CPU in use every 2 s (this run's process tree against every other process), and its exit code and wall time. `--wait-load 4` first waits, up to 20 minutes, for the 1-minute load to fall to 4, as the timing runs (3, and 4's frames) need. Its raw output goes to `results/tmp/<name>.log`. Then:

| Script | Writes |
|---|---|
| `node scripts/checks-summary.mjs` | `results/checks.json`: run 2's lint, typecheck and vitest, from the raw output in `results/tmp/` |
| `node scripts/audit-classify.mjs` | `results/audit-classified.json`: run 5's findings, each classified with its evidence (after the audit, `--json results/audit.json`, and the sizes script) |
| `node scripts/stop-rule.mjs` | `results/stop-rule.json`: M0's stop rule, condition by condition; it measures the bit-still, energy and P8 conditions itself, with counts, and reads the rest from the runs' files, every `results/cost*.json` included |

**The verification round:** `scripts/verify/` re-checks the stop rule's conditions independently of the spike's own helpers, and `results/verify/` holds its results, with the verifier's own repetitions of runs 1 and 3 (`determinism-*.json`, `cost.json`). `stop-rule.mjs` reads only the top-level `results/cost*.json`.

| Command | Writes to `results/verify/` |
|---|---|
| `node scripts/verify/sim-checks.mjs` | `sim-checks.json`: every field of the state bit-still, in scenes with real contacts too; the 32 hits and a fuzz of 3,000 mid-air hits, with the switches read back; P8 on every key of the state over 57 mirrored runs |
| `node scripts/verify/sitting.mjs` | `sitting.json`: the sitting slip-out case under three readings of "reaches the floor" |
| `npx vite build --config scripts/verify/vite.config.mjs && node scripts/verify/driver.mjs det` | `det-extra.json`: 22 scripted runs outside the goldens, hashed every 100 ticks in Node and the three engines |
| the same build, then `node scripts/verify/driver.mjs cost` | `cost-series.json`: run 3's tick on the plan's script with every timed tick kept, a busy-loop check of the throttle, and a paced mode with nothing drawn |
| `npm run build && node scripts/verify/drawn-gl.mjs [reps] [batch]` | `drawn-gl.json` (appended): the drawn reading on software GL and on the GPU (`GALLIUM_DRIVER=d3d12`), with each Chromium process type's CPU |

### The cost revisit

M0's stop rule asks for D-3's and D-5's settings to be revisited before M1 if run 3's cost condition fires (REPORT.md §4). Four settings switch, each in `SimConfig` (`src/sim/config.ts`): `iterations` (D-5 step 5), `positionPasses` (step 6), `floorInSolve` (the floor's contacts in steps 5 and 6) and `substeps` (D-3, a tick's substeps; a substep is 1/(60 × substeps) s). A solver spec names a variant (`src/solver-settings.ts`):

| Token | What |
|---|---|
| `base` | no change: the simulation's defaults |
| `m0` | M0's settings: 8 iterations, 2 position passes, the floor in, 4 substeps |
| `i<N>`, `p<N>`, `s<N>` | N iterations, position passes or substeps a tick |
| `floor`, `nofloor` | the floor's contacts in or out of steps 5 and 6 |

Tokens join with `+`, `,` or spaces, later ones winning: `i4+p1+nofloor`. Results name a variant by all four settings, as `i8 p2 floor s4`, and their files by its changes from M0's, as `i4+p1`.

- **Tests under a variant:** `TERRIEST_SPIKE_SOLVER=<spec>` makes every configuration a vitest run makes start from the variant (`test/solver-setup.ts`). The golden hashes change with any setting by design, so leave them out: `TERRIEST_SPIKE_SOLVER=i4 npx vitest run --exclude src/sim/golden.test.ts`. `TERRIEST_SPIKE_MEASURE_OUT=<file>` sends `measure.test.ts`'s results elsewhere than `results/sim.json`; under a variant it's required, and `measure.test.ts` refuses to run without it.
- **The page:** `?test=cost&solver=<spec>` times the variant.

| Command | Writes to `results/revisit/` |
|---|---|
| `node scripts/revisit/behaviour.mjs --solver <spec>` | `behaviour-<name>.json`: the vitest suite without the goldens under the variant, each failure marked a §16 behaviour or a pinned M0 record, and the slip-out cases judged on `measure.test.ts`'s full sweep; `sim-<name>.json`: that sweep's results |
| `node scripts/revisit/cost.mjs --name <batch> --solvers m0,i4,… [--reps 3]` | `cost-<batch>.json`: run 3's method under each variant, in Chromium at 4×, drawn and back to back, at the desktop's size and the Pixel 8a's, with the load each run waited for and ran under; it builds `dist/` first |
| `node scripts/revisit/settle.mjs --solver <spec>` | `settle-<name>.json`: when, if ever, `contacts.test.ts`'s bit-still scenes stop changing over 36,000 ticks, and how far a scene that never rests ranges |
| `node scripts/revisit/profile.mjs --solver <spec>` | `profile-<name>.json`: a step's time by D-5's parts, from V8's CPU profile of the back-to-back bench in Node |
| `node scripts/revisit/summary.mjs` | `summary.json`: every variant's behaviour and cost, and the adoption rule's pick |
| `node scripts/revisit/checks.mjs` | `checks.json`: lint, typecheck and the whole vitest suite at the settings in force |
| `TERRIEST_SPIKE_DETERMINISM_OUT=results/revisit npx playwright test e2e/determinism.spec.ts` | `determinism-<engine>.json`: run 1, kept apart from M0's `results/determinism-*.json` |

Under a variant, `scripts/stop-rule.mjs --measured-only --out <file>` measures its own three conditions (bit-still, energy, P8) with their counts, as `results/revisit/conditions-<name>.json` holds for each variant timed: `TERRIEST_SPIKE_SOLVER=i4 node scripts/stop-rule.mjs --measured-only --out results/revisit/conditions-i4.json`. `scripts/verify/sim-checks.mjs --out <file>` runs the verifier's checks the same way. Without those options both refuse a variant, so `results/` and `results/verify/` keep M0's settings.

## The simulation's rules

`eslint.config.mjs` applies D-1 and D-38 to `src/sim/`:

- **Exact operations only,** tests excluded: hermet's `exact-ops` rule, imported from the hermet checkout beside this repo (`../../../hermet`, at 11283ca, D-37), so M0 needs no submodule.
- **`Math` only as `Math.<name>`,** tests excluded. The rule matches names, so `const { sin } = Math`, `const M = Math` and `f(Math)` would slip past it. `no-restricted-syntax` bans every such use.
- **No global state,** tests excluded: no DOM, timer, storage or network global, no `eval` or `Function`, and no `globalThis`, `self` or `window`, so nothing reaches `Math` another way.
- **No drawing code,** tests included: nothing in `src/sim/` imports `three` or `src/scene`, statically or dynamically.

`test/eslint-config.test.ts` checks each rule through the real config, with the planted fixture under `src/sim/lint-fixtures/` among the cases. `eslint .` skips that folder.

## TypeScript

`tsconfig.json` copies hermet's base options rather than extending them, so typechecking needs no hermet checkout: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and the rest, plus `erasableSyntaxOnly`.

`allowImportingTsExtensions` is also on, so a script can import the simulation by its `.ts` paths and run straight under Node 22, which strips types by default. Extensionless imports work everywhere else.

## Versions

Chosen 2026-11-15:

| Package | Range | Installed |
|---|---|---|
| three | 0.187.0, exact | 0.187.0 |
| @types/three | 0.187.0, exact (dev) | 0.187.0 |
| vite | ^8.3 | 8.3.8 (rolldown 1.2.19) |
| typescript | ~6.0 | 6.0.3 |
| vitest | ^4.1 | 4.1.12 |
| @playwright/test | 1.64.1, exact | 1.64.1 |
| eslint | ^10 | 10.15.0 |
| @eslint/js | ^10 | 10.0.1 |
| typescript-eslint | ^8.72 | 8.72.2 |
| @types/node | ^22.10 | 22.20.5 |

- **@types/three:** it has a 0.187.0, published the same day as three 0.187.0 and tagged for TypeScript 6.0, so three keeps the plan's pin (D-34).
- **@types/node:** added for the Node APIs that configs and tests use.
