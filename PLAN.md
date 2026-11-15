# terriest: Plan

**Status:** draft for approval, 2026-11-14. Nothing here is decided until you approve it.
- *The owner, 2026-11-14:* desktop browsers are tested by hand for now.
- This plan reads that as follows. Your desktop browsers are the real-browser check from M0 on, and the headless gate still runs all three engines.
- REQUIREMENTS L342 and L345 ask for the phone to be measured early, so Q-4 asks whether the Pixel 8a can be run at M0 too. If not, its runs wait for M5, and the drawing budget stays provisional until then.

**Answers:** the "First deliverable" section of [REQUIREMENTS.md](REQUIREMENTS.md), at commit 6254a1d.

How to read this:
- **§0** summarises the plan.
- **§1** is the questions for you (Q-n). Each has a proposal; none is decided.
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
| Simulation | Pure TypeScript. 60 ticks a second, 4 physics substeps. float64 with exact operations only, enforced by hermet's lint. Headings are binary angles, with roslambo's sine and cosine and a new exact `datan2`. A sphere for each terrier and the ball, simultaneous contact impulses, the floor as support. |
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
- **From roslambo**, nearly everything but the game: the match ID (`round-id.ts`), the timeline, session, protocol and Trystero transport, bot hosting, the room config, storage and the tab lock, display names, the canary, goldens and the cross-engine determinism test, the frame-time bench, the tuning page, the look book's recording, the palette test, the relay probe, the end-to-end helpers over the local relay, `third-party.json`, `wrangler.jsonc` and the CI workflow.
- **From amorfus:** the boot page that never goes blank, with tested failure messages; tests that go through the real page and its buttons, not test modes; the request guard that checks nothing was contacted; the subpath check; the https dev server for a phone.
- **From hermet**, as a submodule: public-scan, the dist audit, the licence notices, the exact-ops rule, the ESLint and tsconfig bases, the local Nostr relay and the room-config builder.

**Approval changes these requirements** (exact wording in §2, applied in one commit after you answer):
- The example match ID, "majority", and the 32-byte name limit match what roslambo actually does.
- Goals and the end show at the vote-confirmed tick, about 0.4 s after the ball crosses, so a correction never takes one back (Q-7).
- The bowling rule exempts a lunging terrier and the last to touch the ball, and its examples are restated (Q-8).
- Chase view re-reads the screen only when a direction starts or moves 45° or more, a change to your 2026-11-14 steering wording (Q-19).
- The goal's netting is softer than the walls, so a goal bulges the net (C-48).
- Rules the text leaves open are stated: what terriers may do in each phase, the celebration and overtime order, Practice's pause, abandoned matches, a match of bots alone, late Play-again presses, and what "joins" means for contacting third parties.
- Your answers to Q-5 and Q-14 fill in the domain and any relay swap.

**Biggest risks:**
1. **Contacts.** Resting, rolling and simultaneous contacts under exact operations are new, and roslambo's integrator doesn't carry over (C-3). M0 tackles this first.
2. **The phone is unmeasured**, CPU and GPU both. Unless Q-4 finds a way to run it at M0, its first run comes at acceptance. roslambo's timeline also re-simulates its whole window every tick, which the requirements' cost note doesn't count (C-2).
3. **Without TURN**, some pairs of networks can't connect (C-1, from roslambo).
4. **The gate draws WebGL 2 in software**, at 5–26 frames a second for a busy scene. So end-to-end tests must never depend on the frame rate (C-6).
5. **hermet's licence notices ship without their texts**, in roslambo's and amorfus's live builds too, and three.js has never been through hermet's dist audit (C-8, C-9).

**What approval authorises:** the decisions in §4; M0, a throwaway spike that uses no network beyond installing packages; then M1–M5.
- It does **not** authorise pushing, deploying, the relay check that writes to public relays, or pushing hermet. Each waits for your go-ahead (Q-3, Q-5, Q-6, §17).
- REQUIREMENTS.md is yours. Approving the plan accepts it as amended by §2. The edits go in after you answer, in one commit that cites the Q- and C-numbers, with the status line updated.

**What this rests on (§5):** your requirements; roslambo's, amorfus's and hermet's plans, code and reports; and a two-round audit on 2026-11-14 that checked every claim the requirements make about them, probed WebGL 2 in the three headless engines here, and rebuilt both siblings to confirm the licence bug. Nothing in the physics or rendering has been measured yet. Every cost here is an estimate, labelled as one.

---

## 1. Questions for you

**Settled by the owner on 2026-11-14:** desktop browsers are tested by hand for now (part of Q-4).

### Group A — needs your answer

| # | Question | Proposal | Needed by |
|---|---|---|---|
| Q-1 | Licence, and whether the repo is public | As roslambo: public, no licence, all rights reserved. `package.json` says `"license": "UNLICENSED"`, the README says no licence is granted, and `public-scan` runs in the gate. Bundled packages' notices still ship (§20). | M1 |
| Q-2 | The match-ID code: a third copy, or one module shared with amorfus and roslambo? REQUIREMENTS L334 leaves this to you. | A third copy: roslambo's `round-id.ts` and its tests, renamed for matches, with its own Play-again prefix. The two existing codecs share the format, but sharing would change two finished apps and stretch hermet's charter, which is checks rather than app behaviour. A shared module can come later, as one change across all three. | M1 |
| Q-3 | hermet's licence writer ships no licence texts (C-8). May I fix it in hermet and push it, and do roslambo and amorfus take the fix? | **In hermet:** I fix it on a hermet branch at M1: read Vite 8's `identifier` and `text`, test with Vite's real output, and make the audit fail a notice with no text. I also name terriest in hermet's docs.<br>• **The push** waits for your go-ahead. Until then terriest stays on 18a37b2, and its own wrappers map Vite's fields and check every notice for text, so its gate is right from M1 (D-37).<br>• **The siblings:** roslambo and amorfus each need a pin bump and a redeploy before their live notices are right, and each redeploy is your call. amorfus also needs an `extra` notice for its vendored FastNoiseLite. | before terriest's first deploy |
| Q-4 | Devices, people and networks. You've chosen desktop browsers by hand for now. Can the Pixel 8a also be run at M0, as L342 and L345 ask? For acceptance (L280, L284, L286): what is the third device, and do you have a standard gamepad? | **Now:** your desktop browsers by hand from M0, as you asked.<br>• **The phone at M0,** if it can reach this machine. This machine runs WSL2 behind NAT, with no adb and no USB passthrough, so it needs one of these:<br>&nbsp;&nbsp;– Android wireless debugging, paired from here (adb from Google's platform-tools, no sudo needed; untried);<br>&nbsp;&nbsp;– adb or usbipd on the Windows side;<br>&nbsp;&nbsp;– a Windows port forward and firewall rule, which is an administrator step;<br>&nbsp;&nbsp;– a go-ahead to deploy the spike's bench page at M0.<br>If none suits, the phone waits for M5, and the drawing budget stays provisional until then.<br>• **Acceptance** needs three devices, one of them the Pixel 8a. You have no laptop, so a third has to be found: any phone, tablet or computer. It also needs a standard gamepad. Different networks, mobile data and strict NATs are best effort, as in roslambo. | M0 for the phone's route; M5 for the rest |
| Q-5 | Domain | Three options:<br>• the account's `workers.dev` address, free, but it shows the account's subdomain to everyone you share the link with;<br>• a gargantis.com subdomain such as terriest.gargantis.com, free: gargantis.com is already a custom domain on the account this machine deploys with;<br>• a new domain, which costs money.<br>Proposal: `workers.dev` for the first deploy, and a choice before release. The address is never written into the repo. | the first deploy |
| Q-6 | How deploys sign in | A scoped Cloudflare API token in the environment, as roslambo's README says, with `npm run deploy` refusing to run without one. wrangler's logs on this machine show the earlier deploys of roslambo, amorfus and gargantis signed in with its stored full-account login instead (C-46). Choose the domain first, because a custom domain needs zone permissions on the token. | the first deploy |

### Group B — proposal ready; confirm or override

| # | Question | Proposal |
|---|---|---|
| Q-7 | When does a goal show? (C-4) | At the vote-confirmed tick, about 0.4 s after the ball crosses, as roslambo shows its end (roslambo D-10).<br>• **At once,** from the predicted state: the net bulges.<br>• **0.4 s later:** the score, the whistle, the scorer's name, and the celebrating animation of the pack the goal counts for, which blends in part-way through.<br>• **The celebration** is held 3.4 s in the simulation, so 3 s of it is seen. The end and the results also come from confirmed ticks.<br>Alternative: show goals at the final tick, 0.2 s, and accept a rare goal undone on a peer that loses a vote. |
| Q-8 | The bowling rule (C-5) | **The rule:** a terrier is bowled over when the ball comes at it at the bowling speed or faster, measured in plan view: the ball's horizontal velocity along the horizontal line from the ball to the terrier, before the contact is settled.<br>• **Two exceptions:** a terrier in its lunge, and the terrier that touched the ball last. So a terrier is never bowled by a ball it's pushing or has just shot, even off a wall, and a pounce can meet an oncoming ball.<br>• **What remains:** a terrier chasing a ball that someone else touched last can be bowled by its rebound. A ball dribbled at a run, about 6 m/s, bowls the rivals in its way, so only a lunging terrier can meet a fast ball safely.<br>The bowling speed is tuned with you (Q-10). |
| Q-9 | How bots are accepted, "about a new player's level" (L142) | Roles by distance rank: the nearest chases, the next supports behind the ball, the rest defend between the ball and their goal. Bots react after about 0.25 s, with aim noise seeded per bot, so mirrored bots diverge. Pass marks, in the gate: a bot scores into an empty goal within 20 s in at least 95% of seeded runs; a 2-a-side bot match has a goal in regulation in at least 90% of seeds; no bot is stuck for 5 s. Then you play against them and accept the level. |
| Q-10 | Tuning | As roslambo's Q-12: on M2's tuning page, together. It covers the six TBDs, the terrier's collision size, the drive and friction, the goal netting's bounce and the bowling speed, starting from Appendix A.5. The values go into the Configuration table. |
| Q-11 | The look | Placeholders until M4. Then a look book, as roslambo's, offers samples driven by recorded matches through the terrier drawer (§12), and you pick the terriers, coats, pack colours and patterns, the ball and the pitch. Every coat is checked against both packs for colour blindness. |
| Q-12 | Safari (C-7) | Playwright's WebKit stands in for Safari in the gate, with exact operations and the startup canary (D-23). If you can borrow an iPhone or a Mac, the determinism page and one match run on it before release; otherwise the README says real Safari is unverified. |
| Q-13 | What "done" means if the device runs slip, as roslambo's did | The MVP is done when the gate is green, the site is deployed, your desktop checks pass, and every line of REQUIREMENTS.md passes. Lines that need a device you don't have stay marked pending in `docs/acceptance.md`, as in roslambo. |
| Q-14 | A relay that fails the pre-deploy check (L343) | Replace it with nostr.mom, roslambo's next choice, in terriest only, and offer the same swap to roslambo and amorfus separately. |
| Q-15 | Practice (C-30) | Pause and Resume appear in the match menu in Practice only. Opening the menu or hiding the tab pauses it: play, the clock, animations and sound stop. A reload goes Home, because no peer holds the match. The player starts in the first pack and may switch; bots fill every other place, so Add and Remove a bot are hidden. Play again starts a new Practice with the same settings and contacts no one. |
| Q-16 | Abandoned matches (C-31) | When no browser that controls a terrier is left, the match runs on for 30 s, so a player who reloads can come back. After that the browsers still there show "The players have left", with the score so far and **Home**. L282 then reads "while another browser stays in the match". |
| Q-17 | Keys on Pre-match and in the menu (C-34) | Keys and buttons outside the play set. Escape, or the gamepad's Back button, opens the menu on Pre-match and Match. The arrow keys or the d-pad move between Pre-match's buttons, with Ready focused first, and Enter or Start presses the focused one. The pitch keeps the other keys, so Space only ever jumps. Results also takes the usual confirm button. |
| Q-18 | Claude's own setup in this repo | Right after approval, in one sitting with you there (every write under `.claude/` asks you to approve it): amorfus's hand-written `.claude/` (session-branch rules, the guard against editing `main`, `/merge-to-main`, `/sync-with-main`), with a narrow allowlist for the gate's commands. No claude-kit submodule, because it comes from another organisation. `CLAUDE.md` comes at M1. Alternative: no `.claude/`, as roslambo. |
| Q-19 | Chase view's re-read (C-24): your 2026-11-14 wording reads the screen again whenever the stick moves to a new direction | The stick is sent in 32 steps a turn. Under that wording, a wobble across one step after the camera has swung would turn the terrier again: the spin anchored steering was chosen to remove. Proposal: read the screen when a direction starts from neutral, or when it moves 45° or more from the direction last read; a smaller move turns the kept direction by the same angle. This changes only what the controls send (L76). |

