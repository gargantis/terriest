# terriest: Requirements

Rocket League with terriers: two packs of small dogs corral a giant rubber ball into goals.

Status: first draft, written from the README on 2026-11-13 and not yet discussed with the owner, so every line is a proposal. "(as roslambo)" marks a rule carried over from roslambo, where the owner approved it. **TBD** marks a value not yet chosen. After the requirements come the configuration, notes for the implementation plan, and the open questions this draft most needs answered.

## Concept

- Each player is a terrier in one of two packs, on a walled pitch with a goal at each end
- The ball is a giant rubber ball, about five times as tall as a terrier. Terriers can't kick it: they push it, jump against it and pounce on it
- A pack scores by driving the ball into the other pack's goal. Corralling it takes a pack: one terrier alone moves it slowly
- A match runs on a clock. The pack with more goals when the clock runs out wins; a tie goes to overtime, where the next goal wins
- It's 3D, seen from behind your own terrier, in a browser on a phone or a desktop. Browsers connect directly to each other, with no game server (as roslambo)

## Terms

- **Match**: one game, from proposal to results screen
- **Proposer**: whoever creates a match; they don't have to play in it
- **Pack**: one of the two teams
- **Pack size**: how many terriers each pack has, the same for both
- **Terrier**: a dog on the pitch, controlled by a player or a bot
- **Player**: a person who controls a terrier
- **Spectator**: watches a match without a terrier
- **Bot**: a computer-controlled terrier, hosted by a player's or a spectator's browser (as roslambo)
- **Ball**: the giant rubber ball. A match has one
- **Pitch**: the walled field a match is played on
- **Goal**: the opening in each end wall. A pack defends one goal and scores in the other
- **Kickoff**: the restart from fixed spots with the ball on the center spot, at the start of a match and after every goal
- **Touch**: one contact episode between a terrier and the ball. A terrier that stays against the ball, or bounces off it and back within a small gap, touches it once
- **Terriest**: the match's standout terrier, named on the results screen
- **Match ID**: the secret that identifies a match and lets people join it

## Gameplay (MVP)

### Terriers

- Every terrier has the same size, mass, speed and abilities. Looks differ, for show only: each player picks a coat on Home
- Each pack wears its own color and a second cue besides color, so color-blind players can tell the packs apart
- A terrier runs on the floor in any direction, turning fast but not instantly (see *Configuration*)
- **Zoomies**: while the zoomies control is held and the meter lasts, the terrier runs faster. The meter refills on its own while the terrier isn't zooming, and is full at every kickoff
- **Jump**: one jump, from the floor only
- **Pounce**: a short lunge the way the terrier faces, from the floor or in the air, then a wait before the next. It hits the ball harder than running into it does
- **Tumble**: a pouncing terrier that hits a rival tumbles it, and so does a ball moving at the bowling speed or faster. A tumbled terrier can't act until it gets up, but the ball still bounces off it
- **Bark**: a bark that everyone hears and sees. It has no effect on play
- Terriers can't pass through each other, the ball or the walls. Running into another terrier pushes it
- Your own terrier is marked so you can always find it. Other terriers show their player's name if you choose that in Settings

### The ball

- One giant rubber ball, twice a terrier's mass, so one terrier moves it slowly and a pack moves it fast (see *Configuration*)
- It bounces off the floor, the walls, the net and the goal frame, keeping part of its speed each time, and slows as it rolls
- It has no spin of its own. Its turning is drawn from its motion (MVP; may be revisited)
- It never leaves the pitch

### The pitch

- A flat floor, walled on all sides with a net overhead, so the ball never goes out of play
- The corners are cut off, so the ball can't wedge into a corner
- A goal is set into the middle of each end wall: an opening with two posts and a crossbar that the ball fits through with room to spare
- The same pitch for every pack size (MVP). The design should not depend on the pitch's shape, so the shape can change later

### Controls

- Six controls: **run** (in a direction), **zoomies**, **jump**, **pounce**, **bark**, and **view**, which switches the camera (see *Cameras*)
- Keyboard, by physical key position, so other layouts play on the same keys (as roslambo): `W` `A` `S` `D` run, relative to the camera; `Space` jump; `Shift` zoomies; `E` pounce; `Q` bark; `C` view. `Ctrl` is never used, because `Ctrl`+`W` closes the tab
- Touch: a stick on the left of the screen to run; on the right, buttons for jump, pounce and zoomies, and smaller ones for bark and view
- Gamepad, with the browser's standard mapping: the left stick runs; the bottom face button jumps; the left face button pounces; the right trigger is zoomies; the top face button barks; the right shoulder button switches the view
- Controls can be held together, such as zoomies while running and jumping, on a keyboard, on a gamepad and with multi-touch
- The first time a player plays on a device, the match shows that device's controls until the player moves

