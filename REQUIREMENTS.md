# terriest: Requirements

Rocket League with terriers: two packs of small dogs corral a giant rubber ball into goals.

Status: first draft, written from the README on 2026-11-13. On 2026-11-14 the owner settled its open questions, accepting every default and choosing anchored steering; the rest is still a proposal. "(as roslambo)" marks a rule carried over from roslambo's requirements or plan, which the owner approved there or left to Claude's judgement. **TBD** marks a value not yet chosen. After the requirements come the configuration, notes for the implementation plan, and the settled questions.

## Concept

- Each player is a terrier in one of two packs, on a walled pitch with a goal at each end
- The ball is a giant rubber ball, about five times as tall as a terrier. Terriers can't kick it: they push it, jump against it and pounce on it
- A pack scores by driving the ball into the other pack's goal. One terrier can push it along, but corralling it takes a pack: together they get it moving sooner, hit it harder and keep it on course
- A match runs on a clock. The pack with more goals when the clock runs out wins; a tie goes to overtime, where the next goal wins
- It's 3D, seen from behind your own terrier, in a browser on a phone or a desktop
- Browsers connect directly to each other, with no game server (as roslambo)
- It's a game of its own in the genre: no names, terms or look come from the game in the pitch line, which is named only there

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
- **Goal**: the netted opening in each end wall. A pack defends one goal and scores in the other
- **Kickoff**: the restart from fixed spots with the ball on the center spot, in the middle of the pitch: at the start of a match, after every goal and at the start of overtime
- **Start countdown**: the countdown that ends the warm-up and leads into the first kickoff
- **Kickoff countdown**: the shorter countdown before every later kickoff
- **In play**: from the end of a kickoff's countdown until the next goal, or until the clock reaches 0
- **Touch**: one contact episode between a terrier and the ball. A terrier that stays against the ball, or bounces off and comes back without first getting the re-arm gap away from it, touches it once (see *Configuration*)
- **Terriest**: the match's standout terrier, named on the results screen
- **Match ID**: the secret that identifies a match and lets people join it

## Gameplay (MVP)

### Terriers

- Every terrier has the same size, mass, speed and abilities. Only looks differ: each player picks their terrier's **coat**, its fur color and markings, on Home (see *Screens*), and each bot gets one at random
- Each pack wears bandanas in its own color and pattern, such as plain for one pack and striped for the other, so color-blind players can tell the packs apart. No coat uses a pack's color
- A terrier runs the way its player points it, in any direction, turning to face that way fast but not instantly (see *Configuration*)
- **Zoomies**: a burst of speed. While its player holds zoomies and its **zoomies meter** isn't empty, a terrier runs at zoomies speed and the meter drains. The meter refills on its own while the terrier isn't zooming, and is full at every kickoff
- **Jump**: one jump, from the floor only
- **Pounce**: a short lunge the way the terrier faces, from the floor or in the air, then a wait before the next. It hits the ball harder than running into it does
- **Tumble**: a pouncing terrier that hits a rival tumbles it. So does a ball that comes at a terrier at the **bowling speed** or faster, counting only the ball's own speed toward the terrier, so a terrier is never tumbled by a ball it's pushing or chasing. A tumbled terrier can't act until it gets up, but the ball still bounces off it. It can't be tumbled again while it's down, or until the tumble guard has passed since it got up (see *Configuration*)
- **Bark**: the terrier barks, and a mark over it shows the bark to anyone with the sound off. It has no effect on play
- Terriers can't pass through each other, the ball or the walls. Running into another terrier pushes it
- Your own terrier is marked so you can always find it. Other terriers show their player's name if you choose that in Settings

### The ball

