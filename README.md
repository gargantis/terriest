# terriest
Rocket League with terriers: two packs of small dogs corral a giant rubber ball into goals. Terri. Terrier. Terriest.

**Status:** in development. Practice against the bots, and matches with others through the screens, are playable (Play, below). [REQUIREMENTS.md](REQUIREMENTS.md) says what the game must do; [PLAN.md](PLAN.md) says how, and lists the milestones. Numbers such as Q-5 or C-14 below are the plan's. Done so far: M0, the physics and rendering spike ([research/spike/REPORT.md](research/spike/REPORT.md)); M1, the skeleton and its test gate, with a page that draws an empty pitch; M2, the deterministic simulation, its goldens, the bot brain and the tuning page, all running offline; and M3, the rollback timeline, the protocol, matches between browsers over Trystero with consensus, bots hosted in them, and Practice, with the correction measurement ([research/corrections/REPORT.md](research/corrections/REPORT.md)). Under way: M4, the drawing, input, screens and sound. Its first two phases are in: Practice and matches with others through the screens, drawn in 3D with code-built terriers, on the keyboard, a gamepad or a touch screen, with sound; the drawing's finer animation, the stand-in model and the look are its next. [docs/acceptance.md](docs/acceptance.md) holds the acceptance criteria and the log of runs the gate doesn't make.

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

Without it, `npm run build` and `npm run check` stop at once and name that command. The dev server is `npm run dev`, at http://localhost:5173/; it reloads the page when a file changes, as when another session edits the checkout. `npm run dev:local` is the dev server with hermet's local Nostr relay beside it, so browsers on this machine can play a match with each other, through the screens or the network test page, without a public relay (below).

### Play

```sh
npm run play   # builds the checkout into dist-play/ and serves it at http://localhost:4340/
```

It builds the checkout as it stands into `dist-play/`, which git ignores, and serves that copy on a port of its own, 4340, so a later edit or branch switch doesn't reload the match under you, and the gate's server, on 4339, isn't blocked by it (M4-Q40). On WSL2, open http://localhost:4340/ in Chrome, Edge or Firefox on Windows. Stop it with Ctrl+C.

On Home, press **Practice**, pick 1 to 4 a side and a length, and **Start**. You play in the blue pack, and bots take every other place. Warm up, then press **Ready**, which has the focus, so Enter presses it; the bots are always ready, so a 5 s countdown starts, and then the match. The keys:
- **W, A, S and D** run, relative to the screen; **Shift**, either, is zoomies while the meter lasts;
- **Space** jumps, **E** pounces, **Q** barks, and **C** switches between ball view, where W runs at the ball, and chase view, behind your terrier;
- **Escape** opens the menu, which pauses Practice: Resume, or Escape again, carries on, and Leave goes Home.

A gamepad in the browser's standard mapping plays too: the left stick runs, the bottom face button jumps, the left one pounces, the top one barks, the right shoulder switches the view and the right trigger is zoomies; the d-pad moves through the screens' buttons, Start presses one, and Back opens the menu. On a touch screen a stick and buttons sit over the pitch; a phone plays held sideways. Each control's hint shows until it's first used.

Home's **Settings** holds the render quality: high, the default, or low, for a slower device (D-33), which applies at once; sound, on by default, which starts at your first key or tap (a browser plays none before); whether each match starts in ball view; the calmer camera, which follows your system's reduced motion until you choose; the mirrored touch controls; **Show control hints again**; and for matches with others, extra Nostr relays and a TURN server. The menu's Settings holds the same during a match. The browser keeps them, with your name and coat. On Windows, Shift pressed five times opens the Sticky Keys prompt, which takes the focus and stops your terrier: [Windows: the Sticky Keys shortcut](#windows-the-sticky-keys-shortcut), below, says how to turn it off.

### A match with others

A built page, `npm run play`'s or, once deployed, terriest.com's, finds the other browsers through the public relays (Privacy, below). To play between browsers on this machine without them:

