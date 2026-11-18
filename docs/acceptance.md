# Acceptance: devices, criteria and runs

The conditions under which REQUIREMENTS.md's *Acceptance* and *Performance* lines are judged (PLAN Q-4, Q-13, §16), and the log of what the gate doesn't run: the checks by hand, the runs outside the gate, the gate's own wall time and CI. M4 extends it with the frame-time run, the device runs and the manual checks (PLAN §17).

## Devices (Q-4, settled 2026-11-14)

- **For now:** the owner's desktop browsers, checked by hand: Chrome, Edge and Firefox on Windows, on a desktop whose GPU is an Intel Iris Xe. They are the real-browser check from M0 on. The gate runs headless Chromium, Firefox and WebKit, which draw in software (C-6).
- **For acceptance:** three devices, one of them the reference phone, a Pixel 8a in Chrome (L286), and a standard gamepad (L280, L284). No more devices are asked for yet. They're asked for again before M5, with real Safari (Q-12), and named here then, with the people and networks. Each line's own conditions stand.
- **Until the phone runs,** the drawing budget is provisional (C-2). With the phone's measurements, the owner chooses whether phones start at the low render quality (D-33).
- **Pending lines:** a line whose device run hasn't happened stays marked pending here. So does a browser L236 names that hasn't been run, such as Firefox or Edge on the phone (Q-13).

## Frame-time criteria (L286)

Copied from roslambo's, as L286 asks: the pass figures and the 60 Hz rule. The run they judge, the bench's scripted 4-a-side match, is set out in PLAN §16 and written in here at M4.

- **Pass:** the interval between animation frames has p95 ≤ 18 ms and max ≤ 50 ms.
- **The display at 60 Hz:** a faster display would hide dropped frames inside the criteria.
  - On the Pixel 8a, Smooth Display runs at up to 120 Hz. Turn it off (Settings → Display → Smooth Display) for the run.
  - On Windows, set the refresh rate to 60 Hz (Settings → System → Display → Advanced display), as for run 6.
- **terriest's own conditions:** frame times are judged on a visible page (D-31). The phone's run is judged at the render quality phones start with, and the run never changes quality (D-33). The gate never judges frame time, because it draws in software (C-6).

## Checks by hand (PLAN §16)

The owner makes these on their desktop, and at M5 on the phone too. The checks of M0 to M4 don't hold up the next milestone: if one hasn't happened when a milestone's other exits are met, Claude settles it provisionally as §17 says, it's logged here as owner-pending, and the work goes on. Each lands before M5's deploy. A late answer costs re-emitted goldens, re-run Q-9 marks and a re-counted budget. M5's runs come after the deploy, and follow Q-13.

| Milestone | Check | Status |
|---|---|---|
| M0 | Run 6: the spike's scene page in Chrome, Edge and Firefox on Windows, at high and low quality, for the frame verdict on the owner's GPU. [research/spike/REPORT.md](../research/spike/REPORT.md) §7 says how to run it, and holds its table. | **PASS in one load**, reported by the owner on 2026-11-16: ANGLE, Direct3D 11, Intel Iris Xe. The report didn't state its browser, quality or figures. **The other loads are owner-pending** (§17), **settled provisionally as PASS** on 2026-11-17 in the headless engines on C-6's GPU path (below). |
| M2 | The tuning page: the feel and M2's values (Q-10). | **Settled provisionally by measurement** on 2026-11-17, as the owner chose ("settle"), and **owner-pending** (§17): the goal netting's bounce 0 and the push assist on at 9 m/s, eight values kept at their starts, and C-18's marks (below). The owner confirms or changes them before M5's deploy. |
| M3 | Two desktop browsers connect through `npm run dev:local` on the `#test=net` page. | not yet due |
| M4 | Practice in each desktop browser with the keyboard, and a gamepad if there is one, against bots whose level the owner accepts or changes (Q-9). The cameras: the chase-view swing, and the feel values confirmed in ball and chase view (Q-10). A match between the three desktop browsers through `npm run dev:local`. The frame bench on the owner's GPU. The look book (Q-11). | not yet due |
| M5 | The deployed site, in desktop browsers and on the phone (Q-4). | not yet due |

### M0's run 6, settled provisionally (owner-pending)