### Cameras

- **Chase view**: from behind and above your terrier, turning with it
- **Ball view**: from behind your terrier, aimed at the ball, so the ball stays in sight. A match starts in ball view unless Settings says otherwise
- When the ball is off screen, an arrow at the edge points to it
- Spectators watch from high above one side of the pitch, following the ball, and can choose to follow any terrier instead
- The camera is each viewer's own choice and changes nothing in the match

### Scoring

- A goal counts when the whole ball has crossed the goal line, between the posts and under the crossbar. In normal time it must cross before the clock reaches 0
- It counts for the pack attacking that goal, whoever touched the ball last: an own goal counts for the other pack
- A goal is followed by a short celebration, then a kickoff. The clock is stopped from the goal until the kickoff countdown ends
- When the clock reaches 0, the pack with more goals wins. If the packs are level, **overtime** starts with a kickoff, and the next goal wins, however long that takes
- Each terrier's goals (own goals excluded) and touches are counted. The Terriest is the terrier with the most goals, then the most touches. Terriers still level share the title

### Kickoff

- The ball rests on the center spot
- Each terrier stands on a kickoff spot in its own half. The spots for each pack size are mirrored between the packs, so neither pack starts nearer the ball
- A kickoff begins with a countdown: the start countdown for the first, the kickoff countdown after each goal (see *Configuration*). During it, terriers can turn on their spots but not leave them
- Play starts when the countdown reaches 0

## Matches

### Proposing

- A proposer creates a match and sets:
  - the **pack size**: 1 to 4 (see *Configuration*)
  - the **match length**
- Creating a match produces a match ID
- The proposer shares the match ID by any means outside the game. There is no in-game lobby or discovery (as roslambo)
- The match ID alone is enough to join. The proposer's browser stays in the match's room and gives the settings to the first peer who arrives. From then on every peer holds them as part of the shared state, and the proposer can leave (as roslambo)
- If the proposer leaves before anyone joins, the match is gone

### Joining and packs

- Anyone with the match ID can join as a **player** or as a **spectator**
- A joining player picks a pack with a free place. By default they join the pack with fewer terriers. Until the countdown, a player can switch to the other pack if it has a free place
- A player who leaves or disconnects before the countdown is removed from their pack. If they come back, they join again like anyone else
- A new player's join is refused once both packs are full, or once the start countdown has begun. A returning player is not a new join (see *Disconnects*)
- Spectators can join at any time, including during the match, up to 4 per match (as roslambo)
- Players and spectators can add bots to either pack before the countdown, one at a time, up to the pack size. A bot is always ready, so the people's Ready starts the match. Its host can remove it before the countdown, and a host who leaves before the countdown takes its bots out (as roslambo)

### Ready and warm-up

- Each player signals they are ready with a **Ready** button. Pressing it again cancels it, except during the countdown. A Ready expires after a minute, but not during the countdown (as roslambo)
- Until the countdown, terriers can run, jump and pounce around the pitch to warm up. The ball stays on the center spot and can't be moved
- The **start countdown** begins when both packs are full, with players or bots, and every player is ready. The terriers go to their kickoff spots, and play starts when it reaches 0

### End of match

- The match ends when a pack wins (see *Scoring*)
- Everyone, players and spectators alike, sees a **results screen** with the final score, each terrier's goals and touches, and the Terriest
- The results screen has a **Play again** button. The first press proposes a new match with the same settings and a new match ID, and everyone still on the results screen can join it with one click, in the same pack. A host's bots join it too (as roslambo)

### Practice

- **Practice** plays a match against bots in the player's own browser, contacting no one. The player picks the pack size and match length, and bots fill every other place

## Screens

