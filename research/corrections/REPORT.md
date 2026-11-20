# M3 correction measurement: report

**Answers:** PLAN D-16 and D-11, as §17's M3 entry asks: the correction measurement's p50, p95 and max per profile and its late inputs, d and D-16's glide chosen from them, w = 12 confirmed or amended, and the spread's cap checked.
**Status:** the method (section 1), committed before anything was measured under it (design §9.1), and the results (section 2), measured at a later commit whose `src`, `dev` and `scripts` trees are the method's, and the values they settle.
**Sources:** M3's design §9 (research/m3/DESIGN.md), with its §2.11, the corrections, and §8.2, the network model; section 1.14 lists what this method makes precise. `dev/corrections.measure.ts` measures and decides by it, off the gate, under `dev/corrections.vitest.config.ts`. `dev/corrections.test.ts`, in the gate, checks its profiles, loss model, statistics, reach, rules and merge on synthetic figures. A bare § is the design's, but §17, PLAN's milestones; the M3-Q numbers are the design's questions for the plan.
**Known before it:** runs made before this method was committed don't count as the measurement, and their figures were known when it was written:
- **Smoke runs** of M3's phases 5, 5a and 5b and of this writing: `pack1-30ms-d2-loss0` and the four partial-mesh profiles at one seed, and the cap check at one to four runs at a time. Phase 5b's consensus change (600f2f0) leaves normal matches as they were: its smoke runs are identical to phase 5a's but for their wall times. At `pack1-30ms-d2-loss0`'s one seed, the driven terrier's p95 correction was 6.55 m with its one correction across a phase's start, and 0.025 m without it.
- **Phase 5a's runs at every seed:** `pack4-80ms-d2-loss0` at its 6 seeds, twice, with the same figures, and the four partial-mesh profiles at 6 seeds each. At `pack4-80ms-d2-loss0`: the p95 ball correction 0.217 m [0.192, 0.230]; the remote terriers' headings 56.3° at the interval's upper end, with and without the placed corrections; the driven terrier 0.048 m (upper end 2.02 m) with its 48 placed corrections, and 0.025 m (0.030 m) steady; its heading 141° (175°), and 24.2° steady; no late input finalised absent, and no resync. At d = 2 these already fix both of rule 2's values (section 1.9): 56.3° over 150 ms is 375° a second, over half the turn rate, so `smoothingMs` is 200 whatever the other pack sizes show, and 24.2° over 50 ms is 484° a second, so `ownSmoothingMs` is 100. In the 30 ms partial meshes the driven terrier's p95 was 6.15 and 11.1 m with the placed corrections, and 0.0055 and 0.0052 m steady; the 80 ms ones had 0 and 1 resyncs in 6 matches.
- **The cap check:** in every one of the 48 runs known, under loads from a quiet machine to a busy one, the slowest call was the one adopting the repair's STATE: 3.8 to 33 ms, 1.5 to 5.4 times the mean of its run's 42-step timer runs, and no less than the slowest of them. Times 6.3, it was over 25 ms in 45 of them.

## 1. Method

### 1.1 The base

`src/config.ts` at this report's commit, with `TERRIEST_CORRECTIONS_BASE` unset: A.4's values. Among them, d = 2, w = 12 and v = 12 ticks at 60 a second; a 256-tick state history and a 16-tick input history in every TICK; the spread's cap, 42 steps for each tick a timer run's clock moved, and 42 for a run whose clock didn't move and for a STATE's adoption (D-11); a 1-tick clock deadband; the timeline's 4 ms timer; a ping to each peer every second; and a 2 s stall. Each profile sets d itself; the partial mesh and the cap check take the base's. Each results file records its base and the whole configuration it ran at, with the code (section 1.11).

### 1.2 The match (§9.2)

A match runs in Node, in virtual time, over `src/net/loopback.ts`, the network simulator the session tests use.
- **The browsers:** one per terrier, 2 × the pack size. Each is a real `Session` with its `Timeline` and `BotHost`, as `NetGame` builds it (forwarding on, the incremental timeline, no full-replay check), hosting no bot. Each is a player whose own terrier the bot brain drives on its own drawn head (`scriptSampler('brain', …)`, rebuilt from the terrier's stored input at each `onControl`), so every other terrier is remote to it, as in a match of people (M3-Q2).
- **Joining:** browser 0 enters the room at 0 ms, proposes a match of the profile's pack size and 1 minute, and plays in pack A. Browser k enters at 200·k ms and plays in pack k mod 2, 0 being A. A pair meets a round trip after the later one enters, through the relay, unless the pair is blocked.
- **Ready:** each presses Ready once, at its first timer run at or past tick 360 (6 s) with its terrier in the final roster: the one Ready rule of `src/net/setups-testing.ts` and the `#test=net` page.
- **The end:** the match plays to its confirmed end on every browser, the final state ended and its tick confirmed, with overtime if it's level. The run stops once every browser has reached it, checked every 500 ms of virtual time. A match that hasn't by 600 s after genesis stops there, is reported unended, and still counts.
- No timer freezes or slows. A gap over the stall between a browser's timer runs would be a stall (§4.12), as on a page.

### 1.3 The seeds

A profile's matches are seeds 1 to 6, or 1 to 4 with loss. A seed s gives:
- **the IDs:** browser k's player ID is `personId(s, k)`, which also seeds its brain's aim noise;
- **the network's draws:** each message's jitter from `mulberry32(s)`, and its loss from a stream of its own, `mulberry32(s ^ 0x5bd1e995)`, drawn only when the chance is above 0;
- **the clocks:** from `mulberry32(s ^ 0x2545f491)`, each browser in turn takes an offset uniform in [−30, 30) ms and a drift uniform in [−0.1%, 0.1%).

So browser k has the same ID and clock at seed s in every profile. Everything runs in virtual time from these draws, so a run repeats every figure but its wall times and the cap check's timings (section 1.10), whatever the machine's load.

### 1.4 The profiles (§9.2)

- **§9.2's 72,** of 336 matches: pack sizes 1 to 4; a one-way latency of 30, 80 or 150 ms on every link, each message adding a jitter uniform in [0, 20) ms; d = 2 or 3; and a loss chance of 0, 0.1% or 0.5% a message (M3-Q13). Six seeds without loss, four with. Each is named `pack<n>-<ms>ms-d<d>-loss<%>`: `pack2-80ms-d3-loss0.5` is pack size 2 at 80 ms, d = 3 and 0.5%.
- **The partial mesh's 4,** of 24 matches, reported only, deciding nothing (M3's phase 4a): pack size 4, the base's d, no loss, 30 or 80 ms. Browsers 1 and 2 can't connect, or 1 and 2 and also 5 and 6, so those pairs' inputs reach each other only forwarded (D-19). Six seeds each. Each is named `pack4-<ms>ms-d<d>-blocked<pairs>`.

In all, 76 profiles and 360 matches. w, v and the cap are the base's in every one.

### 1.5 The loss model (M3-Q13, §8.2)

Every link carries messages one way after its latency and jitter, first in, first out: none lands before one sent ahead of it on the link. With the profile's chance, a message is lost on the reliable ordered channel and sent again, landing an extra round trip, 2 × the one-way latency, late. The messages behind it wait for it: head-of-line blocking, which is what makes a loss expensive. The chance applies to every message on the link, the handshake's and the pings' as well as the session's. At 0.5% and 60 TICKs a second, that's a loss about every 3 s on each link.

### 1.6 What's logged (§9.3)

On every browser, over every timeline it held, kept in memory and written as section 1.7's figures:
- **Every correction** (§2.11): each re-simulation that recomputes the tick the drawn head shows, from the timeline's `onCorrection`, zero changes included. `correctionSizes` (`src/core/session/summary.ts`), the match summary's own definition, sizes it between the head as drawn and as recomputed at that tick: the ball's change of position in 3D and on the floor; each remote terrier's change of position in 3D and of heading, the shorter way round, in degrees; and the driven terrier's apart. A terrier in only one of the two states has no size. With it go its depth, H − from + 1, from the earliest tick re-simulated to the head's tick H; whether its base came from a STATE, a resync's or a late-vote repair's; whether it moved anything; and whether it crossed a phase's start, its head before and after differing in phase or in the tick that phase started.
- **The timeline's counters,** summed over its timelines: steps, rollbacks (re-simulations that replaced an entry), spread ticks (advances that ended with the chain behind), completed resyncs, failed resyncs, lost tallies, late-vote flips and clock jumps.
- **Late inputs, against w (L340):** `late` counts each TICK's own input or bot entry whose tick is at or before the late boundary when it arrives: the later of the final tick and ⌊clock⌋ − w, the final tick alone in a joiner's warm-up. `lateBy` bins them by how many ticks late, 1 to 15 and 16 or more. `lateAbsent` counts each (sender, tick) finalised absent here whose input came later, in a TICK's own input or its history, once. Their whole, the remote inputs, is every TICK's own input and bot entry taken once the timeline had started, direct or forwarded.
- **The steps of each timer run** that stepped, and the ticks its clock moved.
- **Traffic,** counted round its link: the session's messages and bytes, sent and received, a broadcast once to each neighbour, and the FWDs it sent. The handshake and the pings aren't counted.

### 1.7 What's reported (§9.4)

`research/corrections/results.json` holds each match's figures, browser by browser, and each profile's, pooled over its matches:
- **corrections:** how many, how many moved nothing, how many were a repair's, and how many fell in each phase of the recomputed head;
- **by kind:** every correction that wasn't a repair's, then the same split into the **placed** (those across a phase's start) and the **steady** rest, and a repair's apart. For each kind and body (the ball in 3D and on the floor, the remote terriers' positions and headings, the driven terrier's position and heading): the samples that moved it and the zeros; over those that moved it, p50, p95, max and a histogram; and the p95's bootstrap 90% interval over the profile's matches. And each kind's depths: p50, p95, max and a histogram;
- **late inputs:** the count, its share of the remote inputs, `lateBy`, and `lateAbsent` with its share;
- **resyncs per browser-minute,** each browser's minutes running from its timeline's start to its confirmed end, with the failed resyncs, lost tallies, late-vote flips and clock jumps in all;
- **steps** per timer run that stepped (mean, p95 and max, pooled), per tick (the browsers' mean), and spread ticks; and rollbacks a second (the browsers' mean);
- **traffic:** messages and bytes a second, sent and received, over each browser's time from entering the room to its confirmed end, the browsers' mean, and the FWDs sent;
- **the reach** (section 1.8) beside each lossy profile and each partial mesh; how many matches ended; and the wall time.

Each browser's figures carry its own match summary's binned p95s (§1.16) of the corrections that weren't a repair's, and beside them the exact p95s of the same samples, those that moved each body, as a check of the bins.
- **Percentiles** are by nearest rank, the ⌈n × pct / 100⌉-th smallest, as the match summary takes them, and 0 for none. A body's p50, p95 and max are over the samples that moved it (a change above zero), pooled over the profile's matches: one sample a correction for the ball and the driven terrier, and one for each remote terrier.
- **The bootstrap** resamples matches, not corrections, since one match's corrections aren't independent. Its 1,000 resamples each draw as many matches as the profile has, with replacement, from `mulberry32` seeded with the 32-bit FNV-1a hash of the profile's name, so a profile's figures don't depend on which others ran. A replicate is the p95 of the pool of a resample's matches, each match's samples taken as many times as it was drawn. The interval is the replicates' 5th and 95th percentiles. One set of draws serves every body and kind of a profile.
- **The replicates are kept** for the bodies rules 1 and 2 read, at the loss-free 80 ms profiles, for every correction that wasn't a repair's and for the steady ones: the ball, the remote terriers' positions and headings, and the driven terrier's position and heading. So every rule can be recomputed from the committed file, with the intervals, shares and rates the rules read and the cap check's runs.
- **Six significant figures:** every number that isn't whole is rounded to six significant figures before the rules read it, and each figure a rule derives from them, a fall, a drawn time or a cap's quotient, is rounded likewise before it's compared with its limit. So the rules read the figures written, and at a limit's edge the text decides, not floating-point noise.

### 1.8 The reach (§9.4)

The longest one-way latency at which a message whose trip takes `legs` one-way latencies over `hops` links still lands before its tick is final: ((d + w) × 16.7 ms − the clocks' residual − hops × 20 ms) / legs, at the profile's d and the base's w.
- **Beside each lossy profile, the loss reach:** a lost message's trip is 3 legs on its one link. That link's ends sample each other's clocks, which the 1-tick deadband leaves up to a tick apart. At w = 12 it's 65.6 ms at d = 2 and 71.1 ms at d = 3: the 30 ms profiles are inside it, the 80 and 150 ms ones past it.
- **Beside each partial mesh, the forwarding reach:** a forwarded TICK's 2 legs over 2 links, each with its own jitter. The blocked pair sample none of each other's clocks. Each is within a deadband of the pages between, so they're up to two deadbands apart (M3's phase 5a). At d = 2 and w = 12 it's 80.0 ms, so the 80 ms partial mesh sits at its edge.

### 1.9 Rules 1 to 3 (§9.5)

**The decisive figures** for rules 1 and 2 are the **steady** corrections' p95s at the loss-free 80 ms profiles: from the corrections that moved the body, weren't a repair's, and didn't cross a phase's start.
- A repair's correction is governed by w and the loss rate, not by prediction, so neither d nor the glide is chosen from it, and an extra tick of delay is never rewarded for doing the late window's job.
- A placed correction is most often a kickoff placement shown a tick early or late, when a late Ready or input moved a countdown or a goal by a tick. A placement is a snap, not a correction a glide should hide: D-16 drops a correction's offset at a kickoff reset rather than smoothing across it, and M4's drawing snaps across a phase's start (D-27's M3 amendment).
- Both kinds are reported, and decide nothing. Nor do rules 1 to 3 read on every correction that wasn't a repair's, placements included, which results.json gives beside the decisive ones as `withPlacements`. The lossy profiles decide only rule 3, and the partial mesh nothing.