---

## 2. Requirement changes your answers would make

REQUIREMENTS.md is yours. These edits go in after you answer, in one commit that cites the numbers. Notes for the plan are not requirements, but they are your text too, so their corrections are listed here as well.

| Requirement (current) | Amended wording | From |
|---|---|---|
| Status: "… the rest is still a proposal" | "Status: settled by the owner on 2026-11-14 and amended by the approved PLAN.md; Q- and C-numbers cite it. **TBD** marks a value not yet chosen." | approval |
| Match ID: "Displayed in groups of four (`K7QM-2XDP-4TR8-WHZN-3VBC-7`)" | "… (`K7QM-2XDP-4TR8-WHZN-3VBC-K`)": the old example fails its own check character | C-15 |
| Match ID: "so presses at the same moment lead to the same match" | "so every press leads to the same match" | C-42 |
| Consensus: "the state held by the **majority** wins"; "The majority is counted among the votes received" | "the state with the most votes wins"; "The votes are counted among those received" | C-16 |
| Consensus: "Each player broadcasts its control inputs …" | "Each browser that controls a terrier broadcasts …" (a spectator hosting bots does too) | C-16 |
| Consensus: "Goals and the end of the match are taken from final ticks, so a correction never takes one back. A goal's score, whistle and celebration, including the terriers' celebrating animation, show once its tick is final, about 0.2 s after the ball crosses the line" | "Goals and the end are taken from ticks the vote has confirmed, so a correction never takes one back. A goal's score, whistle and celebration, including the terriers' celebrating animation, show once its tick is confirmed, about 0.4 s after the ball crosses the line. The net bulges at once." | Q-7 |
| Configuration: Goal celebration "3 seconds" | "3 seconds, as seen: the simulation holds it for 3 s plus the confirmation delay" | Q-7 |
| Tumble: "So does a ball that comes at a terrier at the **bowling speed** or faster, counting only the ball's own speed toward the terrier, so a terrier is never tumbled by a ball it's pushing or chasing." | "So does a ball that comes at a terrier at the **bowling speed** or faster, counting only the ball's own horizontal speed toward the terrier, except for a terrier in its lunge and the terrier that touched the ball last. So a terrier is never tumbled by a ball it's pushing or has just shot, even off a wall, but one chasing a ball a rival touched last can be." | Q-8 |
| Configuration, Bowling speed: "A pounce, or a push at zoomies speed, sends a resting ball off fast enough; a push at a run doesn't" | "A pounce from the air sends a resting ball off fast enough. Pushes from the floor meet the ball low, so whether they bowl depends on the tuned values. A ball dribbled at a run does bowl." | Q-8, C-5 |
| Persistence: "Display names are up to 20 characters" | "… up to 20 characters and 32 bytes, without control characters" | C-17 |
| Scoring: "A goal is credited to the terrier whose touch was the latest …" | "… whose contact with the ball was the latest …; each attacker sharing it counts a goal" | C-26 |
| Kickoff: "During it, terriers can turn on their spots but not leave them" | Add: "and bark. Held directions and zoomies act as soon as play starts; presses during the countdown are dropped" | C-20 |
| Ready and warm-up: "terriers can run, jump and pounce around the pitch to warm up" | "… can use every control to warm up, and pounces tumble rivals" | C-20 |
| Scoring: "A goal is followed by a short celebration … Then comes a kickoff" | "… Then comes a kickoff, the overtime kickoff, or the results screen" | C-20 |
| Practice: "the match menu can pause it" | Add the Q-15 rules | Q-15 |
| Disconnects: "If every peer leaves, the match is over …" | Add the Q-16 grace period and message | Q-16 |
| Acceptance: "A player who reloads mid-match takes back their terrier" | "… while another browser stays in the match" | Q-16 |
| Platform: "Nothing contacts a third party until a player proposes or joins a match" | Add: "Opening a `#join=` link or entering a code counts as joining" | C-32 |
| Quality: "a stand-in skinned model, kept out of the shipped build" | Add: "served to the shipped build by the tests" | C-33 |
| The ball: "On screen it turns as if rolling with its motion" | Add: "That turning is drawing only, and may differ between viewers" | C-29 |
| Controls: "Pressing a new direction, or moving the stick to one, reads it from the screen again" | "Pressing a direction from neutral, or moving the stick 45° or more from the direction last read, reads it from the screen again; a smaller move turns the kept direction by the same angle" | Q-19 |
| Pack size: "4 a side is the mesh cap of 8 players" | "… the mesh cap of 8 browsers that play; bots aren't peers" | C-49 |
| Joining and packs: "A bot is always ready, so the people's Ready starts the match" | Add: "A match of bots alone starts when its packs are full" | C-41 |
| Configuration, Ball bounce: "Keeps 70% … off the floor, walls, nets and goal frame" | "… off the floor, the walls, the overhead net and the goal frame. The goal's netting keeps less, tuned at M2, so a goal bulges the net instead of springing back out" | C-48 |
| Notes, Reuse: "need only a docs update" | "hermet takes each app's policy as options, so a third app needs no hermet change for its own policy. Its docs name only amorfus and roslambo, its licence writer must be fixed before any app ships licence texts (C-8), and the three.js build must be checked against its audit (C-9)." | C-43 |
| Notes, Trystero: "An upgrade of Trystero now moves three apps at once" | "… now couples three apps: hermet's room config is typed against the Trystero each app installs, so a change to that type is a hermet change every app takes at its next pin bump" | C-43 |
| Notes, Cost on the phone: "a 12-tick replay of 4 substeps each checks them 48 times: 1,728 pair checks" | Add: "roslambo's timeline re-simulates the whole window on every tick, 13 steps, so in its scheme that's at least 3,744 pair checks a tick" (its `timeline.ts` and `physics.ts`) | C-44 |
| Notes, Resting and rolling contact: "bodies resting together hit a per-substep event cap" | Only once M0 has measured it: in the audit's probe (research/audit/REPORT.md §5) roslambo's cap never bound, and its per-substep overlap pass settled resting bodies; and the 137–174 events a second came from roslambo's M0 integrator, which its M2 replaced | C-44 |
| Platform: "Domain **TBD**" | The domain you choose | Q-5 |
| Stack: the six relays | Any relay that fails the pre-deploy check, replaced as you choose | Q-14 |
| Configuration: the TBD values | The values you sign off at M2 | Q-10 |
| Acceptance: devices and runs | The devices, people and networks you name, recorded in `docs/acceptance.md` | Q-4 |

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

**C-2 — The phone's cost is unmeasured, and now comes last.**
- **CPU:** roslambo re-simulates the whole 12-tick window from the final state on every tick, plus one finalising step: 13 steps a tick, not a 12-tick replay now and then. In roslambo's scheme, with 9 bodies and 4 substeps, that's at least 3,744 pair checks a tick before any contact splits; L342 counts 1,728 for one replay. roslambo measured tick cost on desktops only.
- **GPU:** 8 animated terriers, a ball and a netted pitch in 3D, never measured on any phone. Every headless engine here draws in software (C-6), so nothing local stands in for the Pixel 8a.
- **Timing:** the first phone run is at M0 if Q-4 finds a route, otherwise at M5.
- **Resolution:**
  - D-11 re-simulates only from the earliest tick whose inputs changed, usually 1–2 steps; the budget still assumes 13.
  - M0 measures tick cost on the desktop and in throttled Chromium at the Pixel 8a's size, as roslambo's proxy does.
  - The drawing budget the gate enforces is provisional, from M0, until the phone run.
  - A render-quality setting (D-33) gives a cheaper path.
- **Residual:** a late surprise on the phone could force cuts at M5: fewer triangles, a lower pixel ratio, simpler effects.

**C-3 — Resting, rolling and simultaneous contacts, under exact operations.**
- **Problem:** in terriest the ball and the terriers rest on the floor almost all the time, a push is a lasting contact, and every bounce loses speed on purpose (L338). A scratch copy of roslambo's integrator, with a floor under gravity, showed it can't do this:
  - a resting body never comes to rest, leaving every overlap pass at +0.017 m/s;
  - a rolling body loses 30% of its speed every substep;
  - its bounce swaps velocities, which is right only for equal masses, and the ball weighs twice a terrier.
- Settled one at a time in a fixed order, as roslambo's are, contacts bias a mirrored kickoff once masses differ and bounces lose speed: the pack settled first sees the ball roll back at an eighth of the terriers' speed.
- Settled all at once instead, in plain Jacobi iterations, several contacts on one body mis-solve. The review of this plan's first draft modelled three or four terriers hitting the ball together: they created energy, or sent the ball slower than one terrier did (research/audit/REPORT.md §6).
- **Resolution:** a new solver (D-5): the floor as support, accumulated impulses by Gauss–Seidel over mirror pairs, restitution only above a closing speed. M0 proves it. Its stop rule sends it back to D-5 if a resting ball can't be held bit-still, or if simultaneous hitters gain energy.

**C-4 — "A correction never takes one back" isn't true at final ticks.**
- **Problem:** a final tick is safe from late inputs, but a peer whose hash loses the vote replaces its final state, about 0.4 s plus a round trip later. That's why roslambo acts on its end only at the vote-confirmed tick. Even a confirmed tick can rarely be re-tallied by a very late vote.
- **Resolution:** Q-7. **Residual:** a rare take-back on a peer that diverged; accepted, as in roslambo.

**C-5 — The bowling rule can't do what its examples say.**
- **Problem:** on a 4 m/s threshold on the ball's speed toward the terrier:
  - pushes come from the floor and meet the ball low, so a zoomies push leaves it at about 2.3–4.05 m/s horizontally, depending on the collider and how contacts are solved: mostly short of 4;
  - a ball pushed along at a run reaches 6 m/s and bowls every rival it meets, though L324 says a push at a run doesn't, so no speed threshold separates hard hits from dribbles;
  - a terrier that pounces into an oncoming 5 m/s ball, L341's own example, is always bowled;
  - a ball driven into a wall at 6 m/s comes back at 4.2 m/s and bowls the terrier chasing it, though L49 says that never happens.
- **Resolution:** Q-8.

**C-6 — The gate draws WebGL 2 in software.**
- **Measured 2026-11-14 on this machine**, 100k triangles a frame:
  - MSAA on: 4.9 fps in Chromium (SwiftShader), 13.4 in Firefox and 10.9 in WebKit (llvmpipe);
  - MSAA off: 15.5, 25.9 and 23 fps;
  - all three engines at once, as a multi-peer test runs them: 10–15 fps;
  - in WebKit, GL work blocks the page's JavaScript for 23 ms or more a frame.
- Firefox gets WebGL only while `DISPLAY` or `WAYLAND_DISPLAY` is set, which WSLg provides here; a gate run from cron, a service or another CI may silently lose it.
- **Resolution:**
  - Nothing in a test depends on the frame rate: the timeline runs on timers (D-31).
  - The gate runs at the low render-quality setting, a real player option (D-33), not a test mode.
  - The gate asserts WebGL 2 before anything else.
  - An opt-in GPU path, `GALLIUM_DRIVER=d3d12`, reached 60 fps in all three engines here, for faster local runs.
  - Frame timing is judged by hand: on your desktop for now, on the phone at M5.

**C-7 — Real Safari is untested (roslambo C-7).**
- Playwright's WebKit on Linux draws through Mesa and uses Linux maths, so it only stands in. roslambo's run on real Safari never happened.
- **Resolution:** exact operations, the canary (D-23), Q-12.

**C-8 — hermet's licence notices ship without their texts.**
- **Problem**, verified twice on 2026-11-14:
  - hermet's `licenses.mjs` reads `license` and `licenseText`, but Vite 8 writes `identifier` and `text`, so every notice is a bare `## name@version` heading.
  - roslambo's and amorfus's live sites serve MIT and ISC code that way, and no licence text is inside their bundles either. A rebuild of each from HEAD reproduced its shipped notices byte for byte.
  - The gate stays green: the audit checks only the headings, and hermet's test asserts the text only for `extra` entries, never for npm ones.
  - amorfus's vendored FastNoiseLite has no notice at all.
  - terriest would ship MIT three.js and Trystero the same way.
- **Resolution:** the fix in Q-3. Until it's pinned, terriest's own wrappers map Vite's field names onto hermet's, and fail any notice with no text (D-37). Both shims go when the pin moves.

**C-9 — three.js has never been through hermet's dist audit.**
- **Problem:** the audit reads every string in the bundle, library code included. A documentation URL in a warning, or in GLSL comment text, fails it. So might a tokenizer edge case, such as a regular expression after `)` that holds a quote. No copy of three.js is on this machine to check.
- **Resolution:** M0 builds three's WebGL renderer, and GLTFLoader if it ships, then runs the audit with no exceptions. Each finding becomes an app option, a hermet option or a tokenizer fix, and the request guard confirms nothing is ever requested from it.

### Minor

