# terriest
Rocket League with terriers: two packs of small dogs corral a giant rubber ball into goals. Terri. Terrier. Terriest.

**Status:** in development, and nothing is playable yet. [REQUIREMENTS.md](REQUIREMENTS.md) says what the game must do; [PLAN.md](PLAN.md) says how, and lists the milestones. Numbers such as Q-5 or C-14 below are the plan's. Done so far: M0, the physics and rendering spike ([research/spike/REPORT.md](research/spike/REPORT.md)); M1, the skeleton and its test gate, with a page that draws an empty pitch; and M2, the deterministic simulation, its goldens, the bot brain and the tuning page, all running offline. Next: M3, the timeline, networking and Practice. [docs/acceptance.md](docs/acceptance.md) holds the acceptance criteria and the log of runs the gate doesn't make.

## Run

Needs Node 22.12 or later (`engines` in `package.json`; `.nvmrc` selects Node 22). The gate's tooling, shared with roslambo and amorfus, is the git submodule `vendor/hermet`, which `npm install` doesn't fetch. So clone with it:

```sh
git clone --recurse-submodules <this repository's URL>
cd terriest
npm install && npm run build   # emits dist/
```

In a clone made without `--recurse-submodules`, fetch it once before building:

```sh
git submodule update --init
```

Without it, `npm run build` and `npm run check` stop at once and name that command. The dev server is `npm run dev`, at http://localhost:5173/. Until Settings arrive at M4, the address picks the render quality: `?quality=low` or `?quality=high`, high by default (D-33).

## Test

```sh
npx playwright install --with-deps chromium firefox webkit   # once
npm run check
```

`npm run check` is the gate, and the definition of done. In order, it runs ESLint, with the plan's import and purity boundaries (D-38); public-scan; the typecheck; the unit tests, hermet's included; the build; and the end-to-end tests against the built page in headless Chromium, Firefox and WebKit. A page that requests anything outside the local servers its test names fails the test, so the gate contacts no public host. At M2 it takes about 2 minutes on the development machine, and longer while the machine is busy: most of its unit tests' time is the bots playing whole matches. It will grow once the end-to-end tests play whole matches too (Q-18), and `docs/acceptance.md` logs its wall time at each milestone's exit.

At M2 there are 14 end-to-end tests in each engine: `e2e/boot.spec.ts`, the boot page's four failure messages (D-30); `e2e/determinism.spec.ts`, the golden runs replayed through the built page (below); `e2e/pitch.spec.ts`, the empty pitch, its size, its render quality, what assistive technology reads of the started page, and its frame rate, which is reported, never judged; and `e2e/smoke.spec.ts`, the page served by `vite preview`, under `dist/_headers`, and from a subpath. `npm run e2e` runs them alone, against the last build.

### The goldens

`src/core/sim/goldens.json` pins the simulation's bits (PLAN §16): the unit tests replay its 25 runs and the canary in Node, and `e2e/determinism.spec.ts` replays them through the built page in each engine. A change to the simulation or its settings changes them, and the tests then fail until they're re-emitted, on purpose, saying so in the commit:

```sh
TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens
```

The script refuses without the variable, and the golden test fails when the variable is set but not by the script, so the gate never rewrites the goldens by itself.

To check a browser by hand, open the built page's determinism page, which replays every run and shows its verdict:

```sh
npm run build && npx vite preview   # then open http://127.0.0.1:4339/#test=determinism
```

CI (`.github/workflows/check.yml`) runs the gate under `xvfb-run` on each push and pull request, and the unit tests on arm64. `docs/acceptance.md` logs its runs.

### Without a display

Firefox draws WebGL only while `DISPLAY` or `WAYLAND_DISPLAY` is set, and the gate checks for WebGL 2 in each engine first (C-6). WSLg sets both. Elsewhere, as in CI, run the gate in a virtual display:

```sh
xvfb-run -a npm run check
```

`npx playwright install --with-deps` installs `xvfb-run`.

### On the GPU (opt-in)

The headless engines draw WebGL in software: SwiftShader in Chromium, llvmpipe in Firefox and WebKit. On WSL2, Mesa's Direct3D 12 driver draws on the host's GPU instead (C-6):

```sh
GALLIUM_DRIVER=d3d12 npm run check
```

That moves all three engines to the GPU. Firefox and WebKit draw through Mesa, so the variable alone moves them; while it's set, the gate also passes every Chromium it launches ANGLE's GL flags, so Chromium draws through Mesa too (`e2e/lib/gl.ts`). Unset, the gate passes no GL flag. On the development machine each engine then draws the empty pitch at about 60 frames a second, and `e2e/pitch.spec.ts`'s frame-rate lines name the path. At M1 that doesn't make the gate faster: starting each page costs more on that path than drawing the empty pitch saves, so the gate took 93 to 94 s there, against 76 to 78 s in software. Whether it pays once busy scenes make drawing the bottleneck is for measuring then. No test depends on the frame rate either way.

### The private denylist

public-scan fails on home paths, as `/home/<name>/`, `/Users/<name>/` or `C:\Users\<name>`, and on PEM private keys, in the text files git tracks or would add. That's all its built-in patterns cover: it skips binary files, and passes a home path with no `/` after the name, or a WSL path such as `\\wsl.localhost\…`. It also fails on the terms of a denylist kept outside the repo, when `TERRIEST_PRIVATE_TERMS` holds its path: one term per line, and a line starting with `#` is a comment. Its first line says whether it read one, and a path to a missing file fails it. A denylist finding never prints its term, but a built-in finding prints what it matched, which can hold one, such as a user name in a home path. CI has no denylist, and runs the built-in patterns only.