1. **d:** d = 3 replaces 2 only if, at every pack size, the p95 ball correction (3D) falls from `pack<n>-80ms-d2-loss0` to `pack<n>-80ms-d3-loss0` by at least 25%, and the bootstrap interval of that fall lies wholly above 25%. The fall is 1 − (the p95 at d = 3) / (the p95 at d = 2), to six significant figures. Its interval pairs the two profiles' replicates by index, from two independent resamplings, and takes the falls' 5th and 95th percentiles, each fall to six significant figures. A p95 or a replicate of 0 at d = 2 gives no fall, and fails. Otherwise d = 2 stays: an extra tick of input delay is paid by every player on every input, so it must buy a clear cut in what everyone sees move. Without loss the model expects d = 3 to cut the re-simulation's depth at 80 ms from about 4.4 ticks to 3.4, some 23%, so it expects d = 2 to stay.
2. **The glide,** at rule 1's d, at `pack<n>-80ms-d<d>-loss0` for every pack size, each p95 taken at its interval's upper end:
   - **`smoothingMs`:** the smallest of 50, 100, 150 and 200 ms for which the p95 ball correction (3D) and the p95 remote terrier correction, each divided by it, are at most 3 m/s, half the run speed, and the p95 remote heading correction divided by it is at most 360° a second, half the turn rate. A correction glided over that time then moves a drawn body at most half a run faster, and turns a drawn terrier at most half its turn rate faster, than the simulation, for p95 of corrections. If none passes, 200 ms, and the figures go to M4's check.
   - **`ownSmoothingMs`:** the smallest of 25, 50 and 100 ms by the same limits on the driven terrier's position and heading. If none passes, 100 ms, and the figures go to M4's check.
   - D-16's "bodies in contact share one decay" stands. M4 checks the values with the bench's virtual peers.
3. **w,** at rule 1's d: w = 12 is confirmed if, at every pack size, `lateAbsent` is at most 0.5% of the remote inputs and resyncs are at most 1 a browser-minute. That's at the loss-free 30 and 80 ms profiles and at the 30 ms profiles at either loss rate, which the loss reach covers: 16 profiles. If one fails:
   - **the next w,** the smallest of 14, 16 and 18 above w, is measured (section 1.12), every profile and the cap check, with rules 1 and 2 run again at it, and becomes w if rule 3 confirms it there; if rule 3 fails there too, the same again from it. Before `src/config.ts` is written, the plan states its costs: the goldens re-emitted, since `celebrationTicks` grows with w; the confirmation delay, (w + v) / 60 s, in Q-7's and REQUIREMENTS' "about 0.4 s"; and a normal tick's worst, w + 1 steps, against C-2's 13.
   - **Protocol 2 first:** every TICK's history must cover d + w (PLAN §7.4), and its u16 masks hold 16 ticks. So w = 14 fits at d = 2, but 16 and 18, or any w over 13 at d = 3, take u32 masks and a 32-tick history: protocol version 2, 4 more bytes a TICK and a bot entry, and `inputHistoryTicks` 32 with its check. Until protocol 2 is built the harness refuses those profiles (section 1.11). A next w that takes protocol 2 at rule 1's d isn't measured: rule 3 then decides nothing, w stays as it is, and the figures go to the owner in the C-row, with the choice of protocol 2 built and that w measured, or w kept with its residual. So does a failure with no w left past 18.
   - **Rule 1 at w = 14:** its d = 3 profiles need protocol 2, so it is undecided there, d stays 2 (an undecided rule changes nothing, section 1.11), and rules 2 and 3 read d = 2.

   **The lossy 80 and 150 ms profiles aren't decisive.** Past the loss reach, a lost message's input lands after its tick is final at the browser that lost it. That browser finalises it absent, diverges and resyncs: the model says so before anything is measured. Their measured rates go into a new C-row (section 1.13). Nor are the loss-free 150 ms ones, which §9.5's rule 3 doesn't read; they're reported.

### 1.10 The cap check (§9.6)

- **The forced repair:** a 4-a-side match, as section 1.2's, over loss-free 30 ms links with their 20 ms of jitter, at the base's d and seed 1. At 15 s, in play, the next TICK on each link into browser 3 is held 4,100 ms, and FIFO holds everything behind it on those links; browser 3's own messages flow. For about 4 s it hears nothing, so it finalises its peers' inputs absent and tallies alone. When the held messages land, the late votes show it lost. It repairs from a STATE about 240 ticks back, near the end of the 256-tick history: about 250 steps with prediction.
- **Timed:** every call of browser 3, timer run or message, by Node's `performance.now()`. The repair's calls run from the one that adopts the STATE, a message whose adoption also steps, up to the cap, to the call that completes the repair. Its worst is the slowest of them that stepped, the adoption's included.
- **Reported beside it:**
  - the STATE's tick, how far back the repair started, and its steps;
  - every call of the repair;
  - the five slowest normal timer runs in the 5 s before the hold and the 5 s after the repair, before any connection browser 3 closed;
  - whether the match was in play at the hold;
  - the other browsers' resyncs and lost tallies, which the hold alone shouldn't cause;
  - every connection a browser closed, none in an honest run;
  - the machine's 1-minute load average before and after each run, and before the first run and after the last.