| # | Problem | Resolution |
|---|---|---|
| C-10 | With two voting browsers, any disagreement is a tie the smallest hash wins (roslambo C-19). Here that covers every online 1-a-side match between two people. | Accepted: honest peers rarely disagree. |
| C-11 | roslambo's spectator cap can be exceeded: a browser refused as a player watches uncounted; a spectator counts the others but not itself; two handshakes at once can both pass. | D-21 |
| C-12 | A phone tab the OS killed may be refused as "open in another tab" until its old connection times out. | D-21: a hello with a connected player ID replaces a connection silent for 2 s. |
| C-13 | roslambo's build hash covers settings and versions, not simulation code, so old and new builds could share a match and keep resyncing. | D-21: the build hash also covers the canary's hash and d, w and v. |
| C-14 | Safari may delete the stored ID, name, coat and settings after 7 days without a visit (roslambo C-5). | Accepted, and the README says so. Only a re-typed name and coat are at stake. |
| C-15 | The example match ID fails its own check character, which should be K. | §2 |
| C-16 | "Majority" is a plurality in roslambo's code; spectators hosting bots broadcast too. | §2 |
| C-17 | roslambo caps names at 32 bytes as well as 20 characters, and drops a name that breaks the rule. | §2 |
| C-18 | L56's push times need a drive model the text doesn't state. Four pushers side by side take about 0.65–0.7 s, not 0.6. | D-6; tuning (Q-10) |
| C-19 | The terrier's collision shape is undefined, and every hit number depends on it. | D-4; tuning (Q-10) |
| C-20 | Unstated: pounce mechanics; zoomies on an empty meter; what resets at a kickoff; what terriers may do in warm-up, countdowns and celebrations; tumble edge cases. | D-6, D-8, §2 |
| C-21 | Squeezes, and the kickoff pinch at every bot kickoff, can leave the ball resting on terriers. | D-5's slip-out rule; a gate test for each pack size |
| C-22 | "Mirrored" kickoff spots could mean reflection or point symmetry, and exact symmetry in floating point needs the pitch centred at the origin. | D-4, D-5 |
| C-23 | The goal mouth makes the pitch non-convex; half-planes can't model it. The ball is wholly past the line for only a few ticks. | D-4, D-8: bounded pieces; a goal test every substep |
| C-24 | Re-reading the screen at every step of a stick brings back the spin anchored steering removed. | D-29, §2 |
| C-25 | Vehicle-style "back brakes and backs up" can't be "resolved into a heading". | D-7: the nose frame is throttle and turn |
| C-26 | "The latest touch" is ambiguous when a touch is an episode. | D-8: the latest contact |
| C-27 | If goals wait for confirmation, only 2.6 s of a 3 s celebration is seen. | Q-7 |
| C-28 | Inputs are sampled once a tick and predicted as the last one, so a held button repeats in prediction and a quick tap can be lost. | D-10: press counters |
| C-29 | The ball turns on screen "as if rolling", but the simulation gives it no rotation to read. | §2: drawing only |
| C-30 | Practice's pause, its Play again and its Pre-match controls are undefined. | Q-15 |
| C-31 | If the only browser in a match reloads, the match ends, so L282 can't hold. | Q-16 |
| C-32 | Join must connect before the player picks a pack, so opening a link contacts the relays. | §2: opening a link counts as joining |
| C-33 | The stand-in model must stay out of the shipped build, yet the tests run against it. | D-27: the tests serve it |
| C-34 | Space and the gamepad's bottom button jump in warm-up, and would also press a focused Ready. Nothing opens the menu without a mouse or touch. | Q-17 |
| C-35 | A hidden tab draws nothing, so "60 fps" can only mean a visible page. A covered window also counts as hidden. | D-31 |
| C-36 | Losing WebGL 2 mid-match isn't covered. | D-30 |
| C-37 | Unstated: how a phone is told from a tablet, whether spectators are asked to turn the phone, safe areas, and a screen that sleeps on a spectator. | D-30 |
| C-38 | The walls and net are both 6 m high, so "high above one side" puts the spectators' camera outside them, looking through. | D-28: the near wall and the net fade where they're in the way |
| C-39 | Settings defaults, which settings apply mid-match, what mirroring moves, and whether control hints are remembered. | §11 |
| C-40 | The one-tab rule doesn't say whether it covers Practice and watching. | D-24: one lock for the whole app |
| C-41 | Bots are always ready, so a match of bots alone starts when the last is added. | As roslambo; §2 |
| C-42 | Play-again presses come at different times; a player's old pack may be full. | D-12 |
| C-43 | L334's "need only a docs update" and L347's "moves three apps at once" are inaccurate. | §2 |
| C-44 | The notes describe roslambo's integrator and cost imprecisely. | §2: the cost now; the event cap only once M0 has measured it |
| C-45 | A `workers.dev` address shows the account's name. | Q-5; never written into the repo |
| C-46 | The earlier sibling deploys signed in with wrangler's full-account login, not a scoped token. | Q-6 |
| C-47 | Holding sideways in ball view spirals outward, about 0.3 m a lap from 3 m away, because each tick aims along the tangent. | Accepted, or an inward correction tuned at M2 (D-7) |
| C-48 | At 70%, the goal's netting sends a ball shot in at 5 m/s back out at 3.5 m/s during the celebration, at odds with "a goal bulges the net" (L101). | §2: a softer netting, tuned |
| C-49 | The mesh cap counts browsers, not terriers; bots aren't peers. | §2 |

---

## 4. Decisions

Each decision gives the choice, the options rejected, and the cost if it's wrong. Values marked *provisional* are confirmed or changed by M0 or the tuning.

### Simulation

**D-1 — float64 with exact operations only (roslambo D-1).**
- **Choice:** roslambo's rule, enforced on `src/core/sim/**` by hermet's exact-ops lint: `+ − × ÷`, `%`, comparisons, bit operations, `Math.sqrt`, `Math.abs/min/max/floor/ceil/round/trunc/fround/imul/clz32`, literals. NaN never occurs; the codec asserts it.
- **Evidence (2026-11-14, this machine):** `sin`, `cos`, `tan`, `atan2`, `atan`, `asin`, `acos`, `exp`, `expm1`, `cbrt`, `hypot` and `sinh` gave different bits in Chromium, Firefox and WebKit; `+ − × ÷`, `sqrt` and `fround` agreed. roslambo's M0 matched four engines over 220,000 ticks under the same rule.
- **Also:** the rule matches names only, so `const { sin } = Math` slips past it. terriest's config test checks that loophole, and its fix is offered to hermet.
- **Cost if wrong:** as roslambo: the goldens and the canary catch it; the fallback is fixed point inside `src/core/sim/math`.

**D-2 — Headings are binary angles, with roslambo's sine and cosine and a new exact `datan2`.**
- **Choice:**
  - A heading is a u32 binary angle (2³² per turn), as L335 asks. Turning is integer arithmetic. roslambo's `angle.ts` is copied: binary angles and `dir`, its exact cosine and sine of an angle, computed together, plus `fractionOfTurn`.
  - New: `datan2(y, x)` → binary angle. It reduces to an octant by comparisons and swaps, takes one exact division, then a fixed polynomial in Horner form, rounded to an integer. It's tested against `Math.atan2` to about 1e-9 of a turn, and pinned by the goldens in all three engines.
  - It's needed because the ball frame (D-7) resolves a direction against the line from the terrier to the ball, inside the simulation.
- **Rejected:** headings kept as unit vectors, renormalised with `Math.sqrt` every tick. That needs no `datan2`, but every turn and snap gets harder to keep exact, and the animations read turning as an angle. It's the fallback if `datan2` fails a golden.
- **Cost if wrong:** a polynomial error is a tiny direction error, identical everywhere. Low.

**D-3 — 60 ticks a second, 4 physics substeps (roslambo D-3).**
- **Choice:** one input per browser per tick; substeps of 1/240 s. No tunnelling, which a test checks:
  - **Against the pitch's pieces,** which may be thin: a body moves less than its radius in a substep. A terrier at 10 m/s moves 0.04 m against its 0.25 m.
  - **Between two bodies:** they close by less than their radius sum. The fastest, about 25 m/s, closes 0.1 m against at least 0.5 m between two terriers.
- **Cost if wrong:** as roslambo.

**D-4 — Bodies and the pitch.**
- **Choice:**
  - **Coordinates:** metres. The centre spot is the origin, x along the length, z up. Pack A defends the goal at x = −20, pack B the goal at x = +20. Centring makes mirroring a negation, which is exact in floating point.
  - **The ball:** a sphere, radius 0.8 m, mass 2. No rotation in the simulation (L59).
  - **A terrier:** a sphere, radius 0.25 m *provisional*, mass 1, centred 0.25 m above the floor when standing. The drawn terrier fits a 0.6 m × 0.5 m × 0.5 m box around it (L310), so its nose and tail overhang the sphere by up to 5 cm. Turning never changes a collision, so turning into the ball or a wall creates no contact.
  - **The pitch:** a list of bounded static pieces, each a convex shape with a closest-point test:
    - planes: the floor and the overhead net;
    - quads: the side walls, the four cut corners, the end-wall panels beside and above each mouth, and each goal's back, side and top netting;
    - capsules of radius 0.1 m: the posts and crossbars, on the end-wall plane, leaving the mouth 8 m wide and 3 m high clear.

    Nothing in the code depends on the pitch's shape (L69). The list is built from the Configuration, and the tests run a second, different shape.
  - **Mirroring:** pack B's kickoff spots are pack A's point-reflected through the centre spot, (x, y) → (−x, −y). The spots are also symmetric about the long axis, so both readings of "mirrored" pick the same set.
- **Rejected:**
  - A horizontal capsule along the heading, matching the 0.6 m length: turning sweeps its ends into neighbours, 3–6 cm a tick, creating overlaps that the solver must push out every tick. It's the alternative the tuning page can compare.
  - roslambo's half-plane arena: it can't model a goal mouth.
- **Cost if wrong:** the collider is fixed in the goldens, which can be re-emitted until the first release.

**D-5 — The contact solver.**
- **Choice,** in each substep:
  1. **Forces:** each terrier's drive or friction (D-6); gravity on bodies off the floor; the ball's rolling slowdown while it's on the floor.
  2. **Integrate:** semi-implicit Euler, velocity then position.
  3. **Detect:** every pair of bodies, and every body against the pitch's pieces behind a cheap bound test. Contacts go into one list in a fixed, mirror-symmetric order: bodies interleaved by spot across packs (A1, B1, A2, B2 …, then the ball), so a sum over mirrored partners pairs them.
  4. **Floor as support:** a body touching the floor and not moving up is set to z = radius exactly, with vertical speed 0, unless it closes faster than the threshold, when it bounces. A resting ball is then bit-still: gravity and the support cancel exactly.
  5. **Impulses:** accumulated normal impulses, solved by Gauss–Seidel over mirror pairs.
     - **Order:** contacts are taken in mirror pairs in the fixed order. The two contacts of a pair are computed from the same velocities and applied together, then the next pair is taken. Each sweep runs forward, then back, for a fixed number of iterations, 8 *provisional*.
     - **Clamping:** each contact's total impulse is clamped so it never pulls; the step within an iteration may be negative. Impulses are weighted by mass, and static pieces are infinitely heavy.
     - **Restitution:** a contact's target separating speed is its restitution × its closing speed at the start of the substep, when that exceeds 0.3 m/s. Slower contacts settle with no bounce.
     - **No friction:** contacts leave tangential speed alone.

     Mirror pairs computed together keep a mirrored state exactly mirrored: each pair's impulses are exact mirror images, and a sum over mirror images cancels exactly.
  6. **Positions:** overlaps are pushed apart by mass-weighted fractions, in a fixed number of passes, without touching velocities.
  7. **Slip-out:** a contact whose normal is within 45° of vertical never holds anything up. It pushes the lower terrier out sideways at 2 m/s, away from the upper body's centre, or along its own heading if exactly centred; the upper body falls. So a squeezed or pinched ball comes down, and two sitting terriers can't hold it up.
  8. **Touches and the goal test** (D-8).
- **Restitution:** the ball keeps 70% of its normal speed off the floor, walls, overhead net and goal frame (L308); the goal netting is tuned from 0.3 *provisional*, so a goal bulges the net rather than springing out. Terrier against ball 0.5 (L311); terrier against terrier and walls 0.3 *provisional* (L312).
- **Rejected:**
  - roslambo's split Verlet: built for elastic, equal-mass bounces (C-3).
  - Sequential impulses in one fixed order: they bias mirrored kickoffs (C-3).
  - Plain simultaneous (Jacobi) impulses: with several contacts on one body, as when a pack hits the ball together, they create energy or under-solve (C-3). Jacobi with each body's share relaxed (1 ÷ its contact count) is the fallback, if mirror pairs prove awkward.
  - A stock physics engine: none keeps to exact operations (L335).
