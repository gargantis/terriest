# M0 physics and rendering spike: report

**Date:** 2026-11-15. The results files' timestamps are in UTC, early on 2026-11-16. The cost revisit and its verification ran later on 2026-11-16 (§4), and you reported run 6 the same day (§7).
**Answers:** [PLAN.md](../../PLAN.md) §17 M0 (D-36): the exact-ops contact solver and the three.js page, measured before M1.
**Verdict:** the solver works and the page fits its budget, but the tick cost has no margin.
- **The five correctness conditions of the stop rule pass.** Node, Chromium, Firefox and WebKit agree bit for bit. A resting ball is bit-still, simultaneous hitters gain no energy, and mirrored kickoffs stay exactly mirrored. One slip-out rule passes all four of §16's cases: a 42° cone with a slipping flag.
- **The cost condition sits on its 4 ms line.** At 4× throttle, a 13-step tick's p95 is 2.86–3.39 ms with nothing drawn. While the page draws, with its ticks on the 60 Hz clock, it is 3.49–4.60 ms, over 4 ms in 11 of 26 runs. On the drawn reading, which roslambo's proxy used, the clause fires narrowly (§4).
- **The revisit it asks for keeps the settings, on two close calls.** Of the cheaper settings tried, only 6 or 4 solver iterations keep every test green, and both have drawn runs over 4 ms. 4 iterations sits on the line: 8 of its 20 drawn runs went over, with a median of 3.95 ms. Every setting whose drawn runs all stayed under 4 ms fails one test: a terrier pressing the ball into a wall never comes to rest. That test is M0's own, and §8 proposes it for §16. So D-3's and D-5's settings stay (§4).
- **The late-vote repair is too slow.** Its 270 steps take up to 96 ms at 4×, so D-11's spread is needed at M3.
- **The page passes its checks.** Its counts are within §12's guesses. D-35's policy is right as written, because GLTFLoader needs `blob:` in connect-src. The dist audit needs two app options and no hermet change.
- **Run 6, the frame verdict on your desktop GPU, passed** in the one load you reported, on ANGLE's Direct3D 11 path with the Intel Iris Xe. The report didn't say which browser and quality that was, so §7's other loads are still open.

## 1. Setup

| | |
|---|---|
| Machine | x86-64 machine: Intel Core i7-1255U, 12 threads (2 performance and 8 efficiency cores), Ubuntu under WSL2 in NAT mode |
| Node | 22.23.4 |
| Browsers | Playwright 1.64.1: Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2, all headless |
| WebGL | Drawn in software unless stated otherwise: SwiftShader in Chromium, llvmpipe in Firefox and WebKit. Where stated, the GPU path: the host's Intel Iris Xe through Mesa's D3D12 driver (`GALLIUM_DRIVER=d3d12`), with ANGLE's GL flags for Chromium |
| Packages | three 0.187.0 and @types/three 0.187.0, both exact; Vite 8.3.8 (rolldown 1.2.19), TypeScript 6.0.3, ESLint 10.15.0, vitest 4.1.12 |
| hermet | the checkout beside this repo (`../../../hermet`) at 11283ca, unchanged: its exact-ops rule, licence writer and dist audit |
| Load | The timing runs waited for a 1-minute load of 4 or less (`scripts/m0-run.mjs`, which logs the load in `results/runs-log.json`). Run 3's last two spec runs started at loads of 0.92 and 0.38. Other processes used 0.16 cores on average during them. The cost revisit's 120 runs each waited the same way (`scripts/revisit/load.mjs`). They started at loads of 1.36–4.00, and other processes used 0.09–0.32 cores on average during each. The verification's 60 runs started at 2.07–3.95; its sampler put other processes at 0.50–0.72 cores, but it counts kernel time and the session's own work as other |

The raw results are in [results/](results/), and the verification round's in [results/verify/](results/verify/). §11 has the commands, and [README.md](README.md) has every command, URL parameter and results file.

## 2. What was built

Everything is in this folder, with its own toolchain (D-36). Nothing outside it changed.
- **The simulation** (`src/sim/`). It uses exact operations only, under hermet's exact-ops rule, and `Math` is never destructured or aliased.
  - roslambo's angles, plus `datan2`: an octant reduction, one exact division and an odd polynomial t·P(t²) with 15 coefficients, rounded to an integer.
  - roslambo's MurmurHash3, over a canonical encoding of the spike's state.
  - The main pitch and D-4's second shape, each built from 28 bounded pieces. Half of the pieces are built, and the other half come from exact point reflection.
  - D-5's solver. Every slip-out candidate can be switched, and so can the four settings the cost revisit tried: the solver's iterations, its position passes, the floor's part in the solve, and D-3's substeps a tick (§4). Their defaults are M0's: 8, 2, the floor in, and 4.
  - D-6 and D-7: movement, the three steering frames, zoomies, jumps, pounces, tumbles and Q-8's bowling. Also kickoffs, goals and touches, and A.2's u16 inputs.
  - 37 golden scripts and a canary, plus `createSimSource`, the only way the page reads the simulation.
  - The state is the spike's own, not A.1's: it has no player IDs, names, Ready or clock. Only kickoff countdowns, play and celebrations are played.
- **The page** (`src/scene/`, `src/main.ts`): a procedural pitch, a glossy ball that squashes, blob shadows and a ball-view camera behind terrier 0. It draws the simulation's 8 terriers, advancing them by the clock and drawing on animation frames.
  - **The code-built drawer:** one `InstancedMesh` per part, across all terriers.
  - **The model drawer:** a chunk of its own, loaded by dynamic import. It has GLTFLoader, plus a SkeletonUtils clone and an AnimationMixer per terrier, and sets each action's time from the state.
  - **The stand-in skinned model:** one skinned mesh with 8 bones, 8 clips and an embedded 256 × 256 PNG. `scripts/make-standin.mjs` writes it byte by byte, and the tests serve it to the built page by interception.
  - **roslambo's frame verdict,** shown on the page, and two test modes: `?test=determinism` (run 1) and `?test=cost` (run 3).
- **Tools:**
  - `e2e/serve.mjs` serves `dist/` with `_headers` applied, as Cloudflare reads it.
  - `scripts/audit.mjs` runs hermet's licence writer and dist audit with no exceptions.
  - `scripts/sizes.mjs`, `scripts/tokenizer-check.mjs` and `scripts/cost-node.mjs`, which is run 3 in Node.
  - `scripts/stop-rule.mjs` judges the stop rule, and `scripts/verify/` re-checks it independently.
  - `scripts/revisit/` runs the cost revisit under each setting: its tests, a settling probe, run 3's cost, a profile and the adoption rule, into `results/revisit/` (§4). The verification's own drivers are kept, as text, in `results/verify-revisit/drivers/`.
- **Tests:** 170 unit tests pass, with 6 environment-guarded measurements skipped: M0's 163, plus 7 for the revisit's switches. Lint, with no warnings, and the typecheck are clean; I re-ran all three after the revisit. The integration round's full Playwright run passed 41 tests in the three engines.

## 3. The questions M0 had to answer