- One giant rubber ball, twice a terrier's mass (see *Configuration*). A lone terrier's hit sends it off at up to half the terrier's speed, and several hitting it at once send it faster. Pushing, one terrier gets it up to running speed in about 1.2 s, and four in about 0.6 s
- A terrier on the floor meets the ball below its middle, so a push also lifts it into a hop. A jump meets it nearer the middle and hits it level. Two terriers squeezing it from opposite sides can lift it off the floor
- It bounces off the floor, the walls, the overhead net, the goal frame and the goal's netting. Each bounce keeps part of its speed into the surface and all of its speed along it, and it slows as it rolls
- The simulation gives it no spin, so it never curves in the air or kicks sideways off a bounce. On screen it turns as if rolling with its motion (MVP; may be revisited)
- It never leaves the pitch

### The pitch

- A flat floor, walled on all sides with a net overhead, so the ball never goes out of play
- The corners are cut off, so the ball can't wedge into a corner
- A halfway line through the center spot splits the pitch into the packs' halves
- A goal is set into the middle of each end wall: an opening with two posts and a crossbar, netted at the back, sides and top, that the ball fits through with room to spare. The **goal line** runs across its mouth
- Each goal, and the floor of its half, carries the color and pattern of the pack that defends it, so a player can always see which way to attack
- The same pitch for every pack size (MVP). The design should not depend on the pitch's shape, so the shape can change later

### Controls

- Six controls: **run** (in a direction), **zoomies**, **jump**, **pounce**, **bark**, and **view**, which switches the camera (see *Cameras*)
- Directions are anchored, on every device (the owner, 2026-11-14). In ball view they're relative to the line from your terrier to the ball: forward runs at the ball, back runs away from it, and sideways circles it. In chase view a direction is read from the screen when it's pressed, then kept on the pitch while the camera swings round, so holding sideways turns the terrier once and runs straight (see *Cameras*). Pressing a new direction, or moving the stick to one, reads it from the screen again
- When the ball is nearly straight above your terrier, so the line to it has no direction, ball view's directions are taken from the way the terrier faces
- The steering scheme can change without much trouble (the owner, 2026-11-14). It's one setting (see *Configuration*), and the simulation takes the inputs of all three schemes in *Settled questions* from the start, so switching to screen-relative or vehicle-style steering, or offering a choice to each player later, changes only what the controls send
- Keyboard, by physical key position, so other layouts play on the same keys (as roslambo): `W` `A` `S` `D` run; `Space` jump; `Shift` zoomies; `E` pounce; `Q` bark; `C` view. `Ctrl` is never used, because `Ctrl`+`W` closes the tab
- Touch: a stick on the left of the screen runs, and pushing it out past its rim sets off zoomies; on the right, buttons for jump and pounce, and smaller ones for bark and view. One thumb runs and zooms while the other jumps and pounces
- Gamepad, with the browser's standard mapping: the left stick runs; the bottom face button jumps; the left face button pounces; the right trigger is zoomies; the top face button barks; the right shoulder button switches the view
- Controls can be held together, such as zoomies while running and jumping, on every device
- The mouse is used only in menus, and nothing turns the camera by hand, neither the mouse nor the gamepad's right stick (MVP)
- The buttons on Pre-match and Results can also be pressed from the keyboard or the gamepad, so a gamepad player never needs the mouse
- The first time a player plays with an input, keyboard, touch or gamepad, the pitch shows its controls, each hint until that control has been used once

### Cameras

- **Chase view**: from behind and above your terrier, swinging round behind it as it turns, at a comfortable rate that steering doesn't depend on
- **Ball view**: from behind your terrier, aimed at the ball, so the ball stays in sight. A match starts in ball view unless Settings says otherwise
- A player's camera stays inside the pitch, and a wall or the ball that comes between it and their terrier turns see-through
- When the ball is off screen, an arrow at the edge points to it
- Spectators watch from high above one side of the pitch, following the ball, and can choose to follow any terrier instead
- The camera is each viewer's own choice and changes nothing in the match

### Look and sound