- **Cost if wrong:** jitter, a creeping ball, pushes that bounce, hits that gain energy. The solver is one module, M0 proves it first, and its tests (§16) catch a regression.

**D-6 — Movement and actions.**
- **Run:** target velocity = the input's direction × run speed, 6 m/s, or zoomies speed, 9 m/s. The drive moves the velocity toward the target by at most 15 m/s² × dt, so it acts as a force shared with whatever the terrier pushes. With the rolling slowdown, it brings the ball to 95% of run speed in about 1.2 s for one pusher and 0.6 s for four in a line, L56's figures (research/audit/REPORT.md §6). The heading turns toward the target direction at 2 turns/s and snaps onto it within a step; pounces follow the heading.
- **Idle friction:** with no direction held, or tumbled, or sitting, the horizontal velocity falls at 8 m/s² *provisional*. A pusher at 15 m/s² against an idle terrier then moves it at 3.5 m/s², so idle and sitting terriers can be pushed (L51, L213).
- **Zoomies:** while held with a direction, if the terrier can act and the meter isn't empty, the terrier runs at zoomies speed and the meter drains, 3 s from full. The meter refills whenever the terrier isn't zooming, 6 s from empty (L46). Once emptied, zoomies needs a release before it works again, so a held button doesn't flicker between zooming and refilling. It's full at every kickoff.
- **Jump:** from the pitch floor only (not from a terrier or the ball): vertical speed √(2 g × 1 m) ≈ 4.43 m/s, about 0.9 s in the air. In the air the terrier keeps its velocity and can still turn, so an air pounce can be aimed.
- **Pounce:** a press, with no wait pending and not tumbled, sets the horizontal velocity to 10 m/s along the heading and keeps the vertical speed.
  - **The lunge** lasts 0.3 s, or until it hits the ball, a terrier or a wall, which ends it. Neither the drive nor friction acts during it, so it holds 10 m/s for its 3 m unless it hits something.
  - **During it,** the heading is locked and jumps are refused.
  - **The 1.5 s wait** starts when it ends.
  - **A jump and a pounce** pressed in the same tick: the jump first.
- **Tumble:** 1.5 s, including a 0.5 s get-up. A tumbled terrier can't act and slides under idle friction. Then the tumble guard, 1.5 s *provisional*, protects it. A pouncing terrier tumbles the rival it hits; two pouncing into each other both tumble. A sitting terrier can be tumbled like any other, and sits again once it's up. The ball tumbles by Q-8's rule.
- **Bark:** carried in the input, never in the state (D-10, D-16).
- **Cost if wrong:** feel only; the tuning page shows it, and every constant is in `src/config.ts`.

**D-7 — Steering frames: one input format for all three schemes.**
- **Choice:** an input carries a direction (32 steps, or none) and the frame it's measured in. The simulation resolves it:
  - **Pitch frame:** the direction is on the pitch. Anchored chase view sends this, read from the camera when it's pressed (D-29); screen-relative steering would too.
  - **Ball frame:** the direction is relative to the line from the terrier to the ball: forward is `datan2` of the horizontal vector to the ball, plus the step. While the ball is nearly overhead (horizontal centre distance under 0.3 m, leaving above 0.4 m, with the flag kept in the state), the line is taken from the heading (L75). Anchored ball view sends this.
  - **Nose frame:** for vehicle-style steering. The direction's forward part is throttle: back brakes, then reverses at up to 3 m/s. Its sideways part turns the terrier at the nose turn rate, 1 turn/s *provisional*, a setting in the simulation's configuration from the start.
- **Anchored** is the scheme the controls send (Configuration: Steering). All three frames are in the goldens from the first emit, so switching changes only what the controls send (L76, L336).
- **Also:** holding sideways in ball view spirals out slightly (C-47); the tuning page shows whether it needs an inward correction.
- **Rejected:** one input meaning per scheme. That's three code paths, and a switch would change the state's hash.
- **Cost if wrong:** low; the frames are one function.

**D-8 — Match rules.**
- **Phases:** warm-up, start countdown (5 s), in play, celebration, kickoff countdown (3 s), ended. Overtime is a flag on the match.
- **What terriers may do:**
  - in warm-up, every control, and pounces tumble rivals; the ball is fixed on the centre spot and never moves or bowls;
  - in countdowns, turn and bark only; held directions and zoomies act from the first tick of play, and presses during the countdown are dropped;
  - in a celebration, run, turn and bark; nothing tumbles and nothing is counted. The ball stays physical.
- **Kickoff:** at the start of each countdown, every terrier, sitting ones included, is placed at rest on its spot facing the ball, with its pounce ready, no tumble or guard, and a full meter. The ball is placed at rest on the centre spot.
  - **Spots:** Appendix A.5, for each pack size.
  - **Who takes which:** within a pack, terriers sorted by player ID; a bot's ID is derived from its host's (D-39), so the rule covers bots.
  - **Warm-up arrivals:** a joining player, a pack switch or a new bot appears on its pack's next free spot, nudged clear of overlaps.
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

**D-10 — Inputs and presses.**
- **Choice:** one 16-bit input per browser per tick (Appendix A.2):
  - the direction step and whether one is held;
  - the frame;
  - whether zoomies is held;
  - a 2-bit press counter each for jump, pounce and bark.

  The simulation acts once for each new count, so a predicted input never repeats a press, and a tap shorter than a tick still counts. A press that can't act is dropped: in the air, waiting, tumbled, in a countdown.
- **Bark:** the simulation ignores the bark counter. A peer plays a remote bark when an input with a new count arrives (D-16), and the sender keeps to one a second (L327). The state keeps each terrier's previous input to spot new presses, with the bark bits cleared, so barks stay out of the hash.
- **Prediction holds:** anchored steering keeps a held direction's input the same from tick to tick. The stick is read in 32 steps with half-step hysteresis, so a wobble doesn't change it (L342).
- **Rejected:**
  - Held buttons only: prediction repeats them, and quick taps are lost.
  - Analog speed from the stick: inputs would vary every tick and defeat prediction.
- **Cost if wrong:** low; the input is one codec.

### Timeline and consensus

**D-11 — Rollback lockstep (roslambo D-7), re-simulating from the earliest changed tick.**
- **Choice:** roslambo's timeline, copied from its code, not from its PLAN's tables: d = 2, w = 12, v = 12, a 256-tick state history, the 16-tick input history in every TICK, the joiner warm-up, and the M0 and 2026-10-25 fixes.
- **Change:** a late input re-simulates from the earliest tick whose inputs changed, instead of the whole window every tick. Usually 1–2 steps; the budget still assumes 13 (C-2).
- **Cost if wrong:** if the change ever disagrees with a full replay, a test catches it, and the full replay is one flag away.

**D-12 — Roster events with packs (roslambo D-8).**
- **Choice:** JOIN carries a pack, a coat and the name; SWITCH a pack; READY, UNREADY and LEAVE as in roslambo. Events ride in a peer's input, and are re-sent until the state shows them (roslambo §8.3).
- **Same-tick JOINs** for a pack's last place go in player-ID order. A JOIN for a full pack is ignored, and the player is offered the other pack. Switching packs cancels a Ready.
- **Bots** join and leave as JOIN and LEAVE of bot IDs, in their host's TICK (D-39).
- **Play again** (roslambo Q-8): every press goes to the derived room; a browser joins the match there, or proposes it if none exists; two genesis states merge to the older (roslambo D-12). Players keep their pack if it has room, else take the other, else watch. Spectators stay spectators. A press after the start countdown watches, with a note.
- **Removal** before the start countdown after 180 final ticks without input (roslambo Q-15).
- **Cost if wrong:** as roslambo.

**D-13 — Votes (roslambo D-9).** Unchanged: 64-bit MurmurHash3 votes in every TICK; a tally at g + w + v counts one vote per browser that controls a terrier in its own roster at g, its player's or a bot's; most votes win, smallest hash on a tie; a late vote still counts while its tick is in the history.

**D-14 — Goals and the end only from confirmed ticks (roslambo D-10, extended).**
- **Choice:** the score, whistle, scorer's name and celebration show once the goal's tick is confirmed (Q-7). The results screen and the Terriest come from the confirmed end. The ball entering the net is drawn from the predicted state as usual.
- **Cost if wrong:** 0.2 s of delay on a goal. Q-7's alternative is a one-line change.

**D-15 — The tick clock (roslambo D-11, as amended).** Unchanged, with the M0 corrections and the 2026-10-25 fixes for windows whose timers sleep.

**D-16 — What a peer sees between corrections.**
- **Smoothing (L207, L208):**
  - A correction moves the drawn ball and terriers by an offset that decays over about 100 ms, 50 ms for your own terrier. The offset is clamped inside the pitch, and dropped at a kickoff reset rather than smoothed across it.
  - An animation a correction takes back blends out, one it adds blends in part-way through, and one it moves blends to its new timing.
  - Drawing never writes to the state, which a test checks by hash.
- **Barks:** a timeline accessor gives the input actually received for a tick, never a predicted one. A remote bark plays when that input's bark count changes (L209).
- **The away mark:** from the state. From the start countdown on, a terrier sits after 60 final ticks without its browser's input, and is back from that browser's next final input (L138, L167, L213).
- **Cost if wrong:** looks only. M4 measures correction sizes with the bench's virtual peers before tuning the glide.

**D-17 — Returning players and abandoned matches.**
- **Returning:** opening a `#join=` link connects first. If the received state's roster holds this browser's player ID, or bots derived from it, the browser takes control at once and skips Join (L215). roslambo used its ledger for this, which terriest doesn't keep.
- **Abandoned (Q-16):** when no browser that controls a terrier has been heard for 30 s, the match is over for whoever remains. A spectator learns it from the silence.
- **After the end:** a browser that arrives while others are still on Results takes the final state from one of them and shows Results too.
- **Cost if wrong:** low.

### Networking

**D-18 — Trystero 0.26.0, unpatched, through hermet's room config (roslambo D-13).**
- **Choice:**
  - roslambo's `trystero.ts` and `room-config.ts`, with `appId: 'terriest'`, its own action name, and no passive rooms.
  - `maxReceiveBytes` is 1 MiB until M3 measures the largest STATE; then the measured size with headroom.
  - Only `src/net/trystero.ts` imports Trystero.
- **Cost if wrong:** as roslambo.

**D-19 — Forwarding for pairs that can't connect (roslambo D-14).** Unchanged.

**D-20 — Binary messages (roslambo D-15), widened for terriest's inputs.**
- **Choice:**
  - roslambo's framing, decoders that never throw, and the 16,000-byte limit.
  - TICK, STATE and the bot entries carry the 16-bit input.
  - The 16-tick history marks "same as the next newer input" in one mask, so a held anchored input costs a few bytes.
  - JOIN gains pack and coat; SWITCH is new. The protocol version starts at 1.
- **Size (estimate):** a TICK is about 35 bytes, plus about 30 per hosted bot. M3 measures the traffic.
- **Cost if wrong:** low.

**D-21 — The handshake: build hash, spectator count, duplicate IDs.**
- **Build hash** (roslambo D-16): over every constant, the codec and protocol versions, d, w and v, and the canary's hash. Simulation code that changes behaviour therefore changes the hash, which roslambo's doesn't do (C-13).
- **Spectators:** counted by what a peer is: connected and not in the roster or joining, including the peer counting. They're checked when a peer chooses Watch, and again when a player is refused. A fifth gets "This match has the most spectators it can take" (C-11). An undecided peer on the Join screen is admitted while any place is free.
- **Duplicate player IDs:** a HELLO whose player ID is already connected replaces that connection if it has sent nothing for 2 s; otherwise it's refused, as in roslambo (C-12).
- **Cost if wrong:** low.

**D-22 — Practice runs on a local transport.**
- **Choice:**
  - Practice builds the same timeline over a local transport, with the browser hosting every bot, and never constructs a Trystero room. So it contacts no one (L158, L238), which an end-to-end request guard checks.
  - Its clock can stop and re-anchor, which is how it pauses (Q-15).
  - With no other voters, it trusts its own state, as roslambo's lone peer does.
- **Rejected:** a networked room with bots, as roslambo's practice is. That contacts the relays.
- **Cost if wrong:** none.

### Client

**D-23 — A startup canary (roslambo D-17).** A scripted 8-terrier run with pushes, bounces, pounces, tumbles and a goal; its hash is in `goldens.json`. A browser that computes differently gets no match.

**D-24 — localStorage, and one game tab (roslambo D-18).**
- **Choice:** the profile (player ID, name, coat, which inputs have finished their control hints) and the settings, as one key each (Appendix A.3). An unreadable profile is backed up before a fresh one is made. One Web Lock covers the whole app, Practice and watching included, with roslambo's **Use here**.
- **Cost if wrong:** low.

**D-25 — Player ID (roslambo D-20).** `crypto.randomUUID()`, kept apart from Trystero's per-load `selfId` (L347).

