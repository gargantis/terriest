# The readiness audit, 2026-11-14

This is what the audit agents measured or computed for [PLAN.md](../../PLAN.md), with their methods and numbers, so the plan's evidence outlives the scratch folders it was made in. There were two read-only rounds of agents, then a review of the plan's first draft.
- **The probes' code isn't kept:** it named this machine's paths. M0 re-creates the probes it needs (PLAN §17).
- **The repos read:** REQUIREMENTS.md at 6254a1d, roslambo at 3809d3a, amorfus at f4a272f and hermet at 18a37b2.

## 1. This machine

- Node 22.23.4, npm 10.9.9 and git 2.53.0, on Ubuntu under WSL2 (kernel 6.18), with 12 CPUs.
- WSL2 runs in NAT mode. adb isn't installed, and sudo needs a password.
- Playwright 1.64.1 (roslambo's pin) expects Chromium 1248, Firefox 1555 and WebKit 2370; all three are installed.
- npm, read only: three 0.187.0, MIT, 21 MB unpacked; `@trystero-p2p/nostr` 0.26.0.
- hermet's HEAD on GitHub is 18a37b2, the commit both siblings pin.

## 2. WebGL 2 in the headless engines (PLAN C-6, D-26)

**Method:** a standalone script drove Playwright's three engines, headless, with no extra flags.
1. It created a WebGL 2 context, drew a triangle and read the pixels back.
2. It drew 100k triangles a frame from one static buffer, with a simple lit shader at 1280 × 720, for 120 frames of `requestAnimationFrame`.

A second, independent probe repeated the context and draw checks.

| | Chromium 156 | Firefox 157 | WebKit 27.2 |
|---|---|---|---|
| Renderer | ANGLE on SwiftShader | Mesa llvmpipe | Mesa (reported as "Apple GPU") |
| Context, draw, readback | yes | yes | yes |
| `MAX_TEXTURE_SIZE` | 8192 | 16384 | 16384 |
| Frame interval, mean / p95: MSAA on | 205.8 / 266.7 ms | 74.7 / 99.4 ms | 91.5 / 119 ms |
| MSAA off | 64.7 / 100.1 ms | 38.6 / 50.3 ms | 43.5 / 55 ms |
| All three at once, MSAA off | 101.1 / 150.1 ms | 66.1 / 100.7 ms | 90.3 / 131 ms |

**Software rendering:**
- An empty frame paced at 16.7 ms in all three engines. Chromium at 20k triangles, with MSAA off, gave 19.4 / 33.4 ms.
- Playwright opts its browsers into software WebGL by itself.
- Firefox has WebGL only while `DISPLAY` or `WAYLAND_DISPLAY` is set; WSLg sets them here.
- WebKit's WebGL renderer strings always read "Apple GPU"; only its process's mapped libraries show Mesa. In WebKit, GL work blocked the page's JavaScript for 23 ms or more a frame.

**The GPU path:** with `GALLIUM_DRIVER=d3d12`, plus ANGLE's GL flags for Chromium, all three engines ran at about 60 fps at 100k triangles on the host's integrated GPU, even all at once. Playwright's `chromium` channel then failed to create any WebGL context.

**Failures, touch and gamepads, for tests:**
- WebGL 2 can be switched off: `--disable-webgl2` in Chromium, `webgl.enable-webgl2=false` in Firefox. `WEBGL_lose_context` is available in all three engines.
- **Touch:** `touchscreen.tap` with `hasTouch` fires pointer and touch events in all three engines. Multi-touch works only through Chromium's DevTools protocol.
- **Gamepad:** Playwright has no support. A stubbed `navigator.getGamepads` was read back in all three engines.

## 3. Math across engines (PLAN D-1)

**Method:** each `Math` function's results over the same inputs were hashed in each engine.
- **Identical in all three:** `+ − × ÷`, `sqrt` and `fround`.
- **Different in all three:** `sin`, `cos`, `tan`, `atan2`, `atan`, `asin`, `acos`, `exp`, `expm1`, `cbrt`, `hypot` and `sinh`.
- **The rest:** `log` and `log1p` matched in only two engines; `pow` and `tanh` matched.

## 4. hermet's licence notices (PLAN C-8)

**Method:** read hermet's `licenses.mjs` and Vite 8's licence plugin. Then rebuild roslambo and amorfus from their HEAD trees in a scratch copy, and feed Vite's real licence JSON through hermet's writer.
- hermet's `licenses.mjs` reads `license` and `licenseText`; Vite 8.3.2 and 8.3.5 write `identifier` and `text`.
- The rebuilt JS, CSS and HTML matched each repo's `dist/` byte for byte, and the writer reproduced each `dist/THIRD-PARTY-LICENSES.txt` byte for byte.
- Those notices are headings only (3 in roslambo, 5 in amorfus): no licence text, not even the SPDX identifier.
- No licence text is in either bundle. amorfus's worker keeps one copyright line and an `@license MIT` tag for its vendored FastNoiseLite, which has no notice at all.
- The audit checks only the headings against `expected-licenses.json`. hermet's test asserts the text for `extra` entries only.
- Both apps are deployed with these notices.

## 5. roslambo's physics, against what terriest needs (PLAN C-3)

**Method:** a scratch copy of roslambo's physics, with counters added. It was checked faithful by reproducing the final hashes of its goldens.

**Its own runs:**
- **Its goldens:** 0.026–0.056 contact events a substep, none capped, and at most 4 events in one substep.
- **Pressed clusters** of 1–8 bodies under constant thrust: 0.1–2.0 events a substep, none capped. The per-substep event cap never bound in any run.
- **Its appendix re-run:** 30 contact events in 30,000 steps when elastic, 24,592–28,949 when lossy.

**What terriest needs, which it can't do:**
- **On a floor under gravity**, with its wall rule at 0.7:
  - a resting body leaves every overlap pass at +0.0168 m/s, so it never comes to rest;
  - a body rolling at 0.5 m/s is down to 3.2e-7 m/s after 10 ticks.
- **Fixed-order settling** of a mirrored duel, with masses 1:2:1 and e = 0.5: the pack settled first sees the ball go back toward it at 0.125 of the hitters' speed. Equal elastic masses, roslambo's case, are symmetric in either order.

**Its replay cost:** its timeline re-simulates the whole late window from the final state on every tick, plus one finalising step: 13 steps a tick, each with at least two all-pairs passes per substep.

## 6. The contact solver of PLAN D-5, first draft (PLAN C-3)

**Method:** the review of the plan's first draft modelled its D-5 and D-6: spheres, 4 substeps, floor support, and 4 Jacobi iterations.
- **k terriers hitting a resting ball level and together at 6 m/s:**
  - with each iteration's impulse clamped, the ball left at 3.00, 5.87, 8.47 and 10.69 m/s for k = 1–4, and kinetic energy rose at k = 3 and 4;
  - with accumulated clamped impulses, 3.00, 4.40, 4.55 and 2.69 m/s after 4 iterations.

  Along nearly one normal, Jacobi's spectral radius is about (k − 1)/3, so at k = 4 it never converges.
- **Pushes were unaffected:** one pusher reached run speed in 1.26 s, and four in a line in 0.65 s, with the 0.5 m/s² rolling slowdown; to 95% of run speed, 1.17 s and 0.62 s.
- **The fix:** this is why PLAN D-5 solves by Gauss–Seidel over mirror pairs, and why M0 tests simultaneous hitters.

## 7. The requirements' arithmetic (PLAN §2, C-5, C-15, C-18)

**These hold:**
- 40 m at 6 m/s in about 7 s;
- 0.4 s to run speed;
- a 1 m jump at 4.43 m/s, 0.90 s in the air;
- 1.4 m under the crossbar;
- a level hit at half the hitter's speed, with e = 0.5 and the ball twice a terrier's mass: 3, 4.5 and 5 m/s;
- L341's latency figures;
- 36 pairs.

**These don't:**
- **L324:** pushes from the floor meet the ball low.
  - A zoomies push leaves it at about 2.3–4.05 m/s horizontally across the colliders and solves tried, mostly under 4.
  - A ball pushed along at a run reaches 6 m/s and bowls.
  - A pouncer meeting an oncoming 5 m/s ball is bowled.
  - A 6 m/s ball comes back off a wall, at 70%, at 4.2 m/s.
- **L56:** four terriers side by side reach run speed in about 0.65–0.7 s, not 0.6.
- **L190:** `K7QM-2XDP-4TR8-WHZN-3VBC-7` fails roslambo's check rule; for that body the check character is K.

## 8. Deploys (PLAN Q-6)

wrangler 4.152.0 is installed, and no `CLOUDFLARE_API_TOKEN` is set. wrangler's local logs show the earlier deploys of roslambo, amorfus and gargantis signed in with its stored login.
