# M3 correction measurement: report

**Answers:** PLAN D-16 and D-11, as §17's M3 entry asks: the correction measurement's p50, p95 and max per profile and its late inputs, d and D-16's glide chosen from them, w = 12 confirmed or amended, and the spread's cap checked.
**Status:** the method alone (section 1), committed before anything is measured under it (design §9.1). Section 2's results, and the values they settle, come from a run at that commit.
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

Phase 6 fills this section from results.json, measured under section 1 at this report's commit.