- A bright cartoon look: chunky terriers with big heads, short legs and perky ears, animated as they run, jump, pounce and tumble; a glossy rubber ball; a grass pitch inside padded walls under a rope net. The owner picks the final look from samples (see *Notes for the plan*)
- In the MVP, terriers are built in code from rounded shapes and animated by code. Later they'll be modeled and animated in a 3D tool, or bought (the owner, 2026-11-14), and the MVP is built for that swap: how a terrier is drawn is one replaceable part, and replacing it changes nothing in play, in the simulation or on the network
- Every terrier look, built in code or modeled, plays the same **animations**, each started and timed by the simulation: standing, running at any speed, zoomies, turning, jumping and landing, pouncing, tumbling and getting up, barking, sitting, and celebrating a goal. A model can add detail, such as flapping ears, but never changes how long anything takes in play
- Every look fits the terrier's size on the pitch, shows every coat and both packs' bandanas, and fits the same drawing budget on the reference phone (see *Configuration*)
- Every hit shows its strength: the ball squashes and thumps harder the harder it's hit, zoomies kick up dust, a tumbled terrier rolls over and shakes itself off, and a goal bulges the net
- Sound: simple effects only: barks, the ball's bounces, pounces and tumbles, a whistle at each kickoff and at the end, and a chorus of barks for a goal. No music
- Nothing in play is told by sound alone: kickoffs, goals and the end show on screen as well

### Scoring

- A goal counts when the whole ball has crossed the goal line, between the posts and under the crossbar, while the ball is in play. Before overtime, a goal in the tick that brings the clock to 0 still counts
- It counts for the pack attacking that goal, whoever touched the ball last: an own goal counts for the other pack
- A goal is credited to the terrier whose touch was the latest before the ball crossed the line. Terriers touching it in that same tick share the credit if they attack that goal; if none of them does, it's an own goal and no terrier is credited
- A goal is followed by a short celebration, in which the ball is out of play, the terriers can still run and bark, and the scorer's name shows over the pitch. Then comes a kickoff. The clock is stopped from the goal until the kickoff countdown ends
- When the clock reaches 0, the pack with more goals wins. If the packs are level, **overtime** starts with a kickoff, and the next goal wins, however long that takes. Its celebration leads to the results screen
- Each terrier's goals (own goals excluded) and touches are counted while the ball is in play. The Terriest is the terrier with the most goals, then the most touches. Terriers still level share the title

### Kickoff

- The ball rests on the center spot
- Each terrier stands on a kickoff spot in its pack's half. The spots for each pack size are mirrored between the packs, so neither pack starts nearer the ball, and a fixed rule says which terrier takes which spot (see *Configuration*)
- A kickoff begins with a countdown: the start countdown for the first, and the kickoff countdown for every later one, after a goal or at the start of overtime. During it, terriers can turn on their spots but not leave them
- Play starts when the countdown reaches 0

## Matches

### Proposing

- A proposer creates a match and sets:
  - the **pack size**: 1 to 4 (see *Configuration*)
  - the **match length**
- Creating a match produces a match ID (as roslambo)
- The proposer shares the match ID by any means outside the game. There is no in-game lobby or discovery (as roslambo)
- The match ID alone is enough to join. The proposer's browser stays in the match's room and gives the settings to the first peer who arrives. From then on every peer holds them as part of the shared state, and the proposer can leave (as roslambo)
- If the proposer leaves before anyone joins, the match is gone (as roslambo)

### Joining and packs

- Anyone with the match ID can join as a **player** or as a **spectator** (as roslambo)
- A joining player picks a pack with a free place, and Join suggests the one with fewer terriers. Until the start countdown, a player can switch to the other pack if it has a free place
- A player who leaves or disconnects before the start countdown is removed from their pack. If they come back, they join again like anyone else (as roslambo)
- A player who leaves or disconnects during the start countdown keeps their terrier, which sits on its kickoff spot, and the countdown goes on (as roslambo)
- A new player's join is refused once both packs are full, or once the start countdown has begun (as roslambo). A returning player is not a new join (see *Disconnects*)
- Spectators can join at any time, including during the match, up to 4 per match (as roslambo)
- Players and spectators can add bots to either pack before the start countdown, one at a time, up to the pack size. A bot is always ready, so the people's Ready starts the match. Its host can remove it before then, and a host who leaves before then takes its bots out (as roslambo)
- A bot plays to win, at about a new player's level, with every ability: it chases the ball, drives it toward the other pack's goal, and falls back to defend when a rival is nearer the ball. One level for the MVP

