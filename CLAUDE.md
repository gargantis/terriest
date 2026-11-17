# terriest: agent instructions

This repo is **public**, and **unlicensed**: the owner keeps all rights (Q-1). Never add a LICENSE file or licence headers. `package.json` says `"license": "UNLICENSED"`, and the bundled packages' notices still ship, in `dist/THIRD-PARTY-LICENSES.txt` (§20). Never commit home paths, account or user names, email addresses, machine names, `workers.dev` addresses (C-45) or other identity details. `npm run public-scan` enforces the built-in patterns, and locally the owner's denylist too: a file outside the repo, named by `$TERRIEST_PRIVATE_TERMS`, that never enters it.

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
- `src/core/sim/**` and the bot brain in `src/core/bot/**`, their tests aside, use only exact operations (D-1, D-39), under hermet's `exact-ops` rule. There, `Math` appears only as `Math.<name>`: never destructured, aliased or passed on.
- Only `src/net/trystero.ts` imports Trystero's code; types may be imported anywhere (D-18). From M3 it builds its room config with `vendor/hermet/room-config.ts`, a literal typed against `JoinRoomConfig`: an untyped spread made amorfus silently fall back to the library's own relays.
- Only `src/storage/**` touches browser storage.
- No root-absolute URL and no History API, so the site works from a subpath (L232). The fragment is set with `location.replace`.
- Every external host is listed in `third-party.json`; the dist audit fails on any other.
- The module paths of §6 are part of the contract: the lint, and from M2 the golden files, depend on them.

**The simulation's goldens** (from M2)
- Golden hashes pin the simulation's bits in Node, every engine and arm64 (§16). Any change to the simulation or its settings changes them. Re-emit them on purpose, with `TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens` (the script refuses without the variable), and say so in the commit. That's allowed until the first release.

**Drawing**
- Drawing reads every animation but barking from the state, with how far through it is (L345). It keeps only blends, smoothing offsets, the timings it is fading out and each bark's start, so a rollback or a resync redraws it right (D-27). It never feeds anything back to the simulation.
- Coats and bandanas go by list index. The state, storage and messages carry a coat's index in the coat list and a terrier's pack, never a colour, and drawing looks up the colours and patterns (§12, D-27). The number of coats is in `src/config.ts`, so the build hash covers it (D-21).
- The stand-in skinned model stays out of `dist/`. From M4 the tests generate it with `scripts/make-standin.mjs`, or keep it in `e2e/fixtures/`, and serve it to the built page by request interception (D-27, C-33). The dist audit fails a `.glb` in `dist/` anyway.

**The boot page** (D-30)
- `index.html` shows a loading message, with a `noscript`, until the app has started, so the page is never blank. `public/boot.js`, a classic script, runs its checks before the module and holds every boot message's text.
- `html[data-boot]` reads `loading`, then `started` or a failure's code: `F` (opened from `file://`), `S` (an insecure context), `W` (no WebGL 2, which the module reports when it makes the page's one context) or `L` (not started within 20 s). The specs read it (`e2e/lib/page.ts`).
- `window.terriestBoot`, with `started()` and `noWebGL2()`, exists only once `F` and `S` have passed, so where they fail the module does nothing. The module calls `started()` after its first frame, which takes the message down.

**Tests**
- New behaviour needs a test through the real page and its controls (L344). A harness that bypasses the real page proves nothing about the product: amorfus's two worst first-build defects passed a green gate that way.
- The `#test=` pages (determinism, net, frames, from M2 to M4) and `window.terriestTest` never change what a normal page does. A spec sets `window.terriestTest = {}` before load (`installHook`, in `e2e/lib/page.ts`); once started, the page adds `inspect()` to it, which returns what the specs read: at M1, `{ render }`, the renderer's figures (`src/main.ts`). A normal page never has the object.
- Firefox draws WebGL only with a display, so the gate runs under WSLg or `xvfb-run` (C-6). Every spec that draws checks WebGL 2 in its engine first (`expectWebGL2`), so a run without a display fails there at once, not on a timeout.
- Nothing in a test depends on the frame rate. The gate draws in software, at 5–26 frames a second for a busy scene, and the timeline and the gamepad run on timers (C-6, D-29, D-31). The gate plays its matches at the low render quality, a real player setting (C-6, D-33).
- A spec whose tests launch a browser of every engine themselves (from M3, through `e2e/lib/browsers.ts`) is named `*.net.spec.ts`. It then runs once, in the `net` project; every other spec runs once in each engine (`playwright.config.ts`). A test there may still launch a browser of its own engine for a launch switch, as `e2e/boot.spec.ts` does to turn WebGL 2 off.
- The e2e guard allows only the servers a spec loads from and the local relay it names. Import `test` from `e2e/lib/guards.ts`, whose automatic `guard` fails a test on a console error or a request outside `guard.allowed`. A test that breaks a load on purpose may list the browser's own errors for it in `guard.allowedErrors`, each pattern matching an error's whole text, and never the page's own (§16). A page the fixture doesn't own, in a browser a test launches itself or a `*.net.spec.ts`, gets `watchPage` and `expectEverywhere`. Never allow a public host: the gate contacts none, `third-party.json`'s included (§16).

**Tooling**
- `vendor/hermet` is the gate tooling shared with roslambo and amorfus (D-37): public-scan, the dist audit, the licence notices, the exact-ops rule, the local Nostr relay, the ESLint and tsconfig bases, and the room-config builder. It is a submodule pinned at 11283ca; terriest's own policy stays in `scripts/` and the configs. Change shared code in hermet, then move the pin. Never edit `vendor/hermet` in place.
- `research/spike/` is the throwaway M0 spike (D-36), with its own toolchain. Nothing outside it imports it, and the gate doesn't lint, typecheck or test it.
- A change of dependencies resolves with `npm install --before=<the date a week ago>`, so the lockfile takes only releases at least a week old. That matters most for wrangler, which holds the deploy login.

## Owner-only steps

- External actions wait for the owner's explicit go-ahead (§17): a push of terriest, any push to hermet, any change to roslambo or amorfus, each deploy, and the relay check, which writes to public relays. The first deploy's go-ahead names the DNS records it will replace (Q-5).
- The owner's attended steps (the checks by hand, the tuning, the bots' level, the look) don't hold up a milestone. Settle one provisionally as §17 says, log it as owner-pending in `docs/acceptance.md`, and go on. Each lands before M5's deploy.

## Branches

Every session works on its own branch, and `main` moves only by fast-forward: `/merge-to-main` lands a branch, and `/sync-with-main` brings `main` into one that has fallen behind. Questions, including prompts that start with "I want", get answers rather than changes. The rules are in `.claude/rules/`: [session-branches.md](.claude/rules/session-branches.md) and [always.md](.claude/rules/always.md).