| Question | Answer | Evidence |
|---|---|---|
| Determinism, per engine | **Pass in all four.** Node 22.23.4, Chromium 156, Firefox 157 and WebKit 27.2 reproduce every hash of 37 scripted runs: 178 checkpoints over 89,000 ticks, and the canary 10272cf4a03fa75b. 22 further seeded runs match too, with 750 hashes per engine. | Run 1 |
| Is resting contact bit-still? | **Yes.** Three scenes ran for 36,000 ticks (10 minutes) each, and no body's state changed by a bit in any tick. In one scene a terrier touches the ball in all 144,000 substeps. In another the terrier presses the ball into a wall. | Run 2 |
| Push times to 95% of run speed | One pusher **1.225 s**. Four in a train **0.575 s**, two in a train 0.779 s. Side by side, in the pitch frame and then the ball frame: two round the ball 0.829 and 2.033 s; two on a line 0.833 and 2.033 s; four round the ball 0.721 and 1.313 s; four on a line 0.758 and 0.921 s. | Run 2 |
| Which slip-out rule passes §16's cases, and how soon it brings the ball down | **A 42° cone from vertical with the slipping flag,** at 2 m/s.<br>• A ball resting on pushers comes down within 1.383 s of first landing on them (864 cases, against a 1.5 s mark).<br>• Between two sitting terriers it comes down within 0.471 s (against 0.5 s).<br>• 336 dribbles never slip out.<br>• Kickoff pinches come down 0.433–1.650 s after landing, mirrored.<br>The same rule with restitution 0 also passes. None of the other 14 candidates does. | Run 2 |
| Does a mirrored kickoff stay mirrored? | **Yes, exactly.** 37 mirrored runs, 345,600 substeps and 36.9 million values compared after every substep, with 1,884 slip-outs inside them: no mismatch. | Run 2 |
| Tick cost per step and per tick, with its contacts per substep, and the worst single ticks | Measured on the plan's script, at **11.65 contacts per substep** (8.53 of them the floor's, at most 19), in Chromium.<br>• **Per step:** 26.5–29.9 µs at 1×, and 129–148 µs at 4×.<br>• **A 13-step tick's p95:** 0.55–0.71 ms at 1×. At 4×, 2.86–3.39 ms with nothing drawn, or 3.49–4.60 ms while the page draws.<br>• **Worst ticks at 4×:** 30 steps took at most 15.5 ms and 42 steps 23.3 ms. 270 steps took 47.7–96.2 ms at most, over 50 ms in 21 of 24 configuration runs. | Run 3 |
| Frame time on your desktop GPU | **PASS** in the one load you reported: p95 ≤ 18 ms and max ≤ 50 ms at 60 Hz, on ANGLE's Direct3D 11 path with the Intel Iris Xe. The report gave the verdict and the renderer, but not the browser, the quality or the interval's figures, so the other loads are still open (§7). Before it, headless on this machine's GPU path, the scene passed in all 12 configurations of engine, drawer and quality: p95 at most 17.2 ms, max at most 18 ms. That bench drove the scene from a stub, not the simulation. | Run 6 |
| The spike's counts against the drawing budget's starting guesses | **All under the guesses.**<br>• A code-built terrier: 1,516 triangles, against 2,000.<br>• The stand-in: 2,220 triangles, 8 bones and a 256 × 256 texture, against 8,000, 32 and 512 × 512.<br>• 8 terriers in 9 draw calls code-built and 16 with the stand-in, against 40.<br>• Download per drawer, brotli, three not included: at most 23,747 B code-built, and 30,572 B more with the stand-in, against 200 KB.<br>M0 lowers none of the figures (§8). | Runs 4 and 5 |
| What three.js and GLTFLoader cost to download | **three's core:** 118,806 B brotli (594,863 raw), shared by both paths. **The model chunk** (GLTFLoader, SkeletonUtils and the drawer): 13,320 B (49,773 raw), loaded on the model path only. Another 10,014 B of three's core serve only GLTFLoader, but they ship in the entry chunk, which both paths load. | Run 5 |
| What the content security policy must allow for GLTFLoader | **`blob:` in connect-src,** as D-35 plans. Under amorfus's policy, each engine refuses one fetch (connect-src blocking `blob:`) and the embedded texture is missing. Under D-35's policy exactly as written, the texture loads at 256 × 256 in all three engines, with nothing refused. | Run 4 |
| What the audit found | **Two findings, both cleared by app options.** `_headers` has an extension that isn't allowed (`textFiles: ['_headers']`, as D-37 plans). Three's `LoaderUtils.extractUrlBase` holds a bare `'/'` (`ignoredPaths: ['/']`). With both options the audit is clean. No host appears in any string, the notices carry three's MIT text, and hermet's tokenizer agrees with TypeScript's parser on every chunk. | Run 5 |

## 4. The stop rule, condition by condition

| Condition (§17 M0) | Verdict | Numbers |
|---|---|---|
| Any engine mismatching in run 1 | Pass | Each of the 4 engines matched all 37 runs and 178 checkpoints, with canary 10272cf4a03fa75b. With the revisit's switches in and the defaults unchanged, all four matched again |
| A resting ball not bit-still | Pass | 3 scenes of 36,000 ticks each: no tick differed, and the largest deviation was 0 |
| Simultaneous hitters gaining energy | Pass | 32 hits over 3,840 substeps. Kinetic energy never rose above its start, and from the floor, kinetic plus potential energy never did either. Horizontal momentum changed by at most 7.1e-15. A fuzz of 3,000 mid-air hits found no rise in 144,000 substeps |
| A mirrored kickoff not exactly mirrored | Pass | 37 runs, no mismatch in 36.9 million values. The verifier's 57 runs found none in 75.5 million |
| No slip-out rule passing §16's slip-out cases | Pass | 42° with the flag, and 42° with the flag and restitution 0, pass all four cases |
| A 13-step tick's p95 over 4 ms in Chromium at 4× throttle | **Fires narrowly, on the drawn reading.** The revisit found no setting to change | See below |
| Noted only: a worst single tick over 50 ms at 4× | Over | 270 steps took 47.7–96.2 ms at most. D-11's spread is needed at M3, and M0 doesn't stop for it |

**The cost condition.**
- **What was timed:** the plan's script is the 4-a-side scrum at the wall, under 42° with the flag, at 11.65 contacts per substep. Every run timed 1,200 13-step ticks, after 120 settling steps and 120 untimed ticks, in Chromium 156 at 4× throttle.
- **The sizes:** the desktop's 1280 × 720, and the Pixel 8a's 412 × 839 at a device pixel ratio of 2.625.

| Reading | Runs | p95 (ms) | Median p95 (ms) | Over 4 ms |
|---|---|---|---|---|
| Back to back, nothing drawn | 10 | 2.855–3.390 | 2.987 | 0 |
| Paced at 60 Hz, nothing drawn | 4 | 2.960–3.335 | 3.217 | 0 |
| Drawn, ticks on the 60 Hz clock, software GL | 16 | 3.810–4.600 | 4.025 | 8 |
| Drawn, ticks on the 60 Hz clock, GPU path | 10 | 3.485–4.340 | 3.830 | 3 |

- **The frame rate while drawn:** in software GL at 4×, the page drew 22–26 frames a second at the desktop's size and 33–41 at the Pixel 8a's. On the GPU path it drew 59.5–60. The ticks ran on the page's 60 Hz clock either way.
- **The simulation's own tick passes,** 15% under the line at its worst run.
- **Drawing is what takes the margin.**
  - At 4×, drawing raises the tick's mean by about 40%: 2.03–2.77 ms against 1.63–1.92 ms.
  - Pacing alone raises it by 5–8%: 1.748 and 1.757 ms, against 1.668 and 1.626 ms.
  - SwiftShader's CPU use isn't the cause. On the GPU path the GPU process uses 0.2 cores instead of 4.6–5.4, and the tick still goes over 4 ms in 3 of 10 runs.
- **The plan doesn't say which reading it means.** C-2 asks for the measurement "as roslambo's proxy does", and that proxy timed its ticks inside its drawn frame bench (roslambo's `e2e/phone-proxy.spec.ts`). So the drawn reading is the closer one, and on it the clause fires.

**The revisit, before M1.** The clause asks for D-3's and D-5's settings to be revisited. Their design stays; the revisit tried their settings. The rule, set before any timing: adopt the cheapest setting that keeps every §16 test green and every drawn run under 4 ms, and if none qualifies, keep the settings and go on.
- **The settings:** each is now a switch, with M0's values as the defaults (README.md, "The cost revisit"):
  - 6 and 4 solver iterations, against 8. Eight is converged on the hits, since 8, 16, 64 and 512 give the same speeds;
  - 1 position pass, against 2;
  - the floor's contacts out of steps 5 and 6. They are 8.53 of the 11.65 contacts in the list;
  - 3 substeps a tick, against 4. At 25 m/s a body still moves only 0.14 m a substep, under the 0.25 m radius;
  - then 4 or 6 iterations with 1 pass, and with 3 substeps. The floor out failed too much alone to be worth combining.
  - The clause's third lever, the pieces' bound test, is the one M0 already built (§8, D-5).
- **The tests:** under each setting, the whole vitest suite but the golden hashes, which change with any setting by design: 167 tests (`scripts/revisit/behaviour.mjs`). They cover bit-still, bounces, simultaneous hits, push times, the slip-out cases, P8, tunnelling and containment, and movement. Run 2's full slip-out sweep also ran under each setting, and `scripts/stop-rule.mjs` counted its bit-still, energy and P8 conditions.
- **The cost:** run 3's method (`scripts/revisit/cost.mjs`). That's the production page's `?test=cost` mode on the plan's script, in Chromium 156 at 4×, drawn and back to back, at the desktop's size and the Pixel 8a's, in software GL as run 3 draws.
  - All 10 settings ran in one batch, with M0's as the control: 3 repetitions, each in a fresh browser, with the settings' order rotated each time. That's 120 runs, 6 drawn and 6 back to back for each setting.
  - Each run waited for a 1-minute load of 4 or less (§1).
  - M0's settings read within run 3's ranges: 3.945–4.595 ms drawn and 3.075–3.330 ms back to back. More of their drawn runs went over 4 ms, though (below).

