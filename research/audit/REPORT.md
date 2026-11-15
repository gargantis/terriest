# The readiness audit, 2026-11-14

This is what the audit agents measured or computed for [PLAN.md](../../PLAN.md), with their methods and numbers, so the plan's evidence outlives the scratch folders it was made in. There were two read-only rounds of agents, a review of the plan's first draft (§6), and a review of its second, made after the owner's answers of 2026-11-14 (§9).
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
- **The fix**, made at the owner's request and pushed as hermet 11283ca on 2026-11-14:
  - the writer reads `identifier` and `text`, with the old names as fallbacks;
  - the audit fails a notice with no licence text;
  - the test runs on the licence JSON from the rebuild above, and fails against the old writer.

  On both apps' rebuilt output, the fixed writer then gave roslambo's 3 notices and amorfus's 5 their texts, and the audit, run with each app's own options, found nothing. Neither app has moved its pin or redeployed yet (PLAN Q-20).

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

## 9. The plan review's models, 2026-11-14

**Method:** the review of the plan's second draft modelled its D-5 and D-6 in two independent programs, one in Python and one in JavaScript written from the plan's text with its own contact order. Both compute in IEEE doubles, which round + − × ÷ and square roots as JavaScript does. They use spheres of 0.25 m and 1 kg for terriers and 0.8 m and 2 kg for the ball, 4 substeps, floor support, accumulated clamped impulses by Gauss–Seidel over mirror pairs in 8 iterations of a forward and a back sweep, the 0.3 m/s restitution threshold and 2 position passes. Their code isn't kept.

- **Pushing (PLAN C-18, D-6):** to 95% of run speed, with the 0.5 m/s² rolling slowdown, one pusher took 1.14 s, and four in an aligned train 0.58 s, or 0.71 s with 5 cm sideways steps between them. Four abreast, round the ball or on a straight line 0.5 m apart, took 0.92–1.15 s in the pitch frame and 1.0–2.1 s in ball view, so §7's 0.65–0.7 s side by side doesn't hold in 3D.
- **Ball view's cap (PLAN D-6), derived:** a pusher that drives at the ball's centre from an angle a off the ball's travel pushes forward only while the ball is slower than 6·cos a m/s. That's 5.76 m/s at 16° and 3.96 m/s at 49°, where the outer two of four abreast round the ball sit.
- **Friction as a remedy (PLAN C-18):** Coulomb friction with μ 0.5 on terrier–ball contacts brought four abreast to 95% of run speed in 0.98–1.01 s in the pitch frame, and did worse in ball view.
- **The kickoff pinch (PLAN C-21):** with everyone holding toward the ball, a mirrored kickoff pinch launched it straight up 0.82 m with two hitters and 2.0 m with four, as a hand solution of the impact gives (4.02 and 6.30 m/s). Under the drafted 45° slip-out it then took 2.7–12.1 s from first landing on terriers to reach the floor.
- **The drafted slip-out (PLAN D-5 step 7):** two terriers driving inward held a ball placed on them at 50° from vertical for 9.9 s of 10. Two sitting terriers let it down in 0.23–0.39 s.
- **Candidate slip-out rules (PLAN D-5 step 7):** a 57° cone with restitution 0 and a slipping flag brought the ball down in 0.20–0.90 s mirrored and up to 2.0 s off mirror, but it also fired on a lone terrier dribbling in ball view, whose ball hops onto it at 47–53° from vertical, and at 9 m/s that dribbler lost the ball. A 45° cone with the flag left dribbles alone but took 1.0–2.7 s mirrored.
- **The drawn terrier's reach (PLAN D-4), computed:** a standing terrier touching a resting ball meets it along a normal 31.6° above horizontal. In that direction the drawn terrier's 0.6 × 0.5 × 0.5 m box reaches 0.387 m from the sphere's centre, 13.7 cm past the 0.25 m sphere, so the box's top front edge would sit 13.4 cm inside the ball.
- **Contact solves (PLAN C-2), computed:** a 13-step tick is 52 substeps, and at 18 passes over the contact list per substep that's 936 passes. That's about 1,900 contact solves with 2 contacts, and about 18,700 with the roughly 20 contacts of a 4-a-side scrum.

**The timeline and the network:** the same review also worked from roslambo's timeline and codec, with the plan's d = 2, w = 12 and v = 12. This code isn't kept either.