### Ready and warm-up

- Each player signals they are ready with a **Ready** button. Pressing it again cancels it, and a Ready expires after a minute, but neither happens once the start countdown has begun (as roslambo)
- Until the start countdown, terriers can run, jump and pounce around the pitch to warm up. The ball stays on the center spot and can't be moved
- The start countdown begins when both packs are full, with players or bots, and every player is ready. The terriers go to their kickoff spots, and play starts when it reaches 0

### End of match

- The match ends when a pack wins (see *Scoring*)
- Everyone, players and spectators alike, sees a **results screen** with the final score, each terrier's goals and touches, and the Terriest
- The results screen has a **Play again** button. The first press proposes a new match with the same settings and a new match ID, and everyone still on the results screen can join it with one click. A host's bots join it too (as roslambo). Players and bots who join it this way keep their packs

### Practice

- **Practice** plays a match against bots in the player's own browser, contacting no one. The player picks the pack size and match length, and bots fill every other place. It runs through Pre-match, Match and Results like any match, and the match menu can pause it

## Screens

- **Home**: the player's display name and coat (editable), with **Propose a match**, **Join** (enter a code), **Practice** and **Settings**. Opening a `#join=` link skips Home (as roslambo)
- **Propose**: set the pack size and match length. Shows the link and code to share, and asks the proposer to keep the page open until someone joins. The proposer can play or watch at once, or leave (as roslambo)
- **Practice**: set the pack size and match length, then go to Pre-match
- **Join**: choose a pack to **Play**, or **Watch**
- **Pre-match**: the pitch, with the terriers warming up; each pack's list with name, coat and ready status; the **Ready** button; **Switch pack**; **Add a bot** and **Remove a bot** for each pack, for players and spectators; **Leave**; on a touch screen, the stick and buttons; the start countdown over the pitch
- **Match**: the pitch; the score, each pack's in its color and pattern, with the viewer's own pack marked; the clock, which shows when overtime has begun; the countdown before each kickoff; and a mark on any terrier that sits because its player, or its bot's host, is away. Players also see their zoomies meter and pounce wait, and on a touch screen the stick and buttons. Spectators see no play controls, only a choice of what to follow: the ball or any terrier. A menu button opens **Settings** and **Leave**
- **Results**: the final score, each terrier's goals and touches, and the Terriest, with **Play again** and **Home**
- **Settings**: extra relays and the player's own TURN server (as roslambo); whether names show over the terriers; whether a match starts in ball view; a calmer camera that swings more gently, for players prone to motion sickness; a mirrored touch layout, with the stick on the right; sound on or off
- On a phone, Pre-match and Match are played held sideways, with the stick and buttons over the pitch. Held upright, the other screens work as usual, and Pre-match and Match ask the player to turn the phone. On a desktop, the pitch fills the window

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
- Goals and the end of the match are taken from final ticks, so a correction never takes one back. A goal's score, whistle and celebration show once its tick is final, about 0.2 s after the ball crosses the line
- Cheating is left to the honor system in the MVP

Beyond roslambo's approach:

- When a late input corrects the simulation, the ball and the terriers glide to their corrected places on screen instead of jumping, where roslambo draws each correction as it comes. The simulation itself is never smoothed
- A remote terrier's bark plays when its input arrives, never from a predicted input

### Disconnects