| Setting | §16's tests | Drawn p95 (ms) | Drawn runs over 4 ms | Back to back p95 (ms) | Back to back mean, median (ms) | Contacts a substep |
|---|---|---|---|---|---|---|
| M0's: 8 iterations, 2 passes, the floor in, 4 substeps | Pass | 3.945–4.595 | 5 of 6 | 3.075–3.330 | 1.845 | 11.65 |
| 6 iterations | Pass | 3.900–4.315 | 2 of 6 | 2.800–3.045 | 1.675 (−9%) | 11.98 |
| 4 iterations | Pass | 3.735–4.255 | 3 of 6 | 2.750–3.115 | 1.537 (−17%) | 11.18 |
| 1 position pass | Fail: bit-still | 3.400–3.915 | 0 | 2.380–2.790 | 1.466 (−21%) | 10.06 |
| 6 iterations, 1 pass | Fail: bit-still | 3.900–4.360 | 4 of 6 | 2.790–2.965 | 1.498 (−19%) | 10.17 |
| 4 iterations, 1 pass | Fail: bit-still | 3.005–3.700 | 0 | 2.275–2.960 | 1.207 (−35%) | 10.36 |
| 3 substeps | Fail: bit-still | 3.450–3.955 | 0 | 2.500–2.805 | 1.344 (−27%) | 10.35 |
| 6 iterations, 3 substeps | Fail: bit-still | 3.180–3.475 | 0 | 2.185–2.460 | 1.232 (−33%) | 11.59 |
| 4 iterations, 3 substeps | Fail: bit-still | 3.215–3.655 | 0 | 2.295–2.700 | 1.072 (−42%) | 10.08 |
| The floor out | Fail: bit-still, dribbles | 2.710–2.995 | 0 | 1.825–2.050 | 0.913 (−51%) | 2.62 |

- **Only fewer iterations pass the tests.**
  - At 6 and at 4 iterations all 167 tests pass, and every bit-still scene holds for its 36,000 ticks.
  - 42° with the flag still passes all four slip-out cases on the full sweep. At 4 iterations:
    - the ball comes down within 1.383 s from the pushers, and within 0.467 s between two sitting terriers;
    - none of 336 dribbles slips out;
    - the pinches come down in 0.425–1.488 s, mirrored.
- **Every other setting fails the bit-still test.** A terrier pressing the ball into the wall never comes to rest.
  - Its state cycles every 2 to 9 ticks for all 36,000. Over the last 1,000 it ranges 0.19–0.28 mm and 0.029–0.038 m/s (`scripts/revisit/settle.mjs`). Under M0's settings, and at 6 and 4 iterations, it rests from tick 11.
  - With 1 pass, the terrier resting against the ball at the wall also settles at tick 12, after the test's 10 settling ticks. From tick 12 it is bit-still, so that failure is the test's settling allowance.
  - **The floor out fails the dribbles too.** 24 of 336 dribbles slip out under 42° with the flag: the ball hops onto the dribbler at down to 34.4° from vertical, inside the cone, against 43.5° with the floor in. Its tunnelling test failed as well, but nothing tunnels. Two terriers hitting the ball from both sides at 25 m/s pop it to 3 m, and the test's crossing check, which had no height test, counted the terrier running under it as passing through. The deepest overlap is 3.5 mm. The check now tests height (`tunnel.test.ts`). The floor out passes it, and it still catches a terrier that skips through a resting ball in one substep (a probe at 600 m/s).
  - **3 substeps also narrow the cone's window:** the dribble sweep's lowest hop onto the dribbler falls to 42.84° from vertical, against 43.53°.
  - Energy and P8 hold under every setting. In the 32 hits kinetic energy never rose above its start, and momentum changed by at most 7.1e-15. No mirrored value differed in the 37 runs.
- **So no setting qualifies.** 6 and 4 iterations have drawn runs over 4 ms. Every setting whose drawn runs all stay under 4 ms fails the bit-still test.
- **Verified independently** (`results/verify-revisit/`), with drivers of its own:
  - **The variants ran:** in all 120 of the revisit's timed runs, and all 56 of the verification's at the default warm-up, the page counted exactly the contacts Node's harness counts under the same settings.
  - **The throttle applied:** after each run, a fixed busy loop in the same page ran 3.0–6.2 times slower at 4× than at 1×, with a median of 4.3.
  - **The warm-up is excluded:** dropping the first 50 or 300 timed ticks never lowered the p95 by more than 0.025 ms. 600 warm-up ticks instead of 120 didn't lower it either.
  - **M0's settings fire the clause again:** 12 drawn runs at 4.025–4.490 ms, all over 4 ms. Back to back, 3.060–3.195 ms.
  - **The tests:** at 4 and 6 iterations all 167 pass. 3 substeps, alone or with 4 iterations, fails only the pressing scene, and 1 pass fails it and the wall-resting scene. A probe confirmed that every test file's simulations ran the named settings. The pressing scene's verdict holds in six head-on versions of it: M0's settings and fewer iterations rest in all of them, and the other settings cycle in all of them.
  - **4 iterations:** 3.770–4.315 ms drawn, 3 of 12 over 4 ms, and 2 more runs at 4.04 and 4.17 ms on a build that kept every tick.
- **Two calls decide the outcome.**
  - **4 iterations' cost.** Across both batches, 8 of its 20 drawn runs went over 4 ms, with a median of 3.95 ms. The rule disqualifies it on any run over 4 ms; a rule on the median would adopt it.
  - **The pressing scene.** PLAN §16 asks only that a resting ball and a standing terrier stay bit-still. The pressing scene is M0's own addition, which §8 proposes for §16, and it is the only test that 3 substeps, alone or with 4 or 6 iterations, fails. Without it, 4 iterations with 3 substeps would qualify: none of its 6 drawn runs went over 4 ms (3.215–3.655 ms), and it takes 42% off the back-to-back tick. The verification didn't re-time it.
  - With §8's amendment applied and the rule read strictly, the settings stay.
- **The line moves between rounds.** In the revisit's and the verification's rounds, M0's settings went over 4 ms in 19 of 20 drawn runs, with a median of 4.28 ms. In run 3 they went over in 8 of 16 software-GL runs, with a median of 4.025 ms. Their back-to-back p95 didn't move: 3.060–3.330 ms, within run 3's range. The loads don't explain the shift (§1), and its cause wasn't measured. So a setting near the line can pass in one round and fail in the next. Compared in the same rounds, 4 iterations went over in 8 of 20 drawn runs, against M0's settings' 19.
- **The drawn p95 follows the simulation's cost only loosely.**
  - 4 iterations cut the back-to-back mean by 17%, but 3 of its 6 drawn runs went over 4 ms, up to 4.255 ms. In the verification's 14, 5 did, up to 4.315 ms.
  - Drawing adds 0.61–1.47 ms to a run's p95, with a median of 1.06 ms. That compares each drawn run with the back-to-back run of the same setting, repetition and size.
  - So the back-to-back p95 doesn't predict the drawn one. A 4-iteration run at 2.750 ms back to back drew at 4.125 ms. An M0 run at 3.330 ms drew at 3.945 ms.
  - Each setting plays the scrum differently, at 10.06–11.98 contacts a substep against M0's 11.65, so the settings weren't timed on the same states. With 1 pass, for one, the scrum peaks at 14 contacts in a substep, against 19.
- **Where a step's time goes:** V8's sampling profile of the back-to-back bench in Node (`scripts/revisit/profile.mjs`). At M0's settings the impulses take 47% of the simulation's time, detection 20%, the rest of a tick's code 12% and the position passes 8%. At 4 iterations the impulses take 27%.

**So the settings stay:** 8 iterations, 2 position passes, the floor in steps 5 and 6, and 4 substeps. The goldens are unchanged. As the rule planned for this case, M1 goes on:
- the simulation's own tick passes: back to back at 4×, the control's p95 was 3.075–3.330 ms;
- D-11 usually steps 1–2 ticks rather than 13;
- the phone run at M5 decides (C-2). If it needs cheaper ticks, 4 iterations is the cheapest setting that passes §16's tests.

**Either way, the clause should name its reading:** the tick timed while the page draws, its ticks on the 60 Hz clock, as roslambo's proxy measured, with the nothing-drawn reading reported beside it.

## 5. The runs

### 5.1 Run 1: engine goldens