**D-26 — three.js with its WebGL 2 renderer.**
- **Choice:**
  - three 0.187.0, pinned exactly (MIT). Only `src/render/**` imports it.
  - It already loads glTF and plays skeletal animations (GLTFLoader, `AnimationMixer`), so the model upgrade isn't a rewrite (L345).
- **Rejected:**
  - Raw WebGL 2: a hand-written glTF loader and skinning.
  - Babylon.js: a larger download, for nothing terriest needs.
  - WebGPU: excluded (L234).
- **Cost if wrong:** the renderer is a leaf behind the drawer interface, and C-9's audit check comes first, at M0.

**D-27 — One replaceable terrier drawer (L97, L345).**
- **Choice:** an interface that takes, per terrier and per frame, a pose (the interpolated, smoothed position and heading) and its animation state from D-9, the coat index and the pack. It returns its drawing counts. It never feeds anything back to the simulation.
- **Code-built drawer** (the MVP default):
  - rounded shapes (spheres and capsules) for the body, head, legs, ears and tail, with a bandana in the pack's colour and pattern;
  - drawn as one instanced mesh per part across all terriers, so draw calls don't grow with the terrier count;
  - coats as instance colours plus a markings index.
- **Model drawer:** GLTFLoader, a skeleton clone per terrier, and an `AnimationMixer` whose actions' times are set from the state every frame. The drawer keeps only blend weights.
  - Until a model loads, or if it fails, terriers are built in code (L100).
  - It ships in the MVP bundle, so the swap is production code. M0 measures what that costs to download.
- **The stand-in skinned model** (L252):
  - generated by a script, so no third-party licence is involved;
  - kept in `e2e/fixtures/`, never in `dist/`;
  - served by Playwright's request interception to the real built page, named through the pre-load test hook (roslambo's `window.roslamboTest`, as `window.terriestTest`).
- **Lint:** nothing in `src/core/**` imports three, `src/render/**` or `src/ui/**` (D-38).
- **Cost if wrong:** contained: the interface is one module, and the stand-in tests it before any model exists.

**D-28 — Cameras (L87–L92).**
- **Chase view:** behind and above the terrier, its yaw easing toward the heading with a 0.3 s time constant, at most 1 turn/s. The calmer camera uses 0.6 s and 0.5 turn/s. Steering doesn't depend on either (L87).
- **Ball view:** behind the terrier, aimed at the ball.
- **Players' cameras** stay inside the pitch (L89). A wall, the net or the ball between the camera and the terrier fades to see-through.
- **Spectators:** one camera high above one side of the pitch, outside the walls (L91), following the ball or the chosen terrier. The near wall and the net fade where they're in the way.
- **All cameras:**
  - when the ball is off screen, an arrow at the edge points to it;
  - are each viewer's own, and change nothing in the match.
- **Cost if wrong:** looks only.

**D-29 — Input devices, and anchoring.**
- **Keyboard:** roslambo's `event.code` handling, with keys released on blur. W, A, S and D give eight directions; Space jumps; Shift is zoomies; E pounces; Q barks; C switches the view. Ctrl is never used. Q-17 adds Escape, Enter and the arrows.
- **Touch:**
  - a stick on the left, with a 0.2 dead zone; pushing past its rim sets off zoomies;
  - jump and pounce buttons on the right, and smaller bark and view buttons;
  - each button tracks its own pointers, as roslambo's do;
  - mirrored in Settings, which flips the whole control layer and keeps the menu in a corner both layouts leave free.
- **Gamepad:** the standard mapping, polled every frame:
  - the left stick runs; the bottom face button jumps; the left face button pounces; the right trigger is zoomies; the top face button barks; the right shoulder switches the view;
  - Start presses Ready; Back opens the menu; the d-pad moves between buttons.
- **Anchoring:**
  - **Ball view** sends the ball frame.
  - **Chase view** sends the pitch frame, reading the camera's yaw when a direction starts from neutral, or when it moves 45° or more from the last read. A smaller move turns the kept direction by the same angle (C-24). Switching view re-reads the held direction.
- **Control hints:** for each kind of input, the first time it's used, until each control has been used once. The profile remembers them, and Settings offers "Show control hints again".
- **Cost if wrong:** controls only; no state or golden changes.

**D-30 — Screens, messages and the boot page.**
- **Screens:** roslambo's: one TypeScript module per screen, no framework (roslambo D-22).
- **Boot:** `index.html` shows a message by default, with a `noscript`, until the app has started, so the page is never blank (amorfus PLAN §8.2). The codes are amorfus's file://, insecure context and load timeout, plus "no WebGL 2". Each is tested in end-to-end runs that switch the feature off, and checked with axe.
- **WebGL 2 lost mid-match:**
  - the simulation and network keep running, so the terrier and its vote stay;
  - the pitch says "Graphics were lost; restoring", and the drawing is rebuilt on restore;
  - if the context isn't back within 5 s, the plain message shows with **Leave**, and the match goes on for the others.
  - If WebGL 2 is missing at load, the boot page's message stays: nothing in the app works without it.
- **Phones (L170):**
  - any coarse-pointer screen with a narrow portrait viewport is asked to turn sideways for Pre-match and Match, spectators included;
  - the layout respects the safe-area insets;
  - a screen wake lock is held during Pre-match and Match where the browser offers one.
- **Cost if wrong:** low.

**D-31 — Hidden tabs (roslambo D-23, as amended 2026-10-25).** The timeline runs on timers, not animation frames. A hidden page keeps sending, with nothing held, and only a page frozen for more than 2 s rejoins from a peer. Practice pauses instead (Q-15). Frame times are judged on a visible page.

**D-32 — Sound made in code.**
- **Choice:** Web Audio, started on the first user gesture:
  - barks: a filtered noise burst with a falling pitch, a little different per terrier;
  - the ball's bounces: a low thump, louder for harder hits;
  - pounces: a whoosh; tumbles: a thud;
  - a whistle at each kickoff and at the end;
  - a goal: a chorus of barks.

  No files, so the dist audit's allowlist is enough. Sound on or off in Settings. Everything sound tells also shows on screen (L103).
- **Cost if wrong:** low.

**D-33 — A render-quality setting.**
- **Choice:** in Settings, high or low. Low caps the pixel ratio at 1, turns MSAA off, and simplifies the effects (dust, net detail). It's a real player option, so no test mode changes what a page draws. The gate plays its matches at low, and counts the drawing budget at both settings.
- **Cost if wrong:** none.

### Build

**D-34 — The toolchain (roslambo D-24).** roslambo's pins (Appendix A.6), plus three. Playwright 1.64.1, whose browsers are already installed here.

**D-35 — Hosting (roslambo D-25).** Workers static assets, assets only, observability off. A `public/_headers` file, as amorfus's, marks the hashed assets immutable and sets its security headers; everything else is revalidated. Deploys need your go-ahead and Q-6's token.

**D-36 — The spike stays separate (roslambo D-26).** M0 lives in `research/spike/`, with its own `package.json`. Nothing in `src/` imports it; its findings go in `research/spike/REPORT.md`.

**D-37 — The gate tooling is hermet's (roslambo D-28).**
- **Choice:**
  - hermet mounted as the submodule `vendor/hermet`, at 18a37b2 until Q-3's fix is pushed.
  - terriest's own policy stays in `scripts/` and the configs:
    - `public-scan` reads `TERRIEST_PRIVATE_TERMS`;
    - the dist audit passes:
      - `ignoredHosts: ['stun']`;
      - `textFiles: ['_headers']` (D-35);
      - `loopbackFiles: ['boot.js']`, because the boot messages say how to serve the folder on localhost, as amorfus's do;
      - whatever C-9's check justifies;
    - the licence writer passes `product: 'terriest'`.
  - **Until Q-3's fix is pinned,** two shims keep terriest's gate right from M1:
    - `scripts/licenses.mjs` maps Vite's `identifier` and `text` onto the names hermet reads;
    - `scripts/audit-dist.mjs` fails any notice with no text.

    Both go when the pin moves.
  - The gate runs hermet's tests under terriest's own ESLint, ws and vitest. Never edit `vendor/hermet` in place.
- **Cost if wrong:** as roslambo.

**D-38 — Lint boundaries.**
- **Choice:**
  - exact-ops on `src/core/sim/**`, tests excluded;
  - no DOM, timers, storage or network globals in `src/core/**`;
  - nothing in `src/core/**` imports three, `src/render/**`, `src/ui/**`, `src/input/**` or `src/audio/**` (L252);
  - only `src/render/**` imports three;
  - only `src/net/trystero.ts` imports Trystero;
  - only `src/storage/**` touches storage;
  - amorfus's subpath bans: no root-absolute URLs, no History API.
- **Testing the lint:** a config test with fixture files proves each rule fires where it should, as roslambo's `scripts/eslint/config.test.mjs` does.
- **Cost if wrong:** none.

### Bots

**D-39 — Bots ride in their host's TICK (roslambo D-27), with a new brain.**
- **Choice:**
  - **From roslambo, unchanged:** a bot is an ordinary member of the roster; its ID is a version-8 UUID derived from its host's and its slot; its inputs ride in its host's TICK; its host votes once.
  - **New:** each bot gets a coat at random, seeded by its ID.
  - **The brain** runs only on the host, so it may use any maths. It reads the predicted state and sends the same input a person does, in the pitch frame (D-7): Q-9's roles, reaction delay and seeded noise; zoomies to reach the ball; a jump or a pounce when the ball is in reach and lined up with the goal; a bark now and then.
  - **In warm-up** it wanders; **in countdowns** it faces the ball.
- **Rejected:** bots inside the simulation, as for roslambo: exact operations everywhere, a rollback cost on every peer, and new goldens.
- **Cost if wrong:** the brain is one module with seeded tests, and its level is yours to accept (Q-9).

---

## 5. Evidence: what this plan rests on

**Read, 2026-11-14:**
- REQUIREMENTS.md at 6254a1d.
- roslambo at 3809d3a: PLAN.md in full; `src/` (the timeline, session, protocol, simulation, angle, hash, codec, bot, storage, UI and bench modules); research reports (lockstep, tuning, load, passive, relays, appearance); `docs/acceptance.md`; the end-to-end specs.
- amorfus at f4a272f: PLAN.md (sections 0–3, 8.2, 10.2, 13–15), `docs/`, its ID codec, its boot page and failure messages, its end-to-end guards.
- hermet at 18a37b2: every file.

**Measured or computed for this plan, 2026-11-14**, from local files only: two audit rounds of 13 agents, then a review of this plan's first draft. The methods and numbers are in [research/audit/REPORT.md](research/audit/REPORT.md). The probes' scratch code isn't kept, and M0 re-measures what the design rests on.
- WebGL 2 in headless Chromium 156, Firefox 157 and WebKit 27.2 on this machine: a context and a draw with readback in each, with no extra flags; throughput (C-6); `Math` bit-identity across the engines (D-1); missing WebGL 2 and a lost context can be produced in tests.
- hermet's licence bug, by rebuilding roslambo and amorfus from HEAD (C-8).
- roslambo's integrator on a floor, its fixed-order settling with unequal masses, and the event cap (C-3).
- The requirements' arithmetic, re-derived. These hold: the 7 s crossing, 0.4 s to run speed, the 0.9 s jump, 1.4 m under the crossbar, the half-speed level hit (3, 4.5 and 5 m/s), the latency figures in L341, and 36 pairs. These don't: the bowling examples (C-5), four abreast (C-18) and the pair count (C-2).
- The first draft's contact solver, modelled by the review: simultaneous hitters gained energy (C-3), which D-5 now avoids.
- The example match ID's check character (C-15).
- npm, read only: three 0.187.0 (MIT), `@trystero-p2p/nostr` 0.26.0, and the hermet submodule fetchable at 18a37b2.

**Not measured:** the contact solver, three.js's bundle and its audit, the phone, real networks, and every cost in this plan. M0 measures the first three on the desktop; the phone waits for M5 (Q-4).

---

## 6. Architecture overview

```
keyboard / touch / gamepad ──► anchoring ──► input (D-10) ──┐
                                                            ▼
peers ── TICK / FWD ─────────────────────────────► timeline ──► sim (pure) ──► final states ──► my vote ──► peers
          STATE ─────────────────────────────────►  ▲   ▲                           │
                                                    │   └── resync ◄── tally ◄──────┴──── votes from peers
renderer + terrier drawer ◄── predicted states ─────┘
sound, away marks, barks ◄── received inputs and state
score, celebration, results ◄── confirmed ticks
```

- **`src/core` is pure TypeScript:** no DOM, timers, storage or network. It runs in Node for tests and in the browser unchanged.
- **The simulation knows nothing of time or the network:** `step(state, finalInputs) → state`. The timeline owns time, prediction and rollback, as in roslambo.
- **The drawing knows nothing the simulation doesn't tell it:** it reads states and keeps only blends and smoothing offsets.