- A disconnected player's terrier sits where it is. It can still be pushed, and the ball still bounces off it
- A bot's terrier sits while its host is away. A host that comes back takes its bots back (as roslambo)
- A player who comes back while the match is still running, from the same browser with the same match ID, takes control of their terrier again. Peers recognize them by their player ID (as roslambo)
- If every peer leaves, the match is over, and so it is if only spectators who host no bots are left, since every terrier would sit and an overtime would never end. Nothing is saved, paused or collected later, because a match changes nothing that lasts (unlike roslambo's balances)
- Results live only on the peers that saw the match end. There is no central record (as roslambo)

## Persistence

- A player's ID is randomly generated, for example a GUID. No accounts, no login (as roslambo)
- The ID, display name, coat and settings are stored in the player's browser and persist across visits
- Clearing browser data, or playing from another browser or device, means a new identity (as roslambo)
- Display names are up to 20 characters and always shown as plain text. They don't have to be unique (as roslambo)
- One game tab per browser (as roslambo)

## Platform

- JavaScript (TypeScript allowed)
- A fully static site: no backend, no server-side code
- Hosted with Cloudflare Workers static assets for the MVP, like roslambo. Domain **TBD**
- IPFS is not required. Every asset and module reference is still relative, so the site also works from a subpath (as amorfus)
- 3D drawn with WebGL 2, where roslambo draws in Canvas 2D
- No WebGPU until it's more widely supported (as roslambo)
- If WebGL 2 is missing or lost, the page says so plainly instead of going blank
- Desktop and mobile browsers: current Chrome, Edge, Firefox and Safari
- Keyboard, touch and gamepad are all in scope
- Nothing contacts a third party until a player proposes or joins a match. Practice contacts none

## Performance

- 60 fps on mid-range hardware: a mid-range phone, whose reference is a Pixel 8a in Chrome, as for roslambo. There is no laptop to test on, so the phone is the only reference device, and desktop browsers are checked in development only
- A match supports 8 terriers, 4 a side, and 4 spectators, which is roslambo's mesh cap

## Quality

- Readable, modular code with a short README covering how to run, build and deploy
- Automated tests for the non-rendering core: physics, scoring and the clock, kickoff spots, touches, steering in all three schemes, consensus, match IDs and bots
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
- Music, and sound beyond the effects in *Look and sound*
- Chat. Barks are the only signal
- Leaderboards, ranks, records or match history
- New players joining a match in progress
- Pickups and power-ups
- Replays
- Bot skill levels
- Unlockable or paid looks
- Terriers modeled and animated in a 3D tool, which come after the MVP (see *Look and sound*)
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
- 60 fps on the reference phone, a Pixel 8a in Chrome, through a scripted match of 8 terriers, by roslambo's frame-time criteria: the interval between animation frames at p95 ≤ 18 ms and max ≤ 50 ms, with the display at 60 Hz. They're to be copied into this repo's own `docs/acceptance.md`

## First deliverable

A written plan, approved before any code is written, covering rendering and the look, including how the code-built terriers give way to modeled and animated ones later; input and cameras on each device; the deterministic simulation; bots; networking and consensus; persistence; sound; build tooling; and milestones. It should take *Notes for the plan* into account, say what it reuses from roslambo and amorfus, and flag any requirement that conflicts with another or looks unrealistic.

## Configuration

Every setting should be easy to change. These are starting values, to be tuned on a tuning page as roslambo's were. Lengths are in meters.

| Setting | Value | Notes |
|---|---|---|
| Pack size | 1 to 4, default 2 | Set by the proposer. 4 a side is the mesh cap of 8 players |
| Match length | 3 minutes, from 1 to 10 | Set by the proposer |
| Ready expiry | 60 seconds | As roslambo |
| Start countdown | 5 seconds | From the moment both packs are full and every player is ready, to the first kickoff's start of play |
| Kickoff countdown | 3 seconds | At every kickoff but the first |
| Goal celebration | 3 seconds | Between a goal and the kickoff countdown, with the clock stopped |
| Kickoff spots | **TBD**, for each pack size from 1 to 4 | Mirrored between the packs. A fixed rule, such as player ID order, says which terrier takes which spot |
| Pitch | 40 × 28 m; walls and net 6 m high; corners cut 4 m along each wall | A terrier at run speed crosses its length in about 7 s |
| Goal mouth | 8 m wide, 3 m high, 2 m deep | The ball fits under the crossbar with 1.4 m to spare |
| Ball | 1.6 m across, twice a terrier's mass | About 5 times a terrier's height |
| Ball bounce | Keeps 70% of its speed into the surface off the floor, walls, nets and goal frame, and all of its speed along it | Rubber: lively bounces. Unlike roslambo's walls, which scale the whole speed, this lets a rolling ball keep rolling |
| Ball rolling slowdown | **TBD** | |
| Terrier | 0.3 m at the shoulder, 0.6 m long | Every look fits this size, so a model never changes play |
| Terrier drawing budget | **TBD** triangles and bones per terrier, and draw calls for 8 terriers | Measured on the Pixel 8a. The code-built terriers and the later models both fit it |
| Terrier–ball bounce | Keeps 50% of their closing speed | Sets how hard hits are. Struck level through its middle, a resting ball goes off at half the hitter's speed: 3 m/s at a run, 4.5 m/s at zoomies speed, 5 m/s from a pounce. A push from the floor meets it low, so part of that speed goes into a hop |
| Terrier bounce | **TBD** | Off other terriers and the walls. A landing terrier doesn't bounce |
| Re-arm gap | **TBD** | How far a terrier must get from the ball before its next contact is a new touch, as roslambo's re-arm gap does for collisions |
| Run speed | 6 m/s | |
| Acceleration | 15 m/s² | Run speed from rest in 0.4 s |
| Turn rate | 2 turns per second | Vehicle-style steering, if chosen, needs a slower one |
| Steering | Anchored | Screen-relative and vehicle-style steering are the alternatives (see *Settled questions*); switching changes only what the controls send |
| Chase view swing | **TBD** | How fast the chase view swings round behind a turning terrier, for comfort only. Each viewer's own; it changes nothing in the match |
| Zoomies speed | 9 m/s | |
| Zoomies meter | 3 s of zoomies when full; refills from empty in 6 s | Full at every kickoff |
| Jump | 1 m high | About 0.9 s in the air |
| Gravity | 9.8 m/s² | |
| Pounce | 10 m/s for 0.3 s, then 1.5 s before the next | |
| Bowling speed | 4 m/s | A ball coming at a terrier at least this fast, by its own speed toward it, tumbles it. A pounce, or a push at zoomies speed, sends a resting ball off fast enough; a push at a run doesn't |
| Tumble | 1.5 s | |
| Tumble guard | **TBD** | How long after getting up a terrier can't be tumbled again, so rivals taking turns can't keep it down |
| Bark | At most one a second | |
| Spectators | Up to 4 | Mesh cap, as roslambo |

## Notes for the plan

These aren't requirements. They're findings the implementation plan should account for.

- **Reuse.** roslambo is the template for everything but the game itself: the match ID, the room config from hermet, the timeline and consensus, bot hosting, storage and the one-tab rule. hermet takes each app's policy as options, so its README and CLAUDE.md, which name only amorfus and roslambo, need only a docs update. Its dist audit, though, allows only .html, .css, .js, .txt, .ico, .png, .svg and .webmanifest files, so sound files or 3D models need a change there first, unless they're made in code. amorfus and roslambo each have their own ID codec; whether terriest's becomes a third copy or all three move to a shared module is the owner's call
- **Determinism without rotations.** Terriers stay upright and turn only about the vertical, so a heading is one angle, which roslambo's binary angles and its own sine and cosine already handle. A ball without spin needs no rotation at all. The simulation then works in 3D positions and velocities with spheres, capsules and planes, using only the exactly rounded operations roslambo allows (its PLAN D-1), which hermet's exact-ops lint enforces. No stock physics engine keeps to that, so contacts are hand-written, as roslambo's are. Goal mouths make the pitch non-convex, unlike roslambo's arena
- **Steering that can change.** One input format can carry all three schemes: a direction and the frame it's measured in, which is the pitch, the line to the ball or the terrier's own nose, and the simulation resolves it into a heading. Anchored sends the line to the ball in ball view and the pitch in chase view. Screen-relative would send the pitch, read from the camera every tick, and vehicle-style steering would send the nose, which the simulation reads as turning. Each player's input carries its own frame, so players could even steer differently in one match. The golden hashes and the tests cover all three frames from the start, so a switch changes only the controls and, for vehicle-style steering, the turn rate
- **Simultaneous contacts.** With mirrored kickoff spots, two terriers rushing the ball with mirrored inputs, as two copies of one bot do at every kickoff, reach it in the same substep. Contacts settled one at a time in a fixed order, as roslambo's are, would then favor the same pack every time. Settle contacts that begin in the same substep together, and test that a mirrored kickoff gives a mirrored result
- **Resting and rolling contact.** roslambo measured planets resting in contact at 137 to 174 contact events a second, against about 5.5 separate episodes a second, which is why touches count once per episode. Here the ball and the terriers rest on the floor almost all the time, and a push is a lasting contact. That's the case roslambo's integrator handles worst: it splits a substep at each predicted contact, but bodies resting together hit a per-substep event cap, and their overlaps are settled the old way (its PLAN D-4, M2). Every bounce here also loses speed on purpose, which roslambo's physics appendix shows ends in a contact every tick. Plan a rule for resting and rolling contact, and test that a bounce keeps its set fraction of speed and a resting ball stays still
- **A ball on terriers.** With true sphere contacts, two terriers squeezing the ball from opposite sides lift it, and it can come to rest on top of them. Plan a rule for that, such as terriers slipping out from under it, and test that a squeezed ball doesn't stay up
- **A shared, contested ball.** Everyone watches the ball, so a late input that changes a touch moves the ball on every screen. That's why corrections are smoothed on screen here (see *Simulation and consensus*), where roslambo draws them as they come. roslambo's 2-tick input delay and 12-tick window for late inputs, at 60 ticks a second, carry over, to be measured again with a contested ball
- **A giant ball forgives some latency.** A pounce sends a resting ball off at 5 m/s, so an input 3 ticks (50 ms) late moves it 0.25 m, about a sixth of its size, and one 12 ticks late, at the end of the late window, 1 m. A pounce into a ball coming at 5 m/s changes its speed by 7.5 m/s, up to 1.5 m in 12 ticks, nearly its size. A small ball kicked hard would forgive less still
- **Cost on the phone.** 8 terriers and a ball make 36 pairs, against roslambo's 28, and a 12-tick replay of 4 substeps each checks them 48 times: 1,728 pair checks, plus the pitch, inside a Pixel 8a frame. Each split of a substep at a contact re-predicts contacts, so the budget counts splits too. Anchored steering keeps a held direction's input the same from tick to tick, so roslambo's prediction, the last input received, holds. A thumb still wobbles on a stick, so send its direction in coarse steps, such as 32 to a turn, so that a wobble doesn't change the input. roslambo measured tick cost on desktops only, and a 3D scene with 8 animated terriers is GPU load that no sibling has measured on the phone, so measure both first
- **Mesh and networks.** 4 a side fills the mesh cap exactly, and roslambo's load run was desktop-only. Nobody has measured phones on mobile data or behind strict NATs. A pair that can't connect hurts more around a contested ball, and forwarding adds a hop. On 2026-10-24 roslambo's relay check found relay.damus.io refusing connections, probably for a while only, after the test machine's traffic got it banned, and yabu.me/v2 answering 2 of 3 probes. Check again before the first deploy the way roslambo did: probe each relay by writing an event and reading it back, then decide with a round signaled through that relay alone, because one relay passed every probe and still refused every event Trystero sent
- **Tests through the real page.** amorfus's two worst first-build defects, a player who couldn't move and installs that could never join each other, passed a green gate because the tests went through test modes. The gate should play a scripted match through the real page and controls, and check that terriers move, the ball moves, and a goal reaches every peer's scoreboard
- **Terriers that will be modeled.** Pick a renderer that can already load glTF models and play their skeletal animations, such as three.js with its WebGL renderer, so the upgrade isn't a rewrite. Give the code-built terrier the interface a model will have: it takes the animation states, a coat and a bandana, and the simulation never reads anything back from it. hermet's dist audit allows no model format, so the upgrade starts with an option there to allow .glb, unless the models are embedded in the code. A bought model's licence goes into the shipped notices through hermet's licence script, which takes extra entries. Corrections reach animations too: a pounce the simulation takes back must blend out on screen, not snap. Measure the drawing budget on the Pixel 8a early, with a stand-in skinned model as well as the code-built terrier, so the models can be made to fit it
- **The look.** The owner chose roslambo's look from samples. Plan the same step for the terriers, the packs' colors and patterns, and the ball, checked for color blindness
- **Trystero and the player ID.** As roslambo: Trystero 0.26.0, exact and unpatched, and a persistent player ID kept apart from Trystero's `selfId`, which changes on every page load. An upgrade of Trystero now moves three apps at once

## Settled questions

The owner settled these on 2026-11-14: steering by choosing anchored from the three schemes compared at the end, and the rest at this draft's defaults. The sections above state each as a requirement.

- **3D or 2D?** 3D with WebGL 2, not top-down 2D on Canvas 2D like roslambo
- **Can a push lift the ball?** Yes, with true sphere contacts, not pushes along the floor only
- **Is a lone terrier slow with the ball?** No: one terrier can push it at its own speed, and a pack gets it moving sooner and hits it harder
- **Pack size?** 1 to 4 a side, chosen for each match, 2 by default, not always 3
- **Phones?** In scope, with a match played on a phone held sideways, not desktop only
- **How are the terriers built?** In code, from rounded shapes, with sounds made in code too, for the MVP. Modeled and animated terriers come later, and the MVP anticipates them (the owner, 2026-11-14; see *Look and sound*)
- **Tumbles?** Pounces and fast balls tumble terriers, rather than terriers only pushing each other
- **Anything that lasts?** No balance or record, unlike roslambo
- **IPFS?** Not required, as in roslambo, with the build still safe to serve from a subpath
- **Steering?** Anchored, not screen-relative or vehicle-style steering, with the system designed so the scheme can change without much trouble (see *Controls* and *Notes for the plan*). The three, compared:

| | Screen-relative | Steering | Anchored (chosen) |
|---|---|---|---|
| What a direction means | Where to go on screen: the terrier turns to face that way and runs | Forward runs, back brakes and backs up, and left and right turn the terrier, whatever the camera does | Where to go on screen, as in the first, but anchored to something the simulation knows (next two rows) |
| Ball view | Forward runs at the ball and sideways circles it, because the camera keeps aiming at the ball | You steer by your terrier's nose while the camera aims at the ball: a beginner's hardest moment | Directions are relative to the line from your terrier to the ball: forward runs at it, back away from it, sideways circles it. On screen it's the same as the first, because the view looks along that line |
| Chase view | The camera must swing round behind the terrier more slowly than it turns, or holding sideways spins both. Holding sideways then runs a wide circle | Natural: the camera stays behind the terrier's nose | A direction is taken from the screen when it's pressed, then kept on the pitch while the camera swings round, so holding sideways turns once and runs straight |
| Touch or gamepad stick | Natural: most third-person games work this way | Steering a dog like a car takes learning | Natural |
| Keyboard | Eight directions | Any heading | Eight directions |
| Network | The simulation doesn't know anyone's camera, so each browser turns the direction into one on the pitch before sending it. The camera keeps moving, so that changes while the stick is held still, roslambo's prediction (the last input received) keeps missing, and corrections come far more often | Held keys repeat exactly, so prediction holds | A still stick repeats exactly, and every browser works out the same heading from the ball's position, so prediction holds |
| Also needs | A chase view that swings well under the turn rate (see *Configuration*) | A slower turn rate: at 2 turns a second, holding left spins the terrier dizzily | A rule for a ball right overhead, where the line to it has no direction |

Anchored keeps the feel of the first, which suits a phone, the reference device, and fixes its two faults: the chase view doesn't run in circles, and a held stick costs the network nothing.
