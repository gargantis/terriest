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
| M2 | The tuning page: the feel and M2's values (Q-10). | not yet due |
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

## Log

### The gate's wall time (PLAN §16)

`npm run check`, at each milestone's exit, from M1, with the machine, the display and the GL path it ran on.

| Milestone | Date | Commit | Wall time | Where and how |
|---|---|---|---|---|
| M1 | 2026-11-17 | the commit that adds this row | 76.4 s, the median of three consecutive green runs, which took 76.0 to 77.5 s | The development machine: WSL2 with 12 threads, on WSLg's display. GL in software: SwiftShader in Chromium, llvmpipe in Firefox and WebKit. The end-to-end tests took about 60 s of it, 12 in each engine. On the GPU path (`GALLIUM_DRIVER=d3d12`), it took 93 to 94 s. While the machine was busy with other work, an earlier tree took 171 s. |

### CI runs (PLAN §15)

`.github/workflows/check.yml`, on each push and pull request: the gate under `xvfb-run` on the hosted runner, and the unit tests on arm64. The first push, at M1, is a spike: WebGL 2 in each engine on the hosted runner, the empty pitch's frame rate, which `e2e/pitch.spec.ts` prints for each engine with the GL path, and the job's wall time. The line names the renderer as the engine reports it, but only Chromium's names the real one: WebKit always reports "Apple GPU", and Firefox a masked string, such as "llvmpipe, or similar", so for those two the line's `GALLIUM_DRIVER` says the path. If an engine can't draw there, or the runner can't hold the real-page matches, CI runs a separately named `check:ci`, labelled partial, that leaves out exactly those specs, and the local `npm run check` stays the definition of done (C-6).

| Date | Commit | Job | WebGL 2: Chromium, Firefox, WebKit | Empty pitch, frames a second | Wall time | Result |
|---|---|---|---|---|---|---|

None yet. The first push needs Actions enabled on the repository, and waits for the owner's go-ahead (§17).