**Module map:**

```
src/config.ts           every setting (the Configuration table and Appendix A); the build hash covers it
src/core/sim/           math (binary angles, dir, datan2), bodies, pitch pieces, contacts, movement,
                        steering frames, rules, state codec, hash, goldens, canary            [exact-ops]
src/core/timeline/      from roslambo: input buffers, prediction, finalisation, rollback, votes, resync
src/core/protocol/      from roslambo: message codecs (§9), widened inputs
src/core/session/       from roslambo: handshake, roster events with packs, forwarding, keeper, bots,
                        the abandoned-match rule, the build hash
src/core/match-id.ts    from roslambo's round-id.ts (Q-2)
src/core/names.ts       from roslambo
src/core/bot/           bot IDs (from roslambo) and the bot brain (D-39)
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
third-party.json        relays and STUN: drives the runtime, the dist audit and §20
e2e/                    Playwright specs; fixtures/ (the stand-in model, recorded matches)
scripts/                gate wrappers, make-standin.mjs, emit-goldens (guarded)
vendor/hermet/          the submodule (D-37)
research/spike/         M0, throwaway (D-36)
docs/acceptance.md      devices, criteria, manual checks, the run log
```

Lint and the golden files depend on these paths, so the paths are part of the contract.

---

## 7. Deterministic simulation

### 7.1 State

Everything below is in the canonical state (Appendix A.1), and so in the hash. Spectators and the proposer, unless they play, are not.

- **Match:** phase and the tick it began, overtime, tick, pack size, match length, clock, score, the last goal (tick, pack, own goal).
- **The ball:** position and velocity (six float64), on-floor flag, last hit tick and strength, last contact tick.
- **Per terrier**, in (spot, pack) order:
  - **identity:** player ID, name, pack, spot, coat;
  - **lifecycle:** join tick, Ready-until tick, last tick with an input, the previous final input;
  - **body:** heading; position and velocity (six float64); flags (on the floor, sitting, lunging, zoomies locked out, ball overhead);
  - **timers:** zoomies meter, pounce wait, lunge, tumble and guard;
  - **counts:** touching the ball, touches, goals;
  - **animation:** the fields of D-9.

### 7.2 One tick, in order

1. **Events:** LEAVE, then JOIN and SWITCH in player-ID order, then READY and UNREADY (D-12). A warm-up arrival appears on a free spot.
2. **Presence:** record which browsers have a final input. Before the start countdown, remove players silent for 180 ticks. From the start countdown on, mark a terrier sitting after 60 silent ticks (D-16).
3. **Phase changes:**
   - Ready expiry (60 s);
   - the start countdown when both packs are full and every player is ready;
   - a countdown's end starts play;
   - a celebration's end starts a kickoff countdown, the overtime kickoff, or the end.

   At the start of each countdown, the kickoff placement (D-8).
4. **Inputs to intents:** resolve each direction in its frame (D-7); take new presses (D-10); apply what the phase allows (D-8).
5. **Physics:** 4 substeps (D-5), with touches and the goal test in each. The first goal of the tick counts; the ball is out of play from then on.
6. **The clock:** if the tick began in play, count down a tick. At 0, the end or the overtime kickoff (D-8).
7. **Animation fields** (D-9).

### 7.3 Contacts, in brief

- **Body against body:** two spheres, normal along the line between centres.
- **Body against a piece:** the closest point on the piece; a capsule's closest point on its segment.
- **Order:** bodies interleaved by spot across packs, then the ball; pieces in list order, each paired with its mirror image. Arrays only; no `Map` or `Set` iteration in `src/core/sim`.
- **Impulses, the floor, positions and slip-out:** D-5.

### 7.4 Configuration checks (unit tests on `src/config.ts`)

- No tunnelling (D-3): the fastest body moves less than the smallest radius in a substep, and the fastest pair closes less than the smallest radius sum.
- The late window and the vote window fit in the state history.
- The kickoff spots are inside the pitch, apart from each other, and mirrored for every pack size.
- The goal mouth leaves the ball room under the crossbar (L306).
- Every setting from the Configuration table is in `src/config.ts`, and nowhere else.

---

## 8. Timeline, networking and consensus

roslambo's §8 applies, with these changes.

**Roles in a room:** keeper, undecided (on the Join screen, connected, choosing), player, candidate and spectator. Settler and witness go: terriest keeps no results.

**A match's life:**
1. **Propose.** As roslambo: the genesis state (pack size, match length, tick 0), the keeper, and `#join=<match ID>`.
2. **Join.** The browser connects as undecided, syncs, and shows the packs with free places, suggesting the smaller (the first on a tie). Play sends JOIN with the pack; Watch stays a spectator.
3. **Warm-up, Ready, start countdown, play, celebrations, kickoffs:** computed in the state (§7.2).
4. **The end.** At the confirmed end (D-14), every peer shows the results.
5. **Play again:** D-12.

**Per-tick loop:** roslambo §8.3, with re-simulation from the earliest changed tick (D-11). A spectator hosting bots sends their inputs, as in roslambo.

**Practice:** the same loop over the local transport (D-22), with the clock able to pause.

**The mesh:** at most 8 browsers that play and 4 spectators (L244), enforced as D-21 says. Forwarding as roslambo D-14. With no connection after 20 s, the connection-failure message shows.

**Properties, each tested (§16):** roslambo's P1–P5 and P7, plus:

| | Property |
|---|---|
| P8 | A mirrored kickoff gives a point-mirrored state, bit for bit, at every pack size. |
| P9 | A goal shows on every peer's scoreboard, once, at its confirmed tick. |
| P10 | Practice sends nothing over any network. |
| P11 | Drawing never changes the state's hash. |

---

## 9. Message protocol

roslambo's §9 applies: one Trystero action, `[u8 type][payload]`, little-endian, 16,000 bytes at most, decoders that never throw, the HELLO and verdict handshake, and the REFUSE reasons. These change:

- **HELLO:** the role byte is 1 keeper, 2 player or candidate, 3 spectator, 4 undecided. The timeline kind "saved" goes, and so does "holds a result".
- **REFUSE:** reasons 1–4 as roslambo, with 4 now counted by D-21.
- **TICK:**
  - the input is a u16 (Appendix A.2), in a flags byte that also marks a TICK with no input of the sender's own (a spectator hosting bots);
  - the history is a u16 presence mask, a u16 mask of "same as the next newer", then the u16 inputs that differ;
  - bot entries carry the same.
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

---

## 10. Persistence

- **Engine:** localStorage (D-24). Keys and shapes are in Appendix A.3.
- **Profile:** player ID, display name, coat (a random one on the first visit, stored at once), and which inputs have finished their hints.
- **Settings:** extra relays and one TURN server (as roslambo); names over terriers; start in ball view; calmer camera; mirrored touch layout; sound; render quality.
- **One tab:** a Web Lock named `terriest-game`, with **Use here** (D-24).
- **Bad data:** an unreadable profile is copied to a backup key before a fresh one is made. A failed write loses that write only, and Home says so.
- **Not stored:** anything about matches. Nothing lasts (L216).
- **Safari:** C-14.

---

## 11. Screens and input

**Navigation:** roslambo's state machine. While in a match the URL fragment is `#join=<match ID>`, so a reload returns to it; Home clears it. No History API.

| Screen | Contents |
|---|---|
| Home | Display name, editable (20 characters, 32 bytes); coat, from the fixed list; **Propose a match**; **Join** with a code field; **Practice**; **Settings**. Opening a `#join=` link skips it. |
| Propose | Pack size (1–4, default 2) and match length (1–10 minutes, default 3). **Create** shows the link (copy, and share where available) and the code in groups of four, with "Keep this page open until someone joins". Then **Play** (with a pack), **Watch** and **Leave**, at once (as roslambo, as amended). |
| Practice | Pack size and match length, then Pre-match. |
| Join | The packs, with free places and who's in them; **Play** in a pack (the smaller suggested); **Watch**. A returning player skips it (D-17). |
| Pre-match | The pitch with terriers warming up; each pack's list with name, coat and Ready; **Ready**; **Switch pack**; **Add a bot** and **Remove a bot** for each pack, for players and spectators; **Leave**; "Invite" (link and code); the stick and buttons on touch; the start countdown over the pitch. |
| Match | The pitch; the score, each pack's in its colour and pattern, your pack marked; the clock, showing overtime; the countdown before each kickoff; the scorer's name after a goal; away marks. Players: zoomies meter and pounce wait; the stick and buttons on touch. Spectators: a choice of what to follow, by tapping a name or with the view key or shoulder buttons. A menu button: **Settings**, **Leave**, and in Practice **Pause** and **Resume**. |
| Results | The final score, each terrier's goals (a shared goal counts for each sharer, as the screen says) and touches, the Terriest; **Play again**; **Home**. |
| Settings | Extra relays and your own TURN server; names over the terriers (off); start in ball view (on); a calmer camera (off, unless the system asks for reduced motion); mirrored touch layout (off); sound (on); render quality (high; whether phones start at low waits for their measurements); "Show control hints again". Everything but relays and TURN applies at once; those two apply from the next match. |
| Messages | The boot failures (D-30); graphics lost; canary failure; a build mismatch; the connection failure (roslambo's wording); "This match is full, so you're watching it"; "The players have left" (Q-16); spectators full. |

**Input:** D-29. **Sideways phones:** D-30. On a phone held sideways, the stick and buttons sit over the pitch (L170).

---

## 12. Rendering and the look

**The scene:**
- **The pitch:** grass with a procedural texture made at run time; each half and its goal in the colour and pattern of the pack that defends it (L68); the halfway line and centre spot; padded walls; cut corners; a rope net overhead.
- **Shadows:** a blob under each terrier and the ball, which is cheap and reads well from above.
- **Fading:** walls and the net fade to see-through when between the camera and your terrier (D-28).

**The ball:**
- glossy rubber;
- squashed and thumped by its last hit's strength, from the state (D-9);
- turned as if rolling, from its drawn motion: drawing only (§2).

**Terriers:** D-27.
- **Animations** (L98): standing, running at any speed, zoomies, turning, pushing, being pushed or bounced, jumping and landing, pouncing, tumbling and getting up, barking, sitting, celebrating. Each is read from the state (D-9) and timed by its start tick.
- **Overlays:** barking plays over any animation, and celebrating over standing and running; the rest blend.
- **In place:** only the simulation moves or turns a terrier.

**Effects:** dust behind zoomies; a tumbled terrier rolling over and shaking itself off; the net bulging at a goal; a bark mark over a barking terrier, for anyone with the sound off.

**Each frame:** the predicted state one tick behind the newest, interpolated by the tick's fraction (roslambo's `interpolate.ts`, in 3D), plus D-16's correction offsets.

**Your terrier** is marked in a way colour isn't needed to see; names show over the others if Settings says so.

**Colours:** each coat is a fur colour and markings, defined apart from drawing, and stored and sent as its index in the list (L44). A palette test, as roslambo's, checks each coat against both packs' colours and against the grass, under simulated protanopia, deuteranopia and tritanopia. The packs differ in pattern as well as colour (L43).

**The drawing budget (L243):**
- **What's counted, per terrier:** triangles, bones and texture size; draw calls for 8 terriers; download size for each way of drawing them.
- **How:** counted in the real page through three's `renderer.info` and the drawer's own counts, at both render-quality settings. The gate fails a page over budget.
- **The figures:** provisional, from M0's desktop measurements, until the Pixel 8a run at M5 (Q-4).
- **Starting guesses** (*estimates*, for M0 to replace):
  - a code-built terrier, 2,000 triangles;
  - a model, 8,000 triangles, 32 bones and a 512 × 512 texture;
  - all 8 terriers, 40 draw calls;
  - each way of drawing them, 200 KB compressed.

**Render-only maths** may use `Math.sin` and the rest; the exact-ops rule applies only to `src/core/sim`.

**The look (Q-11):** placeholders until M4.
- **The look book:** a dev page served by Vite (`dev/look-book.html`) that replays matches recorded from the tuning page and the bots through the drawer interface, with several sample looks side by side.
- **Your pick:** terriers and coats, pack colours and patterns, the ball and the pitch.
- **A look of its own:** no name, term or look comes from the game in the pitch line (L15). The samples are made to that rule, and the screens' wording is checked against it.
- **Again for models:** the same page runs again for the models later.

**The model upgrade, later (L97, L345):**
- **The models** load through the model drawer of D-27. Nothing in play, the simulation or the network changes.
- **hermet's audit:** it first needs an option that allows `.glb`, reads each model's JSON, and fails any `uri` that names a host or an unshipped file. Draco or KTX2 compression also needs its decoder's `.wasm` allowed.
- **Licences:** a bought model's licence must allow redistribution of the file as shipped, as CC0 and CC BY do. Its notice goes in through the licence writer's `extra` entries and the expected list.
- **Budget:** the same counts apply. M0's stand-in already measures what a skinned model costs on this machine.