Under §17, an attended step still open when a milestone's other exits are met is settled provisionally: M0's frame verdict, in the headless engines on C-6's GPU path. So on 2026-11-17, at M1's exit, the spike's scene page was served as [REPORT.md](../research/spike/REPORT.md) §7 serves it, from `research/spike/dist` with its `_headers`, and the page's own verdict was read from each load: 2 s of warm-up, then 30 s measured, against p95 ≤ 18 ms and max ≤ 50 ms. One load at a time, on the development machine (WSL2, WSLg, the Intel Iris Xe), each in a headless engine launched with `GALLIUM_DRIVER=d3d12`, and Chromium with ANGLE's GL flags too, at 1280 × 720: at pixel ratio 1, and for high quality also at 2, its cap.

Headless Chromium stands in for Chrome and Edge, and Firefox for Firefox. Every one of their loads passed, so the five open loads are settled provisionally as **PASS**. WebKit stands in only for Safari, which stays unverified (C-7, Q-12): it failed at high quality at pixel ratio 2, in each of three loads, and passed the rest. In every load, no tick was dropped, and nothing compiled in play (10 programs at the start and at the end).

| Engine | Quality, pixel ratio | Verdict | p95 (ms) | max (ms) | Frames in 30 s | Renderer, as the engine reports it |
|---|---|---|---|---|---|---|
| Chromium | high, 1 | PASS | 16.7 | 16.8 | 1801 | ANGLE, D3D12, Intel Iris Xe Graphics |
| Chromium | low, 1 | PASS | 16.7 | 16.8 | 1801 | the same |
| Chromium | high, 2 | PASS | 16.7 | 16.8 | 1801 | the same |
| Firefox | high, 1 | PASS | 17.2 | 33.4 | 1797 | "Generic Renderer", masked |
| Firefox | low, 1 | PASS | 17.2 | 34.1 | 1800 | the same |
| Firefox | high, 2 | PASS | 17.3 | 33.7 | 1776 | the same |
| WebKit | high, 1 | PASS | 17.0 | 23.0 | 1856 | "Apple GPU", masked |
| WebKit | low, 1 | PASS | 17.0 | 19.0 | 1859 | the same |
| WebKit | high, 2 | FAIL, three times | 19.0 to 20.0 | 29.0 to 30.0 | 1731 to 1744 | the same |

The owner's own loads still land before M5's deploy, and replace these.

### M2's tuning, settled provisionally (owner-pending)

The owner chose "settle" for Q-10 on 2026-11-17, so Claude set M2's values by measurement, under §17's rule for attended steps, by the method of [research/tuning/REPORT.md](../research/tuning/REPORT.md), committed at e1a4c99 before anything was measured. Each value's candidates ran alone from the starting values, and a fixed rule picked: the start stays unless a check fails, the netting takes its largest passing bounce, and the push assist its smallest passing cap. Then the picks ran together, and every check and bot mark passed. The values are in `src/config.ts` and PLAN's A.4 and A.5, marked provisional. REQUIREMENTS.md's TBDs wait for the owner's sign-off (PLAN §2), and so do its two lines on the netting: at 0 the netting no longer bounces the ball, so both the Ball bounce row and L58, "It bounces off … the goal's netting. Each bounce keeps part of its speed into the surface", need the wording PLAN §2 proposes.

| Value | Settled | Start | What decided it |
|---|---|---|---|
| Goal netting bounce | **0** | 0.3 | The largest bounce at which all 18 test shots, with nobody near, stay wholly behind the goal line through their celebration. At 0.3 every one comes back out, a 10 m/s high shot 8.5 m onto the pitch. Pushers that follow the ball in can still bring it back out, less than at 0.3 (REPORT §2.7). |
| Push assist (C-18) | **on, a 9 m/s cap** | off | The smallest cap at which two and four side by side in ball view beat one pusher's 1.225 s. |
| Kickoff spots | A.5's | A.5's | The spots' checks pass; at 1 to 4 a side, with and without zoomies, each kickoff pinch comes down, mirrored, in 0.433 to 1.962 s; and the bot marks and the end-to-end setups pass. |
| Ball rolling slowdown | 0.5 m/s² | the same | §16's push marks pass at every candidate, 0.3 to 1 m/s². |
| Terrier bounce | 0.3 | the same | The slip-out cases pass at every candidate, 0 to 0.5. |
| Re-arm gap | 0.6 m | the same | A push counts 1 touch and a rebound met again 2, at every candidate, 0.3 to 1 m. |
| Slip hold-off | 0.6 m | the same | The slip-out cases pass from 0.5 m up; at 0.4 and 0.3 m a ball on pushers takes 1.721 and 2.000 s to come down. Nothing bounds it from above. |
| Tumble guard | 1.5 s | the same | A terrier pounced on in turn is up for at least the guard after each get-up, at every candidate, 0.5 to 2.5 s. |
| Terrier collider | radius 0.25 m | the same | Every other radius tried, 0.2 to 0.3 m, shuts C-21's window. |
| Idle friction | 8 m/s² | the same | At 10 and 12 m/s², two sitting terriers take 0.887 and 2.979 s to let the ball down, over the 0.5 s mark. |