```sh
export TERRIEST_PRIVATE_TERMS=/path/to/private-terms.txt
```

## Tune

The tuning page runs the real simulation and the bots, with a slider for every setting they read (PLAN Q-10, §15). With the dev server running (`npm run dev`), open http://localhost:5173/dev/tuning.html. It's dev only: the build never includes it, and it stores nothing.

- **Pick a scenario:** kickoffs and bot matches, pushes, a ball on terriers, dribbles, simultaneous hits, bowling, shots into the goal's netting, touches, and every golden run. One terrier follows the keyboard: W, A, S and D steer it, Space jumps, Shift is zoomies, E pounces and Q barks, and the frame selector picks the pitch, the ball line or the nose.
- **Move a slider,** and the scene restarts with it. The values ride in the address, so a tuned scene can be reloaded or shared.
- **Copy settings** writes the changed values as a snippet for `src/config.ts`, and as the rows of PLAN.md's A.4 and A.5 and of REQUIREMENTS.md's Configuration table that they change, in those tables' own wording. A value set here is the owner's, so its row loses M2's "provisional by measurement".
- **Record** and **Stop** save a run as a JSON download, which replays to the same final hash.

M2's values were set by measurement ([research/tuning/REPORT.md](research/tuning/REPORT.md)), and they're provisional until the owner confirms or changes them, on this page or by naming them.

### The tuning metrics

The measurements behind those values run off the gate, in about 7 to 9 minutes, and rewrite the committed results:

```sh
TERRIEST_TUNING_OUT=research/tuning/results.json npx vitest run --config dev/vitest.config.ts
```

`TERRIEST_TUNING_OUT` names the file they write. Without it they write `research/tuning/results.json`, and refuse to overwrite it, so while that file is committed a bare run stops at once. `TERRIEST_TUNING_ONLY` runs only the sections it names, `TERRIEST_TUNING_BASE` measures from settings other than `src/config.ts`'s, and `TERRIEST_TUNING_CANDIDATES` replaces candidate lists, as `dev/tuning.metrics.ts`'s header says. The report holds M2's method, its commands and its results.

## Build

```sh
npm run build   # emits dist/, a fully static folder
```

It typechecks, builds with Vite, and writes the bundled packages' licence notices to `dist/THIRD-PARTY-LICENSES.txt`. Then hermet's dist audit checks `dist/`: relative references only, no host outside `third-party.json`, no secrets, only allowed file types, and exactly the expected notices, each with its licence text.

## Deploy

```sh
npm run deploy   # the gate, then wrangler deploy
```

It deploys `dist/` to Cloudflare Workers static assets, at terriest.com: assets only, with request logs, the `workers.dev` address and Preview URLs off (`wrangler.jsonc`). wrangler signs in with its stored login, with no API token, and `wrangler login` renews a lapsed one at a browser (Q-6). Nothing is deployed yet, and every deploy waits for the owner's go-ahead.

**The first deploy** makes terriest.com a Workers custom domain, which replaces any A, AAAA or CNAME records the name has, and any Workers custom domain on it (Q-5). Before it, the owner lists those from the Cloudflare dashboard, and the go-ahead names what will be replaced. Run without a terminal, as Claude runs it, wrangler replaces them without asking; in the owner's own terminal, it asks first. That deploy also checks that the zone is on the account this machine deploys with.

## Privacy

No accounts, analytics or tracking.

- **At M1** the page contacts only the server it's loaded from, and the gate fails a page that requests anything else.
- **From M3,** with matches, nothing is contacted until you propose or join one. Opening a `#join=` link or entering a code counts as joining. Then these see the following (PLAN §20; the relays and STUN servers are in [third-party.json](third-party.json)):

| Who | Why | What they see |
|---|---|---|
| Six public Nostr relays, and any you add in Settings | signalling, so browsers can find each other | your IP address, Origin, User-Agent and timing, a hashed room topic, a Nostr key and Trystero peer ID made for each page load, and the sizes of encrypted session descriptions |
| stun.cloudflare.com and stun.l.google.com | STUN: your public address, for direct connections | your IP address and port |
| Your own TURN server, if you add one | relaying between browsers that can't connect directly | your IP address and traffic volume |
| The other browsers in the match | the game | your IP address, player ID, name, coat and inputs |

- **Practice** (from M3) contacts no one.
- **Hosting:** once deployed, Cloudflare serves terriest.com. It sees each HTTP request, never the `#join=` fragment, and request logs are off.

## Licence

None. All rights reserved: this repository is public so it can be read, but no licence is granted to use, copy, modify or distribute it. Bundled third-party packages keep their own licences. Their notices, with their texts, ship in `dist/THIRD-PARTY-LICENSES.txt`: three's from M1, and Trystero's and `@noble/secp256k1`'s from M3.

## Known limits

- **Safari may delete stored data** after 7 days without a visit (C-14): the player ID, name, coat and settings the game keeps from M4. Only a re-typed name and coat are at stake.
- **Real Safari is unverified.** Playwright's WebKit stands in for it in the gate. If the device round before M5 names a Mac or an iPhone, the determinism page and one match run on it before release (Q-12).
- **Phone performance is unverified** while the Pixel 8a's run is pending (Q-13).

## Windows: the Sticky Keys shortcut

Shift will be zoomies (from M4). On Windows, pressing Shift five times opens the Sticky Keys prompt. The prompt takes focus, so every key is released and your terrier stops until you dismiss it (C-52). To turn the shortcut off:
- **Windows 11:** Settings > Accessibility > Keyboard > Sticky keys, then turn off **Keyboard shortcut for Sticky keys**.
- **Windows 10:** Settings > Ease of Access > Keyboard, then clear **Allow the shortcut key to start Sticky Keys**.