```sh
npm run dev:local   # the dev server, with hermet's local relay on 127.0.0.1, the screens' only relay
```

It prints the relay's port, then the dev server's address, http://localhost:5173/ unless that port is taken. A page may reload once on its first load while Vite prepares a dependency. Open the address in a different browser for each player, Chrome, Edge and Firefox say, or one of them in a private window: two tabs of one browser share its storage, and the second says "terriest is open in another tab", with **Use here** to move the game to it (D-24).
1. **Propose:** in the first browser, Home's **Propose a match**, the pack size and length, then **Create**. Created shows the link, with **Copy link**, and the code in groups of four, with **Copy code**; "Keep this page open until someone joins" and how many have; and **Play in pack A**, **Play in pack B**, **Watch** and **Leave**. Press a Play.
2. **Join by the link:** in the second browser, open the link. Join reads "Connecting to the match…", then shows each pack with its free places and who's in it, the smaller suggested: press its Play.
3. **Join by the code:** in the third, type the code on Home, in any case and with or without its dashes, and press **Join**: the same Join screen.
4. **Pre-match:** each pack's list, with names, coats and Ready marks, over the pitch, where everyone warms up. **Add a bot** fills a place, and **Invite** shows the link and the code again. **Ready** has the focus, so Enter presses it; once both packs are full and every player is ready, a 5 s countdown starts, and then the match.
5. **The match:** the score, the clock and each kickoff's countdown, and a goal's scorer. Escape, or ☰, opens the menu: Settings and Leave; the match goes on meanwhile. A page reloaded mid-match comes back to its terrier, and a page that opens the link once it has started watches it, following the ball or a terrier.
6. **Results:** the final score, each terrier's goals and touches, the Terriest, and the network figures, with **Copy**. **Play again** takes everyone who presses it to the next match's Pre-match, its link the next; **Home** leaves.

Under `npm run dev:local` the relay is the local one, but each browser still asks `third-party.json`'s STUN servers for its public address, as a deployed page does; the screens offer no other choice. The dev server echoes the pages' console warnings in its terminal, such as three's note that `KHR_parallel_shader_compile` isn't supported, which are harmless. A Windows browser reaches WSL2's dev server, and so its relay, through `localhost`, as the network test page does (below). When something stops a match, the page says so: "Couldn't connect" after 20 s with no one reached, "A different version" when the others run another build, "This match has the most spectators it can take", or "The players have left".

## Test

```sh
npx playwright install --with-deps chromium firefox webkit   # once
npm run check
```

`npm run check` is the gate, and the definition of done. It runs before each merge to main, at each milestone's exit and before a deploy; a commit on a session branch runs `npm run check:commit`, the gate's lint, public-scan, typecheck and the unit tests but the whole-match replays (`npm run test:quick`, about a minute; `npm test` runs every unit test), and the end-to-end specs it adds or changes (PLAN Q-18). In order, it runs ESLint, with the plan's import and purity boundaries (D-38); public-scan; the typecheck; the unit tests, hermet's included; the build; and the end-to-end tests against the built page in headless Chromium, Firefox and WebKit. A page that requests anything outside the local servers its test names fails the test, so the gate contacts no public host: the networked tests use hermet's local Nostr relay on 127.0.0.1. At M3 it takes about 9 minutes on the development machine, and longer while the machine is busy: most of its unit tests' time is whole matches, the bots' and the network simulator's, played in virtual time, and one end-to-end test plays a whole networked match. It grows again at M4, whose end-to-end tests play matches through the screens (Q-18), and `docs/acceptance.md` logs its wall time at each milestone's exit.

Every end-to-end run starts `vite preview` on port 4339 and reads the one `dist/`, which a build rewrites. So when several sessions share the checkout, each build and each Playwright run, the gate's included, goes one at a time under one machine-wide lock, a build in the same locked command as the runs that read its `dist/`:

```sh
flock /tmp/terriest-e2e.lock npm run check
flock /tmp/terriest-e2e.lock sh -c 'npm run build && npx playwright test e2e/smoke.spec.ts'
```

M4 adds the screens' specs in each engine: `e2e/practice.spec.ts`, Practice through the screens, its whole match in Chromium and its controls in each engine; `e2e/screens.spec.ts`, Home, Settings and the messages a page can show alone; `e2e/pad-menus.spec.ts`, the screens by the gamepad alone; and `e2e/touch.spec.ts`, the touch controls and a phone held upright, in Chromium. From C-57, `e2e/camera.spec.ts`, in each engine, takes a player's camera behind its own goal and outside a side wall, in ball view and chase view, and reads what the glass walls and the goal's netting draw from there; and `e2e/pitch.spec.ts` adds the glass's own test, its outer draw as the camera crosses the end wall. In the `net` project, `e2e/match.screens.net.spec.ts` plays a 1-minute match through the screens between Chromium, Firefox and WebKit, proposed, joined by link and by code, watched and reloaded, to one Results; `e2e/watchers.net.spec.ts` a networked Pre-match's bots and invite and its spectators up to the cap; `e2e/room.net.spec.ts` a stale build refused and the leave prompt; and `e2e/duplicate.net.spec.ts` one player ID on two pages. At M3 there were 20 end-to-end tests in each engine, and one more that runs once: `e2e/boot.spec.ts`, the boot page's four failure messages (D-30); `e2e/determinism.spec.ts`, the golden runs replayed through the built page (below); `e2e/pitch.spec.ts`, the empty pitch, its size, its render quality, what assistive technology reads of the started page, and its frame rate, which is reported, never judged; `e2e/smoke.spec.ts`, the page served by `vite preview`, under `dist/_headers`, and from a subpath; `e2e/nettest.spec.ts`, the network test page's edges: a normal page loads no test page and no Trystero, a refused address contacts nothing, and the page carries the build hash of the sources it was built from; and `e2e/practice-net.spec.ts`, Practice played to the bot's first confirmed goal with no peer connection, WebSocket or outside request, in Chromium only, so it's skipped in the other two. `e2e/match.net.spec.ts` runs once, in the `net` project: a scripted 1-minute match through the network test page between Chromium, Firefox and WebKit over the local relay, a fourth page joining as a spectator and WebKit's reloading mid-match, to one confirmed end on all four. `npm run e2e` runs them alone, against the last build.

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

### The network test page