---

## 13. Sound

D-32. One `AudioContext`, created on the first user gesture and resumed when the page is shown again. A master gain follows Settings. Remote barks come from received inputs only (D-16). A goal's chorus and whistle wait for the confirmed tick, with the score (D-14).

---

## 14. Bots

D-39, with roslambo's hosting:
- players and spectators add bots to either pack before the start countdown, one at a time, up to the pack size;
- **Remove a bot** takes this browser's newest bot in that pack;
- a host that leaves before the countdown takes its bots out;
- bots sit while their host is away, and a host that comes back takes them back;
- **Play again** brings a host's bots into the next match, in their packs.

---

## 15. Build tooling and hosting

**npm scripts:**

| Script | Does |
|---|---|
| `dev` | Vite dev server, including `dev/tuning.html` and `dev/look-book.html` |
| `dev:local` | the dev server plus hermet's local Nostr relay, so desktop browsers can play each other by hand without the public relays (dev only; production never uses it) |
| `lint` | ESLint, including D-38's boundaries |
| `typecheck` | `tsc --noEmit` |
| `test` | vitest, including `vendor/hermet`'s tests |
| `build` | `typecheck && vite build && node scripts/licenses.mjs && node scripts/audit-dist.mjs` |
| `e2e` | Playwright: Chromium, Firefox and WebKit, against the built page and the local relay |
| `public-scan` | tracked files contain no home paths, keys or private terms |
| `check` | `lint && public-scan && typecheck && test && build && e2e`: the gate |
| `deploy` | `check && wrangler deploy`, refusing without `CLOUDFLARE_API_TOKEN` (Q-6) |
| `emit-goldens` | rewrites the golden hashes; refuses unless `TERRIEST_EMIT_GOLDENS=1` |

**Vite:**
- `base: './'`, `build.target: 'es2022'`, no source maps, and `build.license.fileName: '.license-npm.json'` for hermet's licence writer;
- `dev/` is excluded from the build;
- three is imported per module, so unused parts are dropped.

**Dist audit:** hermet's, through `scripts/audit-dist.mjs` (D-37). Shipped files stay inside its allowlist (`.html .css .js .txt .ico .png .svg .webmanifest`):
- textures are procedural, or PNG or SVG;
- fonts are the system's;
- sound is made in code;
- data is imported into the bundle.

**Licences:** hermet's writer through terriest's wrapper, with D-37's shim until Q-3's fix is pinned. `scripts/expected-licenses.json` lists Trystero's two packages, `@noble/secp256k1` and three.

**wrangler.jsonc:** assets only, `./dist`, observability off, `workers_dev` until Q-5 (Appendix A.7). A test checks it, as roslambo's does.

**CI:**
- **The workflow:** roslambo's `check.yml`: a checkout with submodules, `npm ci`, the Playwright browsers, `npm run check`, plus the unit suite on arm64 for the goldens.
- **The gate:** it asserts WebGL 2 in each engine before playing anything (C-6).
- **What it needs:** Actions enabled on `gargantis/terriest`, and a push, which waits for your ask.

**Repo files at M1:**
- `.gitignore`, `.npmrc` (`legacy-peer-deps`) and `.nvmrc` (22), as roslambo;
- `third-party.json`;
- `CLAUDE.md`, with roslambo's contracts plus terriest's: the simulation never imports drawing code; drawing reads animations from the state and keeps only blends; coats and bandanas go by list index; the stand-in model stays out of `dist/`; new behaviour needs a test through the real page;
- the README (run, test, build, deploy, privacy, licence);
- no LICENSE file, if Q-1 holds.

---

## 16. Tests and the gate

**The gate:** `npm run check`. It passes at the end of every milestone from M1, and before any deploy. It's never weakened to make a build pass.

**Simulation (vitest, fast-check):**
- A resting ball's and a standing terrier's state stays bit-identical for 10 minutes of ticks.
- A bounce above the threshold keeps 70% (ball against surfaces) or 50% (terrier against ball) of its normal speed, within 1%; below it, contacts settle.
- **Simultaneous hits:** k = 1 to 4 terriers hit a resting ball at once. Momentum is conserved, no kinetic energy is gained, and the ball leaves faster as k grows.
- A rolling ball slows by exactly the configured rate and stops exactly.
- With the rolling slowdown, one pusher brings the ball to 95% of run speed in 1.2 s ± 10%, and four in a line in 0.6 s ± 10%.
- A squeezed ball is down within 0.5 s; two sitting terriers can't hold it up; a kickoff pinch, its fall and the slip-out land mirrored, for each pack size.
- A mirrored kickoff gives a bit-exact point-mirrored state at every pack size (P8).
- No tunnelling at 25 m/s; the ball never leaves the pitch or sits wholly behind a goal line outside the goal (fuzzed).
- **Movement:**
  - run speed, acceleration and turn rate;
  - zoomies, the meter and its lockout;
  - jump height and airtime;
  - pounce distance, its end on contact, and its wait;
  - tumbles, get-up and guard;
  - idle terriers can be pushed.
- **Steering:** all three frames resolve as D-7 says, including the ball overhead and its hysteresis; `datan2` against `Math.atan2`.
- **Presses:** a press acts once, a predicted input never repeats one, and a tap shorter than a tick still counts (D-10). The bark bits never reach the state's hash.
- **Rules:**
  - what each phase allows;
  - kickoff placement and resets;
  - touches per episode and the re-arm gap;
  - goal tests at the posts, the crossbar and the netting;
  - credit and own goals, shared credit, a goal in the tick that brings the clock to 0;
  - the clock stopping, overtime, the end;
  - the Terriest and its ties;
  - Q-8's bowling rule and its exceptions.
- The same events in any arrival order give the same state (P4).

**Determinism:**
- Golden hashes at checkpoints for scripted runs: each pack size, kickoffs, goals, overtime, all three steering frames, a mirrored kickoff, a resting ball, a squeeze, pounces and tumbles, joins and leaves.
- Checked in Node, and in Chromium, Firefox and WebKit through the production bundle's `#test=determinism` page; also on arm64 in CI.
- The canary is one of them. A changed golden fails until `emit-goldens` is run deliberately.

**Timeline and consensus (simulated network):** roslambo's loopback tests and properties P1–P5 and P7, adapted for packs; plus:
- P9 (a goal on every scoreboard, once, at its confirmed tick);
- a pack's last place taken by two JOINs in one tick;
- a Play-again race; the abandoned-match rule;
- a returning player skipping Join;
- spectator counting (C-11); a duplicate ID replacing a silent connection (C-12);
- a late input re-simulating only from its tick, agreeing with a full replay.

**Protocol, match ID, storage:** every message round-trips and fuzzing never makes a decoder throw. roslambo's match-ID tests are ported, plus the documented example. The profile and settings schema, recovery from bad data, and the tab lock.

**Rendering, input and sound (vitest):**
- interpolation and smoothing maths; drawing leaves the state's hash unchanged (P11); the palette;
- the cameras: a player's stays inside the pitch, occluders fade, and the arrow points to an off-screen ball;
- anchoring: chase view re-reads the screen only from neutral or at 45° (Q-19);
- remote barks play only from received inputs, never predicted ones (D-16), and the sender keeps to one a second (L327).

**Bots:** seeded games reach their pass marks (Q-9); mirrored bots diverge; a host's bots in its TICK, one vote per host, and a host that reloads takes them back, as in roslambo.

**End to end** (Playwright, the built page, the local relay on 127.0.0.1, no public hosts):
- **A full match through the screens and real controls**, one browser per engine: Chromium proposes, Firefox joins by link and WebKit by typed code. They fill both packs with bots, mark Ready, and play scripted keyboard input to the end. Every page shows the same results. The terriers move, the ball moves, and a goal reaches every scoreboard (L344).
- **A spectator joining mid-match** sees the same state. **A reload mid-match** takes the terrier back.
- **Touch** in Chromium's emulation, through the DevTools protocol: the stick, its rim for zoomies, two buttons held at once. **A gamepad** through a stubbed `navigator.getGamepads` in all three engines.
- **Practice** plays a whole match against bots, and the request guard sees no contact with anything (L238, L283, P10). Its pause stops the clock and play, and resumes them (Q-15).
- **Pre-match and Results without a mouse:** their buttons are pressed from the keyboard and a stubbed gamepad (L82, Q-17).
- **The stand-in skinned model**, served by interception, plays a match in place of the code-built terriers, and its budget counts are checked (L252).
- **Boot failures:** no WebGL 2 (Chromium `--disable-webgl2`, Firefox's pref, a WebKit init script), an insecure context, and a lost context mid-match. Each shows its message and is checked with axe.
- **The site served from a subpath**, with every request staying under it (L232).
- **A build mismatch** is refused with its message.
- **Everywhere:** no request outside `third-party.json`, and no console errors.

**By hand, for now** (you, on your desktop; logged in `docs/acceptance.md`):
- **M0:** the spike's scene page in Chrome, Edge and Firefox on Windows (`http://localhost:<port>`, through WSL2's forwarding): its frame verdict on your GPU. Also on the Pixel 8a, if Q-4 gives it a route.
- **M2:** the tuning page: the feel and the values (Q-10).
- **M4:** Practice in each desktop browser with the keyboard, and a gamepad if you have one. A match between your three desktop browsers through `npm run dev:local`. The frame bench on your GPU. The look book (Q-11).
- **M5:** the deployed site, in desktop browsers and on the phone (Q-4).

**Outside the gate** (logged in `docs/acceptance.md`):
- the 12-page load run (8 that play, 4 spectators);
- the frame bench at the Pixel 8a's size in throttled Chromium;
- the Pixel 8a runs, at M5: the frame criteria and real touch;
- the relay check, with your go-ahead;
- real Safari, if a device turns up (Q-12).

---

## 17. Milestones