REQUIREMENTS' acceleration, 15 m/s², and bowling speed, 4 m/s, passed their checks, so the method proposed no change to either.

**C-18's marks,** set at M2 at the 9 m/s cap, to 95% of run speed from rest in contact. `push.test.ts` holds each time within ± 10% of its mark and pins it to the millisecond, so a change to the drive or the assist sets the marks again on purpose; in ball view each must beat one pusher too.

| Pushers side by side | Pitch frame | Ball view | Ball view, assist off |
|---|---|---|---|
| two round the ball | 0.829 s | 1.175 s | 2.033 s |
| two on a line | 0.833 s | 1.175 s | 2.033 s |
| four round the ball | 0.721 s | 0.983 s | 1.313 s |
| four on a line | 0.758 s | 0.854 s | 0.921 s |

One pusher takes 1.225 s in both frames, with the assist on or off. The drive's acceleration sets that time whatever its target, so the time can't show the assist acting on a lone pusher; its drive's target can, and stays its base speed through the push off the axes too (`assist.test.ts`, the metrics).

**For the owner, with the bowling speed (Q-8, C-5):** in seeded bot matches the ball bowls terriers over 5.2 times a minute of play at 2 a side and 6.5 at 4 a side, against 0.3 pounce tumbles a minute. At 4.5 m/s it's 3.3 and 4.2 a minute. At 5 m/s it's 2.2 and 2.1, but then a pounce from the air, which sends the ball off at 4.57 m/s, no longer bowls, against REQUIREMENTS' note. At 3.5 m/s it's 9.0 and 10.1, and at 3 m/s 12.2 and 13.3. 4 m/s is REQUIREMENTS' value and passes its checks, so it stays. Whether the ball should tumble terriers this much more often than pounces do is the owner's call.

**The bot marks** at the settled values: the empty goal 100 of 100 within 20 s, the fall-back 100 of 100 at each pack size, a goal in regulation 100 of 100, never stuck, and both end-to-end setups 25 of 25. For the owner's play test at M4, every mark still passes at reactions of 0.15 and 0.35 s and at aim noise of 5° and 15°.