- **The worst single ticks (PLAN C-2, M0), derived from roslambo's timeline:** a resync after a tally re-finalises v = 12 ticks plus about 6 ticks of round trip and predicts 12 afresh, about 30 steps in one tick; a joiner's catch-up after its 500 ms warm-up is about 42, and a late-vote repair from up to 255 ticks back up to about 270. A cache of predicted states can't shorten these, because the state they start from changes.
- **STATE sizes (PLAN D-18), computed:** with A.1's state as this review read it, 1,455 bytes for 8 terriers with 32-byte names, a joiner's STATE came to 1,944 bytes, a tally resync's to 2,340, and a late-vote resync's, with input ticks from up to 255 ticks back, to 10,359, all under the 16,000-byte limit that roslambo's encoder keeps by dropping input ticks. The state has since grown by 33 bytes, under 2% of any of these.
- **A hidden page's silences (PLAN D-16), modelled:** a page whose timers wake about once a second sends only its newest 3 ticks each time, so receivers see runs of 56–58 final ticks without its input. With wake-ups up to 50 ms late, 2.5% of the runs reached 60 ticks, or 17.5% with the clock 2% fast as roslambo's rate correction allows, and none reached 120.
- **A confirmed goal taken back (PLAN C-4, Q-7), modelled from roslambo's timeline:** a browser drops an input that arrives after its tick is final, so it diverges once the one-way delay passes d + w = 14 ticks (233 ms), and it tallies without a vote that arrives more than v = 12 ticks (200 ms) after the vote was sent. So a tick that diverged through a dropped input is confirmed alone, and a goal in it later taken back, only under a one-way delay held above about 233 ms, or a stall that holds the link's messages for 27 ticks (450 ms) or more before delivering them together.

**The client:** the same review also modelled the cameras, the stick and the phone's view, and probed the content security policy. This code isn't kept either.

- **Ball view's swing (PLAN D-28), computed:** a terrier circling the ball at run speed, 6 m/s, from 3 m turns the line to the ball at 0.32 turn/s, and at zoomies speed at 0.48. A camera easing toward that line with a time constant τ lags it by that rate × τ: 34° at chase view's 0.3 s and 69° at the calmer 0.6 s, or 52° and 103° at zoomies speed. A phone held sideways shows about 915 × 355 CSS px, where a 45–60° vertical field of view is a 47–56° horizontal half-field, so the calmer camera's lag would lose the ball. A ball passing at speed v with horizontal miss distance b turns the line at up to v/b: at 5 m/s, 0.76 turn/s for a ball grazing the terrier (b = 1.05 m), 1.99 for one hopping over it (0.4 m) and 3.98 at 0.2 m.
- **The bandana on the phone (PLAN C-51), computed:** the Pixel 8a's 1080 × 2400 px at a device pixel ratio of 2.625 are 411 × 914 CSS px, and about 355 CSS px of height is left held sideways in Chrome (assumed). At a 45–60° vertical field of view, a 6 cm band is 3.7–5.1 CSS px tall at 5 m, 1.8–2.6 at 10 m and 0.9–1.3 at 20 m, and a 2 cm stripe a third of that. Bold 4–5 cm stripes stay at 2 CSS px or more to about 6–10 m.
- **Chase view's re-read (PLAN Q-19, D-29), modelled:** 60 ticks a second, the stick in 32 steps with half-step hysteresis, the terrier turning at 2 turns/s, and D-28's chase camera (0.3 s and at most 1 turn/s; calmer 0.6 s and 0.5 turn/s).
  - A stick swept 90° in 0.5 s or 1 s turned the terrier about 135° or 169° under Q-19's 45° rule (124° or 135° with the calmer camera), and 146° or 191° under L74's wording, which re-reads at every step.
  - A stick circled at 0.5 or 1 turn/s turned it at 0.83 or 1.25 turn/s under Q-19 (0.56 or 1.03 calmer).
  - Holding right until the camera was behind, then rolling the stick to up: Q-19 dipped 20–35° left and came back to straight on; L74's wording ended 11–45° right; re-reading only from neutral ended 90° left on screen, because it keeps the screen as it was at the press. Otherwise neutral-only turned the terrier exactly with the stick under either camera.
  - With the hysteresis, a ±8° wobble at a step's centre spun the heading under no rule. L74's wording spins only on a wobble that crosses a step.
- **The content security policy (PLAN D-35), probed:** a page served through Playwright's request interception at a loopback address, under amorfus's policy (`script-src 'self'; connect-src 'self' wss:; object-src 'none'; base-uri 'none'`), in Chromium 156, Firefox 157 and WebKit 27.2. All three refused `fetch()` of a `blob:` URL, a worker made from a `blob:` URL, `WebAssembly.compile` and a `ws://127.0.0.1` socket, and allowed an `<img>` from a `blob:` URL and a same-origin worker. This machine has no copy of three, so the last step isn't checked here: in three's source (r150–r170), GLTFLoader turns a `.glb`'s embedded images into `blob:` URLs and loads them with ImageBitmapLoader, which calls `fetch()`, in all three engines.

**Build and tests:** the same review also worked out, from the plan's own timings, how long the gate's matches take.

- **A whole match in the gate (PLAN Q-18, §16), derived:** at the 1-minute length, a match runs the 5 s start countdown and 60 s of clock, and its end shows about 0.4 s after the last tick, once confirmed. A goal stops the clock for its 3.4 s celebration, and for the 3 s kickoff countdown after it unless it ends the match, so each goal adds 3.4–6.4 s, and a match with one goal lasts about 69–72 s before any loading and joining. roslambo's end-to-end config runs one test at a time, so these add up across the gate.