- **Repeated 20 times,** the same match each time, with a garbage collection before each (Node's `--expose-gc`, which `dev/corrections.vitest.config.ts` passes). One maximum is mostly the tail: M0's 42 steps at 4× throttle had a median of 5.03–6.97 ms and a maximum of 7.52–23.29 ms (research/spike/REPORT.md §5.3).
- **A quiet machine:** the check times Node, so it runs alone. It decides nothing, and says so, unless the 1-minute load average was under 1 before its first run and under 2 after its last, the check's own process counting for up to 1. That's the load of the Linux machine the check runs in, on WSL2 its virtual machine. A check on a busy machine is run again, alone.
- **The rule:** the cap of 42 stands if the median over the runs of each run's worst call in Node (with 20 runs, the mean of the 10th and 11th), times 6.3, is at most 25 ms, to six significant figures. 6.3 is M0's ratio of a drawn step at 4× throttle in Chromium to a step in Node (183–195 µs against 27.8–31.2 µs). 25 ms is half of L286's 50 ms frame, leaving the other half for the tail M0 saw. The runs' maximum is reported beside it.
- **Otherwise** the cap becomes the largest value that meets it, never below w + 1, 13 (§10's check). The candidate is ⌊25 / 6.3 / m⌋ steps, and at most the cap measured less one, where m is the median over the runs of each worst call's milliseconds a step. The cap check runs again at it (section 1.12), and the rule again from those runs, so the cap steps down until one stands. The adoption's cost doesn't fall with the cap as its steps do, so a candidate may fail again. If the candidate is under w + 1, even w + 1 fails: the cap is w + 1, and the figures go to M4's bench and the phone's run. A cap under 42 also spreads a joiner's catch-up, which neither confirms nor votes while it runs (§2.8).
- **The profiles at a new cap:** the rules read no repair's correction, so the profiles aren't measured again at a new cap, unless a decisive profile's largest steps in a timer run, which results.json reports, exceed it. Then every profile is measured again at the new cap, and rules 1 to 3 with them.
- **In the browser,** M4's frame bench repeats a forced repair in throttled Chromium with its virtual peers (M3-Q14).

### 1.11 What decides nothing

- **A profile the base can't carry** isn't measured, and results.json lists it under `refused` with why. That's when, at its d:
  - TICK's 16-bit masks don't hold the input history, or a count overflows its byte (`wireLimits`);
  - the input history doesn't cover d + w ticks (PLAN §7.4);
  - d + w + v ticks aren't inside the state history;
  - or the spread's cap is under a normal tick's w + 1 steps.

  At the base none is. At w = 14, every d = 3 profile is. A run that includes the cap check stops before measuring anything if the base can't carry it. A run writes its file whenever its checks pass, so a run whose every profile was refused still lists them.
- **A rule that reads an unmeasured profile** is undecided, and names every such profile.
- **A smoke run decides nothing:** a rule is undecided if any profile it reads had fewer matches than §9.2's seeds (6, or 4 with loss), and the cap check is with fewer than 20 runs. The rule's text still says what the figures would decide, and ends "a smoke run, so it decides nothing", with the counts. Nor does a cap check on a busy machine, whose text gives the load (section 1.10).
- **Rule 3's next w that takes protocol 2, or none left,** decides nothing (section 1.9).
- **An undecided rule changes nothing** (§9.7): the value stays as A.4 has it. With rule 1 undecided, rules 2 and 3 are read at d = 2, and results.json says so.
- **The code:** results.json records the commit measured at, the trees of `src`, `dev` and `scripts` there, and whether the tree was clean. A run counts only at this report's commit with the tree clean, or at a later commit whose `src`, `dev` and `scripts` trees are this report's, as the results file under them shows.
- **A merge** refuses a file measured with another configuration, base, method or code than the first file's, or a merging process at another code than theirs. The method's figures, its limit on seeds, its number of cap runs and its quiet load all count. It also refuses a profile in two files, or the cap check in more than one, and then writes nothing. It carries every file's refused profiles, and decides the rules and the cap rule from the files' figures, the cap rule with the load the cap check's file recorded.
- **results.json is never overwritten** unless `TERRIEST_CORRECTIONS_OUT` names it. Without that variable, a run refuses once the file exists, as the tuning metrics refuse.
- **A run before this method's commit doesn't count** (§9.1).

### 1.12 Running it

From the repository's root, at this report's commit with the tree clean, on the development machine (WSL2), in Node 22.23.4 with vitest 4.1.12. `TERRIEST_CORRECTIONS_OUT` names the file a run writes. That file records the UTC time, Node's version, the CPU and its cores, the code, the base, the configuration and the method's figures. Every run writes its file in a folder outside the repository, `$OUT` below, so the tree stays clean from the first run to the last (section 1.11).

In one process, every profile, then the rules, then the cap check, on a quiet machine:

```sh
OUT="$(mktemp -d)"
TERRIEST_CORRECTIONS_OUT="$OUT/results.json" npx vitest run --config dev/corrections.vitest.config.ts
```

Or run the profiles in seven groups at once, each in its own process and file, then the cap check alone once the machine is quiet, then the merge. The merge measures nothing: it takes the profiles and the cap check from the files, and decides the rules from them.

```sh
OUT="$(mktemp -d)" PARTS="$(mktemp -d)"
run() {
  TERRIEST_CORRECTIONS_OUT="$PARTS/$1.json" TERRIEST_CORRECTIONS_ONLY="$2" \
    npx vitest run --config dev/corrections.vitest.config.ts > "$PARTS/$1.log" 2>&1
}
run pack1 'pack1-*' & run pack2 'pack2-*' & run pack3 'pack3-*' &
run pack4-30ms 'pack4-30ms-*-loss*' & run pack4-80ms 'pack4-80ms-*-loss*' &
run pack4-150ms 'pack4-150ms-*' & run mesh 'pack4-*-blocked*' &
wait
# A quiet machine for the cap check: the 1-minute load under 1, nothing else running.
while [ "$(awk '{ print ($1 < 1) }' /proc/loadavg)" != 1 ]; do sleep 15; done
run cap cap
TERRIEST_CORRECTIONS_MERGE="$(ls "$PARTS"/*.json | paste -sd, -)" \
TERRIEST_CORRECTIONS_OUT="$OUT/results.json" \
  npx vitest run --config dev/corrections.vitest.config.ts
```

- **The groups** hold every profile once: 84, 84, 84, 28, 28, 28 and 24 matches. `TERRIEST_CORRECTIONS_ONLY` picks profiles by name, with a `*` matching any characters, and `cap` picks the cap check. A pattern that picks nothing is an error.
- **The profiles run in virtual time,** so running them at once, or on a busy machine, changes only their wall times. **The cap check times Node,** so it runs alone, with nothing else running on the machine: no gate, and no other vitest. Its file records the load, and a busy one decides nothing (section 1.10).
- **The other variables stay unset.** `TERRIEST_CORRECTIONS_SEEDS` (a limit on a profile's seeds) and `TERRIEST_CORRECTIONS_CAP_RUNS` (the cap check's runs) make a smoke run when below §9.2's seeds or 20 runs. `TERRIEST_CORRECTIONS_BASE` measures from other settings.
- **The parts aren't committed:** results.json holds every profile and cap run they hold, and names each part with its time, Node, CPU and cores (`merged`).
- **The files are committed together** once the last run is done: results.json and every file for another base, copied unmodified from `$OUT` into `research/corrections/`. Until then the tree stays as this report's commit left it, so every run starts from a clean tree without a commit between runs.
- **Another base:** each rule's text gives the setting to measure next. Each run writes a file named for its base, committed beside results.json, never results.json itself:
  - Rule 3's next w: every profile and the cap check again, by the same commands with `TERRIEST_CORRECTIONS_BASE='{"lateWindowTicks":14}'` and `TERRIEST_CORRECTIONS_OUT="$OUT/w14.json"` in place of results.json, in the one-process command or the merge's.
  - The cap rule's next cap: the cap check alone, on a quiet machine, with `TERRIEST_CORRECTIONS_ONLY=cap`, `TERRIEST_CORRECTIONS_BASE='{"spreadMaxStepsPerTick":<cap>}'` and `TERRIEST_CORRECTIONS_OUT="$OUT/cap<cap>.json"`.

### 1.13 Where the decisions go (§9.7)

- **`src/config.ts`:** `inputDelayTicks` by rule 1, `smoothingMs` and `ownSmoothingMs` by rule 2, and `spreadMaxStepsPerTick` by the cap check, each changed only by its rule, decided. `lateWindowTicks` changes only if rule 3 confirms a next w, never for the lossy profiles' residual. A change of d changes the build hash only; a change of w re-emits the goldens.
- **PLAN:** A.4's rows for d and w, the spread and the smoothing, marked "M3, by measurement"; D-11, D-16 and §17's M3 entry; and a new C-row.
  - The C-row gives the lossy profiles' measured late inputs and resyncs beside the loss reach, and the partial mesh's beside the forwarding reach.
  - Its options, each with its reach and its costs: w = 12 and its residual, w = 14, w = 16 with protocol 2, and the unordered input channel (PLAN §21, roslambo D-13); for the mesh, w, a TURN relay and the unordered channel.
  - It also gives REQUIREMENTS' "about 0.4 s" for any change of w (M3-Q6, §15), and a rule 3 that went to the owner (section 1.9).
  - The C-row's options are the owner's.
- **`docs/acceptance.md`:** the measurement among its checks outside the gate, with the machine and the date.
- **None is an attended step:** D-16 and §17 have the values chosen from the measurement. M4's check of the glide with the bench's virtual peers is the next look.

### 1.14 What design §9 left open, made precise here

1. **The decisive corrections** are the steady ones (section 1.9). §9.5 leaves out a repair's, and this method also leaves out those across a phase's start.
2. **Rule 3's d** is rule 1's, as rule 2's is.
3. **The cap check's worst advance** is the slowest call of the repair, the STATE's adoption included, which steps up to the cap too.
4. **The largest cap that meets the rule** comes from the median milliseconds a step, below the cap measured, and is measured again there, stepping down until one stands.
5. **Your own terrier's glide** takes its largest candidate, 100 ms, when none passes, as the bodies' glide takes 200 ms.
6. **The bootstrap** resamples matches, seeded by the profile's name, with one set of draws a profile. Rule 1 pairs two profiles' replicates by index. Their resamplings are independent, though their matches share seeds.
7. **Percentiles** are by nearest rank, and the cap rule's median of an even count is the mean of the middle two.
8. **Moved** is any change above zero. The ball on the floor is reported, not ruled.
9. **Steps per advance** are over the timer runs that stepped. The runs that stepped nothing and the message calls are left out; a STATE adoption's steps are in the steps per tick.
10. **A match not ended** 600 s after genesis stops there, and counts, reported unended.
11. **The forced repair** holds browser 3's incoming links: the next TICK on each, and FIFO the rest.
12. **What's logged** is kept in memory and written as each profile's, match's and browser's figures and histograms, not correction by correction.
13. **The reach** takes the clocks' residual out of the (d + w) ticks, as §9.4's formula has it. At d = 2 that's 65.6 ms at w = 12, 76.7 ms at w = 14 and 87.8 ms at w = 16. §9.5's 71, 82 and 93 ms are before the residual is taken out, so w = 14 doesn't reach 80 ms at d = 2. At d = 3 it reaches 82.2 ms, which needs protocol 2.
14. **Rule 3 past what the harness can measure:** a next w that takes protocol 2 at rule 1's d, or none left past 18, decides nothing and goes to the owner; at w = 14 rule 1 is undecided, so d stays 2.
15. **Six significant figures** apply to the figures a rule derives as well as to those written, so a limit's edge decides as the text says.
16. **The cap check on a quiet machine:** its load is recorded, and a busy machine's check decides nothing.
17. **The code** is recorded with every results file, and a merge compares it.
18. **The profiles at a new cap** are measured again only if a decisive profile's largest steps in a timer run exceed it.

## 2. Results

Measured on 2026-11-20, from 03:15 to 04:37 UTC, at 71bd4a7, whose `src`, `dev` and `scripts` trees are this report's commit's (0ab6b24), with the tree clean at every run (section 2.9). In Node 22.23.4 with vitest 4.1.12, on the development machine: WSL2, 12 threads. Every run wrote its file outside the tree, and the files beside this report are those files, copied unmodified after the last run (section 1.12). The parts a merge took aren't committed; each merged file names them, with their times (`merged`).

### 2.1 The decisions

| Setting | Was | Now | By |
|---|---|---|---|
| `inputDelayTicks`, d | 2 | 2 | rule 1: d = 2 stays |
| `smoothingMs` | 100 ms | 200 ms | rule 2 |
| `ownSmoothingMs` | 50 ms | 100 ms | rule 2 |
| `lateWindowTicks`, w | 12 | 12 | rule 3: confirmed |
| `spreadMaxStepsPerTick` | 42 | 14 | the cap check, in five rounds |

- **The cap first** (section 1.10). The cap of 42 failed, and so did 31, 20 and 18; 14 stood (section 2.5). The decisive profiles' largest steps in a timer run, in `results.json`, were 42 at the loss-free 80 ms profiles at pack sizes 2 to 4, over 14, so every profile was measured again at the cap of 14, in `cap14.json`, and rules 1 to 3 read again from it. They decide as they did at 42, figure for figure: the lower cap changed how some advances spread, not the loss-free matches, all 168 of which ended at the same tick with the same score at both caps, and no steady p95 at a loss-free profile differs by more than 0.07%. The decisions above are `cap14.json`'s.
- **Rule 1,** in its own words: "d = 2 stays: the p95 ball correction falls from d = 2 to d = 3, at the loss-free 80 ms profiles, by pack size 1: 12.3% [-12.2%, 32.0%]; pack size 2: 25.0% [-14.0%, 38.8%]; pack size 3: 30.6% [3.2%, 38.9%]; pack size 4: 35.8% [17.3%, 56.5%]; d = 3 needs at least 25.0% at every pack size, its interval wholly above it". Pack size 2's fall is 24.95% to six figures, under 25%, and no interval lies wholly above 25%.
- **Rule 2, the bodies:** "200 ms, the smallest of 50, 100, 150, 200 that passes: the p95s at their intervals' upper ends, pack size 1: ball 0.217 m, remote 0.0694 m, headings 56.3 °; pack size 2: ball 0.248 m, remote 0.0674 m, headings 56.3 °; pack size 3: ball 0.225 m, remote 0.0692 m, headings 59.3 °; pack size 4: ball 0.201 m, remote 0.0654 m, headings 60.0 °; over the glide each at most ball 3.00 m/s, remote 3.00 m/s, headings 360 °/s". The headings decide it: they need 156 to 167 ms, so 150 ms fails.
- **Rule 2, your own terrier:** "100 ms, the smallest of 25, 50, 100 that passes: the p95s at their intervals' upper ends, pack size 1: own 0.0985 m, ownHeadings 21.8 °; pack size 2: own 0.0626 m, ownHeadings 12.0 °; pack size 3: own 0.0343 m, ownHeadings 29.1 °; pack size 4: own 0.0314 m, ownHeadings 24.2 °; over the glide each at most own 3.00 m/s, ownHeadings 360 °/s". The headings need 33 to 81 ms, so 50 ms fails at three pack sizes.
- **Rule 3:** "w = 12, at d = 2: confirmed: lateAbsent at most 0.5% of the remote inputs and resyncs at most 1 a browser-minute at every pack size; the most: lateAbsent 0.0% of the remote inputs, resyncs 0 a browser-minute". At all 16 profiles it reads, at both caps, no input was finalised absent here and then arrived, and no browser resynced. So no next w was measured, and the goldens stay.
- **The cap:** "the cap of 14 stands: the median of 20 runs' worst spread advance 3.90 ms in Node, × 6.3 = 24.5 ms against 25 ms; their maximum 5.74 ms".
- **As known before it:** phase 5a's runs had fixed rule 2's values at d = 2 (this report's header), and the measurement agrees. None of the values is an attended step (section 1.13).

### 2.2 The decisive figures

Rule 1, the steady p95 ball correction at the loss-free 80 ms profiles, at the cap of 14 and the same at 42:

| Pack size | Ball p95 at d = 2, m | At d = 3, m | Fall | Its interval | Passes |
|---|---|---|---|---|---|
| 1 | 0.17 | 0.149 | 12.27% | [-12.2%, 32.0%] | no |
| 2 | 0.206 | 0.155 | 24.95% | [-14.0%, 38.8%] | no |
| 3 | 0.201 | 0.139 | 30.62% | [3.2%, 38.9%] | no |
| 4 | 0.171 | 0.11 | 35.79% | [17.3%, 56.5%] | no |

Rule 2, each steady p95 at its interval's upper end, and the least glide over which each keeps to its limit (3 m/s, 360° a second), at d = 2:

| Pack size | Ball, m | Remote terriers, m | Their headings, ° | Least, ms | Driven terrier, m | Its heading, ° | Least, ms |
|---|---|---|---|---|---|---|---|
| 1 | 0.217 | 0.0694 | 56.3 | 156 | 0.0985 | 21.8 | 60.4 |
| 2 | 0.248 | 0.0674 | 56.3 | 156 | 0.0626 | 12 | 33.3 |
| 3 | 0.225 | 0.0692 | 59.3 | 165 | 0.0343 | 29.1 | 80.7 |
| 4 | 0.201 | 0.0654 | 60 | 167 | 0.0314 | 24.2 | 67.2 |

The steady p95s with their 90% intervals at the loss-free 80 ms profiles:

| Profile | Ball, m | Remote terriers, m | Their headings, ° | Driven terrier, m | Its heading, ° |
|---|---|---|---|---|---|
| pack1-80ms-d2-loss0 | 0.17 [0.135, 0.217] | 0.0668 [0.0652, 0.0694] | 48 [48, 56.3] | 0.0312 [0.0241, 0.0985] | 21.8 [0, 21.8] |
| pack1-80ms-d3-loss0 | 0.149 [0.127, 0.161] | 0.04 [0.038, 0.044] | 45 [36, 48] | 0.00993 [0.00884, 0.0123] | 0 [0, 0] |
| pack2-80ms-d2-loss0 | 0.206 [0.143, 0.248] | 0.0666 [0.0657, 0.0674] | 48 [48, 56.3] | 0.0371 [0.031, 0.0626] | 12 [0, 12] |
| pack2-80ms-d3-loss0 | 0.155 [0.139, 0.19] | 0.0405 [0.0402, 0.0412] | 45 [44.3, 45] | 0.0305 [0.0173, 0.0383] | 36 [0, 36] |
| pack3-80ms-d2-loss0 | 0.201 [0.148, 0.225] | 0.0682 [0.0662, 0.0692] | 56.3 [48, 59.3] | 0.03 [0.0249, 0.0343] | 29.1 [28.3, 29.1] |
| pack3-80ms-d3-loss0 | 0.139 [0.136, 0.146] | 0.0394 [0.0392, 0.0397] | 48 [46.5, 48] | 0.0154 [0.0136, 0.0229] | 29.1 [29.1, 29.1] |
| pack4-80ms-d2-loss0 | 0.171 [0.152, 0.201] | 0.0638 [0.0616, 0.0654] | 56.3 [54.8, 60] | 0.0279 [0.0239, 0.0314] | 24.2 [22.6, 24.2] |
| pack4-80ms-d3-loss0 | 0.11 [0.0746, 0.135] | 0.0387 [0.038, 0.039] | 45 [45, 48] | 0.0139 [0.012, 0.0161] | 24.2 [24.2, 24.2] |

### 2.3 Every profile, at the cap of 14

`cap14.json`'s figures. `results.json` holds the same at the cap of 42. At the lossy profiles 104 of its 192 matches end differently, as a repair's steps spread further at the lower cap, and so their rates differ a little; the C-row's table (section 2.6) gives them at 14.

**The steady corrections:** those that moved the body, weren't a repair's and didn't cross a phase's start. Each cell is p50 / p95 / max; n counts the corrections, and a dash means none moved that body.

| Profile | n | Ball, m | Remote terriers, m | Their headings, ° | Driven terrier, m | Its heading, ° | Depth, ticks |
|---|---|---|---|---|---|---|---|
| pack1-30ms-d2-loss0 | 6744 | 0.00033 / 0.0895 / 0.158 | 0.00153 / 0.0135 / 0.389 | 11.3 / 24 / 72 | 0.00058 / 0.0176 / 0.0248 | – | 1 / 2 / 15 |
| pack1-30ms-d2-loss0.1 | 4201 | 0.00031 / 0.14 / 0.158 | 0.00182 / 0.016 / 0.389 | 11.3 / 24 / 72 | 0.00058 / 0.0176 / 0.0248 | – | 1 / 2 / 15 |
| pack1-30ms-d2-loss0.5 | 4529 | 0.00024 / 0.101 / 0.344 | 0.00163 / 0.0162 / 0.407 | 11.3 / 24 / 72 | 0.00021 / 0.0176 / 0.0223 | – | 1 / 2 / 15 |
| pack1-30ms-d3-loss0 | 2217 | 0.00014 / 0.0571 / 0.063 | 0.00085 / 0.00503 / 0.211 | 11.3 / 12 / 24 | 0.00013 / 0.00018 / 0.00018 | – | 1 / 1 / 15 |
| pack1-30ms-d3-loss0.1 | 1779 | 0.00014 / 0.0615 / 0.063 | 0.00085 / 0.00501 / 0.211 | 11.3 / 12 / 36 | 0.00018 / 0.00023 / 0.00023 | – | 1 / 1 / 15 |
| pack1-30ms-d3-loss0.5 | 1452 | 0.00014 / 0.0615 / 0.0741 | 0.00095 / 0.0052 / 0.211 | 11.3 / 20.3 / 48 | 0.00013 / 0.00023 / 0.00023 | – | 1 / 2 / 15 |
| pack1-80ms-d2-loss0 | 10444 | 0.0016 / 0.17 / 0.416 | 0.0117 / 0.0668 / 0.994 | 11.3 / 48 / 120 | 0.00089 / 0.0312 / 0.131 | 11.3 / 21.8 / 21.8 | 4 / 5 / 18 |
| pack1-80ms-d2-loss0.1 | 6631 | 0.00173 / 0.165 / 0.738 | 0.012 / 0.0707 / 0.807 | 11.3 / 51 / 144 | 0.00188 / 0.0314 / 0.338 | – | 4 / 5 / 18 |
| pack1-80ms-d2-loss0.5 | 6441 | 0.00212 / 0.221 / 0.528 | 0.0135 / 0.21 / 1.65 | 11.3 / 53.3 / 144 | 0.00132 / 0.069 / 0.177 | 12 / 12 / 12 | 4 / 11 / 18 |
| pack1-80ms-d3-loss0 | 10691 | 0.00106 / 0.149 / 0.338 | 0.00685 / 0.04 / 0.809 | 11.3 / 45 / 96 | 0.00051 / 0.00993 / 0.0232 | – | 3 / 4 / 18 |
| pack1-80ms-d3-loss0.1 | 6915 | 0.00126 / 0.149 / 0.374 | 0.00633 / 0.0411 / 0.789 | 11.3 / 43.5 / 135 | 0.00045 / 0.0215 / 0.174 | – | 3 / 4 / 18 |
| pack1-80ms-d3-loss0.5 | 6604 | 0.00124 / 0.19 / 0.464 | 0.00786 / 0.18 / 0.631 | 11.3 / 48 / 144 | 0.0009 / 0.0467 / 0.0705 | 24 / 24 / 24 | 3 / 11 / 18 |
| pack1-150ms-d2-loss0 | 10073 | 0.00932 / 0.353 / 0.909 | 0.0537 / 0.252 / 1.79 | 11.3 / 96 / 180 | 0.00937 / 0.119 / 0.212 | 71.3 / 71.3 / 71.3 | 8 / 9 / 22 |
| pack1-150ms-d2-loss0.1 | 6159 | 0.00636 / 0.307 / 0.769 | 0.0496 / 0.258 / 1.75 | 11.3 / 96 / 179 | 0.00579 / 0.107 / 0.181 | 11.3 / 84 / 84 | 8 / 9 / 22 |
| pack1-150ms-d2-loss0.5 | 7266 | 0.0118 / 0.322 / 0.84 | 0.061 / 0.338 / 1.79 | 11.3 / 96 / 180 | 0.0123 / 0.139 / 0.267 | 11.3 / 48 / 48 | 8 / 12 / 22 |
| pack1-150ms-d3-loss0 | 9605 | 0.00515 / 0.321 / 0.832 | 0.0362 / 0.188 / 1.79 | 11.3 / 84 / 180 | 0.00379 / 0.0546 / 0.177 | 24 / 48 / 48 | 7 / 8 / 22 |
| pack1-150ms-d3-loss0.1 | 7314 | 0.00554 / 0.213 / 0.744 | 0.0373 / 0.199 / 2.07 | 11.3 / 84 / 180 | 0.00308 / 0.0559 / 0.119 | 12 / 12 / 12 | 7 / 8 / 22 |
| pack1-150ms-d3-loss0.5 | 7608 | 0.00634 / 0.214 / 0.749 | 0.0442 / 0.278 / 1.96 | 11.3 / 84 / 179 | 0.00608 / 0.0921 / 0.359 | 23.3 / 45 / 45 | 7 / 12 / 22 |
| pack2-30ms-d2-loss0 | 40206 | 0.00028 / 0.104 / 0.224 | 0.00203 / 0.014 / 0.548 | 11.3 / 24 / 72 | 0.00028 / 0.00873 / 0.0281 | – | 1 / 2 / 15 |
| pack2-30ms-d2-loss0.1 | 35072 | 0.00022 / 0.0782 / 0.263 | 0.00203 / 0.014 / 0.587 | 11.3 / 24 / 72 | 0.00011 / 0.00868 / 0.143 | 12 / 12 / 12 | 1 / 2 / 15 |
| pack2-30ms-d2-loss0.5 | 20657 | 0.00025 / 0.0785 / 0.22 | 0.00181 / 0.0148 / 0.489 | 11.3 / 24 / 104 | 0.000065 / 0.00871 / 0.0232 | – | 1 / 2 / 16 |
| pack2-30ms-d3-loss0 | 17820 | 0.00012 / 0.0693 / 0.192 | 0.00112 / 0.00512 / 0.411 | 11.3 / 12 / 48 | 0.000089 / 0.00074 / 0.00074 | – | 1 / 1 / 15 |
| pack2-30ms-d3-loss0.1 | 9800 | 0.00018 / 0.0816 / 0.145 | 0.00113 / 0.00519 / 0.385 | 11.3 / 12 / 48 | 0.00012 / 0.0109 / 0.0109 | – | 1 / 2 / 15 |
| pack2-30ms-d3-loss0.5 | 10048 | 0.0002 / 0.0816 / 0.111 | 0.00123 / 0.00732 / 0.448 | 11.3 / 21 / 72 | 0.00012 / 0.00224 / 0.0109 | – | 1 / 2 / 16 |
| pack2-80ms-d2-loss0 | 45084 | 0.00162 / 0.206 / 0.501 | 0.0132 / 0.0666 / 1.04 | 11.3 / 48 / 144 | 0.00184 / 0.0371 / 0.214 | 12 / 12 / 12 | 4 / 5 / 50 |
| pack2-80ms-d2-loss0.1 | 42504 | 0.00153 / 0.227 / 0.993 | 0.0137 / 0.0715 / 1.31 | 11.3 / 56.3 / 144 | 0.00155 / 0.0277 / 8 | 47.9 / 47.9 / 47.9 | 4 / 5 / 48 |
| pack2-80ms-d2-loss0.5 | 44227 | 0.00188 / 0.216 / 0.908 | 0.0161 / 0.174 / 8 | 11.3 / 56.3 / 144 | 0.00212 / 0.0638 / 8 | 12 / 47.9 / 47.9 | 4 / 11 / 48 |
| pack2-80ms-d3-loss0 | 54918 | 0.00097 / 0.155 / 0.417 | 0.00714 / 0.0405 / 1.03 | 11.3 / 45 / 120 | 0.00124 / 0.0305 / 0.162 | 36 / 36 / 36 | 3 / 4 / 50 |
| pack2-80ms-d3-loss0.1 | 33057 | 0.00106 / 0.133 / 0.705 | 0.00768 / 0.0463 / 1.26 | 11.3 / 48 / 144 | 0.00132 / 0.0201 / 0.121 | 36 / 36 / 36 | 3 / 4 / 48 |
| pack2-80ms-d3-loss0.5 | 36994 | 0.00133 / 0.14 / 0.554 | 0.00794 / 0.142 / 8 | 11.3 / 48 / 144 | 0.0008 / 0.0919 / 8 | 12 / 47.9 / 47.9 | 3 / 11 / 48 |
| pack2-150ms-d2-loss0 | 62315 | 0.0077 / 0.369 / 0.911 | 0.0609 / 0.227 / 2.26 | 11.3 / 96 / 180 | 0.00662 / 0.142 / 8 | 45 / 84 / 84 | 8 / 9 / 45 |
| pack2-150ms-d2-loss0.1 | 43563 | 0.00767 / 0.333 / 0.998 | 0.0601 / 0.239 / 2.02 | 11.3 / 96 / 180 | 0.00642 / 0.106 / 8 | 36 / 96 / 96 | 8 / 9 / 45 |
| pack2-150ms-d2-loss0.5 | 51798 | 0.0081 / 0.292 / 0.835 | 0.0935 / 0.306 / 2.33 | 11.3 / 96 / 179 | 0.0118 / 0.128 / 8 | 47.9 / 47.9 / 47.9 | 8 / 12 / 45 |
| pack2-150ms-d3-loss0 | 52789 | 0.00555 / 0.253 / 1 | 0.0442 / 0.175 / 1.91 | 11.3 / 84 / 180 | 0.0054 / 0.0856 / 8 | 47.9 / 60 / 60 | 7 / 8 / 45 |
| pack2-150ms-d3-loss0.1 | 41295 | 0.00561 / 0.212 / 0.752 | 0.042 / 0.183 / 2.38 | 11.3 / 84 / 179 | 0.00475 / 0.0949 / 8 | 36.8 / 48.8 / 48.8 | 7 / 8 / 45 |
| pack2-150ms-d3-loss0.5 | 30926 | 0.00746 / 0.307 / 0.713 | 0.0507 / 0.255 / 2 | 11.3 / 84 / 179 | 0.00584 / 0.119 / 8 | 22.5 / 47.9 / 47.9 | 7 / 11 / 45 |
| pack3-30ms-d2-loss0 | 64857 | 0.00019 / 0.0672 / 0.213 | 0.00208 / 0.0143 / 0.8 | 11.3 / 24 / 72 | 0.00039 / 0.00601 / 0.0442 | – | 1 / 2 / 16 |
| pack3-30ms-d2-loss0.1 | 42598 | 0.00026 / 0.0845 / 0.273 | 0.00223 / 0.0143 / 0.694 | 11.3 / 24 / 72 | 0.00037 / 0.00601 / 0.0442 | – | 1 / 2 / 16 |
| pack3-30ms-d2-loss0.5 | 52532 | 0.00032 / 0.0944 / 0.327 | 0.0022 / 0.0146 / 0.584 | 11.3 / 24 / 144 | 0.00024 / 0.006 / 0.107 | – | 1 / 2 / 16 |
| pack3-30ms-d3-loss0 | 44930 | 0.00011 / 0.0658 / 0.0997 | 0.00112 / 0.00504 / 0.301 | 11.3 / 12 / 48 | 0.00029 / 0.0019 / 0.00377 | – | 1 / 2 / 16 |
| pack3-30ms-d3-loss0.1 | 49199 | 0.00014 / 0.0626 / 0.351 | 0.00107 / 0.00514 / 0.405 | 11.3 / 14.3 / 96 | 0.00017 / 0.0021 / 0.00748 | – | 1 / 2 / 16 |
| pack3-30ms-d3-loss0.5 | 30462 | 0.00017 / 0.0584 / 0.321 | 0.00117 / 0.00601 / 0.795 | 11.3 / 22.5 / 96 | 0.00021 / 0.00202 / 0.0202 | – | 1 / 2 / 16 |
| pack3-80ms-d2-loss0 | 164203 | 0.0014 / 0.201 / 0.542 | 0.0133 / 0.0682 / 7.81 | 11.3 / 56.3 / 144 | 0.00222 / 0.03 / 7.81 | 23.3 / 29.1 / 29.1 | 4 / 5 / 71 |
| pack3-80ms-d2-loss0.1 | 130353 | 0.00173 / 0.219 / 0.931 | 0.0143 / 0.071 / 7.81 | 11.3 / 56.3 / 144 | 0.00235 / 0.023 / 7.81 | 24 / 29.1 / 29.1 | 4 / 5 / 71 |
| pack3-80ms-d2-loss0.5 | 94078 | 0.00242 / 0.2 / 1.14 | 0.0168 / 0.157 / 7.81 | 11.3 / 60 / 144 | 0.00234 / 0.0947 / 7.81 | 28.3 / 29.1 / 29.1 | 4 / 11 / 82 |
| pack3-80ms-d3-loss0 | 290641 | 0.0009 / 0.139 / 0.425 | 0.00688 / 0.0394 / 7.81 | 11.3 / 48 / 120 | 0.00126 / 0.0154 / 7.81 | 29.1 / 29.1 / 29.1 | 3 / 4 / 71 |
| pack3-80ms-d3-loss0.1 | 140924 | 0.00094 / 0.153 / 0.923 | 0.00761 / 0.0462 / 7.81 | 11.3 / 48 / 144 | 0.0014 / 0.0227 / 7.81 | 29.1 / 29.1 / 29.1 | 3 / 4 / 71 |
| pack3-80ms-d3-loss0.5 | 136877 | 0.00132 / 0.169 / 0.773 | 0.00813 / 0.138 / 7.81 | 11.3 / 48 / 169 | 0.00141 / 0.0399 / 7.81 | 29.1 / 29.1 / 29.1 | 3 / 11 / 82 |
| pack3-150ms-d2-loss0 | 152547 | 0.00775 / 0.358 / 1.05 | 0.0593 / 0.236 / 10 | 11.3 / 96 / 180 | 0.0102 / 0.0928 / 10 | 29.1 / 60 / 72 | 8 / 9 / 69 |
| pack3-150ms-d2-loss0.1 | 96107 | 0.00744 / 0.331 / 0.924 | 0.0573 / 0.242 / 10 | 11.3 / 96 / 180 | 0.0105 / 0.0934 / 10 | 29.1 / 71.3 / 71.3 | 8 / 10 / 69 |
| pack3-150ms-d2-loss0.5 | 71112 | 0.0101 / 0.323 / 0.905 | 0.0707 / 0.289 / 2.13 | 11.3 / 96 / 180 | 0.0128 / 0.373 / 10 | 29.1 / 58.1 / 58.1 | 8 / 11 / 69 |
| pack3-150ms-d3-loss0 | 105707 | 0.0061 / 0.244 / 0.769 | 0.0426 / 0.172 / 10 | 11.3 / 84 / 180 | 0.0071 / 0.0712 / 10 | 29.1 / 58.1 / 58.1 | 7 / 8 / 69 |
| pack3-150ms-d3-loss0.1 | 104289 | 0.00613 / 0.287 / 0.745 | 0.0451 / 0.185 / 10 | 11.3 / 84 / 180 | 0.00904 / 0.0827 / 10 | 29.1 / 58.1 / 58.1 | 7 / 9 / 69 |
| pack3-150ms-d3-loss0.5 | 120984 | 0.00643 / 0.223 / 0.717 | 0.0739 / 0.301 / 10 | 11.3 / 87 / 179 | 0.0101 / 0.155 / 10 | 29.1 / 58.1 / 58.1 | 7 / 12 / 69 |
| pack4-30ms-d2-loss0 | 130952 | 0.00031 / 0.0891 / 0.203 | 0.00193 / 0.0138 / 0.599 | 11.3 / 24 / 72 | 0.00032 / 0.00494 / 0.0599 | – | 1 / 2 / 16 |
| pack4-30ms-d2-loss0.1 | 73197 | 0.0002 / 0.0845 / 0.285 | 0.00199 / 0.014 / 0.741 | 11.3 / 24 / 118 | 0.00033 / 0.0058 / 0.0293 | – | 1 / 2 / 16 |
| pack4-30ms-d2-loss0.5 | 77158 | 0.00031 / 0.0809 / 0.331 | 0.00203 / 0.0143 / 0.73 | 11.3 / 24 / 120 | 0.0004 / 0.00566 / 0.0183 | – | 1 / 3 / 16 |
| pack4-30ms-d3-loss0 | 67749 | 0.00014 / 0.0746 / 0.207 | 0.00112 / 0.00515 / 0.488 | 11.3 / 12 / 48 | 0.00023 / 0.00196 / 0.00803 | – | 1 / 2 / 16 |
| pack4-30ms-d3-loss0.1 | 43986 | 0.00011 / 0.0676 / 0.18 | 0.00118 / 0.00521 / 0.488 | 11.3 / 15.8 / 89.2 | 0.00022 / 0.00222 / 0.0112 | – | 1 / 2 / 16 |
| pack4-30ms-d3-loss0.5 | 41528 | 0.00014 / 0.0632 / 0.253 | 0.00123 / 0.00937 / 0.552 | 11.3 / 22.5 / 83.3 | 0.00024 / 0.00473 / 0.0195 | – | 1 / 2 / 16 |
| pack4-80ms-d2-loss0 | 191523 | 0.00182 / 0.171 / 0.512 | 0.0123 / 0.0638 / 6 | 11.3 / 56.3 / 144 | 0.00239 / 0.0279 / 6 | 11.3 / 24.2 / 24.2 | 4 / 5 / 95 |
| pack4-80ms-d2-loss0.1 | 199883 | 0.00143 / 0.224 / 0.936 | 0.0126 / 0.0705 / 6 | 11.3 / 60 / 144 | 0.00263 / 0.0322 / 6 | 12 / 24.2 / 24.2 | 4 / 5 / 94 |
| pack4-80ms-d2-loss0.5 | 157876 | 0.00274 / 0.186 / 0.97 | 0.0144 / 0.144 / 6 | 11.3 / 60 / 168 | 0.00336 / 0.0797 / 6 | 24 / 24.2 / 24.2 | 4 / 11 / 96 |
| pack4-80ms-d3-loss0 | 181449 | 0.001 / 0.11 / 0.342 | 0.00666 / 0.0387 / 6 | 11.3 / 45 / 120 | 0.00137 / 0.0139 / 6 | 24.2 / 24.2 / 24.2 | 3 / 4 / 95 |
| pack4-80ms-d3-loss0.1 | 135586 | 0.00114 / 0.171 / 0.556 | 0.00668 / 0.041 / 6 | 11.3 / 48 / 169 | 0.00153 / 0.0235 / 6 | 24.2 / 24.2 / 24.2 | 3 / 4 / 93 |
| pack4-80ms-d3-loss0.5 | 122596 | 0.00167 / 0.144 / 0.81 | 0.00773 / 0.138 / 6 | 11.3 / 48 / 169 | 0.00211 / 0.11 / 6 | 24.2 / 24.2 / 24.2 | 3 / 11 / 96 |
| pack4-150ms-d2-loss0 | 368508 | 0.00702 / 0.234 / 1.05 | 0.0503 / 0.22 / 10.8 | 11.3 / 96 / 180 | 0.0109 / 0.0909 / 10.8 | 24.2 / 49 / 84 | 8 / 10 / 103 |
| pack4-150ms-d2-loss0.1 | 209782 | 0.0093 / 0.344 / 0.935 | 0.0528 / 0.234 / 10.8 | 11.3 / 96 / 180 | 0.0112 / 0.0954 / 10.8 | 33.8 / 72 / 169 | 8 / 10 / 69 |
| pack4-150ms-d2-loss0.5 | 302222 | 0.0114 / 0.355 / 0.944 | 0.101 / 0.322 / 10.8 | 11.3 / 96 / 180 | 0.0182 / 0.124 / 10.8 | 49 / 145 / 145 | 8 / 12 / 76 |
| pack4-150ms-d3-loss0 | 227227 | 0.0065 / 0.275 / 0.865 | 0.0376 / 0.166 / 10.8 | 11.3 / 84 / 180 | 0.00912 / 0.0771 / 10.8 | 24.2 / 49 / 63.8 | 7 / 9 / 103 |
| pack4-150ms-d3-loss0.1 | 167479 | 0.00563 / 0.256 / 0.94 | 0.0383 / 0.175 / 10.8 | 11.3 / 89.3 / 180 | 0.0101 / 0.0771 / 10.8 | 24.2 / 121 / 121 | 7 / 9 / 69 |
| pack4-150ms-d3-loss0.5 | 209746 | 0.00894 / 0.259 / 0.648 | 0.0739 / 0.306 / 10.8 | 11.3 / 88.5 / 180 | 0.0147 / 0.136 / 10.8 | 49 / 97 / 97 | 7 / 12 / 76 |
| pack4-30ms-d2-blocked1 | 168351 | 0.00032 / 0.09 / 0.393 | 0.00215 / 0.0157 / 0.729 | 11.3 / 24 / 120 | 0.00044 / 0.00632 / 0.0243 | – | 1 / 3 / 15 |
| pack4-30ms-d2-blocked2 | 113039 | 0.00029 / 0.0876 / 0.486 | 0.00244 / 0.0189 / 0.726 | 11.3 / 24 / 120 | 0.00031 / 0.00573 / 0.0792 | 36 / 36 / 36 | 1 / 4 / 15 |
| pack4-80ms-d2-blocked1 | 167512 | 0.00193 / 0.207 / 0.937 | 0.0137 / 0.0741 / 6 | 11.3 / 56.3 / 179 | 0.0025 / 0.0273 / 6 | 24.2 / 60 / 60 | 4 / 6 / 83 |
| pack4-80ms-d2-blocked2 | 213937 | 0.00223 / 0.218 / 0.98 | 0.0143 / 0.103 / 6 | 11.3 / 60 / 180 | 0.00255 / 0.029 / 6 | 22.6 / 24.2 / 24.2 | 4 / 10 / 82 |

**The placed corrections,** across a phase's start. None moved the ball.

| Profile | n | Remote terriers, m | Their headings, ° | Driven terrier, m | Its heading, ° |
|---|---|---|---|---|---|
| pack1-30ms-d2-loss0 | 9 | 9.74 / 18.7 / 18.7 | 136 / 179 / 179 | 9.73 / 22.4 / 22.4 | 124 / 148 / 148 |
| pack1-30ms-d2-loss0.1 | 6 | 7.83 / 9.8 / 9.8 | 33.8 / 136 / 136 | 7.42 / 9.8 / 9.8 | 21.8 / 148 / 148 |
| pack1-30ms-d2-loss0.5 | 6 | 7.83 / 9.8 / 9.8 | 33.8 / 148 / 148 | 7.42 / 9.81 / 9.81 | 21.8 / 148 / 148 |
| pack1-30ms-d3-loss0 | 2 | 7.73 / 9.2 / 9.2 | 12 / 23.3 / 23.3 | 6.53 / 7.42 / 7.42 | 33 / 146 / 146 |
| pack1-30ms-d3-loss0.1 | 2 | 7.73 / 9.2 / 9.2 | 12 / 23.3 / 23.3 | 6.53 / 7.42 / 7.42 | 33 / 146 / 146 |
| pack1-30ms-d3-loss0.5 | 3 | 7.73 / 9.2 / 9.2 | 23.3 / 136 / 136 | 7.42 / 9.6 / 9.6 | 33 / 146 / 146 |
| pack1-80ms-d2-loss0 | 12 | 9.18 / 22.3 / 22.3 | 56.3 / 180 / 180 | 9.08 / 22.3 / 22.3 | 75.8 / 164 / 164 |
| pack1-80ms-d2-loss0.1 | 8 | 7.28 / 10.1 / 10.1 | 48 / 180 / 180 | 7.33 / 10.1 / 10.1 | 121 / 164 / 164 |
| pack1-80ms-d2-loss0.5 | 8 | 7.28 / 10 / 10 | 45 / 180 / 180 | 7.38 / 10.1 / 10.1 | 133 / 144 / 144 |
| pack1-80ms-d3-loss0 | 12 | 9.1 / 22.2 / 22.2 | 56.3 / 180 / 180 | 9 / 22.2 / 22.2 | 96.8 / 172 / 172 |
| pack1-80ms-d3-loss0.1 | 8 | 7.31 / 9.96 / 9.96 | 45 / 180 / 180 | 7.32 / 9.97 / 9.97 | 122 / 172 / 172 |
| pack1-80ms-d3-loss0.5 | 8 | 7.31 / 9.96 / 9.96 | 45 / 180 / 180 | 7.32 / 9.97 / 9.97 | 122 / 172 / 172 |
| pack1-150ms-d2-loss0 | 12 | 9.21 / 20 / 20 | 90 / 169 / 169 | 9.13 / 20.1 / 20.1 | 60.8 / 73.5 / 73.5 |
| pack1-150ms-d2-loss0.1 | 7 | 6.97 / 10.2 / 10.2 | 108 / 169 / 169 | 8.13 / 10.6 / 10.6 | 60.8 / 73.5 / 73.5 |
| pack1-150ms-d2-loss0.5 | 8 | 8.02 / 10.5 / 10.5 | 56.3 / 169 / 169 | 8.08 / 15.2 / 15.2 | 72.8 / 72.8 / 72.8 |
| pack1-150ms-d3-loss0 | 12 | 9.13 / 20 / 20 | 90 / 169 / 169 | 9.06 / 20 / 20 | 39.8 / 92.3 / 92.3 |
| pack1-150ms-d3-loss0.1 | 8 | 7.07 / 13.6 / 13.6 | 56.3 / 169 / 169 | 6.71 / 10.4 / 10.4 | 72.8 / 92.3 / 92.3 |
| pack1-150ms-d3-loss0.5 | 8 | 6.56 / 10.4 / 10.4 | 45 / 169 / 169 | 6.68 / 16.4 / 16.4 | 84.8 / 96.8 / 96.8 |
| pack2-30ms-d2-loss0 | 22 | 10.7 / 18.4 / 23.5 | 96.8 / 177 / 179 | 10.8 / 18.4 / 23.5 | 77.2 / 176 / 177 |
| pack2-30ms-d2-loss0.1 | 15 | 8.93 / 18.4 / 18.4 | 78 / 177 / 177 | 9.16 / 18.4 / 18.4 | 66 / 177 / 177 |
| pack2-30ms-d2-loss0.5 | 15 | 8.93 / 18.4 / 18.4 | 78 / 177 / 177 | 9.16 / 18.4 / 18.4 | 66 / 177 / 177 |
| pack2-30ms-d3-loss0 | 9 | 11.5 / 23.5 / 23.5 | 110 / 171 / 171 | 11.5 / 23.5 / 23.5 | 43.5 / 160 / 160 |
| pack2-30ms-d3-loss0.1 | 6 | 9.06 / 18 / 18 | 110 / 171 / 171 | 9.06 / 13.5 / 13.5 | 122 / 160 / 160 |
| pack2-30ms-d3-loss0.5 | 7 | 8.44 / 17.5 / 18 | 77.3 / 171 / 171 | 10.6 / 17.5 / 17.5 | 33.7 / 160 / 160 |
| pack2-80ms-d2-loss0 | 24 | 9.07 / 20.4 / 20.6 | 71.3 / 173 / 180 | 9.07 / 20.4 / 20.6 | 57.7 / 153 / 153 |
| pack2-80ms-d2-loss0.1 | 16 | 6.86 / 20.4 / 20.4 | 72 / 164 / 169 | 6.86 / 20.4 / 20.4 | 52.5 / 140 / 140 |
| pack2-80ms-d2-loss0.5 | 17 | 7.94 / 20.4 / 20.4 | 64.5 / 169 / 176 | 7.91 / 17 / 17 | 46.5 / 116 / 116 |
| pack2-80ms-d3-loss0 | 24 | 8.38 / 20.5 / 20.7 | 76.5 / 169 / 180 | 8.38 / 20.5 / 20.7 | 71.3 / 144 / 177 |
| pack2-80ms-d3-loss0.1 | 16 | 6.91 / 20.7 / 20.7 | 64.5 / 169 / 169 | 6.91 / 20.7 / 20.7 | 69 / 140 / 140 |
| pack2-80ms-d3-loss0.5 | 15 | 6.94 / 17.4 / 20.7 | 76.5 / 164 / 169 | 7.9 / 20.7 / 20.7 | 24.8 / 140 / 140 |
| pack2-150ms-d2-loss0 | 24 | 7.83 / 18.6 / 21.1 | 49.5 / 158 / 169 | 7.82 / 18.6 / 21.1 | 38.3 / 73.5 / 73.5 |
| pack2-150ms-d2-loss0.1 | 16 | 7.23 / 21.1 / 21.1 | 61.5 / 158 / 158 | 7.25 / 21.1 / 21.1 | 38.3 / 72 / 72 |
| pack2-150ms-d2-loss0.5 | 15 | 7.84 / 21.1 / 21.1 | 49.5 / 158 / 169 | 7.83 / 21.1 / 21.1 | 38.3 / 61.5 / 61.5 |
| pack2-150ms-d3-loss0 | 24 | 7.79 / 18.5 / 21.1 | 51 / 158 / 169 | 7.78 / 18.4 / 21.1 | 32.3 / 85.5 / 85.5 |
| pack2-150ms-d3-loss0.1 | 16 | 7.03 / 20.9 / 20.9 | 72.8 / 158 / 158 | 7.05 / 20.9 / 20.9 | 28.5 / 84 / 84 |
| pack2-150ms-d3-loss0.5 | 15 | 7.65 / 18.8 / 18.9 | 60.8 / 158 / 169 | 7.53 / 21.1 / 21.1 | 50.3 / 73.5 / 73.5 |
| pack3-30ms-d2-loss0 | 35 | 11.3 / 23.5 / 26.3 | 67.5 / 172 / 179 | 11.3 / 23.5 / 26.3 | 65.8 / 159 / 164 |
| pack3-30ms-d2-loss0.1 | 24 | 10.9 / 20.4 / 26.3 | 52.3 / 159 / 177 | 10.9 / 20.4 / 26.3 | 45 / 159 / 159 |
| pack3-30ms-d2-loss0.5 | 24 | 10.9 / 20.4 / 26.3 | 50.8 / 159 / 177 | 10.9 / 20.4 / 26.5 | 45 / 159 / 159 |
| pack3-30ms-d3-loss0 | 17 | 12.4 / 20.3 / 26.2 | 74.1 / 164 / 179 | 10.5 / 26.2 / 26.2 | 61.3 / 177 / 177 |
| pack3-30ms-d3-loss0.1 | 10 | 10.8 / 20.3 / 26.2 | 56.3 / 157 / 177 | 10.5 / 26.2 / 26.2 | 38.8 / 177 / 177 |
| pack3-30ms-d3-loss0.5 | 13 | 11.2 / 20.3 / 26.1 | 56.3 / 147 / 177 | 10.8 / 26.4 / 26.4 | 38.8 / 177 / 177 |
| pack3-80ms-d2-loss0 | 36 | 11.4 / 21 / 25.1 | 72.2 / 165 / 177 | 11.4 / 21 / 25 | 74.1 / 153 / 157 |
| pack3-80ms-d2-loss0.1 | 24 | 9.21 / 21 / 25.1 | 87 / 154 / 177 | 9.14 / 21 / 25 | 51.8 / 153 / 157 |
| pack3-80ms-d2-loss0.5 | 18 | 9.3 / 21 / 23.1 | 75 / 168 / 180 | 8.36 / 22.9 / 22.9 | 72.8 / 134 / 134 |
| pack3-80ms-d3-loss0 | 36 | 11.4 / 21.2 / 24.7 | 80.4 / 161 / 177 | 11.4 / 21.2 / 24.6 | 75.8 / 153 / 161 |
| pack3-80ms-d3-loss0.1 | 24 | 9.23 / 21.2 / 24.7 | 87 / 153 / 177 | 9.16 / 21.2 / 24.6 | 78.8 / 133 / 153 |
| pack3-80ms-d3-loss0.5 | 23 | 9.63 / 21.2 / 23.4 | 67.5 / 158 / 177 | 9.63 / 21.2 / 22.7 | 40.3 / 158 / 158 |
| pack3-150ms-d2-loss0 | 36 | 11.4 / 22.2 / 22.2 | 49.5 / 118 / 158 | 11.4 / 22.2 / 22.2 | 38.3 / 72 / 94.3 |
| pack3-150ms-d2-loss0.1 | 23 | 11.1 / 22.2 / 22.4 | 45.6 / 113 / 158 | 11.1 / 22.2 / 22.4 | 49.5 / 118 / 118 |
| pack3-150ms-d2-loss0.5 | 17 | 11.1 / 23 / 23.7 | 56.3 / 146 / 158 | 12.8 / 22.4 / 22.4 | 18.2 / 56.3 / 56.3 |
| pack3-150ms-d3-loss0 | 36 | 11.3 / 22.4 / 22.5 | 61.5 / 146 / 158 | 11.3 / 22.4 / 22.5 | 50.3 / 93.9 / 118 |
| pack3-150ms-d3-loss0.1 | 23 | 11 / 22.4 / 23 | 56.3 / 118 / 158 | 10.9 / 22.4 / 23 | 61.5 / 142 / 142 |
| pack3-150ms-d3-loss0.5 | 13 | 11.7 / 22.9 / 23 | 56.3 / 146 / 158 | 11.1 / 22.4 / 22.4 | 61.5 / 94.3 / 94.3 |
| pack4-30ms-d2-loss0 | 48 | 11.8 / 23.2 / 26.4 | 66.8 / 169 / 178 | 11.7 / 23.2 / 26.4 | 66.7 / 161 / 175 |
| pack4-30ms-d2-loss0.1 | 32 | 11.1 / 21.3 / 26.4 | 60.8 / 169 / 178 | 11.2 / 21.4 / 26.4 | 66.7 / 156 / 158 |
| pack4-30ms-d2-loss0.5 | 32 | 11.1 / 21.4 / 26.4 | 66.8 / 160 / 178 | 11.2 / 21.4 / 26.4 | 66.8 / 157 / 158 |
| pack4-30ms-d3-loss0 | 32 | 11.8 / 23.2 / 26.5 | 66.8 / 175 / 178 | 12.4 / 23.9 / 26.5 | 68.3 / 175 / 178 |
| pack4-30ms-d3-loss0.1 | 21 | 11.1 / 20.7 / 26.5 | 55.4 / 169 / 178 | 12.4 / 21.2 / 26.5 | 49.6 / 175 / 178 |
| pack4-30ms-d3-loss0.5 | 22 | 11 / 21.2 / 26.4 | 66.7 / 175 / 178 | 12.1 / 21.2 / 26.4 | 46.6 / 175 / 178 |
| pack4-80ms-d2-loss0 | 48 | 10.2 / 21 / 23.3 | 70.4 / 141 / 180 | 10.2 / 20.9 / 23.3 | 74.9 / 141 / 162 |
| pack4-80ms-d2-loss0.1 | 32 | 10 / 22.3 / 23.4 | 71.3 / 162 / 180 | 10 / 22.3 / 23.3 | 45.8 / 138 / 141 |
| pack4-80ms-d2-loss0.5 | 30 | 10.1 / 22.7 / 23.1 | 66.7 / 153 / 177 | 9.98 / 22.9 / 23.1 | 44.2 / 127 / 138 |
| pack4-80ms-d3-loss0 | 48 | 10.3 / 20.9 / 23.1 | 65.3 / 162 / 179 | 10.2 / 20.7 / 23 | 66.7 / 149 / 174 |
| pack4-80ms-d3-loss0.1 | 32 | 10 / 22.6 / 23.1 | 66.7 / 162 / 180 | 10 / 22.5 / 23 | 66.7 / 165 / 174 |
| pack4-80ms-d3-loss0.5 | 29 | 10 / 22.5 / 23.3 | 53.3 / 155 / 174 | 10 / 22.9 / 22.9 | 53.3 / 141 / 162 |
| pack4-150ms-d2-loss0 | 48 | 10.9 / 19.9 / 22.5 | 38.3 / 146 / 169 | 10.9 / 19.9 / 22.5 | 36.9 / 99.8 / 127 |
| pack4-150ms-d2-loss0.1 | 30 | 9.92 / 21 / 22.2 | 36.9 / 131 / 169 | 9.71 / 21.1 / 22.2 | 27.9 / 124 / 124 |
| pack4-150ms-d2-loss0.5 | 20 | 10.6 / 31.1 / 35.1 | 38.2 / 137 / 169 | 8.79 / 16.8 / 24.4 | 19.6 / 106 / 106 |
| pack4-150ms-d3-loss0 | 48 | 11.2 / 19.9 / 22.1 | 36.9 / 124 / 153 | 11.2 / 19.8 / 22.1 | 38.3 / 116 / 124 |
| pack4-150ms-d3-loss0.1 | 41 | 9.89 / 20.7 / 22.4 | 39.6 / 146 / 180 | 9.88 / 20.8 / 22.4 | 39 / 124 / 124 |
| pack4-150ms-d3-loss0.5 | 19 | 11.7 / 32.1 / 33.2 | 70.4 / 179 / 180 | 9.35 / 32.8 / 32.8 | 84 / 179 / 179 |
| pack4-30ms-d2-blocked1 | 48 | 12 / 23.2 / 26.6 | 78.8 / 166 / 180 | 12 / 23.2 / 26.4 | 66.8 / 165 / 175 |
| pack4-30ms-d2-blocked2 | 47 | 12.6 / 23.2 / 26.6 | 83.9 / 165 / 180 | 12.6 / 23.2 / 26.4 | 69.1 / 155 / 165 |
| pack4-80ms-d2-blocked1 | 48 | 10.2 / 22.2 / 23.4 | 61.4 / 152 / 180 | 10.2 / 22.2 / 23 | 55.4 / 127 / 138 |
| pack4-80ms-d2-blocked2 | 48 | 10.7 / 22.2 / 23.6 | 46.4 / 158 / 180 | 10.6 / 22.2 / 23.2 | 46.4 / 138 / 151 |

**A repair's corrections,** at the profiles that had any.

| Profile | n | Ball, m | Remote terriers, m | Their headings, ° | Driven terrier, m | Its heading, ° | Depth, ticks |
|---|---|---|---|---|---|---|---|
| pack1-80ms-d2-loss0.1 | 38 | 0.0326 / 0.314 / 0.314 | 0.0932 / 0.939 / 0.939 | 11.3 / 11.3 / 11.3 | 0.0923 / 0.248 / 1.29 | – | 35 / 36 / 43 |
| pack1-80ms-d2-loss0.5 | 179 | 0.0486 / 0.329 / 0.745 | 0.071 / 0.326 / 2.62 | 11.3 / 90.8 / 90.8 | 0.091 / 0.457 / 1.53 | 12 / 14.3 / 14.3 | 35 / 40 / 44 |
| pack1-80ms-d3-loss0.1 | 31 | 0.0194 / 0.0587 / 0.0587 | 0.0324 / 0.274 / 0.274 | 11.3 / 11.3 / 11.3 | 0.0321 / 0.125 / 0.125 | – | 35 / 35 / 35 |
| pack1-80ms-d3-loss0.5 | 118 | 0.0262 / 0.09 / 0.106 | 0.0465 / 0.292 / 0.344 | 24 / 136 / 136 | 0.0666 / 0.243 / 0.331 | – | 35 / 43 / 44 |
| pack1-150ms-d2-loss0.1 | 42 | 0.351 / 0.604 / 0.604 | 0.89 / 3.14 / 13.3 | 22.5 / 56.3 / 56.3 | 0.572 / 6.58 / 6.58 | 59.3 / 59.3 / 59.3 | 44 / 46 / 55 |
| pack1-150ms-d2-loss0.5 | 200 | 0.356 / 2.43 / 4.09 | 1.03 / 4.56 / 14.1 | 11.3 / 158 / 167 | 0.74 / 2.23 / 5.79 | 38.3 / 38.3 / 38.3 | 44 / 56 / 64 |
| pack1-150ms-d3-loss0.1 | 43 | 0.247 / 1.62 / 1.62 | 0.526 / 2.94 / 6.77 | 22.5 / 33.8 / 33.8 | 0.842 / 13 / 13 | 11.3 / 11.3 / 11.3 | 43 / 46 / 54 |
| pack1-150ms-d3-loss0.5 | 194 | 0.315 / 2.85 / 8.09 | 0.767 / 2.79 / 14.6 | 22.5 / 143 / 176 | 0.964 / 3.09 / 6.15 | 35.3 / 170 / 170 | 43 / 57 / 72 |
| pack2-80ms-d2-loss0.1 | 302 | 0.0324 / 0.122 / 0.219 | 0.0822 / 0.346 / 0.681 | 11.3 / 45 / 60 | 0.0587 / 0.279 / 0.338 | – | 35 / 39 / 65 |
| pack2-80ms-d2-loss0.5 | 1160 | 0.0584 / 0.701 / 9.61 | 0.0869 / 0.585 / 16.3 | 11.3 / 90 / 161 | 0.0884 / 1.07 / 22.3 | 11.3 / 49.5 / 49.5 | 35 / 65 / 98 |
| pack2-80ms-d3-loss0.1 | 157 | 0.0501 / 0.158 / 0.254 | 0.0525 / 0.243 / 0.543 | 11.3 / 36 / 56.3 | 0.0729 / 0.125 / 0.125 | – | 35 / 35 / 66 |
| pack2-80ms-d3-loss0.5 | 645 | 0.0489 / 0.441 / 0.663 | 0.0516 / 0.315 / 23.2 | 11.3 / 95.3 / 137 | 0.0454 / 0.355 / 5.08 | 120 / 149 / 149 | 35 / 45 / 104 |
| pack2-150ms-d2-loss0.1 | 333 | 0.31 / 1.33 / 1.7 | 0.645 / 2.09 / 3.25 | 11.3 / 96 / 143 | 0.395 / 2.73 / 3.9 | – | 43 / 51 / 77 |
| pack2-150ms-d2-loss0.5 | 1799 | 0.774 / 5.3 / 20.7 | 0.813 / 3.4 / 16.5 | 11.3 / 122 / 177 | 0.938 / 4.1 / 15 | 22.5 / 129 / 153 | 43 / 73 / 103 |
| pack2-150ms-d3-loss0.1 | 347 | 0.238 / 1.85 / 17.1 | 0.622 / 2.18 / 9.78 | 11.3 / 84 / 180 | 0.733 / 4.76 / 9.73 | 109 / 109 / 109 | 43 / 54 / 73 |
| pack2-150ms-d3-loss0.5 | 710 | 0.921 / 14.3 / 39.1 | 0.88 / 5.11 / 14.3 | 11.3 / 113 / 180 | 1.13 / 7.3 / 14.3 | 33 / 102 / 102 | 43 / 73 / 85 |
| pack3-80ms-d2-loss0.1 | 1007 | 0.0539 / 0.279 / 1.01 | 0.0642 / 0.394 / 7.81 | 11.3 / 48 / 152 | 0.0778 / 0.46 / 0.501 | – | 35 / 35 / 96 |
| pack3-80ms-d2-loss0.5 | 2300 | 0.0821 / 1.83 / 10.9 | 0.0969 / 0.981 / 31.4 | 11.3 / 99.8 / 168 | 0.111 / 1.57 / 17.4 | 33.8 / 168 / 168 | 35 / 65 / 125 |
| pack3-80ms-d3-loss0.1 | 611 | 0.0444 / 0.258 / 0.442 | 0.0547 / 0.261 / 1.27 | 11.3 / 48 / 108 | 0.0422 / 1.44 / 1.44 | 109 / 109 / 109 | 35 / 35 / 65 |
| pack3-80ms-d3-loss0.5 | 2275 | 0.0415 / 0.381 / 7.58 | 0.0624 / 0.334 / 23.3 | 11.3 / 67.5 / 158 | 0.0701 / 0.441 / 5.89 | 36 / 146 / 146 | 35 / 64 / 125 |
| pack3-150ms-d2-loss0.1 | 829 | 0.237 / 1.64 / 4.66 | 0.45 / 1.99 / 16.8 | 11.3 / 96 / 176 | 0.135 / 1.42 / 21 | – | 43 / 60 / 103 |
| pack3-150ms-d2-loss0.5 | 936 | 3.34 / 23 / 37.5 | 1.21 / 9.53 / 36.9 | 11.3 / 134 / 180 | 1.73 / 10.9 / 28 | 40.5 / 180 / 180 | 43 / 73 / 132 |
| pack3-150ms-d3-loss0.1 | 918 | 0.273 / 1.78 / 9.49 | 0.422 / 1.92 / 16.6 | 11.3 / 96 / 169 | 0.309 / 1.8 / 20.9 | 63.8 / 66.8 / 66.8 | 43 / 73 / 134 |
| pack3-150ms-d3-loss0.5 | 2247 | 2.46 / 22.1 / 42.6 | 1.04 / 5.63 / 32.4 | 11.3 / 103 / 180 | 1.17 / 5.94 / 23.7 | 56.3 / 158 / 164 | 43 / 73 / 168 |
| pack4-80ms-d2-loss0.1 | 1521 | 0.044 / 0.339 / 0.766 | 0.061 / 0.36 / 1.29 | 11.3 / 52.5 / 155 | 0.083 / 0.403 / 0.881 | – | 35 / 39 / 124 |
| pack4-80ms-d2-loss0.5 | 3373 | 0.0869 / 2.19 / 13.2 | 0.108 / 1.18 / 23.3 | 11.3 / 72 / 164 | 0.127 / 1.53 / 16.4 | 12 / 154 / 154 | 35 / 65 / 156 |
| pack4-80ms-d3-loss0.1 | 611 | 0.0369 / 0.295 / 0.376 | 0.0413 / 0.239 / 0.501 | 11.3 / 48 / 144 | 0.0519 / 0.28 / 0.322 | – | 35 / 35 / 72 |
| pack4-80ms-d3-loss0.5 | 2137 | 0.036 / 0.334 / 0.867 | 0.0611 / 0.39 / 23 | 11.3 / 72 / 167 | 0.0594 / 0.424 / 17.1 | 12 / 82.4 / 82.4 | 35 / 65 / 125 |
| pack4-150ms-d2-loss0.1 | 1819 | 0.291 / 1.61 / 3.76 | 0.361 / 1.97 / 16.3 | 11.3 / 101 / 180 | 0.288 / 2.18 / 15.8 | 11.3 / 101 / 101 | 43 / 73 / 169 |
| pack4-150ms-d2-loss0.5 | 3191 | 4.2 / 21.8 / 36.1 | 1.54 / 7.27 / 36.2 | 11.3 / 109 / 180 | 1.57 / 7.69 / 29.8 | 62.3 / 163 / 180 | 43 / 62 / 134 |
| pack4-150ms-d3-loss0.1 | 1323 | 0.255 / 1.77 / 5.23 | 0.343 / 1.94 / 15.6 | 11.3 / 90 / 179 | 0.38 / 2.64 / 15.6 | 17.3 / 48.8 / 48.8 | 43 / 73 / 165 |
| pack4-150ms-d3-loss0.5 | 1949 | 6.33 / 31.1 / 42.5 | 1.6 / 10.4 / 36.1 | 11.3 / 109 / 180 | 1.65 / 12 / 36.1 | 48.8 / 132 / 145 | 43 / 67 / 134 |
| pack4-80ms-d2-blocked2 | 1 | – | 0.00843 / 0.0101 / 0.0101 | 11.3 / 11.3 / 11.3 | – | – | 34 / 34 / 34 |

**Late inputs, resyncs, steps and traffic.** Late counts each TICK's input whose tick was at or before the late boundary when it came, and lateAbsent each (sender, tick) finalised absent here whose input came later; both with their share of the remote inputs. Resyncs are those completed, with the failed ones beside them, and a browser-minute is a browser's time from its timeline's start to its confirmed end. Steps a timer run are over the runs that stepped; sent a second is the browsers' mean.

| Profile | Ended | Late | lateAbsent | Resyncs, failed | A browser-minute | Disagree | Jumps | Steps a timer run, mean / p95 / max | Steps a tick | Sent a second | kB a second |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pack1-30ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.05 / 1 / 14 | 1.15 | 60.2 | 2 |
| pack1-30ms-d2-loss0.1 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.06 / 2 / 14 | 1.14 | 60.2 | 1.97 |
| pack1-30ms-d2-loss0.5 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.05 / 1 / 14 | 1.14 | 60.2 | 1.97 |
| pack1-30ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1 / 1 / 14 | 1.04 | 60.3 | 1.96 |
| pack1-30ms-d3-loss0.1 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.01 / 1 / 14 | 1.04 | 60.3 | 1.97 |
| pack1-30ms-d3-loss0.5 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.01 / 1 / 14 | 1.04 | 60.3 | 1.97 |
| pack1-80ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.45 / 4 / 14 | 1.63 | 60 | 2 |
| pack1-80ms-d2-loss0.1 | 4 of 4 | 65 (0.16%) | 65 (0.16%) | 38, 0 | 3.33 | 206 | 0 | 1.48 / 5 / 14 | 1.69 | 60.1 | 2.04 |
| pack1-80ms-d2-loss0.5 | 4 of 4 | 380 (0.90%) | 377 (0.89%) | 179, 1 | 15.1 | 875 | 0 | 1.58 / 5 / 14 | 1.83 | 60.5 | 2.16 |
| pack1-80ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.29 / 3 / 14 | 1.43 | 60.1 | 1.98 |
| pack1-80ms-d3-loss0.1 | 4 of 4 | 39 (0.08%) | 39 (0.08%) | 31, 0 | 2.32 | 133 | 0 | 1.3 / 3 / 14 | 1.46 | 60.1 | 2 |
| pack1-80ms-d3-loss0.5 | 4 of 4 | 153 (0.35%) | 152 (0.35%) | 118, 5 | 9.76 | 599 | 0 | 1.43 / 4 / 14 | 1.63 | 60.3 | 2.1 |
| pack1-150ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.88 / 9 / 14 | 2.07 | 59.9 | 1.94 |
| pack1-150ms-d2-loss0.1 | 4 of 4 | 619 (1.42%) | 619 (1.42%) | 42, 15 | 3.44 | 396 | 0 | 1.96 / 9 / 14 | 2.2 | 59.9 | 2 |
| pack1-150ms-d2-loss0.5 | 4 of 4 | 3948 (8.02%) | 3947 (8.02%) | 200, 65 | 14.6 | 2044 | 10 | 2.13 / 9 / 14 | 2.43 | 60.5 | 2.17 |
| pack1-150ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.83 / 8 / 14 | 2.03 | 59.9 | 1.97 |
| pack1-150ms-d3-loss0.1 | 4 of 4 | 593 (1.32%) | 593 (1.32%) | 43, 5 | 3.43 | 408 | 0 | 1.94 / 8 / 14 | 2.2 | 60 | 2.04 |
| pack1-150ms-d3-loss0.5 | 4 of 4 | 3580 (7.57%) | 3577 (7.56%) | 194, 61 | 14.7 | 1944 | 16 | 2.08 / 8 / 14 | 2.39 | 60.5 | 2.2 |
| pack2-30ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.13 / 2 / 14 | 1.37 | 181 | 5.89 |
| pack2-30ms-d2-loss0.1 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.14 / 2 / 14 | 1.39 | 181 | 5.96 |
| pack2-30ms-d2-loss0.5 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.15 / 2 / 14 | 1.41 | 180 | 5.91 |
| pack2-30ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.02 / 1 / 14 | 1.12 | 180 | 5.91 |
| pack2-30ms-d3-loss0.1 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.02 / 1 / 14 | 1.12 | 180 | 5.89 |
| pack2-30ms-d3-loss0.5 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.03 / 1 / 14 | 1.12 | 181 | 5.86 |
| pack2-80ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.99 / 5 / 14 | 2.6 | 180 | 5.9 |
| pack2-80ms-d2-loss0.1 | 4 of 4 | 551 (0.17%) | 549 (0.17%) | 302, 3 | 10 | 2664 | 0 | 2.04 / 5 / 14 | 2.66 | 181 | 6.07 |
| pack2-80ms-d2-loss0.5 | 4 of 4 | 2695 (0.85%) | 2668 (0.84%) | 1160, 187 | 39.4 | 13299 | 0 | 2.36 / 5 / 14 | 3.24 | 182 | 6.73 |
| pack2-80ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.68 / 4 / 14 | 2.19 | 180 | 5.9 |
| pack2-80ms-d3-loss0.1 | 4 of 4 | 204 (0.08%) | 200 (0.08%) | 157, 6 | 6.78 | 1316 | 0 | 1.75 / 4 / 14 | 2.3 | 180 | 6.02 |
| pack2-80ms-d3-loss0.5 | 4 of 4 | 965 (0.37%) | 937 (0.36%) | 645, 55 | 26.8 | 6388 | 0 | 2 / 4 / 14 | 2.76 | 182 | 6.51 |
| pack2-150ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 3.24 / 9 / 14 | 4.19 | 180 | 5.86 |
| pack2-150ms-d2-loss0.1 | 4 of 4 | 4775 (1.54%) | 4770 (1.54%) | 333, 23 | 11.6 | 6273 | 0 | 3.43 / 9 / 14 | 4.58 | 180 | 6.16 |
| pack2-150ms-d2-loss0.5 | 3 of 4 | 45196 (7.19%) | 45282 (7.20%) | 1799, 1949 | 30.9 | 41949 | 0 | 2.84 / 10 / 14 | 4.25 | 182 | 6.49 |
| pack2-150ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 2.98 / 8 / 14 | 3.9 | 179 | 5.87 |
| pack2-150ms-d3-loss0.1 | 4 of 4 | 4561 (1.51%) | 4543 (1.51%) | 347, 22 | 12.4 | 6399 | 0 | 3.08 / 8 / 14 | 4.09 | 180 | 6.15 |
| pack2-150ms-d3-loss0.5 | 4 of 4 | 16466 (6.85%) | 16377 (6.81%) | 710, 707 | 32 | 15256 | 0 | 3.22 / 9 / 14 | 4.33 | 182 | 6.59 |
| pack3-30ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.17 / 2 / 14 | 1.52 | 300 | 9.65 |
| pack3-30ms-d2-loss0.1 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.17 / 2 / 14 | 1.5 | 300 | 9.62 |
| pack3-30ms-d2-loss0.5 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.2 / 2 / 14 | 1.56 | 301 | 9.64 |
| pack3-30ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.03 / 1 / 14 | 1.16 | 301 | 9.75 |
| pack3-30ms-d3-loss0.1 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.03 / 1 / 14 | 1.18 | 301 | 9.78 |
| pack3-30ms-d3-loss0.5 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.04 / 1 / 14 | 1.19 | 301 | 9.77 |
| pack3-80ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 2.29 / 5 / 14 | 3.22 | 300 | 9.67 |
| pack3-80ms-d2-loss0.1 | 4 of 4 | 1938 (0.17%) | 1930 (0.17%) | 1007, 0 | 16.2 | 8992 | 0 | 2.42 / 5 / 14 | 3.46 | 300 | 10.1 |
| pack3-80ms-d2-loss0.5 | 4 of 4 | 6574 (0.82%) | 6459 (0.81%) | 2300, 480 | 51.7 | 30873 | 0 | 2.8 / 8 / 14 | 4.25 | 303 | 11.3 |
| pack3-80ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.92 / 4 / 14 | 2.76 | 300 | 9.77 |
| pack3-80ms-d3-loss0.1 | 4 of 4 | 832 (0.07%) | 821 (0.07%) | 611, 0 | 9.48 | 5393 | 0 | 2.03 / 4 / 14 | 2.95 | 300 | 10 |
| pack3-80ms-d3-loss0.5 | 4 of 4 | 3848 (0.35%) | 3741 (0.34%) | 2275, 44 | 37.1 | 25085 | 0 | 2.36 / 5 / 14 | 3.57 | 301 | 10.9 |
| pack3-150ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 3.95 / 9 / 14 | 5.49 | 299 | 9.6 |
| pack3-150ms-d2-loss0.1 | 4 of 4 | 12203 (1.46%) | 12162 (1.45%) | 829, 8 | 17.8 | 15998 | 0 | 4.07 / 10 / 14 | 5.92 | 300 | 10.2 |
| pack3-150ms-d2-loss0.5 | 4 of 4 | 46969 (7.17%) | 46651 (7.12%) | 936, 2088 | 26.2 | 31241 | 0 | 4.14 / 11 / 14 | 5.93 | 307 | 10.6 |
| pack3-150ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 3.46 / 8 / 14 | 4.9 | 299 | 9.6 |
| pack3-150ms-d3-loss0.1 | 4 of 4 | 12520 (1.35%) | 12436 (1.34%) | 918, 9 | 17.8 | 18257 | 0 | 3.63 / 8 / 14 | 5.19 | 300 | 10.2 |
| pack3-150ms-d3-loss0.5 | 3 of 4 | 105288 (6.61%) | 104902 (6.58%) | 2247, 5445 | 25.5 | 78606 | 0 | 3.23 / 12 / 14 | 5.08 | 304 | 10.5 |
| pack4-30ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.24 / 2 / 14 | 1.74 | 420 | 13.6 |
| pack4-30ms-d2-loss0.1 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.23 / 2 / 14 | 1.71 | 420 | 13.5 |
| pack4-30ms-d2-loss0.5 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.23 / 2 / 14 | 1.7 | 420 | 13.5 |
| pack4-30ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.05 / 1 / 14 | 1.25 | 420 | 13.7 |
| pack4-30ms-d3-loss0.1 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.05 / 1 / 14 | 1.26 | 420 | 13.7 |
| pack4-30ms-d3-loss0.5 | 4 of 4 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.06 / 1 / 14 | 1.25 | 421 | 13.7 |
| pack4-80ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 2.58 / 5 / 14 | 4.05 | 419 | 13.6 |
| pack4-80ms-d2-loss0.1 | 4 of 4 | 2955 (0.17%) | 2933 (0.17%) | 1521, 9 | 21.9 | 14601 | 0 | 2.75 / 5 / 14 | 4.38 | 420 | 14.4 |
| pack4-80ms-d2-loss0.5 | 4 of 4 | 11965 (0.83%) | 11744 (0.82%) | 3373, 853 | 59.2 | 52508 | 0 | 3.15 / 12 / 14 | 5.2 | 423 | 15.9 |
| pack4-80ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 2.07 / 4 / 14 | 3.24 | 419 | 13.6 |
| pack4-80ms-d3-loss0.1 | 4 of 4 | 843 (0.07%) | 825 (0.07%) | 611, 0 | 13.1 | 5236 | 0 | 2.24 / 4 / 14 | 3.65 | 420 | 14.2 |
| pack4-80ms-d3-loss0.5 | 4 of 4 | 4304 (0.37%) | 4140 (0.35%) | 2137, 35 | 45.9 | 23197 | 0 | 2.59 / 12 / 14 | 4.21 | 421 | 15.3 |
| pack4-150ms-d2-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 4.73 / 10 / 14 | 7.42 | 419 | 13.6 |
| pack4-150ms-d2-loss0.1 | 4 of 4 | 27070 (1.44%) | 26902 (1.43%) | 1819, 6 | 24.4 | 37525 | 0 | 4.76 / 10 / 14 | 7.51 | 420 | 14.5 |
| pack4-150ms-d2-loss0.5 | 2 of 4 | 329796 (7.12%) | 329155 (7.11%) | 3191, 14202 | 17.4 | 163550 | 1 | 3.83 / 12 / 14 | 6.13 | 426 | 14 |
| pack4-150ms-d3-loss0 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 4.2 / 9 / 14 | 6.71 | 418 | 13.6 |
| pack4-150ms-d3-loss0.1 | 4 of 4 | 18755 (1.34%) | 18553 (1.33%) | 1323, 2 | 23.8 | 27469 | 0 | 4.42 / 9 / 14 | 7.37 | 419 | 14.7 |
| pack4-150ms-d3-loss0.5 | 3 of 4 | 191869 (6.65%) | 190656 (6.61%) | 1949, 8812 | 17.2 | 100172 | 1 | 3.71 / 12 / 14 | 6.18 | 432 | 14.4 |
| pack4-30ms-d2-blocked1 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.29 / 3 / 14 | 1.82 | 421 | 13.9 |
| pack4-30ms-d2-blocked2 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 1.31 / 3 / 14 | 1.81 | 423 | 14.1 |
| pack4-80ms-d2-blocked1 | 6 of 6 | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 0 | 2.6 / 5 / 14 | 3.97 | 419 | 13.7 |
| pack4-80ms-d2-blocked2 | 6 of 6 | 1 (0.00%) | 1 (0.00%) | 1, 0 | 0.0128 | 1 | 0 | 2.81 / 6 / 14 | 4.42 | 422 | 14.2 |

### 2.4 Beside the rules: every correction that wasn't a repair's

`withPlacements`, which decides nothing (section 1.9). The rules read on it as they do on the steady corrections, but for your own terrier, whose placements are kickoff snaps of metres: "none of 25, 50, 100 ms passes, so 100 ms, and the figures go to M4's check: the p95s at their intervals' upper ends, pack size 1: own 12.4 m, ownHeadings 164 °; pack size 2: own 15.5 m, ownHeadings 153 °; pack size 3: own 8.22 m, ownHeadings 157 °; pack size 4: own 0.227 m, ownHeadings 162 °". Rule 1 keeps d = 2 with the same falls, rule 2 gives 200 ms for the bodies (headings up to 60.0°), and rule 3 confirms w = 12. Its p95s with their intervals:

| Profile | Ball, m | Remote terriers, m | Their headings, ° | Driven terrier, m | Its heading, ° |
|---|---|---|---|---|---|
| pack1-80ms-d2-loss0 | 0.17 [0.135, 0.217] | 0.0671 [0.066, 0.0698] | 48 [48, 58.5] | 7.96 [5.81, 12.4] | 164 [121, 164] |
| pack1-80ms-d3-loss0 | 0.149 [0.127, 0.161] | 0.0402 [0.0381, 0.0454] | 45 [36, 48] | 9.97 [7.87, 17.5] | 172 [122, 172] |
| pack2-80ms-d2-loss0 | 0.206 [0.143, 0.248] | 0.0673 [0.0666, 0.068] | 49.5 [48, 56.3] | 10.6 [7.98, 15.5] | 153 [121, 153] |
| pack2-80ms-d3-loss0 | 0.155 [0.139, 0.19] | 0.0406 [0.0404, 0.042] | 45 [45, 45] | 11.2 [8.15, 16.1] | 144 [133, 177] |
| pack3-80ms-d2-loss0 | 0.201 [0.148, 0.225] | 0.0688 [0.0671, 0.0696] | 56.3 [49.5, 60] | 0.106 [0.0446, 8.22] | 129 [115, 157] |
| pack3-80ms-d3-loss0 | 0.139 [0.136, 0.146] | 0.0395 [0.0394, 0.0399] | 48 [47.3, 48] | 0.0261 [0.0174, 5.57] | 133 [122, 161] |
| pack4-80ms-d2-loss0 | 0.171 [0.152, 0.201] | 0.0647 [0.0628, 0.0662] | 56.3 [56.3, 60] | 0.0548 [0.038, 0.227] | 132 [109, 162] |
| pack4-80ms-d3-loss0 | 0.11 [0.0746, 0.135] | 0.0391 [0.0387, 0.0397] | 48 [45, 48] | 6.64 [6, 8.29] | 149 [127, 174] |

### 2.5 The cap check, round by round

Each round is 20 runs of the forced repair, alone, on a quiet machine, the 1-minute load under 1 before its first run and under 2 after its last. Every run repaired from 238 ticks back, 250 steps with prediction, in play at the hold; no browser closed a connection, and no other browser resynced or lost a tally.

| File | Cap | Runs | Median worst, ms | × 6.3, ms | Max worst, ms | Median ms a step | Load before, after | From, steps, calls | Decision |
|---|---|---|---|---|---|---|---|---|---|
| results.json | 42 | 20 | 5.22 | 32.9 | 14.5 | 0.124 | 0.94, 1.53 | 238 back, 250 steps, 13 calls | 31 |
| cap31-check.json | 31 | 20 | 6.03 | 38 | 15.6 | 0.195 | 0.74, 1.73 | 238 back, 250 steps, 21 calls | 20 |
| cap20-check.json | 20 | 20 | 4.19 | 26.4 | 7.96 | 0.21 | 0.79, 1.37 | 238 back, 250 steps, 32 calls | 18 |
| cap18-check.json | 18 | 20 | 4.95 | 31.2 | 17.7 | 0.275 | 0.78, 1.46 | 238 back, 250 steps, 38 calls | 14 |
| cap14-check.json | 14 | 20 | 3.9 | 24.5 | 5.74 | 0.278 | 0.81, 1.04 | 238 back, 250 steps, 48 calls | 14 |

- **The worst call** was the STATE's adoption in 17, 18, 20, 20 and 20 of each round's 20 runs, as in every run known before the method. Its cost falls with the cap less than its steps do: its median ms a step rose from 0.124 at 42 to 0.278 at 14.
- **The worst calls,** run by run: at 42, 3.02 to 14.5 ms; at 31, 4.18 to 15.6; at 20, 2.89 to 7.96; at 18, 2.39 to 17.7; at 14, 2.79 to 5.74. The slowest normal timer run, in the 5 s either side, took 5.25, 10.1, 5.51, 4.93 and 7.81 ms.
- **The files:** the method names a cap check alone `cap<cap>.json`. At the settled cap there is both a check alone and every profile measured beside it, so each check alone is named `cap<N>-check.json`, and `cap14.json` holds every profile at 14 with that cap check, merged from the seven groups at 14 and `cap14-check.json`. Its cap decision is the check's own, from the same runs and load.
- **In the browser,** M4's frame bench repeats a forced repair in throttled Chromium (M3-Q14). A cap of 14 also spreads a joiner's catch-up, which neither confirms nor votes while it runs (§2.8).

### 2.6 For the C-row: past the loss reach, and the partial mesh

lateAbsent's share of the remote inputs and resyncs a browser-minute, at the cap of 14, by pack size. The 30 ms profiles are inside the loss reach and the 80 and 150 ms ones past it (section 1.8), as the model said.

| One way, loss, d | Reach | Pack size 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| 30 ms, 0.1%, d = 2 | 65.6 ms, in reach | 0.00%, 0 | 0.00%, 0 | 0.00%, 0 | 0.00%, 0 |
| 30 ms, 0.1%, d = 3 | 71.1 ms, in reach | 0.00%, 0 | 0.00%, 0 | 0.00%, 0 | 0.00%, 0 |
| 30 ms, 0.5%, d = 2 | 65.6 ms, in reach | 0.00%, 0 | 0.00%, 0 | 0.00%, 0 | 0.00%, 0 |
| 30 ms, 0.5%, d = 3 | 71.1 ms, in reach | 0.00%, 0 | 0.00%, 0 | 0.00%, 0 | 0.00%, 0 |
| 80 ms, 0.1%, d = 2 | 65.6 ms, out of reach | 0.16%, 3.33 | 0.17%, 10 | 0.17%, 16.2 | 0.17%, 21.9 |
| 80 ms, 0.1%, d = 3 | 71.1 ms, out of reach | 0.08%, 2.32 | 0.08%, 6.78 | 0.07%, 9.48 | 0.07%, 13.1 |
| 80 ms, 0.5%, d = 2 | 65.6 ms, out of reach | 0.89%, 15.1 | 0.84%, 39.4 | 0.81%, 51.7 | 0.82%, 59.2 |
| 80 ms, 0.5%, d = 3 | 71.1 ms, out of reach | 0.35%, 9.76 | 0.36%, 26.8 | 0.34%, 37.1 | 0.35%, 45.9 |
| 150 ms, 0.1%, d = 2 | 65.6 ms, out of reach | 1.42%, 3.44 | 1.54%, 11.6 | 1.45%, 17.8 | 1.43%, 24.4 |
| 150 ms, 0.1%, d = 3 | 71.1 ms, out of reach | 1.32%, 3.43 | 1.51%, 12.4 | 1.34%, 17.8 | 1.33%, 23.8 |
| 150 ms, 0.5%, d = 2 | 65.6 ms, out of reach | 8.02%, 14.6 | 7.20%, 30.9, 1 unended | 7.12%, 26.2 | 7.11%, 17.4, 2 unended |
| 150 ms, 0.5%, d = 3 | 71.1 ms, out of reach | 7.56%, 14.7 | 6.81%, 32 | 6.58%, 25.5, 1 unended | 6.61%, 17.2, 1 unended |

| Partial mesh | Forwarding reach | Late | lateAbsent | Resyncs, failed | A browser-minute | Disagree | FWDs sent |
|---|---|---|---|---|---|---|---|
| pack4-30ms-d2-blocked1 | 80 ms, in reach | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 79703 |
| pack4-30ms-d2-blocked2 | 80 ms, in reach | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 128754 |
| pack4-80ms-d2-blocked1 | 80 ms, in reach | 0 (0.00%) | 0 (0.00%) | 0, 0 | 0 | 0 | 60364 |
| pack4-80ms-d2-blocked2 | 80 ms, in reach | 1 (0.00%) | 1 (0.00%) | 1, 0 | 0.0128 | 1 | 150431 |

- **Past the loss reach** each lost message's input reaches the browser that lost it after its tick is final, so that browser finalises it absent and resyncs. At 80 ms the resyncs grow with the pack size, 3.3 to 21.9 a browser-minute at 0.1% loss and 15.1 to 59.2 at 0.5%, at d = 2. d = 3 halves lateAbsent's share and cuts the resyncs by 22% to 42%, though 80 ms is past its 71.1 ms reach too.
- **At 150 ms and 0.5%,** 6.6% to 8.0% of the remote inputs are finalised absent, and 5 of the 32 matches at each cap never reached their end within 600 s: each of their browsers completed 148 to 316 resyncs and failed 334 to 806, and none scored.
- **The partial mesh,** at its forwarding reach of 80.0 ms: no input finalised absent at 30 ms, nor at 80 ms with one pair blocked; one resync in 6 matches at 80 ms with two pairs blocked, a forwarded input a tick late, as phase 5a saw.

### 2.7 The load run (design §8.5)

`npm run build`, then `TERRIEST_LOAD_OUT=… npx playwright test -c playwright.load.config.ts`, LOAD_SECONDS 90: 12 Chromium pages through `#test=net`, 8 players at 4 a side with the brain and 4 spectators, against `vite preview` and the local relay. **It failed its checks,** in both runs on a quiet machine, the 1-minute load under 1 at the start. `research/load/results.json` is the second run's, which stayed connected throughout:

| Page | Role | Peers | Late | lateAbsent | Disagree | Resyncs | Jumps | Steps a tick, mean and max | A timer run, ms: mean, p95, max | Sent a second | kB a second |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | keeper | 11 | 8387 (29.4%) | 8387 | 150 | 4 | 41 | 2.22, 45 | 1.97, 7.8, 127 | 493 | 16.6 |
| 1 | player | 11 | 8055 (28.2%) | 8085 | 142 | 11 | 49 | 2.38, 67 | 1.86, 6.9, 117 | 490 | 16.2 |
| 2 | player | 11 | 7433 (26.0%) | 7473 | 125 | 11 | 46 | 2.39, 42 | 1.95, 7.6, 111 | 493 | 17.8 |
| 3 | player | 11 | 8337 (29.2%) | 8339 | 100 | 4 | 42 | 2.08, 43 | 1.85, 7.2, 106 | 493 | 17.1 |
| 4 | player | 11 | 7355 (25.8%) | 7355 | 160 | 7 | 46 | 2.30, 42 | 1.85, 7.0, 105 | 491 | 16.1 |
| 5 | player | 11 | 8697 (30.5%) | 8822 | 106 | 11 | 45 | 2.04, 84 | 1.82, 7.0, 104 | 496 | 17.1 |
| 6 | player | 11 | 8125 (28.5%) | 8259 | 187 | 6 | 46 | 2.28, 62 | 1.77, 6.6, 153 | 493 | 16.3 |
| 7 | player | 11 | 8112 (28.4%) | 8214 | 141 | 6 | 43 | 2.11, 60 | 1.79, 7.4, 93 | 497 | 16.7 |
| 8 | spectator | 11 | 8500 (26.1%) | 8727 | 337 | 14 | 48 | 2.51, 87 | 0.74, 2.0, 59 | 3 | 0.4 |
| 9 | spectator | 11 | 9013 (27.6%) | 9212 | 329 | 12 | 44 | 2.56, 66 | 0.75, 1.9, 129 | 3 | 0.4 |
| 10 | spectator | 11 | 8640 (26.5%) | 8811 | 290 | 17 | 46 | 2.37, 84 | 0.76, 2.0, 60 | 3 | 0.4 |
| 11 | spectator | 11 | 8855 (27.1%) | 9166 | 265 | 19 | 44 | 2.38, 53 | 0.76, 2.0, 99 | 3 | 0.4 |

- **What failed:** every page held its 11 peers, but at their common final tick, 6897, the 12 pages held 12 hashes. Over 93.5 s of play each page's clock advanced 45 ticks a second, not 60: every page's median offset read its peers 34 to 47 ticks behind, and it jumped back, 41 to 49 times in the run. 26% to 30% of each page's remote inputs came past the late boundary, two thirds or more of them 16 ticks late or more, and were finalised absent.
- **The machine:** the run took the 1-minute load from 0.91 to 15–16, each page's renderer at 50–90% of a thread. A timer run cost 1.8–2.0 ms at a player, against 0.72–0.80 in phase 5's 20 s smoke run at 4da2086, which passed. That reads as pages handling their messages hundreds of ms late, so that each reads every other's clock as behind and the room's clocks fall back together; whether that is this machine's limit or the clock's (D-15) isn't settled here.
- **The other runs,** whose files aren't committed: the first, 90 s, began clean (no late input or jump at the measured play's start) and broke down during it, its pages ending with 0 to 11 peers, 10 of the 12 no longer holding their common final tick, 5800, and the other two at two hashes, its clocks at 33–38 ticks a second; a 20 s diagnostic run, outside the method, failed as the second did, with 12 hashes at tick 3587 and its clocks at 41–42 ticks a second.

### 2.8 The desktop connection, settled provisionally (PLAN §15, §17)

`GALLIUM_DRIVER=d3d12 npx playwright test -c playwright.dev-local.config.ts`, once: passed in 2.1 minutes. A Chromium keeper and a Firefox player, at 1 a side with `script=brain` and `ice=none`, through `npm run dev:local` with its local relay only, so nothing public was contacted: 37 checks found both connected, ticking and in agreement, and both reached one confirmed end, 3–2 at tick 6871. The owner's own two desktop browsers are owner-pending (§17).

### 2.9 The files and their code

| File | Holds | Base | Commit | src, dev, scripts trees | Clean | UTC |
|---|---|---|---|---|---|---|
| results.json | 76 profiles, the cap check | src/config.ts | 71bd4a7 | fb6a2f2, 6b8288d, d2c2551 | true | 2026-11-20T03:41:55.862Z |
| cap31-check.json | 0 profiles, the cap check | {"spreadMaxStepsPerTick":31} | 71bd4a7 | fb6a2f2, 6b8288d, d2c2551 | true | 2026-11-20T03:43:01.441Z |
| cap20-check.json | 0 profiles, the cap check | {"spreadMaxStepsPerTick":20} | 71bd4a7 | fb6a2f2, 6b8288d, d2c2551 | true | 2026-11-20T03:44:47.425Z |
| cap18-check.json | 0 profiles, the cap check | {"spreadMaxStepsPerTick":18} | 71bd4a7 | fb6a2f2, 6b8288d, d2c2551 | true | 2026-11-20T03:46:40.973Z |
| cap14-check.json | 0 profiles, the cap check | {"spreadMaxStepsPerTick":14} | 71bd4a7 | fb6a2f2, 6b8288d, d2c2551 | true | 2026-11-20T03:48:05.973Z |
| cap14.json | 76 profiles, the cap check | {"spreadMaxStepsPerTick":14} | 71bd4a7 | fb6a2f2, 6b8288d, d2c2551 | true | 2026-11-20T04:12:37.296Z |

The runs, each started at the code above with the tree clean, which each run's wrapper checked before and after it:

| Run | Wall | 1-minute load, start and end | Its file |
|---|---|---|---|
| The seven groups at the base, at once from 03:15:05 (section 1.12): pack1, pack4-30ms, pack2, the mesh, pack4-80ms, pack3, pack4-150ms | 156, 655, 692, 751, 1013, 1481 and 1483 s | 0.41; 2.90 at the last's end | the parts, then `results.json` |
| The cap check at 42, alone, once the load was under 1 | 48.8 s | 0.94, 1.53 | its part, then `results.json` |
| The merge | 1.4 s | 1.53, 1.57 | `results.json` |
| The cap check at 31, alone | 57.2 s | 0.74, 1.73 | `cap31-check.json` |
| The cap check at 20, alone | 45.4 s | 0.79, 1.37 | `cap20-check.json` |
| The cap check at 18, alone | 47.7 s | 0.78, 1.46 | `cap18-check.json` |
| The cap check at 14, alone | 41.3 s | 0.81, 1.04 | `cap14-check.json` |
| The seven groups at 14, at once from 03:49:13, in the same order | 146, 616, 662, 698, 881, 1314 and 1403 s | 0.92; 2.06 at the last's end | the parts, then `cap14.json` |
| The merge at 14, with `cap14-check.json` | 1.4 s | 2.06, 2.06 | `cap14.json` |
| `npm run build` | 9.4 s | 0.80, 0.98 | `dist/`, ignored |
| The load run, first | 162 s | 0.97, 20.2 | not committed: it failed (section 2.7) |
| The load run, second | 154 s | 0.91, 15.0 | `research/load/results.json`: it failed |
| A 20 s load run, a diagnostic outside the method | 75 s | 0.81, 12.2 | not committed: it failed |
| The desktop connection's settle | 135 s | 0.97, 3.09 | none: it passed (section 2.8) |