- **Home**: the player's display name and coat (editable), with **Propose a match**, **Join** (enter a code) and **Practice**. Opening a `#join=` link skips Home
- **Propose**: set the pack size and match length. Shows the link and code to share, and asks the proposer to keep the page open until someone joins. The proposer can play or watch at once, or leave (as roslambo)
- **Join**: choose a pack to **Play**, or **Watch**
- **Pre-match**: the pitch, with the terriers warming up; each pack's list with name, coat and ready status; the **Ready** button; **Switch pack**; **Add a bot** and **Remove a bot** for each pack, for players and spectators; the countdown over the pitch
- **Match**: the pitch, the score and the clock. Players also see their zoomies meter and pounce wait, and on a touch screen the stick and buttons. Spectators see no controls
- **Results**: the final score, each terrier's goals and touches, and the Terriest, with **Play again** and **Home**
- **Settings**: extra relays and the player's own TURN server (as roslambo); whether names show over the terriers; whether a match starts in ball view; sound on or off
- On a phone, a match plays held sideways, with the stick and buttons over the pitch. Held upright, the menus work as usual and a match asks to be turned. On a desktop, the pitch fills the window

## Multiplayer

### Stack

The same approach as roslambo:

- Peer-to-peer over WebRTC with Trystero (`@trystero-p2p/nostr`). No game server
- Signaling through the public Nostr relays roslambo uses: relay.damus.io, relay.primal.net, nos.lol, relay.snort.social, nostr-pub.wellorder.net, yabu.me/v2. Users can add relays
- STUN: `stun.cloudflare.com:3478` and `stun.l.google.com:19302`
- TURN: none built in. Users can configure their own

### Match ID

The same format as roslambo's round ID:

- 100 random bits; for Play again, 100 bits derived from the previous match ID, so presses at the same moment lead to the same match. Written as 20 Crockford base32 characters plus a check character: 21 characters in all
- It is the Trystero room ID
- Shared as a link carrying the ID in the URL fragment (`#join=<match ID>`), which never reaches a server, or typed as the 21-character code
- Displayed in groups of four (`K7QM-2XDP-4TR8-WHZN-3VBC-7`). Typing accepts lowercase, dashes, spaces and Crockford look-alikes (O for 0, I and L for 1)

### Simulation and consensus

The same approach as roslambo:

- Every peer, players and spectators alike, runs the same simulation
- Each player broadcasts its control inputs, and a hash of its state for its newest final tick, to every other peer. A peer sends its full state only to a peer that asks for it
- When states conflict, the state held by the **majority** wins
- The majority is counted among the votes received for that tick
- On a tie, the state with the smallest hash wins: an arbitrary choice, but every peer makes the same one
- Only browsers that control a terrier vote, one vote each however many terriers they control: a player's, or a spectator's that hosts bots and sends their inputs. Other spectators follow the majority state
- Cheating is left to the honor system in the MVP

One change from roslambo, which draws each correction as it comes:

- When a late input corrects the simulation, the ball and the terriers glide to their corrected places on screen instead of jumping. The simulation itself is never smoothed

### Disconnects