- **Method:** `e2e/determinism.spec.ts` opens the production bundle's `?test=determinism` page in Chromium, Firefox and WebKit. The page runs `goldenSuite()` and `canaryHash()` and compares them with `src/sim/goldens.json`, checkpoint by checkpoint and counter by counter. Node replays the suite in a clean child process.
- **The 37 scripts:**
  - kickoffs at every pack size on the main pitch, and at 2 and 4 a side on D-4's second shape;
  - a resting ball and a rolling ball;
  - pushes by 1–4 in a train, and by 2–4 abreast in both frames;
  - a squeeze;
  - pinches at 1–4 a side, with zoomies and under the candidate rules;
  - kickoffs under 42° with the flag, and under 42° with the flag and restitution 0;
  - 4-a-side scrums at the wall and in a corner;
  - pounces, goals, and a 20,000-tick long run.

  The scripts hash every 500 ticks: 178 checkpoints over 89,000 ticks.
- **Result:** every hash and counter was equal in all four engines, with canary 10272cf4a03fa75b. The suite took 1.7–2.9 s per engine.
- **Re-checked:** the verifier re-ran the spec with the same result. They also ran 22 seeded runs outside the goldens: 75,000 ticks at 7.5–37.1 contacts a tick, hashed every 100 ticks. All 750 hashes per engine matched.
- **Where the contacts are:** the mirrored kickoff scripts are light on contacts, with 0.01–0.13 a substep besides the floor's. The pinches, the squeeze and the scrums carry them: up to 4.2 a substep besides the floor's, and up to 24 in one substep.

### 5.2 Run 2: contact behaviour

- **Method:** vitest in Node. Each behaviour has a test in `src/sim/*.test.ts`. `measure.test.ts` writes the numbers to `results/sim.json`. `scripts/stop-rule.mjs` measures the stop rule's conditions with counts (`results/stop-rule.json`). `scripts/verify/` re-checks them with comparators of its own (`results/verify/`).
- **Bit-still:** three scenes ran for 36,000 ticks each, with every field compared after every tick. No body's position, velocity, heading or floor flag changed by a bit. Only counters moved, such as the tick, plus the gait and last-push fields while a terrier pressed. The scenes:
  - a resting ball with two standing terriers;
  - a ball against the side wall, with a terrier touching it in all 144,000 substeps;
  - the terrier pressing the ball into the wall, which the ball touches in 72,000 of the 144,000 substeps.
- **Bounces** (`contacts.test.ts`):
  - **Off the floor**, the ball rebounds at 0.6973–0.7031 of √(2gh) from drops of 0.25–4 m. That's semi-implicit Euler's error, within 1%.
  - **Off a side wall, an end wall, the overhead net, a post and the crossbar**, it keeps 0.7, to within 1e-10. Off the goal's back netting it keeps 0.3.
  - **Terrier against ball:** 0.5, so a level hit at 6, 9 and 10 m/s sends a resting ball off at 3, 4.5 and 5 m/s. Terriers keep 0.3 off each other and off walls.
  - **Below 0.3 m/s**, contacts settle with no bounce, and a landing terrier never bounces, from heights up to 5 m.
  - **The rolling slowdown** is right to within 1e-12 m/s a substep, and it stops the ball exactly.
- **Simultaneous hits** (k terriers at 6 m/s, with the drive, friction and rolling off; `hits.test.ts`):

  | Ball speed (m/s) for k = 1–4 | Parallel | Aimed at the centre |
  |---|---|---|
  | From the floor | 2.656, 3.571, 3.810, **3.685** | 2.656, 3.690, 4.300, 4.477 |
  | Level | 3.000, 4.354, 4.999, 5.213 | 3.000, 4.478, 5.469, 6.157 |

  - **Every k > 1 beats one hitter.** But from the floor, four parallel hitters send the ball slower than three, so §16's "faster as k grows" fails at k = 4.
  - **It's D-5's frictionless model, not under-convergence.** 8, 16, 64 and 512 iterations give the same speeds, and a hand solution of the contact problem agrees (3.72 against 3.85 m/s).
  - **With the floor out of the solve,** the floor rows read 2.160, 3.055, 3.335 and 3.222 (parallel), and 2.160, 3.138, 3.772 and 3.987 (at the centre).
- **Pushes:** timed from rest and in contact, with the rolling slowdown, until the ball reaches 95% of run speed (5.7 m/s). The pushers hold +x in the pitch frame, or toward the ball in the ball frame.

  | Layout | Pitch frame | Ball frame |
  |---|---|---|
  | One pusher | 1.225 s | 1.225 s |
  | Two in a train, one behind the other | 0.779 s | |
  | Four in a train | 0.575 s | |
  | Two round the ball, touching it 33° apart | 0.829 s | 2.033 s |
  | Two on a line, abreast 0.52 m apart | 0.833 s | 2.033 s |
  | Four round the ball | 0.721 s | 1.313 s |
  | Four on a line | 0.758 s | 0.921 s |

  - **Ball view:** each pusher drives at the ball's centre, so it pushes forward only while the ball is slower than 6·cos of its angle off the ball's travel. For two pushers 16.5° off, that's 5.75 m/s, just above the 5.7 m/s mark, hence 2.03 s.
  - **The floor's reading:** with the floor out of the solve, every time is within 0.06 s of these.
- **Slip-out:** each candidate ran on §16's four cases.
  - **Case 1:** a ball dropped from 1 cm onto terriers placed round it. The contact angle runs from 5° to 58° from vertical, and the pack sizes from 1 to 4. The terriers hold toward the ball in the ball frame, or in opposite directions in the pitch frame, both mirrored and with one pack 2 cm and 1 tick off mirror. Each run gets 8 s: 864 cases.
  - **Case 2:** two sitting terriers, from 4° to 58° in 0.25° steps.
  - **Case 3:** a lone terrier dribbling at run and zoomies speed in both frames: 336 runs.
  - **Case 4:** the kickoff pinch at each pack size, at run and zoomies speed.

  "Down" means the ball's centre within 1 cm of its resting height, timed from its first landing on a terrier. Rows marked coarse ran 176 rest cases and 112 dribbles.

  | Rule | Ball on pushers | Two sitting | Dribbles | Kickoff pinches |
  |---|---|---|---|---|
  | None (coarse) | 81 held up | held up | 0 slip-outs | all 8 held up |
  | Drafted: 45°, no flag | 248 of 864 held up for 8 s | 0.471 s | 20 slip-outs | 6 of 8 held up |
  | 45° + flag | none held, worst 1.358 s | 0.471 s | 20 slip-outs | down in 0.433–1.650 s |
  | 57° + flag + restitution 0, the review's (coarse) | none held, worst 0.942 s | 0.362 s | 138 slip-outs | down in 0.304–0.754 s |
  | 44° + flag + restitution 0 | none held, worst 1.321 s | 0.388 s | 6 slip-outs | down in 0.304–1.021 s |
  | **42° + flag** | **none held, worst 1.383 s** | **0.471 s** | **0** | **down in 0.433–1.650 s** |
  | 42° + flag + restitution 0 | none held, worst 1.383 s | 0.463 s | 0 | down in 0.304–1.087 s |
  | 40° + flag (coarse) | none held, worst 1.363 s | **0.558 s** | 0 | down in 0.433–1.650 s |

  - **The pick has a 1.2° window.** Below 42°, two sitting terriers need more than 0.5 s: 41° gives 0.51 s and 40° gives 0.558 s. Friction alone holds them below atan(8/9.8) = 39.2°.
  - **Above it, dribbles slip out.** In a zoomies dribble the ball hops onto the dribbler at angles down to 43.23° from vertical: in ball view, 3 steps to the side, from 9 m/s. That's a case in `slipout.test.ts`, and the recorded sweep of 2,880 runs found 43.53°.
  - **So the cone must lie between 42° and 43.2°.**
- **P8:** 37 mirrored runs at sizes 1–4 on both shapes, 345,600 substeps:
  - The runs: `mirror.test.ts`'s 8 kickoffs, the 17 mirrored golden scripts, and 12 runs under 42° with the flag.
  - The comparison: by value after every substep, with no mismatch, and 1,884 slip-outs inside the runs.
  - The verifier's comparator walks every key of the state: 57 runs and 75.5 million values, with no mismatch.
- **Tunnelling and containment** (`tunnel.test.ts`):
  - 624 shots at 25 m/s at every piece of each pitch, plus the floor and the net at ±25 m/s, and terriers at 25 m/s: nothing passed through.
  - 60 seeded 600-tick scrambles per pitch, with the ball shot at up to 25 m/s: it never left either pitch. It spent 1,101 substeps (main pitch) and 1,449 (second shape) wholly behind a goal line, all of them inside a goal.