`#test=net` plays a match without the screens, for the end-to-end tests, the load run and the checks by hand ([M3's design](research/m3/DESIGN.md) §7): over Trystero and the one Nostr relay its address names, or over Practice's local transport, which contacts nothing. Each page drives its own terrier with a script, and may host bots. It draws nothing, and shows a status, refreshed every half second: its peers, its ticks, the score, the state's hash at a whole second's final tick, so that two windows can be compared, and its late inputs, disagreements and resyncs. Its parameters follow `#test=net&`:

| Parameter | Meaning |
|---|---|
| `room` | the match ID, such as `TERR-1EST-DESK-T0PM-3000-4` |
| `relay` | the only relay, a `ws:` or `wss:` URL. A built page takes only `third-party.json`'s relays, or a `ws:` relay on this machine; under `npm run dev:local`, leave it out for the local relay |
| `ice` | `default`, `third-party.json`'s STUN servers; `none`, no STUN server; or `local`, the end-to-end tests' loopback. `local` when `relay` is given, else `default` |
| `role`, `pack` | `keeper` proposes the match, and plays in `pack`, 0 or 1, or watches without one; `player` plays in `pack`; `spectator` watches |
| `packSize`, `minutes` | the keeper's or Practice's match: 1 to 4 a side, 2 by default, and 1 to 10 minutes, 3 by default |
| `k`, `seed` | the page's player ID, made from both; seed 7 by default |
| `script` | the page's own input: `none`; `back` or `sideways`, the end-to-end setups'; or `brain`, the bots' brain |
| `ready` | the match tick at which the page presses Ready, once its terrier is in the roster; without it, never |
| `bots` | a pack for each bot the page hosts, such as `0,1` |
| `name`, `coat` | its name and coat: `P<k>` and coat k mod 8 by default |
| `mode` | `net`, or `practice`: the page in pack A and bots in every other place, with no `room`, `relay`, `ice`, `role`, `pack` or `bots` |

An address it can't take, a parameter it doesn't know or one given twice among them, gets a message saying what's wrong, and the page contacts nothing.

**Two browsers over the local relay:**

```sh
npm run dev:local   # the dev server, with hermet's local relay on 127.0.0.1
```

It prints the relay's port, then the dev server's address, http://localhost:5173/ unless that port is taken. A `#test=net` page there without a `relay` uses the local relay, whose address it builds from its own host name, so a Windows browser that reaches WSL2's dev server through `localhost` should reach the relay the same way, by WSL2's localhost forwarding. No run has tested that yet, so it's the first suspect when a Windows browser's page shows no peer: `docs/acceptance.md` says how to tell. No public relay is contacted. With the default ICE, a deployed page's, each browser also asks `third-party.json`'s STUN servers for its public address; with `ice=none` it asks none, and the pages contact nothing outside this machine. `docs/acceptance.md` gives the two addresses of M3's check by hand, a keeper and a player at 1 a side, each terrier driven by the bots' brain, with the default ICE. Until the owner's run, `e2e/dev-local.run.ts` stands in for it, playing that match between headless Chromium and Firefox with `ice=none`:

```sh
GALLIUM_DRIVER=d3d12 npx playwright test -c playwright.dev-local.config.ts e2e/dev-local.run.ts   # starts npm run dev:local itself
```

The config takes every `e2e/dev-*.run.ts`, so without a path it also plays `e2e/dev-practice.run.ts`, Practice through the screens to its first goal on the dev server.

`GALLIUM_DRIVER=d3d12` puts the engines on WSL2's GPU path (below), as M3's design §15 has that run take it; the network test page draws nothing either way.

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

## Measure the network

M3's two measurements stay off the gate: they take minutes, want a quiet machine, and write into the repo only on purpose.

### The correction measurement

How far a rollback moves what you see (D-16): seeded bot matches of real sessions over the network simulator, in Node, at every pack size, 30, 80 and 150 ms one way with 20 ms of jitter, d = 2 and 3, and loss at 0, 0.1% and 0.5% of messages, 72 profiles and 336 matches, with four partial meshes, 24 matches more, reported beside them; then a forced repair, timed 20 times, for the spread cap (D-11). [research/corrections/REPORT.md](research/corrections/REPORT.md) holds its method, committed before anything was measured, its results, and what they decided: d, the glide, w and the cap. Its section 1.12 says how it runs: from the repository's root, at the method's commit with the tree clean, every run writing its file outside the repository. In one process, on a quiet machine:

```sh
OUT="$(mktemp -d)"
TERRIEST_CORRECTIONS_OUT="$OUT/results.json" npx vitest run --config dev/corrections.vitest.config.ts
```

Or the profiles run in seven processes at once, each with its own file, then the cap check alone, then a merge of the files, as the report gives it. M3's measurement ran that way: the seven processes took about 25 minutes, the slowest one's time, and each round of the cap check under a minute alone. One process hasn't been timed. Once the last run is done, its files are copied unmodified from `$OUT` into `research/corrections/` and committed together, so no commit falls between runs. Each file records the commit, the trees of `src`, `dev` and `scripts` there, and whether the tree was clean, and a run counts only at the method's commit with the tree clean, or at a later commit with the same three trees.

`TERRIEST_CORRECTIONS_OUT` names the file a run writes. Without it, a run writes `research/corrections/results.json`, and refuses to overwrite it, so while that file is committed a bare run stops at once. `TERRIEST_CORRECTIONS_ONLY` runs only the profiles it names, such as `pack2-80ms-d2-loss0` or `pack4-*`, and `cap` for the cap check; `TERRIEST_CORRECTIONS_SEEDS` and `TERRIEST_CORRECTIONS_CAP_RUNS` cut the seeds and the cap check's runs, for a smoke run, which decides nothing; `TERRIEST_CORRECTIONS_BASE` measures from settings other than `src/config.ts`'s, as a rule's next w or cap is measured; and `TERRIEST_CORRECTIONS_MERGE` measures nothing, deciding from the files of runs made in several processes. The matches run in virtual time, so a busy machine only slows them. The cap check times Node, so it runs alone, with no gate or other vitest running: its file records the machine's 1-minute load, and it decides nothing unless that was under 1 before its first run and under 2 after its last. On WSL2 that's the virtual machine's load, which doesn't see Windows', so Windows is kept idle too. `dev/corrections.measure.ts`'s header lists the variables.

### The load run

12 Chromium pages on this machine play one 3-minute match through the network test page over the local relay: 8 players at 4 a side, each driven by the bots' brain, and 4 spectators, measured for 90 s of play. It checks that every page is connected to the other 11 at the start and the end of the play measured, and that all hold one state, and logs each page's late inputs, resyncs, steps a tick, CPU a timer run and traffic by message type.

Start it on a quiet machine: the 1-minute load under 1 and nothing else running, and on WSL2 the Windows side idle too, since WSL2's load doesn't see Windows'. 12 pages in one browser pass about 5,000 messages a second between them, and the machine may deliver fewer than they send: then every page hears the others late, and the run fails for the machine rather than the protocol. In M3's measurement it did, after an hour of CPU-bound runs, though the load was under 1 when each run began ([research/corrections/REPORT.md](research/corrections/REPORT.md) section 2.7). A cold first run may show some late inputs, disagreements and resyncs and still pass, its backlog flat, as the first of M3's A/B runs did.

```sh
npm run build && TERRIEST_LOAD_OUT=research/load/results.json npx playwright test -c playwright.load.config.ts
```

It refuses to run without `TERRIEST_LOAD_OUT`, which names the file its raw reports go to, and `LOAD_SECONDS` sets the play it measures. It also watches the backlog: every 2 s of the play it reads each page's report, and `dev/load/backlog.ts` works out each receiver's backlog, how many more TICKs its senders have sent it than it has taken since the first poll, in seconds of their output by their own ticks. It's summed over the receiver's senders, so one link alone behind shows at its share. Each page's line ends with its largest backlog; the last line gives the largest of all, whether and when one passed d + w (0.233 s), when the first late input showed, the intervals it left out, with the mesh not whole through them, and the machine's 1-minute load; and the file holds every poll. When a check fails, its message starts with what the backlog shows: a backlog past d + w no later than the first late input means the rig's message path fell behind first, the machine's capacity rather than the protocol's; inputs late before that, and the message says how many, and that the watch can't tell which failed first. `docs/acceptance.md` logs its runs.

## Build

```sh
npm run build   # emits dist/, a fully static folder
```

It typechecks, builds with Vite, and writes the bundled packages' licence notices to `dist/THIRD-PARTY-LICENSES.txt`. Then hermet's dist audit checks `dist/`: relative references only, no host outside `third-party.json`, no secrets, only allowed file types, and exactly the expected notices, each with its licence text. terriest's own check after it fails a `dist/` that would ship `npm run dev:local`'s relay (`scripts/dev-relay-audit.mjs`).

## Deploy

```sh
npm run deploy   # the gate, then wrangler deploy
```

It deploys `dist/` to Cloudflare Workers static assets, at terriest.com: assets only, with request logs, the `workers.dev` address and Preview URLs off (`wrangler.jsonc`). wrangler signs in with its stored login, with no API token, and `wrangler login` renews a lapsed one at a browser (Q-6). Nothing is deployed yet, and every deploy waits for the owner's go-ahead.

**The first deploy** makes terriest.com a Workers custom domain, which replaces any A, AAAA or CNAME records the name has, and any Workers custom domain on it (Q-5). Before it, the owner lists those from the Cloudflare dashboard, and the go-ahead names what will be replaced. Run without a terminal, as Claude runs it, wrangler replaces them without asking; in the owner's own terminal, it asks first. That deploy also checks that the zone is on the account this machine deploys with.

## Privacy

No accounts, analytics or tracking.

- **The game's page** contacts only the server it's loaded from, and the gate fails a page that requests anything else, until you propose or join a match: opening a `#join=` link or entering a code counts as joining.
- **A match with others,** through the screens, uses `third-party.json`'s relays and any you add in Settings, and under `npm run dev:local` the local relay alone; it asks `third-party.json`'s STUN servers for the browser's public address, and uses your TURN server if you add one. The network test page uses the one relay its address names: in a built page, one of `third-party.json`'s or one on this machine, so a link can't send a browser to any other; under `npm run dev:local`, the local relay. With `ice=default`, its default only when no relay is given, so under `npm run dev:local`, it also asks the STUN servers; with `ice=none` or `ice=local`, none. These see the following (PLAN §20; the relays and STUN servers are in [third-party.json](third-party.json)):

| Who | Why | What they see |
|---|---|---|
| The six public Nostr relays, and any you add in Settings; the network test page uses only the one its address names | signalling, so browsers can find each other | your IP address, Origin, User-Agent and timing, a hashed room topic, a Nostr key and Trystero peer ID made for each page load, and the sizes of encrypted session descriptions |
| stun.cloudflare.com and stun.l.google.com | STUN: your public address, for direct connections | your IP address and port |
| Your own TURN server, if you add one in Settings | relaying between browsers that can't connect directly | your IP address and traffic volume |
| The other browsers in the match | the game | your IP address, player ID, name, coat and inputs; your build's hash, your role and the timeline you hold (its ID, kind, tick and hash); and which other players your browser is connected to |

- **Practice** contacts no one: no relay, STUN server or other browser (P10), which `e2e/practice.spec.ts` checks through the screens and `e2e/practice-net.spec.ts` through the network test page, with `mode=practice`. It sets no `#join=` fragment, so a reload goes Home and contacts no one either.
- **Hosting:** once deployed, Cloudflare serves terriest.com. It sees each HTTP request, never the `#join=` fragment, and request logs are off.

## Licence

None. All rights reserved: this repository is public so it can be read, but no licence is granted to use, copy, modify or distribute it. Bundled third-party packages keep their own licences. Their notices, with their texts, ship in `dist/THIRD-PARTY-LICENSES.txt`: three's from M1, and Trystero's and `@noble/secp256k1`'s from M3.

## Known limits

- **Safari may delete stored data** after 7 days without a visit (C-14): the player ID, name, coat and settings the game keeps from M4. Only a re-typed name and coat are at stake.
- **Real Safari is unverified.** Playwright's WebKit stands in for it in the gate. If the device round before M5 names a Mac or an iPhone, the determinism page and one match run on it before release (Q-12).
- **Phone performance is unverified** while the Pixel 8a's run is pending (Q-13).

## Windows: the Sticky Keys shortcut

Shift is zoomies. On Windows, pressing Shift five times opens the Sticky Keys prompt. The prompt takes focus, so every key is released and your terrier stops until you dismiss it (C-52). To turn the shortcut off:
- **Windows 11:** Settings > Accessibility > Keyboard > Sticky keys, then turn off **Keyboard shortcut for Sticky keys**.
- **Windows 10:** Settings > Ease of Access > Keyboard, then clear **Allow the shortcut key to start Sticky Keys**.