**To confirm or change them:** on the tuning page (`npm run dev`, then http://localhost:5173/dev/tuning.html, whose **Copy settings** writes the changes out), or by naming the values. A change re-emits the goldens and re-runs the bot marks, and a change to the netting or the push assist sets its gate test or C-18's marks again.

## Checks outside the gate (PLAN §16)

| Run | When | Status |
|---|---|---|
| The 12-page load run: 8 pages that play, 4 that watch. | M3 | not yet run |
| The correction measurement over the network simulator, reported in `research/corrections/REPORT.md` (D-16). | M3 | not yet run |
| The bench's CPU figures at the Pixel 8a's size in throttled Chromium: tick cost, and frame work excluding draw submission. Its frame intervals there measure SwiftShader, which throttling doesn't slow, so they aren't logged as a phone proxy. | M4 | not yet run |
| The frame-time run (L286): the bench's whole 4-a-side match, written in here at M4 with how to run it. | from M4 | not yet run |
| The Pixel 8a runs: the frame-time run at the render quality phones start with (D-33), and real touch. Firefox and Edge for Android each play a Practice match with real touch, and Firefox joins one networked match (L236). | M5 | not yet run |
| The relay check, which writes to the public relays, with the owner's go-ahead (Q-14). | before the first deploy, at M5 | not yet run |
| Real Safari: the determinism page and one match, if the device round before M5 names a Mac or an iPhone (Q-4, Q-12). | M5 | waits for the device round |
| The tuning metrics (PLAN §15, §16), which settled M2's values and recheck C-21's window: `TERRIEST_TUNING_OUT=research/tuning/results.json npx vitest run --config dev/vitest.config.ts`, which rewrites the committed results. A bare run stops at once, since it won't overwrite them. | M2, and whenever the collider, the drive or friction changes | Run on 2026-11-17 by [research/tuning/REPORT.md](../research/tuning/REPORT.md)'s method, which holds the results: rounds 1 and 2 at e1a4c99, in 535 and 517 s, then once more at the settled values, in 508 s. Run again at M2's review, with its two stronger checks, in 416 s: every verdict stands (REPORT §2.8). |
| The step's cost against the M0 spike's (PLAN C-2): the wall scrum with 8 inputs a tick, both steps timed tick by tick in one process. | M2 | At a9aca0a, from 5.0% less to 0.4% more than the spike's, inside M2's 5% budget. Re-timed at M2's review, after the slip release and the settled values: from 0.3% to 2.3% less by the per-tick medians, and 1.3% to 3.6% less by the means, three runs on one core. The comparison needs both simulations' bodies equal tick by tick, which the slip release and the push assist break in the scrum, so it ran at M0's values, the assist off and the netting at 0.3, with the slip hold-off's reach at 10⁹ m, M0's any-distance rule: there the bodies match the spike's for all 3,600 ticks. |

## Log

### The gate's wall time (PLAN §16)

`npm run check`, at each milestone's exit, from M1, with the machine, the display and the GL path it ran on.

| Milestone | Date | Commit | Wall time | Where and how |
|---|---|---|---|---|
| M1 | 2026-11-17 | the commit that adds this row | 76.4 s, the median of three consecutive green runs, which took 76.0 to 77.5 s | The development machine: WSL2 with 12 threads, on WSLg's display. GL in software: SwiftShader in Chromium, llvmpipe in Firefox and WebKit. The end-to-end tests took about 60 s of it, 12 in each engine. On the GPU path (`GALLIUM_DRIVER=d3d12`), it took 93 to 94 s. While the machine was busy with other work, an earlier tree took 171 s. |
| M2 | 2026-11-18 | the commit that applies M2's review | 124.0 s and 122.6 s, two consecutive green runs | The development machine, in software GL, as for M1. The unit stage took 34 s, 50 files and 584 tests, most of it the bot marks' whole matches; the end-to-end tests 1.2 minutes, 14 in each engine. Through M2 the gate took 114.5 and 114.3 s once the bot marks arrived (a9aca0a), 131.2 and 123.1 s with the tuning page (ccf92c8), 129.4, 137.4, 141.2 and 131.1 s at the commits that settled the values (c429814, e1a4c99, c82c3e8), and 138.2 and 138.3 s at the plan's amendments (2443fa5). The review's 9 tests and one file cost less than the runs vary. M2's design (research/m2/DESIGN.md §12) had estimated 97 to 105 s. |

### CI runs (PLAN §15)

`.github/workflows/check.yml`, on each push and pull request: the gate under `xvfb-run` on the hosted runner, and the unit tests on arm64. The first push, at M1, is a spike: WebGL 2 in each engine on the hosted runner, the empty pitch's frame rate, which `e2e/pitch.spec.ts` prints for each engine with the GL path, and the job's wall time. The line names the renderer as the engine reports it, but only Chromium's names the real one: WebKit always reports "Apple GPU", and Firefox a masked string, such as "llvmpipe, or similar", so for those two the line's `GALLIUM_DRIVER` says the path. If an engine can't draw there, or the runner can't hold the real-page matches, CI runs a separately named `check:ci`, labelled partial, that leaves out exactly those specs, and the local `npm run check` stays the definition of done (C-6).

| Date | Commit | Job | WebGL 2: Chromium, Firefox, WebKit | Empty pitch, frames a second | Wall time | Result |
|---|---|---|---|---|---|---|

None yet. The first push needs Actions enabled on the repository, and waits for the owner's go-ahead (§17).