- A disconnected player's terrier sits where it is. It can still be pushed, and the ball still bounces off it
- A bot's terrier sits while its host is away. A host that comes back takes its bots back (as roslambo)
- A player who comes back while the match is still running, from the same browser with the same match ID, takes control of their terrier again. Peers recognize them by their player ID (as roslambo)
- If every peer leaves, the match is over. Nothing is saved, paused or collected later, because a match changes nothing that lasts (unlike roslambo's balances)
- Results live only on the peers that saw the match end. There is no central record

## Persistence

- A player's ID is randomly generated, for example a GUID. No accounts, no login
- The ID, display name, coat and settings are stored in the player's browser and persist across visits
- Clearing browser data, or playing from another browser or device, means a new identity
- Display names are up to 20 characters and always shown as plain text. They don't have to be unique
- One game tab per browser (as roslambo)

## Platform

- JavaScript (TypeScript allowed)
- A fully static site: no backend, no server-side code
- Hosted with Cloudflare Workers static assets for the MVP, like roslambo. Domain **TBD**
- IPFS is not required. Every asset and module reference is still relative, so the site also works from a subpath (as amorfus)
- 3D drawn with WebGL 2. No WebGPU until it's more widely supported (as roslambo)
- If WebGL 2 is missing or lost, the page says so plainly instead of going blank
- Desktop and mobile browsers: current Chrome, Edge, Firefox and Safari
- Keyboard, touch and gamepad are all in scope
- Nothing contacts a third party until a player proposes or joins a match. Practice contacts none

## Performance

- 60 fps on mid-range hardware: a mid-range phone, whose reference is a Pixel 8a in Chrome, as for roslambo. There is no laptop to test on, so the phone is the only reference device, and desktop browsers are checked in development only
- A match supports 8 terriers, 4 a side, and 4 spectators, which is roslambo's mesh cap

## Quality

- Readable, modular code with a short README covering how to run, build and deploy
- Automated tests for the non-rendering core: physics, scoring and the clock, kickoff spots, touches, consensus, match IDs and bots
- A cross-browser determinism test: the same inputs produce bit-identical states in Chromium, Firefox and WebKit
- End-to-end tests that play matches through the real page and its controls, not only through test modes
- The gate tooling shared with amorfus and roslambo, from hermet
- No secrets, API keys or tracking

## Out of scope for MVP

- Accounts, login, or any central identity
- An in-game lobby or match discovery
- Server-side storage of anything
- Cheat prevention beyond the honor system
- A built-in TURN server
- IPFS
- WebGPU
- Audio beyond simple effects, such as barks, the ball's bounces and a whistle
- Chat. Barks are the only signal
- Leaderboards, ranks, records or match history
- New players joining a match in progress
- Pickups and power-ups
- Replays
- Unlockable or paid looks
- Remapping controls
- Terriers running up walls, and more than one ball

## Acceptance

- `npm install && npm run build` produces a static folder that deploys to Cloudflare Workers static assets
- Three browsers on different machines, at least one of them a phone, can join a match by link and by typed code, fill both packs (with bots where needed), mark themselves ready, play to the end, and all see the same results screen
- A spectator who joins mid-match sees the same match
- A player who reloads mid-match takes back their terrier
- Practice plays a whole match against bots and contacts no third party
- Every control works on a keyboard, a touch screen and a standard gamepad
- The determinism test passes in Chromium, Firefox and WebKit
- 60 fps on the reference phone, a Pixel 8a in Chrome, through a scripted match of 8 terriers, by the frame-time criteria in `docs/acceptance.md`

## First deliverable

A written plan, approved before any code is written, covering rendering, the deterministic simulation, networking and consensus, persistence, build tooling and milestones. It should take *Notes for the plan* and *Open questions* into account, say what it reuses from roslambo and amorfus, and flag any requirement that conflicts with another or looks unrealistic.

## Configuration

Every setting should be easy to change. These are starting values, to be tuned on a tuning page as roslambo's were. Lengths are in meters.

| Setting | Value | Notes |
|---|---|---|
| Pack size | 1 to 4, default 2 | Set by the proposer. 4 a side is the mesh cap of 8 players |
| Match length | 3 minutes, from 1 to 10 | Set by the proposer |
| Ready expiry | 60 seconds | As roslambo |
| Start countdown | 5 seconds | From the last Ready to the first kickoff's start of play |
| Kickoff countdown | 3 seconds | At each kickoff after a goal |
| Goal celebration | 3 seconds | Between a goal and the kickoff countdown, with the clock stopped |
| Pitch | 40 × 28 m; walls and net 6 m high; corners cut 4 m along each wall | A terrier at run speed crosses its length in about 7 s |
| Goal mouth | 8 m wide, 3 m high, 2 m deep | The ball fits under the crossbar with 1.4 m to spare |
| Ball | 1.6 m across, twice a terrier's mass | About 5 times a terrier's height |
| Ball bounce | Keeps 70% of its speed off the floor, walls, net and goal frame | Rubber: lively bounces |
| Ball rolling slowdown | **TBD** | |
| Terrier | 0.3 m at the shoulder, 0.6 m long | |
| Terrier–ball bounce | Keeps 50% of their closing speed | Sets how hard hits are: a push at a run sends a resting ball off at 3 m/s, at zoomies speed 4.5 m/s, and a pounce 5 m/s |
| Run speed | 6 m/s | |
| Acceleration | 15 m/s² | Run speed from rest in 0.4 s |
| Turn rate | 2 turns per second | |
| Zoomies speed | 9 m/s | |
| Zoomies meter | 3 s of zoomies when full; refills from empty in 6 s | Full at every kickoff |
| Jump | 1 m high | About 0.9 s in the air |
| Gravity | 9.8 m/s² | |
| Pounce | 10 m/s for 0.3 s, then 1.5 s before the next | |
| Bowling speed | 4 m/s | A ball at least this fast tumbles the terriers it hits: a pounce or a push at zoomies speed does it, a push at a run doesn't |
| Tumble | 1.5 s | |
| Bark | At most one a second | |
| Spectators | Up to 4 | Mesh cap, as roslambo |

## Notes for the plan

These aren't requirements. They're findings the implementation plan should account for.

- **Reuse.** roslambo is the template for everything but the game itself: the match ID, the room config from hermet, the timeline and consensus, bot hosting, storage and the one-tab rule. hermet names only amorfus and roslambo, so adopting it starts with a change there. A third copy of the ID codec is the drift hermet exists to stop; whether game code like it moves to a shared module is the owner's call
- **Determinism without rotations.** Terriers stay upright and turn only about the vertical, so a heading is one angle, which roslambo's binary angles and its own sine and cosine already handle. A ball without spin needs no rotation at all. The simulation then works in 3D positions and velocities with spheres, capsules and planes, using + − × ÷ and √ only. No stock physics engine keeps to that, so contacts are hand-written, as roslambo's are. Goal mouths make the pitch non-convex, unlike roslambo's arena
- **A shared, contested ball.** Everyone watches the ball, so a late input that changes a touch moves the ball on every screen. That's why corrections are smoothed on screen here (see *Simulation and consensus*), where roslambo draws them as they come. roslambo's 2-tick input delay and 12-tick window for late inputs carry over, to be measured again with a contested ball
- **A giant ball forgives latency.** A heavy ball that is pushed moves slowly. A pounce, the hardest hit, sends a resting ball off at about 5 m/s, so a correction of 3 ticks moves it 0.25 m, about a sixth of its size. A small ball kicked hard would forgive much less
- **One touch per contact.** roslambo measured resting contacts at 137 to 174 contact events a second against about 5.5 real episodes. Touches count once per episode, as roslambo's collisions do. The ball rests on the floor almost all the time, so it needs roslambo's integration that splits a substep at the moment of contact, which neither gains nor leaks energy
- **Cost on the phone.** 8 terriers and a ball make 36 pairs, against roslambo's 28, and a 12-tick replay of 4 substeps each checks them 48 times: 1,728 pair checks, plus the pitch, inside a Pixel 8a frame. roslambo measured tick cost on desktops only. A 3D scene with 8 animated terriers is GPU load that no sibling has measured on the phone, so measure it first
- **Mesh and networks.** 4 a side fills the mesh cap exactly, and roslambo's load run was desktop-only. Nobody has measured phones on mobile data or behind strict NATs. A pair that can't connect hurts more around a contested ball, and forwarding adds a hop. roslambo's relay probe of 2026-10-24 found relay.damus.io failing and yabu.me/v2 unreliable: probe again before the first deploy, writing an event and reading it back
- **Tests through the real page.** amorfus's two worst first-build defects, a player who couldn't move and installs that could never join each other, passed a green gate because the tests went through test modes. The gate should play a scripted match through the real page and controls, and check that terriers move, the ball moves, and a goal reaches every peer's scoreboard
- **The look.** The owner chose roslambo's look from samples. Plan the same step for the terriers, the packs' colors and second cues, and the ball, checked for color blindness
- **Trystero and the player ID.** As roslambo: Trystero 0.26.0, exact and unpatched, and a persistent player ID kept apart from Trystero's `selfId`, which changes on every page load. An upgrade of Trystero now moves three apps at once

## Open questions

The forks where this draft's default could be wrong and a wrong guess would cost the most. Each gives the default used above and the main alternative.

- **3D or 2D?** Default: 3D with WebGL 2, a camera behind your terrier, and jumps. Alternative: top-down 2D on Canvas 2D like roslambo, which keeps roslambo's renderer and phone bench but loses height: no jumps, and the giant ball becomes a disc
- **Pack size?** Default: 1 to 4 a side, chosen for each match, 2 by default. Alternative: always 3 a side, the genre's usual size
- **Phones?** Default: in scope, held sideways, as in roslambo. Alternative: desktop only with keyboard and gamepad, as in amorfus, which drops touch controls and the phone's frame budget
- **Where do zoomies come from?** Default: the meter refills on its own. Alternative: treats scattered on the pitch refill it, which adds something to fight over
- **Knockdowns?** Default: pounces and fast balls tumble terriers. Alternative: terriers only push each other and never lose control
- **Absent players?** Default: their terrier sits. Alternative: a bot takes it over until they return, which needs a rule for whose browser hosts it
- **Practice without the network?** Default: Practice runs in your own browser and contacts no one. Alternative: practice as in roslambo, by proposing a match and adding bots
- **Anything that lasts?** Default: no balance or record, so a match changes nothing once it ends, and there's no saving, pausing or collecting missed results. Alternative: a win record or a balance like roslambo's, which brings those back
- **IPFS?** Default: not required, as in roslambo, though the build stays safe to serve from a subpath. Alternative: required, as in amorfus and in line with the gargantis protocol's Helia/IPFS, at the cost of amorfus's release chain and of old releases losing multiplayer when relays change