- **Movement and rules** (`movement.test.ts`): these all pass:
  - running, turning, zoomies with its meter and lockout;
  - jumps, pounces, tumbles and bowling;
  - all three frames, with the overhead hysteresis;
  - presses after 0, 1 and 13 absent ticks, and every u16 as an input, with the bark bits kept out of the hash;
  - L57's four behaviours;
  - kickoffs, goals, own goals and touches.

### 5.3 Run 3: cost

- **Method** (`e2e/cost.spec.ts`, `src/cost.ts`): the page's `?test=cost` mode drives `createReplayBench` on a scrum.
  - **The sequence:** 120 settling steps and 120 untimed ticks. Then 1,200 timed ticks: each finalises one tick and re-simulates the 12-tick window from a cloned state, which is 13 steps. Then 30 bursts each of 30, 42 and 270 steps, each timed alone.
  - **The browser:** Chromium 156 at the desktop's size and as Playwright's 'Pixel 8a', at a CPU throttling rate of 1 and of 4 (`Emulation.setCPUThrottlingRate`). The page is cross-origin isolated, for a 5 µs clock, at low quality.
  - **Two modes:** drawn (a 13-step tick on every 60 Hz tick while the scene draws the bench's state) and back to back (nothing drawn).
  - **Two scripts,** both 4-a-side scrums under 42° with the flag: the plan's scrum at the wall, and a denser one in a corner.
  - **Node** runs the same harness (`scripts/cost-node.mjs`), back to back and paced at 60 Hz.
  - **Repetitions:** the spec ran three times, twice in the measurement round and once in the verification round. The verifier added a paced mode with nothing drawn, a busy-loop check of the throttle, and drawn runs on the GPU path (`scripts/verify/`).
- **Contacts:** the plan's script has 11.65 per substep (8.53 of them the floor's, 3.13 others), with at most 19 in one substep. The corner scrum has 11.58 (8.53 the floor's), at most 17.
- **The 13-step tick on the plan's script,** as ranges over the three spec runs, desktop and Pixel 8a:

  | | 1×, back to back | 1×, drawn | 4×, back to back | 4×, drawn |
  |---|---|---|---|---|
  | Mean (ms) | 0.345–0.389 | 0.606–0.666 | 1.676–1.919 | 2.382–2.540 |
  | p95 (ms) | 0.550–0.710 | 1.005–1.130 | 2.895–3.390 | 3.810–4.135 |
  | Per step (µs) | 26.5–29.9 | 46.6–51.2 | 128.9–147.6 | 183.3–195.4 |

  - **Node 22.23.4, back to back:** mean 0.361–0.406 ms, p95 0.647–0.800 ms, 27.8–31.2 µs a step.
  - **Node, paced at 60 Hz:** mean 0.795–0.834 ms, p95 1.572–1.593 ms.
  - **The corner scrum** costs within a few percent of the wall scrum.
- **Worst single ticks:** both scrums, 24 configuration runs at 4× across the three spec runs, with 30 bursts each:

  | Steps (C-2) | Median (ms) | Max (ms) | Bursts over 50 ms |
  |---|---|---|---|
  | 30: a resync | 3.61–4.76 | 5.52–15.45 | 0 of 720 |
  | 42: a joiner's catch-up | 5.03–6.97 | 7.52–23.29 | 0 of 720 |
  | 270: a late-vote repair | 30.29–37.15 | 47.69–96.22 | 37 of 720, in 21 of the 24 runs |

  At 1×, the 270-step tick has a median of 6.8–10.7 ms and a max of at most 27.0 ms.
- **Checks on the method:**
  - **The throttle applies:** a fixed busy loop ran about 4.5× slower at 4×, taking 16.8–23.8 ms against 3.3–5.9 ms.
  - **JIT warm-up is excluded:** dropping the first 50 or 300 timed ticks, or quintupling the warm-up, doesn't lower the p95.
  - **The load was the runs' own** (§1).
- **Pacing and drawing:**
  - **At 1×, pacing at 60 Hz doubles the tick:** 0.781–0.885 ms against 0.374–0.413 ms in Chromium, and 0.795–0.834 ms against 0.361–0.406 ms in Node. That's likely the CPU's idle and clock-speed behaviour, though it isn't verified.
  - **At 4×, pacing adds 5–8% and drawing about 40%** (§4).

### 5.4 Run 4: the page in three engines at once

- **Method** (`e2e/page.spec.ts`): the built page is served by `e2e/serve.mjs` with `dist/_headers` applied.
  - The spec first checks that the served headers equal `public/_headers`, and that the planned policy is D-35's exact text.
  - Chromium, Firefox and WebKit then run together, each playing six loads in a fresh context at 1280 × 720, in software GL. Each load warms up for 1 s and measures 5 s.
  - **The six loads:** code-built at low and at high quality; code-built with frames held to 60 ms; the stand-in under the shipped policy (amorfus's); and the stand-in under D-35's policy, at low and at high.
- **Frame-rate independence:** the 18 loads ran at 6.6–38.2 fps. With frames held to 60 ms they ran at 10 fps in Chromium, 16.2 in Firefox and 11.8 in WebKit. In every load the tick equalled floor(60 × the seconds elapsed), read at the same instant: the worst error was 0 ticks, and none were dropped.
- **Counts,** identical in the three engines. They come from `renderer.info` and the drawer's own counts, and a pass of the terriers' layer alone agreed:
  - **Code-built:** 1,516 triangles a terrier, 12,128 for 8 in 9 draw calls. The whole frame: 18 calls, 16,610 triangles, 106 lines (204 at high), and 2 textures (grass and shadow, 371,368 B with mipmaps).
  - **The stand-in:** 2,220 triangles, 8 bones and a 256 × 256 texture a terrier; 17,760 triangles, 16 calls and 64 bones for 8. The whole frame: 25 calls, 22,242 triangles, and 19 textures without the stand-in's texture or 20 with it.
  - **Nothing compiled or uploaded in play:** programs (10 code-built, 8 or 9 on the model path), geometries and textures were equal at each window's start and end.
  - **Painting and requests:** every coat and both packs were painted. Every request stayed on the page's origin, or used `blob:` or `data:`. The code-built path loaded neither the model chunk nor a `.glb`.
- **The model's load,** with all three engines running: import 116–1,797 ms, load 85–1,416 ms, compile 16–295 ms.
- **The policy:** as in §3.
- **Bytes:**
  - **Chromium and Firefox** got brotli: the code-built path is 142,000 B of bodies (282 + 141,718).
  - **WebKit** isn't offered brotli on `http://127.0.0.1`, so it got gzip: 172,248 B.
  - **The model path** adds the 13,320 B chunk and the stand-in. The engines report intercepted responses unevenly, so the stand-in's figure is its file's: 121,296 B raw, 17,252 B brotli.
- **No frame verdict here:** frame intervals in software GL had a p95 of 45–200 ms in every load.

### 5.5 Run 5: the audit

- **Method:**
  - `npm run build`, then `scripts/audit.mjs`: hermet 11283ca's licence writer (product 'terriest spike'), then its `auditDist` with no exceptions (`allowedHosts: []`, `expectedLicensePackages: ['three']`).
  - `scripts/audit-classify.mjs` classifies each finding with its evidence.
  - `scripts/tokenizer-check.mjs` compares hermet's string tokenizer with TypeScript's parser on every chunk.
  - `scripts/sizes.mjs` measures each file at gzip level 9 and brotli quality 11. It also makes two measurement builds: one with three's core split out, and one with the model drawer stubbed out.
- **Findings:**
  1. `_headers: extension not allowlisted`. It's the host's header file. App option `textFiles: ['_headers']`, as D-37 plans.
  2. `assets/index-*.js: root-absolute URL (/)`. It's three's `LoaderUtils.extractUrlBase`, ``e.lastIndexOf(`/`)``: a separator, never requested. It sits in three's core and stays only because GLTFLoader imports it: a build without the model drawer has no finding. App option `ignoredPaths: ['/']`.

  With both options the audit is clean. No host appears in any string, and the notices file carries three@0.187.0's MIT text.
- **Tokenizer:** hermet's strings and TypeScript's agree as multisets on every chunk, with none missed and none invented: 2,034 in the entry chunk, 237 in the model chunk, 263 in the determinism chunk and 74 in the cost page. So no tokenizer fix is needed.
  - C-9's edge case is real: a regular expression after `)` that holds a quote hides a URL that follows it. `scripts/tokenizer-check.test.mjs` shows it, but it isn't in three 0.187.0's bundle.
- **Sizes** in bytes, from the build and the two measurement builds:

  | | brotli 11 | gzip 9 | raw |
  |---|---|---|---|
  | Code-built path: index.html and the entry chunk | 142,000 | 172,248 | 668,246 |
  | three's core alone (split build) | 118,806 | 145,170 | 594,863 |
  | The entry chunk without three's core (simulation, scene, code-built drawer) | 23,747 | 26,932 | 72,632 |
  | three's code in the entry chunk that only GLTFLoader uses | 10,014 | 12,480 | 50,158 |
  | Model path adds: the model chunk | 13,320 | 14,809 | 49,773 |
  | Model path adds: the stand-in `.glb` | 17,252 | 30,052 | 121,296 |

## 6. Where verification changed a number

The verification round (`scripts/verify/`, `results/verify/`) re-checked each condition of the stop rule independently. It changed these:
- **A bit-still test tested the wrong thing.**
  - The second scene, a terrier against a ball against the side wall, placed the bodies exactly touching. Rounding left the terrier 6.7e-16 m clear of the ball, and the ball clear of the wall. So only the 3 floor contacts existed, and the scene repeated the first.
  - Now each body starts 1 µm into the next and settles for 10 ticks. The scene has 4 contacts a substep, with the terrier on the ball in all 144,000 substeps, and it's bit-still.
  - A third scene, with the terrier pressing the ball into the wall, has the ball on the wall in 72,000 of the 144,000 substeps. It's bit-still too.
  - The verdict stands. `src/sim/contacts.test.ts`, `scripts/stop-rule.mjs` and `results/stop-rule.json` changed.
- **The cause of the cost gap.** The integration round put the drawn reading's excess down to the 60 Hz pacing. At 4× that's wrong: paced with nothing drawn, the tick's mean is 1.748 and 1.757 ms, against 1.668 and 1.626 ms back to back. Drawing adds the 40%. Pacing doubles the tick only at 1×.
- **The cost range widened.** With more drawn runs, the p95 at 4× is 3.810–4.600 ms on software GL (16 runs) and 3.485–4.340 ms on the GPU path (10 runs). The measurement round's four drawn runs gave 3.860–4.135 ms.
- **Worst ticks.** The 270-step repair went over 50 ms in all 8 of the verifier's 4× runs, against 13 of the measurement round's 16.
- **The sitting criterion.** The build round wrote that with an exact-floor criterion only the restitution-0 rules pass. That's misleading, because it depends on what "reaches the floor" means:
  - **The floor contact found in detection:** 42° with the flag still passes, at 0.475 s, a margin of 25 ms.
  - **The ball's centre at or below its resting height after the substep:** both 42° rules fail, at 1.283 s and 0.629 s, because the ball stays a fraction of a millimetre up between the terriers. Only the 57° and 58° cones with the flag and restitution 0 pass (0.371 s), and they fail the dribbles.

  So §16 must say which reading it means (§8).
- **P8's wording.** A comparator over every key of the state (57 runs, 75.5 million values, no mismatch) showed that P8's text misses two fields the spike mirrors correctly: the stored previous input, mirrored as a pitch-frame direction plus 16 steps, and the body a terrier slips from, mirrored as its mirror.
- **Lint gaps,** none of them present in `src/sim` today:
  - a `.tsx` or `.jsx` file there isn't linted at all;
  - a parameter typed `typeof Math` and called as `m.sin()` isn't caught;
  - nor is `toLocaleString`.
- **The cost revisit.** A second verification round re-ran its tests, run 1 and the drawn reading (§4). It changed these:
  - The floor out's tunnelling failure is the test's crossing check, not a pass-through. The check now tests height (§4).
  - 4 iterations' cost is a close call, not a clear miss: 8 of 20 drawn runs went over 4 ms.
  - The page doesn't draw at 60 Hz in software GL at 4×, only its ticks run on that clock (§4). The readings' names say so now.
  - `measure.test.ts` didn't refuse a solver variant without `TERRIEST_SPIKE_MEASURE_OUT`, so it could have overwritten `results/sim.json`. It refuses now, as `scripts/stop-rule.mjs` and `scripts/verify/sim-checks.mjs` do; `results/sim.json` was never overwritten.
- **Unchanged, with more evidence:**
  - determinism, with 22 new runs;
  - energy, with a fuzz of 3,000 mid-air hits and no rise in 144,000 substeps; the hits' switches were read back as off in every run;
  - P8, over 57 runs;
  - run 3's throttle and JIT checks.

## 7. Run 6, by hand

It answers "frame time on your desktop GPU" (§16, "By hand"). The measure is roslambo's verdict: the interval between animation frames at p95 ≤ 18 ms and max ≤ 50 ms, with the display at 60 Hz. The page is the spike's scene, drawing the simulation's 4-a-side showcase.

**Your result, 2026-11-16: PASS** in one load, on ANGLE's Direct3D 11 path with the Intel Iris Xe Graphics. The renderer line names your GPU, not a software renderer, so the load counts. Your report gave the box's verdict line and its renderer line. It didn't name the browser, or give the quality from the box's second line or the interval's figures from the line below the verdict. So it fills the first row of the table below, and the other loads are still open. §17's rule for attended steps covers them: they don't hold up M1, and they land before M5's deploy.

**Serve it** from a WSL terminal, in this repo:

```sh
cd research/spike
npm ci              # only if node_modules is missing
npm run build
node e2e/serve.mjs  # dist/ with public/_headers applied, at http://127.0.0.1:4329/
```

On Windows, WSL2's localhost forwarding serves it at `http://localhost:4329/` a few seconds after the server prints its address. I checked this here: a request from Windows made at once was refused, and one made 5 s later got 200. Stop the server with Ctrl+C.

**Before each run:**
- the display at 60 Hz (Windows Settings > System > Display > Advanced display);
- mains power, if the machine runs on battery;
- the browser window maximised, with nothing else heavy running.

**Open these in Chrome, Edge and Firefox:**
- `http://localhost:4329/?quality=high`
- `http://localhost:4329/?quality=low`

Each load warms up for 2 s and then measures for 30 s. Keep the tab in front and the window still until the box at the top left shows `Frame time:`; hiding the tab or resizing the window spoils the measurement. Reload to repeat it.

**Read these off the box:**
- `Frame time: PASS` or `FAIL`: the verdict.
- The line below it: the frames in 30 s, and the interval's p50, p95, p99 and max.
- `frame work`: the page's own time in each frame.
- `ticks … (clock …, dropped …)`: the two counts should be equal, and dropped should be 0.
- `programs A -> B`: A and B should be equal, meaning nothing compiled in play.
- The last line is the renderer, which should name your GPU. If it says SwiftShader, llvmpipe or Microsoft Basic Render Driver, the browser is drawing in software and the run doesn't count. Check the browser's hardware acceleration setting.
- The second line gives the pixel ratio. The label at the bottom right names the script: `showcase 4, slip-out flag42`.

**Record the results here,** with each browser's version, the display's refresh rate, the screen resolution and Windows' display scale:

| Browser and version | Quality | Verdict | p95 (ms) | max (ms) | Frames in 30 s | Renderer |
|---|---|---|---|---|---|---|
| Not stated | Not stated | **PASS** | not given | not given | not given | ANGLE, Direct3D 11, Intel Iris Xe Graphics |
| Chrome | high | | | | | |
| Chrome | low | | | | | |
| Edge | high | | | | | |
| Edge | low | | | | | |
| Firefox | high | | | | | |
| Firefox | low | | | | | |

**Before your result,** the evidence was headless, on this machine's GPU path:
- **The scene builder's bench,** whose script wasn't kept, on this machine's GPU path at 1280 × 720, with a 10 s window. It drove the page from a stub source. All 12 configurations passed (three engines, two drawers, two qualities), with p95 16.7–17.2 ms and max 16.8–18 ms. In software GL, only Firefox at low quality passed.
- **The drawn cost page with the real simulation,** on the GPU path at 4× throttle, in Chromium only, over 10 runs: 59.5–60 fps, with a frame p95 of 16.7 ms (`results/verify/drawn-gl.json`).
- **Run at M1, on 2026-11-17:** §17's provisional settling, for the loads your report didn't cover. The scene page, drawing the real simulation, ran headless on this machine's GPU path, one load at a time. Chromium and Firefox passed every load, at both qualities; WebKit, which stands in only for Safari, failed high quality at pixel ratio 2. They're logged with their figures in [docs/acceptance.md](../../docs/acceptance.md), and stay owner-pending.

## 8. Proposed amendments to PLAN.md

Claude applied these to PLAN.md on 2026-11-16, each marked M0 there, with the cost revisit's outcome (§4). Only the last item below changes your text. It went to you as a §2 row first, and is now in REQUIREMENTS.md.

### D-2 (headings and `datan2`): confirm

- **Measured:**
  - `datan2` is within 0.500082 binary-angle units (1.16e-10 of a turn) of `Math.atan2` over 400,000 seeded vectors, and within 0.501 units on a 1,000,001-point sweep of one octant.
  - It gives exact quarter turns on the axes, for every signed zero and for magnitudes from 5e-324 to 1e300, and exact eighth turns on the diagonals.
  - datan2(−y, −x) = datan2(y, x) + 2³¹ on 300,000 vectors.
  - Run 1's goldens pin it in four engines.
- **Change only the tolerance:** "about 1e-9 of a turn" becomes "within 0.51 units, 1.2e-10 of a turn". The polynomial is the degree-14 Chebyshev interpolant of atan(√s)/√s, used as t·P(t²) with 15 coefficients (`src/sim/angle.ts`). M2 can copy it.

### D-3 (60 ticks, 4 substeps): confirm

- **Measured:** nothing tunnels at 25 m/s: 624 shots per pitch, plus the floor, the net and terriers. The fuzzed ball never left either pitch (run 2).
- **Cost:** a step costs 26.5–29.9 µs at 1× in Chromium. The cost revisit tried 3 substeps (§4). They cut the back-to-back tick by 27% at 4×, but a terrier pressing the ball into a wall then never rests: its state cycles every 2 ticks, by 0.28 mm. That pressing scene is the only test it fails, and it enters §16 with M0's amendments (below). So 4 substeps stay.

### D-4 (bodies and the pitch): confirm

- **Measured:** the sphere collider, the bounded pieces and the point symmetry held. Each of the 28 pieces' mirrors is exact, the mouth is 8 × 3 m clear, and P8 holds on both shapes.
- **Fit:** the drawn terrier's box stays out of the ball only with D-27's pushing pose (below).

### D-5 (the contact solver): amend

Steps 1–6 are confirmed: bit-still, bounces at their fractions, no energy gained, exact mirrors. Write in what the plan left open, as the spike built and measured it:
- **Step 3's bound test:** an axis-aligned box per piece, plus an exact broad phase: a body farther from every wall than its reach tests only the planes. In Node, it cut a step from 52.3 to about 28 µs on an earlier version of the wall scrum, with the goldens unchanged. That was measured while building, and isn't in `results/`.
- **The floor in steps 5 and 6:**
  - The floor's contacts take part, as non-pulling contacts with no bounce, after step 4's support. Every M0 number used this reading, except the comparisons with the floor out.
  - Without it, push times move by at most 0.06 s, but floor hits are slower: one hitter sends the ball off at 2.160 m/s instead of 2.656.
  - It's also 8.53 of the 11.65 contacts in a scrum's list. Taking it out halves the back-to-back tick at 4×, but fails §16's tests (§4): a terrier pressing the ball into a wall never rests, and 24 of 336 dribbles slip out. So the floor stays in.
- **Restitution:** "its closing speed at the start of the substep" is read before step 1's forces.
- **Step 7, the slip-out:**
  - **When it fires:** a terrier on the floor with a body above it within **42°** of vertical moves out at **2 m/s**, away from the bodies above. Its outward speed is raised to at least 2 m/s, and its sideways speed is kept. It fires every substep the terrier is within the cone, found from step 3's contacts with the geometry after step 6.
  - **The slipping flag:** it stores the body the terrier slipped from, holds off the drive's component toward that body, and clears once that body is on the floor.
  - **No restitution 0,** so L311 needs no §2 row.
- **Its window is narrow:** 42° to 43.2°. Below 42°, two sitting terriers take over 0.5 s. From 43.23°, the ball of a zoomies dribble hops onto the dribbler inside the cone. Recheck it whenever M2 tunes the collider, the drive or friction (C-21).
- **Iterations and position passes** stay at 8 and 2 (§4). Eight iterations are converged on the hit cases. 6 and 4 pass §16's tests too, and 4 cuts the back-to-back tick by 17% at 4×, but both have drawn runs over 4 ms: 4 iterations in 8 of 20, with a median of 3.95 ms. 1 position pass leaves a terrier pressing the ball into a wall cycling every 5 ticks, by 0.2 mm.
- **A.1 and A.4 follow:**
  - A.1's flags keep slipping, plus a byte for the body slipped from.
  - A.4's slip-out row reads "42° from vertical, 2 m/s sideways, with the slipping flag".

### D-6 (movement): amend the push figures

Replace the models' figures with M0's (run 2):
- **One pusher:** 1.225 s. **Four in a train:** 0.575 s, and two in a train 0.779 s.
- **Side by side:** 0.72–0.83 s in the pitch frame and 0.92–2.03 s in ball view, against one pusher's 1.225 s.
- **In ball view, two abreast are slower than one pusher,** at 2.033 s, and so are four round the ball, at 1.313 s. Only four on a line, at 0.921 s, beat it. Driving at the ball's centre from 16.5° off its travel, each of two abreast pushes forward only while the ball is under 6·cos 16.5° = 5.75 m/s, just above the 5.7 m/s mark.
- **C-18's marks are set with you at M2.** Ball view is the default view, so a remedy matters most there.

### D-11's worst ticks: amend

- **M0 timed them.**
  - At 4×, the late-vote repair (270 steps) takes 30.3–37.2 ms at the median and up to 96.2 ms. It went over 50 ms in 21 of 24 configuration runs.
  - The resync (30 steps, at most 15.5 ms) and the joiner's catch-up (42 steps, at most 23.3 ms) fit in one tick.
- **So the spread is no longer conditional:** M3 builds it and tests it against a full replay. M3's build line and §16 drop "if M0 calls for it".
- **A starting cap:** 42 steps a tick, the catch-up's size, so a 270-step repair finishes in 7 ticks. M3 checks the cap.
- **C-2's worst-ticks bullet** takes these numbers.

### D-26 (three.js and its WebGL 2 renderer): confirm

- **Measured:** three 0.187.0's WebGL 2 renderer, `compileAsync`, `InstancedMesh`, GLTFLoader, SkeletonUtils and AnimationMixer work in all three engines. three's core is 118,806 B brotli, and C-9 found one string in it, cleared by an app option.
- **Note:** three's core is one module, so rolldown can't split it. 10,014 B brotli of it serve only GLTFLoader, but they ship on the code-built path too. §12's per-chunk Resource Timing check still passes.

### D-27 (one replaceable terrier drawer): confirm, with these changes

- **Code-built:** 9 instanced parts, because the bandana is split by pack pattern and a snout and a face are added. 9 draw calls for 8 terriers, 1,516 triangles a terrier.
- **The fit needs the pushing pose.** Without it, the drawn terrier enters a touching ball by up to 6.6 cm, running, at the 31.6° contact of a push from the floor. With the pose held for 8 ticks after a ball contact, every phase clears the ball by 0.1–8.2 cm at contacts from 31.6° to 90° (`src/scene/drawers.test.ts`).
- **The model drawer** works as planned: it's a dynamic chunk, the terriers stay code-built until the model has loaded and compiled, and then they swap. In run 4 the import took 116–1,797 ms, the load 85–1,416 ms and the compile 16–295 ms.
- **Painting:** `fur` and `bandana` take the coat's and the pack's colours through the material colour. The markings mask needs a shader hook, and the bandana's stripes need a texture or an attribute: both are M4's.
- **Bones:** `SkeletonUtils.clone` gives each skinned mesh its own skeleton, so 8 terriers of 2 primitives make 16 bone textures. That's inferred from three's source; the model path holds 19–20 textures in all. Binding each terrier's meshes to one skeleton halves them (M4).
- **Nothing compiles in play (§12):** `compileAsync` compiles programs but doesn't upload geometry, so add one render with frustum culling off before play. With it, programs, geometries and textures stayed constant through every window of run 4.
- **The stand-in (optional):** the test can generate it in memory from `scripts/make-standin.mjs`, byte-identical each run, so `e2e/fixtures/` needs no binary.

### D-34 (the toolchain): confirm

`@types/three` 0.187.0 exists. It was published on 2026-10-30, the same day as three 0.187.0, with the dist-tag `ts6.0`. So three stays at 0.187.0 exact, with `@types/three` at 0.187.0 exact. Every three API the scene uses typechecks under hermet's strict options.

### D-35 (hosting and the content security policy): confirm as written

- `blob:` in connect-src is needed, and it's enough (run 4). No other directive was refused, by three or by the page.
- Vite's module-preload polyfill fetches same-origin URLs. `'self'` covers them, and `build.modulePreload.polyfill: false` drops the polyfill.

### The drawing budget (§12): confirm every figure, and lower none

- **No figure is lowered.** The spike's counts are under every guess (§3). Nothing measured on the desktop shows a guess too high for the phone, and the Pixel 8a sets the figures (C-2).
- **Define the texture figure** as the model's own textures per terrier. three's bone textures and its standard material's lookup texture aren't the model's, so count them apart.
- **Download:**
  - three's core is its own line, at 118,806 B brotli.
  - The code-built drawer's share is at most 23,747 B: the entry chunk without three, which also holds the simulation and the scene.
  - The model drawer's share is 30,572 B with the stand-in.
  - A real model at the guesses' 8,000 triangles and 512 × 512 will be several times the stand-in's size, and the 200 KB figure is what it must fit.
- **The stand-in tests the drawer, not the ceiling:** 2,220 triangles, 8 bones and 256 × 256, against 8,000, 32 and 512 × 512.

### Also, from these measurements

- **§16, simultaneous hits:** "and faster as k grows for parallel approaches" becomes "and the speed at each k is pinned". From the floor, k = 4 parallel hitters (3.685 m/s) are slower than k = 3 (3.810 m/s), under D-5's frictionless contacts. L56's "several hitting it at once send it faster" still holds, since every k > 1 beats one hitter.
- **§16, a ball on terriers:** the mark for case 1 is 1.5 s from the first landing; 42° with the flag's worst is 1.383 s. "Reach the floor" means the ball's centre within 1 cm of its resting height (0.471 s under 42° with the flag), or its floor contact found in detection (0.475 s).
- **§16, bit-still:** settle the bodies from 1 µm overlaps and assert that their contacts exist, because bodies placed exactly touching can end up apart by rounding (6.7e-16 m here) and never touch. Add a terrier against the ball at the wall, and one pressing the ball into it. The pressing scene caught every cheaper setting the revisit tried, except fewer iterations, and the revisit's decision rests on it: it is the only test that 3 substeps fails (§4).
- **§16, tunnelling:** the test that a terrier at 25 m/s never passes through the ball should check height too. With the floor out of the solve, it failed on a terrier running under a ball popped to 3 m.
- **P8:** add the stored previous input, mirrored as its pitch-frame direction plus 16 steps, and the body a terrier slips from, mirrored as its mirror.
- **The stop rule's cost clause, and C-2:**
  - Name the reading: the tick timed while the page draws, its ticks on the 60 Hz clock, as roslambo's proxy measured, with the nothing-drawn reading beside it (§4).
  - C-2's "roughly 20 contacts" is a peak. 4-a-side scrums average 10.9–12.1 contacts a substep, 8.0–8.5 of them the floor's, with 17–22 at most in one substep.
  - The revisit found no cheaper setting that passes both §16's tests and the drawn reading, so D-3's and D-5's settings stand (§4). If the phone run at M5 needs cheaper ticks, 4 iterations is the cheapest setting that passes the tests.
- **C-21:** the drafted rule fails as predicted: 248 of 864 cases held up, and 6 of 8 pinches. A zoomies pinch sends the ball up to the overhead net, its centre 4.4 m above rest, against 0.8–2.0 m at a run.
- **D-37:** terriest's dist audit options gain `ignoredPaths: ['/']`, for three's `LoaderUtils`. No hermet option or tokenizer fix is needed, so M1's pin at 11283ca stands.
- **D-38:** the config test covers the verifier's three gaps: every script extension in `src/core/sim` is linted, and a `typeof Math` parameter and `toLocaleString` are banned.
- **Restitution 0 on slip-out contacts (L311) isn't proposed.** If M2 prefers 42° with the flag and restitution 0, whose pinches come down sooner (0.30–1.09 s against 0.43–1.65 s), that needs a §2 row first.
- **The note on resting contact, C-44's waiting §2 row: this one goes to you.** M0 has now measured resting contact, so the row can go in.
  - **The clause it replaces:** "but bodies resting together hit a per-substep event cap, and their overlaps are settled the old way (its PLAN D-4, M2)".
  - **The proposed wording:** "In the audit's probe of roslambo's physics, that cap never bound and its overlap pass settled resting bodies, and the 137 to 174 events a second came from its M0 integrator, which its M2 replaced (C-44). terriest's solver treats the floor as support, and its M0 spike held a resting ball bit-still for 10 minutes of ticks."

## 9. Smaller findings

- **A ball pressed into a wall sits a fraction of a millimetre off.**
  - A terrier pressing the ball into a wall wedges it 0.13 mm above the floor (z = 0.80013 m), with its floor flag clear.
  - When the ball starts 1 µm into the wall, it rests 0.155 mm inside it.
  - It's bit-still, so it doesn't touch the stop rule. M2 decides whether the floor flag needs a tolerance; in the open, L57's steady push keeps the flag set.
- **The engines' quirks:**
  - WebKit isn't offered brotli on `http://127.0.0.1`. Over https it probably is, but that's unverified.
  - Firefox asks for `/favicon.ico`, which is a 404 on the strict server. The spike's `index.html` declares an empty `data:` icon, and the product's boot page should do the same.
  - SwiftShader lacks KHR_parallel_shader_compile, so three logs a warning and `compileAsync` polls. The gate's console check counts only errors.
- **Vite's chunk warning:** Vite warns about a chunk over 500 kB, the entry chunk with three's core in it. It's cosmetic.
- **hermet's tokenizer:** C-9's edge case is real, but it isn't in three 0.187.0's bundle. Fixing it is a hermet change for your go-ahead, and M1 doesn't need it.

## 10. Not measured

- **The rest of run 6** (§7): your report gave one load's verdict, without its browser, quality or figures. At M1 the other loads were settled provisionally, headless on this machine's GPU path, which only stands in for your browsers.
- **The Pixel 8a's CPU and GPU.** 4× DevTools throttling is a crude stand-in. At 1×, 60 Hz pacing doubles the tick, which suggests power management matters as much as the throttle.
- **Real Safari** (Q-12).
- **A model at the budget's ceiling:** 8,000 triangles, 32 bones, 512 × 512.
- **Parts of the drawing:** the model's markings mask and stripes, correction cross-fades (D-16, D-27), the cameras' fading, and the effects (dust, bark marks, celebrations).
- **The timeline itself:** the spike's bench times the 13-step replay and the worst-tick bursts, not D-11's code or its spread.
- **CI's hosted runner** (§15).
- **What sets the drawn reading's tail.** At every setting the revisit timed, drawing added 0.61–1.47 ms to a 13-step tick's p95, whatever the simulation cost. Neither the cause nor a cure was measured.
- **What moved the line between rounds.** M0's settings drew over 4 ms in 8 of 16 software-GL runs in run 3, and in 19 of 20 in the revisit's rounds, with the simulation's own cost unchanged (§4).
- **The revisit's settings on the same states.** Each setting plays the plan's scrum differently, at 10.06–11.98 contacts a substep. So the revisit compares each setting on its own scrum, not one scrum under each setting.
- **Fewer than 4 iterations, and the revisit on the GPU path.** Neither was tried.
- **3 substeps with 4 iterations, timed again.** Only the revisit's 6 drawn runs time it, at 3.215–3.655 ms.

## 11. Reproducing

From `research/spike/`:

```sh
npm ci
npm run lint && npm run typecheck && npm test               # 170 tests; the measurements are skipped
npx playwright test e2e/determinism.spec.ts                 # run 1
TERRIEST_SPIKE_MEASURE=1 npx vitest run src/sim/measure.test.ts   # run 2 -> results/sim.json, about 1 min
node scripts/stop-rule.mjs                                  # the stop rule -> results/stop-rule.json
npx playwright test e2e/cost.spec.ts                        # run 3 -> results/cost.json, about 5 min, on a quiet machine
npx playwright test e2e/page.spec.ts                        # run 4 -> results/page.json
npm run build && node scripts/audit.mjs --app-options       # run 5; then scripts/sizes.mjs and scripts/tokenizer-check.mjs
node scripts/verify/sim-checks.mjs                          # the verification round; the rest is in README.md
node scripts/revisit/behaviour.mjs --solver i4              # the cost revisit's tests under one setting -> results/revisit/
node scripts/revisit/cost.mjs --name variants --solvers m0,i6,i4,p1,nofloor,s3,i4+s3,i6+s3,i4+p1,i6+p1   # its cost, about 50 min
node scripts/revisit/summary.mjs                            # the adoption rule -> results/revisit/summary.json
```

The specs rewrite their results files on every run. `scripts/m0-run.mjs` wraps any of these commands and logs the load (see README.md, "Recording a measurement round"). The revisit's drivers wait for the load and log it before each run themselves.
