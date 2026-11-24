# terriest: Plan

**Status:** approved by the owner on 2026-11-15, at its defaults.
- *The owner, 2026-11-15:* "defaults". So Q-1, Q-2 and Q-20 are settled at their proposals, and every Group B proposal is confirmed. REQUIREMENTS.md is amended as §2 says, except the rows that wait for a later step.
- *The owner, 2026-11-14:* desktop browsers are tested by hand for now, and no more devices are asked for yet (Q-4).
  - So your desktop browsers are the real-browser check from M0 on, and the headless gate still runs all three engines.
  - The phone, a third device and a gamepad come up again before M5, as Q-4 proposed.
  - REQUIREMENTS L342 and L345 ask for the phone early, so until it runs, the drawing budget stays provisional (C-2).
- *The owner, 2026-11-14:* the domain is terriest.com, on Cloudflare (Q-5). Deploys use wrangler's stored full login (Q-6). Make hermet's licence fix and push it (Q-3): done, pushed to hermet's main as 11283ca. roslambo and amorfus take it, as Q-20 proposes.
- M0 finished on 2026-11-16: see [research/spike/REPORT.md](research/spike/REPORT.md). Its amendments are marked "M0", in §0, §2–§5, §7, §8, §12, §16, §17 and Appendix A.
  - The five correctness conditions of its stop rule passed. The cost condition fired narrowly, on the tick timed while the page draws (§17).
  - The cost revisit that condition asks for kept D-3's and D-5's settings: 4 substeps, 8 iterations, 2 position passes and the floor in the solve. No cheaper setting kept §16's tests green with every drawn run under 4 ms, though two calls were close (D-3, D-5).
  - Run 6, the frame verdict on your desktop GPU, came back from you the same day: PASS, on ANGLE's Direct3D 11 path with the Intel Iris Xe. Your report covered one load and didn't name its browser or quality, so the other loads stay open under §17's rule for attended steps (research/spike/REPORT.md §7). On 2026-11-17 Claude settled them provisionally, headless on C-6's GPU path: Chromium and Firefox passed (`docs/acceptance.md`). They stay yours to confirm before the deploy.
- M1's local exits were met on 2026-11-17, on the branch `m1-skeleton-gate`. A clone made with `--recurse-submodules` builds, and `npm run check` is green in about 76 s (`docs/acceptance.md`). Its first CI run passed on 2026-11-18, when you pushed it with M2: every engine draws on the hosted runner, so CI runs the full gate (§15, `docs/acceptance.md`). hermet's docs naming terriest are on hermet's main, which you merged and pushed on 2026-11-17 (7a0ed8d); terriest's pin stays at 11283ca, since that commit changes only wording. Its amendments are marked "M1", in §1, §3, §4, §15–§17 and Appendix A.6.
- M2's local exits were met on 2026-11-17, on the branch `m2-simulation-core`: the simulation core, its goldens and canary, the bot brain and the tuning page. Every simulation test and golden is green in Node and in Chromium, Firefox and WebKit, the bots reach their marks, and `npm run check` is green in about 2 minutes (`docs/acceptance.md`). Its amendments are marked "M2", in §0–§8, §14–§18 and Appendix A.
  - **The tuning:** you chose "settle" for Q-10, so Claude set M2's values by measurement, by a method committed before anything was measured ([research/tuning/REPORT.md](research/tuning/REPORT.md)). Two values change: the goal netting's bounce is 0, not 0.3, so a shot into the goal stays in the net (C-48), and the push assist is on at 9 m/s, so pushers side by side beat one pusher in ball view (C-18). The other eight keep their starting values. All ten, and C-18's marks, are provisional and owner-pending (`docs/acceptance.md`): you confirm or change them before the deploy (§17). REQUIREMENTS' TBDs and its two lines on the netting wait for your sign-off (§2).
  - **Worth your eye:** in bot matches the ball bowls terriers over 5.2 to 6.5 times a minute of play, against 0.3 pounce tumbles a minute. The bowling speed, REQUIREMENTS' 4 m/s, sets that (C-5, Q-8).
  - You pushed main with M1 and M2 on 2026-11-18, and the first CI run passed (§15).
- M3's local exits were met on 2026-11-20, on the branch `m3-timeline-networking`: the timeline with its votes and resyncs, the protocol, the session with its admissions, forwarding, merges, returns and stalls, the Trystero, loopback and local transports, bot hosting, Practice, the `#test=net` page with its specs, and the correction measurement. P1–P5 and P7–P10 are green, the scripted match plays to one confirmed end in Chromium, Firefox and WebKit with a spectator joining and a page reloading, Practice contacts nothing, the 12-page load run passes, its failed runs in the measurement traced by a diagnosis to this machine's message path rather than the code, and `npm run check` is green in about 9 minutes (`docs/acceptance.md`). M3's design is kept as [research/m3/DESIGN.md](research/m3/DESIGN.md), which the code's "M3's design §…" cites; where the build differs from it, these amendments say so and win. Its amendments are marked "M3", in §0–§9, §12, §14–§18, §20 and Appendix A.
  - **The measurement:** by a method committed before anything was measured ([research/corrections/REPORT.md](research/corrections/REPORT.md), 0ab6b24, amended before too, at 71bd4a7, with no rule changed), d stays 2, by rule 1; the glide is 200 ms, and 100 ms for your own terrier, by rule 2; w = 12 is confirmed, by rule 3, so the goldens stay; and the spread's cap is 14, which the cap check's rule set once 42, 31, 20 and 18 had failed it (D-11, D-16). None of these is an attended step: D-16 and §17 have them chosen from the measurement, and M4's bench checks the glide.
  - **The load run** passes at the final tree: through 90 s of play the 12 pages kept their 11 peers each and one hash, with no input late, no disagreement, resync or clock jump, and no receiver more than 0.02 s behind its senders (§16). In the measurement, at 71bd4a7, it had failed, in both 90 s runs and a 20 s diagnostic: the pages' clocks fell to 33–45 ticks a second, 22–33% of the inputs came late, and their states diverged. A diagnosis found the machine's message path behind that: the 12 pages in one Chromium took 3,300–3,800 TICKs a second of the room's 5,100, so every receiver fell further behind than the late window. An A/B of 4da2086, 71bd4a7 and b43b154 then passed nine runs of nine, cool and hot, so the code is cleared; what slowed the path then, after an hour of CPU-bound runs, wasn't recorded. The run now watches each receiver's backlog, and a run that fails says whether the path fell behind before any input came late, or that it can't tell (§16).
  - **Yours, before the deploy:** the loss reach (C-55). Past 65.6 ms one way at d = 2, 71.1 ms at d = 3, each packet lost on the reliable channel costs its receiver a resync, and a blocked pair's forwarded inputs reach 80 ms a hop. The options are w = 12 with that residual, w = 14, w = 16 with a protocol version 2, the unordered input channel, and TURN for a blocked pair; w stays 12 until you pick. Whether roslambo takes the three fixes below (C-56). And the desktop connection, settled provisionally in headless Chromium and Firefox through `npm run dev:local`, and owner-pending: your own two browsers make it before the deploy (§17).
  - **Worth your eye:** roslambo, which M3 ports, has three faults M3 found and fixed in terriest's port. Its tick clock jumps the whole median offset with one peer, so two people's pages at 1 a side can swap sides every second after a freeze (D-15). Its flood count goes by arrival, so a backlog over about 252 TICKs, after a freeze or a stalled link of about 4.2 s, closes honest connections about 1.8 s after it lands, and its transport then refuses that peer for good (§9). And it takes every round trip as the one-way delay, so one pong a freeze held moves its clock by half the freeze (C-12). roslambo isn't touched: whether it takes the fixes is yours, and a change to it waits for your go-ahead (C-56, §17). The load run's diagnosis cleared the round-trip fix of its failure, and found a milder residual a port would take with it (D-15).
  - **The gate** grew from about 2 minutes at M2 to about 9 minutes, against the 4.7–5.2 minutes M3's design estimated: whole networked matches in the unit stage, about 3.9 minutes of it, and the three-engine match, about 2.4 minutes. Nothing was cut (§16). A profile of the test harness's own costs, not its seeds, is an option for later, yours. On 2026-11-20 you chose Q-18's alternative: the full gate before `/merge-to-main`, at each milestone's exit and before each deploy, and `npm run check:commit` before each commit (Q-18). On 2026-11-21 you moved the whole-match replays out of `check:commit` into the full gate (Q-18).
- *The owner, 2026-11-22:* "If it does not disrupt development too much, I would like to deploy a version ASAP"; terriest.com has no DNS entries; skip the relay check; an early version is OK. So main at a6b66c7, M4 through its phase 2 with the plexiglass walls (C-57), went to terriest.com that day by `npm run deploy`, the full gate and then wrangler, and replaced no records (Q-5).
  - It went before the relay check (Q-14) and before M0–M4's attended steps have landed, which M5's release still waits for (§17). C-55's choice and the phone's runs are yours still, and with no TURN a pair whose networks block a direct connection can't meet.
  - What it serves, and the hosted runner's first run of M4's specs, are in `docs/acceptance.md`.
- *The owner, 2026-11-22:* "go with the recommended set", of the logo and icon candidates Claude drew from the game's own code-built terrier: one dog, coat 6 in pack A's bandana, its face at the small sizes and the whole terrier where there's room. The logo isn't on Home yet; whether it goes there is yours still.
  - **The tab icon:** the head-on face, as `public/favicon.ico`, at 16, 32 and 48 px, the 16 tuned by hand, and `public/favicon.svg`, which shows a light outline on a dark tab. An SVG shown as an image sees no screen resolution, so an engine that takes the SVG shrinks its 32 px on a 1x screen rather than taking the hand-tuned 16.
  - **The phone's home-screen icon:** that face on a full-bleed square of the pitch's green, `public/apple-touch-icon.png`. `index.html` links all three relatively.
  - **The logo:** the same dog trotting, `docs/brand/logo.png`, and its lock-up beside the name in DejaVu Sans Bold, `docs/brand/lockup-light.png` and `lockup-dark.png`, which open the README. None of the three ships.
  - **A new look draws them again:** the look is provisional until you pick one (Q-11), so `dev/logo.html` draws them from the drawer in the page's look, `PAGE_LOOK`, and `e2e/logo.run.ts` writes the files (README, Draw the logo).
- *The owner, 2026-11-22:* "Give the robot dogs robotic dog names." So each bot takes a robot dog's name from a list of 32, Subwoofer to Data Hound: the one a hash of its ID picks, or the next on the list that no other terrier in its match has, a person's name included, as far as its host can see. "Bot" and four hex digits, the name it had, is left for a list all taken, which a match never comes near (§14).
  - A web search, not a legal review, checked the names against famous robot dogs, famous dogs and robot-dog products. It left off five first proposed, Sparky (Five Nights at Freddy's), Bolt (Disney's), Servo (Rescue Bots), Chip (WowWee's CHiP) and Axle (the film A.X.L.), and Subwoofer, Wirehair, Sensor, Circuit and Coil took their places.
  - **Yours to strike:** the borderline names it kept. Rover names Lunar Jim's robot dog, Battle of the Planets' as 1-Rover-1, a car marque and a pet-sitting firm; Rusty, robot dogs in two comics; Byte is a letter short of Bytes, Rusty Rivets' robot pup, and Dynamo close to Hanna-Barbera's Dynomutt; Sprocket names Fraggle Rock's dog, if not a robot, as Bolt does Disney's; and Pixel, Volt, Nano and Turbo are words other firms hold as marks, Google's phones and Chevrolet's car among them. Swapping one changes the list alone: every test works its names out from `BOT_NAMES`, the screens' fit checks included.
  - Two pages that add bots before either's JOIN reaches the other can still pick one name, and a person can still join under a bot's (§14).
  - **Yours too:** no screen says which terrier is a bot any more, as the name "Bot" and four hex digits did: Results' rows know which are bots and draw nothing of it. Whether a bot's row should say so, as yours says "you", is your choice (§14). You chose a robot's head for its swatch on 2026-11-23 (below).
- *The owner, 2026-11-23:* "M1", the recommended of the bot marks Claude drew on the real page and compared side by side: the antenna swatch. So wherever a row names a terrier, in Pre-match's pack lists, Join's lists, Results' table and a spectator's follow choice, a bot's swatch is a robot's head: one inline SVG in the swatch's own 18 × 18 box, with a ball-topped antenna and an ear on each side, filled with the coat's two colours as the swatch shows them, or in the follow choice the pack's colour, striped for Orange. Its outline, ears and antenna take the text's colour, so they hold on a pressed follow button and in forced colours. A person's swatch is as it was: a coat's round swatch in the lists, its pack's rounded square in the follow choice. After a bot's name, " bot" in visually hidden text, so a screen reader hears "Sensor bot". This replaces M4's design §5.7's "Bot" and four hex digits as a bot's only mark (§14).
  - It takes no width, so every row keeps its lines and height. In the comparison, a "bot" tag after the name, or a robot icon, gave 16 or 10 rows an extra line and pushed Pre-match's Blue pack heading out of view at 640 × 360.
  - The row fix tried for those two, which starts a wrapped line under the name, isn't built: it added a line to some long-named people's rows, and the head doesn't need it.
  - Changed from the shots: a 1 px gap, where the row's ground shows, now parts the head's outline from its fill, since a white coat's head was a white silhouette whose outline merged with its fill. The edges of the outline, its ears and antenna, and of the fill also sit on whole and half pixels, the antenna's stalk 2 px wide where the shots' was 1.5, so at a device scale of 2 every edge is sharp, and at 1 the gap and the stalk are clean lines.
  - The head is a shape, not a word: only a screen reader hears "bot". In forced colours a bot's head keeps its fill while a person's swatch goes blank, as the browser treats an SVG's fill.
- *The owner, 2026-11-23:* "Make sure the page has open graph metadata so links to the game show up well." So `index.html`'s head carries the link previews: a description, Open Graph's title, description, site name, type, address and card, X's large card, the canonical address and the theme colour, the game's own ground. Their URLs are absolute, on https://terriest.com/, since an unfurler reads the page alone; the page itself never requests them, so it still works from a subpath (L232).
  - The card, `public/og.png`, 1200 × 630, is the logo page's (`dev/logo.html`): the trotting terrier and its lock-up on the page's ground, with "Two packs of small dogs. One giant ball." below, made only of what you had picked, so a new look draws it again. The terrier and the name sit in the middle square that a square thumbnail keeps.
  - The dist audit takes the site's own address, which the tags name, as a stated exception (`scripts/audit-dist.mjs`' `ignoredHosts`), not a third party in `third-party.json`.
  - `e2e/link-preview.spec.ts` reads every tag from the built page in each engine and fetches the card from the page's own server; `e2e/lib/link-preview.test.ts` reads `index.html` itself.
  - The description is Claude's, from the README's pitch without naming another game: "Two packs of small dogs corral a giant rubber ball into goals. Play in your browser against bots, or with friends by link, up to 4 a side." Yours to change.

**Date:** 2026-11-14; approved 2026-11-15.
**Answers:** the "First deliverable" section of [REQUIREMENTS.md](REQUIREMENTS.md), at commit 6254a1d.
**Line numbers:** an L-number counts REQUIREMENTS.md's lines at 6254a1d. §2's amendments (06e3ba4) added a line after L286, so from L287 on, each line is one further down in today's file: L306 is today's line 307 (M1).

How to read this:
- **§0** summarises the plan.
- **§1** is the questions for you (Q-n). All are settled: Q-3 to Q-6 on 2026-11-14, and the rest at their proposals on 2026-11-15.
- **§2** lists the requirement wording that your answers would change.
- **§3** is the conflicts and realism register (C-n).
- **§4** is the design decisions (D-n), each with the options rejected and the cost if it's wrong.
- **§5** is the evidence.
- **§6–§15** are the design, **§16** the tests, **§17** the milestones, and **§18–§21** the notes, traceability, third parties and deferrals.
- **Appendix A** holds the state layout, input bits, storage schema, constants and pinned versions.

Approval needs only §0–§4. As in roslambo, once the plan is approved a Q, C, D or M number is never reused: a settled item keeps its number and records what settled it.

Many decisions are roslambo's, unchanged. Those cite roslambo's PLAN.md by number ("roslambo D-7") and say only what differs; the full reasoning is there.

---

## 0. Summary

**Core idea: roslambo's deterministic timeline, with a 3D physics core of its own.**
- Everything that matters is a pure function of the match's settings and the stream of inputs, tick by tick: joins, packs, Readys, countdowns, every push, bounce, tumble and goal, and the clock.
- Peers exchange inputs and vote with a hash of the state they computed. The losing side copies the winner's state. This is roslambo's timeline, consensus, session and protocol, adapted.
- What's new is the simulation (3D spheres, capsules and planes, resting and rolling contact, a non-convex pitch), the three.js rendering behind one replaceable terrier drawer, anchored steering on three input devices, packs, a ball everyone fights over, bots that play a team game, and an offline Practice.

**The stack:**

| Area | Choice |
|---|---|
| Simulation | Pure TypeScript. 60 ticks a second, 4 physics substeps. float64 with exact operations only, enforced by hermet's lint. Headings are binary angles, with roslambo's sine and cosine and a new exact `datan2`. A sphere for each terrier and the ball, contact impulses by Gauss–Seidel over mirror pairs, the floor as support. |
| Timeline | roslambo's rollback lockstep: a 2-tick input delay, a 12-tick late window, then final. Re-simulation starts from the earliest changed tick. |
| Consensus | roslambo's: every TICK carries a hash of the sender's newest final state; the state with the most votes wins, smallest hash on a tie; the loser fetches the winner's state. Goals and the end show only once the vote confirms them. |
| Networking | Trystero 0.26.0 over Nostr, unpatched, through hermet's room-config builder. roslambo's six relays and two STUN servers; TURN only if the user brings one. Full mesh, with forwarding. |
| Rendering | three.js with its WebGL 2 renderer. Terriers drawn by one replaceable part: built in code now, modelled later. Screens are DOM. |
| Input | Keyboard by key position, a touch stick and buttons, a standard gamepad. Anchored steering: directions relative to the ball in ball view, kept on the pitch in chase view. |
| Sound | Effects synthesised with Web Audio. No files. |
| Persistence | localStorage: player ID, name, coat, settings and control hints. One game tab per browser. |
| Build | Vite 8, TypeScript 6.0, ESLint 10, vitest, Playwright with Chromium, Firefox and WebKit, and the gate tooling in `vendor/hermet`. |
| Hosting | Cloudflare Workers static assets: assets only, request logs off. |

**What it reuses** (§4 says what changes in each):
- **From roslambo**, nearly everything but the game: the match ID (`round-id.ts`), the timeline, session, protocol and Trystero transport, bot hosting, the room config, storage and the tab lock, display names, the canary, goldens and the cross-engine determinism test, the frame-time bench, the tuning page, the look book's recording, the palette test, the relay probe, the end-to-end helpers over the local relay, `third-party.json`, `wrangler.jsonc` and the CI workflow, run under `xvfb-run`.
- **From amorfus:** the boot page that never goes blank, with tested failure messages; tests that go through the real page and its buttons, not test modes; the request guard that checks nothing was contacted; the subpath check; the `_headers` file, and the strict static server that tests the build under it.
- **From hermet**, as a submodule: public-scan, the dist audit, the licence notices, the exact-ops rule, the ESLint and tsconfig bases, the local Nostr relay and the room-config builder.

**Approval changes these requirements** (exact wording in §2, applied in one commit after you answer):
- The example match ID, "majority", who broadcasts inputs, and the 32-byte name limit match what roslambo actually does (C-15, C-16, C-17).
- Goals and the end show at the vote-confirmed tick, about 0.4 s after the ball crosses, and a celebration is held longer, so 3 s of it is seen. So a late input never takes one back; only a browser whose state diverged and that heard the deciding votes too late for its tally can, rarely, see one taken back, which C-4 accepts (Q-7).
- The bowling rule exempts a lunging terrier and the last to touch the ball, and its examples are restated (Q-8).
- Four pushers reach 95% of running speed in about 0.6 s only one behind another; side by side they're slower, and their times are tuned at M2 (C-18).
- The pitch's shape can still change, but keeps its point symmetry about the centre spot, which exactly mirrored kickoffs need (C-22).
- Chase view re-reads the screen only when a direction starts from neutral or moves 45° or more, by keys or stick, a change to your 2026-11-14 steering wording. A quick sweep of the stick then turns the terrier further than the stick moved. The alternative, re-reading only from neutral, turns it exactly with the stick, but keeps the screen as it was at the press (Q-19).
- The goal's netting is softer than the walls, so a goal bulges the net (C-48), and a goal has a whistle as well as its chorus (C-53).
- Rules the text leaves open are stated: what terriers may do in each phase, zoomies after an empty meter, the celebration and overtime order, a shared goal's credit, Practice's rules, abandoned matches from the start countdown on (so L282's reload needs another browser in the match), results for a browser that arrives at the end, a match of bots alone, Play again (one match for every press, full packs, late presses), the mesh cap counting browsers, and what "joins" means for contacting third parties.
- Smaller additions: the ball's turning on screen is drawing only; the tests serve the stand-in model; Settings gains render quality and "Show control hints again"; and the bandanas gain a pack cue, if you pick one (Q-11).
- The domain becomes terriest.com (Q-5), the TBD values become the ones you sign off, at M2 and the chase-view swing at M4 (Q-10), Q-14 fills in any relay swap, and the acceptance devices are named before M5, with each line's own conditions kept (Q-4).
- The notes for the plan on reuse, Trystero and the phone's cost are corrected, and the one on resting contact once M0 has measured it (C-43, C-44). **M0:** that one has gone in too (§2).

**Biggest risks:**
1. **Contacts.** Resting, rolling and simultaneous contacts under exact operations are new, and roslambo's integrator doesn't carry over (C-3). Pushers side by side barely beat one pusher, against L11's "together they get it moving sooner" (C-18), and a ball can come to rest on terriers (C-21). M0 tackles these first. **M0:** the solver passed all of M0's correctness conditions (C-3), and a 42° slip-out cone with a slipping flag brings a ball down off terriers, inside a window of only 42°–43.2° (C-21). Side by side, pushers beat one pusher in the pitch frame, but in ball view, the default, two abreast and four round the ball are slower than one (C-18). **M2:** the port moves M0's bodies by M0's bits, a slip release lets a terrier that slipped out brake again (D-5), and with a ball-frame push assist on, pushers side by side beat one pusher in ball view too (C-18).
2. **The phone is unmeasured**, CPU and GPU both. No more devices are asked for yet (Q-4), and they're asked for again before M5, so its first run comes at acceptance. roslambo's timeline also re-simulates its whole window every tick, which the requirements' cost note doesn't count, and a few single ticks, such as a late-vote repair, take up to about 270 steps (C-2). **M0:** in Chromium at 4× CPU throttle, a crude stand-in for the phone, the tick has no margin. On the scrum at the wall, a 13-step tick's p95 was 3.49–4.60 ms while the page drew, against a 4 ms ceiling, and no cheaper solver setting kept §16's tests green with every drawn run under it (D-5). A late-vote repair took up to 96 ms, so M3 spreads such ticks over several (C-2, D-11). **M3:** a changed base's steps are spread at 14 for each tick a timer run moves the clock, the drawn head held meanwhile. The cap check failed the starting cap of 42 in Node, and 31, 20 and 18 after it, and 14 stood: 20 forced repairs' median worst call, times M0's 6.3, came to 24.5 ms against 25 ms (C-2, D-11).
3. **Without TURN**, some pairs of networks can't connect (C-1, from roslambo). **M3:** forwarding covers a blocked pair up to 80 ms one way a hop, and past 65.6 ms one way at d = 2 each packet lost on the reliable channel costs a resync; the options are yours (C-55).
4. **The gate draws WebGL 2 in software**, at 5–26 frames a second for a busy scene. So end-to-end tests must never depend on the frame rate, and frame time is judged only by hand (C-6).
5. **hermet's licence notices shipped without their texts**, in roslambo's and amorfus's live builds too. The fix is pushed, as hermet 11283ca (Q-3), but each sibling still needs a bump and a redeploy (Q-20). And three.js has never been through hermet's dist audit (C-8, C-9). **M0:** it has now, and its one finding is cleared by an app option, with no hermet change (C-9).
6. **Real Safari is untested** on Mac and iPhone, unless the device round before M5 names one (C-7, Q-12).

**What approval authorises:** the decisions in §4 and every Group B proposal; M0, a throwaway spike that uses no network beyond installing packages; then M1–M5.
- It does **not** authorise pushing terriest, any further push to hermet (such as its docs naming terriest at M1), any change to roslambo or amorfus (Q-14, Q-20), deploying, or the relay check that writes to public relays. Each waits for your go-ahead (§17), and the first deploy's go-ahead names the DNS records it will replace (Q-5). hermet's licence fix is already pushed, at your request (Q-3).
- Steps that need you before M5 (M0's frame verdict, the tuning, your M3 and M4 desktop checks, the bots' level and the look) don't hold up the work. If you aren't free, Claude settles each provisionally, and you confirm or change it before the deploy (Q-13, §17).
- REQUIREMENTS.md is yours. Approving the plan accepts it as amended by §2. The edits went in on 2026-11-15, in one commit that cites the Q- and C-numbers, with the status line updated; four rows waited for later steps, and three still do (§2).

**Approved** on 2026-11-15, at its defaults, with the settlements recorded at the top of §1.

**What this rests on (§5):** your requirements; roslambo's, amorfus's and hermet's plans, code and reports; a two-round audit on 2026-11-14 that checked every claim the requirements make about them, probed WebGL 2 in the three headless engines here, and rebuilt both siblings to confirm the licence bug, then hermet's fix; and two reviews of this plan's drafts, which modelled the solver, the timeline and the cameras. Nothing in the physics or rendering has been measured yet. Every cost here is an estimate, labelled as one. **M0** has since measured both on this machine, run 6's frame verdict in one of your browsers included, though not the phone, and its numbers are marked M0 (§5).

---

## 1. Questions for you

**Settled on 2026-11-15:** the owner answered "defaults". So Q-1, Q-2 and Q-20 are settled at their proposals, and every Group B proposal, Q-7 to Q-19, is confirmed. Q-3 to Q-6 were settled on 2026-11-14; their rows, kept apart below, record how.

### Group A — settled on 2026-11-15 at these proposals

| # | Question | Proposal | Needed by |
|---|---|---|---|
| Q-1 | Licence, and whether the repo is public | As roslambo: public, no licence, all rights reserved. `package.json` says `"license": "UNLICENSED"`, the README says no licence is granted, and `public-scan` runs in the gate. Bundled packages' notices still ship (§20). | M1 |
| Q-2 | The match-ID code: a third copy, or one module shared with amorfus and roslambo? REQUIREMENTS L334 leaves this to you. | A third copy: roslambo's `round-id.ts` and its tests, renamed for matches, with its own Play-again prefix. The two existing codecs share the format, but sharing would change two finished apps and stretch hermet's charter, which is checks rather than app behaviour. A shared module can come later, as one change across all three.<br>**M1:** built as `src/core/match-id.ts`, with every roslambo test ported, and the documented example. One difference beyond the rename and the prefix: a link with a malformed `%` escape gives no match ID, where roslambo's router throws. | M1 |
| Q-20 | roslambo and amorfus: do they take hermet's fix now? Their live sites serve MIT and ISC code without its licence text (C-8). | Bump each to hermet 11283ca, add amorfus's missing notice for its vendored FastNoiseLite as an `extra` entry, run each one's gate, and redeploy each with your go-ahead, outside this plan's milestones. | any time |

### Group A, settled by you on 2026-11-14

| # | Question | Your answer, and what follows | Needed by |
|---|---|---|---|
| Q-3 | hermet's licence writer shipped no licence texts (C-8). May I fix it in hermet and push it? | **Settled 2026-11-14 by the owner: make the fix and push it.** Done: pushed to hermet's main as 11283ca, the same day.<br>• **In hermet:** its writer reads Vite 8's `identifier` and `text`, its test uses Vite's real output, and its audit fails a notice with no text. On both siblings' current builds, roslambo's 3 notices and amorfus's 5 then carried their texts, and the audit found nothing (§5).<br>• **terriest** pins 11283ca from M1, so it needs no shim. Naming terriest in hermet's docs waits until terriest mounts it, at M1, and that push waits for your go-ahead.<br>• **The siblings** haven't taken the fix yet: Q-20. | — |
| Q-4 | Devices, people and networks | **Settled 2026-11-14 by the owner: desktop browsers by hand for now, and no more devices asked for yet.**<br>• Your desktop browsers are the real-browser check from M0 on, and the headless gate runs all three engines.<br>• Acceptance still needs three devices, one of them the Pixel 8a, and a standard gamepad (L280, L284, L286). They're asked for again before M5, with real Safari (Q-12), as this row proposed.<br>• With the phone's measurements, you then choose whether phones start at the low render quality (D-33).<br>• Until the phone runs, the drawing budget is provisional (C-2). | asked again before M5 |
| Q-5 | Domain | **Settled 2026-11-14 by the owner: terriest.com, hosted on Cloudflare.**<br>• `wrangler.jsonc` routes it as a custom domain (A.7), as the workspace's site does gargantis.com.<br>• The `workers.dev` address is turned off, because it would show the account's name (C-45).<br>• That the zone is on the account this machine deploys with is checked at the first deploy.<br>• **Before that deploy,** you list terriest.com's current A, AAAA and CNAME records, and any Workers custom domain on it, from your Cloudflare dashboard, and the go-ahead names what will be replaced. Run without a terminal, as Claude runs it, wrangler replaces them without asking. Alternatively, you run that first `npm run deploy` in your own terminal, where wrangler asks first.<br>**First deploy, 2026-11-22:** you found no terriest.com records, so it replaced none, and wrangler attached terriest.com to the Worker as its custom domain. | — |
| Q-6 | How deploys sign in | **Settled 2026-11-14 by the owner: wrangler's stored full login.**<br>• `npm run deploy` uses it, with no API token.<br>• The login refreshes itself. If it has lapsed, `wrangler login` renews it, which needs you at a browser.<br>• Each deploy still waits for your go-ahead. | — |

### Group B — settled on 2026-11-15 at these proposals

| # | Question | Proposal |
|---|---|---|
| Q-7 | When does a goal show? (C-4) | At the vote-confirmed tick, about 0.4 s after the ball crosses, as roslambo shows its end (roslambo D-10).<br>• **At once,** from the predicted state: the net bulges. If a late input undoes the goal, the bulge blends out (D-16).<br>• **0.4 s later:** the score, the whistle, the scorer's name, and the celebrating animation of the pack the goal counts for, which blends in part-way through.<br>• **The celebration** is held 3.4 s in the simulation, so 3 s of it is seen. The end and the results also come from confirmed ticks.<br>• **Taken back:** a late input never takes a goal back. Only a browser whose state diverged and that heard the deciding votes too late for its tally can, rarely, see one taken back (C-4).<br>Alternative: show goals at the final tick, 0.2 s, and accept a goal undone on any peer whose final state loses the vote, not only on one that also heard the votes late.<br>**M3:** as built, the scoreboard latches each goal once its tick is confirmed and takes back exactly the goals a repair took away, by the final lineage's goal ticks (D-14). |
| Q-8 | The bowling rule (C-5) | **The rule:** a terrier is bowled over when the ball comes at it at the bowling speed or faster, measured in plan view: the ball's horizontal velocity along the horizontal line from the ball to the terrier, before the contact is settled.<br>• **Two exceptions:** a terrier in its lunge, and the terrier that touched the ball last. So a terrier is never bowled by a ball it's pushing or has just shot, even off a wall, and a pounce can meet an oncoming ball.<br>• **What remains:** a terrier chasing a ball that any other terrier touched last, a packmate included, can be bowled by its rebound. A ball dribbled at a run, about 6 m/s, bowls any other terrier in its way, packmates included, so only a lunging terrier can meet a fast ball safely.<br>Alternative: also exempt the packmates of whoever touched the ball last, so a pack's own push, shot or rebound never bowls its members, as a pounce never tumbles a packmate.<br>The bowling speed is tuned with you (Q-10). |
| Q-9 | How bots are accepted, "about a new player's level" (L142) | **Roles,** by distance rank within the pack: the nearest chases while no rival is nearer the ball; when a rival is nearer, it falls back to defend, getting between the ball and its own goal and meeting the ball from there (L142). The next supports behind the ball; the rest defend between the ball and their goal.<br>• **Reactions:** bots react after about 0.25 s, with aim noise seeded per bot, so mirrored bots diverge.<br>• **Pass marks,** in the gate, over 100 seeds each (§16 defines them): a lone bot scores into an undefended goal within 20 s in at least 95; a 2-a-side bot match at the default 3 minutes has a goal before the clock reaches 0 in at least 90; no bot is ever stuck for 5 s; and when a rival is nearer the ball, the pack's nearest bot is moving to get between the ball and its own goal within 0.5 s after its reaction delay, in at least 90 at each pack size. The marks' values are tuned at M2.<br>• **Your play test:** at M4 you play Practice against them and accept the level, or name a change to the reaction delay or aim noise (§17's rule for attended steps applies).<br>**M2:** the brain meets every mark at A.4's starting values, so none was tuned, and the marks' measures are recorded in §16 as built, the fall-back's restated so that a brain without it fails. For your play test, every mark also passes at reactions of 0.15 and 0.35 s and at aim noise of 5° and 15° (research/tuning/REPORT.md §2.3). |
| Q-10 | Tuning | Tuned together, as roslambo's Q-12 was, starting from Appendix A.5. The values go into the Configuration table.<br>• **At M2, on the tuning page:** the five simulation TBDs (kickoff spots, rolling slowdown, terrier bounce, re-arm gap, tumble guard), the terrier's collision size, the drive and friction, the goal netting's bounce, the bowling speed, and the marks for pushers side by side, with any remedy for them (C-18).<br>• **At M4, with the cameras:** the chase-view swing, a drawing value outside the state; and the turn rate, acceleration, pounce, bowling speed and tumble guard confirmed in ball and chase view. A change re-emits the goldens and re-runs Q-9's marks.<br>• **If you aren't free** when a milestone's other exits are met, Claude sets the values by measurement, as roslambo's Q-12 was settled, and you confirm or change them before the deploy (§17).<br>**M2:** you chose "settle" on 2026-11-17. Claude set the values by measurement, by the method of research/tuning/REPORT.md, committed before anything was measured: each value alone from its start, by a fixed rule, then the picks together. They're in `src/config.ts` and A.4–A.5, marked provisional, and owner-pending in `docs/acceptance.md`; a value REQUIREMENTS gives could only have been proposed, and none was. The tuning page, `dev/tuning.html`, is there for you to change them (§15). |
| Q-11 | The look | Placeholders until M4. Then a look book, as roslambo's, offers samples driven by recorded matches through the terrier drawer (§12), and you pick the terriers, coats, pack colours and patterns, the ball and the pitch. Every coat is checked against both packs for colour blindness, and the packs against each other. The look book shows each sample's counts against the drawing budget, and you pick among samples within it.<br>On the phone, a bandana is a few pixels tall at play distances (C-51), so the samples include a pack cue that keeps a minimum on-screen size and differs in shape between the packs, such as a marker over each terrier or a ring under it. If you pick one, §2's row adds it to L43's wording.<br>M5 builds the look you pick as the code-built drawer's default, before the release check (§17). If you haven't picked when M4's other exits are met, Claude picks one from the look book provisionally, and you confirm or change it before the deploy (§17). |
| Q-12 | Safari (C-7) | Playwright's WebKit stands in for Safari in the gate, with exact operations and the startup canary (D-23). Real Safari joins the device round before M5 (Q-4): if an iPhone or a Mac is named then, the determinism page and one match run on it before release; otherwise the README says real Safari is unverified. |
| Q-13 | What "done" means if the device runs slip, as roslambo's did | The MVP is done when the gate is green, the site is deployed, your desktop checks pass, and every line of REQUIREMENTS.md passes. Lines whose device run hasn't happened, whether the device is one you don't have or the run hasn't been made (the Pixel 8a's frame-time line included), stay marked pending in `docs/acceptance.md`, as in roslambo. So does a browser L236 names that hasn't been run, such as Firefox or Edge on the phone. While the phone's run is pending, the README says phone performance is unverified.<br>Your steps before M5 (M0's frame verdict, the tuning, your M3 and M4 checks, the bots' level and the look) don't hold up the next milestone: Claude settles each provisionally and logs it as pending, and each must land before the deploy (§17). |
| Q-14 | A relay that fails the pre-deploy check (L343) | Replace it with nostr.mom, roslambo's next choice, in terriest only, and offer the same swap to roslambo and amorfus separately. |
| Q-15 | Practice (C-30) | Resume appears in the match menu in Practice only. Opening the menu pauses Practice: play, the clock, animations and sound stop. Hiding the tab, or the page freezing for over 2 s, opens the menu. Resume, or closing the menu, carries on. Losing the graphics also pauses Practice, until they're back (D-30). A reload goes Home, because no peer holds the match. The player starts in the first pack; bots fill every other place, so Add and Remove a bot are hidden. Switch pack swaps the player with the other pack's newest bot, in one tick (D-22). Play again starts a new Practice with the same settings and contacts no one.<br>Alternative: the Practice screen also picks the pack, and Switch pack is hidden in Practice.<br>**M3:** built without screens (D-22): a networked match's timeline over the local transport, its start counted as a timer run, so a first run over 2 s late pauses it, and a timer run that finds the page hidden pauses it too. M4 adds the menu, and the pause while the graphics are lost. |
| Q-16 | Abandoned matches (C-31) | From the start countdown on, when no browser that controls a terrier is left, the match runs on for 30 s, so a player who reloads can come back. After that the browsers still there show "The players have left", with the score so far and **Home**. Before the start countdown, a match whose browsers all watch waits for players (L130, L163). L282 then reads "while another browser stays in the match".<br>**M3:** as built (D-17): "left" means no TICK for 30 s, direct or forwarded, from a browser whose ID or a bot derived from it is in the final roster; votes and PEERS don't count. Nothing is abandoned once the end is final, so Results show. |
| Q-17 | Keys on Pre-match, in the menu and on Results (C-34) | Keys and buttons outside the play set.<br>• **Pre-match:** the arrow keys or the d-pad move between its buttons, with Ready focused first, and Enter or Start presses the focused one. The pitch keeps the other keys, so Space only ever jumps there.<br>• **The menu:** Escape, or the gamepad's Back button, opens it on Match and closes it again; in Practice, closing it resumes. As on Pre-match, the arrows or the d-pad move between its buttons, and Enter or Start presses the focused one.<br>• **Results,** where nothing jumps: Play again is focused first, and the arrows or the d-pad move between Play again and Home. Enter, Space, Start or the bottom face button presses the focused one, but only for a press that begins at least 0.5 s after Results appears, so a jump held or mashed at the final whistle presses nothing. |
| Q-18 | Claude's own setup in this repo | Right after approval, in one sitting with you there (every write under `.claude/` asks you to approve it): amorfus's hand-written `.claude/` (session-branch rules, the guard against editing `main`, `/merge-to-main`, `/sync-with-main`), with a narrow allowlist for the gate's commands. A hand copy is lighter than claude-kit, which your workspace repo pins, but drifts from it. `CLAUDE.md` comes at M1.<br>**Its cost:** amorfus's rules run `npm run check` before every commit and again in `/merge-to-main`. terriest's gate plays whole matches one after another, each about 70 s or more at the 1-minute length (research/audit/REPORT.md §9), so it will take several minutes or more. **Alternative for that rule:** lint, typecheck and unit tests before each commit on a session branch, and the full gate before `/merge-to-main`, at each milestone exit and before each deploy.<br>**Alternatives:** claude-kit pinned at `.claude/vendor/kit`, as the workspace repo has it, with its core and session-branch slices. Its session-branch slice is amorfus's files generalised, and `kit check` keeps the copies matching the pin, but it adds a second submodule to the checkout and CI, the kit's core rules and hooks, and a memory index. Or no `.claude/`, as roslambo.<br>**M3:** at M3's exit the gate takes about 9 minutes, against M2's 2 minutes (§16). The alternative for that rule is still there, if you want it.<br>**Settled by you on 2026-11-20, at M4's start:** the alternative. A commit on a session branch runs `npm run check:commit` (lint, public-scan, typecheck and the unit tests) and the end-to-end specs it adds or changes; the full gate, `npm run check`, runs before `/merge-to-main`, at each milestone's exit and before each deploy. M4's design put the full gate at about 24–38 minutes (research/m4/DESIGN.md §9.9).<br>**Amended by you on 2026-11-21:** `check:commit` runs the unit tests but the whole-match replays (`npm run test:quick`, with `vitest.quick.config.ts`: every test in `src/net` but its unit files, the bot marks, `src/ui`'s freeze matches and the timeline's whole-match file), about a minute where every unit test took 5–8 on a busy machine. `npm test` and the full gate keep every one, and a commit that changes the simulation, the bots, the timeline, the session, the protocol or `src/net` runs `npm test` too. |
| Q-19 | Chase view's re-read (C-24): your 2026-11-14 wording reads the screen again whenever the stick moves to a new direction | The stick is sent in 32 steps a turn. Under that wording, any move of the stick to the next step, 11.25°, after the camera has swung re-reads the screen, so each small correction turns the terrier by the whole swing, bringing back the spin anchored steering was chosen to remove. Proposal: read the screen when a direction starts from neutral, or when it moves 45° or more from the direction last read; a smaller move turns the kept direction by the same angle. This changes only what the controls send (L76).<br>**Its cost:** a re-read while the camera is still swinging adds that swing, so a stick moved 45° or more turns the terrier further than the stick moved, by an amount that depends on the camera setting. In a model with D-28's camera, a stick swept 90° in 0.5 s turns the terrier about 135° (124° with the calmer camera), and your wording turns it about 146°. A stick circled at 0.5 turn/s turns it at 0.83 turn/s (D-29; research/audit/REPORT.md §9).<br>**Alternative:** re-read only from neutral. The terrier then turns exactly with the stick under either camera, but the stick keeps the screen as it was at the press: holding right, then rolling to up once the camera is behind, turns the terrier 90° left on screen.<br>Which is better can only be felt with a stick: a gamepad at M4, or the phone at M5. |

---

## 2. Requirement changes your answers would make

REQUIREMENTS.md is yours. These edits went in on 2026-11-15, in one commit that cites the numbers, at the defaults: Q-8's and Q-19's alternatives weren't chosen. Notes for the plan are not requirements, but they are your text too, so their corrections are listed here as well.

Four rows waited for a later step. One has gone in, and three still wait:
- the pack cue (Q-11, C-51), if you pick one at M4;
- the note on resting contact (C-44), once M0 had measured it: **applied after M0** (research/spike/REPORT.md §3);
- a relay swap (Q-14), if one fails the pre-deploy check;
- the tuned values (Q-10), at M2 and M4.
  - **M2:** settled provisionally by measurement on 2026-11-17 (A.5; research/tuning/REPORT.md), so this row waits for your sign-off. It then fills the five TBDs (kickoff spots, rolling slowdown, terrier bounce, re-arm gap, tumble guard), and, for the netting at 0, changes two lines (C-48). The values REQUIREMENTS gives, the acceleration and the bowling speed among them, passed their checks and stay.
    - The Ball bounce row's "The goal's netting keeps less, tuned at M2" becomes "The goal's netting keeps none of its speed into it, and all of its speed along it".
    - L58's "It bounces off the floor, the walls, the overhead net, the goal frame and the goal's netting. Each bounce keeps part of its speed into the surface and all of its speed along it, and it slows as it rolls" becomes "It bounces off the floor, the walls, the overhead net and the goal frame. Each bounce keeps part of its speed into the surface and all of its speed along it. The goal's netting keeps none of its speed into it, and all of its speed along it. It slows as it rolls". At 0 the netting no longer bounces the ball, so L58 would otherwise contradict the Ball bounce row (M2's review).

**M3:** none of M3's settings is a requirement, so M3 adds no row (M3's design §10). A change of w would move the confirmation delay, (w + v) ÷ 60 s, and so L202's "about 0.4 s after the ball crosses the line" (Q-7); a row here would then propose the new figure for your edit. The Goal celebration row's "3 s plus the confirmation delay" stays true at any w. Rule 3 confirmed w = 12 (research/corrections/REPORT.md section 2.1), so no row is proposed; a pick for C-55 that changes w brings L202's row with it.

**M4:** your decision of 2026-11-21, clear plexiglass walls with the players' cameras free to go outside them (C-57), changes two lines, applied with it: Cameras' L89 and Look and sound's L96, the last two rows.

| Requirement (current) | Amended wording | From |
|---|---|---|
| Status, the whole line: "Status: first draft, written from the README on 2026-11-13. … the rest is still a proposal. "(as roslambo)" marks … the settled questions." | "Status: settled by the owner on 2026-11-14 and amended by the approved PLAN.md; Q- and C-numbers cite it. "(as roslambo)" marks a rule carried over from roslambo's requirements or plan, which the owner approved there or left to Claude's judgment. **TBD** marks a value not yet chosen. After the requirements come the configuration, notes for the implementation plan, and the settled questions." | approval |
| Match ID: "Displayed in groups of four (`K7QM-2XDP-4TR8-WHZN-3VBC-7`)" | "… (`K7QM-2XDP-4TR8-WHZN-3VBC-K`)": the old example fails its own check character | C-15 |
| Match ID: "so presses at the same moment lead to the same match" | "so every press leads to the same match" | C-42 |
| Consensus: "the state held by the **majority** wins"; "The majority is counted among the votes received" | "the state with the most votes wins"; "The votes are counted among those received" | C-16 |
| Consensus: "Each player broadcasts its control inputs …" | "Each browser that controls a terrier broadcasts …" (a spectator hosting bots does too) | C-16 |
| Consensus: "Goals and the end of the match are taken from final ticks, so a correction never takes one back. A goal's score, whistle and celebration, including the terriers' celebrating animation, show once its tick is final, about 0.2 s after the ball crosses the line" | "Goals and the end are taken from ticks the vote has confirmed, so a late input never takes one back. A correction takes one back only on a browser whose state had diverged and that heard the deciding votes too late for its tally, which is rare (C-4). A goal's score, whistle and celebration, including the terriers' celebrating animation, show once its tick is confirmed, about 0.4 s after the ball crosses the line. The net bulges at once." | Q-7 |
| Configuration: Goal celebration "3 seconds" | "3 seconds, as seen: the simulation holds it for 3 s plus the confirmation delay" | Q-7 |
| Terriers, Zoomies: "While its player holds zoomies and its zoomies meter isn't empty, a terrier runs at zoomies speed and the meter drains" | "… Once the meter runs out, zoomies works again only after it is let go (on touch, the stick back inside its rim) and pressed again, so a held button doesn't flicker" | C-20 |
| Tumble: "So does a ball that comes at a terrier at the **bowling speed** or faster, counting only the ball's own speed toward the terrier, so a terrier is never tumbled by a ball it's pushing or chasing." | "So does a ball that comes at a terrier at the **bowling speed** or faster, counting only the ball's own horizontal speed toward the terrier, except for a terrier in its lunge and the terrier that touched the ball last. So a terrier is never tumbled by a ball it's pushing or has just shot, even off a wall, but one chasing a ball that any other terrier touched last, a packmate included, can be." With Q-8's alternative: "… except for a terrier in its lunge, and the terriers whose contact with the ball was the latest and their packmates. So a terrier is never tumbled by a ball its pack is pushing or has just shot, even off a wall, but one chasing a ball a rival touched last can be." | Q-8 |
| Configuration, Bowling speed, the whole note: "A ball coming at a terrier at least this fast, by its own speed toward it, tumbles it. A pounce, or a push at zoomies speed, sends a resting ball off fast enough; a push at a run doesn't" | "A ball coming at a terrier at least this fast, by its own horizontal speed toward it, tumbles it, unless the terrier is lunging or touched the ball last. A pounce from the air sends a resting ball off fast enough. Pushes from the floor meet the ball low, so whether they bowl depends on the tuned values. A ball dribbled at a run does bowl." With Q-8's alternative: "… unless the terrier is lunging, or it or a packmate touched the ball last …" | Q-8, C-5 |
| Persistence: "Display names are up to 20 characters" | "… up to 20 characters and 32 bytes, without control characters" | C-17 |
| Scoring: "A goal is credited to the terrier whose touch was the latest …" | "… whose contact with the ball was the latest …; each attacker sharing it counts a goal" | C-26 |
| Kickoff: "During it, terriers can turn on their spots but not leave them" | Add: "and bark. Held directions and zoomies act as soon as play starts; presses during the countdown are dropped" | C-20 |
| Ready and warm-up: "terriers can run, jump and pounce around the pitch to warm up" | "… can use every control to warm up, and pounces tumble rivals" | C-20 |
| Scoring: "A goal is followed by a short celebration … Then comes a kickoff" | "… Then comes a kickoff, the overtime kickoff, or the results screen" | C-20 |
| End of match: "Players and bots who join it this way keep their packs" | "Players and bots who join it this way keep their packs if there's room. Otherwise a player takes the other pack, or watches if both are full, and a bot takes the other pack, or stays out. A press after the new match's start countdown has begun watches it" | C-42 |
| Practice: "… and the match menu can pause it" | Add: "Opening the menu pauses play, the clock, animations and sound, and so does losing the graphics, until they're back. Hiding the tab, or the page freezing for over 2 s, opens the menu, which has **Resume** in Practice only; Resume, or closing the menu, carries on. A reload goes Home. The player starts in the first pack, and **Switch pack** swaps them with the other pack's newest bot; Pre-match has no **Add a bot** or **Remove a bot**. **Play again** starts a new Practice with the same settings" | Q-15 |
| Disconnects: "If every peer leaves, the match is over, and so it is if only spectators who host no bots are left, since every terrier would sit and an overtime would never end" | "If every peer leaves, the match is over. From the start countdown on, if no browser that controls a terrier is left, so every terrier would sit and an overtime would never end, the match runs on for 30 s, so a player who reloads can come back; then it is over, and the browsers still there say that the players have left, with the score so far and **Home**. Before the start countdown, a match whose browsers all watch waits for players" | Q-16 |
| Disconnects: "Results live only on the peers that saw the match end" | "Results live only on the browsers still in the match when it ends, and one that arrives while they're there, such as a player who reloads, gets them from a peer. There is no central record (as roslambo)" | C-50 |
| Acceptance: "A player who reloads mid-match takes back their terrier" | "… while another browser stays in the match" | Q-16 |
| Platform: "Nothing contacts a third party until a player proposes or joins a match" | Add: "Opening a `#join=` link or entering a code counts as joining" | C-32 |
| Quality: "a stand-in skinned model, kept out of the shipped build" | Add: "served to the shipped build by the tests" | C-33 |
| The ball: "Pushing, one terrier gets it up to running speed in about 1.2 s, and four in about 0.6 s" | "Pushing, one terrier gets it to 95% of running speed in about 1.2 s, and four pushing one behind another in about 0.6 s. Four side by side, meeting the ball at angles, are slower; their times are tuned at M2" | C-18 |
| The ball: "On screen it turns as if rolling with its motion" | Add: "That turning is drawing only, and may differ between viewers" | C-29 |
| Look and sound: "… a whistle at each kickoff and at the end, and a chorus of barks for a goal" | "… a whistle at each kickoff and at the end, and a whistle and a chorus of barks for a goal" | C-53 |
| Terriers: "Each pack wears bandanas in its own color and pattern …" | Add the pack cue you pick from the look book, if you pick one | Q-11, C-51 |
| The pitch: "The design should not depend on the pitch's shape, so the shape can change later" | "The design should not depend on the pitch's shape beyond its point symmetry about the center spot, which keeps mirrored kickoffs exactly mirrored, so the shape can change later as long as it keeps that symmetry" | C-22 |
| Controls: "Pressing a new direction, or moving the stick to one, reads it from the screen again" | "Pressing a direction from neutral, or changing the held direction by 45° or more from the one last read, by keys or stick, reads it from the screen again; a smaller stick move turns the kept direction by the same angle". With Q-19's alternative: "Pressing a direction from neutral reads it from the screen again; changing the held direction, by keys or stick, turns the kept direction by the same angle" | Q-19 |
| Screens, Settings: "… a mirrored touch layout, with the stick on the right; sound on or off" | Add: "render quality, high or low, which a phone may start at low; and Show control hints again" | D-29, D-33 |
| Pack size: "4 a side is the mesh cap of 8 players" | "… the mesh cap of 8 browsers that play; bots aren't peers" | C-49 |
| Joining and packs: "A bot is always ready, so the people's Ready starts the match" | Add: "A match of bots alone starts when its packs are full" | C-41 |
| Configuration, Ball bounce: "Keeps 70% … off the floor, walls, nets and goal frame" | "… off the floor, the walls, the overhead net and the goal frame. The goal's netting keeps less, tuned at M2, so a goal bulges the net instead of springing back out" | C-48 |
| Notes, Reuse: "need only a docs update" | "hermet takes each app's policy as options, so a third app needs no hermet change for its own policy. Its docs name only amorfus and roslambo; its licence writer shipped no licence texts until the owner-requested fix of 2026-11-14 (C-8, Q-3), which terriest pins from the start and each sibling takes at its next pin bump; and the three.js build must be checked against its audit (C-9)." | C-43 |
| Notes, Trystero: "An upgrade of Trystero now moves three apps at once" | "… now couples three apps: hermet's room config is typed against the Trystero each app installs, so a change to that type is a hermet change every app takes at its next pin bump" | C-43 |
| Notes, Cost on the phone: "a 12-tick replay of 4 substeps each checks them 48 times: 1,728 pair checks" | Add: "roslambo's timeline re-simulates the whole window on every tick, 13 steps, and its physics passes over all 36 pairs at least twice a substep, so in its scheme that's 13 × 4 × 36 × 2, at least 3,744 pair checks a tick" (its `timeline.ts` and `physics.ts`; research/audit/REPORT.md §5) | C-44 |
| Notes, Resting and rolling contact: "bodies resting together hit a per-substep event cap" | Only once M0 has measured it: in the audit's probe (research/audit/REPORT.md §5) roslambo's cap never bound, and its per-substep overlap pass settled resting bodies; and the 137–174 events a second came from roslambo's M0 integrator, which its M2 replaced. **Applied after M0** (research/spike/REPORT.md §3), with M0's measurement added: "terriest's solver treats the floor as support, and its M0 spike held a resting ball bit-still for 10 minutes of ticks" | C-44 |
| Platform: "Domain **TBD**" | "Domain **terriest.com**" | Q-5 |
| Stack: the six relays | Any relay that fails the pre-deploy check, replaced as you choose | Q-14 |
| Configuration: the TBD values | The values you sign off: at M2 on the tuning page, and the chase-view swing at M4 with the cameras. A starting value the tuning changes, such as the turn rate, is updated too | Q-10 |
| Acceptance: devices and runs | Add: "The devices, people and networks that meet these lines are named before M5 and recorded in `docs/acceptance.md`." L280's, L284's and L286's own conditions stand | Q-4 |
| Cameras: "A player's camera stays inside the pitch, and a wall or the ball that comes between it and their terrier turns see-through" | "A player's camera keeps its place behind their terrier even where that's outside the walls, in a goal or behind one, since the walls are clear plexiglass, and a goal or the ball that comes between the camera and their terrier turns see-through" | C-57 |
| Look and sound: "… a grass pitch inside padded walls under a rope net …" | "… a grass pitch inside clear plexiglass walls under a rope net …" | C-57 |

---

## 3. Conflicts and realism register

**Severity**, as in roslambo:
- **Major:** changes an acceptance line, or leaves a residual you must accept.
- **Minor:** met by a definition, a design choice or one of your answers.

### Major

**C-1 — Without TURN, some players can't connect, and a missing link breaks the match (roslambo C-1).**
- Nothing new is known: nobody has measured phones on mobile data or behind strict NATs (L343). A contested ball makes a broken pair more visible.
- **Resolution:** roslambo's: forwarding (D-19), TURN in Settings, a clear failure message, acceptance on named networks (Q-4).
- **Residual:** two peers that can meet only through TURN, with no common neighbour, can't play together.
- **M3:** forwarding as built covers a blocked pair whose two hops are each up to 80 ms one way, through a page connected to both that holds the timeline (D-19). Past that, a forwarded input arrives after its tick is final, which C-55 takes up with the loss reach.

**C-2 — The phone's cost is unmeasured, and now comes last.**
- **CPU:** roslambo re-simulates the whole 12-tick window from the final state on every tick, plus one finalising step: 13 steps a tick, not a 12-tick replay now and then. In roslambo's scheme, with 9 bodies, that's 13 steps × 4 substeps × 36 pairs × at least 2 all-pairs passes a substep: at least 3,744 pair checks a tick before any contact splits (research/audit/REPORT.md §5), against L342's 12 × 4 × 36 = 1,728 for one replay. D-5's cost also grows with contacts: 18 passes over the contact list per substep (8 iterations of a forward and a back sweep, then 2 position passes), so about 18,700 contact solves a tick in an 8-terrier scrum, at the 13-step replay the budget assumes (research/audit/REPORT.md §9). roslambo measured tick cost on desktops only.
  - **M0, amended** (research/spike/REPORT.md §8): the 18,700 assumes about 20 contacts a substep, which is a peak. 4-a-side scrums average 10.9–12.1 contacts a substep, 8.0–8.5 of them the floor's, with 17–22 at most in one substep.
- **Worst ticks:** some single ticks cost more, and D-11 can't shorten them, because their base state changes: a resync takes about 30 steps, a joiner's catch-up about 42, and a late-vote repair up to about 270 (research/audit/REPORT.md §9).
  - **M0, amended** (research/spike/REPORT.md §5.3): in Chromium at 4× throttle, on two 4-a-side scrums, 30 steps took at most 15.5 ms and 42 steps at most 23.3 ms. 270 steps took 30.3–37.2 ms at the median and up to 96.2 ms, over 50 ms in 21 of 24 runs of 30 bursts (D-11). So M3 builds D-11's spread.
- **GPU:** 8 animated terriers, a ball and a netted pitch in 3D, never measured on any phone. Every headless engine here draws in software (C-6), so nothing local stands in for the Pixel 8a.
- **Timing:** no more devices are asked for yet (Q-4). This plan asks again before M5, so the first phone run is planned for M5, unless you ask for it sooner.
- **Resolution:**
  - D-11 re-simulates only from the earliest tick whose base or inputs changed, usually 1–2 steps; the budget still assumes 13.
  - M0 measures tick cost on its most contact-heavy script, with the contacts counted, on the desktop and in throttled Chromium at the Pixel 8a's size, as roslambo's proxy does. It also times the worst single ticks on that script against L286's 50 ms maximum frame. Its stop rule sets a ceiling: the p95 of a 13-step tick on that script at most 4 ms in Chromium at 4× CPU throttle, a quarter of a 60 Hz frame (§17).
    - **M0, amended** (research/spike/REPORT.md §4): the ceiling's reading is the tick timed while the page draws, its ticks on the 60 Hz clock, as roslambo's proxy timed it, with the nothing-drawn reading beside it. On it the tick went over narrowly: 3.49–4.60 ms, over 4 ms in 11 of 26 runs, against 2.86–3.39 ms with nothing drawn. At every setting the cost revisit timed, drawing added 0.61–1.47 ms to the p95. The revisit kept D-3's and D-5's settings. If the phone run needs cheaper ticks, 4 iterations is the cheapest setting the revisit timed that passes §16's tests (D-5).
  - If a worst tick exceeds 50 ms there, D-11 spreads its steps over several ticks, which M3 builds and tests (M0's stop rule). **M0:** the late-vote repair does (D-11).
  - The drawing budget the gate enforces starts at §12's guesses, a ceiling until the phone runs. M0 records the spike's counts against them and may lower a figure, never raise one, since no desktop run stands in for the phone; the phone run sets them. **M0:** it lowered none (§12).
  - A render-quality setting (D-33) gives a cheaper path.
- **Residual:** a late surprise on the phone could force cuts at M5. For a long frame, the first fix is to compile ahead whatever compiled mid-match (§12); then come fewer triangles, a lower pixel ratio, simpler effects.
- **M2, measured:** the port's step, with events, presence, the clock and the binding of bodies to slots, costs from 5.0% less to 0.4% more than the spike's, inside M2's 5% budget. That's the wall scrum with 8 inputs a tick, both steps timed tick by tick in one loop with their order swapped each tick, three runs on one core, at a9aca0a.
  - **Its parts:** making 8 inputs canonical costs about 0.8 µs a tick (D-12), and the bot brain 0.38–0.50 µs a bot. The brain runs once a local tick on its host, never in the timeline's re-simulations, so a replay doesn't pay for it (§14).
  - **Allocation:** the step makes no objects or arrays in its loop, but V8 still boxes about 9.5 KB of floats a step in the wall scrum at call boundaries, as it does for the spike's identical code.
  - **Re-timed at M2's review,** after the slip release and the settled values: from 0.3% to 2.3% less than the spike's by the per-tick medians, and 1.3% to 3.6% less by the means, three runs on one core. The comparison needs both simulations' bodies equal tick by tick. In the wall scrum the slip release moves them off the spike's from tick 104 (D-5), and at the settled values the push assist from tick 29. So it runs at M0's values, the assist off and the netting at 0.3, with the slip hold-off's reach at 10⁹ m, which is M0's any-distance rule: there the port moves the scrum by the spike's bits for all 3,600 ticks timed, through the slip release's code. The assist, off there, adds at most a dot product, a square root and a division a tick for each ball-view pusher touching the ball. Single runs here vary too much to stand in for this: the tuning metrics' wall-scrum step took medians of 39.9–69.4 µs across three runs, against M0's 27.8–31.2 µs.
- **M3, measured** (M3's design §2.3, §2.8, §9.6; research/corrections/REPORT.md):
  - **A normal tick** reuses its predicted final state, so it steps once, to predict the new tick, plus a re-simulation from the earliest changed tick when a received input differs from its prediction (D-11). Encoding the new final state and hashing its bytes cost about 5–6 µs at 8 terriers in Node, against 27.7 µs for a step of the wall scrum (M3's design §2.1 and its header). The budget's 13 steps still bound a normal tick: its worst is a late input at the window's start, w + 1 steps.
  - **The worst ticks are spread:** a changed base's steps, at most 14 for each tick a timer run moves the clock, and 14 for a run that moves none or adopts a STATE, so a 270-step repair finishes in about 20 timer runs with the drawn head held (D-11). The cap started at 42. The cap check times the repair's worst call, the one adopting its STATE included, over 20 forced repairs from about 240 ticks back, on a quiet machine (D-11). At 42 it failed: the median worst call was 5.22 ms in Node, 32.9 ms times 6.3, against 25 ms, the runs' maximum 14.5 ms, and the 1-minute load 0.94 before and 1.53 after. 31, 20 and 18 failed after it, at 38.0, 26.4 and 31.2 ms times 6.3, and 14 stood, at 3.90 ms, 24.5 ms times 6.3, its maximum 5.74 ms and its load 0.81 and 1.04, so the cap is 14 (M3, by measurement; research/corrections/REPORT.md section 2.5). The STATE's adoption was the worst call in 95 of the 100 runs, and its cost a step rose at every round, from 0.124 ms at 42 to 0.278 at 14, while the median worst call itself rose at 31 and at 18, so 14's margin, under 2%, is smaller than the rounds vary (D-11). In all 48 runs made before its method, from a quiet machine to a busy one, the slowest call was the STATE's adoption, 3.8–33 ms, and times 6.3 it was over 25 ms in 45 of them; none of them decides anything (research/corrections/REPORT.md).
  - **On a page:** in the 12-page load run at M3's final tree, at the spread cap of 14, which passed (§16), a timer run that moved the clock took 0.57–0.68 ms at a player at the mean, 1.0–1.2 ms at the p95 and 7.7–23.4 ms at most, and 0.20–0.31, 0.4–0.6 and 4.2–6.1 ms at a spectator, over each page's whole run, with one step a tick and at most 13–16 in a timer run. In the measurement's second 90 s run, at 71bd4a7 and the cap of 42, which failed while the machine's message path fell behind, a player's took 1.77–1.97 ms at the mean, 6.6–7.8 ms at the p95 and 93–153 ms at most, and a spectator's 0.74–0.76, 1.9–2.0 and 59–129 ms, at 2.0–2.6 steps a tick while each page resynced; in phase 5's 20 s smoke run, which passed, a player's took 0.72–0.80 ms at the mean and 1.5–1.7 ms at the p95. M4's frame bench repeats the forced repair in throttled Chromium while the page draws (M3-Q14).

**C-3 — Resting, rolling and simultaneous contacts, under exact operations.**
- **Problem:** in terriest the ball and the terriers rest on the floor almost all the time, a push is a lasting contact, and every bounce loses speed on purpose (L338). A scratch copy of roslambo's integrator, with a floor under gravity, showed it can't do this:
  - a resting body never comes to rest, leaving every overlap pass at +0.017 m/s;
  - a rolling body loses 30% of its speed every substep;
  - its bounce swaps velocities, which is right only for equal masses, and the ball weighs twice a terrier.
- Settled one at a time in a fixed order, as roslambo's are, contacts bias a mirrored kickoff once masses differ and bounces lose speed: the pack settled first sees the ball roll back at an eighth of the terriers' speed.
- Settled all at once instead, in plain Jacobi iterations, several contacts on one body mis-solve. The review of this plan's first draft modelled three or four terriers hitting the ball together: they created energy, or sent the ball slower than one terrier did (research/audit/REPORT.md §6).
- **Resolution:** a new solver (D-5): the floor as support, accumulated impulses by Gauss–Seidel over mirror pairs, restitution only above a closing speed. M0 proves it. Its stop rule sends it back to D-5 if a resting ball can't be held bit-still, simultaneous hitters gain energy, a mirrored kickoff isn't exactly mirrored, or no slip-out rule passes its tests.
- **Residual:** the solver is unproven until M0. If M0's stop rule fires, D-5 is revisited before M1, and this plan is amended with M0's numbers (§17).
- **M0, confirmed** (research/spike/REPORT.md §4): the solver passed all four conditions. Only the stop rule's cost clause fired, and the revisit it asks for kept D-5's settings (D-5).

**C-4 — "A correction never takes one back" isn't true at final ticks.**
- **Problem:** a final tick is safe from late inputs, but a peer whose hash loses the vote replaces its final state, about 0.4 s plus a round trip later. That's why roslambo acts on its end only at the vote-confirmed tick. Even a confirmed tick can rarely be re-tallied by a very late vote.
- **Resolution:** Q-7. A late input never changes a confirmed tick, because a confirmed tick is final.
- **Residual:** a goal taken back on a browser whose state diverged and that heard the deciding votes too late for its tally, so it confirmed its own state. In the review's model of roslambo's timeline, dropped inputs lead there only under a one-way delay held above about 233 ms, or a stall that holds the link's messages for 0.45 s or more (research/audit/REPORT.md §9). Accepted, as in roslambo.
- **M3:** the scoreboard withdraws exactly the goals a completed repair took away, by the final lineage's goal ticks, so a goal a repair keeps stays shown however far back the repair reaches (D-14). How often a loss past the late window's reach makes a browser diverge is C-55's.

**C-5 — The bowling rule can't do what its examples say.**
- **Problem:** on a 4 m/s threshold on the ball's speed toward the terrier:
  - pushes come from the floor and meet the ball low, so a zoomies push leaves it at about 2.3–4.05 m/s horizontally, depending on the collider and how contacts are solved: mostly short of 4;
  - a ball pushed along at a run reaches 6 m/s and bowls every other terrier it meets, packmates included, though L324 says a push at a run doesn't, so no speed threshold separates hard hits from dribbles;
  - a terrier that pounces into an oncoming 5 m/s ball, L341's own example, is always bowled;
  - a ball driven into a wall at 6 m/s comes back at 4.2 m/s and bowls the terrier chasing it, though L49 says that never happens.
- **Resolution:** Q-8.
- **Residual:** under Q-8's proposal, a ball that a packmate touched last can still bowl a terrier, and a ball dribbled at a run bowls any other terrier in its way. Q-8's alternative exempts packmates.
- **M2, measured** at the settled values (research/tuning/REPORT.md §2.5):
  - **The examples:** a push at zoomies speed sends a resting ball off at 3.968 m/s, just short of the 4 m/s bowling speed, so a push from the floor doesn't bowl. A pounce from the air sends it off at 4.57 m/s, which does, and a ball dribbled at a run meets the rival in its way at 5.995 m/s and bowls it. So REQUIREMENTS' note holds at 4 m/s. At 5 m/s the pounce from the air would no longer bowl.
  - **How often:** in seeded bot matches the ball bowls terriers over 5.2 times a minute of play at 2 a side and 6.5 at 4 a side, against 0.3 pounce tumbles a minute. At 4.5 m/s that's 3.3 and 4.2, at 3.5 m/s 9.0 and 10.1. Whether tumbles should come this much more often from the ball than from pounces is yours to say, with the bowling speed (Q-8, Q-10). Q-8's alternative, which spares the packmates of whoever touched the ball last, is another lever, not measured.

**C-6 — The gate draws WebGL 2 in software.**
- **Measured 2026-11-14 on this machine**, 100k triangles a frame:
  - MSAA on: 4.9 fps in Chromium (SwiftShader), 13.4 in Firefox and 10.9 in WebKit (llvmpipe);
  - MSAA off: 15.5, 25.9 and 23 fps;
  - all three engines at once, as a multi-peer test runs them: 10–15 fps;
  - in WebKit, GL work blocks the page's JavaScript for 23 ms or more a frame.
- Firefox gets WebGL only while `DISPLAY` or `WAYLAND_DISPLAY` is set, which WSLg provides here, so CI runs the gate under `xvfb-run`, and a run with no display fails the WebGL 2 assertion at once.
- **Resolution:**
  - Nothing in a test depends on the frame rate: the timeline runs on timers (D-31), and the gamepad is read on them too (D-29).
  - The gate runs at the low render-quality setting, a real player option (D-33), not a test mode.
  - The gate asserts WebGL 2 before anything else.
  - An opt-in GPU path, `GALLIUM_DRIVER=d3d12`, reached 60 fps in all three engines here, for faster local runs. **M1:** the gate passes on it, with M0's ANGLE flags giving Chromium the GPU too. At M1 it's slower, though: 93–94 s against 76–78 s in software, since starting each page costs more than drawing the empty pitch saves. It's there to check the GPU path, and its speed is measured again once the scenes are busy.
  - In CI (§15), M1's first run is the probe for software GL on the hosted runner. If an engine can't draw there, or the runner can't hold the real-page matches, CI runs a separately named `check:ci`, labelled partial, that leaves out exactly those specs, and the local `npm run check` stays the definition of done, as amorfus's D-17 does. **The first run, 2026-11-18:** all three engines draw on the hosted runner, and the full gate passes there in 1 min 58 s, so there's no `check:ci`.
- **Residual:** the gate never judges frame time. It's judged by hand: on your desktop for now, and on the phone when it runs, planned for M5 (Q-4).

**C-7 — Real Safari is untested (roslambo C-7).**
- Playwright's WebKit on Linux draws through Mesa and uses Linux maths, so it only stands in. roslambo's run on real Safari never happened.
- **Resolution:** exact operations, the canary (D-23), Q-12.
- **Residual:** unless the device round before M5 names a Mac or an iPhone (Q-4, Q-12), real Safari ships unverified. A mismatch there would show as the canary refusing every networked match on Safari (D-23).

**C-8 — hermet's licence notices shipped without their texts.**
- **Problem**, verified twice on 2026-11-14:
  - hermet's `licenses.mjs` read `license` and `licenseText`, but Vite 8 writes `identifier` and `text`, so every notice was a bare `## name@version` heading.
  - roslambo's and amorfus's live sites serve MIT and ISC code that way, and no licence text is inside their bundles either. A rebuild of each from HEAD reproduced its shipped notices byte for byte.
  - The gate stayed green: the audit checked only the headings, and hermet's test asserted the text only for `extra` entries, never for npm ones.
  - amorfus's vendored FastNoiseLite has no notice at all, which the audit can't see.
  - terriest would have shipped MIT three.js and Trystero the same way.
- **Resolution:** fixed in hermet at your request (Q-3), and pushed to its main on 2026-11-14 as 11283ca. Its writer reads Vite 8's `identifier` and `text`, its audit fails a notice with no text, and its test runs on Vite's real output. On both siblings' current builds, roslambo's 3 notices and amorfus's 5 then carried their texts, and the audit found nothing. terriest pins 11283ca from M1 (D-37). The siblings: Q-20.
- **Residual:** the siblings' live notices stay wrong until each bumps its pin and redeploys, and amorfus's FastNoiseLite stays without a notice until it adds one (Q-20).

**C-9 — three.js has never been through hermet's dist audit.**
- **Problem:** the audit reads every string in the bundle, library code included. A documentation URL in a warning, or in GLSL comment text, fails it. So might a tokenizer edge case, such as a regular expression after `)` that holds a quote. No copy of three.js is on this machine to check.
- **Resolution:** M0 builds three's WebGL renderer, and GLTFLoader if it ships, then runs the audit with no exceptions. Each finding becomes an app option, a hermet option or a tokenizer fix, and the request guard confirms nothing is ever requested from it.
- **Residual:** a finding that needs a hermet option or a tokenizer fix is a hermet change. It's pushed only with your go-ahead, and M1's pin waits for it (D-37, §17).
- **Settled by M0** (research/spike/REPORT.md §5.4, §5.5): the audit found one string in three 0.187.0, the bare `'/'` in `LoaderUtils.extractUrlBase`, cleared by an app option (D-37). No host appears in any string, and hermet's tokenizer agrees with TypeScript's parser on every chunk. The tokenizer's edge case is real, but isn't in three's bundle, so no hermet change is needed. In run 4, every request stayed on the page's origin or used `blob:` or `data:`.

**C-18 — Pushing together helps only when the pushers line up.**
- **Problem:** L11's "together they get it moving sooner" and L56's "four in about 0.6 s" hold only for an aligned train, one behind another (D-6).
  - Contacts are frictionless, so in the pitch frame pushers side by side slide round the ball. In ball view, the default (L88), each drives at the ball's centre rather than along its travel.
  - In models of D-5, four abreast took 0.92–1.15 s to 95% of run speed in the pitch frame and 1.0–2.1 s in ball view, against one pusher's 1.14 s (research/audit/REPORT.md §9). The audit's earlier 0.65–0.7 s side by side doesn't hold in 3D.
- **Resolution:** §2 states the measure. M0 measures one, two and four pushers, side by side in both frames and in a train. The tuning page compares remedies with you (Q-10), such as terrier–ball friction (μ 0.5 gave 0.98–1.01 s in the pitch frame in a model, and was worse in ball view) or a ball-frame target whose component along the ball's travel is run speed. The marks for side by side are set with you at M2 (§16).
- **Residual:** if none reaches the marks, §2 restates L11 and L56.
- **M0, amended** (research/spike/REPORT.md §5.2; D-6): side by side helps in the pitch frame more than the models said, at 0.72–0.83 s against one pusher's 1.225 s. In ball view, the default, it's 0.92–2.03 s: two abreast, at 2.033 s, and four round the ball, at 1.313 s, are slower than one pusher. So a remedy matters most in ball view, and the marks are still set with you at M2.
- **M2, amended: the remedy and the marks** (`src/core/sim/movement.ts`; research/tuning/REPORT.md):
  - **The remedy built** is the second above, a ball-frame push assist: a steering rule, with no change to the solver (D-7). A terrier in the ball frame, holding a step within one of forward and touching the ball while the ball moves faster than the restitution threshold, 0.3 m/s, drives the way it held, but at its run or zoomies speed divided by cos φ, where φ is the angle between that way and the ball's travel, up to a cap. So its speed along the ball's travel is its own until the cap binds. The ball's 0.3 m/s is the restitution threshold's, read rather than a setting of its own, so tuning the threshold moves the assist too. A cap of 0 turns it off and skips it, and a cap that's on is at least the zoomies speed, which a §7.4 check keeps. P8 holds with it on. Terrier–ball friction, which would change the M0-validated solver and was worse in ball view in the model, isn't built.
  - **Settled provisionally** on, at a 9 m/s cap: the smallest of 9, 12 and 15 m/s at which two and four side by side in ball view beat one pusher. All three do, and give the same times but for four round the ball's 0.979 s at 12 and 15.
  - **The marks,** set at M2 from those times, to 95% of run speed from rest in contact: two round the ball 0.829 s in the pitch frame and 1.175 s in ball view, two on a line 0.833 and 1.175 s, four round the ball 0.721 and 0.983 s, four on a line 0.758 and 0.854 s. With the assist off, ball view's are M0's 2.033, 2.033, 1.313 and 0.921 s. The pitch frame keeps M0's times, since the assist acts only in ball view. `push.test.ts` holds each time within ± 10% of its mark, as §16's own push marks are, and pins it to the millisecond, so any change to the drive or the assist sets the marks again on purpose; in ball view each must beat one pusher too.
  - **One pusher** takes 1.225 s in both frames, on or off. That time can't show the assist acting on a lone pusher, since the drive's 15 m/s² sets it whatever the drive's target: a lone pusher driving at the 9 m/s cap still takes 1.225 s. What shows the assist leaves a lone pusher's push alone is its drive's target, which `assist.test.ts` and the metrics check off the axes, where dir() rounds: it stays the pusher's base speed, to 1e-12, through the push (M2's review).
  - **So L11's "together they get it moving sooner"** holds in both frames, and §2 needn't restate L11 or L56. The cap and the marks are yours to confirm or change before the deploy (§17).

**C-21 — A ball can come to rest on terriers, and the drafted slip-out can't always bring it down.**
- **Problem:** squeezes, and the kickoff pinch at every bot kickoff, can leave the ball resting on terriers. The drafted slip-out, for contacts within 45° of vertical, fails while terriers keep holding toward the ball (D-5 step 7).
- **Resolution:** D-5's slip-out, chosen at M0, because the drafted rule fails when terriers keep pushing; §16's cases.
- **Residual:** a mirrored kickoff pinch sends the ball 0.8–2 m straight up before anything slips (research/audit/REPORT.md §9).
- **M0, amended** (research/spike/REPORT.md §5.2, §8):
  - **The drafted rule failed as predicted:** it held the ball up for 8 s in 248 of 864 rest cases, and in 6 of 8 pinches.
  - **The rule chosen** is a 42° cone from vertical with a slipping flag, at 2 m/s (D-5). It passes all four of §16's cases: a ball on pushers comes down within 1.383 s, and one between two sitting terriers within 0.471 s; no dribble slips out; and pinches come down 0.433–1.650 s after landing, mirrored.
  - **The pinch's height:** at a run the ball goes 0.8–2.0 m up. At zoomies speed it reaches the overhead net, its centre 4.4 m above rest.
  - **Its window is narrow,** 42° to 43.2°, so M2 rechecks it whenever it tunes the collider, the drive or friction (D-5).
- **M2, amended** (research/tuning/REPORT.md §2.1, §2.5):
  - **The pinch:** with the slip release (D-5), pinches come down 0.433–1.962 s after landing, mirrored. The terriers come back sooner, and 2 and 4 a side at zoomies speed take 1.604 and 1.962 s, against M0's 1.229 and 1.650 s.
  - **The window, rechecked:** every collider radius tried but 0.25 m shuts it, the dribbles' lowest hop falling under the cone, and so do accelerations of 12 and 18 m/s², so they keep their starts. Idle friction of 10 or 12 m/s² keeps two sitting terriers from letting the ball down within 0.5 s. At the settled values no dribble slips out: the sweep's lowest hop is still 43.53°, and `slipout.test.ts`'s 43.23°. Since M2's review the metrics' window check runs that test's two dribbles off the sweep's grid too, so it reads 43.23°, as the gate does. Two sitting terriers let the ball down in 0.483 s at a 41.5° cone and 0.508 s at 41°, so the window reads about 41.5° to 43.2°.

**C-55 — Past 65.6 ms one way at d = 2, a lost packet makes its input late; past 80 ms a hop, so does forwarding (M3).**
- **Problem:** Trystero's data channel is reliable and ordered. A lost packet is sent again about a round trip later, and every message behind it on that link waits for it. An input has d + w ticks from its sending to its tick's late boundary, 233 ms at d = 2 and w = 12, less what the clocks still differ by, up to the 1-tick deadband, 17 ms. A message sent again lands in time when 3 × one-way + jitter fits that (M3's design §9.4, §9.5, R-13).
  - **Without loss,** a direct input comes late only past about 200 ms one way, by the model: newcomers in bursts were clean at 100–200 ms in 96 runs (M3 phase 4a).
  - **The loss reach,** ((d + w) × 16.7 ms, less a deadband's 16.7 ms and 20 ms of jitter) ÷ 3, as the harness reports it beside each lossy profile (`reachMs`, `dev/corrections.measure.ts`; research/corrections/REPORT.md section 1.8): by the model, 65.6 ms one way at d = 2 and w = 12, and 71.1 ms at d = 3. So the 30 ms profiles are inside it, and the 80 and 150 ms ones past it, as the measured profiles bear out (below). At d = 2 it's 76.7 ms at w = 14 and 87.8 ms at w = 16, by the model. M3's design's 71, 82 and 93 ms were before the clocks' residual, so w = 14 doesn't reach 80 ms at d = 2 (the method's section 1.14). Past the reach, each lost packet makes its input late at the browser that lost it, which finalises the input absent, diverges and resyncs: at 0.5% loss and 60 TICKs a second, by the model, about 0.3 a second on each incoming link, so about 2 a second at a browser with 7.
  - **The forwarding reach** (D-19): a blocked pair's inputs take two hops, each with its own one-way delay and jitter, and the pair takes no clock sample of each other, so their clocks differ by up to two deadbands: ((d + w) × 16.7 ms, less two deadbands and twice 20 ms of jitter) ÷ 2, by the model 80.0 ms one way a hop at d = 2 and w = 12 (M3 phase 5a). At 80 ms a hop the partial-mesh profiles sit at its edge, and at 120 ms a pair is past it whatever the forwarding: about 5,000 disagreements and 285 resyncs in 5.8 browser-minutes in phase 5a's runs. A loss on either hop, sent again, adds two legs to the trip: 40.0 ms a hop, by the model's same formula.
- **Measured** (research/corrections/REPORT.md section 2.6, the lossy and partial-mesh profiles, which decide nothing alone): lateAbsent's share of the remote inputs, and resyncs a browser-minute, at pack sizes 1 to 4, at the cap of 14 (`cap14.json`). The late inputs' share is within 0.05 points of lateAbsent's: nearly every late input was finalised absent.
  - **Inside the loss reach,** 65.6 ms at d = 2 and 71.1 ms at d = 3 by the model, at 30 ms one way: no input came late and no browser resynced, at 0.1% or 0.5% loss, at either d and every pack size.
  - **Past it, at 80 ms:** at d = 2, 0.16–0.17% and 3.33, 10.0, 16.2 and 21.9 resyncs a browser-minute at 0.1% loss, and 0.81–0.89% and 15.1, 39.4, 51.7 and 59.2 at 0.5%; at d = 3, 0.07–0.08% and 2.32, 6.78, 9.48 and 13.1, and 0.34–0.36% and 9.76, 26.8, 37.1 and 45.9. So d = 3 halves the share and cuts the resyncs by 22–42%, though 80 ms is past its reach too.
  - **At 150 ms:** at d = 2, 1.42–1.54% and 3.44, 11.6, 17.8 and 24.4 at 0.1%, and 7.11–8.02% and 14.6, 30.9, 26.2 and 17.4 at 0.5%; at d = 3, 1.32–1.51% and 3.43, 12.4, 17.8 and 23.8, and 6.58–7.56% and 14.7, 32.0, 25.5 and 17.2. At 0.5% the failed resyncs come to outnumber the completed ones as the pack grows, 14,202 to 3,191 at pack size 4 and d = 2, so the completed ones a browser-minute fall there; and 5 of the 32 matches, at either cap, never reached their end within 600 s: each of their browsers completed 148–316 resyncs and failed 334–806, and none scored.
  - **The partial mesh,** pack size 4, at its forwarding reach, 80.0 ms by the model: no input came late with one or two pairs blocked at 30 ms, nor with one at 80 ms. With two at 80 ms, one forwarded input came a tick late and was finalised absent, and one browser resynced in 6 matches, 0.0128 a browser-minute, as phase 5a saw. The forwarders sent 79,703 and 128,754 FWDs at 30 ms, and 60,364 and 150,431 at 80 ms.
  - **At the cap of 42** (`results.json`) the rates are close but not equal: 104 of the 192 lossy matches end differently, as a repair spreads further at the lower cap.
- **The options,** each with its reach and its cost:
  - **w = 12, and the residual:** by the model, 65.6 ms one way at d = 2 for a lost packet sent again, and 80.0 ms a hop for a forwarded input; past them, resyncs at the measured rate. Nothing changes.
  - **w = 14:** by the model, 76.7 ms direct at d = 2, still short of 80 ms, and 96.7 ms a hop forwarded, by the same formulas. The confirmation delay, (w + v) ÷ 60 s, grows from 0.4 to 0.43 s, which moves L202's "about 0.4 s" (§2); the goldens are emitted again, since the celebration's ticks grow with w; a normal tick's worst is 15 steps, against C-2's 13. It fits TICK's 16-tick history at d = 2 (§7.4), but at d = 3 it would take a protocol version 2, and reach 82.2 ms, by the model. The spread's cap, at least w + 1 (§7.4), rises from the measured 14 to at least 15, and the cap check runs again there (D-11).
  - **w = 16, with a protocol version 2:** by the model, 87.8 ms direct at d = 2, and 113.3 ms a hop forwarded. TICK's history widens to 32 ticks, in u32 masks, 4 bytes more a TICK and a bot entry, with `inputHistoryTicks` and §7.4's check moving with it; a confirmation delay of 0.47 s; the goldens emitted again; and the spread's cap at least 17, checked again.
  - **The unordered input channel** (§21's deferral, roslambo D-13): TICKs over an unordered channel that doesn't resend, so a loss costs only its own message, which the next TICKs' 16-tick histories cover. Its reach, by the model, the same formula with a tick added for each TICK lost in a row, since the next TICK carries the input a tick later: at d = 2 and w = 12, about 180 ms one way for one loss, 16.7 ms less for each more, against the reliable channel's 65.6 ms, and 196.7 ms without loss, as now; forwarded, 80.0 ms a hop without loss, as now, and 71.7 ms with a loss on either hop, against 40.0 ms. It needs a second channel and a protocol change.
  - **TURN** for a pair that can't connect (C-1): one hop instead of two, where a player brings a TURN server (Settings). The pair then samples each other's clocks, so the direct reaches apply to its whole one-way latency through the relay: by the model, 196.7 ms without loss and 65.6 ms with a loss at d = 2, where forwarding's two hops reach 160 and 80 ms between them, 80.0 and 40.0 ms a hop. Its costs: the relay's added latency, a server a player has to bring, and what that server sees, the IP addresses and the traffic's volume (§20).
- **Resolution:** yours (M3-Q6). M3 doesn't wait for it (§17's rule for attended steps), and w stays 12 until you pick, unless rule 3 fails at a profile that decides and confirms the next w the harness can measure, w = 14 at d = 2 (research/corrections/REPORT.md section 1.9). A next w that needs protocol 2 at the d chosen isn't measured, and nor is one past 18: rule 3 then decides nothing, w stays, and its figures come to you here, with the choice of protocol 2 built and that w measured, or w kept with its residual. Rule 3 confirmed w = 12: at its 16 profiles, the loss-free 30 and 80 ms ones and the 30 ms ones at either loss rate, no input was finalised absent and no browser resynced, at both caps, so no next w was measured, the goldens stay, and w is 12 until you pick (research/corrections/REPORT.md section 2.1).
- **Residual at w = 12:** past the reach, a match whose links are lossy resyncs at the measured rate, each resync costing its browser a correction and `resyncRetryMs` or more without confirming; at 150 ms one way and 0.5% loss, 5 of the 32 matches measured never reached their end. Goals and the end are still taken only from confirmed ticks (D-14).

**C-56 — roslambo, which M3 ports, has three faults that M3 found and fixed in terriest's port (M3).**
- **Problem:** M3's reviews found each in terriest's port of roslambo's code, and each is in roslambo's own, at 3809d3a, its main: `src/core/timeline/timeline.ts`'s rebalance, and `src/core/session/session.ts`'s `flooding` and `onRtt`. roslambo's tests can't see them, since its loopback reports one constant round trip a link, delivers to a frozen node at once, and never holds a link, so no backlog or stale held sample ever forms.
  - **The tick clock's jump with one peer** (D-15): roslambo's rebalance jumps the whole median offset however many peers' offsets it counts. At 1 a side between two people, a page frozen under the stall threshold that takes its held TICKs before its late timer run jumps about 10 ticks on stale samples; then both pages jump toward each other at each rebalance, swapping sides every second. In terriest's port at a21351f that went on for 30 s in 3 of 16 seeds, and seed 601 lost the inputs of 45 of its own final ticks in 20 s.
  - **The flood count by arrival** (§9): roslambo counts arrivals, closing a connection past 360 TICKs in 2 s once the oldest is 0.9 of the window old. So a backlog over about 252 TICKs, after about 4.2 s of a freeze or a stalled link, closes honest connections about 1.8 s after it lands, and its transport then refuses the peer for good. terriest's port did that until a87b4c0: in the cap check at 4da2086, the dissenter's 7 connections closed 1.9 s after its hold.
  - **Every round trip taken** (C-12): roslambo takes every round trip, halved, as the one-way delay, with no stall bound, no smaller of two and no freeze check, and its timeline adds that delay to every clock sample, so one pong a freeze held moves its clock by half the freeze.
- **Resolution:** yours, as C-8 was hermet's. roslambo isn't touched: a change to it waits for your go-ahead (§17). terriest's fixes are where a port back would start, each tested over the network simulator: the half jump with one peer and no clock sample across a freeze (D-15, 4da2086); the count by the ticks TICKs carry, on the sender's possible clock (§9, a87b4c0); and no round trip a freeze held, the one-way delay half the smaller of the last two taken (D-15, C-12, a87b4c0). The load run's diagnosis cleared those round-trip rules of its failure (§16), and found a milder residual in them that a port would carry (D-15).
- **Residual:** until then roslambo's live site keeps all three. Two people at 1 a side may see their clocks swing after a freeze, a freeze or a stalled link of over about 4.2 s closes the connections it held up and refuses those peers for good, and one freeze can move a page's clock by half its length.

### Minor

| # | Problem | Resolution |
|---|---|---|
| C-10 | With two voting browsers, any disagreement is a tie the smallest hash wins (roslambo C-19). Here that covers every online 1-a-side match between two people. | Accepted: honest peers rarely disagree. **M3:** so two voters' repairs mustn't cross. As built, a voter a tally saw lose isn't counted for the v − 1 ticks after, and of two resyncs that cross, the one for the earlier tick completes; the residual is one failed resync a divergence when the loser learns late (D-13). Since 600f2f0 a tally also counts the voters this page's lineage removed for silence in warm-up while they still reached it, so a page cut off from the room loses to it, and of two halves of a warm-up partition alike the smallest hash wins tick by tick, every page counting the other half's votes alike. The residuals are D-13's: the winning half's one failed resync, a slow resync for a tick at the history's edge, and a warm-up partition in a partial mesh that can end in two lineages. |
| C-11 | roslambo's spectator cap can be exceeded: a browser refused as a player watches uncounted; a spectator counts the others but not itself; two handshakes at once can both pass. | D-21. Residual: two peers that choose Watch within one message's delay can both pass, a rare fifth spectator; accepted. **M3:** as built, an admitted HELLO holds its place until its handshake joins, fails or times out, and a watcher counts the room's spectators again as it meets them, so the cap holds. Two that choose Watch together can both leave instead, and each can try again; accepted (D-21). |
| C-12 | A phone tab the OS killed may be refused as "open in another tab" until its old connection times out. | D-21: a hello with a connected player ID replaces a connection silent for 2 s. **M3:** silent means no message and no pong, with a ping to each peer every 1 s (M3-Q23). A round trip a freeze held, this page's or its peer's, is no sample, and the one-way delay is half the smaller of the last two taken (D-15). The load run's diagnosis cleared these rules of its failure, the machine's message path's, and found a residual in them: a gap this page's own lag caused can read as the peer's freeze, so under back-to-back freezes, in a model, the gap between the one-way delay estimated and the true one roughly doubles, 2.2 to 4.1 ticks, and clock jumps rise from 0.05–0.07 to 0.08–0.13 a page-second, with no collapse (D-15, §16). Residual, accepted: a peer that sends no TICKs, a spectator without bots, still inflates this page's one-way delay for it while it freezes; that delay feeds only the timelines' ages inside the tie, a STATE adopted from it, which the clock's first rebalance corrects, and the retries' spacing. roslambo's `onRtt` takes every round trip, with no stall bound, no smaller of two and no freeze check, and its timeline adds the delay to every clock sample, so one pong a freeze held moves its clock by half the freeze; its loopback reports constant round trips, so its tests can't see it. For you: roslambo isn't touched (C-56). |
| C-13 | roslambo's build hash covers settings and versions, not simulation code, so old and new builds could share a match and keep resyncing. | D-21: the build hash also covers the timeline's d, w and v (D-11), all of `goldens.json`, and a hash of the `src/core/sim` sources. **M3:** every `src/core` source peers must agree on, not the simulation's alone: all but the tests and `src/core/bot`'s brain, marks and setups, whose outputs are inputs like a person's (D-21, M3-Q3). |
| C-14 | Safari may delete the stored ID, name, coat and settings after 7 days without a visit (roslambo C-5). | Accepted, and the README says so. Only a re-typed name and coat are at stake. |
| C-15 | The example match ID fails its own check character, which should be K. | §2 |
| C-16 | "Majority" is a plurality in roslambo's code; spectators hosting bots broadcast too. | §2 |
| C-17 | roslambo caps names at 32 bytes as well as 20 characters, and drops a name that breaks the rule. | §2 |
| C-19 | The terrier's collision shape is undefined, and every hit number depends on it. | D-4; tuning (Q-10). **M2:** a sphere of radius 0.25 m, settled provisionally: every other radius tried shuts C-21's window (D-4) |
| C-20 | Unstated: pounce mechanics; zoomies on an empty meter; what resets at a kickoff; what terriers may do in warm-up, countdowns and celebrations; tumble edge cases. | D-6, D-8, §2 |
| C-22 | "Mirrored" kickoff spots could mean reflection or point symmetry, and exact symmetry in floating point needs the pitch centred at the origin. D-5's mirror pairs also need the pitch itself point-symmetric, though L69 says the design shouldn't depend on the pitch's shape. | D-4, D-5; §2 |
| C-23 | The goal mouth makes the pitch non-convex; half-planes can't model it. The ball is wholly past the line for only a few ticks. | D-4, D-8: bounded pieces; a goal test every substep |
| C-24 | Re-reading the screen at every step of a stick brings back the spin anchored steering removed. | Q-19; D-29, §2 |
| C-25 | Vehicle-style "back brakes and backs up" can't be "resolved into a heading". | D-7: the nose frame is throttle and turn |
| C-26 | "The latest touch" is ambiguous when a touch is an episode. | D-8: the latest contact; §2 |
| C-27 | If goals wait for confirmation, only 2.6 s of a 3 s celebration is seen. | Q-7 |
| C-28 | Inputs are sampled once a tick and predicted as the last one, so a held button repeats in prediction and a quick tap can be lost. | D-10: press counters |
| C-29 | The ball turns on screen "as if rolling", but the simulation gives it no rotation to read. | §2: drawing only |
| C-30 | Practice's pause, its Play again and its Pre-match controls are undefined. | Q-15 |
| C-31 | If the only browser in a match reloads, the match ends, so L282 can't hold. | Q-16 |
| C-32 | Join must connect before the player picks a pack, so opening a link contacts the relays. | §2: opening a link counts as joining |
| C-33 | The stand-in model must stay out of the shipped build, yet the tests run against it. | D-27: the tests serve it; §2 |
| C-34 | Space and the gamepad's bottom button jump in warm-up, and would also press a focused Ready. Nothing opens the menu without a mouse or touch. | Q-17 |
| C-35 | A hidden tab draws nothing, so "60 fps" can only mean a visible page. A covered window also counts as hidden. | D-31 |
| C-36 | Losing WebGL 2 mid-match isn't covered. | D-30 |
| C-37 | Unstated: how a phone is told from a tablet, whether spectators are asked to turn the phone, safe areas, and a screen that sleeps on a spectator. | D-30 |
| C-38 | The walls and net are both 6 m high, so "high above one side" puts the spectators' camera outside them, looking through. | D-28: the near wall and the net fade where they're in the way. **M4:** the walls are clear plexiglass, and seen from outside the near wall draws only its kick band, so it hides nothing of the near side; the net still fades (C-57). |
| C-39 | Settings defaults, which settings apply mid-match, what mirroring moves, and whether control hints are remembered. | §11; D-29 |
| C-40 | The one-tab rule doesn't say whether it covers Practice and watching. | D-24: one lock for the whole app |
| C-41 | Bots are always ready, so a match of bots alone starts when the last is added. | As roslambo; §2. **M3:** a host sends a bot's READY again once its Ready has 10 s left, and a check keeps that past the time a READY lost once takes to land (D-39, §7.4). |
| C-42 | Play-again presses come at different times; a player's old pack may be full. | D-12; §2. **M3:** a press's timeline ID leads with the old match's tick at the press, so every page ranks one match's presses alike, the earliest winning (D-12). |
| C-43 | L334's "need only a docs update" and L347's "moves three apps at once" are inaccurate. | §2 |
| C-44 | The notes describe roslambo's integrator and cost imprecisely. | §2: the cost now; the event cap only once M0 has measured it, **applied after M0** |
| C-45 | A `workers.dev` address shows the account's name. | Settled by Q-5: terriest.com, with `workers_dev` off |
| C-46 | The earlier sibling deploys signed in with wrangler's full-account login, not the scoped token their docs describe. | Settled by Q-6: you chose the full login |
| C-47 | Holding sideways in ball view spirals outward, about 0.3 m a lap from 3 m away, because each tick aims along the tangent. | Accepted, or an inward correction tuned at M2 (D-7). **M2:** accepted, with no correction built. The tuning page's C-47 scenario shows the drift a lap |
| C-48 | At 70%, the goal's netting sends a ball shot in at 5 m/s back out at 3.5 m/s during the celebration, at odds with "a goal bulges the net" (L101). | §2: a softer netting, tuned. **M2:** settled provisionally at 0, the largest bounce tried at which every test shot, with nobody near, stays wholly behind the line through its celebration. At 0.3 all 18 come back out, a 10 m/s high shot 8.5 m onto the pitch. `netting.test.ts` holds it in the gate (A.5). Pushers that follow the ball in can still bring it back out over the line, less than at 0.3: four on a line in ball view bring its centre back to 18.4 m, 1.6 m in front of the line, against 14.1 m at 0.3 (M2's review; research/tuning/REPORT.md §2.7) |
| C-49 | The mesh cap counts browsers, not terriers; bots aren't peers. | §2 |
| C-50 | L217 keeps results only on the peers that saw the match end, so a player who reloads on the results screen would lose them. | D-17: a browser that arrives while others are still on Results gets them from a peer; §2. **M3:** tested over the network simulator: a browser that arrives or reloads on Results adopts the end and shows the same results, and nothing is abandoned once the end is final (D-17). |
| C-51 | L43's bandana pattern can't be read at most play distances on the Pixel 8a held sideways. With a 45–60° vertical field of view and about 355 CSS px of height, a 6 cm band is 1.8–2.6 CSS px tall at 10 m and a 2 cm stripe under 1 px (research/audit/REPORT.md §9), which the low setting aliases. Each half's floor is also in its pack's colour (L68). | §12's palette test, pack against pack and against both floors; the look book at phone size; a pack cue offered at Q-11 |
| C-52 | On Windows, the Sticky Keys shortcut, on by default, opens a prompt after five Shift presses, and Shift is zoomies (L77). The prompt takes focus, so every key is released (D-29) and the terrier stops until it's dismissed. | Zoomies stays on Shift (L77). The README says how to turn the shortcut off, and on Windows only, the keyboard's control hint says so too (D-29). |
| C-53 | L102 lists no goal whistle, but L202 has one, and L265 rules out sound beyond L102's list. | §2: a whistle with a goal's chorus, at the confirmed tick (D-32) |
| C-54 | hermet's checks have gaps, found by M1's review. The dist audit misses a host written with an upper-case scheme (`HTTPS://`), one in a JS string that starts with `//`, and anything in a shipped `.svg`, whose text it never reads. public-scan misses a home path that ends at the user's name, and the Windows path into WSL (`\\wsl.localhost\…\home\<name>\…`). Its private denylist, `TERRIEST_PRIVATE_TERMS`, isn't set on this machine, so only the built-in patterns run here too. | A hermet change, for your go-ahead, needed before any `.svg` ships (§15). Until then, D-38's lint bans src's root-absolute and `//` URL literals, the e2e guard fails any request a test makes outside its servers, and `public-scan` says when it ran without the denylist. Setting the variable, to a file kept outside the repo, is yours (README). |
| C-57 | L89 keeps a player's camera inside the pitch. So at a wall, in a corner or in a goal, the camera rises or is held close, and loses the ball off the top of the view. In M4's comparison of ball view's camera at the walls, the camera held inside the pitch kept both your terrier and the ball on screen in 31% of the frames at the walls and 63% at your own goal, and moved up to 3.6 m in a frame at a corner. | Settled by your decision of 2026-11-21: "Let's make the walls transparent like plexiglass. This way the virtual camera can go outside of the arena." The walls are clear plexiglass, and a player's camera keeps its place behind its terrier, outside the walls and in or behind a goal too (D-28's M4 note, A.5; §2: L89, L96). The comparison's prototype E kept both in 100% of the frames there, with a largest camera move of 0.55 m a frame against 3.6 m. Its cost on the development machine's GPU, the Iris Xe, was about +0.5 ms a frame at 1280 × 720 and +1 ms at 2560 × 1440, within the drawing budget's calls and triangles; not yet measured on the Pixel 8a, which the performance track's phone run checks (C-2). The look, the camera in and behind a goal, the posts solid from 4.5 m, the gravel apron and the grass round the cage, the spectators' camera unchanged, the cost, and the arrow for a ball behind the HUD's bar are settled provisionally at the comparison's defaults, and owner-pending (`docs/acceptance.md`). |

---

## 4. Decisions

Each decision gives the choice, the options rejected, and the cost if it's wrong. Values marked *provisional* are confirmed or changed by M0 or the tuning.

### Simulation

**D-1 — float64 with exact operations only (roslambo D-1).**
- **Choice:** roslambo's rule, enforced on `src/core/sim/**`, and on the bot brain in `src/core/bot/**` (D-38, D-39), by hermet's exact-ops lint: `+ − × ÷`, `%`, comparisons, bit operations, `Math.sqrt`, `Math.abs/min/max/floor/ceil/round/trunc/fround/imul/clz32`, literals. NaN never occurs; the codec asserts it.
- **Evidence (2026-11-14, this machine):** `sin`, `cos`, `tan`, `atan2`, `atan`, `asin`, `acos`, `exp`, `expm1`, `cbrt`, `hypot` and `sinh` gave different bits in Chromium, Firefox and WebKit; `+ − × ÷`, `sqrt` and `fround` agreed. roslambo's M0 matched four engines over 220,000 ticks under the same rule.
- **Also:** the rule matches names only, so `const { sin } = Math` slips past it. terriest's config test checks that loophole, and its fix is offered to hermet.
- **Cost if wrong:** as roslambo: the goldens and the canary catch it; the fallback is fixed point inside `src/core/sim/math`.

**D-2 — Headings are binary angles, with roslambo's sine and cosine and a new exact `datan2`.**
- **Choice:**
  - A heading is a u32 binary angle (2³² per turn), as L335 asks. Turning is integer arithmetic. roslambo's `angle.ts` is copied: binary angles and `dir`, its exact cosine and sine of an angle, computed together, plus `fractionOfTurn`.
  - New: `datan2(y, x)` → binary angle. It reduces to an octant by comparisons and swaps, takes one exact division, then a fixed polynomial in Horner form, rounded to an integer. It's tested against `Math.atan2` to about 1e-9 of a turn, and pinned by the goldens in all three engines.
  - The polynomial is t·P(t²), odd and exactly 0 at t = 0. The axes then give exact multiples of a quarter turn, and datan2(−y, −x) = datan2(y, x) + 2³¹ exactly, which a test checks, the axes with signed zeros and the diagonals included. So mirrored terriers face exactly opposite ways (P8); a fitted constant term would turn them a unit or more off.
  - It's needed because the ball frame (D-7) resolves a direction against the line from the terrier to the ball, inside the simulation.
- **Rejected:** headings kept as unit vectors, renormalised with `Math.sqrt` every tick. That needs no `datan2`, but every turn and snap gets harder to keep exact, and the animations read turning as an angle. It's the fallback if `datan2` fails a golden.
- **Cost if wrong:** a polynomial error is a tiny direction error, identical everywhere. Low.
- **M0, confirmed, with one change** (research/spike/REPORT.md §8):
  - **Measured:** `datan2` is within 0.500082 binary-angle units (1.16e-10 of a turn) of `Math.atan2` over 400,000 seeded vectors, and within 0.501 units on a 1,000,001-point sweep of one octant. It gives exact quarter turns on the axes, for every signed zero and for magnitudes from 5e-324 to 1e300, and exact eighth turns on the diagonals. datan2(−y, −x) = datan2(y, x) + 2³¹ held on 300,000 vectors, and run 1's goldens pin it in four engines.
  - **The change:** its test's tolerance is within 0.51 units, 1.2e-10 of a turn, replacing "about 1e-9 of a turn" above.
  - **The polynomial** is the degree-14 Chebyshev interpolant of atan(√s)/√s, used as t·P(t²) with 15 coefficients (`research/spike/src/sim/angle.ts`). M2 can copy it.
- **M2:** copied unchanged into `src/core/sim/math.ts`, with roslambo's `dir` and `fractionOfTurn`, and its tests ported at the 0.51-unit bound. The point symmetry holds for every finite input, signed zeros and the axes included; the bot brain reads its angles from the same module (D-39).

**D-3 — 60 ticks a second, 4 physics substeps (roslambo D-3).**
- **Choice:** one input per browser per tick; substeps of 1/240 s. No tunnelling, which a test checks:
  - **Against the pitch's pieces,** which may be thin: a body moves less than its radius in a substep. A terrier at 10 m/s moves 0.04 m against its 0.25 m.
  - **Between two bodies:** they close by less than their radius sum. The fastest, about 25 m/s, closes 0.1 m against at least 0.5 m between two terriers.
- **Cost if wrong:** as roslambo.
- **M0, confirmed** (research/spike/REPORT.md §4, §5.2):
  - **No tunnelling at 25 m/s:** nothing passed through in 624 shots per pitch, plus the floor, the net and terriers, and the fuzzed ball never left either pitch.
  - **Cost:** a step costs 26.5–29.9 µs at 1× in Chromium.
  - **3 substeps,** tried in the cost revisit (§17), cut the back-to-back tick by 27% at 4×. That's the revisit's measure of cost: a 13-step tick's mean with nothing drawn, ticks run back to back, as the median over its runs. But a terrier pressing the ball into a wall then never rests: its state cycles every 2 ticks, by 0.28 mm. They also narrow the slip-out's window: in M0's sweep of 2,880 dribbles, the lowest hop onto the dribbler falls from 43.53° to 42.84° from vertical, nearer the 42° cone (D-5). So 4 substeps stay.
  - **A close call:** the pressing scene is the only test that 3 substeps fails, alone or with 4 or 6 iterations, and it's M0's addition to §16. Without it, 4 iterations with 3 substeps would qualify: none of its 6 drawn runs went over 4 ms, and it took 42% off the back-to-back tick. Only the revisit timed it.

**D-4 — Bodies and the pitch.**
- **Choice:**
  - **Coordinates:** metres. The centre spot is the origin, x along the length, z up. Pack A defends the goal at x = −20, pack B the goal at x = +20. Centring makes mirroring a negation, which is exact in floating point.
  - **The ball:** a sphere, radius 0.8 m, mass 2. No rotation in the simulation (L59).
  - **A terrier:** a sphere, radius 0.25 m *provisional*, mass 1, centred 0.25 m above the floor when standing. The drawn terrier fits a 0.6 m × 0.5 m × 0.5 m box around it (L310), so its nose and tail overhang the sphere by 5 cm along the heading; toward a floor push's contact, 31.6° up, the box reaches 14 cm past it (research/audit/REPORT.md §9), which D-27's drawers keep out of the ball. Turning never changes a collision, so turning into the ball or a wall creates no contact.
  - **The pitch:** a list of bounded static pieces, each a convex shape with a closest-point test:
    - planes: the floor and the overhead net;
    - quads: the side walls, the four cut corners, the end-wall panels beside and above each mouth, and each goal's back, side and top netting;
    - capsules of radius 0.1 m: the posts and crossbars, on the end-wall plane, leaving the mouth 8 m wide and 3 m high clear.

    Nothing in the code depends on the pitch's shape beyond point symmetry about the centre spot, which D-5's mirror pairs and P8 rely on (L69, §2). The list is built from the Configuration. The tests also run a second shape, point-symmetric but not mirror-symmetric: 50 × 30 m, with 6 m cuts at two opposite corners and 3 m cuts at the other two, and a 10 m wide goal mouth.
  - **Mirroring:** pack B's kickoff spots are pack A's point-reflected through the centre spot, (x, y) → (−x, −y). The spots are also symmetric about the long axis, so both readings of "mirrored" pick the same set.
- **Rejected:**
  - A horizontal capsule along the heading, matching the 0.6 m length: turning sweeps its ends into neighbours, 3–6 cm a tick, creating overlaps that the solver must push out every tick. It's the alternative the tuning page can compare.
  - roslambo's half-plane arena: it can't model a goal mouth.
- **Cost if wrong:** the collider is fixed in the goldens, which can be re-emitted until the first release.
- **M0, confirmed** (research/spike/REPORT.md §5.2, §8): the sphere collider, the bounded pieces and the point symmetry held. Each of the 28 pieces' mirrors is exact, the mouth is 8 × 3 m clear, and P8 holds on both shapes. The drawn terrier's box stays out of the ball only with D-27's pushing pose (D-27).
- **M2:** the collider stays a sphere of radius 0.25 m, settled provisionally by measurement: radii of 0.2, 0.23, 0.27 and 0.3 m each shut C-21's window (research/tuning/REPORT.md §2.1). At 0.25 m the drawn box overhangs the sphere by 5 cm, and reaches 13.7 cm past it toward a floor push's contact, 31.59° up.

**D-5 — The contact solver.**
- **Choice,** in each substep:
  1. **Forces:** each terrier's drive or friction (D-6); gravity on every body (step 4 cancels it for bodies resting on the floor); the ball's rolling slowdown while it's on the floor.
  2. **Integrate:** semi-implicit Euler, velocity then position.
  3. **Detect:** every pair of bodies, and every body against the pitch's pieces behind a cheap bound test. Contacts go into one list in a fixed, mirror-symmetric order: bodies interleaved by spot across packs (A1, B1, A2, B2 …, then the ball), so a sum over mirrored partners pairs them. Coincident centres take +z as their normal.
  4. **Floor as support:** a body touching the floor and not moving up is set to z = radius exactly, with vertical speed 0, unless it's the ball closing faster than the threshold, when the ball bounces (0.7). A terrier never bounces off the floor: it lands with vertical speed 0 (L312). A resting ball is then bit-still: gravity and the support cancel exactly.
  5. **Impulses:** accumulated normal impulses, solved by Gauss–Seidel over mirror pairs.
     - **Order:** contacts are taken in mirror pairs in the fixed order. The two contacts of a pair are computed from the same velocities and applied together, then the next pair is taken. Each sweep runs forward, then back, for a fixed number of iterations, 8, which M0 kept (below).
     - **Clamping:** each contact's total impulse is clamped so it never pulls; the step within an iteration may be negative. Impulses are weighted by mass, and static pieces are infinitely heavy.
     - **Restitution:** a contact's target separating speed is its restitution × its closing speed at the start of the substep, when that exceeds 0.3 m/s. Slower contacts settle with no bounce.
     - **No friction:** contacts leave tangential speed alone.

     Mirror pairs computed together keep a mirrored state exactly mirrored: each pair's impulses are exact mirror images, and a sum over mirror images cancels exactly. Steps 6 and 7 keep the same pairing; steps 1, 2 and 4 act on each body alone.
  6. **Positions:** in the same mirror pairs as step 5. Both overlaps of a pair are computed from the same positions, then both moves are applied, by mass-weighted fractions; a contact that is its own mirror is taken alone. 2 passes, which M0 kept (below), without touching velocities.
  7. **Slip-out** (M0 chose the rule, a 42° cone with a slipping flag: below): a ball or terrier resting above a terrier doesn't stay up.
     - **What it does:** the lower terrier moves out sideways, away from the combined horizontal offset of the bodies above it, or along its heading if exactly centred, and the upper body falls. Slip-outs are decided from the positions after step 6, all found before any is applied. A ball below a terrier is an ordinary contact.
     - **The drafted rule fails:** it slips a terrier out at 2 m/s when a contact is within 45° of vertical. But while terriers keep holding toward the ball, two of them hold it up by themselves with contacts between 45° and 56.8° from vertical: at θ from vertical, the ball pushes each out with 9.8·tan θ N, less than its 15 N drive. And inside the cone, the drive turns a 2 m/s slip round within 2²/(2 × 15) = 0.13 m, short of the 0.15 m from the cone's edge to where the ball reaches the floor.
     - **M0 compared** a wider cone, up to just inside the contact of a ball on the floor against a standing terrier (acos((R − r)/(R + r)) = 58.4° from vertical at the provisional sizes), so it never fires on a ball that's down; a slipping flag that holds the drive off toward the body above until that body is down; and restitution 0 on those contacts, which would need a §2 row for L311. The review's models tried some of these (research/audit/REPORT.md §9); each was judged against §16's slip-out cases. What passed was the flag with a narrower cone than the drafted 45° (below).
  8. **Touches and the goal test** (D-8).
- **Restitution:** the ball keeps 70% of its normal speed off the floor, walls, overhead net and goal frame (L308); the goal netting is tuned from 0.3 *provisional*, so a goal bulges the net rather than springing out. Terrier against ball 0.5 (L311); terrier against terrier and walls 0.3 *provisional*; terrier against the floor 0 (L312).
- **Rejected:**
  - roslambo's split Verlet: built for elastic, equal-mass bounces (C-3).
  - Sequential impulses in one fixed order: they bias mirrored kickoffs (C-3).
  - Plain simultaneous (Jacobi) impulses: with several contacts on one body, as when a pack hits the ball together, they create energy or under-solve (C-3). Jacobi with each body's share relaxed (1 ÷ its contact count) is the fallback, if mirror pairs prove awkward.
  - A stock physics engine: none keeps to exact operations (L335).
- **Cost if wrong:** jitter, a creeping ball, pushes that bounce, hits that gain energy. The solver is one module, M0 proves it first, and its tests (§16) catch a regression.
- **M0, confirmed** (research/spike/REPORT.md §4, §5.2): steps 1–6 hold. A resting ball is bit-still, and simultaneous hitters gain no energy. Bounces keep their fractions: off the floor within 1%, which is semi-implicit Euler's error, and off the walls, the net and the goal frame to within 1e-10. Mirrored kickoffs stay exactly mirrored.
- **M0, amended: what the choice left open,** written in as the spike built and measured it (research/spike/REPORT.md §5.2, §8):
  - **Step 3's bound test:** an axis-aligned box per piece, plus an exact broad phase: a body farther from every wall than its reach tests only the planes. In Node, while the spike was built, it cut a step from 52.3 to about 28 µs, with the goldens unchanged.
  - **The floor in steps 5 and 6:** its contacts take part, as contacts that never pull and never bounce, after step 4's support. Every M0 number used this reading, except the comparisons with the floor out. Without it, push times move by at most 0.06 s, but floor hits are slower: one hitter sends the ball off at 2.160 m/s instead of 2.656.
  - **Restitution** reads "its closing speed at the start of the substep" before step 1's forces.
  - **Step 7, the slip-out:** a 42° cone from vertical, at 2 m/s, with a slipping flag. It passes all four of §16's cases (C-21). So does the same rule with restitution 0; none of the other 14 candidates does.
    - **When it fires:** in every substep that a terrier on the floor has a body above it within 42° of vertical, found from step 3's contacts with the positions after step 6. The terrier's speed away from the bodies above is raised to at least 2 m/s, and the rest of its velocity is kept.
    - **The slipping flag** stores the body the terrier slipped from, holds off the drive's component toward that body, and clears once that body is on the floor.
    - **No restitution 0,** so L311 needs no §2 row. If M2 prefers the rule with restitution 0, whose pinches come down sooner (0.30–1.09 s against 0.43–1.65 s), that needs a §2 row first.
    - **Its window is narrow: 42° to 43.2°.** Below 42°, two sitting terriers take over 0.5 s. From 43.23°, the ball of a zoomies dribble hops onto the dribbler inside the cone: that's the lowest hop found, in a case of `slipout.test.ts`, below the 43.53° of M0's sweep of 2,880 dribbles (D-3). M2 rechecks it whenever it tunes the collider, the drive or friction (C-21).
    - **A.1 and A.4 follow:** A.1's flags keep slipping, plus a byte for the body slipped from, and A.4's slip-out row is this rule.
- **M0, confirmed after the cost revisit: 8 iterations, 2 position passes, and the floor in steps 5 and 6** (research/spike/REPORT.md §4). Eight iterations are converged on the hit cases: 8, 16, 64 and 512 give the same speeds. M0's cost clause fired narrowly, so the revisit timed cheaper settings against §16's tests and the drawn reading (§17). The pieces' bound test, the clause's third setting, was already in M0's timings (above). No cheaper setting kept every test green with every drawn run under 4 ms:
  - **6 and 4 iterations** pass every test, and 4 cut the back-to-back tick by 17% at 4×. But both have drawn runs over 4 ms: 4 iterations in 8 of 20 across the revisit and its verification, with a median p95 of 3.95 ms, against 19 of 20 and 4.28 ms for 8 iterations in the same rounds. That's a close call, which a rule on the median would have decided the other way. If the phone run at M5 needs cheaper ticks, 4 iterations is the cheapest setting that passes the tests (C-2).
  - **1 position pass** leaves a terrier pressing the ball into a wall cycling every 5 ticks, by 0.2 mm.
  - **The floor out of steps 5 and 6:** its contacts are 8.53 of a scrum's 11.65 a substep, and taking them out halves the back-to-back tick. But the pressing scene never rests, and 24 of 336 dribbles slip out: the ball hops onto the dribbler at down to 34.4° from vertical, inside the cone.
  - **3 substeps:** D-3.
- **M2: ported** as `src/core/sim/physics.ts`, M0's solver line for line, in its order and arithmetic, over body slots: a terrier's slot is 2 × spot + pack, the ball's 2 × pack size, and a slot is empty while a warm-up pack isn't full. The port reproduces M0's figures to the digits REPORT.md prints, and moves M0's bodies by M0's bits (§16's bit pins). Each value in the simulation's units is computed with the spike's own expression, so its bits match too: gravity times the substep, never gravity ÷ 240, and the cone's cosine as `dir` of 42° in binary-angle units, which is within 1e-9 of cos 42° (`src/core/sim/params.ts`). Steps 1–8 are unchanged but for the fixed warm-up ball (D-8) and one rule, below. Of the restitutions, the goal netting's is settled provisionally at 0 (C-48), and terriers off each other and the walls keep 0.3, since every candidate from 0 to 0.5 passed (A.5).
- **M2, amended: the slip release** (bots-F4 in the code's comments; ccf92c8, c429814):
  - **What it fixes:** M0's slipping flag held the drive's component toward the body slipped from off at any distance, until that body was down. So a terrier that had slipped out couldn't brake or turn back toward the ball. In the scene that found it, a terrier that slipped from the ball coasted away at 3 m/s for 3.6 s, 11 m, until the bouncing ball came down, and turned back toward it only after 3.8 s.
  - **The rule now:** the hold-off acts only while the terrier is within 0.6 m of that body, surface to surface in plan view (`slipHoldOffMetres`, A.4's Slip-out row). Farther out it brakes and turns as it likes, and back within reach, while the body is still up, the hold-off acts again. The flag still clears only once the body is on the floor.
  - **Chosen by an experiment** whose method was fixed before any candidate ran: M0's rule, the flag cleared once the terrier was 0, 0.1, 0.25, 0.6 or 1 m clear of the body, and the hold-off kept to within 0 or 0.6 m of it, each against §16's slip-out cases, M0's sweeps and P8. M0's rule, the flag cleared at 1 m and the hold-off within 0.6 m passed, and the rule took the passing release that reaches least far: the hold-off within 0.6 m.
  - **Its measurements:** in that scene the terrier now turns back after 0.217 s, against 3.800 s, and after a real slip-out 0.667 s after slipping, against 2.233 s. M0's 864 rest cases are unchanged, the worst down in 1.383 s; the sitting pair takes 0.471 s; no dribble slips out; and the pinches come down mirrored in 0.433–1.962 s, against M0's 0.433–1.650 s (C-21).
  - **Its reach is a setting of its own,** apart from the re-arm gap, whose value it first read, so the two tune apart. It's settled provisionally at 0.6 m: 0.5 to 1 m pass §16's slip-out cases, and at 0.4 and 0.3 m case 1's worst ball takes 1.721 and 2.000 s to come down (research/tuning/REPORT.md §2.1). So it's bounded from below only. A longer reach keeps a slipped terrier from braking toward the ball for longer, and nothing measures that.
  - **What it moved:** four of the six bit pins, each from the tick the release first acts, and the goldens, re-emitted on purpose (§16).

**D-6 — Movement and actions.**
- **Run:** target velocity = the input's direction × run speed, 6 m/s, or zoomies speed, 9 m/s. The drive moves the velocity toward the target by at most 15 m/s² × dt, so it acts as a force shared with whatever the terrier pushes. The heading turns toward the target direction at 2 turns/s and snaps onto it within a step; pounces follow the heading.
  - **Pushing:** with the rolling slowdown, one pusher brings the ball to 95% of run speed in about 1.2 s (research/audit/REPORT.md §6). In models of D-5, four reach it in 0.58 s only as an aligned train, one behind another, and 5 cm sideways steps between them slow that to 0.71 s.
  - **Side by side,** as a pack meets the ball, D-5's frictionless spheres add little: in the same models, four abreast took 0.92–1.15 s in the pitch frame, against one pusher's 1.14 s, and 1.0–2.1 s in ball view. There a pusher's drive pushes forward only while the ball is slower than 6·cos of the pusher's angle off its travel (C-18; the models are in research/audit/REPORT.md §9).
- **Idle friction:** with no direction held, or tumbled, or sitting, the horizontal velocity falls at 8 m/s² *provisional*. A pusher at 15 m/s² against an idle terrier then moves it at 3.5 m/s², so idle and sitting terriers can be pushed (L51, L213). The drive and idle friction act only on the floor; in the air a terrier keeps its velocity.
- **Zoomies:** a terrier zooms, with zoomies speed as its drive's target, while zoomies and a direction are held, the meter isn't empty, zoomies isn't locked out, and the terrier is on the floor, not lunging or tumbled.
  - The meter drains only while the terrier zooms, 3 s from full, and refills whenever it isn't zooming, 6 s from empty (L46). A.1 keeps it in half-ticks, so both rates are whole.
  - Once emptied, zoomies needs a release before it works again, so a held button doesn't flicker between zooming and refilling (§2).
  - It's full at every kickoff, with no lockout (D-8).
- **Jump:** from the pitch floor only (not from a terrier or the ball): vertical speed √(2 g × 1 m) ≈ 4.43 m/s, about 0.9 s in the air. In the air the terrier keeps its velocity and can still turn, so an air pounce can be aimed.
- **Pounce:** a press, with no lunge or wait pending and not tumbled, sets the horizontal velocity to 10 m/s along the heading and keeps the vertical speed.
  - **The lunge** lasts 0.3 s, or until it hits the ball, a terrier or a wall, which ends it. Neither the drive nor friction acts during it, so it holds 10 m/s for its 3 m unless it hits something.
  - **During it,** the heading is locked and jumps are refused.
  - **The 1.5 s wait** starts when it ends.
  - **A jump and a pounce** pressed in the same tick: the jump first.
- **Tumble:** 1.5 s, including a 0.5 s get-up. A tumbled terrier can't act and slides under idle friction. Then the tumble guard, 1.5 s *provisional*, protects it. A pouncing terrier tumbles the rival it hits; two pouncing into each other both tumble. A sitting terrier can be tumbled like any other, and sits again once it's up. The ball tumbles by Q-8's rule; with no horizontal offset between the ball and the terrier, the ball's speed toward it counts as 0.
- **Bark:** carried in the input, never in the state (D-10, D-16).
- **Cost if wrong:** feel only; the tuning page shows it, and every constant is in `src/config.ts`.
- **M0, amended: the push figures** (research/spike/REPORT.md §5.2, §8), replacing the models' above. Each is from rest and in contact, with the rolling slowdown, to 95% of run speed (5.7 m/s):
  - **One pusher:** 1.225 s. **In a train:** four 0.575 s, and two 0.779 s.
  - **Side by side:** 0.72–0.83 s in the pitch frame and 0.92–2.03 s in ball view, against one pusher's 1.225 s.
  - **In ball view, two abreast are slower than one pusher,** at 2.033 s. Driving at the ball's centre from 16.5° off its travel, each pushes forward only while the ball is under 6·cos 16.5° = 5.75 m/s, just above the 5.7 m/s mark. Four round the ball, at 1.313 s, are slower than one pusher too; only four on a line, at 0.921 s, beat it.
  - **C-18's marks are set with you at M2.** Ball view is the default view, so a remedy matters most there.
- **M2:** ported as `src/core/sim/movement.ts`, with M0's figures pinned. M0's twelve push times were measured under the drafted slip-out rule, and the port has only the chosen one; they're the same, since no slip-out fires in a push. C-18's marks are set (C-18). At the settled values (research/tuning/REPORT.md §2.5):
  - a terrier reaches run speed from rest in 0.4 s, as REQUIREMENTS says, and a pusher moves an idle terrier at 3.5 m/s²;
  - idle friction stays 8 m/s², provisionally: at 10 or 12 m/s², two sitting terriers no longer let a ball down within 0.5 s (C-21);
  - the tumble guard stays 1.5 s, provisionally: a still terrier that two rivals pounce into in turn, each as soon as it can, is up for at least 1.517 s after every get-up, and tumbled for 0.494 of 30 s, against 0.742 with a 0.5 s guard and 0.396 with 2.5 s.

**D-7 — Steering frames: one input format for all three schemes.**
- **Choice:** an input carries a direction (32 steps, or none) and the frame it's measured in. The simulation resolves it:
  - **Pitch frame:** the direction is on the pitch. Anchored chase view sends this, read from the camera when it's pressed (D-29); screen-relative steering would too.
  - **Ball frame:** the direction is relative to the line from the terrier to the ball: forward is `datan2` of the horizontal vector to the ball, plus the step. While the ball is nearly overhead (horizontal centre distance under 0.3 m, leaving above 0.4 m), forward is the overhead reference: the terrier's heading when that flag set. The flag and the reference are kept in the state. So a held step turns the terrier once, to the reference plus the step, instead of chasing its own heading (L75). The flag, and the reference when it sets, are updated every tick for every terrier, whatever its frame. Anchored ball view sends this.
  - **Nose frame:** for vehicle-style steering. With (f, s) = dir(step), the held direction's forward and sideways parts:
    - **Throttle:** the drive's target velocity is along the heading: f × run speed when f > 0, or f × zoomies speed while zooming (D-6), which in this frame needs f > 0; f × 3 m/s when f < 0, so back brakes, then reverses; and 0 when f = 0.
    - **Turning:** each tick the heading turns by round(s × the nose turn rate per tick), on the floor and in the air but not during a lunge (as D-6). The rate is 1 turn/s *provisional*, a setting in the simulation's configuration from the start.
    - **Nothing held:** idle friction acts as in D-6.
- **Anchored** is the scheme the controls send (Configuration: Steering). All three frames are in the goldens from the first emit, so switching changes only what the controls send (L76, L336).
- **Also:** holding sideways in ball view spirals out slightly (C-47); the tuning page shows whether it needs an inward correction.
- **Rejected:** one input meaning per scheme. That's three code paths, and a switch would change the state's hash.
- **Cost if wrong:** low; the frames are one function.
- **M2:** the three frames are ported as M0 built them, in `src/core/sim/movement.ts`, and all three are in the goldens. C-18's push assist is a rule of the ball frame alone (C-18). Holding sideways in ball view still spirals out, accepted with no correction (C-47).

**D-8 — Match rules.**
- **Phases:** warm-up, start countdown (5 s), in play, celebration, kickoff countdown (3 s), ended. Overtime is a flag on the match.
- **What terriers may do:**
  - in warm-up, every control, and pounces tumble rivals; the ball is fixed on the centre spot and never moves or bowls;
  - in countdowns, turn and bark only; held directions and zoomies act from the first tick of play, and presses during the countdown are dropped;
  - in a celebration, run, turn and bark; nothing tumbles and nothing is counted. The ball stays physical.
- **Kickoff:** at the start of each countdown, every terrier, sitting ones included, is placed at rest on its spot facing the ball, with its pounce ready, no lunge, tumble or guard, a full meter and no zoomies lockout. The ball is placed at rest on the centre spot.
  - **Spots:** Appendix A.5, for each pack size.
  - **Who takes which:** within a pack, terriers sorted by player ID; a bot's ID is derived from its host's (D-39), so the rule covers bots.
  - **Warm-up arrivals:** a joining player, a pack switch or a new bot is placed on its pack's next free spot if no body is in the way. Otherwise it goes to the first point clear of every body, in 1 m steps from the spot toward its own goal line. If none is clear before the end wall, it goes on the spot, and the solver pushes it out (D-5).
- **Touches:** a touch is one contact episode, as roslambo's `engaged` flag is. It ends once the surfaces are the re-arm gap apart, 0.6 m *provisional*, one terrier length. Touches count only in play; every contact counts, including from tumbled and sitting terriers.
- **Goal:** tested every substep. A goal is the ball's centre more than its radius behind the goal line, the end wall's inner plane, while in play. Only the mouth lets the ball behind that plane, which a fuzz test checks at up to 25 m/s.
  - **Credit:** the terriers whose contact with the ball was the latest share it, if they attack that goal, each counting one goal. Otherwise it's an own goal and nobody is credited. The goal counts for the attacking pack either way (L108).
- **Tick order:** events, presence, phase changes, inputs, then the substeps with the goal test, then the clock. So a goal in the tick that brings the clock to 0 counts (L107).
- **Clock:** counts down in every tick that begins in play, so a goal in the last tick still brings it to 0. It stops from a goal until the next kickoff countdown ends.
  - **At 0:** the pack ahead wins; if level, the overtime kickoff, and in overtime the next goal wins.
  - **Every goal gets its celebration**, then a kickoff, the overtime kickoff, or the end.
  - **Overtime** shows its time counting up from 0:00. Match length is whole minutes, 1 to 10.
- **The Terriest:** computed from the final state by the results screen: most goals, then most touches; terriers still level share it.
- **Cost if wrong:** rules are deterministic and tested; a wrong one is fixed in one place.
- **M2: what the rules left open, settled as built** (`src/core/sim/rules.ts`):
  - **The end is terminal:** once the match has ended, a tick only advances the tick. So the final state stays as it was, for Results and for a browser that arrives there (D-17, C-50), as roslambo's round does.
  - **Zoomies in a celebration:** allowed, as part of running, as M0 had it. The meter is full again at the next kickoff.
  - **"Begins in play"** means in play after step 3 (§7.2). The clock counts exactly the ticks played, from the first tick of play, and a goal in the last of them still brings it to 0 (L107).
  - **The last goal** keeps its tick, pack and own-goal flag until the next goal, for the net's bulge; only its scorers clear, at each kickoff placement (A.1).
  - **Events** act in warm-up only. From the start countdown on, the roster is locked and every event is ignored, LEAVE included, so the terrier of a player who leaves then sits, once its inputs have stopped for 2 s (D-16).
  - **Warm-up arrivals** face the ball, at rest. A point is clear when it's strictly apart from every body there, in 3D, the terriers placed earlier in the same tick included. The steps stay inside the floor plan by a terrier's radius, and an arrival keeps the spot it arrived on until the start countdown ranks its pack by ID (A.4).
  - **The warm-up ball** is immovable. It has no contact with any piece, the floor's included, and the forces, integration and support skip it. In its contacts with terriers its inverse mass is 0, so a terrier bounces off it at the terrier–ball bounce and the ball's bits never change. Its contacts set the pushing pose's ticks and the hit's tick and strength, and count no touch.
  - **Credit** goes by the tick: the scorers are the attackers whose last ball contact came at the ball's last contact tick. The first goal of a tick counts, and the ball is out of play for that tick's later substeps.

**D-9 — Everything an animation needs is in the state from the start (L345).**
- **Per terrier:**
  - its animation phase and the tick it started: standing, running, zooming, airborne, lunging, tumbled, getting up or sitting;
  - a gait phase, a binary angle advanced by the distance run;
  - its last take-off and landing ticks;
  - its last contact with the ball and with a terrier, with their ticks;
  - the direction and tick of the last push it received;
  - this tick's change of heading.
- **The ball:** its last hit's tick and strength (the closing speed), for the squash and the thump; the last goal's tick and pack, for the net's bulge.
- **Celebrating is an overlay, not a phase:** the match's celebration phase and the last goal's pack say who celebrates, the pack the goal counts for. The drawing shows it from the goal's confirmed tick (D-14), blending in part-way through (L208).
- **Not in the state:** barks (L98, L209), and anything a model needs that play doesn't, which must be added here now: a field added later changes the hash, the goldens and what peers send.
- **Cost if wrong:** a missing field costs new goldens and a new build. The build hash keeps old and new builds out of one match.
- **M2:** the ball also keeps its last hit's velocity change, the squash's axis: vertical off the floor, along a wall's normal, along the line to a terrier (A.1). The velocity after a hit would get the axis wrong for a glancing hit and for a rolling ball's floor bounce, and the drawer keeps no history to recover it. A mirrored state's horizontal parts are ±0, so P8 holds.

**D-10 — Inputs and presses.**
- **Choice:** one 16-bit input per browser per tick (Appendix A.2):
  - the direction step and whether one is held;
  - the frame;
  - whether zoomies is held;
  - a 2-bit press counter each for jump, pounce and bark.

  The simulation acts once for each new count, so a predicted input never repeats a press, and a tap shorter than a tick still counts, for keys and touch; the pad is read once a tick (D-29).
- **Dropped presses:** a press that can't act is dropped: a jump when not on the pitch floor, or during a lunge; a pounce during a lunge or its wait; a jump or pounce while tumbled, in a countdown, or in a celebration (D-8 allows only run, turn and bark there).
- **Absent inputs:** an absent input means no direction, no zoomies and no presses. It leaves the stored previous input unchanged, so the next present input is compared with the last present one. Absent ticks are routine: after a timer stall, roslambo's timeline sends only its newest 3 ticks, so every peer finalises the rest as absent (D-31).
- **Taking control:** a browser that takes control of a terrier starts its counters from that terrier's stored previous input in the state it adopted (0 for a new JOIN). That covers a JOIN (Play again included), a return (D-17) and a host taking back its bots.
- **Bark:** the simulation ignores the bark counter. A peer plays a remote bark when an input with a new count arrives (D-16), and the sender keeps to one a second (L327). The state keeps each terrier's previous present input to spot new presses, with the bark bits cleared, so barks stay out of the hash.
- **Prediction holds:** anchored steering keeps a held direction's input the same from tick to tick. The stick is read in 32 steps with half-step hysteresis, so a wobble doesn't change it (L342).
- **Rejected:**
  - Held buttons only: prediction repeats them, and quick taps are lost.
  - Analog speed from the stick: inputs would vary every tick and defeat prediction.
- **Cost if wrong:** low; the input is one codec.
- **M2:** as built (`src/core/sim/input.ts`, `movement.ts`), the simulation masks every input to 16 bits, so every number is a valid input, and bits 13–15 never reach the hash. A counter that moves 2 or 3 in one tick acts once, and one that goes round all 4 acts none: A.2's 2-bit counters can't tell that from no press. A returning player's browser and a bot's brain start their counters from the terrier's stored previous input, so their first input presses nothing.
- **M3:** taking control as built (`src/core/session/session.ts`; D-17): the base is the newest input of this browser's own that the adopted STATE's records hold past its tick, which becomes the terrier's stored input, or else the stored previous input; 0 for a page that JOINs again. A resync, which keeps the timeline, takes no new base (M3-Q28).

### Timeline and consensus

**D-11 — Rollback lockstep (roslambo D-7), re-simulating from the earliest changed tick.**
- **Choice:** roslambo's timeline, copied from its code, not from its PLAN's tables: an input delay d = 2 ticks (M3 checks it against a contested ball, D-16), a late window w = 12, a vote window v = 12, a 256-tick state history, the 16-tick input history in every TICK, the joiner warm-up, and roslambo's M0 and 2026-10-25 fixes.
- **Change:** roslambo replays the whole window from the final state every tick. Instead, the timeline keeps each predicted tick's state and the inputs its step used. Each tick it re-simulates from the earliest tick at which:
  - **its base changed:** a resync or a STATE replaced the final state, or a newly final tick's inputs differ from those its prediction used (a terrier with no input at finalisation is absent there, but may have been predicted from its last input); or
  - **the inputs it would now use differ from those it used:** a received input unlike the one predicted, an event merged into a known input, inputs imported from a STATE, or a change in the input a terrier is predicted with.

  Otherwise it steps only the new tick, and finalisation may reuse a predicted state whose base and inputs match. Usually 1–2 steps; the budget still assumes 13 (C-2).
- **Worst ticks:** a resync, a joiner's catch-up and a late-vote repair start from a changed base, so nothing shortens them: about 30, 42 and up to 270 steps in one tick (C-2; research/audit/REPORT.md §9). M0 times them. If one exceeds L286's 50 ms frame in Chromium at 4× CPU throttle, the timeline spreads its steps over several ticks instead, and M3 tests the spread against a full replay.
- **Prediction:**
  - **The newest input:** prediction repeats each sender's input of the newest tick received: roslambo's `lastButtons` is updated only from a tick at or after the one it holds. As copied, it follows arrival order: a TICK records its own input before its history, so filling a lost tick from that history would leave it at the older input, and prediction would act the newer input's press again (D-10).
  - **Silent terriers:** a terrier whose newest received input is for a tick at or before the newest final tick is predicted absent, as finalisation will make it; only one with an input for a later tick is predicted from its last input. roslambo predicts every silent player from its last input forever, so a terrier whose browser is away would never be drawn sitting (D-16).
- **Cost if wrong:** if the change ever disagrees with a full replay, a test catches it, and the full replay is one flag away.
- **M0, amended: the worst ticks** (research/spike/REPORT.md §5.3, §8). In Chromium at 4×, on run 3's two 4-a-side scrums, the plan's at the wall and one in a corner, over 24 runs of 30 bursts (each scrum at the desktop's and the Pixel 8a's sizes, drawn and not, three times):
  - the late-vote repair, 270 steps, takes 30.3–37.2 ms at the median and up to 96.2 ms. It went over 50 ms in 21 of the 24 runs, including all 12 on the plan's scrum;
  - the resync (30 steps, at most 15.5 ms) and the joiner's catch-up (42 steps, at most 23.3 ms) stay under 50 ms in one tick.

  So the spread is no longer conditional: M3 builds it and tests it against a full replay. Its starting cap is 42 steps a tick, the catch-up's size, so a 270-step repair finishes in 7 ticks. M3 checks the cap.
- **M2:** the simulation is ready for it. One `Sim` steps the final state and any predicted clones in any order, since nothing carries from one step to the next (§7.2), and `sameInputs` compares two ticks' inputs as the step would see them (D-12).
- **M3, as built** (`src/core/timeline/timeline.ts`; M3's design §2, research/m3/DESIGN.md; a3bf419, a21351f):
  - **The chain:** each predicted tick's state, a `cloneState` copy of its own, and the canonical inputs its step used, in a ring of `inputSpan` entries. `validTo`, the last valid entry, never drops below the final tick, and every change to what a predicted tick would use lowers it to the tick before (M3's design §2.7): a record or a mark written there, unless it equals what the step used, as a held input's does; a change in the input a sender's unknown ticks are predicted with, from its first tick with neither a record nor a mark; the final tick reaching a sender's newest; and a STATE, whose state and inputs are a changed base.
  - **Marks:** a TICK's clear present bit says the sender has no input at that tick, for good, so the tick is predicted absent, as finalisation will make it. A record always beats a mark (M3's design §2.2).
  - **The mask** (M3-Q12): the simulation takes each input masked to A.1's kept bits, 0–12, so a bark or bit 15 recomputes nothing; the store keeps the whole u16, for barks (D-16).
  - **Reuse:** a newly final tick whose inputs equal those its prediction used takes that entry's state, with no step. So a normal tick steps once, to predict its new tick, plus a re-simulation from the earliest changed tick when a received input differs from its prediction (C-2).
  - **The spread, a timer run at a time:** each advance takes at most the cap times the ticks its clock moved, and at least the cap, finalisation first, then prediction; "a tick" in A.4's row is a tick the clock moved. That bounds each timer task, which L286's frame intervals need (M0: 42 steps took at most 23.3 ms at 4× throttle), and a hidden page's advance, about 60 ticks, catches up at once (M3 phase 2's integration). The cap check times the worst such advance, the one that adopts a STATE included, which steps up to the cap too (M3 phase 5's answers).
  - **The drawn head** is never the final state, which finalisation steps in place, and is never written again: an entry of the chain, or a clone of the final state at the final tick. It moves only when the recomputed chain reaches its tick, so a spread holds it, for about ⌈270 ÷ 14⌉ = 20 timer runs at the cap of 14, about 80 ms when they come every 4 ms, and never moves it back (in the cap check a 250-step repair took 19 calls that stepped, over 72 ms, and 6 over 20 ms at 42); while a repair is spread nothing is confirmed and no vote goes out. The full replay's head takes its tick's state as recomputed (M3 phase 4).
  - **The late boundary** is on the clock outside a joiner's warm-up, the later of the final tick and ⌊clock⌋ − w, so an input every other page finalised absent is dropped here too, during a spread and on a hidden page whose final tick is a second stale; in a warm-up it's the final tick (M3's design §2.8).
  - **The stores' windows:** inputs for ticks after the final tick − 256 up to ⌊clock⌋ + 2w + d, and votes up to ⌊clock⌋ + w, in rings of `inputSpan` ticks, 1,024 at A.4's values, which reuse only a retired slot and refuse a write that would evict a needed tick (M3's design §2.12). A sender outside the roster whose newest tick has retired is forgotten, with all the timeline holds for it, and a STATE leaves out the records of a sender outside the roster at its tick without a JOIN, so made-up IDs can't grow memory without bound; only the roster keeps a silent sender (H5, M3 phase 4a).
  - **The joiner's warm-up** waits for every sender active in its STATE, and for every peer it met, its HELLO arrived, connected or still handshaking: each until that peer's first TICK after the meeting, or until the later of the adoption and the meeting plus `warmupMs`, 0.5 s. A peer met at or after the adoption plus `warmupMs` isn't waited for, so a warm-up ends within 1 s whatever handshakes do, and a joiner's JOIN waits for it (T6, M3 phase 4a). Before that fix, a joiner that finalised before hearing a peer whose handshake was slow split from the room.
  - **Tested against the full replay:** one node of every loopback test checks its chain at every 8th advance and every STATE and changed base, every node of the replay files at every advance, and `twin` runs a `fullReplay` copy beside a node, compared at every final tick both make and at heads of one tick with no spread pending on either (§16).
  - **The cap check** (research/corrections/REPORT.md section 1.10; M3's design §9.6): a 4-a-side match over loss-free 30 ms links, in which the next TICK on each link into one browser is held 4,100 ms from 15 s after the match began, in play, at about tick 900, FIFO holding the rest, so it repairs from a STATE about 240 ticks back, about 250 steps; 20 runs, a garbage collection before each. Every call of that browser is timed in Node, and a run's worst is the slowest call of its repair that stepped, the one adopting the STATE included. The cap of 42 stands if the median of the runs' worsts, times 6.3, M0's ratio of a drawn step at 4× throttle in Chromium to a step in Node, is at most 25 ms, half of L286's 50 ms frame, to six significant figures. Otherwise the cap becomes the largest that meets it, never below w + 1: the candidate comes from the median milliseconds a step, below the cap measured, and the check runs again at it, stepping down until one stands. It decides only on a quiet machine, the 1-minute load average under 1 before its first run and under 2 after its last; WSL2's load can't see the Windows side's, so you're asked to keep Windows idle while it runs (M3 phase 5b's answers). In all 48 runs made before the method, the STATE's adoption was the slowest call (C-2).
  - **The cap:** 14 (M3, by measurement; research/corrections/REPORT.md section 2.5). Every run repaired from 238 ticks back, 250 steps, in play at the hold, tick 899; no browser closed a connection, and no other browser resynced. Whether Windows was kept idle during the five rounds wasn't recorded, and the rule reads WSL2's load alone.
    - **42 failed:** the median of its 20 runs' worst calls was 5.22 ms in Node, 32.9 ms times 6.3, against 25 ms; their maximum 14.5 ms; the 1-minute load 0.94 before the first run and 1.53 after the last. At 0.124 ms a step its candidate was 31.
    - **The step-down:** 31 failed at 6.03 ms, 38.0 ms times 6.3, its maximum 15.6 ms, the load 0.74 and 1.73; 20 at 4.19 ms, 26.4 ms, 7.96 ms, 0.79 and 1.37; 18 at 4.95 ms, 31.2 ms, 17.7 ms, 0.78 and 1.46. 14 stood, at 3.90 ms, 24.5 ms times 6.3, its maximum 5.74 ms, the load 0.81 and 1.04. It's one over a normal tick's worst, w + 1 = 13 (§7.4).
    - **The adoption** was the worst call in 95 of the 100 runs. Its cost a step rose at every round, its median from 0.124 ms at 42 to 0.278 at 14, so each lower candidate could fail again, as 31, 20 and 18 did. The median worst call varied from round to round, rising from 5.22 ms at 42 to 6.03 at 31 and from 4.19 at 20 to 4.95 at 18, by more than 14's margin: it stood at 24.5 ms times 6.3 against 25, within 2%. M4's bench times the repair again in throttled Chromium (M3-Q14).
    - **The profiles again:** at 42 the decisive profiles' largest steps in a timer run were 42, over 14, so every profile was measured again at 14 (`cap14.json`), and rules 1 to 3 read the same there (D-16).
    - **At 14,** a resync's 30 steps and a joiner's catch-up spread over about three timer runs too, where M3's design §2.8 had a resync in one; nothing is confirmed and no vote goes out meanwhile, as for any spread (C-2).
  - **Phase 5b** (600f2f0) changed the tallies alone, D-13's: the chain, the spread, the drawn head and the stores are as above.

**D-12 — Roster events with packs (roslambo D-8).**
- **Choice:** JOIN carries a pack, a coat and the name; SWITCH a pack; READY, UNREADY and LEAVE as in roslambo. Events ride in a peer's input. JOIN, SWITCH, READY and UNREADY are re-sent until the state shows them (roslambo §8.3); LEAVE isn't, as in roslambo, since an absent player is removed before the start countdown anyway.
- **Order in a tick:** LEAVE, then SWITCH, then JOIN, each in player-ID order, then READY and UNREADY. So a SWITCH or a JOIN can take a place freed in the same tick, as Practice's pack swap needs (D-22).
- **Same-tick JOINs** for a pack's last place go in player-ID order. A JOIN or SWITCH for a full pack is ignored, and the session gives it up once a final tick shows that pack full or the start countdown begun: a joining player is offered the other pack if it has room, and otherwise watches; a switching player stays where it is. Switching packs cancels a Ready, and the SWITCH ends the session's Ready wish, so keepReady doesn't restore it.
- **Bad values:** a JOIN or SWITCH naming a pack other than 0 or 1 is ignored; a JOIN whose coat is outside the list takes coat 0. The number of coats is in `src/config.ts`, so the build hash covers it (D-21).
- **Bots** join and leave as JOIN and LEAVE of bot IDs, in their host's TICK (D-39).
- **Play again** (roslambo Q-8): every press goes to the derived room; a browser joins the match there, or proposes it if none exists; two genesis states merge to the older (roslambo D-12). Players keep their pack if it has room, else take the other, else watch. A host's bots keep their pack if it has room, else take the other, else stay out. Spectators stay spectators. A press after the start countdown watches, with a note.
- **Removal** before the start countdown after 180 final ticks without input (roslambo Q-15).
- **Cost if wrong:** as roslambo.
- **M2: the simulation's input for a tick** (`src/core/sim/input.ts`), which M3's protocol and timeline produce:
  - **One `TickInput` per present ID,** final or predicted: the ID, A.2's u16, the event bits, and JOIN's pack, coat and name and SWITCH's pack, each in a field of its own, as §9's events carry them. An absent ID has no entry.
  - **Made canonical before step 1:** an ID that isn't 32 lower-case hex digits is dropped, and the rest are sorted by ID. A duplicated ID keeps the copy whose content sorts first, field by field, so the result never depends on the order the inputs arrived in (P4); roslambo kept the first to arrive. `sameInputs` is D-11's "the inputs it would now use differ".
  - **A JOIN and a SWITCH in one tick** each keep their own pack: a player who switches before the state shows its JOIN sends both, since the JOIN is re-sent. For a non-member the SWITCH is ignored and the JOIN applies, and the re-sent SWITCH lands a tick later. For a member, the JOIN is ignored and the SWITCH applies.
  - **A name** that breaks C-17's rule joins as the empty name: at most 20 code points and 32 UTF-8 bytes, with no C0, DEL or C1 control character and no lone surrogate. M4's `src/core/names.ts` fits a typed name to the rule first, so a fitted name is never dropped.
  - **Every slot freed is vacated:** a LEAVE, a removal or a SWITCH clears every slipping flag that names the slot it frees, so the drive never reads an empty or reused slot (D-5). Practice's pack swap lands in one tick, as the event order intends (D-22).
- **M3, as built** (`src/core/session/session.ts`, `roster.ts`, `bots.ts`; M3's design §4.2, §4.9):
  - **Retries:** JOIN, SWITCH, READY and UNREADY go again once `eventRetryTicks` have passed after their tick is final without the state showing them, but not while the event is still in flight (`Timeline.eventsInFlight`): the re-send waits until its tick is final without it (M3 phase 2's answers). A switch to a full pack is refused at once.
  - **LEAVE:** one that a STATE wiped out, this browser's own input at its tick replaced by an absence, moves to its next own input, so it's sent once. A player's own LEAVE that a repair wiped after it was final here stays lost, and the presence rule removes the player anyway. A host sends a removed bot's LEAVE again in warm-up when nothing of the bot is in flight, since the bot's input keeps flowing, unlike a silent sender's: the one exception to "LEAVE isn't re-sent" (M3 phase 2).
  - **Play again** (M3-Q26): a press proposes in the derived room only if no AGAIN reached it in the old one, and otherwise joins, as roslambo's does. Its timeline ID is `againTimelineId`: the old timeline's tick at the press as a big-endian u32, then 4 random bytes, never all zero, so an earlier press has a smaller ID. A fresh proposal's ID is 8 random bytes; only a match's creator proposes in a fresh room, so outside Play again two timelines meet only after a split, which keeps one ID (995f206).
  - **Which timeline wins** (P7, by roslambo's Q-7 rule, which P7 names): each side weighs each peer's latest announcement, its HELLO's or a later PEERS', by its age at one moment: the tick it gives, plus the time since it came and the one-way delay, in ticks; or the clock, for the timeline held. The older wins, and two within half `stallMs`, 60 ticks, are a tie that the smaller ID wins (`outranks`, `src/core/session/roster.ts`). roslambo's "the later tick, then the smaller hash", and M3's design's `beats`, go. With `againTimelineId`, every page ranks one old match's presses alike, at any spacing and never in a cycle, which roster.test.ts shows under age estimates a quarter of the tie apart (M3 phases 4a and 4).
  - **A merge:** the losing timeline runs on until the winner's STATE is adopted, so nobody is stranded. One merge at a time asks each connection once, the best announcement first, one every `stateRequestRetryMs`, waiting out the answerer's limit of one STATE_REQ answered every `resyncRetryMs`. It ends at an adoption, or once no candidate is left, the page staying where it is. Any adoption ends a merge, then weighs every peer's announcement again (M3 phases 3 and 4a). A page that rejoins or loses a merge JOINs its pack again if its terrier is gone (D-17).
  - **Announcements:** PEERS carries the timeline held, as HELLO does, and goes ahead of the first TICK or FWD to a peer last told of another timeline or none. A TICK or FWD from a peer announcing another timeline is ignored. A page that sends nothing announces a timeline it joined at its next PEERS. Announcements only move to a better timeline, so the comparisons settle on the best one in each connected group, forwarding included (P7's peer side, M3 phase 4a). A HELLO's tick is the clock at the session's last call, so a sleeping page's may be a timer period old, which its next PEERS corrects; accepted, since Play-again IDs don't depend on it. Phase 4a's review removed the rules no test held: a rule to follow a peer, a frozen record of what each peer was told, a warm-up rule for direct TICKs, a merge's refreshed target and a preference for the first peer asked.
  - **A rogue,** accepted under L203 (M3 phases 3 and 4a): one claiming a better made-up timeline is asked once a merge, at most once every `stateRequestRetryMs`, and delays an honest merge by up to that while it stays; one holding the winner's timeline can hand over a made-up STATE, since asking for more than one holder would block honest two-page merges.

**D-13 — Votes (roslambo D-9).** Unchanged: 64-bit MurmurHash3 votes in every TICK; a tally for tick g at local tick g + w + v, 0.4 s later, counts one vote per browser that controls a terrier in its own roster at g, its player's or a bot's; most votes win, smallest hash on a tie; a late vote still counts while its tick is in the history.
- **M3, as built** (`src/core/timeline/timeline.ts`, `votes.ts`; M3's design §3; a21351f, 600f2f0):
  - **Who counts:** a tally for g counts a voter if it, or a bot derived from it, is in this page's final roster at g, and no tally here saw it lose in the v − 1 ticks before g; or if it's one of the voters this page's lineage removed for silence that still reach it, below. A tally with no counted vote trusts this page and moves its confirmed tick, as a lone peer's and Practice's do (D-22); a joiner trusts one only for a tick after the local tick it joined at, less w, since votes for earlier ticks may have gone out before it held the timeline (M3 phase 2).
  - **Own votes** are booked at every finalisation, a repair's replacing the stale ones, and a TICK carries one only while no repair is under way (M3's design §3.1).
  - **Late votes** re-tally only a tick this timeline tallied itself, never one before a joiner's first (M3 phase 4).
  - **A lost tally** begins a resync: the winners' voters are asked in turn, smallest ID first, for a STATE at g with the winning hash, which each answers only while its history holds g with that hash. A candidate this side last asked, by its resync or by the session's join or merge, under `resyncRetryMs` and its one-way delay ago is passed over until then; with only such candidates left the resync waits (H2, M3 phase 4a). With none left it fails, and the next tally that disagrees tries again (M3's design §3.4).
  - **Two voters, or three, whose repairs cross** (C-10, M3's design §3.6): a voter a tally saw lose isn't counted for the v − 1 ticks after the tick it lost, whose votes it sent before it knew. The losers come from every split tally, and from a late vote's split re-tally once every terrier in the roster at g has voted; when this page lost or is repairing, a loser is judged from the others' votes alone; and the marks outlast a repair. A page with a resync outstanding for g still answers a STATE_REQ for a tick before g from one of its own resync's candidates; NO_TICK, and ticks at or after g, it still refuses. So of two resyncs that cross, the earlier tick's completes. M3's design missed that a page's own open resync refuses the other's request, so both fail: at 995f206, two voters at 80 ms split in 10 of 12 seeds, and three voters that each lost a different tick, where a player had left, livelocked (crossing.test.ts, returning-seeds.test.ts).
  - **After a late vote's flip** the history keeps the losing lineage from the lost tick until the repair rewrites it. A STATE_REQ names the hash it wants, and is answered only when the history holds it, so that stretch is never handed out; its only cost is that asks for those ticks are refused (M3 phase 4's answers).
  - **The residual,** accepted: a winner whose loser learns more than v − 1 ticks late, over a slow link or on a sleeping page, can pay one failed resync per divergence of the loser's, `resyncRetryMs` without confirming. That's M3's design's allowance. Holding the marks until the loser goes silent instead would risk two pages shutting each other out (M3 phase 4's answers).
  - **The voters a lineage removed for silence** (M3 phase 5b, flood-F3, the joining split, split-F1 to F4; 600f2f0): a page cut off from the room in warm-up, its incoming links held for seconds while its timers ran, as a joiner whose STATE came seconds late or a spectator held as long is, and either half of a warm-up partition, finalised the others absent and removed them for their silence (D-12), while their TICKs, held on live connections, carried the votes of a lineage in which they played on. Counting only its own roster, each agreed with itself alone for good, the one late-vote loss it saw failing once the tick had left the winners' history. Now a tally for g also counts a voter when (1) its terrier, or a bot of its, left this page's final roster at a tick with no record of it there, as a removal for silence leaves it and a LEAVE, which has one, doesn't; (2) when that tick became final here, it reached this page, by its own connection or through one whose latest PEERS lists it (`Timeline.connected`, which `Session.newTimeline` sets on every timeline it makes; D-19); (3) it's out of this page's roster at g; and (4) it's among as many such voters with a vote at g as the roster at g has free places, 2 × the pack size less its terriers, the smallest IDs first. None of such a voter's votes is set aside by the marks above: whether it saw itself lose, this page can't tell, since its tally counted another roster, so every page of a split counts the other half's votes alike, where setting aside a different few kept both halves winning their own tallies (partitions-4.test.ts). The note ends once it, or a bot of its, is back in the final roster, or its own connection here closes (`Timeline.forget`).
  - **So:** those pages lose their tallies to the room or to the other half and repair by §3.4's resync, and a player among them JOINs again where the winner removed it (D-17); of two halves alike, the smallest hash wins tick by tick (C-10). A held page is no stall (D-31). Nobody is removed while still connected in a normal match, so normal matches are as they were: the correction measurement's smoke runs on 600f2f0 are phase 5a's but for their wall times (research/corrections/REPORT.md).
  - **L201 and L203:** counted voters never outnumber the free places. So with a free place a rogue removed for silence gets only what a JOIN would give it, one vote, and a full room is immune. The first build, uncapped, let rogues that each took the free place in turn, fell silent and stayed connected stop a full room's keeper confirming its match, and outvote it into a state they made up (split-F1, rogue-removed.test.ts).
  - **Measured:** in phase 5b's sweeps, 585 of 586 runs ended in one match, all 534 in a full mesh and 51 of 52 in a partial one, where a87b4c0 failed 118 of the builder's 132. One match came a median 1.1 s after the release, 3.75 s at p90 and 7.75 s at most, a 1-a-side joiner held 10 s. Each of 11 faults planted in the rule failed some test (§16).
  - **Residuals,** accepted (M3 phase 5b's answers):
    - (a) the winning half of a partition can pay §3.6's one failed resync a divergence, as above;
    - (b) a late-vote resync for a tick at the history's edge fails slowly, `resyncRetryMs` a candidate, so a repair takes up to about 4.7 s at 4 a side, and 7.75 s for a 1-a-side joiner held 10 s;
    - (c) a warm-up partition past `removalSilentTicks` in a partial mesh can end in two lineages that differ by one player: seed 9105, 2–2 for 8 s, each page linked to one of the other half. A page that adopted its lineage by STATE never noted the removals before the STATE's tick, and the other side's marks of that lineage's two voters fall on different ticks. A candidate rule: at a STATE's adoption, note the voters in the losing lineage's roster at g missing from the adopted one that still reach the page. It needs a partial mesh and a two-way partition past `removalSilentTicks` in warm-up at once, so M5's acceptance runs watch for it, and the rule waits for a run that shows it.

**D-14 — Goals and the end only from confirmed ticks (roslambo D-10, extended).**
- **Choice:** the score, whistle, scorer's name and celebration show once the goal's tick is confirmed (Q-7). The results screen and the Terriest come from the confirmed end. The ball entering the net is drawn from the predicted state as usual.
- **Latching:** roslambo's `isConfirmed(t)` is false for every tick while any repair is under way, so the UI doesn't ask it again each frame.
  - The UI latches each goal, keyed by its tick, once `isConfirmed(its tick)` holds, taking it from the final state. The score, the scorer's name and the celebration overlay (D-9) read the latched goals.
  - It withdraws a goal only when a completed resync's final state no longer has it (C-4).
  - The whistle and chorus play once per goal tick.
- **Cost if wrong:** 0.2 s of delay on a goal. Q-7's alternative is a one-line change.
- **M3, as built** (`src/core/session/scoreboard.ts`, `timeline.ts`; M3's design §3.5; a21351f):
  - **The latch** reads a timeline's ID, its final state and tick, whether it's repairing, `isConfirmed` and `hasGoalAt`. A goal at tick L latches once `isConfirmed(L)` holds, its scorers from the final state, else from the state this page arrived with, else from the rise in each terrier's goal count.
  - **Withdrawal, exactly** (C-4): the timeline keeps its final lineage's goal ticks, recorded at finalisation; adopting a STATE keeps those up to its state's last goal, and a joiner knows the goals from its STATE's last goal on. A goal L stays shown while the final state's last goal is L or `hasGoalAt(L)` holds, so a repair takes back just the goals it took away. M3's design's reading, that goals at least 384 ticks apart outlast a repair's reach, isn't relied on, since a repair can reach further (hosting-H2, M3 phase 4).
  - **Another timeline,** after a merge or a rejoin, withdraws the goals shown and clears the end; the latch starts again from the adopted state's score.
  - **The end** latches once the final state has ended and its phase's start is confirmed. P9 is tested in consensus.test.ts and scoreboard.test.ts, and in every page's goals in the three-engine match (§16).

**D-15 — The tick clock (roslambo D-11, as amended).** Unchanged, with roslambo's M0 corrections and its 2026-10-25 fixes for windows whose timers sleep.
- **M3, as built** (`src/core/timeline/clock.ts`, `src/core/session/session.ts`; M3's design §1.6; 4da2086, a87b4c0). roslambo's clock and its 2026-10-25 fix, every gain, limit and period from configuration (A.4's row for the join warm-up and the tick clock), samples from direct TICKs only, none further off than the stores' rings reach, and three changes:
  - **The jump with one peer:** past w/2 on the median offset, a jump moves the whole median with two or more peers' offsets counted, and half of it with exactly one, to the midpoint of the two clocks; every offset moves by the jump made (`stats.lastJump`; the log reads "jump <made> of median <median>"). So two pages alone with each other that jump at one rebalance meet rather than cross, and one that jumps alone closes half the gap, the rate the rest. With the whole median, at 1 a side between two people, a page frozen under `stallMs` that took its held TICKs before its late timer run jumped about 10 ticks on stale samples; then both pages jumped toward each other at each rebalance, swapping sides every second for 30 s in 3 of 16 seeds, and seed 601 lost the inputs of 45 of its own final ticks in 20 s (M3 phase 4's review). roslambo's rebalance has the same rule, so its 1-a-side matches between two people may swing too: yours, as roslambo isn't touched (C-56).
  - **No sample across a freeze:** the timeline tells the clock of every timer run, paused or not (`TickClock.ran`). A freeze is a gap between runs over d + w ticks, 233⅓ ms at d = 2 and w = 12, after a gap within it: no new setting. A TICK handled more than d + w ticks after the last run whose own gap was within d + w, or within d + w ticks after a run that ended a freeze and before the next run, was held for this page through the freeze, so it's no clock sample, though it still counts as heard. A freeze straight after another, with no run on time between, can't be told from a hidden page's wakes, so its held samples are kept.
  - **No round trip a freeze held** (C-12, M3 phase 5a): none over `stallMs`; none whose pong this page's clock held through its freeze (`TickClock.holding`); and none during which the peer's TICKs fell silent for over d + w ticks and came back in a catch-up, its phase at the cap or a tick skipped, after the ping went out. A pong during the peer's silence waits for its next TICK; for a peer whose HELLO announced a live timeline and the player role, the time before its first TICK counts as a silence; and a silence the peer's clock explains, a jump back, or the network does, a step in latency, ends in its next tick, so its round trip is taken, as is a held link's. The one-way delay is half the smaller of the last two taken: a 50 → 150 → 50 ms step is followed within two pings and a round trip (rtt-step.test.ts). The load run's diagnosis cleared these rules of its failure, which was the machine's message path's: 4da2086, from before them, and 71bd4a7 passed alike in an A/B on this machine, and give the same figures in a model of the room (§16).
  - **What they fixed:** at a21351f, messages-first freezes of 0.5–1.9 s gave 59–81 jumps a page and 123–145 of its own final ticks without input; at 4da2086, 192 freeze runs (16 seeds × 0.5, 1 and 1.9 s × both thaw orders × 1 and 2 a side) and a 4,000-run sweep of freeze phases jumped no page. Phase 5's review still found round trips a freeze inflated moving the clocks: every messages-first run jumped, and freezes of 500 ms every second leapfrogged at 1 a side, 186 jumps in 7 of 16 runs, the page that never froze missing 100 of its own inputs (clock-F1). Since a87b4c0, under periodic freezes and back-to-back ones, a page that never froze makes no jump and misses none of its own inputs (rtt-periodic, rtt-periodic-two, rtt-double), and at most one half jump comes, at the frozen page. With the round trips fixed, the whole-median jump no longer leapfrogs under periodic freezes, but still does after back-to-back freezes thawed messages first, whose held TICKs are kept as samples, so the half jump stays.
  - **The trade-off,** kept (clock-F2): at 1 a side the half jump makes convergence from a genuine offset 2–4 times slower. ±8 to ±20 ticks off took 0.6–1.5 s on average at a21351f and take 2.3–3.2 s now, and −120 ticks 1.2 s, now 4.2 s, with up to 12 times the late inputs and twice the resyncs when the offset page is behind; +120 takes 1.8 s against 2.7; 2 and 4 a side are unchanged. stalls.test.ts pins it: ±20 and ±120 ticks off close to within 1.5 ticks in 6 s at 1 a side, measured at 3.1–4.8 s. Two lone pages that each see the other off must meet, and a genuine offset past w/2 mid-match is rare once freezes' samples are dropped: a freeze doesn't move a wall clock, and drift is the rate's to correct.
  - **The cadence:** how many samples the freeze rule drops depends on how the engine runs timers. In the headless engines, with the page held by frames of 150–200 ms, it dropped 26–28% in Chromium, 13–92% in WebKit (at 250 ms frames the kept samples' median age was 559 ms) and at most 8% in Firefox. A page whose frames take 200 ± 50 ms loses about 10% more of its own inputs late, accepted. M4 measures it again with real frames; WebKit's timer gaps reached 1.76 s at 250 ms frames, near the 2 s stall, a D-31 risk.
  - **Residuals,** accepted: a rogue's direct TICKs off the clock move an honest page's median, by half the forged offset with one honest peer (L203); a peer that sends no TICKs inflates the one-way delay this page takes for it while it freezes (C-12).
  - **A residual the load run's diagnosis found** (§16), which M3 leaves: the freeze check (`frozeSince`) and the round trip left pending through a peer's silence can read a gap this page's own lag caused as the peer freezing, and pass over a round trip they should take. In a model of the room under back-to-back freezes, that roughly doubles the gap between the one-way delay estimated and the true one, from 2.2 to 4.1 ticks, and raises the clock jumps from 0.05–0.07 to 0.08–0.13 a page-second, with no collapse. A port of the round-trip fix to roslambo would carry it (C-56).

**D-16 — What a peer sees between corrections.**
- **Smoothing (L207, L208):**
  - A correction moves the drawn ball and terriers by an offset that decays over about 100 ms, 50 ms for your own terrier (M3, by measurement: 200 ms and 100 ms, below). Bodies in contact in the corrected state share one offset decay, so a corrected push never draws the pusher inside the ball or apart from it, and cameras aim at the drawn poses. The offset is clamped inside the pitch, and dropped at a kickoff reset rather than smoothed across it.
  - An animation a correction takes back blends out, one it adds blends in part-way through, and one it moves blends to its new timing.
  - Drawing never writes to the state, which a test checks by hash.
- **Barks:** a timeline accessor gives the input actually received for a tick, never a predicted one. A remote bark plays when that input's bark count changes (L209).
- **The away mark:** from the state. From the start countdown on, a terrier sits after 120 final ticks (2 s, D-31's stall threshold) without its browser's input, and is back from that browser's next final input (L138, L167, L213). A hidden page's timers wake about once a second and send only the newest 3 ticks, leaving 56–58 silent ticks between its bursts, so at 120 its terrier never sits (research/audit/REPORT.md §9).
- **Cost if wrong:** looks only. M3 measures correction sizes with bots contesting the ball over the network simulator, and the glide is chosen from them (A.4); M4 checks it with the bench's virtual peers.
- **M3** (`src/core/timeline/timeline.ts`, `src/core/session/summary.ts`; M3's design §2.11, §9; research/corrections/REPORT.md):
  - **A correction** is every re-simulation that recomputes the tick the drawn head shows, whether anything moved or not, as §17's "at every rollback" reads, and it says whether its base came from a STATE, a repair's (`onCorrection`). Its sizes are `correctionSizes`': the ball's change of position, each remote terrier's change of position and heading, and the own terrier's apart. The match summary keeps their p50, p95 and max from fixed bins, a repair's apart, for M4's readout (M3-Q24).
  - **The method** (research/corrections/REPORT.md section 1): committed at 0ab6b24, before anything was measured, as M3's design §9.1 asks, and amended at 71bd4a7, before too, so that every run writes outside the tree and the files are committed together, unmodified, once the last is done. No rule changed, and the measurement runs at 71bd4a7, whose `src`, `dev` and `scripts` trees are 0ab6b24's, or at a later commit with those trees, the tree clean (M3 phase 5b's answers). Its section 1.14 lists the 18 points where it makes M3's design §9 precise.
  - **What decides:** rules 1 and 2 read the steady corrections' p95s at the loss-free 80 ms profiles: those that moved the body, weren't a repair's and didn't cross a phase's start, as one does whose drawn head before and after differs in its phase or in the tick that phase started. A repair's correction is governed by w and the loss rate, not by prediction. One that crosses a phase's start, most often a kickoff placement drawn a tick early or late because a late Ready or input moved a countdown or a goal by a tick, is a snap no glide should hide, which M4's drawing snaps (D-27; M3 phase 5's answers). Both are reported apart and decide nothing; nor do the rules read on every correction that wasn't a repair's, placements included, which results.json gives beside them. In one smoke run at pack size 1 and 30 ms (4da2086), the own terrier's p95 was 6.55 m with the one correction across a phase's start and 0.0248 m without it. Rule 3 reads rule 1's d; the lossy profiles decide only rule 3, and the partial meshes nothing.
  - **Known before it,** as the method says: phase 5a's runs of `pack4-80ms-d2-loss0` at its 6 seeds already fix both of rule 2's values at d = 2. The remote terriers' p95 heading correction, 56.3° at its interval's upper end, is 375° a second over 150 ms, over half the turn rate, so `smoothingMs` is 200 whatever the other pack sizes show; and the own terrier's steady 24.2° is 484° a second over 50 ms, so `ownSmoothingMs` is 100.
  - **d:** 2, kept by rule 1 (M3, by measurement; research/corrections/REPORT.md section 2.2). From d = 2 to d = 3, the steady p95 ball correction at the loss-free 80 ms profiles falls by 12.27% at pack size 1 (0.170 to 0.149 m), 24.95% at 2 (0.206 to 0.155 m), 30.62% at 3 (0.201 to 0.139 m) and 35.79% at 4 (0.171 to 0.110 m), with 90% intervals of [−12.2%, 32.0%], [−14.0%, 38.8%], [3.2%, 38.9%] and [17.3%, 56.5%]. d = 3 needs at least 25% at every pack size with the interval wholly above it: pack size 1 falls short, pack size 2 just short, and no interval clears 25%. The figures are the same at the caps of 42 and 14.
  - **The glide:** `smoothingMs` 200 ms and `ownSmoothingMs` 100 ms, by rule 2 at d = 2 (M3, by measurement; research/corrections/REPORT.md section 2.2), as phase 5a's runs had fixed them. Those runs were of code before a87b4c0's last fixes, so only the values agree: at the measured code `pack4-80ms-d2-loss0`'s steady p95 ball correction is 0.171 m [0.152, 0.201] and its remote headings' upper end 60.0°, against their 0.217 m [0.192, 0.230] and 56.3°. The steady p95s at their intervals' upper ends, at pack sizes 1 to 4: the ball 0.217, 0.248, 0.225 and 0.201 m, the remote terriers 0.0694, 0.0674, 0.0692 and 0.0654 m, and their headings 56.3°, 56.3°, 59.3° and 60.0°, which need 156–167 ms at 360° a second, so 150 ms fails; your own terrier 0.0985, 0.0626, 0.0343 and 0.0314 m, and its heading 21.8°, 12.0°, 29.1° and 24.2°, which need 33–81 ms, so 50 ms fails at three pack sizes. Bodies in contact share one decay, as above, and M4 checks the values with the bench's virtual peers.
  - **The away mark,** as planned: a silent player's terrier, and the bots of a host that's away, sit in every peer's predicted state within the sit threshold plus w ticks, and a page throttled to one timer a second never sits (hidden.test.ts).

**D-17 — Returning players and abandoned matches.**
- **Returning:** opening a `#join=` link connects first. If the received state's roster holds this browser's player ID, or bots derived from it, the browser takes control at once and skips Join (L215). roslambo used its ledger for this, which terriest doesn't keep.
- **Abandoned (Q-16):**
  - From the start countdown on, when this browser controls no terrier and no browser that does (a player's, or a spectator's that hosts bots) has been heard for 30 s, counting from this browser's arrival if that is later, the match is over for whoever remains. A spectator learns it from the silence.
  - Before the start countdown nothing is abandoned. Silent players are removed (D-12), and a match with no browser that controls a terrier waits in warm-up for players: one whose proposer watches while friends open the link (L130, L163), or a Play-again room a spectator proposed.
- **After the end:** a browser that arrives while others are still on Results takes the final state from one of them and shows Results too, which §2 adds to L217 (C-50).
- **Cost if wrong:** low.
- **M3, as built** (`src/core/session/session.ts`; M3's design §4.6, §4.7):
  - **Returning** (M3-Q28): on adopting any STATE, a join's, a return's, a rejoin's after a stall or a merge's, a page whose ID is in the roster takes control at once, with no JOIN, and its input source takes its base from the session's `onControl` (D-10); on the page's first timeline that's a return, and the UI skips Join (L215). A page that pressed Play whose terrier is gone, removed while it was away in warm-up, on a merge's losing side, or by the room while the page was cut off from it in warm-up and has since repaired to the room's state (D-13), JOINs its pack again, from 0. A reload is a fresh page, which starts undecided, on Join (L137). The host's bots are hosted again, each brain from the newest record of its own past the STATE's tick, and wanted bots that aren't in the roster JOIN again.
  - **Watch on return:** a returning page that chose Watch takes control at once too (page-F5). Whether Watch on return should sit its terrier out is M4's, with the screens.
  - **A Leave pressed while a stall decides or a merge waits** takes no control at the adoption: its LEAVE goes again in the new timeline, and its bots are removed.
  - **Abandoned** (Q-16, M3-Q18): heard means a TICK, direct or forwarded, from a browser whose ID or a bot derived from it is in the final roster; votes and PEERS don't count, since a browser that controls nothing sends those too. Nothing is abandoned once the final state has ended, so a spectator still on Results reads Results (abandoned.test.ts).
  - **After the end** (C-50): a browser that arrives or reloads on Results adopts the end from a peer and confirms it at its first tally (returning.test.ts).
  - **The real controls' rebase on return** is M4's to test through the real page, since M4 builds the keyboard and gamepad: its reload in play presses before the reload, and checks that the first input after the return keeps the stored counters (page-F4). At M3 the session's `onControl` tests and NetGame's pass-through cover it (game.test.ts).

### Networking

**D-18 — Trystero 0.26.0, unpatched, through hermet's room config (roslambo D-13).**
- **Choice:**
  - roslambo's `trystero.ts` and `room-config.ts`, with `appId: 'terriest'`, its own action name, and no passive rooms.
  - `maxReceiveBytes` stays at roslambo's 1 MiB, and never below 16,384: every message, STATE included, is at most 16,000 bytes by construction, and the same budget also limits Trystero's own signalling. M3 checks that the largest STATE, a late-vote resync's (about 10.4 KB at 8 terriers, research/audit/REPORT.md §9), carries all its input ticks without the encoder dropping any.
  - Only `src/net/trystero.ts` imports Trystero.
- **Cost if wrong:** as roslambo.
- **M3, as built** (`src/net/trystero.ts`, `room-config.ts`; M3's design §5.5, §6.3):
  - **The largest STATEs,** with M3's ID table (§9), each carrying every input tick (sizes.test.ts): a late-vote resync's in play at 8 terriers with 32-byte names, from 255 ticks back, 10,417 bytes, the 10.4 KB above; one in warm-up, 8 joiners outside the state's roster, 11,817 bytes; and one with 12 senders a tick, 14,785 bytes. Without the table, the warm-up case would have been about 43 KB, and the encoder would have dropped most of its records (M3-Q27).
  - **Trystero's frame:** every message, with Trystero 0.26.0's 36-byte inline header, fits its 16,384-byte frame, so nothing is chunked (§7.4).
  - **The room:** hermet's room config, typed against `JoinRoomConfig`, its relays never empty, `iceServers` always set (STUN from `third-party.json` for `ice: 'default'`, none for `'none'` and `'local'`, a player's TURN appended), `passive: false`, and the mDNS loopback rewrite only for `'local'`, which only the specs' specially launched engines use (room-config.test.ts, third-party.test.ts). Relays given replace the curated ones and ignore any extra; an empty list is refused.
  - **`TrysteroRoom`:** roslambo's two-round handshake, a HELLO each way then a verdict each way; a handshake that fails after this side's part comes back through Trystero's `onJoinError`. Its action handler catches what the session throws and throws it again on a microtask, so the page reports it with its stack and Trystero never logs it as its own. `drop` closes a peer and refuses its ID from then on. It leaves the room on `pagehide` as well as on Trystero's own `beforeunload`, so that M4's leave prompt may keep `beforeunload` from Trystero while the player decides (M3-Q20). `src/net/trystero.test.ts` tests it against a mocked Trystero. **M4:** its `pagehide` listener is the page's one, which every room adds: it leaves each open room, and in WebKit then at once closes every connection the page's rooms joined, a left room's too, by `RTCPeerConnection.close()` alone, so a far side sees one SCTP abort, which Trystero ignores. Trystero's leave closes no joined connection: after 99 ms, which an unloading page never reaches, it only detaches the room, and Trystero keeps the connection idle for 123 s before its destroy closes it, channel first. And WebKit's teardown, left to close them, resets each channel's stream before its abort; a far side that completes the reset with one of its own sends caught between ends the channel with an empty `data-channel-failure`, which Trystero logs as a peer error, and which failed the screens match's reload now and then. Closing the channel first, as Trystero's own destroy does, can too. The other engines' teardowns reset no stream. In the room spec's runs no far side saw Chromium's page close end any of the closed watcher's connections before the test closed that far side, 0.1 to 1.2 s later, so they went by its leave, or by Trystero's disconnect path, at 11.3 to 11.7 s, when its leave was lost; and Firefox's teardown aborts at once, 1 to 15 ms after its leave reaches a far side. A far side busy enough to send once an abort has landed, before it has taken the leave, fails that send, and WebKit logs "Error sending binary data through RTCDataChannel.": closing at once in Chromium too let the abort overtake the leave so, which failed the room spec once in 15 runs, and Firefox's own teardown did it in 3 of the room spec's 23 instrumented runs, at its browser's close after the checks. A page is in WebKit when its `navigator.vendor` names Apple, as every WebKit browser's does and no other engine's. `src/net/trystero.test.ts` checks the leaves and then, in WebKit alone, the closes, all in the listener's one task, and the reload specs check that WebKit's reloading page had closed every connection it had connected by its look after `pagehide`. Residuals: a WebKit far side of a WebKit or a Firefox page that goes can still log that failed send, a console message only: Firefox's teardown let it before too, and a WebKit page's teardown let it with the empty `data-channel-failure` besides; no spec has either go before its checks; and a connection whose handshake is in flight or failed is still the teardown's, since Trystero lists neither among a room's peers and keeps a failed one idle for 123 s; the reload specs' check would fail on one, and none of their reloads follows a refusal. Closing those too needs every connection Trystero makes, through the room config's `rtcPolyfill`, which terriest could set on the config hermet's builder returns, or the builder could take: a hermet change, pushed only with your go-ahead (D-37, §17).
  - **Loaded lazily:** only `NetGame.open` imports it, so its chunk, Trystero with `@noble/secp256k1`, never loads on a normal page, the determinism page or Practice (L238, P10, D-38).

**D-19 — Forwarding for pairs that can't connect (roslambo D-14).** Unchanged.
- **M3, as built** (`src/core/session/session.ts`; M3's design §4.10, §6.5; a87b4c0, 600f2f0):
  - **Who forwards:** for an origin A and a receiver B without a link, the page with the smallest player ID that's connected to both and announces the timeline held, as A's PEERS says. A candidate X counts when its ID is smaller, it holds this timeline, X's PEERS lists B, and A's PEERS lists X, or, before A's first PEERS, X's lists A. B is passed over when A's PEERS lists B; before A's first, when B's lists A, or when neither has come. A B whose PEERS hasn't come is relayed to only if it holds this timeline. roslambo read B's or the candidate's PEERS, which can overtake the TICKs A sent before their link opened (mesh-F1, mesh-F3). Only a page whose timeline has started forwards, and only TICKs it took. A FWD is never forwarded again, and a TICK too large to fit in a FWD within 16,000 bytes is skipped, so an honest forwarder is never closed over another's oversized TICK.
  - **Taking a FWD:** only for an origin with no direct connection here, or one whose connection here hasn't carried a TICK yet; only from a connection whose latest PEERS lists the origin, listed before the origin's own connection here opened; and its bot entries only for bots derived from the origin. A connection speaks for at most `peersMax` origins in any `floodMs`: FWDs past that are dropped, not invalid (§9).
  - **Within the limits:** a forwarder relays a sender's TICK only while the sender's count, §9's flood count, is within half `floodTicksMax`, and its own count of what it relayed to that receiver for that origin is too, so no receiver closes it over another's flood (reviewer H3, flood-F1).
  - **The mesh's joins** (M3 phase 5a): before the fix, a joiner with a smaller ID made every incumbent stand down while it relayed nothing until it had adopted, about a STATE's round trip, 4–6 TICKs at 80 ms, past the 16-tick history's cover. At 6 seeds of the partial-mesh profiles (pack size 4, one or two pairs blocked), one blocked pair at 80 ms went from 8 resyncs, 3 of them failed, and 107 disagreements over 90 browser-minutes to none; two from 6 and 59 to 1 and 1, one forwarded input a tick late in play, at the reach's edge; at 30 ms there were none before or after.
  - **The reach:** a forwarded input takes two hops, each with its own one-way delay and jitter, and the pair takes no clock sample of each other: 80.0 ms a hop at d = 2, w = 12 and 20 ms of jitter (C-55). P5 is tested at 30 and 80 ms (forwarding.test.ts).
  - **A removed voter reached through a forwarder** (D-13, split-F2): D-13 counts a voter its lineage removed for silence while it reached this page, directly or through a connection whose latest PEERS lists it, from which this page takes its FWDs (`Timeline.connected`, 600f2f0). Counting only those with connections of their own, each page of a warm-up partition in a partial mesh counted fewer of the other half than its own half held, and both halves kept their lineages under one timeline ID (partitions-mesh.test.ts).
  - **The residual,** accepted (M3 phase 5a's answers): the election reads X's PEERS alone, so a handshake whose two ends complete more than a one-way delay apart can leave B unrelayed for that skew, at most about one SCTP flight, which the 16-tick history covers within the late window.

**D-20 — Binary messages (roslambo D-15), widened for terriest's inputs.**
- **Choice:**
  - roslambo's framing, decoders that never throw, and the 16,000-byte limit.
  - TICK, STATE and the bot entries carry the 16-bit input.
  - The 16-tick history marks "same as the next newer input" in one mask, so a held anchored input costs a few bytes.
  - JOIN gains pack and coat; SWITCH is new. The protocol version starts at 1.
- **Size (estimate):** a TICK is about 35 bytes, plus about 30 per hosted bot. M3 measures the traffic.
- **Cost if wrong:** low.
- **M3, as built** (`src/core/protocol/messages.ts`; §9): a TICK is 28 + 2m bytes, where m counts the history's inputs that differ from the next newer, so a held anchored input with its whole history costs 28 bytes, against the estimate's 35; each bot adds 23 + 2m. PEERS is 24 + 16n bytes, for n IDs, and HELLO 51 + n, for an n-byte name.
  - **The traffic:** in the 12-page load run at M3's final tree (§16), which passed, a player sent 633 messages and 19.7–21.3 kB a second to its 11 peers: 631 TICKs, 19.3–20.9 kB; 2.1 PEERS, 0.42 kB; and no STATE_REQ, STATE or FWD, in a full mesh. It received 404 messages and 13.1–13.3 kB a second, 402 of them TICKs. A spectator sent 2.1 messages and 0.42 kB a second, its PEERS, and received 461 messages and 15.0 kB, 459 of them TICKs. Those are per second of the machine's clock, which ran about 4% ahead of the pages' own, so the pages ticked 57.4 times a second by it. A broadcast counts once for each neighbour, so a player's TICKs are about its clock's ticks times 11. In the measurement's second 90 s run, which failed with every page's clock at about 45 ticks a second, a player sent 490–497 messages and 16.1–17.8 kB a second, 0.7–0.9 STATE_REQs and 0.14–0.44 STATEs among them, and a spectator 3.1 messages and 0.44 kB. In the correction measurement's loss-free 30 ms profiles, over the network simulator, a browser sent 60, 181, 300 and 420 messages and 2.0, 5.9, 9.7 and 13.6 kB a second at pack sizes 1 to 4 (research/corrections/REPORT.md section 2.3). Smoke runs, which decide nothing, found 60.3 messages and 1.98 kB a second at a browser at pack size 1 and 30 ms (4da2086), and about 641 messages and 19–22 kB a second at each player in a 20 s load run of 12 pages.

**D-21 — The handshake: build hash, spectator count, duplicate IDs.**
- **Build hash** (roslambo D-16): over every constant, the codec and protocol versions, d, w and v, all of `goldens.json` (the canary and every golden checkpoint), and a hash of the `src/core/sim` sources taken at build time. So any change to the simulation's code or its goldens changes the hash, which roslambo's doesn't do (C-13).
- **Spectators:** a spectator is a connected browser outside the roster that has chosen Watch or been refused as a player. Each browser announces its role in PEERS (§9).
  - Only a peer that holds the state applies the counts; one without it admits every HELLO.
  - A HELLO whose player ID is in the roster, or whose derived bot IDs are, is admitted whatever the counts: a returning player or bot host (L139, L214, L215), which D-17 makes HELLO as undecided.
  - Any other undecided HELLO is admitted while the connected browsers outside the roster, counting this one if it's among them, number fewer than 4 plus the free pack places, so the mesh stays within 8 + 4.
  - A peer that chooses Watch, or is refused as a player, counts the peers that have announced spectator, plus itself; a fifth gets "This match has the most spectators it can take" (C-11).
- **Duplicate player IDs:** a HELLO whose player ID is already connected replaces that connection if it has sent nothing for 2 s; otherwise it's refused, as in roslambo (C-12).
- **Cost if wrong:** low.
- **M3, as built** (`src/core/session/session.ts`, `roster.ts`, `build.ts`, `scripts/build-inputs.mjs`; M3's design §4.3–§4.5):
  - **The build hash** (M3-Q3, C-13) covers every `src/core` source but the tests and the three files peers may run in different versions without disagreeing, `src/core/bot/brain.ts`, `marks.ts` and `setups.ts`, whose outputs are inputs like a person's; plus `goldens.json`. Their paths and bytes are hashed at build time, CRLF read as LF, through a Vite define, so the goldens never enter the page's bundle; nettest.spec.ts checks that the bundle's hash is Node's.
  - **REFUSE 3** also meets a HELLO under this browser's own ID or a bot's, since a bot only ever rides in its host's TICK, and a second handshake under way for one player.
  - **Counting** (M3-Q16): every HELLO from outside the final roster counts, whatever role it announces, since a role is a peer's own claim; the honest ones that aren't undecided, a spectator's link re-forming or a merge's other timeline, bring back browsers the mesh already held, as again.test.ts's full room shows. "Counting this one" is the browser applying the check, never the newcomer, so a fifth spectator is refused with four connected. An admitted HELLO holds its place until its handshake joins, fails or times out (`handshakeTimeoutMs`), so a burst whose handshakes overlap can't all pass on one count (C-11).
  - **Watch:** after each adoption a watcher counts the room's spectators again on every timer run, as it meets them, until it has met everyone the STATE's sender's PEERS lists, or for `handshakeTimeoutMs`; a REFUSE 4 from any peer also makes it leave. Two that choose Watch together can both leave, and a burst past the cap leaves as a whole: accepted, since the cap always holds and each can try again.
  - **Liveness** (M3-Q23, C-12): a connection's last message or pong, with a ping to each peer every 1 s. A connection's leave clears its player's state only while the player still maps to it, and a replaced connection's messages are ignored.
  - **The duplicates' log,** `Session.duplicates`, is a diagnostic only: in these engines an unloading page's channels close at once, and Trystero 0.26 ignores SCTP's user-initiated abort, so no check can tell a leave from a closed connection (M3 phase 5).

**D-22 — Practice runs on a local transport.**
- **Choice:**
  - Practice builds the same timeline over a local transport, with the browser hosting every bot, and never constructs a Trystero room or a peer connection. So it contacts no one (L158, L238), which an end-to-end test checks with the request guard and a count of peer connections (§16).
  - Its clock can stop and re-anchor, which is how it pauses (Q-15).
  - **Stalls:** a gap between timer runs longer than 2 s (D-31's stall) opens the menu, which pauses Practice (Q-15), and re-anchors its clock instead of catching up. Shorter catch-ups record the local inputs for every tick, since the newest-3-ticks rule only keeps peers from splitting.
  - **No fragment:** Practice never sets the `#join=` fragment, so a reload goes Home (Q-15) and contacts no one.
  - **Switch pack** swaps the player with the other pack's newest bot: in one tick the browser sends that bot's LEAVE, the player's SWITCH and a new bot's JOIN for the player's old pack, and D-12's order in a tick lands all three.
  - With no other voters, it trusts its own state, as roslambo's lone peer does.
- **Rejected:** a networked room with bots, as roslambo's practice is. That contacts the relays.
- **Cost if wrong:** none.
- **M3, as built** (`src/core/session/practice.ts`, `src/ui/practice.ts`; M3's design §1.17, §1.25; a21351f):
  - **Its timeline** is a networked match's, over `LocalTransport`, which counts what it's offered, drops it and holds no peer, under `practiceSettings`, which keeps every tick's inputs through a catch-up; its ID is 8 random bytes.
  - **Its stalls** (Q-15): the start counts as timer run zero, so a first run over 2 s late stalls it. A stall stops the clock at the local tick and opens the menu; a pause for the menu after a gap of a stall's length re-anchors first, and the resume measures from itself. A timer run that finds the page hidden pauses Practice too, since a page started hidden gets no `visibilitychange`.
  - **Switch pack** queues the new bot's JOIN, the other bot's LEAVE and the person's SWITCH on the timeline itself, since the session's own switch refuses a full pack, and is refused outside warm-up, while the person's JOIN, SWITCH or READY is in flight, or with no bot ID free. A Ready before the person's JOIN is final is dropped: M4's Pre-match offers Ready only once the person is in the roster.
  - **P10:** Practice's glue imports neither `src/ui/game.ts` nor `src/net/trystero.ts`, which `src/ui/practice.test.ts` checks over the static import graph, and `e2e/practice-net.spec.ts` plays it through the page to the bot's first confirmed goal with no peer connection, no WebSocket and nothing requested off the page's origin.
  - **Its setup** (§16): over 21 seeds, the bot's first confirmed goal came at most 16.6 s after the start, seed 7's with Ready pressed 2–3 ticks late, and 10.3 s with Ready pressed at once (src/net/practice.test.ts). Through the page, the countdown starts at tick 23, and the goal comes at tick 609, after 11.7 s.

### Client

**D-23 — A startup canary (roslambo D-17).** A scripted 8-terrier run with pushes, bounces, pounces, tumbles and a goal; its hash is in `goldens.json`. A browser that computes differently gets no networked match: Propose and Join say why, and Practice, which has no peer to disagree with, still plays.
- **M2:** built in `src/core/sim/scripts.ts`: 300 ticks at 4 a side, placed in play. The ball is 4 m in front of pack B's goal line, with pack A's four in a train behind it, holding at it in the ball frame with zoomies in spells, and pack B's four off the train's flanks, pouncing on a schedule into pack A's terriers and the ball.
  - **Its coverage** is asserted from the run's counters, each kept apart: a push, a bounce off the floor or a piece, a pounce, a tumble, a goal and zooming. A count of hits couldn't tell a terrier's hit from a bounce.
  - **Its hash** at the settled values is eea91a8dd7ba3cf4 (§16). It takes 12–15 ms in Node here, so roughly 50–60 ms on a phone four times slower (*estimate*).
  - **Where it runs:** the determinism page computes it, and `canaryHash()` is ready for the app's start. Wiring it to Propose and Join, at start-up or before they first show, is M4's.
- **M3:** the `#test=net` page computes no canary, so it imports no `goldens.json`, and the determinism chunk keeps the canary's hash alone (M3's design §7.3, R-15). M4 wires the canary to Propose and Join, and meets the same check.

**D-24 — localStorage, and one game tab (roslambo D-18).**
- **Choice:** the profile (player ID, name, coat, which inputs have finished their control hints) and the settings, as one key each (Appendix A.3). An unreadable profile is backed up before a fresh one is made. One Web Lock covers the whole app, Practice and watching included, with roslambo's **Use here**.
- **Cost if wrong:** low.

**D-25 — Player ID (roslambo D-20).** `crypto.randomUUID()`, kept apart from Trystero's per-load `selfId` (L347).
- **M3:** the `#test=net` page's player ID is `personId(seed, k)` from its parameters, so the specs' IDs match M2's offline setups' and the network simulator's replays of them (`src/core/bot/bot-id.ts`; M3's design §4.4, §7.2). M4's screens take the profile's.

**D-26 — three.js with its WebGL 2 renderer.**
- **Choice:**
  - three 0.187.0, pinned exactly (MIT). Only `src/render/**` imports it.
  - It already loads glTF and plays skeletal animations (GLTFLoader, `AnimationMixer`), so the model upgrade isn't a rewrite (L345).
- **Rejected:**
  - Raw WebGL 2: a hand-written glTF loader and skinning.
  - Babylon.js: a larger download, for nothing terriest needs.
  - WebGPU: excluded (L234).
- **Cost if wrong:** the renderer is a leaf behind the drawer interface, and C-9's audit check comes first, at M0.
- **M0, confirmed** (research/spike/REPORT.md §3, §5.5, §8): three 0.187.0's WebGL 2 renderer, `compileAsync`, `InstancedMesh`, GLTFLoader, SkeletonUtils and `AnimationMixer` work in all three engines. three's core is 118,806 B brotli, and C-9's audit found one string in it, cleared by an app option (D-37).
  - three's core is one module, so rolldown can't split it. 10,014 B brotli of it serve only GLTFLoader, but they ship on the code-built path too. §12's per-chunk Resource Timing check still passes.

**D-27 — One replaceable terrier drawer (L97, L345).**
- **Choice:** an interface that takes, per terrier and per frame, a pose (the interpolated, smoothed position and heading) and its animation state from D-9, the coat index and the pack, plus:
  - the drawn tick and its fraction;
  - the start of the terrier's latest bark: the tick of the received input whose bark count changed (D-16), or the local press for your own terrier;
  - whether it celebrates, and from which confirmed tick (D-14).

  It returns its drawing counts. It never feeds anything back to the simulation.
- **Code-built drawer** (the MVP default):
  - rounded shapes (spheres and capsules) for the body, head, legs, ears and tail, with a bandana in the pack's colour and pattern;
  - drawn as one instanced mesh per part across all terriers, so draw calls don't grow with the terrier count;
  - coats as instance colours plus a markings index.
- **Model drawer:** GLTFLoader, a skeleton clone per terrier, and an `AnimationMixer` whose actions' times are set from the state every frame.
  - It's a chunk of its own, with GLTFLoader and SkeletonUtils, imported dynamically only when a model is named. Until it and the model have loaded, or if either fails, terriers are built in code (L100), and nothing waits for them. It's still production code, built into `dist/` and audited. M0 measures each chunk.
  - The model URL is a render setting, empty in the MVP. `window.terriestTest` only overrides it, so the test loads through the path a shipped model will take.
  - **Painting:** a model follows a fixed convention. A material named `fur` takes the coat's colour, a markings mask in its texture's channels takes the coat's marking colours, and a material named `bandana` takes the pack's colour and pattern. The drawer sets them from the coat index and the pack, and reports which coats and packs it painted in its counts.
- **Corrections, for both drawers:** they keep blend weights and, for each animation fading out after a correction, the start tick it had, until its fade ends. So an animation that a correction moves cross-fades from its old timing to its new one, and never snaps (L208, D-16). The model drawer holds two actions per clip for this: the clip and `clip.clone()`.
- **Fit, for both drawers:** no part of the drawn terrier enters the ball when their colliders touch: the pushing pose keeps the head behind the ball's surface (D-4). Between terriers, only D-4's 5 cm nose and tail overhang may overlap.
- **The stand-in skinned model** (L252):
  - generated by a script, so no third-party licence is involved;
  - painted by the model drawer's convention, with an embedded texture;
  - kept in `e2e/fixtures/`, never in `dist/`;
  - served by Playwright's request interception to the real built page, named through the pre-load test hook (roslambo's `window.roslamboTest`, as `window.terriestTest`).
- **Lint:** nothing in `src/core/**` imports three, `src/render/**`, `src/ui/**`, `src/input/**` or `src/audio/**` (D-38).
- **Cost if wrong:** contained: the interface is one module, and the stand-in tests it, painting included, before any model exists.
- **M0, confirmed, with these changes** (research/spike/REPORT.md §5.4, §8):
  - **Code-built:** 9 instanced parts, because the bandana is split by pack pattern, and a snout and a face are added. That's 9 draw calls for 8 terriers, at 1,516 triangles a terrier.
  - **The fit needs the pushing pose.** Without it, the drawn terrier enters a touching ball by up to 6.6 cm, running, at the 31.6° contact of a push from the floor. With the pose held for 8 ticks after a ball contact, every phase clears the ball by 0.1–8.2 cm at contacts from 31.6° to 90°.
  - **The model drawer** works as planned. Its chunk is imported dynamically, and the terriers stay code-built until the model has loaded and compiled, then swap. In run 4, with all three engines running at once, the import took 116–1,797 ms, the load 85–1,416 ms and the compile 16–295 ms.
  - **Painting:** `fur` and `bandana` take the coat's and the pack's colours through the material colour. The markings mask needs a shader hook, and the bandana's stripes need a texture or an attribute: both are M4's.
  - **Bones:** `SkeletonUtils.clone` gives each skinned mesh its own skeleton, so 8 terriers of 2 primitives make 16 bone textures. That's inferred from three's source; the model path holds 19–20 textures in all. Binding each terrier's meshes to one skeleton halves them (M4).
  - **Nothing compiles in play (§12):** `compileAsync` compiles programs but doesn't upload geometry, so one render with frustum culling off follows it, before play. With it, programs, geometries and textures stayed constant through every window of run 4.
  - **The stand-in** can be generated in memory by the tests from `scripts/make-standin.mjs`, byte-identical each run, so `e2e/fixtures/` needs no binary.
- **M2:** the pushing pose's 8 ticks (M0's `PUSH_TICKS`) go into A.4 at M4, with the drawer, their first reader. M2's code never reads them: the pose is drawn from each terrier's last ball contact tick, which the state holds (D-9).
- **M3:** across a phase's start the drawing snaps rather than glides: a correction whose drawn head before and after differs in its phase or in the tick that phase started, most often a kickoff placement shown a tick early or late after a late Ready or input moved a countdown or a goal, is drawn at once (M3 phase 5's answers). The correction measurement relies on it: its rules choose d and the glide from the steady corrections alone, and report those across a phase's start apart, deciding nothing, since this snap shows them (D-16; research/corrections/REPORT.md section 1.9). M4 builds it.

**D-28 — Cameras (L87–L92).**
- **Chase view:** behind and above the terrier, its yaw easing toward the heading with a 0.3 s time constant, at most 1 turn/s. The calmer camera uses 0.6 s and 0.5 turn/s. A held, unmoved direction doesn't depend on either (L87); a direction read from the screen takes the camera's yaw at that moment, so a re-read during a swing depends on the setting (Q-19).
- **Ball view:** behind the terrier on the line to the ball, aimed at the ball.
  - **Its swing:** its yaw follows that line at up to 1 turn/s, or 0.5 turn/s with the calmer camera, with no easing lag below the cap. So circling the ball at a run from 3 m (0.32 turn/s) keeps it centred, and only a close pass or a hop over the terrier makes the view lag; with the calmer camera, a fast close pass can leave the view for a moment.
  - **The ball overhead:** while D-7's ball-overhead flag is set, the line has no direction, so the yaw turns at the cap toward the overhead reference, which the ball frame then steers by, and holds there. When the flag clears, it turns toward the new line at the cap, never in a jump.
  - **Steering is unaffected:** the ball frame reads the simulation's line, not the camera. While the view lags, the off-screen arrow points to the ball.
  - Values *provisional*, tuned at M4.
- **Players' cameras** keep their place behind the terrier wherever it falls, outside the walls and in or behind a goal too, since the walls are clear plexiglass (L89, C-57). A goal, the net or the ball between the camera and the terrier fades to see-through.
- **Spectators:** one camera high above one side of the pitch, outside the walls (L91), following the ball or the chosen terrier. The near wall, seen from outside, draws only its kick band (C-57), and the net fades where it's in the way.
- **All cameras:**
  - when the ball is off screen, an arrow at the edge points to it, and so it does while the ball's centre is drawn behind the HUD's top bar (C-57);
  - are each viewer's own, and change nothing in the match.
- **Rejected:** easing ball view as chase view eases. Circling the ball at a run from 3 m, it would lag the line by 34°, or 69° with the calmer camera, against a horizontal half-field of 47–56° on a phone held sideways (research/audit/REPORT.md §9).
- **Cost if wrong:** looks only.
- **M4:** your decision of 2026-11-21 took the players' cameras out of the pitch (C-57). The comparison's prototype E is M4's camera and wall look, in place of research/m4/DESIGN.md §3.2's camera held inside the pitch, risen near a wall and in a goal, and of what the design builds on it: §1.3's `render.camera.raised`, §1.9's `insidePitch`, `ceilingAt` and `Placed.raised` in `src/render/camera.ts`, §3.6's camera tests, the end-to-end test of a camera held inside the pitch through a Practice among them, and §10's `cameraNearestMetres` row; §2.6's occluders change as below:
  - **A player's camera,** in ball view and chase view alike, sits 4.2 m behind the terrier's floor point along the yaw and 2.1 m above it, with a 55° vertical field, aimed as before: no clamp at the walls, no rise and no push off a post. Its only limits are 0.4 m above the ground and 0.4 m under the net, anywhere, which move it only for a terrier more than 1.7 m below the floor or 3.5 m above it, never in play (A.5). So it never jumps: E's largest move was 0.55 m a frame, against the old clamp's 3.6 m at a corner. `cameraNearestMetres`, the rise's distance, is gone.
  - **The walls** are clear plexiglass panes of about 4 m, a post at each joint, a kick band in each half's pack colour from the floor to 0.45 m, and a rail along their tops (§12). A pane the camera is outside of draws only its kick band. The glass is clear within 0.5 m of the camera and all there by 2.5 m; its posts and sheen come in from 1 m to 5 m; and round the line from the camera to its terrier it's clear within 0.5 m and all there by 1 m, between the two only, so a wall behind the terrier keeps its band and posts. Which panes each of its two draws keeps is decided on the CPU once a frame, from the camera's side of each wall's plane, and read by the vertex shader, so the unit tests check the rule that's drawn (C-57's review).
  - **A goal** never moves the camera. Its frame fades near the camera, clear within 1.5 m and all there by 4.5 m, and round that line as the glass does, and so does its netting; a face of the netting the camera is outside of isn't drawn once the camera is past its goal line, so from behind the goal the camera looks through its open back. How much of each face shows is decided on the CPU once a frame, as the glass's panes are. The frame still writes depth, so what's behind a solid post stays hidden, but a fragment its fades leave less than 5% of is discarded, so a post faded out cuts no hole in the shadows, the near band or the dust drawn after it; the frames are drawn among the transparent things, so the discard costs the opaque pass's early depth tests nothing (C-57's review).
  - **The occluder fade** (M4's design §2.6, phase 3) still covers the ball, the goals' frames and the overhead net; the glass's fades, and the frames' and netting's near and line fades, are E's, above. So phase 3's dithered clone of the frames' material keeps its shader hook and program key, the netting's bulge goes into the netting's own shader, which replaced three's line material, and the dust draws between the inner glass and the outer, in the transparent things' order (`src/render/pitch.ts`).
  - **In the scene,** the pitch draws in 8 calls, and a ninth, the glass's outer draw, while the camera is outside a pane's plane. At 4 a side a frame is 19 calls with the camera inside every pane's plane and 20 outside, 18,138 triangles at high quality and 16,698 at low, 56 more with the outer draw, and 12 programs, 19 geometries and 2 textures, all compiled at prepare, in each engine; before C-57 it was 17 calls, 17,298 and 15,858 triangles, 8 programs and 17 geometries.
  - **The arrow** also shows while the ball's centre is on screen but behind the HUD's top bar, at the top edge just under the bar, pointing at it. Only Node checks this case (`src/ui/overlay.test.ts`): ball view aims at the ball's centre, and in chase view the centre stayed at least 147 px below the bar through 70 s of play with pounces in C-57's review, as it did in every frame of E's comparison, so no spec can bring it about on purpose; `e2e/camera.spec.ts` checks the arrow hidden with the ball in view. The bar's foot is a drawing constant, 52 px, the one-row bar's as measured on a phone held sideways and at desktop sizes. A bar that wraps, its clock on a second row in a window narrower than about 530 px, or that a top safe-area inset moves down, ends lower, so there a ball behind the second row gets no arrow, and the arrow's own top inset, from before C-57, can sit on the clock. Measuring the bar from the page goes with phase 4's HUD.
  - The spectators' camera and the overview are unchanged.

**D-29 — Input devices, and anchoring.**
- **Keyboard:** roslambo's `event.code` handling, with keys released on blur. W, A, S and D give eight directions; Space jumps; Shift is zoomies; E pounces; Q barks; C switches the view. Ctrl is never used. Q-17 adds Escape, Enter and the arrows, and Space on Results.
- **Touch:**
  - a stick on the left, with a 0.2 dead zone; pushing past its rim sets off zoomies;
  - jump and pounce buttons on the right, and smaller bark and view buttons;
  - each button tracks its own pointers, as roslambo's do;
  - the stick's touch area and the buttons stay at least 32 CSS px from the side edges, inside the safe-area insets, clear of Android's and Safari's edge-swipe Back;
  - mirrored in Settings, which flips the whole control layer and keeps the menu in a corner both layouts leave free.
- **Gamepad:** the standard mapping, read each time a tick's input is sampled, on the timeline's timer, and on a 60 Hz timer of its own on screens without a pitch. It's never read on animation frames, so its input doesn't depend on the frame rate (C-6). Each new press it reads feeds D-10's press counters.
  - The left stick runs; the bottom face button jumps; the left face button pounces; the right trigger is zoomies; the top face button barks; the right shoulder switches the view.
  - Start presses the focused button: Ready first on Pre-match, and Play again first on Results. On Results the bottom face button presses it too, and only presses that begin 0.5 s after Results appears count. Back opens and closes the menu on Match. The d-pad moves between buttons (Q-17).
- **Anchoring:**
  - **Ball view** sends the ball frame.
  - **Chase view** sends the pitch frame, reading the camera's yaw when a direction starts from neutral, or when it moves 45° or more from the last read. A smaller move turns the kept direction by the same angle (C-24). Switching view re-reads the held direction.
  - **Its cost (Q-19),** modelled with D-28's chase camera (research/audit/REPORT.md §9): a stick swept 90° in 0.5 s or 1 s turns the terrier about 135° or 169° (124° or 135° with the calmer camera), against 146° or 191° under L74's present wording. A stick circled at 0.5 turn/s turns it at 0.83 turn/s (0.56 calmer). Rolling the stick from right to up once the camera is behind swings the terrier about 20–35° left and back before it runs straight on. Re-reading only from neutral turns the terrier exactly with the stick, but keeps the screen as it was at the press.
- **Control hints:** for each kind of input, the first time it's used, until each control has been used once. The profile remembers them, and Settings offers "Show control hints again". On Windows, the keyboard's hint also says how to turn off the Sticky Keys shortcut (C-52).
- **Cost if wrong:** controls only; no state or golden changes.

**D-30 — Screens, messages and the boot page.**
- **Screens:** roslambo's: one TypeScript module per screen, no framework (roslambo D-22).
- **Boot:** `index.html` shows a message by default, with a `noscript`, until the app has started, so the page is never blank (amorfus PLAN §8.2). The codes are amorfus's file://, insecure context and load timeout, plus "no WebGL 2". Each is tested in end-to-end runs that switch the feature off, and checked with axe.
- **WebGL 2 lost mid-match:**
  - the simulation and network keep running, so the terrier and its vote stay;
  - the pitch says "Graphics were lost; restoring", and the drawing is rebuilt on restore;
  - if the context isn't back within 5 s, the plain message shows with **Leave**, and the match goes on for the others; the 5 s counts only while the page is visible;
  - held inputs are released while the graphics are lost, as for a hidden page, and Practice pauses until they're back.
  - If WebGL 2 is missing at load, the boot page's message stays: nothing in the app works without it.
- **Phones (L170):**
  - a phone is a coarse-pointer screen whose shorter side is under 600 CSS px. Held upright, it's asked to turn sideways for Pre-match and Match, spectators included;
  - if the page stays upright, the prompt says to turn off rotation lock; on Android it also offers **Play full screen**, which enters fullscreen and locks landscape;
  - the layout respects the safe-area insets;
  - a screen wake lock is held during Pre-match and Match, and on Propose until someone joins, where the browser offers one. It's requested again at each `visibilitychange` to visible, since the browser drops it whenever the page is hidden.
- **Desktops (L170):** Pre-match's and Match's pitch fills the window at any size, with the screen's other contents drawn over it.
- **Leaving:** during Pre-match and Match, a `beforeunload` guard asks before the page is left. Chrome on Android shows it once the page has had a touch; iOS Safari doesn't.
- **M1:** the boot codes are amorfus's F (`file://`), S (an insecure context) and L (the load timeout, 20 s), plus W (no WebGL 2). The module makes the WebGL 2 context and reports W, so if the module never loads, L shows instead. The page leaves out `viewport-fit=cover`, so the browser keeps it inside the safe-area insets. M4's phone layout opts in, and then pads the messages and frames the pitch itself.
- **Cost if wrong:** low.

**D-31 — Hidden tabs (roslambo D-23, as amended 2026-10-25).** The timeline runs on timers, not animation frames. A hidden page keeps sending, with nothing held, and only a page frozen for more than 2 s rejoins from a peer. Practice pauses instead, with its menu open (D-22, Q-15). Frame times are judged on a visible page.
- **M3, as built** (`src/ui/game.ts`, `src/core/session/session.ts`; M3's design §4.12, M3-Q9):
  - **The stall rule:** NetGame checks every timer run. A gap over 2 s pauses the timeline, which sends no TICK and answers no STATE_REQ, and for up to `stateRequestRetryMs` the session watches for a direct TICK for a tick past this page's local tick + d + w: its sender's clock ran on through the stall. A forwarded TICK doesn't count, since its forwarder's own timeline may have stalled. The page then rejoins from such a peer, asking each in turn, the old timeline kept until a STATE is adopted, or with none it re-anchors its clock at its own tick and sends again. So pages frozen together, as when one machine pauses, all re-anchor at one point, and nobody is removed or rejoins (stalls.test.ts). roslambo rejoined whenever any peer had ever been live, so pages frozen together all dropped their timelines and none was left to answer.
  - **Shorter freezes:** a gap over d + w ticks takes no clock sample and no round trip (D-15), and its backlog, counted by the ticks it carries, closes no connection (§9). Freezes of 1.9–8 s and links held 2.5–6 s are tested in both thaw orders (`src/ui/freeze*.test.ts`, `src/net/backlogs*.test.ts`).
  - **A hidden page** throttled to one timer a second never sits, isn't removed, keeps its Ready, and no page resyncs, jumps or changes its rate (hidden.test.ts).
  - **A page whose incoming links were held** while its timers ran, as a page cut off from the room is, is no stall and decides nothing: its clock ran on, so once the held messages land it repairs by its tallies and §3.4's resync (D-13), and JOINs again if the winner removed it (D-17). Stalls are unchanged (M3's design §4.12; M3 phase 5b, 600f2f0; cutoff.test.ts).
  - **A risk for M4:** in the headless WebKit, held by frames of 250 ms, timer gaps reached 1.76 s, near the 2 s stall; M4 measures the engines' timers again with real frames (D-15).

**D-32 — Sound made in code.**
- **Choice:** Web Audio. The `AudioContext` is made at start-up and resumed at each keydown, click, pointerup or touchend until it runs. A gamepad press may not count, so while sound is on and the context isn't running, the pitch says "Press a key or tap for sound" (§13). The sounds:
  - barks: a filtered noise burst with a falling pitch, a little different per terrier;
  - the ball's bounces: a low thump, louder for harder hits;
  - pounces: a whoosh; tumbles: a thud;
  - a whistle at each kickoff and at the end;
  - a goal: a whistle and a chorus of barks, at the confirmed tick (L202, D-14; C-53).

  No files, so the dist audit's allowlist is enough. Sound on or off in Settings. Everything sound tells also shows on screen (L103). §13 says when each sound plays, given rollback.
- **Cost if wrong:** low.

**D-33 — A render-quality setting.**
- **Choice:** in Settings, high or low, high by default. High caps the pixel ratio at 2, as roslambo D-21 does, with MSAA; low caps it at 1, without MSAA, and simplifies the effects (dust, net detail). It's a real player option, so the gate's matches draw what a player's would at that setting. The gate plays its matches at low, and counts the drawing budget at both settings.
- **Changing it:** MSAA is fixed when the WebGL context is made. So a change of render quality during a match builds a new renderer on a new canvas, along the path a restored context takes (D-30), when the menu closes, and the match runs on. The other settings apply at once, but for relays and TURN (§11).
- **Phones:** L286's phone run is judged at the setting a phone starts at, and the frame-time run never changes quality. Whether phones start at low is your call, with the phone's measurements, when Q-4's devices come up.
- **Cost if wrong:** none.

### Build

**D-34 — The toolchain (roslambo D-24).** roslambo's pins (Appendix A.6), plus three, its types and axe:
- **Types:** three ships no TypeScript types of its own, and hermet's strict tsconfig rejects an untyped import. So `@types/three` is pinned exactly at the 0.187 line, dev only. M0 checks that one exists for 0.187, or pins three to the newest revision that has one (D-26).
- **axe:** `@axe-core/playwright` ^4.10, as amorfus pins it, for D-30's axe checks.
- **Playwright** 1.64.1, whose browsers are already installed here.
- **M0, confirmed** (research/spike/REPORT.md §8): `@types/three` 0.187.0 exists. It was published on 2026-10-30, the same day as three 0.187.0, with the dist-tag `ts6.0`. So three stays at 0.187.0 exact, with `@types/three` at 0.187.0 exact. Every three API the spike's scene uses typechecks under hermet's strict options.

**D-35 — Hosting (roslambo D-25).** Workers static assets, assets only, observability off. A `public/_headers` file, as amorfus's, marks the hashed assets immutable and sets its security headers; everything else is revalidated. Served at terriest.com (Q-5). Deploys use wrangler's stored login (Q-6), and each waits for your go-ahead.
- **The content security policy,** written out: `script-src 'self'; connect-src 'self' wss: blob:; object-src 'none'; base-uri 'none'`.
  - `script-src 'self'`: only the site's own scripts run.
  - `connect-src`: `'self'` for the site's own files, such as a model; `wss:` for the Nostr relays, including any a player adds; and `blob:`, which amorfus's policy lacks, because GLTFLoader fetches a `.glb`'s embedded images from `blob:` URLs (research/audit/REPORT.md §9; M0 confirms it with three itself, §17). STUN, TURN and the peers go over WebRTC, which connect-src doesn't govern.
  - `object-src 'none'` and `base-uri 'none'`: no plugins, and no `<base>` to redirect the relative paths.
  - The gate plays the stand-in under this file unchanged, and a unit test checks its rules (§16). §12 lists what a model's decoder would add.
- **M0, confirmed as written** (research/spike/REPORT.md §3, §5.4, §8): `blob:` in connect-src is needed, and it's enough. Under amorfus's policy, each engine refused one fetch, connect-src blocking `blob:`, and the stand-in's embedded texture was missing. Under this policy exactly as written, it loaded at 256 × 256 in all three engines, and nothing was refused, by three or by the page. Vite's module-preload polyfill fetches same-origin URLs, which `'self'` covers, and `build.modulePreload.polyfill: false` drops it.

**D-36 — The spike stays separate (roslambo D-26).** M0 lives in `research/spike/`, with its own `package.json`. Nothing in `src/` imports it; its findings go in `research/spike/REPORT.md`.

**D-37 — The gate tooling is hermet's (roslambo D-28).**
- **Choice:**
  - hermet mounted as the submodule `vendor/hermet` from M1, pinned at 11283ca, the commit with Q-3's fix, pushed to hermet's main on 2026-11-14. M0 uses the hermet checkout on this machine at that commit, with no submodule (§17).
  - terriest's own policy stays in `scripts/` and the configs:
    - `public-scan` reads `TERRIEST_PRIVATE_TERMS`;
    - the dist audit passes:
      - `ignoredHosts: ['stun']`;
      - `textFiles: ['_headers']` (D-35);
      - `loopbackFiles: ['boot.js']`, because the boot messages say how to serve the folder on localhost, as amorfus's do;
      - `ignoredPaths: ['/']`, for the bare `'/'` in three's `LoaderUtils.extractUrlBase`, a separator that's never requested: the one finding C-9's check made in three (M0);
    - the licence writer passes `product: 'terriest'`.
  - The gate runs hermet's tests under terriest's own ESLint, ws and vitest. Never edit `vendor/hermet` in place.
- **Cost if wrong:** as roslambo.
- **M0, amended** (research/spike/REPORT.md §5.5, §8): the dist audit gains `ignoredPaths: ['/']`, above. No hermet option or tokenizer fix is needed, so M1's pin at 11283ca stands.
- **M1:** all four options are passed as written. At M1, `textFiles` and `loopbackFiles` (boot.js's localhost example) are needed. `ignoredHosts` exempts nothing until Trystero is bundled at M3, and nor does `ignoredPaths` until GLTFLoader arrives at M4. The audit's gaps are C-54.

**D-38 — Lint boundaries.**
- **Choice:**
  - exact-ops on `src/core/sim/**` and on the bot brain in `src/core/bot/**` (D-39), tests excluded. There, `Math` is also never destructured or aliased, which hermet's rule, matching names only, misses (D-1);
  - no DOM, timers, storage or network globals in `src/core/**`, and no `globalThis` or `self` there, so no global is reached as a property;
  - nothing in `src/core/**` imports three, `src/render/**`, `src/ui/**`, `src/input/**` or `src/audio/**` (L252);
  - only `src/render/**` imports three, and only from `three` and `three/addons/…`, never `three/src/…` (§15);
  - only `src/net/trystero.ts` imports Trystero;
  - only `src/storage/**` touches storage: outside it, `no-restricted-properties` bans `localStorage`, `sessionStorage` and `indexedDB` on `window`, `globalThis` and `self` too;
  - amorfus's subpath bans: no root-absolute URLs, no History API. The URL fragment is set with `location.replace` instead (§11).
- **One list per file group:** in a flat config, a later object's options for a rule replace an earlier one's for every file both match, so bans in separate objects silently cancel each other. So `eslint.config.mjs` builds each rule's options once per disjoint file group, with one helper: `src/core/sim` and `src/core/bot`; the rest of `src/core`; `src/render`; `src/net/trystero.ts`; `src/storage`; the rest of `src`.
- **Testing the lint:** a config test with fixture files, as roslambo's `scripts/eslint/config.test.mjs` does. It lints every banned construct in each group (`src/core/sim`, `src/core/bot`, `src/core/timeline`, `src/render`, `src/ui`, `src/net`, `src/storage`), D-1's `const { sin } = Math` included, and expects it to fail or pass as that group's rules say, not one directory per rule.
- **Cost if wrong:** none.
- **M0, amended** (research/spike/REPORT.md §6, §8): the spike's verifier found three gaps in its lint, none of them present in its simulation. A `.tsx` or `.jsx` file isn't linted at all; a parameter typed `typeof Math` and called as `m.sin()` isn't caught; and nor is `toLocaleString`. So in `src/core/sim` and `src/core/bot`, every script extension is linted, a `typeof Math` parameter and `toLocaleString` are banned, and the config test covers all three.
- **M1, amended:** the lint is stricter than the list above, with a fixture for each ban in the config test (117 tests):
  - every script extension is linted in every group, with typescript-eslint's rules;
  - in `src/core/sim` and `src/core/bot`, `Math` appears only as `Math.<name>`, so no type or key reaches it either, and every `toLocale…` method and `localeCompare` is banned;
  - `src/core`'s globals are an allowlist, with `no-undef` on: `console`, `crypto`, `structuredClone`, `TextDecoder`, `TextEncoder` and `URL`, plus `process` in its tests;
  - `import()` takes only a plain string, and no import path detours through `node_modules`, through a `.` or `..` after a named folder, or through `//`;
  - an inline type import or re-export that compiles to a bare import is banned, since `verbatimModuleSyntax` keeps the import, and Vite then bundles the module;
  - the subpath bans also cover template literals, `+` chains, `window.open`, `location.hash =` (§11) and any root-absolute `.href` or `.src`;
  - `src/config.ts` is held to exact operations by `src/config.test.ts`, which lints its text as if it were in `src/core/sim`.
- **M2, amended** (`eslint.config.mjs`, with a fixture for each ban in the config test: 134 tests):
  - **Arrays only** (§7.3), a ban by name: in `src/core/sim` and `src/core/bot`, tests aside, `Map`, `Set`, `WeakMap`, `WeakSet`, `ReadonlyMap` and `ReadonlySet`, and their constructors' types, appear only as keys, as `Math` appears only as `Math.<name>`. So none is constructed, extended, aliased, passed on, cast, named in a type, written as a string, or read as a property, such as `g.Map` for a `g` typed as the global object, which the ban on the global object misses. A ban on constructing them alone would miss an alias, a cast, a comma or `Reflect.construct`. A `Set` handed in from outside as an `Iterable` is beyond a syntax rule, and holds by review.
  - **`dev/`,** the tuning page and its metrics, is never built, but takes the rest of `src`'s bans, so three stays in `src/render` and storage in `src/storage` there too, and every script in it is read with the TypeScript parser.
- **M3, amended** (`eslint.config.mjs`, with a fixture for each rule in the config test; M3's design §1.36; a3bf419): two rules more, each resolving a specifier against its file's path. `src/core` imports nothing outside `src/core` but `src/config.ts`, statically or by `import()`. And `src/net/trystero.ts` and `src/net/dev-relay.ts` are loaded only by `import()`: Trystero's file from `src/ui/game.ts` alone, and by its own unit test, which mocks Trystero and which no build bundles; the dev relay only under `import.meta.env.DEV` (§15). A type-only import of either is allowed anywhere (D-18).

### Bots

**D-39 — Bots ride in their host's TICK (roslambo D-27), with a new brain.**
- **Choice:**
  - **From roslambo, unchanged:** a bot is an ordinary member of the roster; its ID is a version-8 UUID derived from its host's and its slot; its inputs ride in its host's TICK; its host votes once.
  - **New:** each bot gets a coat at random, seeded by its ID.
  - **The brain** runs only on the host. It reads the predicted state and sends the same input a person does, in the pitch frame (D-7): Q-9's roles, including falling back to defend when a rival is nearer the ball (L142); its reaction delay and seeded noise; zoomies to reach the ball; a jump or a pounce when the ball is in reach and lined up with the goal; a bark now and then.
  - **Exact operations:** the brain keeps to them, using `src/core/sim/math` for angles (`dir`, `datan2`), so its seeded pass marks count the same on x86 and arm64 and in every engine. D-38's exact-ops lint covers `src/core/bot/`.
  - **In warm-up** it wanders; **in countdowns** it faces the ball.
- **Rejected:** bots inside the simulation, as for roslambo: a rollback cost on every peer, and new goldens whenever the brain changes.
- **Cost if wrong:** the brain is one module with seeded tests, and its level is yours to accept (Q-9).
- **M2: the brain as built** (`src/core/bot/brain.ts`), run offline against the simulation; hosting is M3's (§14). It meets §16's marks at A.4's starting values.
  - **What it sees:** its reaction delay's view, 0.25 s old. It judges the ball from that view carried on by the ball's velocity then, as a player judges a rolling ball, and ranks only terriers that can act, neither sitting nor tumbled. It steers from where it is now. Its memory is its own, and nothing it holds is in the state.
  - **Chasing,** the nearest of its pack while no rival that can act is nearer: it pushes along the change of velocity the ball needs to roll toward the attacked goal's centre a quarter faster than run speed, so a ball rolling off the line is struck from the side that turns it back. Behind the ball and lined up, within about 22°, it drives through the ball's centre moved back over the line; otherwise to a point 0.3 m behind the ball's surface; and from the goal side, round by a point 1 m off the ball on its own side, never across the ball. A push line that a wall would block turns away from it, 15° at a time, up to 90°, and a side point that a wall squeezes against the ball switches to the other side.
  - **Falling back,** when a rival is nearer: to Q, 3 m from the ball toward its own goal's centre. Once goal-side of the ball within 1.5 m of Q, it meets the ball from there, pushing it away from its own goal for as long as it stays goal-side (L142).
  - **The others:** the second supports 5 m behind the ball, toward its own goal. The rest defend 6 m out from their goal on its line to the ball, short of the ball, each after the first 1.5 m beside the last. Each holds still within 0.5 m of its point.
  - **Zoomies** toward a target over 5 m away while chasing or falling back, begun again only from a meter half full. **A pounce** while chasing, when the ball's surface is within 2 m, its centre under 2 m up, the heading within 20° of the ball, and the shot within 20° of the line to the attacked goal's centre and crossing the goal line inside the mouth: the shot leaves along the contact's normal where the lunge meets the ball. **A jump** at a ball in the air, its centre 1.5–2.5 m up and within 1.5 m, from the side away from the attacked goal. **A bark** about every 5 s, jittered by the 1 s bark gap either way, so never within it (L327).
  - **Outside play:** in warm-up it wanders to seeded points in 1.5 s spells, with zoomies one spell in four and no pounces; in countdowns it holds the step toward the ball, so it turns to face it; in a celebration and at the end it holds nothing.
  - **Unstuck:** after 2 s holding a direction within 0.5 m, it holds the other way for 0.5 s, then each side in turn, on the floor and without a jump, since a jump's 0.9 s in the air outlasts the escape.
  - **Noise:** aim off by up to 10° either way, redrawn every 0.25 s from its ID's seed, so mirrored bots diverge.
  - **Settings and code:** its tunables are A.4's Bot brain row. Its geometry stays code constants marked `not a setting`: the alignment, the berth round the ball, the push lead, the jump band, the wall turns and the squeeze. `think()` costs 0.38–0.69 µs a bot a tick here.
- **M3, as built** (`src/core/session/bots.ts`, `src/core/bot/brain.ts`, `setups.ts`; M3's design §4.8; M3-Q17, M3-Q25):
  - **The brain's view is keyed by tick,** and a host thinks once per head tick, on the head as the advance found it. So every tick of a catch-up gets one input, its press counters unchanged, a head held through a spread holds the bot's input too, and its reaction stays 0.25 s however the head moves. M2's marks and `marks-e2e-setups.test.ts` count exactly as before: all 8 digests were equal at phase 2's integration.
  - **Hosting** (`BotHost`, §14): a host adds bots one at a time, up to its pack's free places counting the joins on their way; Remove takes its newest wanted bot in that pack, hosted until the final state no longer shows it and nothing of it is in flight; a bot's READY goes again once its Ready has 10 s left (M3-Q17); and a host that comes back adopts its bots, each brain from the newest record of its own past the STATE's tick.
  - **The scripts** the marks, the `#test=net` page and the network simulator's setups share are `src/core/bot/setups.ts`'s: none, back, sideways and brain, each sampled on the timeline's head when a tick is sent. `personId(seed, k)` moved to `src/core/bot/bot-id.ts`.

---

## 5. Evidence: what this plan rests on

**Read, 2026-11-14:**
- REQUIREMENTS.md at 6254a1d.
- roslambo at 3809d3a: PLAN.md in full; `src/` (the timeline, session, protocol, simulation, angle, hash, codec, bot, storage, UI and bench modules); research reports (lockstep, tuning, load, passive, relays, appearance); `docs/acceptance.md`; the end-to-end specs.
- amorfus at f4a272f: PLAN.md (sections 0–3, 8.2, 10.2, 13–15), `docs/`, its ID codec, its boot page and failure messages, its end-to-end guards.
- hermet at 18a37b2: every file; then its licence fix, 11283ca (Q-3).

**Measured or computed for this plan, 2026-11-14**, from local files only: two audit rounds of 13 agents, then reviews of this plan's first and second drafts. The methods and numbers are in [research/audit/REPORT.md](research/audit/REPORT.md), including the check of hermet's fix, 11283ca (its §4). The probes' scratch code isn't kept, and M0 re-measures what the design rests on.
- WebGL 2 in headless Chromium 156, Firefox 157 and WebKit 27.2 on this machine: a context and a draw with readback in each, with no extra flags; throughput (C-6); `Math` bit-identity across the engines (D-1); missing WebGL 2 and a lost context can be produced in tests.
- hermet's licence bug, by rebuilding roslambo and amorfus from HEAD (C-8). Then its fix, 11283ca, pushed to hermet's main on 2026-11-14 at your request (Q-3): on both siblings' current builds, roslambo's 3 notices and amorfus's 5 carried their texts, and the audit found nothing. The siblings still pin 18a37b2 (Q-20).
- roslambo's integrator on a floor, its fixed-order settling with unequal masses, and the event cap (C-3).
- The requirements' arithmetic, re-derived. These hold: the 7 s crossing, 0.4 s to run speed, the 0.9 s jump, 1.4 m under the crossbar, the half-speed level hit (3, 4.5 and 5 m/s), the latency figures in L341, and 36 pairs. These don't: the bowling examples (C-5), four abreast, which in 3D barely beat one pusher and in ball view lose to it (C-18), and the pair count (C-2).
- The first draft's contact solver, modelled by the review: simultaneous hitters gained energy (C-3), which D-5 now avoids.
- A second review, of this draft, modelled its solver for pushers side by side (C-18) and the slip-out (C-21), and computed the drawn terrier's reach into the ball (D-4) and the contact solves a tick (C-2). From roslambo's timeline and codec it also computed the worst single ticks (C-2), the largest STATE (D-18), a hidden page's silences (D-16) and when a confirmed goal can be taken back (C-4). For the client, it modelled ball view's swing (D-28) and chase view's re-read (Q-19), computed a bandana's size on the phone (C-51), and probed the content security policy in the three engines (D-35) (research/audit/REPORT.md §9).
- The example match ID's check character (C-15).
- npm, read only: three 0.187.0 (MIT), `@trystero-p2p/nostr` 0.26.0, and the hermet submodule fetchable at 18a37b2.

**Measured since approval:** M0, in [research/spike/REPORT.md](research/spike/REPORT.md), on this machine: the contact solver in four engines, the page's counts and downloads, three.js's audit, and the tick cost in throttled Chromium. Its frame verdict on your desktop GPU, run 6, passed in the one load you reported, and its other loads are open.

**Measured at M2,** on this machine: the port's step against the spike's, tick by tick in one process (C-2); and the values M2 settled, by the tuning metrics under the method of [research/tuning/REPORT.md](research/tuning/REPORT.md), on 2026-11-17 (Q-10).

**Measured at M3,** on this machine, on 2026-11-19: the correction measurement over the network simulator and the cap check in Node, by the method of [research/corrections/REPORT.md](research/corrections/REPORT.md), committed before anything was measured (D-11, D-16, C-55); the 12-page load run, which failed its checks in the measurement and passed at M3's final tree on 2026-11-20, once a diagnosis and an A/B of three commits had cleared the code (§16); and the desktop connection, settled provisionally in the headless engines (§17).

**Not measured** when the plan was written: the contact solver, three.js's bundle and its audit, the phone, real networks, and every cost in this plan. M0 has since measured the first three on the desktop (above); the phone's first run is planned for M5 (Q-4).

---

## 6. Architecture overview

```
keyboard / touch / gamepad ──► anchoring ──► input (D-10) ──┐
                                                            ▼
peers ── TICK / FWD ─────────────────────────────► timeline ──► sim (pure) ──► final states ──► my vote ──► peers
          STATE ─────────────────────────────────►  ▲   ▲                           │
                                                    │   └── resync ◄── tally ◄──────┴──── votes from peers
renderer + terrier drawer ◄── predicted states ─────┘
renderer + terrier drawer ◄── received inputs (barks), confirmed ticks (celebrations)
sound, away marks, barks ◄── received inputs and state
score, celebration, results ◄── confirmed ticks
```

- **`src/core` is pure TypeScript:** no DOM, timers, storage or network. It runs in Node for tests and in the browser unchanged.
- **The simulation knows nothing of time or the network:** `step(state, finalInputs) → state`. The timeline owns time, prediction and rollback, as in roslambo.
- **The drawing knows nothing the simulation doesn't tell it:** it reads states, received barks and confirmed goals, and keeps only blends, smoothing offsets, the timings it is fading out and each bark's start (D-27).

**Module map:**

```
src/config.ts           every setting (the Configuration table and Appendix A) and the number of coats;
                        the build hash covers it
src/core/sim/           math (binary angles, dir, datan2), bodies, pitch pieces, contacts, movement,
                        steering frames, rules, state codec, hash, goldens, canary            [exact-ops]
src/core/timeline/      from roslambo: input buffers, prediction, finalisation, rollback, votes, resync
src/core/protocol/      from roslambo: message codecs (§9), widened inputs
src/core/session/       from roslambo: handshake, roster events with packs, forwarding, keeper, bots,
                        the abandoned-match rule, the build hash
src/core/match-id.ts    from roslambo's round-id.ts (Q-2)
src/core/names.ts       from roslambo
src/core/bot/           bot IDs (from roslambo) and the bot brain (D-39)                      [exact-ops]
src/net/                Transport; loopback with faults (from roslambo); trystero.ts; the local transport (D-22)
src/storage/            profile, settings, tab lock (from roslambo)
src/render/             three.js: scene, pitch, ball, cameras, effects, interpolation and smoothing, palette,
                        quality; drawers/ (code-built, model)
src/input/              keyboard, touch, gamepad; anchoring; control hints
src/audio/              synthesised effects
src/ui/                 screens, the match menu, messages; game.ts (one match), practice.ts
src/bench/              the frame-time bench's virtual peers (from roslambo)
src/nettest.ts          the #test=net page: matches without the screens, for M3's tests (from roslambo)
src/main.ts             wiring; the #test= pages (determinism, net, frames)
index.html, public/boot.js   the boot message (from amorfus)
public/_headers         caching and security headers (from amorfus; D-35)
dev/tuning.html         the tuning page: dev only, never built
dev/look-book.html      the look book: dev only, never built
dev/logo.html           the logo and icons: dev only, never built
third-party.json        relays and STUN: drives the runtime, the dist audit and §20
e2e/                    Playwright specs; fixtures/ (the stand-in model, recorded matches)
scripts/                gate wrappers, make-standin.mjs, emit-goldens (guarded)
vendor/hermet/          the submodule (D-37)
research/spike/         M0, throwaway (D-36)
docs/acceptance.md      devices, criteria, manual checks, the run log
```

Lint and the golden files depend on these paths, so the paths are part of the contract.

**M2:** `src/core/sim/` holds `math`, `hash`, `input`, `state`, `params` (the configuration in the simulation's units), `codec`, `valid` (what a state must keep to decode), `pitch`, `physics`, `movement`, `rules`, `step`, `scenes` (M0's scenes, which the tests, the goldens, the marks and the tuning page share), `scripts`, `golden` and `goldens.json`. Its test support, `testing.ts`, `cases.ts` and `match-testing.ts`, is linted and scanned as the simulation is. `src/core/bot/` holds `bot-id`, `brain` and `marks`, the marks' test support. `src/determinism.ts` is the `#test=determinism` page, `dev/tuning/` holds the tuning page's modules, and `scripts/emit-goldens.mjs` re-emits the goldens. `src/core/sim/index.ts` re-exports what M3 and M4 import from the simulation, M2's design §1.16's list (research/m2/DESIGN.md); tests and the tuning page import the modules themselves.

**M3:** as built (M3's design §1; M3-Q5):
- **`src/core/protocol/`:** `bytes` and `messages`, the wire's codecs and its one total decoder (§9).
- **`src/core/timeline/`:** `inputs`, `history`, `votes`, `clock` and `timeline`; `testing.ts` is the timeline tests' shared support (`Pump`, `NetPump`, `TimelinePeer`, `Watch`, `twin`, `sharedHashes`, `expectAgreement`).
- **`src/core/session/`:** `settings` (`netSettings()`, M3's settings in their units), `room-peer`, `build` (the build hash), `roster` (admissions, `outranks`, `againTimelineId`), `bots` (`BotHost`), `session`, `scoreboard`, `summary` and `practice`. `src/core/bot/` gains `setups`, the scripts that the marks, the page and the simulator share.
- **`src/net/`:** `transport`, `room-config`, `trystero`, `local`, `loopback` (the network simulator) and `dev-relay`, with `setups-testing.ts`, R-7's replay driver, and `freezes-testing.ts`, the rig of the freeze, hold, cut-off and partition tests.
- **`src/ui/`:** `clock.ts` (the `Clock` and `PageEvents` the glue is handed, so Node tests drive it with fake timers), `game.ts` (`NetGame`, one networked match) and `practice.ts` (`PracticeGame`), built without screens, which M4 adds round them, with `clock-testing.ts` and `world-testing.ts` for their tests.
- **The pages:** `src/nettest.ts` is the `#test=net` page, its parameters and its hook's types in `src/nettest-params.ts`, and `src/build-info.ts` gives the build inputs' hash.
- **The session's door for M4:** `src/core/session/index.ts`, new at M3's settle (M3's design §1.39), re-exports what M4 imports from the session, as `src/core/sim/index.ts` does the simulation's: the types M4's screens, Results and match readout meet on `NetGame` and `PracticeGame`, and what M4's own code calls, the build hash, the settings in their units, the match summary's figures with its one definition of a correction's size, and the room peer and link that a transport of M4's own, such as the frame bench's virtual peers, drives. M4 imports the session through it, widening it as it needs. M3's glue, the `#test=net` page, the tests and the correction measurement import the session's modules themselves, and none moves to it before M4 (M3 phase 5b's answers).
- **The simulation's door, as built:** M2's note above has `src/core/sim/index.ts` re-export what M3 and M4 import from the simulation, and M3's timeline, protocol, session, glue and `#test=net` page import it so, but no lint holds it as the only door. `src/render`'s pitch, scene and camera import `src/core/sim/pitch`; `src/core/bot`'s `bot-id`, `brain`, `marks` and `setups` import the simulation's modules; and `src/determinism.ts` imports its `codec`, `golden` and `scripts` (M3 phase 5b's answers).
- **`NetGame`** (M3's design §1.24), as built: it opens the room through a transport factory, Trystero's by default, which is handed the match ID, and runs the session on the glue's timer, its start counted as timer run zero, checking for a stall on every run (D-31). It keeps the scoreboard and the match's summary, `stats()` summed over every timeline it held, a rejoin's and a merge's included, and the traffic by message type, counted round its link, a broadcast once a connection. It passes the session's `onControl` through, and the timeline's corrections and runs (`onCorrection`, `onRun`). `refusal()` gives "spectators full" once the page left a full room, by its own count or a peer's REFUSE 4, and otherwise, with no peer, the last refusal received; `failed()` holds once 20 s have passed with no timeline ever held, for any page but a keeper. `playAgain` takes its options or none, and a second press throws. What the screens and the `#test=net` page read beyond M3's design's list: `matchId`; `peers()`, the room's connections; `refusedBy`, the last REFUSE received; `arrivedTick`, the final tick at which it took the timeline it holds, 0 for its proposer and −1 before it holds one; `leaving`, once a way out has begun, by Leave, a full room or Play again, and `closed`, once its room has closed, 0.4 s later (A.4's Leaving row); and `canAddBot(pack)`, the session's own check.
- **The `#test=net` page** (M3's design §7, M3-Q7), as built: its main landmark, `<main id="net">`, holds a heading and a status refreshed every 500 ms, for the owner's check, and `started()` comes once the landmark is in place. Its parameters are read strictly, an unknown or repeated one refused, and a refusal reads "The network test didn't start, and contacted nothing: <why>.", with no hook, no Trystero chunk and no WebSocket. It adds `net` to `window.terriestTest` only when a spec set that object before load, and only once the match is open, and publishes no global of its own. The hook's report comes from NetGame: its stats, summary, arrival tick, peers and refusals, the CPU of each timer run that moved the clock, a copy of the traffic, and `window.__rtcCount` when a spec counts peer connections; Practice's traffic is all zeros. The page presses Ready at the first timer run at or past its `ready` tick with its terrier in the final roster, and samples its script on the timeline's head, the script made again from each `onControl`'s base.
- **Outside the gate:** `dev/corrections.measure.ts` is the correction measurement, with its own vitest config; `e2e/load.run.ts` and `e2e/dev-local.run.ts` are the load run and the desktop connection's provisional settle, each with its own Playwright config (§15).

---

## 7. Deterministic simulation

### 7.1 State

Everything below is in the canonical state (Appendix A.1), and so in the hash. Spectators and the proposer, unless they play, are not.

- **Match:** phase and the tick it began, overtime, tick, pack size, match length, clock, score, the last goal (tick, pack, own goal, and its scorers: set at the goal and cleared at each kickoff placement, so a spectator who arrives mid-celebration can still name them).
- **The ball:** position and velocity (six float64), on-floor flag, last hit tick and strength, the last hit's velocity change, last contact tick.
- **Per terrier**, in (spot, pack) order:
  - **identity:** player ID, name, pack, spot, coat;
  - **lifecycle:** join tick, Ready-until tick, last tick with an input, the previous present final input (D-10);
  - **body:** heading and the overhead reference (D-7); position and velocity (six float64); flags (on the floor, sitting, zoomies locked out, ball overhead, touching the ball, and slipping, with the body slot slipped from: M0's slip-out uses both, D-5);
  - **timers:** zoomies meter (in half-ticks), pounce wait, lunge, tumble and guard;
  - **counts:** touches, goals;
  - **animation:** the fields of D-9.

**M2:** as A.1 fixed it. The draft's lunging flag went, since the lunge timer says it; touching the ball became a flag; slipped-from names a body slot; and the ball keeps its last hit's velocity change, the squash's axis (D-9).

### 7.2 One tick, in order

1. **Events:** LEAVE, then SWITCH, then JOIN, each in player-ID order, then READY and UNREADY (D-12). A warm-up arrival is placed on its pack's next free spot, or near it (D-8).
2. **Presence:** record which browsers have a final input. Before the start countdown, remove players silent for 180 ticks. From the start countdown on, mark a terrier sitting after 120 silent ticks (D-16).
3. **Phase changes:**
   - Ready expiry (60 s);
   - the start countdown when both packs are full and every player is ready;
   - a countdown's end starts play;
   - a celebration's end starts a kickoff countdown, the overtime kickoff, or the end.

   At the start of each countdown, the kickoff placement (D-8).
4. **Inputs to intents:** resolve each direction in its frame (D-7); take new presses (D-10); apply what the phase allows (D-8).
5. **Physics:** 4 substeps (D-5), with touches and the goal test in each. The first goal of the tick counts; the ball is out of play from then on.
6. **The clock:** if the tick began in play, count down a tick, or up in overtime. When the count down reaches 0, if no goal began a celebration this tick, the end or the overtime kickoff (D-8); otherwise the celebration's end decides (step 3).
7. **Animation fields** (D-9).

**M2:** as `src/core/sim/step.ts` runs it. `step(sim, s, inputs)` advances the state in place, as roslambo's and M0's do, so a caller that needs the old state clones it first.
- **Before step 1,** the inputs are made canonical (D-12), and the bodies bound to their slots from the state. Every call binds afresh, and binds again after a step that changes the roster or places the terriers, and every scratch entry is written before it's read. So nothing carries from one call to the next, and one `Sim` steps any states of its pack size in any order, as M3's timeline steps the final state and its predicted clones (D-11). A test checks that tick by tick against a fresh `Sim` for each state.
- **The end is terminal** (D-8): a tick of an ended match only advances the tick. When step 3 ends the match, steps 4–7 don't run.
- **"Began in play"** is read after step 3, and events act in warm-up only (D-8).
- **Each substep,** in the spike's order: the forces and integration; detection; the floor's support; then bowling (in play), pounce tumbles (in warm-up and play) and the lunges a contact ends, all found from the contacts as detected and only then applied, so no contact's order counts; the ball's hit tick and strength; the impulses, then the hit's velocity change (A.1); the position passes and the slip-out; then the touches, contact ticks and pushes. Touching clears at the re-arm gap, and slipping once its body is down; then, in play, the goal test.
- **Step 7** is the timers, then the animation fields.
- **It throws** for a state whose pack size isn't its `Sim`'s. So do `makeSim` for a pack size outside the configuration's, the binding for a terrier outside its pack size's slots, and a kickoff placement with no spot for a terrier; no valid state reaches the last two.

### 7.3 Contacts, in brief

- **Body against body:** two spheres, normal along the line between centres.
- **Body against a piece:** the closest point on the piece; a capsule's closest point on its segment.
- **Order:** bodies interleaved by spot across packs, then the ball; pieces in list order, each paired with its mirror image. Arrays only; no `Map` or `Set` iteration in `src/core/sim`.
- **Impulses, the floor, positions and slip-out:** D-5.

**M2:** as `src/core/sim/physics.ts` detects them, through M0's fixed templates, each a contact and its mirror: the bodies by slot, A1, B1, A2, B2 … then the ball, a terrier's mirror its slot ^ 1 and the ball its own, and each piece beside its mirror. A template with an empty slot, in warm-up or a test's short pack, finds nothing, and one whose mirror isn't touching finds one contact, M0's off-mirror case. The fixed warm-up ball has no piece templates (D-8). Each piece has its bound box, and the closest-point tests read the body in place, which took the wall scrum's allocation from 17.9 to 9.5 KB a step, with the same bits. Arrays only is now the lint's, for the bots too (D-38).

### 7.4 Configuration checks (unit tests on `src/config.ts`)

- No tunnelling (D-3): the fastest body moves less than the smallest radius in a substep, and the fastest pair closes less than the smallest radius sum.
- The late window and the vote window fit in the state history.
- The kickoff spots are inside the pitch, apart from each other, and mirrored for every pack size.
- Every pitch piece's point mirror, (x, y, z) → (−x, −y, z), is in the list (D-4).
- The zoomies meter's tuned times give whole units a tick (A.1).
- The goal mouth leaves the ball room under the crossbar (L306).
- Every setting from the Configuration table is in `src/config.ts`, and nowhere else.

**M2:** as `src/config.test.ts` checks them, each with a planted bad value it must catch:
- **No tunnelling** also bounds the speeds the settings give a body directly, each under D-3's 25 m/s: run and zoomies speed, the push assist's cap (C-18), a pounce from the air, and a fall from the overhead net.
- **The windows** also leave every TICK's 16-tick input history covering the input delay and the late window.
- **The kickoff spots** are inside the floor plan by a terrier's radius, clear of the ball on the centre spot, and pack A's are symmetric about the long axis, as pack B's are pack A's point mirror.
- **A piece's point mirror** matches it in every number the contact tests read, their reciprocals included, and its mirror index names it.
- **The goal mouth** is measured on the pieces as built: under the crossbar, between the posts and the side nets, under the top net, and deep enough for the ball to get wholly behind the line.
- **Four checks are new:** the stick has A.2's 32 steps, which its five step bits fix; a terrier's floor bounce is 0, since a landing terrier never bounces (L312) and step 4 has no terrier bounce to read it with; the push assist's cap is 0, which is off, or at least the zoomies speed, so it never slows a pusher (C-18); and a bot's barks come at least two bark gaps apart, so none comes within the gap (L327).
- **The tables:** each row of the Configuration table, A.4 and A.5 names settings `src/config.ts` has, with the numbers the row gives, read from the documents at run time; a TBD takes A.5's value; and every setting is in a table, or named with its source.
- **Nowhere else:** `src` and `dev` are scanned for a setting's name holding a literal, and `src/core/sim` and `src/core/bot` for a setting's or a derived value too: any value that isn't whole or 0.5, and in a top-level constant any value but 0. A line that says `not a setting` is passed.

**M3:** eight checks are new, each in `src/config.test.ts` with a planted bad value it must catch (research/m3/DESIGN.md §10). M3's settings reach the timeline, the session, the transports and the glue through `netSettings()` (`src/core/session/settings.ts`), in their units, so the nowhere-else scan finds no copy of them. The scan knows them by the names a port would give them too, `netSettings()`'s fields and roslambo's constants (`window`, `SEND_BEHIND`), and scans `src/core/timeline`, `src/core/session` and `src/core/protocol` for a value that isn't whole or 0.5, as the simulation's, for roslambo's inline clock gains.
- **TICK's history:** `inputHistoryTicks` is 16, since a TICK's u16 masks hold 16 ticks, as the stick's steps are held to A.2's bits. With the windows' check, w is then at most 14 at d = 2: a wider w needs a wider history, a protocol version 2, and this check moves with it.
- **Trystero's frame:** the largest message and Trystero 0.26.0's 36-byte inline header fit its 16,384-byte frame, so no message is chunked, and `maxReceiveBytes` is at least that frame (D-18). Both numbers are Trystero's, at the version A.6 pins exactly; the check names them, and reads them from the installed package.
- **The spread:** the cap is at least w + 1 steps a tick, a normal tick's worst, so only a changed base far back is spread (D-11). A cap under 42 spreads a joiner's catch-up too, and the measured 14 a resync's 30 steps as well (D-11).
- **Bots stay ready:** a host sends a bot's READY again with less than the Ready expiry left, and at least the time a READY lost once takes to land on its second sending, read from the final state: 2d + 2w + `eventRetryTicks` + 2 ticks, since the host tends its bots after the timeline's advance, so a READY queued at local tick n rides in tick n + 1 + d, and a READY for the expiry's own tick still renews it. It assumes that the vote and the resync which undo a READY the others finalised without land within `eventRetryTicks` − v ticks (C-41; M3 phase 2's integration).
- **Leaving:** a page that leaves keeps its room for at least d + w ticks, so its LEAVE is final at its sender before the room closes.
- **After a stall:** a catch-up sends only its newest `stallSendTicks` ticks' inputs, a whole number from 1 to w.
- **Liveness:** pings go at most half the duplicate ID's silence apart, so a live connection always answers within C-12's 2 s, even one that sends only PEERS.
- **Counts on the wire:** the name's byte limit, the IDs PEERS lists (every browser of the mesh but its sender: the mesh cap plus the spectators, less one) and the bots a TICK carries (`BOT_SLOTS`) each fit the protocol's u8 counts; the name's limit fits A.1's byte too.
- **One tried and dropped:** a ninth, that goals 384 ticks apart outlast a repair's reach, came at phase 4 and went at its review, since a repair can reach further: D-14's goal ticks make the latch exact instead (hosting-H2).

---

## 8. Timeline, networking and consensus

roslambo's §8 applies, with these changes.

**Roles in a room:** keeper, undecided (on the Join screen, connected, choosing), player, candidate and spectator. Settler and witness go: terriest keeps no results.

**A match's life:**
1. **Propose.** As roslambo: the genesis state (pack size, match length, tick 0), the keeper, and `#join=<match ID>`.
2. **Join.** The browser connects as undecided, syncs, and shows the packs with free places, suggesting the smaller (the first on a tie). Play sends JOIN with the pack; Watch makes it a spectator, counted as D-21 says.
3. **Warm-up, Ready, start countdown, play, celebrations, kickoffs:** computed in the state (§7.2).
4. **The end.** At the confirmed end (D-14), every peer shows the results.
5. **Play again:** D-12.

**Per-tick loop:** roslambo §8.3, with re-simulation from the earliest tick whose base or inputs changed, and silent terriers predicted absent (D-11). A spectator hosting bots sends their inputs, as in roslambo.

**Practice:** the same loop over the local transport (D-22), with the clock able to pause, and a stall over 2 s opening its menu, which pauses it, instead of catching up.

**The mesh:** at most 8 browsers that play and 4 spectators (L244), enforced as D-21 says. Forwarding as roslambo D-14. With no connection after 20 s, the connection-failure message shows.

**M3:** as built (M3's design §4; research/m3/DESIGN.md):
- **Roles:** HELLO and PEERS carry 1 keeper, 2 player or candidate, 3 spectator and 4 undecided, a keeper with peers announcing 1 in PEERS too (M3-Q15). D-21's count reads only "outside the roster" and "announced spectator", so a keeper counts as outside the roster and not as a spectator.
- **Joining:** a browser without a timeline asks a peer that holds one for its STATE every `stateRequestRetryMs`, the best first by their announcements, as old as each is now, and adopts the first that answers (D-12). The connection-failure message's rule: not a keeper, and no timeline held 20 s after the room opened.
- **P3** (M3-Q1): a dissenter holds the majority's state again within v ticks, one round trip, and the ticks D-11's spread takes, at most ⌈steps ÷ cap⌉. That's for one dissenter: each candidate that is itself resyncing adds up to `resyncRetryMs`, about 0.6 s in the three-way livelock's case (D-13; M3 phase 4's answers). A page cut off from the room in warm-up, whose lineage removed the others for silence, is such a dissenter once their messages land, since it counts them (D-13). When the tick it lost has left the winners' history, its late-vote resync fails slowly, up to `resyncRetryMs` a candidate: in phase 5b's sweeps the room was one match again a median 1.1 s after the release, 3.75 s at p90 and 7.75 s at most, a 1-a-side joiner held 10 s, in every run but one, in a partial mesh (D-13's residuals (b) and (c)).
- **The exit's properties** (M3-Q21): P1–P5 and P7–P10. P6 is roslambo's ante, which terriest doesn't have, and P11 is M4's drawing. §16 says where each is tested.
- **The mesh:** forwarding as D-19 builds it, which covers a blocked pair up to about 80 ms a hop (C-55).

**Properties, each tested (§16):** roslambo's P1–P5 and P7, plus:

| | Property |
|---|---|
| P8 | A mirrored kickoff gives a point-mirrored state at every pack size, compared by value (===, so +0 matches −0): positions and velocities negated in x and y and equal in z; headings, push directions and overhead references + 2³¹; a held pitch-frame direction in the stored previous input + 16 steps, and the body a terrier slipped from as that body's mirror (M0; research/spike/REPORT.md §6); every other field equal, except each terrier's identity (player ID, name, coat) and pack. The cross-engine goldens are what check bits.<br>**M2:** as `src/core/sim/testing.ts`'s `mirrorMismatches` compares it. The ball's x, y, vx and vy and its hit change's horizontal parts each equal their own negation, so ±0. A push direction is compared once its tick isn't NEVER. A body slipped from stays −1 or the ball's slot, and a terrier's slot becomes its mirror, slot ^ 1. The intents aren't state, so nothing compares them. It runs after every substep, from a kickoff countdown at every pack size, on both shapes, through pinches and slip-outs, with the push assist on and off. |
| P9 | A goal shows on every peer's scoreboard, once, at its confirmed tick. |
| P10 | Practice sends nothing over any network. |
| P11 | Drawing never changes the state's hash. |

---

## 9. Message protocol

roslambo's §9 applies: one Trystero action, `[u8 type][payload]`, little-endian, 16,000 bytes at most, decoders that never throw, the HELLO and verdict handshake, and the REFUSE reasons. These change:

- **HELLO:** the role byte is 1 keeper, 2 player or candidate, 3 spectator, 4 undecided. The timeline kind "saved" goes, and so does "holds a result".
- **REFUSE:** reasons 1–4 as roslambo, with 4 now counted by D-21.
- **TICK:**
  - a u8 flags byte whose bit 7 marks a TICK with no input of the sender's own (a spectator hosting bots), as roslambo's does; then the u16 input (Appendix A.2);
  - the history is a u16 presence mask, a u16 mask of "same as the next newer", then the u16 inputs that differ;
  - bot entries carry the same u16 input and history, without the flags byte.
- **PEERS:** as roslambo, then a u8: the sender's role, with HELLO's values (2 player or candidate, 3 spectator, 4 undecided), sent when it changes and every 5 s (D-21).
- **Events:**

| Kind | Name | Payload |
|---|---|---|
| 1 | JOIN | u8 pack, u8 coat, display name |
| 2 | LEAVE | — |
| 3 | READY | — |
| 4 | UNREADY | — |
| 5 | SWITCH | u8 pack |

- **STATE:** as roslambo, with u16 inputs in its input records.
- **Dropped:** RESULT_REQ, RESULT and SETTLED.

**M3, as built** (`src/core/protocol/messages.ts`, `bytes.ts`; M3's design §5; e71ce8d, 2def423). The protocol version is 1:
- **HELLO,** 51 + n bytes: the protocol version, the build hash, the player ID, the role (1–4, above), the announcement (the timeline's ID, its kind, 0 none or 1 live, its phase, a tick and a hash), then the name. The tick, `finalTick` in the code, is the timeline's clock tick when it's sent, and the hash is sent but not weighed (D-12).
- **PEERS,** 24 + 16n bytes: n distinct player IDs, at most `meshPlayersMax + spectatorsMax − 1`, 11; the sender's role, 1–4 as HELLO's (M3-Q15); then its announcement, HELLO's but for the phase: the timeline's ID, its kind, a tick and a hash, each but the kind zero for none (P7's peer side, M3 phase 4a).
- **TICK,** 28 + 2m bytes and 23 + 2m more a bot (D-20): the tick, a flags byte, the input, the vote, the clock's phase in 65,536ths, the present and same masks, the inputs that differ, the events as (back, kind, payload), and the bot entries. An event further back than the history is valid, since events ride until their tick is final at the sender, which a warm-up or a spread holds back.
- **FWD:** an origin's ID, then a whole TICK. **AGAIN:** nothing more. **STATE_REQ:** a tick and the hash wanted; (NO_TICK, zero) asks for the newest final state, as a joiner, a rejoin and a merge ask.
- **STATE** (M3-Q27): the timeline's ID; the sender's clock tick and phase, never its stale local tick; g; the sender's newest final tick; A.1's bytes; a table of the senders in its records outside the state's roster, each 16-byte ID once; then a record a tick, each input naming its sender by an index into the state's terriers and then the table. Its tick bounds: g ≤ the sender's final tick ≤ its clock tick, that clock tick at most 256 + 2w + d past g, and records only up to the clock tick + d (`stateRecordsMax`), past a sleeping page's stale local tick (M3 phase 4). After the sender's final tick it leaves out records made by events alone (parts-T6), and every record of a sender outside the roster at g without a JOIN (H5).
- **Answering a STATE_REQ:** only for a tick the history holds with the hash wanted; at most one answer a connection every `resyncRetryMs`, the rest unanswered and never counted invalid, where M3's design counted them; none while a stall decides or rejoins; and with a resync outstanding for g, only for a tick before g, to one of the resync's own candidates (D-13). A STATE that this side didn't ask that connection for is invalid.
- **Invalid, beyond M3's design's list:** an event's (back, kind) repeated in a TICK, an event kind twice in a STATE's input, NO_TICK with a hash that isn't zero, and an ID table that isn't the encoder's, each entry used and in the order the records first use them.
- **Names** go on the wire as `wireString(s)`: s when it's well-formed UTF-16 within 32 UTF-8 bytes, else the empty name, with a leading U+FEFF kept, as A.1's decoder keeps it, so a sender's JOIN and every receiver's agree (M3's design §5.7). One sender's events for one tick merge by OR, and a conflicting JOIN or SWITCH payload keeps the one that sorts first by pack, coat and name, whatever the arrival order (M3-Q11).
- **What a peer may say** (roslambo §9.3, §9.4; M3-Q10): a message is its connection's player's. Nothing speaks for this browser or its bots; a bot's entry counts only for a bot derived from the sender, or from a FWD's origin; a FWD only as D-19 takes it; clock samples come from direct TICKs only. `invalidMessagesMax` invalid messages close a connection, and the transport refuses that peer from then on.
- **The flood count** (roslambo §9.3; M3 phase 5a, harness-F1, flood-F1, F2, F4 and F5): a connection's own TICKs are counted, and its FWDs for each origin apart, by the ticks they carry, not when they arrive. Each takes a slot on its sender's possible clock, which runs at 1 + `clockRateMax` ticks a tick: a TICK newer than the newest moves the slot toward its tick as far as that clock can have moved since, and one no newer stays on the slot. More than `floodTicksMax`, 360, in the last `floodMs` of slots, 120, closes a connection open for `floodMs`. A gap over d + w ticks is a silence, through which the allowance builds up; outside one, it banks at most d + w ticks. A connection's first TICK counts the silence since it opened. A new origin's count starts at the latest of the connection's opening, when its PEERS began listing the origin (or a pruned count's last FWD for it, if later), and, when the connection's latest silence of messages ended within d + w ticks, that silence's start. Origin counts are pruned only for room, at `peersMax`, never on a PEERS. The limit is `floodTicksPerTick` a tick of the sender's possible clock, about 3.1 TICKs a tick of this page's clock: flood.test.ts closes a connection that sends 3.2 a tick of it, and leaves one that sends 2.9 alone, their ticks on the clock or running ahead as fast as any clock runs.
  - **Why:** roslambo counts arrivals, closing past 360 in 2 s once the oldest is 0.9 of the window old, so a backlog over about 252 TICKs, after about 4.2 s of a freeze or a stalled link, closes honest connections about 1.8 s after it lands, and its transport then refuses the peer for good. terriest's port did that until a87b4c0: in the cap check at 4da2086, the dissenter's 7 connections closed 1.9 s after its hold, and at a87b4c0 none closes (C-56).
  - **Tested** (src/core/session/flood.test.ts; src/net/floods, backlogs, -held, -origin and -relay): freezes of 1.9–8 s, both thaw orders; holds of every link and of one, 2.5–6 s; a joiner's first TICKs as a backlog; a frozen or held forwarder; a forwarder's relayed burst after a silence, either connection first; new origins' backlogs; and every flood shape, closed within 500 ms of its start and never before `floodMs`.
  - **The residual,** accepted (M3 phase 5a's answers): the allowance a silence builds isn't capped, so a peer silent for S ms may burst about 3·S/16.3 TICKs. Over time its rate stays `floodTicksPerTick` a tick of its possible clock, a burst's cost is paid once a silence, and the transport's congestion control spreads it. A cap at the clock's 742-tick reach would close honest connections again after a freeze or a stalled link of over about 16 s, a laptop's sleep among them.

---

## 10. Persistence

- **Engine:** localStorage (D-24). Keys and shapes are in Appendix A.3.
- **Profile:** player ID, display name, coat (a random one on the first visit, stored at once), and which inputs have finished their hints.
- **Settings:** extra relays and one TURN server (as roslambo); names over terriers; start in ball view; calmer camera; mirrored touch layout; sound; render quality. The calmer camera and render quality follow their defaults until the player chooses (Appendix A.3).
- **One tab:** a Web Lock named `terriest-game`, with **Use here** (D-24).
- **Bad data:** an unreadable profile is copied to a backup key before a fresh one is made. A failed write loses that write only, and Home says so.
- **Not stored:** anything about matches. Nothing lasts (L216).
- **Safari:** C-14.

---

## 11. Screens and input

**Navigation:** roslambo's state machine. While in a networked match the URL fragment is `#join=<match ID>`, so a reload returns to it; Home clears it.
- **The fragment** is set with `location.replace("#join=<id>")` and cleared with `location.replace("#")`, and the router ignores the `hashchange` its own replace fires. It's never set by assigning `location.hash`, which adds a history entry each time, so Back and Forward would walk through old `#join=` links and re-open ended matches, contacting the relays. A bare `#` routes Home. No History API (D-38).
- **Settings during a match:** on Match, the menu's **Settings** opens as a panel over the pitch, which keeps drawing. Its **Back** returns to the match, and opening it never disposes the screen, the renderer or the game. Held inputs are released while it's open. From Home, Settings is a screen, as in roslambo.

| Screen | Contents |
|---|---|
| Home | Display name, editable (20 characters, 32 bytes); coat, from the fixed list; **Propose a match**; **Join** with a code field; **Practice**; **Settings**. Opening a `#join=` link skips it. |
| Propose | Pack size (1–4, default 2) and match length (1–10 minutes, default 3). **Create** shows the link (copy, and share where available) and the code in groups of four, with "Keep this page open until someone joins". Then **Play** (with a pack), **Watch** and **Leave**, at once (as roslambo, as amended). |
| Practice | Pack size and match length, then Pre-match. |
| Join | The packs, with free places and who's in them; **Play** in a pack (the smaller suggested); **Watch**. A returning player skips it (D-17). |
| Pre-match | The pitch with terriers warming up; each pack's list with name, coat and Ready; **Ready**; **Switch pack**; **Add a bot** and **Remove a bot** for each pack, for players and spectators; **Leave**; "Invite" (link and code); the stick and buttons on touch; the start countdown over the pitch. |
| Match | The pitch; the score, each pack's in its colour and pattern, your pack marked; the clock, showing overtime; the countdown before each kickoff; the scorer's name after a goal; away marks. Players: zoomies meter and pounce wait; the stick and buttons on touch. Spectators: a choice of what to follow, by tapping a name or with the view key or shoulder buttons. A menu button: **Settings**, **Leave**, and in Practice **Resume**. |
| Results | The final score, each terrier's goals (a shared goal counts for each sharer, as the screen says) and touches, the Terriest; **Play again**; **Home**. |
| Settings | Extra relays and your own TURN server; names over the terriers (off); start in ball view (on); a calmer camera, in both views (off, unless the system asks for reduced motion); mirrored touch layout (off); sound (on); render quality (high; whether phones start at low is your call with their measurements, D-33); "Show control hints again". Everything but relays, TURN and render quality applies at once. In a match, render quality rebuilds the drawing when the menu closes (D-33); relays and TURN apply from the next match. |
| Messages | The boot failures (D-30); graphics lost; canary failure, on Propose and Join (Practice still plays, D-23); a build mismatch; the connection failure (roslambo's wording); "This match is full, so you're watching it"; "The players have left" (Q-16); spectators full. |

**Input:** D-29. **Sideways phones:** D-30. On a phone held sideways, the stick and buttons sit over the pitch (L170).

---

## 12. Rendering and the look

**The scene:**
- **The pitch:** grass with a procedural texture made at run time; each half and its goal in the colour and pattern of the pack that defends it (L68); the halfway line and centre spot; clear plexiglass walls, with a post at each pane's joint, a kick band in each half's pack colour and a rail along their tops (C-57); cut corners; a rope net overhead. Outside the walls, a gravel apron and grass that fades into the sky, placeholders until the look book (Q-11).
- **Shadows:** a blob under each terrier and the ball, which is cheap and reads well from above.
- **Fading:** the net and the ball fade to see-through when between the camera and your terrier (D-28). The glass clears near the camera and round the line from it to your terrier, and a goal's frame and netting fade alike; from behind its goal line, a face of the netting the camera is outside of isn't drawn (D-28's M4 note, C-57).

**The ball:**
- glossy rubber;
- squashed and thumped by its last hit's strength, from the state (D-9);
- turned as if rolling, from its drawn motion: drawing only (§2).

**Terriers:** D-27.
- **Animations** (L98): standing, running at any speed, zoomies, turning, pushing, being pushed or bounced, jumping and landing, pouncing, tumbling and getting up, barking, sitting, celebrating. Each but barking is read from the state (D-9) and timed by its start tick. Barking starts from the received input (D-16), and celebrating shows from the goal's confirmed tick (D-14).
- **Overlays:** barking plays over any animation, and celebrating over standing and running; the rest blend.
- **In place:** only the simulation moves or turns a terrier.

**Effects:** dust behind zoomies; a tumbled terrier rolling over and shaking itself off; the net bulging at a goal; a bark mark over every barking terrier, shown to everyone, since a page can't tell a muted device (L50).

**Each frame:** the predicted state one tick behind the newest, interpolated by the tick's fraction (roslambo's `interpolate.ts`, in 3D), plus D-16's correction offsets.

**Nothing compiles in play:** three compiles a shader program the first time each material variant is drawn, which on a phone could cost a frame over L286's 50 ms.
- At startup, behind Home, the renderer compiles every program a match can use with three's `renderer.compileAsync`, on a scene holding one of each: the code-built drawer's materials, the opaque and faded variants of the walls, net and ball, and every effect (dust, bark mark, net bulge, tumble), at the current render quality. Effect meshes and particle pools are made then too. A rebuild (D-30, D-33) does the same again.
- `compileAsync` compiles programs but doesn't upload geometry, so one render with frustum culling off follows it, before play (M0; D-27).
- A faded surface swaps to its precompiled faded material, so nothing toggles `transparent` in play.
- A model that loads later is compiled the same way before it replaces the code-built terriers.
- The gate checks this by counts (§16), and the frame bench prints the same counts beside its verdict.

**Your terrier** is marked in a way colour isn't needed to see; names show over the others if Settings says so. Names are always set as text, never as markup: on every screen, in the scorer's name and over the terriers (L224).

**Colours:** each coat is a fur colour and markings, defined apart from drawing, and stored and sent as its index in the list (L44). A palette test, as roslambo's, checks each coat against both packs' colours and against the grass, under simulated protanopia, deuteranopia and tritanopia. It also checks pack A's colour against pack B's under each simulated vision type, as roslambo's test keeps its quarry's and hunter's marks apart, and each pack's colour against both halves' floors. The packs differ in pattern as well as colour (L43), though on the phone the pattern reads only up close (C-51).

**The drawing budget (L243):**
- **What's counted, per terrier:** triangles, bones and texture size; draw calls for 8 terriers; download size for each way of drawing them.
- **How:** counted in the real page through three's `renderer.info` and the drawer's own counts, at both render-quality settings. The gate fails a page over budget.
- **Download size** is counted at build time, brotli-compressed. Each drawer is a chunk of its own (the model drawer and GLTFLoader still shipped in `dist/`), three's renderer, shared by both, is a line of its own, and a model's `.glb` and textures count from their files. A build plugin reads the sizes from Vite's bundle, since a manifest left in `dist/` fails the dist audit, and the build fails when a figure is over budget. In the real page, Resource Timing checks that each way loads only its own chunks and assets.
- **The figures:** the starting guesses below are a ceiling until the Pixel 8a has run. M0 records the spike's counts against them and may lower a figure, never raise one, since no desktop run stands in for the phone (C-2); the phone run at M5 sets them (Q-4).
- **Starting guesses** (*estimates*; M0 may only lower them):
  - a code-built terrier, 2,000 triangles;
  - a model, 8,000 triangles, 32 bones and a 512 × 512 texture;
  - all 8 terriers, 40 draw calls;
  - each way of drawing them, 200 KB compressed, three not included.
- **M0, confirmed** (research/spike/REPORT.md §3, §8): every figure stands, and none is lowered. The spike's counts are under every guess, and nothing measured on the desktop shows a guess too high for the phone, which sets the figures (C-2):
  - a code-built terrier, 1,516 triangles, and 8 of them in 9 draw calls;
  - the stand-in, 2,220 triangles, 8 bones and a 256 × 256 texture, and 8 of them in 16 draw calls. It tests the drawer, not the ceiling: a model at the guesses has 3.6 times its triangles, and 4 times its bones and texture pixels.
- **M0, amended: the texture figure** counts the model's own textures per terrier (research/spike/REPORT.md §5.4, §8). three's bone textures and its standard material's lookup texture aren't the model's, so they're counted apart.
- **M0, amended: the download lines** (research/spike/REPORT.md §5.5, §8):
  - three's core, a line of its own: 118,806 B brotli;
  - the code-built drawer's share: at most 23,747 B, the entry chunk without three, which also holds the simulation and the scene;
  - the model drawer's share: its chunk and the model, 30,572 B with the stand-in. A real model at the guesses must fit the 200 KB.
- **M3** (M3-Q19): the protocol, timeline, session and brain go into the game's chunk, loaded with the screens at M4, and Trystero into its own chunk, loaded by `NetGame.open` alone (D-18). The code-built drawer's share above is read as the drawer's own code. M4's per-chunk plugin counts them all; their sizes at M3's exit, minified and brotli-compressed, are in §17's M4 entry.

**Render-only maths** may use `Math.sin` and the rest; the exact-ops rule applies only to `src/core/sim` and the bot brain (D-38).

**The look (Q-11):** placeholders until M4.
- **The look book:** a dev page served by Vite (`dev/look-book.html`) that replays matches recorded from the tuning page and the bots through the drawer interface, with several sample looks side by side. It shows a side view of a push for each sample, and the stand-in model is checked the same way, so no head sinks into the ball (D-27). Each sample is also shown at the phone's landscape size, 915 × 355 CSS px, with terriers 5, 10 and 20 m away, at both quality settings (C-51).
- **Your pick:** terriers and coats, pack colours and patterns, the ball and the pitch.
- **A look of its own:** no name, term or look comes from the game in the pitch line (L15). The samples are made to that rule, and the screens' wording is checked against it.
- **Again for models:** the same page runs again for the models later.

**The model upgrade, later (L97, L345):**
- **The models** load through the model drawer of D-27. Nothing in play, the simulation or the network changes.
- **hermet's audit:** it first needs an option that allows `.glb`, reads each model's JSON, and fails any `uri` that names a host or an unshipped file. Models ship as `.glb` files beside the bundle, never embedded in code, so the audit can read them (L345). Draco or KTX2 compression also needs its decoder's `.wasm` allowed, and the CSP gains `'wasm-unsafe-eval'` in script-src and `worker-src 'self' blob:` if a decoder ships (D-35).
- **The painting convention:** a made or bought model must meet D-27's: a `fur` material, a markings mask, and a `bandana` material.
- **Licences:** a bought model's licence must allow redistribution of the file as shipped, as CC0 and CC BY do. Its notice, and any decoder's, goes in through the licence writer's `extra` entries and the expected list.
- **Budget:** the same counts apply. M0's stand-in already measures what a skinned model costs on this machine.

---

## 13. Sound

D-32. One `AudioContext`, made at start-up, resumed at each keydown, click, pointerup or touchend until it runs, and resumed again when the page is shown. A gamepad press may not count, so while sound is on and the context isn't running, the pitch says "Press a key or tap for sound". A master gain follows Settings.

**When each sound plays:**
- **Remote barks:** from received inputs only (D-16).
- **Bounces, pounces and tumbles:** from the predicted state, when their event first appears there, keyed by kind, body and tick. An event of the same kind and body that a re-simulation moves by up to 3 ticks doesn't play again. One a correction removes has already played and is left to finish; each lasts under 0.3 s. A thump takes its loudness from the first sighting.
- **The kickoff whistle:** when play starts. Its tick was fixed by ticks final seconds before, so no correction moves it.
- **A goal's whistle and chorus:** at the confirmed tick, with the score (D-14).
- **The end whistle:** at the confirmed end, with the results (D-14).

---

## 14. Bots

D-39, with roslambo's hosting:
- players and spectators add bots to either pack before the start countdown, one at a time, up to the pack size;
- **Remove a bot** takes this browser's newest bot in that pack;
- a host that leaves before the countdown takes its bots out;
- bots sit while their host is away, and a host that comes back takes them back;
- **Play again** brings a host's bots into the next match, in their packs if there's room, else the other (D-12).

**M2:** the brain (D-39) and the bot IDs are built, and the hosting is M3's.
- **IDs** (`src/core/bot/bot-id.ts`, roslambo's): a bot's ID is a version-8 UUID from a hash of its host's ID and its slot, so every peer tells a bot from a person, whose ID is version 4, by the ID alone, and a host finds its bots again after a reload. A host has 8 slots, Practice's 7 bots and a spare. A bot's coat and its noise seed come from its ID too.
- **Names** (the owner, 2026-11-22; `botName`, `BotHost`): a bot's name is a robot dog's from `BOT_NAMES`, 32 of them, checked by a web search and not a legal review, the borderline ones kept yours to strike (the status above). Its first choice is the entry at a hash of its ID; if that's taken in its match, the next one round the list that isn't. Its host picks it as each JOIN goes, so it's none that another terrier in the final state or the head has, nor another of the host's bots, nor the host's player, whose JOIN can still be on its way, as Practice's is beside its bots' at genesis; a retry, Play again's other pack and a new timeline's JOIN pick again, from what's free then. A JOIN carries the name, so no peer works it out. "Bot" and four hex digits of the ID, roslambo's name, is left for a list all taken, which a match never comes near. A host sees only what has reached it: two pages that add bots before either's JOIN reaches the other can pick one name, and a person can join under a bot's. This amends M2's design §1.17, whose `botName` takes the ID alone, M3's §4.8, whose JOIN carries `botName(id)`, and M4's §5.7, whose Pre-match lists name a bot "Bot" and four hex digits, and so mark it one. The owner chose its mark on 2026-11-23 (the status above): wherever a row names a terrier, a bot's swatch is a robot's head, drawn in the swatch's own box, and " bot" is heard after its name (`src/ui/screens/bot-head.ts`); a bot is told by its ID.
- **To the simulation a bot is a player:** it's always ready because its host sends its JOIN with READY and re-sends READY before it expires, as roslambo's hosting does. A host that is away sends nothing for its bots, so they're removed after 3 s in warm-up, and from the start countdown on they sit after 2 s (D-12, D-16).
- **The brain runs once a local tick** on the host, never in the timeline's re-simulations, so it adds nothing to a replay (C-2).

**M3:** hosting as built (`src/core/session/bots.ts`; D-39): a bot's READY goes again with 10 s of its Ready left (C-41), a host that comes back adopts its bots, and a removed bot's LEAVE goes again in warm-up (D-12). The brain thinks once per head tick, its view keyed by tick, so M2's marks count as before (D-39).

---

## 15. Build tooling and hosting

**npm scripts:**

| Script | Does |
|---|---|
| `dev` | Vite dev server, including `dev/tuning.html` and `dev/look-book.html` |
| `dev:local` | the dev server plus hermet's local Nostr relay, so desktop browsers can play each other by hand without the public relays (dev only; production never uses it; below) |
| `lint` | ESLint, including D-38's boundaries |
| `typecheck` | `tsc --noEmit` |
| `test` | vitest, including `vendor/hermet`'s tests |
| `build` | `typecheck && vite build && node scripts/licenses.mjs && node scripts/audit-dist.mjs`, after a `prebuild` step that stops, naming `git submodule update --init`, if `vendor/hermet` is empty (below) |
| `e2e` | Playwright: Chromium, Firefox and WebKit, against the built page and the local relay |
| `public-scan` | tracked files contain no home paths, keys or private terms |
| `check` | `lint && public-scan && typecheck && test && build && e2e`: the gate |
| `deploy` | `check && wrangler deploy`, with wrangler's stored login (Q-6); each run waits for your go-ahead |
| `emit-goldens` | rewrites the golden hashes; refuses unless `TERRIEST_EMIT_GOLDENS=1` |

**M1:**
- `dev:local` arrives at M3, `emit-goldens` at M2, and the per-chunk size plugin with M4's drawers.
- A `precheck` step runs prebuild's submodule check before the gate too, since lint imports `vendor/hermet` first.
- In `playwright.config.ts`, a spec that launches every engine itself is named `*.net.spec.ts` and runs once. Every other spec runs in each engine's project, and a `test.only` fails the run.

**M2:**
- **`emit-goldens`** is `node scripts/emit-goldens.mjs`, guarded twice. Without `TERRIEST_EMIT_GOLDENS=1` it refuses, and exits 1. With it, it runs `src/core/sim/golden.test.ts` with a second variable, `TERRIEST_EMIT_GOLDENS_BY_SCRIPT=1`, which only the script sets. The test writes `goldens.json` only with both, and only once every run covers its spec; with the first alone it fails, naming the script. So a stray exported variable can never let `npm run check` rewrite the goldens and pass. `scripts/emit-goldens.test.mjs` checks both refusals.
- **`dev`** serves the tuning page at `/dev/tuning.html` (below). `vite.config.ts` builds `index.html` alone, and `vitest.config.ts` includes `dev/`'s tests, so the page's model test runs in the gate.
- **The tuning metrics** have no npm script, since the gate never runs them: `TERRIEST_TUNING_OUT=research/tuning/results.json npx vitest run --config dev/vitest.config.ts` runs `dev/tuning.metrics.ts`, in about 7 to 9 minutes here, and rewrites the committed results. `TERRIEST_TUNING_OUT` names the file a run writes; without it a run writes `research/tuning/results.json`, and refuses to overwrite it, so while that file is committed a bare run stops at once. `TERRIEST_TUNING_ONLY` picks its sections, `TERRIEST_TUNING_BASE` measures from settings other than `src/config.ts`'s, and `TERRIEST_TUNING_CANDIDATES` replaces candidate lists, as the file's header says. research/tuning/REPORT.md holds M2's method, its commands and its results.

**The tuning page** (`dev/tuning.html`, Q-10; M2): dev only, never built, and it touches no storage.
- **What it runs:** the real simulation and the bot brain at 60 ticks a second, drawn on a 2D canvas, since only `src/render/**` may import three (D-26): the plan view, the side elevation at true scale, and an 8 m close-up of the ball.
- **Its 139 scenarios** are built on `src/core/sim/scenes.ts` and `cases.ts`, so the page runs the scenes the tests and the metrics run: kickoffs and bot matches, C-18's pushes, the slip-out cases and dribbles, simultaneous hits, bowling, shots into the netting, contacts and touches, and every golden run. One terrier follows the keyboard, in any frame.
- **Its sliders,** 79, cover every setting the simulation and the brain read. `dev/tuning/model.test.ts`, in the gate, fails a configuration key that's neither a slider nor listed as not tuned, with its reason.
- **Its values** ride in the URL fragment, written with `location.replace`. **Copy settings** writes them as a snippet for `src/config.ts`, and as PLAN's A.4 and A.5 rows and the Configuration table's, in their own wording.
- **A run can be recorded,** with its whole configuration, its start state, every tick's inputs and its final hash, and downloaded as JSON, for M4's look book. The model test replays one to its hash.

**`dev:local`:** the dev server hands the page the local relay's URL through a dev-only Vite variable, read only under `import.meta.env.DEV`, so the build drops it. There, the screens and the `#test=net` page both use it as their only relay, with the browsers' default ICE, never roslambo's `local: true`: its loopback rewrite works only for the end-to-end tests' specially launched engines (`e2e/lib/browsers.ts`, from roslambo).

**M3:** as built (M3's design §1.29–§1.33, §1.38, §6.6):
- **`dev:local`** is `node scripts/dev-local.mjs`: hermet's `nostr-relay.mjs` on 127.0.0.1 at a free port, then `vite` with `VITE_TERRIEST_LOCAL_RELAY_PORT` set, the relay closing when Vite exits. The page then uses `ws://<the page's host name>:<port>` as its only relay, so a Windows browser that reaches WSL2 through `localhost` reaches the relay too, with production's ICE, STUN from `third-party.json` (M3-Q4). `src/net/dev-relay.ts` reads the port, loaded only by `import()` under `import.meta.env.DEV` (D-38), so no build emits it, which `scripts/dev-relay-audit.mjs` checks on `dist/`: no `dev-relay` chunk, and no file naming one or `VITE_TERRIEST`. A check for a bare address couldn't do that job, since Trystero's own code holds 127.0.0.1 for its mDNS rewrite.
- **The build inputs:** `scripts/build-inputs.mjs` hashes the sources peers must agree on (D-21), and `vite.config.ts` and `vitest.config.ts` define `__TERRIEST_BUILD_INPUTS__` from it, which `src/build-info.ts` exports; any other config that loads that file, the harness's included, defines it too.
- **The licences:** `scripts/expected-licenses.json` gained `@trystero-p2p/core`, `@trystero-p2p/nostr` and `@noble/secp256k1` at phase 5 (4da2086), when the `#test=net` page brought `src/ui/game.ts`, and so Trystero's chunk, into the build. The dist audit needed no new option: Trystero's default relays are bare host names, which it doesn't read as hosts, and `ignoredHosts: ['stun']` has covered its STUN template since M1.
- **The runs outside the gate,** none an npm script, as the tuning metrics aren't:
  - **the correction measurement:** `TERRIEST_CORRECTIONS_OUT="$OUT/results.json" npx vitest run --config dev/corrections.vitest.config.ts`, with `$OUT` a folder outside the repository, so the tree stays clean from the first run to the last; once the last is done, the files are copied unmodified into `research/corrections/` and committed together (research/corrections/REPORT.md section 1.12, amended at 71bd4a7). Without `TERRIEST_CORRECTIONS_OUT` it refuses to overwrite a committed `results.json`; `_ONLY`, `_SEEDS`, `_CAP_RUNS`, `_BASE` and `_MERGE` pick profiles, cut seeds for a smoke run, set the cap check's runs, measure from other settings, and merge runs made in several processes, as its header says. The method runs it in one process, or the profiles in seven processes at once, then the cap check alone on a quiet machine, then the merge;
  - **the 12-page load run:** `npm run build && TERRIEST_LOAD_OUT=research/load/results.json npx playwright test -c playwright.load.config.ts`, on `vite preview` at port 4349, which refuses to start without `TERRIEST_LOAD_OUT`; `LOAD_SECONDS`, 90 by default, sets the play it measures;
  - **the desktop connection's provisional settle:** `npx playwright test -c playwright.dev-local.config.ts`, which starts `npm run dev:local` at port 4359 and plays a match between headless Chromium and Firefox with `ice=none`, so it contacts nothing public, the guard allowing the dev server's `ws://` origin for Vite's reloads (§16, §17).
- **CI:** M3's first push, with your go-ahead, plays the networked match on the hosted runner for the first time. If the runner can't hold its three engines' WebRTC, C-6's rule applies: a `check:ci` labelled partial leaves out exactly that spec, and the local gate stays the definition of done.

**A fresh clone:** `vendor/hermet` is a submodule, which `npm install` doesn't fetch. So L279's `npm install && npm run build` holds from a clone made with `--recurse-submodules`, or after `git submodule update --init`, as the README's Run section says, like roslambo's.

**No LAN dev server:** the phone runs use the deployed site. terriest refuses an insecure context (D-30), so a phone on the dev server's LAN address would get only the boot message. If the phone comes up before a deploy, amorfus's `dev:lan` (Vite over https with a self-signed certificate) is added then; on this WSL2 machine, a phone on Wi-Fi also needs you to run an administrator `netsh interface portproxy` command.

**Vite:**
- `base: './'`, `build.target: 'es2022'`, no source maps, and `build.license.fileName: '.license-npm.json'` for hermet's licence writer;
- `dev/` is excluded from the build;
- three is imported by name from `three` and `three/addons/…` only, so tree-shaking drops the rest. D-38's lint bans `three/src/…`: its unbuilt sources would bundle a second copy of three beside the addons' own import, and aren't what C-9's M0 audit checks;
- each terrier drawer is a chunk of its own, the model drawer imported dynamically (D-27), and a build plugin records each chunk's compressed size for the drawing budget (§12).

**Dist audit:** hermet's, through `scripts/audit-dist.mjs` (D-37). Shipped files stay inside its allowlist (`.html .css .js .txt .ico .png .svg .webmanifest`):
- textures are procedural, or PNG or SVG;
- fonts are the system's;
- sound is made in code;
- data is imported into the bundle.

**Licences:** hermet's writer, as fixed at 11283ca (Q-3, D-37), through terriest's wrapper. The audit fails an expected package that isn't bundled, so `scripts/expected-licenses.json` lists what the bundle holds at each milestone: three from M1, and `@trystero-p2p/core`, `@trystero-p2p/nostr` and `@noble/secp256k1` from M3, when `src/net/trystero.ts` enters the bundle.

**wrangler.jsonc:** assets only, `./dist`, observability off, terriest.com as a custom domain, `workers_dev` and Preview URLs off (Appendix A.7). A test checks it, as amorfus's does: assets only (no `main` or `run_worker_first`); `assets` equal to `{ directory: './dist', not_found_handling: 'none' }`; observability off; `routes` equal to `[{ pattern: 'terriest.com', custom_domain: true }]`; `workers_dev` and `preview_urls` false. Its parser strips only whole-line comments, as the siblings' do, so A.7 keeps every comment on a line of its own.

**CI:**
- **The workflow:** roslambo's `check.yml`: a checkout with submodules, `npm ci`, the Playwright browsers, `npm run check`, plus the unit suite on arm64 for the goldens. One change: the check job runs `xvfb-run -a npm run check`, because Firefox has WebGL only with a display (C-6), and `npx playwright install --with-deps` already installs xvfb.
- **The gate:** it asserts WebGL 2 in each engine before playing anything (C-6).
- **The first push, at M1, is a spike:** WebGL 2 in all three engines on the hosted runner, the empty pitch's frame rate and the job's wall time, logged in `docs/acceptance.md`. As amorfus's D-17: if an engine can't draw there, or the hosted runner can't hold the real-page matches, CI runs a separately named `check:ci`, labelled partial, that leaves out exactly those specs, and the local `npm run check` stays the definition of done. **Settled on 2026-11-18 by the first run** (a4ead1a, M1 with M2): WebGL 2 in all three engines, the empty pitch at 44.8, 59.9 and 62.2 frames a second in Chromium, Firefox and WebKit, and the full gate in 1 min 58 s of a 26-minute job, most of which was apt fetching the browsers' system libraries. CI runs the full gate, and there's no `check:ci`.
- **What it needs:** Actions enabled on `gargantis/terriest`, as it is, and a push, which waits for your ask.

**Repo files at M1:**
- `.gitignore`, `.npmrc` (`legacy-peer-deps`) and `.nvmrc` (22), as roslambo;
- `third-party.json`;
- `docs/acceptance.md`, with L286's frame-time criteria copied from roslambo's (the pass figures and the 60 Hz rule) and an empty run log; M4 extends it (§17);
- `CLAUDE.md`, with roslambo's contracts plus terriest's: the simulation never imports drawing code; only `src/render/**` imports three (D-26); drawing reads every animation but barking from the state (L345), and keeps only blends, smoothing offsets, the timings it is fading out and each bark's start; coats and bandanas go by list index; the stand-in model stays out of `dist/`; new behaviour needs a test through the real page; Firefox draws WebGL only with a display, so the gate runs under WSLg or `xvfb-run` (C-6); nothing in a test depends on the frame rate, and the gate plays its matches at the low render quality (C-6, D-33);
- the README:
  - run, with the clone step for `vendor/hermet`; test; build; deploy, with the first deploy's check of terriest.com's DNS records (Q-5); privacy; licence;
  - known limits: Safari may delete stored data after 7 days (C-14); real Safari is unverified unless Q-12's run happens; phone performance is unverified while its run is pending (Q-13);
  - how to turn off Windows' Sticky Keys shortcut (C-52); how to run the gate without a display (`xvfb-run`); and the opt-in GPU path (C-6);
- no LICENSE file, if Q-1 holds.

---

## 16. Tests and the gate

**The gate:** `npm run check`. It passes at the end of every milestone from M1, and before any deploy. It's never weakened to make a build pass. Its wall time is logged in `docs/acceptance.md` at each milestone's exit, from M1.
- **M2, its cost:** 123–124 s here at M2's exit, the commit that applies M2's review, in two runs, against M1's 76 s and the 97–105 s M2's design estimated (research/m2/DESIGN.md §12). It took 114 s once the bot marks arrived, 123–131 s with the tuning page, 129–141 s at the commits that settled the values, and 138 s at the plan's amendments: runs here vary by more than the review's tests cost (`docs/acceptance.md`).
  - **The unit stage** takes about 34 s: 50 files and 584 tests. Most of its CPU is the simulation in the bot marks' whole matches, 40–42 µs a tick at 4 a side. vitest runs files in parallel and each file's tests in turn, so the long loops are files of their own: each mark, the regulation mark's 100 whole matches in four files of 25, and the tunnelling fuzz in two.
  - **The end-to-end stage** takes 1.2–1.3 minutes: 14 tests in each engine, the determinism page's 2 among them.
  - **Nothing was cut to save time:** no mark, seed, scene or engine.
- **M3, its cost:** 513.0 and 519.3 s here at M3's exit, in two runs, the second started as the first ended, against M2's 123–124 s and the 4.7–5.2 minutes M3's design estimated (research/m3/DESIGN.md §13). Through M3 it took 122.8 and 124.2 s at phase 1 (e71ce8d), 140.4 and 142 s at phase 2, 175.7 and 180.3 s at phase 3, 171.4 and 172 s at phase 4a, 189 s at 995f206, 274.3 and 276.7 s at phase 4, 461.4 and 463.0 s at phase 5, 506.8 and 507.4 s at phase 5a, a87b4c0, and 526.5 s at phase 5b, 600f2f0, then 552.7 s on a busier run at the method's commit, 0ab6b24, 508 s at its amendment, 71bd4a7, 532.8 and 538.6 s with the measured values, 9236de3, and 525.1 and 581.2 s with the plan's amendments, b43b154 (`docs/acceptance.md`).
  - **The unit stage** at M3's exit: 228.0 and 236.1 s, 158 files and 1,378 tests, about 2,370 and 2,460 s of test time, against M2's 34 s and the 20–28 s more M3's design estimated. At b43b154 it took 241.3 and 253.3 s, 157 files and 1,365 tests, about 2,520 and 2,620 s of test time. At phase 5b it took 243.5 s at 600f2f0, 157 files and 1,355 tests, CPU-bound, about 2,530 s of test time, and 264.4 s on the busier run, with 1,365 tests. Most of it is whole networked matches in virtual time, each with a node checking its chain: under the gate at b43b154 the five longest were R-7's setup files, 42.8–44.4 s, in the first run, and in the second three of them, 41.3–43.6 s, with consensus.test.ts and backlogs-relay.test.ts at 40.0 s, and at a87b4c0 R-7's setup files took 42–47 s each, the Play-again races 41–42 s and M2's first regulation file 41 s; phase 5a's 16 files add about 300 s of test time between them, and phase 5b's 10 about 171 s, 9.3–22.7 s each under the gate and 1.8–5.9 s alone; phase 6a's `dev/load/backlog.test.ts` takes under 1 s alone. vitest runs files in parallel, so a long loop is a file of its own, none much over 8 s alone, as M2's marks are.
  - **The end-to-end stage** takes 4.0 minutes, as it did at b43b154 in 4.0 and 4.2: 59 tests pass, and 2 skip, Practice's spec in Firefox and WebKit. The three-engine match is 2.4 minutes of it, ending 11–0 at tick 8715 in both runs.
  - **Nothing was cut to save time:** no seed, scene, engine or spec, as M3's design's §13 kept them. A profile of the test harness's own costs, not its seeds, is an option for later, yours (M3 phase 4's answers).

**Simulation (vitest, fast-check):**
- A resting ball's and a standing terrier's state stays bit-identical for 10 minutes of ticks. So do the bodies of a terrier against the ball at a wall, and of one pressing the ball into it (M0): their positions, velocities, headings and floor flags.
  - The two scenes at the wall start from 1 µm overlaps and settle before they're compared, for 10 ticks, or 60 while the terrier presses, as M0's tests do, and the test asserts that their contacts exist. Bodies placed exactly touching can end up apart by rounding, 6.7e-16 m in M0, and never touch (research/spike/REPORT.md §6).
  - M0's cost revisit rests on the pressing scene: it's the only test 3 substeps fails (D-3).
  - **M2:** the ball pressed into the wall rests 0.13 mm up, with its floor flag clear, and stays bit-still, which `contacts.test.ts` pins. It needs no tolerance: the flag gates only the rolling slowdown and the jump, and in the open a steady push keeps it set (L57).
- A bounce above the threshold keeps 70% (ball against surfaces) or 50% (terrier against ball) of its normal speed, within 1%; below it, contacts settle.
- **Simultaneous hits:** k = 1 to 4 terriers hit a resting ball at once, from the floor and level, approaching in parallel, with the drive, idle friction and the ball's rolling slowdown off. Horizontal momentum is conserved within 1e-9 and kinetic energy doesn't rise. The ball leaves faster than for one hitter at every k > 1, and the speed at each k is pinned (M0). From the floor, four parallel hitters send it slower than three, 3.685 against 3.810 m/s, under D-5's frictionless contacts. L56's "several hitting it at once send it faster" still holds, since every k > 1 beats one hitter (research/spike/REPORT.md §5.2). Hitters aimed at the centre are measured and reported.
- A rolling ball slows by the configured rate within 1e-12 m/s a substep and stops exactly.
- **Pushes:** with the rolling slowdown, one pusher brings the ball to 95% of run speed in 1.2 s ± 10%, and four in a train in 0.6 s ± 10%. Two and four side by side, in the pitch and the ball frame, reach marks set with you at M2 (C-18). **M2:** the marks are C-18's, settled provisionally by measurement, each ± 10%: in the pitch frame, two round the ball 0.829 s, two on a line 0.833 s, four round 0.721 s and four on a line 0.758 s; in ball view, with the push assist on, 1.175, 1.175, 0.983 and 0.854 s, each also quicker than one pusher's 1.225 s. `push.test.ts` also pins each measured time to the millisecond, so a change to the drive or the assist sets the marks again on purpose. A lone pusher's drive target stays its base speed through its push, off the axes too, with the assist on (`assist.test.ts`).
- **A ball on terriers** (D-5's slip-out):
  - a ball resting on terriers that keep pushing toward it comes down within 1.5 s, M0's mark, timed from its first landing on them: in the ball frame and with opposite directions in the pitch frame, mirrored at each pack size and with one pack 2 cm and 1 tick off mirror. Under 42° with the flag, the worst of M0's 864 cases took 1.383 s (research/spike/REPORT.md §5.2);
  - two sitting terriers let it reach the floor within 0.5 s;
  - a lone terrier dribbling at run and at zoomies speed never slips out;
  - a kickoff pinch, its fall and the slip-out land mirrored, for each pack size;
  - "comes down" and "reach the floor" mean the ball's centre within 1 cm of its resting height, or its floor contact found in detection (M0). Between two sitting terriers, 42° with the flag takes 0.471 s by the first and 0.475 s by the second. The ball's centre at or below its resting height isn't the reading: the ball stays a fraction of a millimetre up between them, and both 42° rules then fail (research/spike/REPORT.md §6).
  - **M2:** the gate runs M0's own subset of each case, under the chosen rule with the slip release (`slipout.test.ts`): 128 rest cases, the worst down in 1.06 s; the sitting pair in 0.471 s; the dribbles, the two lowest hops pinned at 43.23° and 43.53°; and the pinches, down in 0.433–1.962 s. M0's full sweeps, 864 rest cases and 2,880 dribbles, are the tuning metrics', run whenever the collider, the drive or friction moves (C-21). Three more tests hold the slip release (D-5): a terrier 9 m clear of the ball brakes and turns back within 0.5 s, its flag still set; the hold-off acts within its 0.6 m and not beyond; and it reads its own setting, not the re-arm gap.
- **L57:** a terrier running into a resting ball at run speed hops it; one meeting it at the ball's centre height hits it level; two running in from opposite sides lift it off the floor; a steady push from contact keeps the ball's on-floor flag set throughout.
- **P8:** a mirrored kickoff gives a point-mirrored state at every pack size, compared by value as P8 says, on the pitch and on D-4's second shape. **M2:** after every substep, with the push assist on and off (§8).
- No tunnelling at 25 m/s; the ball never leaves the pitch or sits wholly behind a goal line outside the goal (fuzzed). The check that a terrier never passes through the ball tests height too (M0): without it, M0's check counted a terrier running under a ball popped to 3 m, with the floor out of the solve (research/spike/REPORT.md §4). **M2:** the fuzz pins its count of substeps with the ball wholly behind a goal line, all inside a goal: 15,051 on the pitch and 16,214 on the second shape at the netting's settled 0, against 1,101 and 1,449 at 0.3, since the netting no longer bounces a ball back out. Since M2's review a test also closes two terriers on each other at 50 m/s head on, and one at 25 m/s on another standing, D-3's bound for a pair: neither pair passes through.
- **Movement:**
  - run speed, acceleration and turn rate;
  - zoomies, the meter and its lockout;
  - jump height and airtime; a landing terrier stays on the floor, with no bounce, from any height;
  - pounce distance, its end on contact, and its wait; a pounce pressed during the lunge is dropped;
  - tumbles, get-up and guard;
  - idle terriers can be pushed.
  - **M2's review:** the animation's fields (D-9) have tests of their own in `movement.test.ts`, as only the goldens pinned them: the gait turns a cycle per 0.6 m on the floor and holds in the air; each phase follows from its condition in M0's order, its start tick changing only with the phase; and a push records its direction in plan and its tick on the terrier pushed, and nothing when it's straight down.
- **Steering:** all three frames resolve as D-7 says, including the ball overhead and its hysteresis; holding sideways under an overhead ball turns the terrier once, to the reference plus the step; `datan2` against `Math.atan2`, and its point symmetry (D-2).
- **Presses:** a press acts once, a predicted input never repeats one, and a tap shorter than a tick still counts (D-10). A press after 1 and after 13 absent ticks acts once; a returning player's first input acts no press. Every u16 is a valid input (fuzzed). The bark bits never reach the state's hash.
- **Rules:**
  - what each phase allows;
  - kickoff placement and resets, and warm-up arrivals on a free spot or the first clear point (D-8);
  - the event order in a tick: a pack switch in Practice lands in one tick (D-12, D-22);
  - touches per episode and the re-arm gap;
  - goal tests at the posts, the crossbar and the netting;
  - credit and own goals, shared credit and the scorers the state records; a goal in the tick that brings the clock to 0, which still gets its celebration;
  - the clock stopping, overtime, the end;
  - the Terriest and its ties;
  - Q-8's bowling rule and its exceptions.
  - **M2:** in `rules.test.ts` and `events.test.ts`, on placed states and from genesis, the goal tests on both shapes. `netting.test.ts` holds the netting at its settled 0: each of the 18 shots into a goal that the tuning page and its metrics run too (`scenes.ts`'s `NETTING_SHOTS`), at 5 and 10 m/s, at 0°, 20° and 35° in plan, rolling, high and lobbed, scores and stays wholly behind the line through its celebration, and at 0.3 every one comes back out. At 0 its margin is about 1 mm, at the substep each shot scores, so a livelier net, if you pick one, needs the check relaxed with it.
- The same events in any arrival order give the same state (P4).
- **M2: the port's bit pins** (`step.test.ts`). Printed digits can't show that a port is faithful, so six of M0's scenes, a resting and a rolling ball, a push, a pinch, the wall scrum and a dribble, hold the bodies' bits at ticks 1, 60 and 600, 18 pins, and a hash chained over every tick's bits to 600 for each, 24 in all. They were recorded from the spike at 85775cd by a script outside the repo that ran both simulations in one Node process, so nothing in the repo imports the spike (D-36). They run under a configuration copy at M0's values, written out in the test, so tuning never moves them: they check the port. A mismatch is a port bug, never fixed by re-pinning. Four were re-pinned once, on purpose, for the slip release, each from the tick the release first acts, and each still matches the spike's own chain to the tick before (D-5).
- **M2: one `Sim`, many states** (`step.test.ts`, `events.test.ts`): one `Sim` steps the wall scrum, a seeded kickoff, a warm-up with holes and a mid-run clone in turn, and two warm-up states taking JOINs, SWITCHes and arrivals in the same ticks, and each tick's hash matches a fresh `Sim`'s for each state (§7.2).
- **M2: properties** (`properties.test.ts`): random rosters, events, names and every u16 in a stride of 7, in every phase, with terriers stacked and slipping, then leaving and switching. `step` never throws, and every 10 ticks the state is valid and round-trips through the codec byte for byte, so no slipped-from ever names an empty slot.

**Determinism:**
- Golden hashes at checkpoints for scripted runs: each pack size, kickoffs, goals, overtime, all three steering frames, a mirrored kickoff, a resting ball, a squeeze, pounces and tumbles, joins and leaves.
- Checked in Node, and in Chromium, Firefox and WebKit through the production bundle's `#test=determinism` page; also on arm64 in CI.
- The canary is one of them. A changed golden fails until `emit-goldens` is run deliberately.
- **M2: the goldens as built** (`src/core/sim/scripts.ts`, `goldens.json`): 25 runs, 75,500 ticks, hashed every 500 ticks and at the end, with their counters, and the canary (D-23).
  - **From genesis,** through the rules: a match at 1 and at 4 a side in all three frames, each with a goal and the kickoff after it; a match that ends at 0:00 with a lead; one that goes to overtime and ends on its goal; the roster run, every event and bad value with its outcome checked at its tick; warm-up play into the fixed ball; the mirrored kickoffs at 1 to 4 a side; and a 3-minute long run at 4 a side.
  - **Placed:** a resting and a rolling ball; pushes by one, by four in a train, and by two and four abreast in ball view, so by 1, 2 and 4 terriers, not 3; a squeeze; the pinches at 2 and 4 a side, the latter at zoomies speed; the scrums at the wall and in a corner; pounces and tumbles with Q-8's bowling; the nose frame; and goals and own goals.
  - **Each run's coverage is asserted** from its result: at least the goals, pounces, tumbles, hits, bounces, pushes, slip-outs, zooming and most contacts in a substep its spec names, the phases it must pass, how it ends, and its checks. So a run that stops covering its column fails, even after a re-emit, and an emit refuses to record one.
  - **Not in them:** D-4's second shape, which P8, the fuzz and the goal tests run, and the bot brain, which would move them whenever it's tuned (D-39).
  - **Their cost:** about 1.2–2 s to replay in Node, and 1.3–2.2 s an engine on the determinism page. The page, the goldens and the scripts are a chunk of their own, and the spec checks that a normal page never loads it and that the page's own module holds none of it.
  - **Re-emitted twice, on purpose,** after the first emit at a9aca0a: for the slip release (ccf92c8; the canary from 08a15af95ae031ef to de2bb0d7a95ae1e7), and for the settled values (c82c3e8; 14 of the 25 runs change, and the canary becomes eea91a8dd7ba3cf4).

**Timeline and consensus (simulated network):** roslambo's loopback tests and properties P1–P5 and P7, adapted for packs; plus:
- P9 (a goal on every scoreboard, once, at its confirmed tick), including a resync for a later tick after the goal shows;
- a pack's last place taken by two JOINs in one tick; a JOIN or SWITCH for a full pack given up, and the Ready a switch cancelled staying cancelled (D-12);
- a Play-again race, including players and bots whose packs are full; the abandoned-match rule, including a proposer who watches at once and waits 40 s, and a spectator who arrives after the players have left;
- a returning player skipping Join, including into a match with 4 spectators;
- a browser that arrives, or reloads, while the others are on Results takes the final state from one of them and shows the same results (D-17, C-50);
- spectator counting (C-11): a burst of undecided peers stays within 8 + 4, a peer lingering on Join doesn't turn a watcher away, and two newcomers handshake without a state; a duplicate ID replacing a silent connection (C-12);
- every loopback scenario (late inputs, absences, a join, a resync, a late-vote flip), with each tick's predicted chain checked against a full replay, including a worst tick spread over several, which M0 calls for (D-11);
- a TICK lost and then filled from the history leaves the predicted counters unchanged (D-11);
- a silent player's terrier, and a bot whose host is away, sits in every peer's predicted state within D-16's sit threshold plus w ticks, and stands again when its inputs return;
- a hidden page throttled to one timer a second never sits, in the final or the predicted state (adapted from roslambo's `network.test.ts`);
- Practice: a gap over 2 s between timer runs pauses it, and a shorter catch-up keeps every tick's local inputs (D-22).

**M3: as built** (`src/core/timeline`, `src/core/session` and `src/net`'s tests; M3's design §8). They run over `src/net/loopback.ts`, the network simulator: virtual time and a seeded PRNG; links with a latency, a jitter and a loss modelled as an extra round trip, FIFO per link; the real two-round handshake, which times out on both sides; each node's clock offset and drift and its timers' pace; a frozen node that runs nothing until it thaws, its timers first or its messages (`thaw`); and one ping out per peer at a time. In each test one node checks its chain against the full replay at every 8th advance and at every STATE and changed base, every node does at every advance in the replay files, and `twin` compares a `fullReplay` copy at every final tick both make (D-11).
- **P1, P2:** network.test.ts, a proposer, three players and a late spectator to the confirmed end with every final hash equal; and every page's hash at a common final tick in the three-engine match.
- **P3:** consensus.test.ts, a corrupted float, a lost terrier, late-vote flips from 2 s back in play and in warm-up, two voters at 1 a side at 30 and 80 ms, and a three-way split; crossing.test.ts, two voters' crossing resyncs; returning-seeds and -more, the three-way livelock's seeds; and resync-asks.test.ts. And D-13's voters a lineage removed for silence: `src/core/timeline/removed.test.ts`, over the timelines alone; cutoff.test.ts, a page cut off in warm-up for 4.5 to 8 s at 2 a side, the last page, a spectator and a page that rejoined after a stall, with cutoff-4 and -4-long at 4 a side; cutoff-joiner, a joiner whose STATE came 4.5 to 8 s late; partitions, -4 and -mesh, warm-up partitions from 1–1 to 4–4, 1–3, 3–1 and 3–5, in a full mesh and a partial one; cutoff-play, holds of 8 s in play, which pass without the rule and guard against it (split-F4); and rogue-removed, rogues removed for silence (L201, L203).
- **P4:** joining.test.ts: six JOINs at once over links of 10–150 ms, a pack's last place taken by two JOINs in one tick, and T6's joining split.
- **P5:** mesh.test.ts and forwarding.test.ts, a blocked pair in step at 30 and 80 ms, and apart without forwarding; and bots.test.ts, a host's bots forwarded.
- **P7:** merges, announce, the races (-1, -2, -3, -seeds, -more) and the rings (-seeds, -more), and again.test.ts: two presses at once, presses at the tie's edge, and a full room of 8 that play and 4 that watch pressing in a race, none refused with REFUSE 4.
- **P9:** consensus.test.ts and scoreboard.test.ts, and every page's goals in the three-engine match. **P10:** src/net and src/ui's practice.test.ts, local.test.ts, and the Practice spec.
- **§16's other items,** as M3's design §8.1 maps them: spectators, returning, misbehaving and rogue, stalls, hidden, abandoned, again and bots; the replay files (replay, -repairs, -mesh, -senders, -play, -play-more), the in-play ones with every node checking at every advance but no twin, since a full replay of a whole match costs about 17 s, while Practice's twin compares the full replay in play (src/net/practice.test.ts); and the bursts (-seeds, -watchers, -near, -far), newcomers arriving together.
- **R-7's setup** over the network simulator (bots-setups and -1 to -6, driven by `src/net/setups-testing.ts`): seed 7 at its Ready tick, 600, with the reload's absence at 0.5, 2 and 5 s, and ten more seeds whose Ready tick moves 31 a seed, 631–910. All 13 are decisive, 9–0 to 11–0 but seed 8's 4–0; the slowest first goal came after 15.1 s of play, seed 9's, 34.3 s from genesis, and the latest end at 150.4 s; seed 7 scores first after 5.3 s of play and ends at 145.3 s. Practice's setup is src/net/practice.test.ts's (D-22).
- **Phase 5's, 5a's and 5b's:** the clock across freezes in stalls.test.ts and `src/ui/freeze`, -four, -more and -messages; the flood count in `src/core/session/flood.test.ts` and `src/net/floods`, backlogs, -held, -origin and -relay; round trips in `src/core/session/rtt.test.ts` and `src/net/rtt-periodic`, -periodic-two, -double and -step; forwarding in `src/net/forwarding.test.ts`; and the voters a lineage removed in `src/core/timeline/removed.test.ts` and `src/net/cutoff`, -4, -4-long, -joiner and -play, partitions, -4 and -mesh, and rogue-removed (P3, above). `src/net/freezes-testing.ts`'s rig, twice a pack's pages playing by the brain, freezes and holds them. Since phase 5b it also cuts a page off, holds a joiner as it enters, or partitions the room, in warm-up or in play (`cutOff`, `joinerHeld`, `partitioned`, `Rig.partition`); checks for one match after, every page in every roster with one hash and nothing closed (`settle`, `expectOneMatch`); and lets a test give a page a rogue's link (`RigOptions.link`). `src/core/timeline/testing.ts`'s `Inside` shows the voters a timeline counts out of its roster (`removed`).
- **Files past M3's design's lists,** each phase's: src/net/trystero.test.ts (phase 2); `src/ui/clock-testing.test.ts` (phase 3); joining, mesh, bursts, bursts-seeds, merges, races, ring, rogue, announce and resync-asks in src/net, and asks and forget in src/core/timeline (phase 4a); crossing, the replay files past replay.test.ts, returning-seeds and -more, the races' and rings' files, bursts-watchers, -near and -far, bots-setups-1 to -6, timeline-match and twin (phase 4); phase 5's, 5a's and 5b's above; and `dev/load/backlog.test.ts`, the load run's backlog watch, in the gate (phase 6a, below). misbehaving.test.ts's FWD flood measures the connection's age from the keeper's side.

**M3, protocol:** messages.test.ts and fuzz.test.ts as M3's design §5.8 has them, names that start with U+FEFF among them, and sizes.test.ts the largest STATEs (D-18).

**Protocol, match ID, storage:** every message round-trips and fuzzing never makes a decoder throw. The largest STATE, a late-vote resync's at 8 terriers with 32-byte names, carries every input tick without the encoder dropping one (D-18). A property test steps the simulation with random events and inputs (any byte for pack and coat, any 16-bit input) and checks that `step` never throws and the state stays valid (D-12). roslambo's match-ID tests are ported, plus the documented example. The profile and settings schema, including settings that follow their defaults until chosen (A.3), recovery from bad data, and the tab lock.

**Rendering, input and sound (vitest):**
- interpolation and smoothing maths; drawing leaves the state's hash unchanged (P11); the palette, pack against pack and against both halves' floors (C-51);
- a correction that moves a pounce's start by 3 ticks: no joint moves further in that frame than in the frames around it, so the drawn pose changes continuously (D-27);
- the cameras: a player's keeps its place behind its terrier, outside the walls and in or behind a goal too, at its height, never risen or in a jump (C-57), occluders fade, and the arrow points to an off-screen ball, or to one drawn behind the HUD's top bar. At both camera settings, ball view turns no faster than its cap, and never in a jump, for a ball hopping over the terrier at 5 m/s and for one resting on terriers above it; and a terrier circling the ball at run speed from 3 m keeps it in view (D-28);
- anchoring: chase view re-reads the screen only from neutral, at 45° (Q-19) or on a switch of view (D-29), and a stick swept 90° in 0.5 s turns the terrier by the amount pinned for each camera setting;
- remote barks play only from received inputs, never predicted ones (D-16), and the sender keeps to one a second (L327);
- sound under rollback (§13): a bounce re-simulated one tick later sounds once, and a predicted end that a correction turns into overtime blows no end whistle.

**Bots:** seeded games and states reach Q-9's pass marks, the fall-back included; mirrored bots diverge; a host's bots in its TICK, one vote per host, and a host that reloads takes them back, as in roslambo. The marks, each over 100 seeds, with values tuned at M2:
- **Empty goal:** one bot and a resting ball at seeded spots at least 2 m from any wall, nobody defending. At least 95 score within 20 s.
- **A goal in regulation:** 2-a-side bot matches at the default 3 minutes. At least 90 have a goal before the clock reaches 0.
- **Never stuck:** a bot is stuck if it holds a direction and isn't sitting, tumbled, lunging or in a countdown, yet its centre stays within 0.5 m for 5 s. That never happens in the first two marks' runs.
- **The fall-back (L142):** seeded states at each pack size in which a rival is nearer the ball than a pack's nearest bot. In at least 90, that bot is moving toward a point between the ball and its own goal within 0.5 s after its reaction delay.

The brain keeps to exact operations (D-39), so the counts are the same here and on CI's arm64 job.

**M2: the marks as built** (`src/core/bot/marks.ts`; a file for each mark, and the regulation mark's whole matches in four), each met at A.4's starting values and again at the settled ones:
- **Empty goal:** 1 a side, placed in play with the other pack empty, a test-only state no match reaches, so nobody defends. The bot and the ball start at seeded points at least 2 m in from the walls, the bot's heading seeded. 100 of 100 score within 20 s, the slowest in 11.3 s.
- **A goal in regulation:** from genesis, four bots of one host, each sending JOIN and READY at tick 1 and READY again every 50 s. 100 of 100 have a goal before 0:00. The same 100 matches also play whole, to the end through up to a minute of overtime, for the never-stuck mark; 17 go to overtime.
- **Never stuck,** in every tick of both marks' runs: never. Since M2's review `marks-stuck.test.ts` shows the watch can fire: it reports a terrier held into a wall at the 300th tick of its streak, once, starts over when one leaves its 0.5 m circle, and reports none that holds nothing, is tumbled, lunging or sitting, or waits in a countdown or the end.
- **The fall-back, restated** (bots-F1 in the code's comments). M2 reads its wording three ways, so that falling back and chasing head different ways. M2's first setup put the bot beyond the ball, where a chase goes round the ball toward the bot's own goal as a fall-back does: the brain passed it 98, 97, 95 and 95 times at 1 to 4 a side, but a brain without the fall-back passed it too.
  - **The rivals are idle:** the rival pack holds nothing, one of its terriers at the ball, its centre within 1.2 m of the ball's and not touching it, so a rival stays nearer and the ball stays put.
  - **The bot isn't on the attacking side:** it starts 1.25–3.5 m from the ball, level with it or on its own goal's side, and 1.8–4 m from Q. Its packmates start 1 m farther from the ball than it, and the seed picks which pack defends.
  - **Headings differ:** every terrier's heading is seeded.
  - **The measure:** Q is the point 3 m from the ball toward the bot's own goal's centre, or that centre if it's nearer. At 0.75 s, its reaction delay of 0.25 s plus 0.5 s, the bot passes if it has come within 1.5 m of Q, or is moving at 1 m/s or more within 45° of Q, and it fails at once if it touches the ball before coming that near. At least 90 of 100 pass at each pack size, as before. The brain passes 100 at each, a brain without the fall-back 21, 26, 29 and 31, and one that charges the ball none, so the mark can fail.
- **The end-to-end setups,** not a mark: §16's three-engine match and Practice, played whole over 25 seeds each from genesis, so M3's and M4's specs don't find a failing setup first. Each ends at 0:00 with the bot's pack ahead, the slowest first goal after 11.1 and 5.7 s of play.
- **For your play test,** every mark also passes at reactions of 0.15 and 0.35 s and at aim noise of 5° and 15°, the empty goal at 99 of 100 with 0.15 s.
- **The marks' values** are these measures', fixed before the brain was tuned to meet them, and it met them with no key tuned. Your play test at M4 sets its level (Q-9).

**Build and hosting (vitest):** the ESLint config test, every banned construct in each file group (D-38); the `wrangler.jsonc` test (§15); and a test that reads `public/_headers` and checks the immutable `/assets/*` rule and each CSP directive, `wss:` and `blob:` in connect-src included (D-35).

**End to end** (Playwright, the built page, the local relay on 127.0.0.1, no public hosts):
- **Every match these tests play is 1 minute long and decisive by setup,** so none waits on an overtime: a match level at 0:00 fails its test at once. Each whole-match spec's timeout comes from measured runs of its setup, and a timeout reports the score and the clock. Only the three-engine match, Practice and M3's `#test=net` match play to the end; every other spec leaves once its check is done.
- **The three-engine match, through the screens and real controls:** Chromium proposes, Firefox joins by link and WebKit by typed code.
  - **Its setup:** pack size 2, with Chromium's player and one bot in pack A, and Firefox's and WebKit's players in pack B. Every player moves its terrier from the keyboard during warm-up. In play, A's player holds back in ball view for the first second after each kickoff and then lets go, and B's players hold nothing. So A's bot is the terrier nearest the ball, and scores against a pack that doesn't defend (Q-9).
  - **Without a mouse:** Ready is pressed from the keyboard on two pages and from the stubbed gamepad on the third. On Results, a jump held or mashed through the end presses nothing; then Play again is pressed from the keyboard on one page and from the gamepad on another, and both reach the next match's Pre-match (L82, Q-17).
  - **Mid-match:** a fourth page, in Chromium, joins as a spectator and sees the same state (L281), and WebKit's page reloads and takes its terrier back (L282).
  - **It checks:** the terriers and the ball move; every page shows each kickoff's countdown, each goal and the results (L103, L344), with the same score and results; A scored; and the score wasn't level at 0:00.
- **M3's `#test=net` match:** a scripted match over the local relay through the `#test=net` page, without the screens, as roslambo's (§17).
  - **As built** (`e2e/match.net.spec.ts`, in the `net` project, once; M3's design §8.4): the local relay, and the three engines launched through `e2e/lib/browsers.ts`, with roslambo's flags for WebRTC between pages on one machine and `ice=local`'s loopback rewrite, each page's WebGL 2 asserted first; Chromium the keeper, in pack A with `script=back` and hosting its bot; Firefox and WebKit in pack B with `script=none`; Ready at tick 600; pack size 2 and 1 minute, seed 7. A fourth page, in Chromium, joins as a spectator once the keeper's report shows play under 50 s on the clock, and WebKit's page reloads under 35 s, each triggered from the report, never a sleep. Every page is watched with `watchPage` and checked with `expectEverywhere`, and the spec imports `test` from `guards.ts` too, though the guard's own page goes unused.
  - **It checks** the start countdown's first tick, 603 to 617; every page's confirmed end at one tick, with one hash at a common final tick, one score, rows and Terriest; the goals each page latched since its arrival, a goal under way at the arrival required unless the arrival came in the last 141 of its celebration's 204 ticks (d + w + 1 + 6 + 120, page-F3); and the reloaded page returning, its terrier's last input within 30 ticks of the end. Duplicate HELLOs are reported, and decide nothing (D-21).
  - **Measured:** every run at 4da2086 and a87b4c0, 3 alone and one in each gate run, and both gate runs at phase 5b, ended 11–0 at tick 8715, the goals at 1220, 1914, 2678, 3348, 4018, 4691, 5423, 6099, 6796, 7516 and 8235, 145.7–149.7 s after genesis, the countdown from 603, with no late input, disagreement, resync or jump. The spectator arrived at ticks 1905–1929, about goal 1914; WebKit's reload came at the keeper's 3935–3949, its page held the match again from 3947–3978, and its catch-up took 39–42 steps in one advance. At the cap of 14 all four gate runs, two at 9236de3 and two at M3's exit, ended the same way, 151.0–151.4 s after genesis: the spectator arrived at 1907–1917, WebKit's reload came at the keeper's 3939–3947 and its page held the match again from 3953–3958, its catch-up spread at most 14 steps an advance. The reload was built first as a short spec of its own and run ten times, twice, 10 of 10 both times, 21.7–22.3 s each, WebKit's input final everywhere 370–957 ms after the reload began (M3's design R-5).
- **M3: `e2e/nettest.spec.ts`,** in each engine: a normal page loads neither test page's chunk nor Trystero's and has no `net` hook; `#test=net` with no relay, with `room=%` or with a `wss:` relay `third-party.json` doesn't list says so, starts and contacts nothing ("The network test didn't start, and contacted nothing: …", matched by its start, since a spec can't import at run time a module that imports JSON), nothing more coming judged by `networkidle`; and the page's build hash is Node's.
- **M3: `e2e/practice-net.spec.ts`,** in Chromium (M3-Q22): `#test=net&mode=practice` at 1 a side, Ready at tick 20, where the person lands at 15, to the bot's first confirmed goal. It checks the countdown's first tick, 23 to 37, and the goal latched once; no RTCPeerConnection, no WebSocket and nothing requested off the page's origin, and Trystero's chunk never requested (P10). §16's Practice through the screens is M4's.
- **M4: `e2e/camera.spec.ts`,** in each engine (C-57): Practice's warm-up at 1 a side, the ball on the centre spot, your terrier backed by S in ball view from its kickoff spot into its own goal, then by W, D and S into the −y side wall; then, in chase view, turned away from that wall by S and let go, so the chase camera swings out behind it, backed into the wall and turned again if it stopped too far off for that, up to three tries. At each, the camera drawn is outside the pitch's region, behind the goal's back or beyond the wall, 2.1 m up, as it is at every look, the glass draws the near panes' kick band from outside, and your mark shows, in ball view with no arrow, so your terrier and the ball are both in view. Each ball-view leg ends at the first look that finds the terrier against the netting or a wall, so a bump from the wandering bot can't hang it. Against the camera before C-57 it fails in the goal, where that camera was held inside the goal, in front of the terrier, and risen to 2.6 m.
  - **What's drawn,** read off captures taken with the terrier and the camera at rest, each region placed by the camera's own numbers: from the kickoff spot, the outfield's grass through the far end wall, not the glass's tint; behind the goal, the ball's colour round its drawn centre, the back netting reported not drawn and no netting's lines across the pitch through the open back, and the near end wall's kick band beyond the post, drawn once from outside; outside the side wall, the ball's colour, and your white coat untinted where the line to it crosses that wall's kick band; and the coat again in chase view. Each threshold lies between what the build draws and what a build broken on purpose drew, measured in each engine: opaque glass, the near panes in the inner draw too, no outer draw, an opaque outer draw, the back netting drawn and the line fade off each fail it (C-57's review). If a bump leaves the camera elsewhere than behind the back netting, the goal's netting and band checks are logged as skipped.
- **M4: `e2e/pitch.spec.ts`'s glass test,** in each engine (C-57): in the warm-up, your terrier backed by S until the camera is out past the end wall and brought back by W, the glass's outer draw draws at every look the camera is outside a wall's plane, naming the end wall's pieces, and at none it's inside them all, and nothing compiles in play.
- **Touch** in Chromium's emulation, through the DevTools protocol: the stick, its rim for zoomies, two buttons held at once; a touch that starts inside the edge margin doesn't move the stick (D-29). **A gamepad** through a stubbed `navigator.getGamepads` in all three engines. The stub holds each press until `window.terriestTest.inspect()` shows it registered, and each press counts once, so no test depends on how often the page reads the pad.
- **Practice**, in Chromium, 1 a side against one bot, plays a whole match and contacts no one (L238, L283, P10).
  - **Its setup:** the person's kickoff spot, (−10, 0), is on the line from the ball to its own goal. So in play the person holds sideways in ball view for the first second after each kickoff, out of the bot's way, and then holds nothing, and the bot scores into an open goal.
  - **Nothing contacted:** the request guard sees no request, but it can't see STUN or TURN, so an init script also wraps `RTCPeerConnection` to count constructions: there are none for the whole match, and the count stays zero on Home until Propose or Join (L238).
  - **The menu without a mouse:** opened by Escape, and later by the stubbed gamepad's Back, it stops the clock and play. Resume, pressed by Enter or Start, or closing the menu carries on (Q-15, Q-17). A hidden page, emulated through `visibilitychange`, opens it too. A reload mid-match goes Home, in one of the shorter Practice runs below.
  - The stand-in model draws its terriers (next).
- **The stand-in skinned model**, served by interception, in place of the code-built terriers (L252):
  - it plays the Practice match in Chromium, and a Practice through its first goal's celebration in Firefox and WebKit, with no console errors. Each runs from a strict static server that serves `dist/` with `dist/_headers` applied unchanged and answers 404 for a missing file, as terriest.com does (A.7): amorfus's `e2e/lib/serve-gateway.mjs` without its IPFS mounts. Practice needs no relay, so the shipped policy is tested as it is. The networked tests stay on the plain server; any run under the headers gets `ws://127.0.0.1:*` added to connect-src by the test server only, never in `public/_headers`, which the dist audit scans (D-37);
  - its budget counts are checked. It draws every coat index and both packs, on Practice's Pre-match at 4 a side, over as many starts as that takes, and its counts show each one painted. A bark and a goal's celebration play on it, checked through its counts;
  - delayed 5 s, the terriers are code-built first and swapped mid-match, with the state hashes unchanged;
  - refused with `route.abort`, the terriers stay code-built while the match plays on through its first goal, and the console check allows the browser's own failed-request message.
- **Control hints** show on the first use of each input kind, each clearing once its control is used, and stay cleared after a reload (L83).
- **Your terrier's mark**, and with Settings' names on, the names over the others, read through `window.terriestTest.inspect()` (L52).
- **A phone held upright:** on Pre-match, a coarse-pointer portrait viewport (Chromium, `hasTouch`, 412 × 915) shows the turn prompt, and landscape (915 × 412) clears it (L170). The mirrored layout puts the stick on the right (L169).
- **Boot failures:** no WebGL 2 (Chromium `--disable-webgl2`, Firefox's pref, a WebKit init script), an insecure context (`http://insecure.test/`, below), `file://` (`dist/index.html` opened as a file, as amorfus's file project does) and the load timeout (the module script aborted by routing, with the message shown after the timer). Each shows its message and is checked with axe.
- **A lost context mid-match,** through `WEBGL_lose_context`, in each engine. Restored within 5 s, the pitch draws again, with the drawer's counts as before. Never restored, the plain message with **Leave** shows after 5 s and is checked with axe, while the other pages still get this terrier's inputs and votes. In Practice, the clock stops until the context is back (Q-15). A change of render quality mid-match takes the same rebuild when the menu closes, with the counts of the new setting (D-33).
- **Nothing compiles in play:** in the three-engine match and in Practice, `renderer.info.programs.length`, `renderer.info.memory.geometries` and `renderer.info.memory.textures` don't change from the start countdown to Results (§12). In the Practice match, the stand-in has loaded before Ready is pressed. The lost-context and render-quality tests, the stand-in's delayed load, and the pages that reload or join mid-match are outside this check.
- **The site served from a subpath**, with every request staying under it (L232).
- **A build mismatch** is refused with its message. **A failed canary** says why on Propose and Join, and Practice still plays (D-23).
- **How the insecure context, the subpath, the mismatch and the failed canary are made:** the insecure context is `http://insecure.test/`, and the subpath mount is `/a/b/` on the preview's own origin. Both are fulfilled from `dist/` by Playwright's request interception, because `vite preview` answers 403 to a Host it doesn't list and serves only `/`; amorfus's strict server, which accepts any Host, would also do. The mismatched peer loads the bundle rewritten through interception, so that its build hash differs, and the failed canary's page loads it with the canary's expected hash rewritten the same way.
- **Everywhere:** no request outside `third-party.json`, and no console errors. A test that reloads or leaves a match accepts D-30's leave prompt. **M1:** the guard is stricter. A test may reach only the servers it loads from and a local relay it names, so the gate contacts no public host at all, as this section's heading says, and the engines' WebGL warnings count as errors. `third-party.json` still bounds what the build may name (the dist audit) and, from M3, what the app contacts.

**By hand, for now** (you, on your desktop; logged in `docs/acceptance.md` from M1; if one has to wait, §17's rule for attended steps applies):
- **M0:** the spike's scene page in Chrome, Edge and Firefox on Windows (`http://localhost:<port>`, through WSL2's forwarding): its frame verdict on your GPU, recorded in `research/spike/REPORT.md`.
- **M2:** the tuning page: the feel and M2's values (Q-10). *At M2:* you chose "settle", so Claude settled the values by measurement, logged owner-pending in `docs/acceptance.md`. The page is there for you to confirm or change them before the deploy.
- **M3:** two of your desktop browsers connect through `npm run dev:local` on the `#test=net` page, so M4's match isn't that path's first run.
  - *At M3:* Claude settled it provisionally on 2026-11-19, under §17's rule for attended steps, by `e2e/dev-local.run.ts` on C-6's GPU path at 71bd4a7, before the measured values reached `src/config.ts`, so at the spread cap of 42, and logged it owner-pending in `docs/acceptance.md`: a Chromium keeper and a Firefox player at 1 a side with `script=brain` and `ice=none`, through `npm run dev:local`'s local relay only, so nothing public was contacted. 37 checks found both connected, ticking and in agreement, and both reached one confirmed end, 3–2 at tick 6871, in 2.1 minutes (research/corrections/REPORT.md section 2.8). Run again on 2026-11-20 at M3's final tree, at the cap of 14, it passed the same way: 39 checks, the same end, in 2.0 minutes. It's yours to make before the deploy. `docs/acceptance.md` gives the two addresses to paste, with a room ID only the local relay ever sees. At phase 5 the provisional settle's run passed once as a smoke, a Chromium keeper and a Firefox player with `ice=none` and only the local relay: 39 checks, 3–2 at tick 6871, in 2.0 minutes.
- **M4:** Practice in each desktop browser with the keyboard, and a gamepad if you have one, against bots whose level you accept or change (Q-9). The cameras: the chase-view swing, and the feel values confirmed in ball and chase view (Q-10); the plexiglass walls and the camera outside them, settled provisionally at the comparison's defaults (C-57). A match between your three desktop browsers through `npm run dev:local`. The frame bench on your GPU. The look book (Q-11).
- **M5:** the deployed site, in desktop browsers and on the phone (Q-4).

**Outside the gate** (logged in `docs/acceptance.md`):
- **M2:** the tuning metrics (§15), whose sweeps hold C-21's window and M0's full slip-out cases, run again whenever the collider, the drive or friction moves. M2's are in research/tuning/REPORT.md;
- the 12-page load run (8 that play, 4 spectators);
- M3's correction measurement over the network simulator, reported in `research/corrections/REPORT.md` (D-16);
- the bench's CPU figures (tick cost, and frame work excluding draw submission) at the Pixel 8a's size in throttled Chromium. Its frame intervals there measure SwiftShader, which throttling doesn't slow, so they aren't logged as a phone proxy;
- **the frame-time run (L286),** written into `docs/acceptance.md` at M4: the bench plays a whole 4-a-side match at the default 3 minutes, all eight terriers driven by the bot brain, seven of them as virtual peers at 20–80 ms with 15 ms of jitter. It's measured from the moment all eight are in, through warm-up, the start countdown and play, to Results, with at least one goal, its celebration and a kickoff inside it. It passes at p95 ≤ 18 ms and max ≤ 50 ms, with the display at 60 Hz. Only the pass figures and the 60 Hz rule are roslambo's;
- the Pixel 8a runs, at M5: the frame-time run, at the render-quality setting phones start with (D-33), and real touch. Firefox and Edge for Android each play a Practice match with real touch, and Firefox joins one networked match (L236);
- the relay check, with your go-ahead;
- real Safari, if the device round before M5 names one (Q-4, Q-12).
- **M3, as built:** the correction measurement and its cap check (`dev/corrections.measure.ts`), the load run (`e2e/load.run.ts`) with its backlog watch (`dev/load/backlog.ts`) and the desktop connection's provisional settle (`e2e/dev-local.run.ts`), by §15's commands.
  - **The correction measurement** (M3's design §9; research/corrections/REPORT.md): one browser a terrier, each driving its own terrier with the brain, so every other terrier is remote to it (M3-Q2); browser 0 proposes a 1-minute match, the rest join 200 ms apart, half in each pack, and each presses Ready at tick 360. 72 profiles, pack size 1 to 4, 30, 80 and 150 ms one way with 20 ms of jitter, d = 2 and 3, and loss of 0, 0.1% and 0.5% a message (M3-Q13), 6 seeds each loss-free and 4 lossy; and four partial-mesh profiles, pack size 4 with one or two pairs blocked at 30 and 80 ms, which decide nothing. A profile the protocol can't carry isn't measured (harness-F6). It logs every correction and each browser's figures in memory, and writes them a browser and a match at a time with each profile's pooled figures, keeping the bootstrap's replicates for the bodies rules 1 and 2 read at the loss-free 80 ms profiles, so the rules can be computed again from the committed file; each browser's exact p95s are written beside its match summary's binned ones, as a check of the bins. Each file records the code it was measured at, its commit, its `src`, `dev` and `scripts` trees and whether the tree was clean, and the rules read its figures to six significant figures. The cap check (D-11): a 4-a-side match over loss-free 30 ms links, the next TICK on each link into one browser held 4,100 ms from 15 s after the match began, in play, FIFO holding the rest, so its repair starts about 240 ticks back, in 20 runs, a garbage collection before each, deciding only on a quiet machine. A merge of runs made in several processes refuses files measured at another configuration, base, method or code. In the gate, `dev/corrections.test.ts` checks the profiles, the loss model, the statistics, the reach, the rules and the merge on synthetic figures.
  - **Measured** on 2026-11-19, from 03:15 to 04:37 UTC on the 20th, at 71bd4a7, whose `src`, `dev` and `scripts` trees are the method's, the tree clean at every run (research/corrections/REPORT.md section 2): the seven groups, the cap check alone and the merge, as its section 1.12 says; the cap check alone at 31, 20, 18 and 14; and, since the decisive profiles' largest steps in a timer run, 42, were over 14, every profile again at 14. 355 of the 360 matches ended at each cap, the 5 that didn't at 150 ms and 0.5% loss (C-55).
  - **Every profile's figures** are in the report's section 2.3, at 14 (`cap14.json`), with the same at 42 in `results.json`: each body's p50, p95 and max for the steady, placed and repair's corrections, with their depths, late inputs, lateAbsent, resyncs, steps and traffic. At the loss-free profiles of the full mesh the steady p95 ball correction was 0.057–0.104 m at 30 ms, 0.110–0.206 m at 80 ms and 0.234–0.369 m at 150 ms, its maximum at most 0.224, 0.542 and 1.05 m, and the depth's p95 1–2, 4–5 and 8–10 ticks. The placed corrections, kickoff snaps, moved remote terriers by p95s of 9.2–23.5 m at those profiles and up to 32.1 m at a lossy one, and the ball only at two lossy 150 ms profiles: 1 of `pack2-150ms-d2-loss0.5`'s 15, by 0.016 m, and 11 of `pack4-150ms-d3-loss0.1`'s 41, by up to 0.073 m; at the cap of 42 none moved it. No input came late at a loss-free profile, nor at a 30 ms one with loss, but one forwarded input a tick late in the partial mesh at 80 ms with two pairs blocked.
  - **By its rules,** d stays 2, `smoothingMs` is 200 ms and `ownSmoothingMs` 100 ms, w = 12 is confirmed, and the spread's cap is 14 (D-11, D-16). Rules 1 to 3 read the same at 42 and at 14. The lossy profiles past the loss reach are C-55's.
  - **The load run** (M3's design §8.5): 12 Chromium pages through `#test=net`, 8 that play at 4 a side by the brain and 4 that watch, against `vite preview` and the local relay, after `npm run build`, measured for `LOAD_SECONDS` of play, 90 by default, on a quiet machine. It checks that every page is connected to the other 11 at the start and the end, that the 8 players are in every roster, and that all 12 hold one hash at their common final tick and one phase. Since M3's phase 6a it watches the backlog (`dev/load/backlog.ts`): every 2 s of the play it polls each page's report through the hook, with the machine's load, and reads each receiver's backlog, the TICKs its senders sent it less those it took since the first poll, summed over its senders, so that one link alone behind shows at its share, in seconds of their output by their own ticks, over the intervals with the mesh whole. The results file holds the series; the log gives each page's largest backlog, and the run's largest, its first poll past d + w and its first that showed a late input. A failing check's message starts with the verdict: when a receiver's backlog passed d + w no later than the first late input, the rig's message path fell behind, the machine's capacity rather than the protocol's; when inputs came late before that, how many and from when, and that the watch can't tell which failed first, since the protocol, a cold start's transient or a receiver's clock running ahead of its senders' can make inputs late first, and a lateness already in the first interval may have begun before the play measured, which the polls don't see. In the gate, `dev/load/backlog.test.ts` checks the watch on synthetic rooms: a growing lag, one that rises and falls, a step in the machine's clock, a constant skew between the pages' reports, spectators that send nothing, one link behind alone, a peer count that changes, with and without a growing lag, and the verdict, each failing with its rule planted out (research/corrections/REPORT.md section 2.7).
    - **Passed** at M3's final tree, b43b154 with the backlog watch as first built, so at the spread cap of 14, on 2026-11-20 on the development machine (WSL2, 12 threads), alone on it, each run started once the 1-minute load had fallen under 1 and 8 more minutes had passed. Over 90.1 s of play from tick 2723, every page kept its 11 peers, the 8 players were in every roster, all 12 held one hash at their common final tick, 7879, in one phase, and no page had a late input, disagreement, resync or clock jump. The largest backlog was 0.018 s, page 2's at 18 s, against d + w's 0.233 s: "The rig's message path kept up". A timer run that moved the clock took 0.57–0.68 ms at a player at the mean and 1.0–1.2 ms at the p95, and 0.20–0.31 and 0.4–0.6 ms at a spectator; one step a tick, and at most 13–16 in a timer run (C-2). A player sent 633 messages and 19.7–21.3 kB a second (D-20). The run took the 1-minute load from 0.26 to 9.37, and a 20 s warm-up before it passed too, its largest backlog 0.066 s. `research/load/results.json` holds the 90 s run, with its series. Its figures a second are per second of the machine's clock, which stepped 1.2–1.4 s ahead of the pages' own three times in the 90 s, so they read about 4% low: the pages' 57.4 ticks a second is 60 by their own clocks. The watch the run used took its senders' rates by that clock too, so after each step its backlogs read high, by up to 10% at a poll. The watch as committed, revised by M3 phase 6a's review, takes each sender's rate by its own ticks instead, and reads the run's polls at 0.017 s at most and the warm-up's at 0.060 s, with the same verdicts.
    - **In the measurement,** on 2026-11-19 at 71bd4a7, before the measured values reached `src/config.ts`, so at the spread cap of 42, it **failed its checks** in both 90 s runs, each started on a quiet machine, the 1-minute load under 1. In the second, 93.5 s of play from about tick 2723, every page kept its 11 peers, but at their common final tick, 6897, the 12 pages held 12 hashes, and at the end they showed three different phases and three different scores. Every page's clock ran at 44.8–45.3 ticks a second, reading its peers 34–47 ticks behind at the median, and jumped back 41–49 times. 25.8–30.5% of a player's remote inputs came late, and 26.1–27.6% of a spectator's, 7,355–9,013 a page, 66–75% of them 16 ticks late or more; and 7,355–9,212 a page were for ticks already finalised absent here (lateAbsent, which also counts those a later TICK's history brought). A page had 100–337 disagreements, and completed 4–19 resyncs and failed 58–73. Steps a tick averaged 2.0–2.6, and reached 42–87 in one timer run; a timer run that moved the clock took 1.77–1.97 ms at a player at the mean, 6.6–7.8 ms at the p95 and 93–153 ms at most (C-2); and the run took the 1-minute load from 0.91 to 15–16, each page's renderer at 50–90% of a thread. Its file was `research/load/results.json` until the passing run's replaced it. The first run started clean and broke down during play, while another process, the M0 spike's server, started too: its pages ended with 0 to 11 peers, 10 of the 12 no longer holding their common final tick, 5800, its clocks at 32.5–38.2 ticks a second and the load at 20.2. A 20 s diagnostic outside the method failed as the second did, with 12 hashes at tick 3587. Phase 5's 20 s smoke run at 4da2086 had passed, at 0.72–0.80 ms a timer run at a player.
    - **The diagnosis,** from those runs' files, in Node and in a model, found the rig's message path behind them, not the code. The 12 pages in one Chromium took 3,839 and 3,337 TICKs a second, in the second run and the diagnostic, of 3,919 and 3,641 sent, where phase 5's passing smoke took 5,111, so every receiver's backlog grew by 380–683 TICKs over the play, 1.15–2.34 s of its senders' output by the machine's clock, or 0.80–1.62 s by their own ticks, as the watch reads it, past d + w either way. Remote inputs then came late, from one onset tick room-wide, each page finalising them absent its own way; round trips over `stallMs` stopped counting; every page read its peers behind; and the room's clocks slowed to what the path delivered: 3,839 TICKs a second over 88 sending links is 43.6 ticks a second, against the 44.8–45.3 measured. The pages' own work wasn't the queue: their timers ran on time, their main threads about 90% idle, and in Node 71bd4a7 costs 1.002 times 4da2086's a timer run and 0.92 times a TICK. Nothing between 4da2086 and 71bd4a7 changes what a page sends or how it handles a message, and a model of the room in virtual time, its messages through one shared delivery server, gives the same figures at both: clean with the server 5% faster than the room's message rate, about 5,580 a second, and the whole failure with it 10% slower, 12 hashes and 95% of the inputs late. It also found a milder residual in phase 5a's round-trip rules (D-15, C-12).
    - **The A/B,** on 2026-11-20 from 06:51 to 08:43 UTC, alone on the machine (`research/load/ab/`): builds of 4da2086, 71bd4a7 and b43b154, each run started once the 1-minute load had fallen under 1 and 8 more minutes had passed. At 90 s, 4da2086 and 71bd4a7 twice each, alternated, and b43b154 once; at 20 s, 4da2086 and 71bd4a7; then those two at 20 s straight after 10 minutes of 10 busy cores, at a load of 10.5. Its rule, set before it ran: the code is cleared if the commits agree run for run, implicated if 4da2086 passes at 90 s twice where 71bd4a7 fails twice, and the rig's limit if both fail cool with the backlog grown. All nine passed, every page with its 11 peers and one hash at the common final tick, and no receiver's backlog grew, −7 to +4 TICKs over the play. The first, 4da2086's, had 4.4–6.9% of each page's inputs late, 19–130 disagreements, 0–6 resyncs and 5–7 clock jumps a page, and passed with its backlog flat; in 71bd4a7's second 90 s run one spectator had one late input, one disagreement and one resync; the other seven had none.
    - **So the code is cleared:** the measurement's failures were the machine's state then, after about an hour of CPU-bound groups at loads of 6–8. What in that state slowed the path, whether the heat, the Windows side or where the pages ran on its cores, wasn't recorded, and the heat soak didn't bring it back, so beyond that the failures are unexplained. M4 takes the lessons (§17).
  - **Smoke runs decide nothing:** a profile at one seed, the cap check at 1 to 4 runs and a 20 s load run, on 4da2086, a87b4c0 and 600f2f0, whose runs were phase 5a's but for their wall times, showed only that each runs; the harness refuses to decide a rule below the method's seeds or 20 cap runs (harness-F5). The method lists the runs whose figures were known when it was written, phase 5a's at every seed among them, and what they already fix (D-16, C-2).

---

## 17. Milestones

- **Order:** each milestone retires the riskiest remaining unknown. No calendar estimates; they would be guesses.
- **Gate:** from M1, every milestone ends with `npm run check` green, and its wall time logged in `docs/acceptance.md`.
- **External actions** wait for your go-ahead: pushing terriest; any further push to hermet, such as its docs at M1; any change to roslambo or amorfus (Q-14, Q-20); each deploy; and the relay check. hermet's licence fix is already pushed, at your request (Q-3).
- **Attended steps** (M0's desktop frame verdict, M2's tuning, M3's desktop connection, and at M4 your desktop checks, the cameras' tuning, the bots' level and the look pick) don't hold up the next milestone.
  - If one hasn't happened when a milestone's other exits are met, Claude settles it provisionally: the frame verdict and the desktop checks in the headless engines on C-6's GPU path, with M3's and M4's connections through `npm run dev:local`; the tuning by measurement, as roslambo's Q-12 was; the bots' level as their marks set it; and the look as Claude's pick from the look book. It's logged as owner-pending (in `docs/acceptance.md` from M1), and the work goes on.
  - Each must land before M5's deploy. M5's device runs, which come after the deploy, follow Q-13.
  - A late answer costs re-emitted goldens, re-run Q-9 marks and a re-counted budget.

**M0 — Physics and rendering spike (throwaway)**
- *Prerequisites:* none beyond this machine. Node 22 and Playwright's three browsers are installed.
- *Build,* in `research/spike/` (D-36):
  - the exact numerics: roslambo's angles, plus `datan2`;
  - D-4 to D-6's bodies, pitch and solver: floor support, Gauss–Seidel impulses over mirror pairs, restitution threshold, the slip-out candidates, the goal test;
  - a three.js page: the pitch, the ball and 8 code-built terriers moved by the spike's simulation from scripted inputs, plus the stand-in skinned model and GLTFLoader, with `@types/three` for 0.187, or else three pinned to the newest revision that has one (D-34);
  - a production build of that page, then hermet's licence writer and dist audit, with no exceptions and three as the only expected package;
  - an ESLint config of the spike's own, since hermet's base ignores `research/`, which applies hermet's exact-ops rule to the spike's simulation before run 1;
  - hermet's tools from its checkout on this machine at 11283ca (D-37), so M0 needs no submodule and no network beyond installing packages.
- *Runs:*
  1. **Engine goldens:** Node, Chromium, Firefox and WebKit run the same scripted contact-heavy runs and compare hashes. These are kickoffs at every pack size, resting and rolling balls, pushes by one to four terriers, squeezes and pinches, a 4-a-side scrum at the ball against a wall, pounces, goals, and long runs.
  2. **Contact behaviour:** a resting ball stays bit-still; bounces keep their fractions; one to four terriers hitting the ball at once gain no energy; push times for one pusher, two and four side by side in both frames, and four in a train; the slip-out rules compared on §16's cases, mirrored pinches at each pack size included; mirrored kickoffs are exactly mirrored, compared by value (P8).
  3. **Cost:** tick cost with a 13-step replay every tick, timed on run 1's most contact-heavy script (4 a side scrumming at the ball against a wall), with contacts per substep reported beside each cost. Then the worst single ticks on the same script, each against L286's 50 ms maximum frame: a resync (about 30 steps), a joiner's catch-up (about 42) and a late-vote repair (up to about 270) (C-2; research/audit/REPORT.md §9). Both on the desktop and in Chromium at the Pixel 8a's size, at 1× and 4× CPU throttle.
  4. **The page in all three headless engines at once,** served with D-35's `_headers` applied: frame-rate independence; draw counts and download sizes for both drawers; and the stand-in's embedded texture loading under the content security policy.
  5. **The audit:** every finding classified (C-9).
  6. **By hand:** you open the page in Chrome, Edge and Firefox on Windows, and read off the frame verdict. *M0:* you reported PASS on 2026-11-16, on ANGLE's Direct3D 11 path with the Intel Iris Xe, for one load whose browser and quality the report didn't name. The other loads stay open under the rule for attended steps above, and research/spike/REPORT.md §7 says how to run them. *M1:* on 2026-11-17 Claude settled them provisionally, headless on C-6's GPU path: Chromium and Firefox passed every load, and are logged in `docs/acceptance.md` as owner-pending.
- *Questions answered,* each with a number in `research/spike/REPORT.md`:
  - determinism, pass or fail per engine;
  - whether resting contact is bit-still;
  - the push times for one pusher, two and four side by side in both frames, and four in a train;
  - which slip-out rule passes §16's cases, and how soon it brings the ball down;
  - whether a mirrored kickoff stays mirrored;
  - tick cost per step and per tick, with the contacts per substep it was timed at, and the worst single ticks against 50 ms;
  - frame time on your desktop GPU;
  - the spike's counts against the drawing budget's starting guesses, which M0 may lower but never raise (§12);
  - what three.js and GLTFLoader cost to download;
  - what the content security policy must allow for GLTFLoader, `blob:` included or not (D-35);
  - what the audit found.
- *Stop rule:*
  - if any engine mismatches in run 1, a resting ball can't be held bit-still, simultaneous hitters gain energy, a mirrored kickoff isn't exactly mirrored, or no slip-out rule passes §16's slip-out cases, stop and revisit D-1, D-2 or D-5 before M1;
  - if the p95 of a 13-step tick on run 3's script exceeds 4 ms in Chromium at 4× CPU throttle, a quarter of a 60 Hz frame, revisit D-3 and D-5 (solver iterations, position passes, the pieces' bound test) before M1. **M0, amended:** the tick is timed while the page draws, its ticks on the 60 Hz clock, as roslambo's proxy timed it, and the nothing-drawn reading is reported beside it (research/spike/REPORT.md §4);
  - a worst single tick over 50 ms there doesn't stop M0: D-11 then spreads such a tick's steps over several ticks, built and tested at M3 (C-2).
  - **M0's verdict** (research/spike/REPORT.md §4): the five correctness conditions passed. The cost clause fired narrowly: drawn, 3.49–4.60 ms, over 4 ms in 11 of 26 runs; with nothing drawn, 2.86–3.39 ms. The revisit it asks for kept D-3's and D-5's settings, on two close calls (D-3, D-5). The late-vote repair went over 50 ms, so M3 builds D-11's spread (D-11).
- *Exit:* the report is committed. D-2 to D-6, D-11's worst ticks, D-26, D-27, D-34, D-35 and the budget are confirmed or amended in this plan, each amendment citing the measurement behind it. An amendment that changes a requirement, such as restitution 0 on slip-out contacts against L311 (D-5), comes to you as a §2 row first.

**M1 — Skeleton and gate**
- *Build:*
  - Vite, TypeScript, ESLint (D-38), vitest and Playwright (three engines);
  - `vendor/hermet` at 11283ca, the commit with Q-3's fix (D-37), and its wrappers, with three alone in `scripts/expected-licenses.json` (§15);
  - `src/config.ts` with every setting and the §7.4 checks;
  - the match-ID module (Q-2);
  - the boot page and its failure messages (D-30);
  - a three.js page drawing the empty pitch;
  - `third-party.json`; `wrangler.jsonc` and its test; CI, under `xvfb-run` (§15);
  - `docs/acceptance.md`, with L286's frame-time criteria and an empty run log (§15);
  - `CLAUDE.md`; the README skeleton; no LICENSE (Q-1).
  - In hermet: the docs naming terriest, now that it mounts hermet, pushed with your go-ahead.
- *Exit:*
  - `npm install && npm run build` emits `dist/` from a clone made with `--recurse-submodules`, or after `git submodule update --init`, as the README's Run section says (§15);
  - `npm run check` is green locally, and in CI once pushed, or in `check:ci` if the first CI run shows the hosted runner can't draw or hold the matches (§15);
  - the gate's wall time is logged in `docs/acceptance.md`, and so is the first CI run once pushed.
- *M1, on 2026-11-17:* the local exits are met. A clone made with `--recurse-submodules` from the branch, with hermet fetched from GitHub, builds with `npm install && npm run build`, and `npm run check` is green in about 76 s, logged. The first CI run waits for your push. hermet's docs are on hermet's branch `name-terriest`, waiting for your go-ahead to land and push them. *Later that day:* you merged them into hermet's main and pushed it (7a0ed8d). terriest's pin stays at 11283ca, since that commit changes only wording.
- *M1, on 2026-11-18:* the first CI run passed, at a4ead1a, when you pushed M1 with M2 (§15). So M1's exits are all met.

**M2 — Simulation core, tuning and the bot brain**
- *Build:*
  - `src/core/sim` in full (§7): the state codec and hash, the goldens and the cross-engine determinism test, the canary;
  - `dev/tuning.html`: the real simulation drawn top-down and from the side, sliders for every setting, scripted terriers, and one keyboard terrier;
  - the bot brain, run against the simulation offline.
- *Exit:*
  - every simulation test and golden is green in Node and all three engines;
  - the bots reach their pass marks;
  - you've tuned M2's values on the tuning page (Q-10), and they're recorded in the Configuration table.
- *M2, on 2026-11-17:* the local exits are met, on the branch `m2-simulation-core`, in eight commits from 498735b, this amendment the last.
  - **Every simulation test and golden is green** in Node, and in Chromium, Firefox and WebKit through the production bundle's determinism page (§16).
  - **The bots reach every mark** at A.4's starting values (§16).
  - **The values:** you chose "settle" for Q-10, so Claude settled them by measurement under the rule for attended steps above, by a method committed before anything was measured (research/tuning/REPORT.md). The goal netting's bounce is 0, and the push assist is on at 9 m/s. The kickoff spots, the rolling slowdown, the terrier bounce, the re-arm gap, the slip hold-off, the tumble guard, the collider and idle friction keep their starts. They're recorded in `src/config.ts` and A.4–A.5, and logged owner-pending in `docs/acceptance.md` with C-18's marks and the bowling rate (C-5). The Configuration table takes them with your sign-off (§2).
  - **`npm run check` is green** in about 2 minutes, logged.
  - **Yours before the deploy:** confirm or change the ten values and C-18's marks, and say whether bots should bowl each other this often (C-5).
  - **M2's review,** of the whole, of the settling and of the docs, applied in one commit: `src/core/sim/index.ts`, the module M3 and M4 import the simulation from (§6); the step re-timed against the spike's (C-2); tests that the never-stuck watch can fire (§16), of D-9's animation fields, and of terriers closing at 50 m/s (D-3); a lone pusher's drive target, not its time, as the check that the assist leaves it alone (C-18); the metrics' window check with `slipout.test.ts`'s lower dribbles (C-21); A.5's rows true at any value, so Copy settings writes them right (A.5's note); L58 for your sign-off with the Ball bounce row (§2); and M2's design kept as research/m2/DESIGN.md, which the code's "design §…" cites.
  - **Files past the builders' lists:** M2's design (research/m2/DESIGN.md) gave each builder its files. Phase 4's went past theirs for two findings of M2's review, the fall-back mark's restatement (`src/core/bot/marks.ts`, `marks-fall-back.test.ts`, `brain.ts`) and the slip release (`physics.ts`, `slipout.test.ts`, `step.test.ts`, `scripts.ts`, `goldens.json`), and to keep `dev/` to `src`'s lint (`eslint.config.mjs` and its test). Settling the values went past its list in `contacts.test.ts`, `params.test.ts`, both tunnelling tests, a comment in `movement.ts`, and the model test's snippet.

**M3 — Timeline, networking, consensus and Practice**
- *Build:*
  - `src/core/timeline`, `protocol` and `session`, from roslambo (§8, §9), with packs, the widened inputs and D-21, and D-11's spread of worst ticks, which M0 calls for, with its starting cap checked (D-11);
  - `src/net`: the loopback transport, the Trystero transport, forwarding, the local transport; the Trystero packages join `scripts/expected-licenses.json` (§15);
  - bot hosting;
  - the network simulator tests;
  - the `#test=net` page, as roslambo's, for matches before the screens exist;
  - an end-to-end scripted match over the local relay, through that page;
  - the correction measurement (D-16): seeded bot-against-bot matches over the network simulator at each pack size, each pack's bots on different simulated browsers, at one-way latencies of 30, 80 and 150 ms with 20 ms jitter. An occasional extra round trip stands in for a lost packet on the reliable channel. Run at d = 2 and d = 3. At every rollback, log the change in the ball's and each terrier's position and heading at the newest predicted tick. Count the inputs that arrive after their tick is final, against w = 12 (L340).
- *Exit:*
  - P1–P5 and P7–P10 are green;
  - the end-to-end match is green;
  - Practice contacts nothing;
  - the 12-page load run is logged;
  - the correction measurement's p50, p95 and max per profile, and its count of late inputs, are in `research/corrections/REPORT.md`; d and D-16's glide are chosen from it, and w = 12 is confirmed or amended in this plan;
  - two of your desktop browsers connect through `npm run dev:local` on the `#test=net` page.
- *M3:* as M3's design (research/m3/DESIGN.md §12) built it, in six phases, each with its reviews and an integration whose gate was green before its commit: the protocol, the timeline's parts and the settings (e71ce8d, 60d3242); the timeline, the net layer and the bot host (a3bf419); the timeline tests' shared pump, then the session and the scoreboard (ccef2fe, 56ebf1f); fixes to joining, to merges and to ranking Play-again presses (2def423, 995f206), then consensus, hosting, Practice and the glue (a21351f); the page, the specs and the harness (4da2086), then the flood count, round trips and forwarding in a mesh (a87b4c0); then the count of the voters a lineage removed for silence that still reach it (600f2f0), and the measurement's method (0ab6b24), amended before anything was measured so that every run writes outside the tree (71bd4a7); the measurement and the plan's amendments from it (9236de3, b43b154); and the load run's backlog watch, with its run that passed and these records (phase 6a, after the diagnosis and the A/B).
- *M3, on 2026-11-20:* the local exits are met, on the branch `m3-timeline-networking`, the load run passing at the final tree (below).
  - **P1–P5 and P7–P10 are green,** each where §16 says (M3-Q21).
  - **The end-to-end match is green** in the gate, in three engines, with a spectator joining and a page reloading (§16).
  - **Practice contacts nothing:** its import graph, its local transport and its spec (P10, D-22).
  - **The load run passes,** at the final tree on 2026-11-20 at the spread cap of 14, logged in `docs/acceptance.md` and held in `research/load/results.json` (§16): through 90 s of play the 12 pages kept their 11 peers each and held one hash at their common final tick, 7879, with no input late and no disagreement, resync or clock jump, and the largest receiver's backlog 0.018 s against d + w's 0.233 s. In the measurement, at 71bd4a7 and so at the cap of 42, it had failed both 90 s runs and a 20 s diagnostic, each started on a quiet machine: the 12 pages' clocks fell to 33–45 ticks a second, 22–33% of the inputs came late, and their states diverged. A diagnosis traced that to the machine's message path, which took 3,300–3,800 TICKs a second of the room's 5,100, and an A/B of 4da2086, 71bd4a7 and b43b154 passed all nine of its runs, cool and hot, so the code is cleared (§16; research/corrections/REPORT.md section 2.7).
  - **The correction measurement** is in research/corrections/REPORT.md, by its method, section 1, committed before anything was measured (0ab6b24) and amended before too, with no rule changed (71bd4a7): every profile's p50, p95 and max, and its late inputs, are in the report's section 2.3. By its rules d stays 2, the glide is 200 ms and 100 ms for your own terrier, w = 12 is confirmed, and the spread's cap is 14 (D-11, D-16). The loss reach is C-55, whose options are yours.
  - **The desktop connection:** settled provisionally on 2026-11-19 in headless Chromium and Firefox through `npm run dev:local`, with `ice=none`, at 71bd4a7, the spread cap still 42: 37 checks, and one confirmed end, 3–2 at tick 6871. Run again on 2026-11-20 at the final tree, at the cap of 14, it passed the same way, in 39 checks. It's logged owner-pending (§16).
  - **`npm run check` is green** in about 9 minutes, 513.0 and 519.3 s on 2026-11-20, logged.
  - **Yours before the deploy:** C-55's choice; the desktop connection, which was settled provisionally; and C-56's, whether roslambo takes M3's fixes to its tick clock, its flood count and its round trips (D-15, §9, C-12), each a change to roslambo, which waits for your go-ahead.
  - **M3's design questions,** M3-Q1 to M3-Q28, numbered apart from this plan's, were adopted at their proposals when the design was committed (f6c78ce), and each is recorded where it applies: M3-Q1, P3's bound (§8); M3-Q2, one browser a terrier (§16); M3-Q3, the build hash's sources (D-21); M3-Q4, `dev:local`'s ICE and relay (§15); M3-Q5, the glue in `src/ui/` without screens (§6); M3-Q6, w's rule and the loss reach (C-55); M3-Q7, the page's hook on `window.terriestTest` only when a spec set it, with no global of its own (§6); M3-Q8, M3's settings (A.4, §7.4); M3-Q9, the stall rule (D-31); M3-Q10, who may speak for whom (§9); M3-Q11, conflicting payloads (§9); M3-Q12, the input mask (D-11); M3-Q13, the loss rates (§16); M3-Q14, the cap check in Node, and again in M4's bench (D-11, C-2); M3-Q15, the keeper's role byte (§8, §9); M3-Q16, the admission count (D-21); M3-Q17, the bots' Ready renewal (D-39); M3-Q18, what "heard" means for the abandoned rule (D-17); M3-Q19, where the game's code lands (§12); M3-Q20, Trystero's `beforeunload` (D-18); M3-Q21, the exit's properties (§8); M3-Q22, Practice's spec at M3 (§16); M3-Q23, C-12's silence (D-21); M3-Q24, the real networks' figures (M4, below); M3-Q25, the brain over the timeline (D-39); M3-Q26, whether a Play-again press proposes (D-12); M3-Q27, STATE's ID table (§9); M3-Q28, a player whose terrier is gone (D-17).
  - **The code's comments** cite M3's reviews' findings by their reviewers' IDs: phase 1's parts-T6 and protocol-F1; phase 3's and 4a's reviewers' H-, S- and T-numbers, such as T6, H2, H3 and H5, and SUM-1; phase 4's consensus-F3; phase 5's harness-F1 and F4 to F6, and clock-F1 and F2; phase 5a's flood-F1, F2 and F4 to F6, mesh-F1 to F4 and rtt-clock5a-F1 to F3; and phase 5b's flood-F3, the question phase 5a left, split-F1 to F4, and method-F1, F3 to F6, F8, F10 and F11. The commit that fixed each says what it changed, and these amendments record the rules they left.
  - **Interfaces past M3's design's §1,** kept as built where its text stands unamended (each phase's integration):
    - **the protocol and the parts:** `wireString(s, max?)` lives in `bytes.ts` and `messages.ts` re-exports it; `Reader.string(max?)`; `wireLimits` throws on a configuration the wire can't carry, and runs at import; `encodeTick` and `encodeState` take the decoder's `WireLimits`, and `stateRecordsMax(g, senderFinal, senderTick, L?)` bounds a STATE's records; `InputStore.receivedInput(id, t)`, and `replace` false, with nothing changed, for a tick the store refuses; `TickClock.sample` saying whether it counted, `rebalance` giving nothing while paused, `PHASE_CAP` 0.9999, and `ran`, `holding` and `stats.lastJump`; `netSettings()` refusing an input span over 2³⁰ ticks, with `sampleMaxTicks` and `floodTicksMax` (A.4); `botsMax` always `BOT_SLOTS`, 8;
    - **the timeline:** `eventsInFlight(who)`, its getters, `TimelineConfig.wire`, `forget(player)`, `start()` throwing once started, `hasGoalAt`, `heldNow`, `peersToHear`, `warming`, `lastAsked`, `connected` and `onStateReq`'s fourth argument; `VoteBook.votersAt`; wire-form payloads in `queueEvent`; a `Correction`'s states valid only in its callback; and a resync taking a STATE at its tick that hashes to the winner from any peer it asked;
    - **the session and its parts:** `SessionConfig.wire`; `DuplicateHello.verdict` the verdict returned; `BotHost.add(pack, t, again = false)`, and `canAdd` before a person's Add; `MatchNetSummary.ticks`, the reused and stepped finals, `remoteInputs` from `TimelineStats.receivedInputs`, and `repair`, a repair's count and sizes apart; `PracticeConfig.mode`, `practiceTimelineId`, `start` and `again(now, timelineId?)`, and `PracticeGame`'s `transport`, `tickCosts`, `summary()`, `onRun`, `onCorrection` and `verify`;
    - **the tools and tests:** `buildInputFiles(root)` and `scripts/build-inputs.d.mts`, with `src/build-info.d.ts` folded into `build-info.ts`; `LoopbackNet(seed, latency, {thaw})`, its pings due within half the pinger's pace; and `src/core/timeline/testing.ts`'s `spoil`, `Watch.steps`, `Watch.finals` by epoch, `twin` strict where the spreads matched, and `Inside.removed`.

**M4 — Rendering, input, screens and sound**
- *Build:*
  - the scene, the code-built drawer and the model drawer, and the animation states (§12);
  - correction smoothing, from M3's correction sizes and the bench's virtual peers (D-16);
  - the cameras;
  - keyboard, touch and gamepad input, with anchoring and hints;
  - every screen and message (§11);
  - Settings and the profile;
  - sound;
  - the frame-time bench (`#test=frames`) and the look book;
  - `docs/acceptance.md`, extended with the frame-time run (§16), the device runs and the manual checks.
  - **M3:** the match's network summary, `NetGame.summary()`, shown on Results or in Settings with a Copy button, so that M5's runs can log each peer's late inputs, rollbacks and correction sizes from a normal page (M3-Q24).
- *Exit:*
  - a full match is playable by link and by code over the local relay, through every screen;
  - the stand-in model plays the Practice match in the gate;
  - your desktop checks pass;
  - the chase-view swing is tuned with you, and the feel values confirmed in ball and chase view (Q-10);
  - you've played Practice against the bots and accepted their level, or named a change to the reaction delay or aim noise (Q-9);
  - you've picked the look (Q-11).
- *From M3:*
  - **the real controls' rebase on return,** through the real page: the reload in play presses before the reload, and checks that the first input after the return keeps the stored counters (page-F4, D-17);
  - **Watch on return:** whether a returning page that chose Watch sits its terrier out (page-F5, D-17);
  - **the snap across a phase's start:** a correction that moves a kickoff placement by a tick is drawn at once, not glided (D-16, D-27);
  - **the chunk budget** (M3-Q19): the per-chunk plugin counts the game's chunk and Trystero's (§12). At M3's exit, minified and then brotli-compressed, as §12's lines are counted: the page's own module, 556,951 and 114,959 B; the `#test=net` page's, which holds all of `third-party.json` through `room-config.ts`'s default import, 106,573 and 32,067 B; Trystero's, 77,808 and 24,638 B; the simulation the two test pages share, 60,883 and 19,321 B; and the determinism page's, 12,268 and 3,532 B (at 9236de3, brotli at quality 11 by Node's zlib, as M0 counted; another build hash, and so other chunk names, alone moves the brotli figures by up to about 50 B). They grew through M3: the `#test=net` page's was 103 kB raw at 4da2086, 105.5 kB at a87b4c0 and 106.6 kB at 9236de3;
  - **the canary,** wired to Propose and Join, with the determinism spec's check that the determinism chunk holds its hash (D-23);
  - **the timers' cadence,** measured again with real frames, WebKit's gaps near the stall among them (D-15, D-31);
  - **the forced repair** repeated in throttled Chromium by the frame bench, with its virtual peers, while the page draws (M3-Q14, C-2), timing the STATE's adoption on its own: it was the cap check's worst call in 95 of 100 runs, and the cap of 14 stood by 0.46 ms, its median worst call of 3.90 ms in Node coming to 24.54 ms times 6.3 against 25 (D-11);
  - **the leave prompt,** registered before the room, keeping `beforeunload` from Trystero while it asks (M3-Q20, D-18);
  - **the load run's lessons** (§16; research/corrections/REPORT.md section 2.7). In M3's measurement 12 pages fell behind together once the machine delivered fewer messages than the room sent, each reading the others late, though no page's own work was the queue:
    - keep the timeline and its messages a guaranteed share of the main thread, degrading drawing first;
    - measure on the slowest target for minutes, not 20 s;
    - watch the message path's backlog, not only the hashes, link by link and from before the countdown: the load run's watch reads each receiver's backlog summed over its senders, in which one link alone behind shows at a seventh or an eighth of its size, and only from the play measured on, so a lateness that began before it is outside its series;
    - measure a slow-frame page's own inputs with real frames before the drawing lands: in a model, at 10 frames a second, about 42% of a player's own ticks went unsent under `stallSendTicks` 3, though one hash held, and at 30 frames a second one hash held and every round trip was taken;
    - and, for M4's bench, a virtual-time room whose messages pass through one shared delivery server reproduces a capacity failure, which `src/net/loopback.ts`'s links, each with only a latency, a jitter and a loss, can't.

**M5 — Acceptance and release**
- *Prerequisites:* the devices of Q-4, asked for then; the relay-check go-ahead; terriest.com's current A, AAAA and CNAME records, and any Workers custom domain on it, listed before the first deploy (Q-5); your go-ahead to deploy, naming what it will replace.
- *Build:*
  - the look picked at M4, built as the code-built drawer's default, with the coat list fixed in `src/config.ts`, and the palette test and the drawing budget run on it in the gate (Q-11);
  - the README in full;
  - the relay check and any swap (Q-14).
- *Release:*
  - `npm run check`;
  - L279 checked from a fresh clone made with `--recurse-submodules` (§15);
  - deploy, with your go-ahead, once every attended step of M0–M4 has landed (above);
  - the acceptance runs on the deployed site: three devices, one of them the Pixel 8a, by link and by code, playing to the end, with each peer's late inputs, rollbacks and correction sizes logged in `docs/acceptance.md`, read from M4's network summary (M3-Q24), the runs watching too for D-13's residual (c), a warm-up partition in a partial mesh that ends in two lineages;
  - the Pixel 8a's frame-time run (§16), at 60 Hz, at the render-quality setting phones start with (D-33);
  - real touch on the phone;
  - Firefox and Edge for Android on the Pixel 8a: each plays a Practice match with real touch, and Firefox joins one networked match (L236);
  - the gamepad;
  - Safari if available (Q-12).
- *Exit:* every line of REQUIREMENTS.md, as amended (§2), passes on its named conditions, or is marked pending under Q-13.

---

## 18. Notes for the plan: where each is handled

| Note (REQUIREMENTS L334–L347) | Handled by |
|---|---|
| Reuse | §0's reuse list; Q-2 for the ID codec; D-37 and Q-3 for hermet |
| Determinism without rotations | D-1, D-2 (with `datan2`, which the note missed), D-4: spheres, capsules and planes, and no ball spin |
| Steering that can change | D-7: one input format, three frames, all in the goldens from the start |
| Simultaneous contacts | D-5: Gauss–Seidel impulses over mirror pairs, each pair settled together from the same velocities; P8 |
| Resting and rolling contact | D-5: floor as support, the restitution threshold; M0; C-3 |
| A ball on terriers | D-5's slip-out rule, chosen at M0, with M2's slip release (C-21); §16's cases |
| A shared, contested ball | D-16's smoothing; d and w from roslambo, re-measured with a contested ball over the network simulator at M3 (correction sizes, and the inputs that arrive after w), and from logged late inputs and corrections on real networks at M5. **M3:** d stays 2, the glide is 200 ms and 100 ms for your own terrier, and w = 12 is confirmed, each by its rule; past the loss reach, the residual and its options are C-55's (research/corrections/REPORT.md) |
| A giant ball forgives some latency | Kept as the reason smoothing is enough; D-16 |
| Cost on the phone | C-2; D-11's replay from the earliest change; D-10's 32-step stick; M0's measurements; the Pixel 8a at M5 |
| Mesh and networks | C-1; D-19; the relay check before the first deploy (Q-14); C-55, the reach of a lost packet and of forwarding (M3) |
| Tests through the real page | §16's end-to-end match through the screens and controls |
| Terriers that will be modeled | D-26, D-27, D-9; §12's model upgrade; the stand-in in the gate |
| The look | Q-11; the look book; the palette test |
| Trystero and the player ID | D-18, D-25 |

---

## 19. Traceability

| Requirement | Where | Verified by |
|---|---|---|
| Terriers alike but for coats; bandanas; coats by index | D-4, D-27, §12 | simulation tests; palette test; codec |
| Running, turning, zoomies, jump, pounce, tumble, bark | D-6, D-10 | movement tests |
| No passing through; pushing | D-5, D-6 | solver tests |
| Own terrier marked; names optional | §12 | end-to-end |
| The ball: mass, hits, pushes, lift, bounces, no spin, never leaves | D-4, D-5 | solver tests, with L57's hop, level hit and lift; fuzz test |
| The pitch: walls, net, cut corners, goals, colours; shape-independent | D-4, §12 | pitch tests and P8 on a second, point-symmetric shape |
| Six controls; anchored steering; scheme changeable | D-7, D-29 | steering tests in three frames; goldens |
| Keyboard, touch, gamepad; held together; menus; hints | D-29, Q-17 | end-to-end; by hand on the desktop; the phone at M5 |
| Cameras; see-through; ball arrow; spectators | D-28, C-57 | camera tests; `e2e/camera.spec.ts`; by hand |
| A game of its own: no names, terms or look from the pitch line's game | §12, Q-11 | the look-book review; the screens' wording |
| Look and sound; animations; model swap | §12, §13, D-27, D-32 | look book; stand-in model in the gate; the end-to-end match shows each countdown, goal and the end on every page (L103) |
| Scoring, credit, celebration, clock, overtime, Terriest | D-8, D-14 | rules tests; P9 |
| Kickoff spots and countdowns | D-8, A.5 | rules tests; P8 |
| Proposing, joining, packs, Ready, warm-up, bots | D-12, D-39, §8 | network tests; end-to-end; seeded pass marks (Q-9); your play test at M4 |
| End of match, Play again | D-12, D-14 | network tests; end-to-end |
| Practice | D-22, Q-15 | end-to-end with the request guard and a count of peer connections |
| Screens; phones sideways; the desktop pitch filling the window | §11, D-30 | end-to-end; by hand |
| Trystero, relays, STUN, TURN | D-18 | room-config test; dist audit |
| Match ID | §6, Q-2 | ported tests |
| Simulation and consensus; smoothing; barks | D-11 to D-16 | P1–P5, P7, P9, P11 |
| Disconnects, returns, abandoned matches | D-16, D-17, Q-16 | network tests; end-to-end reload |
| Persistence; one tab; names as plain text | §10, D-24, §12 | storage tests; end-to-end |
| Platform: static, Workers, relative paths, WebGL 2, its loss, browsers, no third party before joining | D-30, D-34, D-35, D-38 | build; subpath test; boot-failure tests; request guard; Chromium, Firefox and WebKit in the gate; your Chrome, Edge and Firefox by hand; the Pixel 8a's Chrome, Firefox and Edge at M5; Safari per Q-12 |
| 60 fps; drawing budget; 8 terriers and 4 spectators | C-2, §12, §16 | budget counts in the gate; by hand on the desktop; the Pixel 8a at M5; load run |
| Quality: README, tests, determinism, real-page tests, the stand-in model, hermet, no secrets | §15, §16, D-37, D-38 | the gate |
| Out of scope (L256–L275) | §21; nothing in this plan builds them | M5's line-by-line check (Q-13) |
| Acceptance lines | §17 M5 | `docs/acceptance.md` |
| Configuration: every setting easy to change, tuned on a tuning page; the TBD values | `src/config.ts`, §7.4, M2's `dev/tuning.html`, Q-10, A.5 | config tests (§7.4); your sign-off at M2 and M4 |

---

## 20. Third parties

**Runtime.** Contacted only after Propose or Join (counting the opening of a `#join=` link), except hosting. Practice contacts none.
- **M3:** the `#test=net` page, in a production build, takes only `third-party.json`'s relays, which M5's relay check uses, or a loopback `ws:` one, and otherwise says so and contacts nothing, so no link can send a visitor's browser to a relay this table doesn't list (M3's design §6.7; nettest-params.test.ts, nettest.spec.ts). The gate contacts none of these hosts: its specs use the local relay alone (§16).

| Party | Role | Sees |
|---|---|---|
| relay.damus.io, relay.primal.net, nos.lol, relay.snort.social, nostr-pub.wellorder.net, yabu.me/v2 | Nostr signalling | IP, Origin, User-Agent, timing, a hashed room topic, a per-load Nostr key and Trystero peer ID, encrypted session-description sizes |
| Relays added in Settings | Nostr signalling | as above |
| stun.cloudflare.com, stun.l.google.com | STUN | IP and port |
| The user's TURN server, if any | relay for blocked pairs | IP, traffic volume |
| Other peers in the match | the game | your IP address, player ID, name, coat and inputs; and, as M3 built the protocol, your build's hash in HELLO, your role and the timeline you hold, its ID, kind, tick and hash, in HELLO and PEERS, and in PEERS the player IDs of the browsers you're connected to (§9) |
| Cloudflare | hosting | HTTP requests, never the `#join=` fragment; logs off |

**Build and test:** the npm registry, Playwright's browser downloads, GitHub Actions.

**Bundled:** `@trystero-p2p/core` and `@trystero-p2p/nostr`, with `@noble/secp256k1`, and three, all MIT. Their notices ship in `dist/THIRD-PARTY-LICENSES.txt`, with their texts, from hermet's fixed writer at 11283ca (C-8, Q-3).

---

## 21. Deferred past the MVP, and non-goals

**Deferred:**
- modelled and animated terriers (§12), with hermet's `.glb` option;
- bot skill levels; remapping controls;
- signed player IDs (roslambo Q-17);
- the unordered input channel; raising the mesh cap;
- steering schemes other than anchored, offered to players;
- a shared match-ID module (Q-2).

**Non-goals,** each of which would reopen a decision above:
- any server-side code or storage;
- a TURN credential service;
- replays for players (recorded matches are a dev tool);
- an authoritative host peer.

---

## Appendix A — Formats, constants, versions

### A.1 Canonical state (the hash input and the STATE payload)

**M2, fixed** before the first goldens, as `src/core/sim/codec.ts` writes it; the draft it replaces was provisional. Little-endian, in this order. "Written" gives the step of §7.2 that changes each field: 1 events, 2 presence, 3 phase changes, 4 inputs, 5 physics, 6 the clock, 7 animation. "Place" is a kickoff placement and "arrive" a warm-up arrival (D-8); "gen" is genesis.

| Bytes | Field | Written |
|---|---|---|
| u16 | codec version = 1 | constant |
| u8 | phase: 0 warm-up, 1 start countdown, 2 kickoff countdown, 3 in play, 4 celebration, 5 ended | 3; 5 (a goal starts a celebration); 6 (the end, or the overtime kickoff) |
| u32 | phase start tick | with the phase |
| u8 | overtime, 0 or 1 | 3 (a celebration ends level at 0:00), 6 |
| u32 | tick | the tick's end |
| u8 | pack size, 1–4 | gen |
| u32 | match length, ticks | gen: minutes × ticks a minute |
| u32 | clock: ticks left; in overtime, ticks since it began | gen (the length); 6 |
| u8, u8 | score A, score B, saturating at 255 | 5 |
| u32, u8, u8 | last goal tick (NEVER: none), its pack, own goal | 5; kept until the next goal |
| u8 | scorers: bit k for the k-th terrier in the list; 0 for an own goal | 5; cleared at each placement |
| 6 × f64 | ball x, y, z, vx, vy, vz | 5; place |
| u8 | ball on the floor | 5 (support); place |
| u32, f64 | ball's last hit tick, its strength (the closing speed) | 5, before the solve |
| 3 × f64 | ball's last hit's velocity change, x, y, z | 5, after the solve, in the substep that sets the hit |
| u32 | ball's last contact tick | 5, after the solve |
| u8 | n, at most 2 × pack size | 1, 2 |
| *n terriers, in (spot, pack) order:* | | |
| 16 × u8 | player ID (a bot's derived from its host's) | 1 (JOIN) |
| u8 + bytes | display name: its length, then UTF-8, at most 32 bytes | 1 (JOIN, cleaned) |
| u8, u8, u8 | pack, spot, coat | 1 (JOIN, SWITCH, arrive); the spot also at a placement, by ID rank |
| u32, u32, u32 | join tick; ready until (0: not ready); last tick with an input | 1; 1 and 3 (expiry); 1 and 2 |
| u16 | previous present final input, bits 0–12 (the bark bits cleared) | 4 |
| u32 | heading (binary angle) | 1 (arrive), 3 and 6 (place), 4 (turns) |
| u32 | overhead reference (binary angle): the heading when the ball-overhead flag set | 4, when the flag sets; place and arrive (the heading) |
| 6 × f64 | x, y, z, vx, vy, vz | 1 (arrive), 3 and 6 (place), 4 (jump, pounce), 5 |
| u8 | flags: bit 0 on the floor, 1 sitting, 2 zoomies locked out, 3 ball overhead, 4 slipping, 5 touching the ball; 6–7 zero | 2 (sitting), 4, 5; place |
| u8 | slipped from: 0 none, else 1 + a body slot | 5; place; cleared when that slot is vacated (1, 2) |
| u16 | zoomies meter, half-ticks: full 360, drains 2 a tick, refills 1 | 4; place and arrive (full) |
| 4 × u16 | pounce wait, lunge, tumble, guard (ticks) | 4 (pounce), 5 (a lunge's end, a tumble), 7; place and arrive (0) |
| u16, u8 | touches (saturating at 65,535), goals (at 255) | 5 |
| u8, u32 | animation phase, its start tick | 7; place and arrive |
| u32 | gait (binary angle) | 7 |
| u32, u32 | take-off tick, landing tick | 4 (jump), 5 (each substep) |
| u32, u32 | last ball contact tick, last terrier contact tick | 5 |
| u32, u32 | last push received: direction (binary angle), tick | 5 |
| i32 | heading change this tick | 4; place (0) |

**M2: what the draft left open, fixed:**
- **The flags:** the draft's lunging flag went, since the lunge timer says it. Touching the ball, a byte of its own in the draft, is bit 5, and bits 6–7 are zero.
- **No intents:** whether a terrier's drive is on, its target and whether it zooms aren't state, though M0's spike encoded them. Step 4 writes them before anything reads them.
- **Slots:** a terrier's body slot is 2 × spot + pack, and the ball's is 2 × pack size. Slipped from names a slot, since list indices stop matching the solver's mirror slots (D-5) when a warm-up pack isn't full. Slipping is set exactly when it names one, never the terrier's own, and a LEAVE, a removal or a SWITCH that frees a slot clears every slipped-from that names it.
- **NEVER,** 0xFFFFFFFF, is a tick that never happened: take-off, landing, both contact ticks, the last push, the ball's last hit and last contact, the last goal. The push direction is 0 while its tick is NEVER.
- **Counters saturate:** touches at 65,535, goals and scores at 255, the overtime clock at 2³² − 1, so no field leaves its type.
- **Holes:** in warm-up a pack may have fewer terriers than the pack size, and gaps in its spots after a LEAVE; the list stays in (spot, pack) order with unique slots. From the start countdown on, both packs are full, so list index k is slot k.
- **The ball's hit change** (D-9, L101): the ball's velocity change in the substep that set its last hit, from after the forces to after the impulses, so the impulses and the floor's bounce without gravity. It's the squash's axis, which the velocity after a glancing hit would get wrong. A mirrored state's horizontal parts are ±0, so P8 holds, and the fixed warm-up ball's change is 0, which draws no axis.
- **Encoding and decoding:** encoding refuses a float that isn't finite (D-1) and a field outside its type, and checks nothing else, so a test-only state, such as a short pack in play, still encodes and hashes. Decoding never throws: malformed, inconsistent or trailing bytes give nothing, and so does a state that `src/core/sim/valid.ts`'s checks refuse. So every state those checks pass round-trips byte for byte, and one they refuse never comes from a peer.
- **Names:** a hand-written UTF-8 loop writes them, so hashing allocates nothing. A property test shows its bytes equal `TextEncoder`'s for every well-formed string, and a name with a lone surrogate never joins (C-17, D-12). The decoder keeps a leading U+FEFF, so a name that starts with one round-trips.
- **What `valid.ts` checks,** beyond each field's type: the roster in (spot, pack) order with unique slots and IDs, at most a pack size in each pack; names that pass C-17's rule unchanged; coats in the list; every float finite; a body slipped from that's the ball or another terrier present; the meter and timers within their maxima; and scorers that name terriers in the list. Then the rules': the tick under 2³¹; a phase begun at a tick that has passed; scorers only in a celebration or at the end, so a removal, which comes only in warm-up, never shifts a scorer's bit; overtime only from a kickoff countdown on; outside overtime, a clock within the match's length; both packs full from the start countdown on; a Ready no longer than its expiry; and join and input ticks that have passed.

**Size:** 30 bytes of header, 89 for the ball and 1 for n, then 142 bytes a terrier plus its name: 1,512 bytes at 8 terriers with 32-byte names. The hash is roslambo's: MurmurHash3 x86-32 with seeds 0 and 0x9747B28C, 8 bytes, compared as an unsigned big-endian number.

### A.2 Input (u16)

| Bits | Field |
|---|---|
| 0–4 | direction step, 0–31, counter-clockwise from the frame's forward |
| 5 | a direction is held |
| 6–7 | frame: 0 pitch, 1 ball line, 2 nose; 3 reads as no direction held |
| 8 | zoomies held |
| 9–10 | jump press counter |
| 11–12 | pounce press counter |
| 13–14 | bark press counter (not read by the simulation) |
| 15 | 0 when sent; ignored when read |

So every u16 is a valid input, which a fuzz test checks (§16).

### A.3 Storage (localStorage)

| Key | Value (JSON) |
|---|---|
| `terriest.v1.profile` | `{ v: 1, playerId, name, coat, hints: { keyboard, touch, gamepad } }` |
| `terriest.v1.profile.backup` | the last unreadable profile, verbatim |
| `terriest.v1.settings` | `{ v: 1, relays: [url], turn: [{ urls, username, credential }], names, ballView, calmCamera, mirrorTouch, sound, quality }` |

`calmCamera` and `quality` are `null` until the player chooses. While null, they follow the default rule: `prefers-reduced-motion` for `calmCamera`, the device's default for `quality` (§11). So a later change to the system's preference still applies, though every change to a setting writes the whole object.

### A.4 Implementation constants (*provisional*, but for the rows M0 kept or chose)

| Constant | Value |
|---|---|
| Tick rate, substeps | 60 a second, 4 a tick (M0 kept 4, D-3) |
| Input delay d, late window w, vote window v | 2, 12, 12 ticks (roslambo); d kept and w confirmed by the correction measurement (M3, by measurement: research/corrections/REPORT.md, D-16) |
| State history, input history per TICK | 256 ticks, 16 ticks (roslambo's code) |
| Worst-tick spread | at most 14 steps a timer run for each tick its clock moved, and 14 when it moved none or adopts a STATE, so a 270-step repair takes about 20 runs (M3, by measurement: the cap check, research/corrections/REPORT.md, D-11) |
| Join warm-up and the tick clock | a joiner holds finalisation until every sender active in its STATE, and every peer it met, connected or still handshaking, has been heard from since, each at most until 0.5 s after the later of the adoption and its meeting; a peer's clock offset, from its direct TICKs only, counts once heard for 2 s, smoothed by 0.1 of each new sample, and a TICK held through a freeze is no sample; the clock runs fast or slow by 0.5% for each tick of the median offset, at most 2%, with a 1-tick deadband, and checks the median every 1 s, jumping once it's past the middle of the late window, by the whole median, or to the clocks' midpoint with a single peer counted (roslambo D-11, M0, M3) |
| Resync and joining | a peer that lost a vote asks the next voter for the winning state after 0.5 s; a joiner asks the next peer that holds the match after 1 s; JOIN, SWITCH, READY and UNREADY go again once 30 ticks pass after their tick is final without the state showing them (roslambo §8.3, M3) |
| Solver iterations (forward and back sweeps over mirror pairs), position passes (also in mirror pairs) | 8, 2, with the floor's contacts in both (M0 kept them, D-5) |
| Restitution threshold | 0.3 m/s |
| Slip-out | 42° from vertical, 2 m/s sideways, with the slipping flag (M0 chose it, D-5); the flag holds the drive off toward the body slipped from only within 0.6 m of it, surface to surface in plan view (M2, provisional by measurement) |
| Ball overhead | enter under 0.3 m, leave above 0.4 m (horizontal centre distance) |
| Gait and running | the gait turns a cycle per 0.6 m run on the floor; a terrier draws as running above 0.2 m/s, or while its drive is on (M2, from M0, D-9) |
| Pushing pose | the code-built terrier draws its pushing pose for 8 ticks after a contact with the ball or a terrier, so its head stays out of the ball (M0's, D-27; M4) |
| Animation blends | an animation fades into the next over 150 ms, and so does an animation a correction moves, adds or takes back; an overlay fades in and out alike (D-27, L208; M4) |
| Stick | 32 steps, half-step hysteresis, 0.2 dead zone; chase view re-reads at 45° |
| Gamepad | read at each sampled tick, and on a 60 Hz timer of its own while none is sampled; the right trigger counts as held past half its travel (D-29; M4) |
| Smoothing | 200 ms; 100 ms for your own terrier; bodies in contact share one decay (M3, by measurement: research/corrections/REPORT.md, D-16) |
| A held head | while a spread holds the drawn head, its bodies are drawn carried on by their velocities for up to 6 ticks, then glided (D-16; M4) |
| Removal before the start countdown | 180 silent ticks (roslambo Q-15) |
| Sitting, from the start countdown | 120 silent ticks |
| Warm-up arrivals | the pack's next free spot if it's clear, else the first clear point in 1 m steps from it toward the pack's own goal line, else the spot itself (M2, D-8) |
| Abandoned match | from the start countdown, 30 s with no browser that controls a terrier (Q-16) |
| A duplicate ID replaces a connection | silent for 2 s: no message, and no answer to a ping (C-12, M3) |
| Gossip | PEERS on each change and every 5 s, and a ping to each peer every 1 s (roslambo D-14, C-12, M3) |
| Handshake timeout, connection-failure message | 10 s, 20 s |
| Leaving | a page that leaves, or presses Play again, keeps its room for 0.4 s, so its LEAVE or its AGAIN goes out (roslambo, M3) |
| Largest message, `maxReceiveBytes` | 16,000 bytes, 1 MiB |
| Misbehaving peers | more than 3 TICKs a tick of the sender's possible clock, counted by the ticks they carry and not as they arrive, from a sender, or from a forwarder for each origin apart, over 2 s of those ticks from a connection open that long, a silence adding to the allowance, or 20 invalid messages from a peer, close its connection (roslambo §9.3, §9.4, M3) |
| Mesh cap | 8 browsers that play, 4 spectators |
| Display name | 20 characters, 32 bytes |
| Timeline timer | every 4 ms, never on animation frames (D-31, M3) |
| Timer stall | a gap over 2 s between timer runs: a networked page rejoins from a peer whose clock ran on, or goes on from its own tick if none did, and Practice opens its menu and pauses (D-22, D-31); after a shorter gap, a networked page sends only its newest 3 ticks' inputs (M3) |
| Phone | a coarse pointer and a shorter side under 600 CSS px (D-30) |
| Touch controls' edge margin | 32 CSS px from the side edges, inside the safe-area insets (D-29) |
| Results' press guard | only a press that begins 0.5 s or more after Results appears (Q-17) |
| Lost graphics | the plain message after 5 s, counted only while the page is visible (D-30) |
| Render quality | high: pixel ratio capped at 2, with MSAA; low: capped at 1, no MSAA, simpler effects (D-33) |
| Drawing gives way | drawing gives way when, over a second, more than 10% of the ticks this page sends for were skipped, or more than 10% of the second passed in timer gaps longer than 50 ms: the pixel ratio falls by 0.25 of its cap, to 0.5 at least, and then every other frame is skipped; it steps back after 3 s with neither (M4's design §8.2; M4) |
| Drawing budget | a code-built terrier at most 2,000 triangles; a model at most 8,000 triangles, 32 bones and a 512 × 512 texture; at most 40 draw calls for eight terriers; each way of drawing them at most 200 kB brotli, three not included (§12's starting guesses, a ceiling until the phone has run, C-2; M4) |
| Terrier model | none: terriers are built in code; a model named here would load through the model drawer, as the tests' stand-in does (L97, D-27; M4) |
| Sound under rollback | an event that a re-simulation moves by up to 3 ticks plays once (§13) |
| Bot brain | reacts after 0.25 s, with aim noise up to 10° either way, seeded per bot; zooms toward a target over 5 m away; pounces when the ball's surface is within 2 m and the shot is lined up within 20°; supports 5 m behind the ball; defends 6 m out from its goal line; barks about every 5 s; turns away after 2 s held within 0.5 m (M2, Q-9, D-39) |
| Bot hosting | a host sends a bot's READY again once the bot's Ready has 10 s left, so a bot is always ready (C-41, M3) |

**M3:** the rows marked M3 hold M3's settings (M3's design §10, M3-Q8), read through `netSettings()` (`src/core/session/settings.ts`) in their units, each in `dev/tuning/model.ts`'s `NOT_TUNED`, since neither the simulation nor the brain reads them. As built:
- **Derived from them, with no setting of their own:** the stores' span, 1,024 ticks, the smallest power of two at least twice 256 + 2w + d; a clock sample further off than 742 ticks, the span less 256 + 2w + d, is none; `floodTicksMax`, 360, three TICKs for each tick of the flood window; a freeze, a gap between timer runs over d + w ticks, 233⅓ ms (D-15); the timelines' tie, half the stall, 60 ticks (D-12); and a forwarder's half of the flood limit (D-19).
- **Two rows reworded** at M3's settle to say what was built, their numbers unchanged (M3 phase 5b's answers): the join warm-up and the tick clock, the warm-up ending within twice its 0.5 s after the adoption whatever handshakes do, since a peer met 0.5 s or more after it isn't waited for (D-11, D-15); and the misbehaving peers' flood count, whose 3 TICKs a tick of the sender's possible clock are about 3.1 a tick of this page's (§9).
- **The spread's cap** is per timer run: 14 steps for each tick the run moves the clock, and 14 for a run that moves none or adopts a STATE (D-11).
- **Measured at M3's exit** (research/corrections/REPORT.md section 2.1): d stays 2 by rule 1, `smoothingMs` is 200 ms and `ownSmoothingMs` 100 ms by rule 2, and the spread's cap is 14, from 42, by the cap check's rule; rule 3 confirms w = 12. The rows for d, w and v, the spread and the smoothing are marked "M3, by measurement", the spread's reworded to say it's per timer run, as built (D-11, D-16).

### A.5 Gameplay values (the Configuration table; *starting values* for the TBDs and new settings, chosen at M2, and the cameras' at M4)

| Setting | Value |
|---|---|
| Pitch, goal mouth, ball, run, acceleration, turn rate, zoomies, meter, jump, gravity, pounce, bowling speed, tumble, bark, countdowns, celebration, ready expiry | as REQUIREMENTS' Configuration table (celebration: 3 s seen, Q-7) |
| Kickoff spots, pack A (pack B is the point mirror) | 1 a side: (−10, 0). 2: (−9, ±4). 3: (−9, ±5), (−15, 0). 4: (−8, ±6), (−14, ±3). Everyone faces the ball (M2, provisional by measurement) |
| Ball rolling slowdown | 0.5 m/s² on the floor, to exactly 0; no air drag. A 3 m/s ball rolls 9 m (M2, provisional by measurement) |
| Terrier bounce | 0.3 off terriers and walls (M2, provisional by measurement) |
| Terrier against the floor | 0: a landing terrier doesn't bounce (L312) |
| Goal netting bounce | 0 (M2, provisional by measurement, C-48); walls, overhead net and goal frame 0.7 |
| Re-arm gap | 0.6 m surface to surface (M2, provisional by measurement) |
| Chase view swing | 0.3 s time constant, at most 1 turn/s; calmer camera 0.6 s and 0.5 turn/s (tuned at M4 with the cameras, Q-10) |
| Ball view swing | at most 1 turn/s, calmer camera 0.5 turn/s, with no lag below the cap; toward the overhead reference while the ball is overhead (D-28; tuned at M4) |
| Players' cameras | 4.2 m behind the terrier and 2.1 m above its floor point wherever that falls, outside the walls and in or behind a goal too, with a 55° vertical field of view, kept at least 0.4 m above the ground and under the net; chase view looks 2 m ahead of it (D-28, C-57; tuned at M4 with the swing, Q-10) |
| Spectators' camera | high above the near side, framing 24 m of the pitch's length round the ball or the terrier followed, easing after it with a 0.5 s time constant (D-28, L91; tuned at M4) |
| Tumble guard | 1.5 s (M2, provisional by measurement) |
| Terrier collider | sphere, radius 0.25 m (M2, provisional by measurement), mass 1 (ball 2) |
| Idle friction | 8 m/s² (M2, provisional by measurement) |
| Get-up | the last 0.5 s of the 1.5 s tumble |
| Nose turn rate (vehicle-style) | 1 turn/s; reverse at up to 3 m/s |
| Posts and crossbar | capsules, radius 0.1 m |
| Ball-frame push assist (C-18) | a speed cap of 9 m/s (M2, provisional by measurement); a cap of 0 turns it off, and a cap that's on is at least the zoomies speed |

**M2:** a row marked *provisional by measurement* here or in A.4 holds the value M2 settled by the method of `research/tuning/REPORT.md`, as the owner chose for Q-10 on 2026-11-17. Each is owner-pending: the owner confirms or changes it before M5's deploy (§17), and REQUIREMENTS' TBDs stay until the owner signs the values off. A value the owner sets on the tuning page is theirs, so Copy settings writes its row without the mark. What M2 measured at its values is in C-48 and C-18: at the netting's 0, every shot into the goal with nobody near stays wholly behind the line through its celebration, though pushers that follow the ball in can bring it back out over the line; at the assist's 9 m/s, two and four side by side in ball view beat a lone pusher.

### A.6 Toolchain pins

roslambo's (its PLAN A.6, checked 2026-10-24), re-checked at M1: Node ≥ 22.12 (`.nvmrc` 22), vite ^8.3, typescript ~6.0, eslint ^10 with typescript-eslint ^8.72, vitest ^4.1, fast-check ^4.10, `@playwright/test` 1.64.1 exact, wrangler ^4.152, `@trystero-p2p/nostr` 0.26.0 exact, ws ^8 (dev). Plus three 0.187.0 exact (checked on npm 2026-11-14); `@types/three` 0.187.0 exact (dev), since three ships no types of its own, which M0 found exists (D-34); and `@axe-core/playwright` ^4.10 (dev), as amorfus pins it. These are re-checked at M1 with the rest.

**M1, re-checked on 2026-11-16:**
- **The lockfile holds** vite 8.3.6, typescript 6.0.3, eslint 10.14.0, `@eslint/js` 10.0.1, typescript-eslint 8.72.1, vitest 4.1.12, fast-check 4.10.2, `@playwright/test` 1.64.1, wrangler 4.158.0, ws 8.22.2, `@types/node` 22.20.5, three 0.187.0, `@types/three` 0.187.0, `@axe-core/playwright` 4.14.0 and `@trystero-p2p/nostr` 0.26.0.
- **No package in it is under a week old.** It was resolved with `npm install --before` set a week back. That held back typescript-eslint 8.73.0 and wrangler 4.163.0, both published that day; wrangler holds the deploy login. A change of dependencies resolves the same way.
- **Newer releases outside the pins:** typescript 7.0 and vitest 5.1, both new majors; `@playwright/test` 1.65.1, though the installed browsers are 1.64.1's; and `@trystero-p2p/nostr` 0.27.0, which D-18 doesn't take.

**M3:** no dependency changed. `@trystero-p2p/nostr` 0.26.0, with `@trystero-p2p/core` 0.26.0 and `@noble/secp256k1` 3.2.0, has been in the lockfile since M1, and `ws` 8.22.2 serves hermet's relay, so M3 ran no `npm install` (M3's design §11). Their notices ship from M3 (§15, §20).

### A.7 `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "terriest",
  "compatibility_date": "<the M1 date>",
  // Assets only: no "main", so no Worker script ever runs.
  "assets": { "directory": "./dist", "not_found_handling": "none" },
  // Request logs would keep visitor IP addresses.
  "observability": { "enabled": false },
  // The workers.dev address would show the account's name (C-45),
  // and so would Preview URLs, which are workers.dev addresses too.
  "workers_dev": false,
  "preview_urls": false,
  // Q-5: terriest.com, as a custom domain.
  "routes": [{ "pattern": "terriest.com", "custom_domain": true }]
}
```