- **Order:** each milestone retires the riskiest remaining unknown. No calendar estimates; they would be guesses.
- **Gate:** from M1, every milestone ends with `npm run check` green.
- **External actions** (push, deploy, the relay check, hermet's push) wait for your go-ahead.

**M0 — Physics and rendering spike (throwaway)**
- *Prerequisites:* none beyond this machine. Node 22 and Playwright's three browsers are installed.
- *Build,* in `research/spike/` (D-36):
  - the exact numerics: roslambo's angles, plus `datan2`;
  - D-4 to D-6's bodies, pitch and solver: floor support, simultaneous impulses, restitution threshold, slip-out, the goal test;
  - a three.js page: the pitch, the ball and 8 code-built terriers moved by the spike's simulation from scripted inputs, plus the stand-in skinned model and GLTFLoader;
  - a production build of that page, run through hermet's dist audit with no exceptions.
- *Runs:*
  1. **Engine goldens:** Node, Chromium, Firefox and WebKit run the same scripted contact-heavy runs and compare hashes. These are kickoffs at every pack size, resting and rolling balls, pushes by one to four terriers, squeezes and pinches, pounces, goals, and long runs.
  2. **Contact behaviour:** a resting ball stays bit-still; bounces keep their fractions; one to four terriers hitting the ball at once gain no energy; push times; slip-out; mirrored kickoffs are bit-exact.
  3. **Cost:** tick cost with a 13-step replay every tick, on the desktop and in throttled Chromium at the Pixel 8a's size.
  4. **The page in all three headless engines at once:** frame-rate independence; draw counts and download sizes for both drawers.
  5. **The audit:** every finding classified (C-9).
  6. **By hand:** you open the page in Chrome, Edge and Firefox on Windows, and on the Pixel 8a if Q-4 gives it a route, and read off the frame verdict.
- *Questions answered,* each with a number in `research/spike/REPORT.md`:
  - determinism, pass or fail per engine;
  - whether resting contact is bit-still;
  - the push times;
  - whether a mirrored kickoff stays mirrored;
  - tick cost per step and per tick;
  - frame time on your desktop GPU;
  - the provisional drawing budget;
  - what three.js and GLTFLoader cost to download;
  - what the audit found.
- *Stop rule:* if any engine mismatches in run 1, a resting ball can't be held bit-still, or simultaneous hitters gain energy, stop and revisit D-1, D-2 or D-5 before M1.
- *Exit:* the report is committed. D-2 to D-6, D-26, D-27 and the budget are confirmed or amended in this plan, each amendment citing the measurement behind it.

**M1 — Skeleton and gate**
- *Build:*
  - Vite, TypeScript, ESLint (D-38), vitest and Playwright (three engines);
  - `vendor/hermet` at 18a37b2 and its wrappers, with D-37's licence shims;
  - `src/config.ts` with every setting and the §7.4 checks;
  - the match-ID module (Q-2);
  - the boot page and its failure messages (D-30);
  - a three.js page drawing the empty pitch;
  - `third-party.json`; `wrangler.jsonc` and its test; CI;
  - `CLAUDE.md`; the README skeleton; no LICENSE (Q-1).
  - On a hermet branch: the licence-writer fix and its test, and the docs naming terriest (Q-3).
- *Exit:* `npm install && npm run build` emits `dist/`; `npm run check` is green locally, and in CI once pushed.

**M2 — Simulation core, tuning and the bot brain**
- *Build:*
  - `src/core/sim` in full (§7): the state codec and hash, the goldens and the cross-engine determinism test, the canary;
  - `dev/tuning.html`: the real simulation drawn top-down and from the side, sliders for every setting, scripted terriers, and one keyboard terrier;
  - the bot brain, run against the simulation offline.
- *Exit:*
  - every simulation test and golden is green in Node and all three engines;
  - the bots reach their pass marks;
  - you've tuned the values on the tuning page, and they're recorded in the Configuration table (Q-10).

**M3 — Timeline, networking, consensus and Practice**
- *Build:*
  - `src/core/timeline`, `protocol` and `session`, from roslambo (§8, §9), with packs, the widened inputs and D-21;
  - `src/net`: the loopback transport, the Trystero transport, forwarding, the local transport;
  - bot hosting;
  - the network simulator tests;
  - the `#test=net` page, as roslambo's, for matches before the screens exist;
  - an end-to-end scripted match over the local relay, through that page.
- *Exit:*
  - P1–P5 and P7–P10 are green;
  - the end-to-end match is green;
  - Practice contacts nothing;
  - the 12-page load run is logged.

**M4 — Rendering, input, screens and sound**
- *Build:*
  - the scene, the code-built drawer and the model drawer, and the animation states (§12);
  - correction smoothing, measured first (D-16);
  - the cameras;
  - keyboard, touch and gamepad input, with anchoring and hints;
  - every screen and message (§11);
  - Settings and the profile;
  - sound;
  - the frame-time bench (`#test=frames`) and the look book;
  - `docs/acceptance.md`, with roslambo's frame-time criteria copied (L286).
- *Exit:*
  - a full match is playable by link and by code over the local relay, through every screen;
  - the stand-in model plays a match in the gate;
  - your desktop checks pass;
  - you've picked the look (Q-11).

**M5 — Acceptance and release**
- *Prerequisites:* Q-4's devices; Q-5 and Q-6 before the deploy; the relay-check go-ahead.
- *Build:* the README in full; Q-3's fix taken, if pushed; the relay check and any swap (Q-14).
- *Release:*
  - `npm run check`;
  - deploy, with your go-ahead;
  - the acceptance runs on the deployed site: three devices, one of them the Pixel 8a, by link and by code, playing to the end;
  - the Pixel 8a's frame-time run, at 60 Hz;
  - real touch on the phone;
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
| Simultaneous contacts | D-5: simultaneous impulses, mirror-paired order; P8 |
| Resting and rolling contact | D-5: floor as support, the restitution threshold; M0; C-3 |
| A ball on terriers | D-5's slip-out rule; its tests |
| A shared, contested ball | D-16's smoothing; d and w from roslambo, measured again at M3 and M5 |
| A giant ball forgives some latency | Kept as the reason smoothing is enough; D-16 |
| Cost on the phone | C-2; D-11's replay from the earliest change; D-10's 32-step stick; M0's measurements; the Pixel 8a at M5 |
| Mesh and networks | C-1; D-19; the relay check before the first deploy (Q-14) |
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
| The ball: mass, hits, pushes, lift, bounces, no spin, never leaves | D-4, D-5 | solver tests; fuzz test |
| The pitch: walls, net, cut corners, goals, colours; shape-independent | D-4, §12 | pitch tests with a second shape |
| Six controls; anchored steering; scheme changeable | D-7, D-29 | steering tests in three frames; goldens |
| Keyboard, touch, gamepad; held together; menus; hints | D-29, Q-17 | end-to-end; by hand on the desktop; the phone at M5 |
| Cameras; see-through; ball arrow; spectators | D-28 | camera tests; by hand |
| A game of its own: no names, terms or look from the pitch line's game | §12, Q-11 | the look-book review; the screens' wording |
| Look and sound; animations; model swap | §12, §13, D-27, D-32 | look book; stand-in model in the gate |
| Scoring, credit, celebration, clock, overtime, Terriest | D-8, D-14 | rules tests; P9 |
| Kickoff spots and countdowns | D-8, A.5 | rules tests; P8 |
| Proposing, joining, packs, Ready, warm-up, bots | D-12, D-39, §8 | network tests; end-to-end |
| End of match, Play again | D-12, D-14 | network tests; end-to-end |
| Practice | D-22, Q-15 | end-to-end with the request guard |
| Screens; phones sideways | §11, D-30 | end-to-end; by hand |
| Trystero, relays, STUN, TURN | D-18 | room-config test; dist audit |
| Match ID | §6, Q-2 | ported tests |
| Simulation and consensus; smoothing; barks | D-11 to D-16 | P1–P5, P7, P9, P11 |
| Disconnects, returns, abandoned matches | D-16, D-17, Q-16 | network tests; end-to-end reload |
| Persistence; one tab | §10, D-24 | storage tests; end-to-end |
| Platform: static, Workers, relative paths, WebGL 2, its loss, browsers, no third party before joining | D-30, D-34, D-35, D-38 | build; subpath test; boot-failure tests; request guard |
| 60 fps; drawing budget; 8 terriers and 4 spectators | C-2, §12, §16 | budget counts in the gate; by hand on the desktop; the Pixel 8a at M5; load run |
| Quality: README, tests, determinism, real-page tests, the stand-in model, hermet, no secrets | §15, §16, D-37, D-38 | the gate |
| Acceptance lines | §17 M5 | `docs/acceptance.md` |

---

## 20. Third parties

**Runtime.** Contacted only after Propose or Join (counting the opening of a `#join=` link), except hosting. Practice contacts none.

| Party | Role | Sees |
|---|---|---|
| relay.damus.io, relay.primal.net, nos.lol, relay.snort.social, nostr-pub.wellorder.net, yabu.me/v2 | Nostr signalling | IP, Origin, User-Agent, timing, a hashed room topic, a per-load Nostr key and Trystero peer ID, encrypted session-description sizes |
| Relays added in Settings | Nostr signalling | as above |
| stun.cloudflare.com, stun.l.google.com | STUN | IP and port |
| The user's TURN server, if any | relay for blocked pairs | IP, traffic volume |
| Other peers in the match | the game | your IP address, player ID, name, coat and inputs |
| Cloudflare | hosting | HTTP requests, never the `#join=` fragment; logs off |

**Build and test:** the npm registry, Playwright's browser downloads, GitHub Actions.

**Bundled:** `@trystero-p2p/core` and `@trystero-p2p/nostr`, with `@noble/secp256k1`, and three, all MIT. Their notices ship in `dist/THIRD-PARTY-LICENSES.txt`, with their texts once C-8 is fixed.

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

*Provisional; M2 fixes it with the first goldens.*

```
u16  codec version = 1
u8   phase: 0 warm-up, 1 start countdown, 2 kickoff countdown, 3 in play, 4 celebration, 5 ended
u32  phase start tick
u8   overtime: 0 or 1
u32  tick
u8   pack size (1–4)
u32  match length (ticks)
u32  clock (ticks left; in overtime, ticks since it began)
u8   score A, u8 score B
u32  last goal tick (0xFFFFFFFF: none), u8 last goal pack, u8 own goal
ball:
     f64     x, y, z, vx, vy, vz
     u8      on the floor
     u32     last hit tick, f64 last hit strength
     u32     last contact tick
u8   n
n × terrier, in (spot, pack) order:
     u8[16]  player ID (a bot's derived from its host's)
     u8+n    display name (UTF-8, ≤ 32 bytes)
     u8      pack, u8 spot, u8 coat
     u32     join tick, u32 ready until (0: not ready), u32 last tick with an input
     u16     previous final input, with the bark bits cleared
     u32     heading (binary angle)
     f64     x, y, z, vx, vy, vz
     u8      flags: on the floor, sitting, lunging, zoomies locked out, ball overhead
     u16     zoomies meter, pounce wait, lunge, tumble, guard (ticks)
     u8      touching the ball
     u16     touches, u8 goals
     u8      animation phase, u32 its start tick
     u32     gait (binary angle)
     u32     take-off tick, u32 landing tick
     u32     last ball contact tick, u32 last terrier contact tick
     u32     last push received: direction (binary angle) and tick
     i32     heading change this tick
```

About 175 bytes per terrier, about 1.5 KB for 8 (*estimate*). The hash is roslambo's: MurmurHash3 x86-32 with seeds 0 and 0x9747B28C, 8 bytes, compared as an unsigned big-endian number.

### A.2 Input (u16)

| Bits | Field |
|---|---|
| 0–4 | direction step, 0–31, counter-clockwise from the frame's forward |
| 5 | a direction is held |
| 6–7 | frame: 0 pitch, 1 ball line, 2 nose |
| 8 | zoomies held |
| 9–10 | jump press counter |
| 11–12 | pounce press counter |
| 13–14 | bark press counter (not read by the simulation) |
| 15 | 0 |

### A.3 Storage (localStorage)

| Key | Value (JSON) |
|---|---|
| `terriest.v1.profile` | `{ v: 1, playerId, name, coat, hints: { keyboard, touch, gamepad } }` |
| `terriest.v1.profile.backup` | the last unreadable profile, verbatim |
| `terriest.v1.settings` | `{ v: 1, relays: [url], turn: [{ urls, username, credential }], names, ballView, calmCamera, mirrorTouch, sound, quality }` |

### A.4 Implementation constants (*provisional*)

| Constant | Value |
|---|---|
| Tick rate, substeps | 60 a second, 4 a tick |
| Input delay d, late window w, vote window v | 2, 12, 12 ticks (roslambo) |
| State history, input history per TICK | 256 ticks, 16 ticks (roslambo's code) |
| Solver iterations (forward and back sweeps over mirror pairs), position passes | 8, 2 |
| Restitution threshold | 0.3 m/s |
| Slip-out | normals within 45° of vertical; 2 m/s sideways |
| Ball overhead | enter under 0.3 m, leave above 0.4 m (horizontal centre distance) |
| Stick | 32 steps, half-step hysteresis, 0.2 dead zone; chase view re-reads at 45° |
| Smoothing | 100 ms; 50 ms for your own terrier |
| Removal before the start countdown | 180 silent ticks (roslambo Q-15) |
| Sitting in play | 60 silent ticks |
| Abandoned match | 30 s with no browser that plays (Q-16) |
| A duplicate ID replaces a connection | silent for 2 s |
| Handshake timeout, connection-failure message | 10 s, 20 s |
| Largest message, `maxReceiveBytes` | 16,000 bytes, 1 MiB until M3 measures |
| Mesh cap | 8 browsers that play, 4 spectators |
| Display name | 20 characters, 32 bytes |

### A.5 Gameplay values (the Configuration table; *starting values* for the TBDs and new settings, chosen at M2)

| Setting | Value |
|---|---|
| Pitch, goal mouth, ball, run, acceleration, turn rate, zoomies, meter, jump, gravity, pounce, bowling speed, tumble, bark, countdowns, celebration, ready expiry | as REQUIREMENTS' Configuration table (celebration: 3 s seen, Q-7) |
| Kickoff spots, pack A (pack B is the point mirror) | 1 a side: (−10, 0). 2: (−9, ±4). 3: (−9, ±5), (−15, 0). 4: (−8, ±6), (−14, ±3). Everyone faces the ball |
| Ball rolling slowdown | 0.5 m/s² on the floor, to exactly 0; no air drag. A 3 m/s ball rolls 9 m |
| Terrier bounce | 0.3 off terriers and walls |
| Goal netting bounce | 0.3; walls, overhead net and goal frame 0.7 |
| Re-arm gap | 0.6 m surface to surface |
| Chase view swing | 0.3 s time constant, at most 1 turn/s; calmer camera 0.6 s and 0.5 turn/s |
| Tumble guard | 1.5 s |
| Terrier collider | sphere, radius 0.25 m, mass 1 (ball 2) |
| Idle friction | 8 m/s² |
| Get-up | the last 0.5 s of the 1.5 s tumble |
| Nose turn rate (vehicle-style) | 1 turn/s; reverse at up to 3 m/s |
| Posts and crossbar | capsules, radius 0.1 m |

### A.6 Toolchain pins

roslambo's (its PLAN A.6, checked 2026-10-24), re-checked at M1: Node ≥ 22.12 (`.nvmrc` 22), vite ^8.3, typescript ~6.0, eslint ^10 with typescript-eslint ^8.72, vitest ^4.1, fast-check ^4.10, `@playwright/test` 1.64.1 exact, wrangler ^4.152, `@trystero-p2p/nostr` 0.26.0 exact, ws ^8 (dev). Plus three 0.187.0 exact (checked on npm 2026-11-14).

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
  "workers_dev": true
  // "routes": the domain, once Q-5 is answered
}
```
