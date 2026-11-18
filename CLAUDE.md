# terriest: agent instructions

This repo is **public**, and **unlicensed**: the owner keeps all rights (Q-1). Never add a LICENSE file or licence headers. `package.json` says `"license": "UNLICENSED"`, and the bundled packages' notices still ship, in `dist/THIRD-PARTY-LICENSES.txt` (§20). Never commit home paths, account or user names, email addresses, machine names, `workers.dev` addresses (C-45) or other identity details. `npm run public-scan` enforces the built-in patterns, and the owner's denylist only where `$TERRIEST_PRIVATE_TERMS` names it: a file outside the repo that never enters it. Its first line says which scan ran. With the variable unset, as on CI, it checks the built-in patterns alone, so a green gate hasn't checked the denylist's terms; set to a missing file, it fails.

## The gate is the definition of done

```sh
npm run check
```

That is lint, public-scan, typecheck, unit tests (`vendor/hermet`'s included), the build with its licence notices and dist audit, and end-to-end tests in Chromium, Firefox and WebKit against the built page. It must pass before a commit lands. Never weaken it to make a build pass: fix the code. Its wall time is logged in `docs/acceptance.md` at each milestone's exit (§16).

## Contracts that are easy to break

**The plan**
- PLAN.md is the implementation contract. A Q, C, D or M number is never reused; a settled item records what settled it. Check it before reopening a decision.
- REQUIREMENTS.md belongs to the owner. Change it only as the plan records, citing the Q- or C-number.
- The plan's L-numbers are REQUIREMENTS.md's lines at commit 6254a1d. Since then one line was added after L286, so from L287 on, today's file runs one line later.

**Code boundaries** (most are D-38's lint, which `scripts/eslint/config.test.mjs` tests)
- `src/core/**` is pure: no DOM, timers, clocks, storage or network, and no global object. The caller passes time in (§6).
- The simulation never imports drawing code: nothing in `src/core/**` imports three, `src/render/**`, `src/ui/**`, `src/input/**` or `src/audio/**` (L252).
- Only `src/render/**` imports three (D-26), and only from `three` and `three/addons/…`, never `three/src/…`, which would bundle a second copy (§15).
- `src/core/sim/**` and the bot brain in `src/core/bot/**`, their tests aside, use only exact operations (D-1, D-39), under hermet's `exact-ops` rule. There, `Math` appears only as `Math.<name>`: never destructured, aliased or passed on. And arrays only: `Map`, `Set`, `WeakMap` and `WeakSet`, with their `Readonly…` and `…Constructor` types, appear only as keys, since a Map or Set iterates in insertion order, which can follow arrival order (§7.3, D-38).
- Every setting is in `src/config.ts` and nowhere else (§7.4). `src/config.test.ts` reports a copy by its name anywhere in `src` and `dev`, and in `src/core/sim` and `src/core/bot` by its value too: anywhere, a number that isn't whole or 0.5; in a top-level constant, or an object literal one holds, any number but 0, or an equal array, as a port of the M0 spike's own constants would hold them. A code that only looks like a setting, such as a piece kind, says `not a setting` on its line. In `src/core/sim` and `src/core/bot` that's every top-level code the scan would flag: a bit, a phase, a kind, a version, a coefficient, a scene's coordinate, the brain's geometry, each as `// not a setting: <what it is>`. The scan can't see a whole number inside a function, so there the rule holds by review: read the setting from `SimParams` or `BotParams`, never a local copy. Run `npx vitest run src/config.test.ts` early.
- `src/config.test.ts` and `dev/tuning/model.test.ts` read PLAN's A.4 and A.5 and REQUIREMENTS' Configuration table at run time: the first table after each heading, a row per setting, its numbers in order, references such as D-8 aside, and "one", "twice" and "half" read as numbers. Keep the rows parseable, and when a row's wording or numbers change, change their maps with it: the config test's `CONFIGURATION`, `A4` and `A5`, and `dev/tuning/model.ts`'s `ROWS`. The config test's planted cases replace the first row in PLAN.md that starts `| Tumble guard |` or `| Idle friction | 8 `, so keep such rows to A.5.
- Only `src/net/trystero.ts` imports Trystero's code; types may be imported anywhere (D-18). From M3 it builds its room config with `vendor/hermet/room-config.ts`, a literal typed against `JoinRoomConfig`: an untyped spread made amorfus silently fall back to the library's own relays.
- Only `src/storage/**` touches browser storage.
- No root-absolute URL and no History API, so the site works from a subpath (L232). The fragment is set with `location.replace`.
- Every external host is listed in `third-party.json`; the dist audit fails on any other.
- The module paths of §6 are part of the contract: the lint, and from M2 the golden files, depend on them.

**The simulation and its goldens** (from M2)
- Golden hashes pin the simulation's bits in Node, every engine and arm64 (§16). Any change to the simulation or its settings changes them. Re-emit them on purpose, with `TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens`, and say so in the commit. That's allowed until the first release.
- The emit is guarded twice (§15). The script refuses without `TERRIEST_EMIT_GOLDENS=1`, and runs `src/core/sim/golden.test.ts` with a second variable, `TERRIEST_EMIT_GOLDENS_BY_SCRIPT=1`, which only it sets. The test writes `goldens.json` only with both, and only once every run covers its spec, and with the first alone it fails. So never export either: run the script.
- `src/core/sim/step.test.ts`'s bit pins tie the port to the M0 spike's bits, under a configuration copy at M0's values written out there, so tuning never moves them. A mismatch is a port bug. Re-pin only for a deliberate rule change, named in the commit, as the slip release's was (D-5).
- The slipping flag's hold-off reads its own setting, `slipHoldOffMetres` (A.4's Slip-out row), not the re-arm gap, so the two tune apart (D-5). The push assist takes the restitution threshold as the speed above which the ball is moving, so tuning the threshold moves both (C-18).
- `step` advances its state in place, and depends only on that state and its inputs: nothing in a `Sim` carries from one call to the next, so one `Sim` steps any states of its pack size (§7.2). Keep every scratch entry written before it's read.

**Drawing**
- Drawing reads every animation but barking from the state, with how far through it is (L345). It keeps only blends, smoothing offsets, the timings it is fading out and each bark's start, so a rollback or a resync redraws it right (D-27). It never feeds anything back to the simulation.
- Coats and bandanas go by list index. The state, storage and messages carry a coat's index in the coat list and a terrier's pack, never a colour, and drawing looks up the colours and patterns (§12, D-27). The number of coats is in `src/config.ts`, so the build hash covers it (D-21).
- The stand-in skinned model stays out of `dist/`. From M4 the tests generate it with `scripts/make-standin.mjs`, or keep it in `e2e/fixtures/`, and serve it to the built page by request interception (D-27, C-33). The dist audit fails a `.glb` in `dist/` anyway.

**The boot page** (D-30)
- `index.html` holds the loading message and its `noscript`, shown until the app has started, so the page is never blank. `public/boot.js`, a classic script, runs its checks before the module and holds every failure message's text.
- `html[data-boot]` reads a failure's code at once where boot.js's own checks fail: `F` (opened from `file://`) or `S` (an insecure context). Otherwise it reads `loading`, then `started`, `W` (no WebGL 2, which the module reports when it makes the page's one context) or `L` (not started within 20 s). The specs read it (`e2e/lib/page.ts`).
- `window.terriestBoot`, with `started()` and `noWebGL2()`, exists only once `F` and `S` have passed, so where they fail the module does nothing. The module calls `started()` after its first frame, which takes the message down.
- The page has one main landmark at a time: the message's, then the pitch's, which holds the canvas as an image named "The pitch" and stays hidden until `started` (`index.html`, `src/main.ts`).

**Tests**
- New behaviour needs a test through the real page and its controls (L344). A harness that bypasses the real page proves nothing about the product: amorfus's two worst first-build defects passed a green gate that way.
- The `#test=` pages (determinism, net, frames, from M2 to M4) and `window.terriestTest` never change what a normal page does. A spec sets `window.terriestTest = {}` before load (`installHook`, in `e2e/lib/page.ts`); once started, the page adds `inspect()` to it, which returns what the specs read: at M1, `{ render }`, the renderer's figures (`src/main.ts`). A normal page never has the object.
- `#test=determinism` (`src/determinism.ts`, a chunk of its own that only that fragment loads) replays every golden run and the canary in the built bundle and compares them with `goldens.json`. It makes no WebGL context, calls `started()` once its landmark shows, and publishes `window.terriestDeterminism`, a `DeterminismReport`, and `html[data-determinism]`, `pass` or `fail`, which `e2e/determinism.spec.ts` reads. That global is the page's own: a normal page never has it, and `window.terriestTest` stays the normal page's hook.
- vitest runs test files in parallel and a file's tests one after another, and the bot marks' whole matches are most of the unit stage's CPU (§16). So a long loop goes in a file of its own, as each mark, the regulation mark's four files and the two tunnelling files do. Never cut a mark's seeds or a scene to save time.
- Firefox draws WebGL only with a display, so the gate runs under WSLg or `xvfb-run` (C-6). Every spec checks WebGL 2 in its engine first (`expectWebGL2`), the boot failures' included, so a run without a display fails there at once, not on a timeout. `GALLIUM_DRIVER` opts in to the GPU path, and then every Chromium the gate launches takes ANGLE's GL flags (`e2e/lib/gl.ts`); unset, no engine gets a GL flag.
- Nothing in a test depends on the frame rate. The gate draws in software, at 5–26 frames a second for a busy scene, and the timeline and the gamepad run on timers (C-6, D-29, D-31). The gate plays its matches at the low render quality, a real player setting (C-6, D-33).
- A spec whose tests launch a browser of every engine themselves (from M3, through `e2e/lib/browsers.ts`) is named `*.net.spec.ts`. It then runs once, in the `net` project; every other spec runs once in each engine (`playwright.config.ts`). A test there may still launch a browser of its own engine for a launch switch, as `e2e/boot.spec.ts` does to turn WebGL 2 off.
- The e2e guard allows only the servers a spec loads from and the local relay it names. Import `test` from `e2e/lib/guards.ts`, whose automatic `guard` fails a test on a console error, a WebGL error included in every engine though Chromium and Firefox log those as warnings, or a request outside `guard.allowed`. A test that breaks a load on purpose may list the browser's own errors for it in `guard.allowedErrors`, each pattern matching an error's whole text, and never the page's own (§16). A page the fixture doesn't own, in a browser a test launches itself or a `*.net.spec.ts`, gets `watchPage` and `expectEverywhere`. Never allow a public host: the gate contacts none, `third-party.json`'s included (§16).

**Tooling**
- `vendor/hermet` is the gate tooling shared with roslambo and amorfus (D-37): public-scan, the dist audit, the licence notices, the exact-ops rule, the local Nostr relay, the ESLint and tsconfig bases, and the room-config builder. It is a submodule pinned at 11283ca; terriest's own policy stays in `scripts/` and the configs. Change shared code in hermet, then move the pin. Never edit `vendor/hermet` in place.
- `research/spike/` is the throwaway M0 spike (D-36), with its own toolchain. Nothing outside it imports it, and the gate doesn't lint, typecheck or test it.
- The tuning page, `dev/tuning.html` (§15, Q-10), is dev only: `npm run dev` serves it at `/dev/tuning.html`, and the build never takes it. It runs the real simulation and the bot brain, with a slider for every setting they read. `dev/tuning/model.test.ts`, in the gate, fails a setting that's neither a slider nor in `NOT_TUNED` with its reason, so a new setting the simulation reads needs its slider. The page's metrics, `dev/tuning.metrics.ts`, run off the gate, with `npx vitest run --config dev/vitest.config.ts`. They write `research/tuning/results.json`, and refuse to overwrite it unless `TERRIEST_TUNING_OUT` names the file. `dev/` takes the rest of `src`'s lint (D-38).
- A change of dependencies resolves with `npm install --before=<the date a week ago>`, so the lockfile takes only releases at least a week old. That matters most for wrangler, which holds the deploy login.

## Owner-only steps

- External actions wait for the owner's explicit go-ahead (§17): a push of terriest, any push to hermet, any change to roslambo or amorfus, each deploy, and the relay check, which writes to public relays. The first deploy's go-ahead names the DNS records it will replace (Q-5).
- The owner's attended steps (the checks by hand, the tuning, the bots' level, the look) don't hold up a milestone. Settle one provisionally as §17 says, log it as owner-pending in `docs/acceptance.md`, and go on. Each lands before M5's deploy.

## Branches

Every session works on its own branch, and `main` moves only by fast-forward: `/merge-to-main` lands a branch, and `/sync-with-main` brings `main` into one that has fallen behind. Questions, including prompts that start with "I want", get answers rather than changes. The rules are in `.claude/rules/`: [session-branches.md](.claude/rules/session-branches.md) and [always.md](.claude/rules/always.md).
