# M2 tuning: report

**Answers:** PLAN.md Q-10, M2's values, and C-18, pushers side by side. The owner chose on 2026-11-17 to have them settled by measurement, so Claude sets them by the method below, provisionally, as §17's rule for attended steps says, and the owner confirms or changes them before M5's deploy (section 1.7).
**Status:** the method (section 1), committed at e1a4c99 before any value was measured under it and unchanged since, and the results (section 2), measured under it at that commit. Two values change, and the owner confirms or changes all of them (section 2.7). M2's review added two checks to the metrics after the measurement, and ran them again: no verdict changed (section 2.8).
**Sources:** M2's design §9.6 (research/m2/DESIGN.md), which fixes each value's metric, check and rule; section 1.8 lists what this method makes precise. `dev/tuning.metrics.ts` measures, on the tuning page's scenarios (`dev/tuning/scenarios.ts`), built on `src/core/sim/scenes.ts` and `cases.ts`, which the gate's tests run too.
**Known before it:** a run of the metrics at phase 4 (ccf92c8), before this method was fixed, doesn't count as the measurement. Its picks were known when the method was written.

## 1. Method

### 1.1 The base

`src/config.ts` at commit c429814, "Prepare the tuning sweeps". Every value is at its start: A.4's and A.5's, or REQUIREMENTS' where its Configuration table gives a number. The push assist is off, at a cap of 0. The slip release's reach, `slipHoldOffMetres`, is a setting of its own, apart from the re-arm gap. The metrics' code is the same at that commit and at this report's.

### 1.2 How each value is chosen

- **Alone first: round 1.** Each value's candidates are measured from the base, one value at a time, with everything else at the base. Its checks run at the start, then at each candidate.
- **The rules,** design §9.6's:
  - *keep:* the start stays if its checks pass. If one fails, the passing candidate nearest the start is taken: by the decimal difference, the smaller on a tie.
  - *largest,* for the netting, and *smallest,* for the push assist's cap: of the candidates whose checks pass.
  - *none passes:* the start stays, and the value goes to the owner with its figures. For the push assist, section 1.3's fallback applies.
- **REQUIREMENTS' values,** the acceleration (15 m/s²) and the bowling speed (4 m/s): a rule that would move one only proposes the change to the owner. It's never adopted provisionally (design §14 Q-1). The metrics write such picks apart, as `proposals`, reading which values the Configuration table gives from the table itself.
- **Together: round 2.** The picks, without the proposals, are applied together, and every section runs again from there. The combination stands if every value's checks and the bot marks pass there, except the checks of a value that no candidate passed in round 1. If round 1 picks no change, it is round 2 as well.
- **A check that passes alone and fails together** means two picks interact. Each pick is put back to its start alone, in the reverse of section 1.3's order (the push assist first), and round 2 runs again, until a combination stands. The pick put back goes to the owner with the check it broke, and its own checks, which fail at its start, are excused. If no single put-back stands, the picks go back one after another in the same order, each staying back, until one does.
- **A pick is a listed candidate,** never a value between two.

### 1.3 The values

In the order the metrics' 'values' section runs them, by its names. A push's time is to 95% of run speed, from rest, in contact, with the rolling slowdown (§16). Section 1.4 says how the slip-out cases, C-21's window and the netting shots run.

| Value | Start | Candidates, in order | Checks | Rule |
|---|---|---|---|---|
| Kickoff spots | A.5's table | none | the configuration's checks: every spot inside the floor plan by a terrier's radius, clear of the ball and of each other, pack A's mirrored across the long axis. The kickoff pinch, at 1 to 4 a side, with and without zoomies, comes down within 10 s of play, mirrored (§16's case 4). The 1-a-side spot is on y = 0 (§16's Practice setup). The bot marks and the end-to-end setups pass, from the 'bots' section | keep |
| Rolling slowdown | 0.5 m/s² | 0.5, 0.4, 0.6, 0.3, 0.75, 1 | §16's push marks, in the pitch frame: one pusher in 1.08 to 1.32 s, four in a train in 0.54 to 0.66 s | keep |
| Terrier bounce | 0.3 | 0.3, 0.2, 0.4, 0.1, 0.5, 0 | the slip-out cases, the pinches among them | keep |
| Re-arm gap | 0.6 m | 0.6, 0.5, 0.7, 0.4, 0.8, 0.3, 1 | a push from contact for 2 s, at a run and at zoomies speed, in the ball and the pitch frame, counts 1 touch; a ball pounced at a wall from 2 m and met again on its rebound counts 2 | keep |
| Slip hold-off | 0.6 m | 0.6, 0.5, 0.7, 0.4, 0.8, 0.3, 1 | the slip-out cases | keep |
| Tumble guard | 1.5 s | 1.5, 1, 2, 0.5, 2.5 | a still terrier that two rivals pounce into in turn, each as soon as it can, for 30 s, is up for at least the guard after every get-up | keep |
| Collider size: the radius | 0.25 m | 0.25, 0.23, 0.27, 0.2, 0.3 | the slip-out cases and C-21's window; the push marks | keep |
| Drive and idle friction: idle friction | 8 m/s² | 8, 6, 10, 4, 12 | the collider's | keep |
| Drive and idle friction: the acceleration | 15 m/s², REQUIREMENTS' | 15, 12, 18 | the collider's | keep, as a proposal only |
| Goal netting | 0.3 | 0.3, 0.2, 0.15, 0.1, 0.05, 0.02, 0 | each of the 18 netting shots scores, and keeps the ball wholly behind the line from the goal to the celebration's end | largest |
| Bowling speed | 4 m/s, REQUIREMENTS' | 4, 3.5, 4.5, 3, 5 | REQUIREMENTS' note: a pounce from the air sends a resting ball off at the bowling speed or more, and a ball dribbled at a run bowls the rival it meets | keep, as a proposal only |
| Side-by-side pushers: the push assist (C-18) | off: a cap of 0 | caps of 9, 12 and 15 m/s | with the assist on at the cap, two and four, round the ball and on a line, in ball view, are each quicker than one pusher in ball view with it off; one pusher's time in ball view is unchanged, to the substep | smallest |

**The push assist's marks.** At the adopted cap, two and four side by side, round the ball and on a line, take marks at their measured times plus 10%, in both frames, for §16 and `push.test.ts`. If no cap passes, the assist goes, with its code, key, row, check and test; the marks are the times without it plus 10%; and C-18 goes to the owner (design §9.6, §14 Q-13).

**Q-9's marks and the brain's keys** aren't tuned here. The bot keys stay at A.4's, at which phase 3 met every mark, and design §8.6's mark values go into §16 as they stand (design §9.6). The 'bots' section measures the marks at the base, and for the owner's play test at M4 (Q-9) at reactions of 0.15 and 0.35 s and aim noise of 5° and 15°. In round 2 they're checks: the empty goal scored within 20 s in at least 95 of 100, never stuck; the fall-back in at least 90 of 100 at each of 1 to 4 a side; a goal before 0:00 in at least 90 of 100 regulation matches; both end-to-end setups won in 25 of 25; and never stuck in the 100 whole matches.

### 1.4 What the checks run

- **The slip-out cases** (§16, C-21), as the metrics' `slipOut` runs them:
  1. a ball dropped from 1 cm onto terriers that hold toward it, at contact angles of 5° to 58° by 1°, in the ball frame and in the pitch frame opposite, at 1 to 4 a side, mirrored and 2 cm and a tick off mirror, 8 s each: none held up, the worst down within 1.5 s of its first landing, and every mirrored case still mirrored;
  2. two sitting terriers under it, at 4° to 58° by 0.25°: down within 0.5 s;
  3. M0's 336 dribbles, in both frames, at a run from 0, 3 and 6 m/s and at zoomies speed from 0 to 9 m/s by 3, from 12 run-ups of 0.05 to 0.39 m, and in the ball frame 0, 3 and 29 steps off: no slip-out;
  4. the kickoff pinch at 1 to 4 a side, with and without zoomies, for 10 s of play: it comes down, mirrored.

  Down is the ball's centre within 1 cm of its resting height (`cases.ts`).
- **C-21's window:** in M0's 2,880-dribble sweep, in both frames, at a run and at zoomies speed from 0 by 1.5 m/s, from 24 run-ups, and in the ball frame 0 to 8 steps off, the cone stays under the lowest hop onto the dribbler, so no slip-out fires.
- **The netting shots,** `NETTING_SHOTS` in `scenes.ts`: 1 a side, both terriers parked, the ball 3 m in front of the +x goal line, aimed through the mouth's centre at 5 and 10 m/s, at 0°, 20° and 35° in plan, rolling, high (its centre 2 m up) and lobbed (4 m/s up). The measure is the least |x| of the ball's centre, after every substep of the celebration. Wholly behind the line is more than the goal line plus the ball's radius: 20.8 m at the base. A shot that doesn't score fails.

### 1.5 Reported, never checked

Beside the checks, for the owner and for M4: a 3 m/s ball's roll (A.5: 9 m) and the netting's worst at 5 and 10 m/s, with the rolling slowdown; terriers meeting head-on at run speed, and the wall scrum's contacts a substep, with the terrier bounce; the share of the 30 s the still terrier spends tumbled, with the guard; D-4's overhang and the drawn box's reach past the sphere, with the collider; run speed from rest (REQUIREMENTS: 0.4 s) and a pusher moving an idle terrier (D-6: 3.5 m/s²), with the friction and the acceleration; C-5's leaving speeds, balls rolled at a terrier at 5 and 3 m/s, and tumbles a minute of play, bowled and pounced, in 10 seeded bot matches each at 2 and 4 a side, with the bowling speed (Q-8); every push layout in both frames at each cap; 1 to 4 simultaneous hits; the step's µs on the wall scrum, against M0's 27.8 to 31.2 µs, and `think()`'s µs a bot. Timings depend on the machine.

### 1.6 Running it

From the repository's root, at this report's commit, on the development machine (WSL2), in Node 22.23.4 with vitest 4.1.12:

```sh
# Round 1: every section, each value alone from the base.
TERRIEST_TUNING_OUT=research/tuning/round-1.json npx vitest run --config dev/vitest.config.ts

# Round 2: every section again, from round 1's picks.
TERRIEST_TUNING_BASE="$(node -p 'JSON.stringify(require("./research/tuning/round-1.json").picks)')" \
TERRIEST_TUNING_OUT=research/tuning/round-2.json npx vitest run --config dev/vitest.config.ts
```

- A put-back run (section 1.2) is round 2's command with its own base written out, to `round-3.json` and on.
- `TERRIEST_TUNING_OUT` names the file a run writes. Without it the metrics write `research/tuning/results.json`, and refuse to overwrite it.
- `TERRIEST_TUNING_BASE` is a JSON object of settings by key path, each one a tuning-page slider's. It takes the place of `src/config.ts`'s values for the whole run.
- `TERRIEST_TUNING_ONLY` (sections by name) and `TERRIEST_TUNING_CANDIDATES` (candidate lists by key) stay unset: every section runs, with section 1.3's lists.
- Each file records its base, its whole configuration, Node's version and the time, and the 'values' section's `picks`, `proposals` and whether every value passes at the base. The simulation is deterministic, so a run repeats every figure but the timings.
- The round files are committed here with the results.

### 1.7 Provisional and owner-pending (§17)

- **Provisional:** the values this method settles are Claude's, by measurement, under §17's rule for attended steps (Q-10). The owner confirms or changes each before M5's deploy, on the tuning page or by naming it, and the owner's values replace these.
- **Where they go:** `src/config.ts`, and PLAN's A.4 and A.5 rows, marked "M2, provisional by measurement (research/tuning/REPORT.md)" (design §14 Q-1). `docs/acceptance.md` logs M2's tuning as owner-pending.
- **REQUIREMENTS.md doesn't change** until the owner signs off. Its TBDs (kickoff spots, rolling slowdown, terrier bounce, re-arm gap, tumble guard) stay TBD, with A.5's values in force, and the netting, which its Ball bounce row says is "tuned at M2" with no number, stays A.5's. A value the table gives is never changed provisionally: a pick against one is only a proposal here. A value the owner signs off goes into the Configuration table, as Q-10 says.
- **To the owner, with their figures:** every proposal, every value no candidate passed, and every pick put back.
- **A later change costs,** as §17 says, re-emitted goldens and re-run Q-9 marks, and here also the push marks and the netting's gate test set again.

### 1.8 What design §9.6 left open, made precise here

1. **Candidates.** Design §9.6 lists only the netting's and the caps'. The other lists are the metrics': the start first, then outward from it, the lower first at each distance. The caps above the zoomies speed are 12 and 15 m/s, 3 m/s apart.
2. **Nearest** is by the decimal difference from the start, the smaller value on a tie, so floating-point noise never decides between two candidates equally far.
3. **When no candidate passes,** the start stays and the value goes to the owner; for the push assist, design §9.6's own fallback.
4. **A start whose checks pass is kept** even if a candidate list leaves it out.
5. **The kickoff pinch:** design §9.6's "comes down within 1.5 s, mirrored" reads as §16's case 4 does: it comes down, within the 10 s run, mirrored. Its time is reported. The kickoff spots' marks and setups are the 'bots' section's, at the same base.
6. **The slip hold-off** is a value of its own. The slip release read the re-arm gap until c429814, so the re-arm gap's row carried §16's slip-out cases. They're now the hold-off's checks, and the re-arm gap's are its touches alone. The cases bound the hold-off from below only: at phase 4, as the re-arm gap, 0.5 m passed and 0.4 m failed case 1.
7. **Abreast** is round the ball and on a line. **Quicker than one pusher** is reaching 95% of run speed sooner than one pusher in ball view with the assist off, at the same base, and **one pusher's time doesn't change** to the substep.
8. **Wholly behind the line** is the centre's least |x| over the celebration's substeps beyond the line by more than the ball's radius, and a shot that doesn't score fails.
9. **Rounds:** design §9.6 tunes each value alone. Section 1.2's second round and its put-back order settle what happens when picks interact.
10. **REQUIREMENTS' values** are proposals only (design §14 Q-1).
11. **The push assist's moving ball:** design §4.4's assist acts on a ball moving above 0.3 m/s. It reads that from the restitution threshold, A.4's 0.3 m/s, not from a key of its own, so tuning the threshold moves both. The threshold isn't tuned here.

## 2. Results

**Run** by section 1.6's commands at e1a4c99, this method's commit, with the tree clean, in Node 22.23.4 and vitest 4.1.12 on the development machine: round 1 from 05:25 UTC on 2026-11-18, in 535 s, and round 2 from 05:35, in 517 s. `round-1.json` and `round-2.json` are committed here. Round 2 stood, so no put-back ran. `results.json` is the metrics run once more after the adoption, at this commit's `src/config.ts` with no variable set (section 2.6).

### 2.1 Round 1: each value alone, from the base

| Value | Start | Candidates measured | Checks | Picked, and why |
|---|---|---|---|---|
| Kickoff spots | A.5's table | none | pass at the start: the spots' checks; the pinch comes down, mirrored, at 1 to 4 a side, with and without zoomies, in 0.433 to 1.962 s; the 1-a-side spot is on y = 0; the bot marks and setups (section 2.3) | kept: its checks pass |
| Rolling slowdown | 0.5 m/s² | 0.5, 0.4, 0.6, 0.3, 0.75, 1 | all pass: one pusher in 1.192 to 1.317 s, four in a train in 0.575 to 0.579 s; at 0.5, 1.225 and 0.575 s | kept |
| Terrier bounce | 0.3 | 0.3, 0.2, 0.4, 0.1, 0.5, 0 | all pass: case 1's worst down in 1.383 to 1.404 s, none held up; the sitting pair 0.471 s; no slip-out in the 336 dribbles; every pinch down, mirrored | kept |
| Re-arm gap | 0.6 m | 0.6, 0.5, 0.7, 0.4, 0.8, 0.3, 1 | all pass: a push from contact counts 1 touch in both frames, at a run and at zoomies speed, and the rebound met again 2 | kept |
| Slip hold-off | 0.6 m | 0.6, 0.5, 0.7, 0.4, 0.8, 0.3, 1 | 0.6, 0.5, 0.7, 0.8 and 1 pass. 0.4 and 0.3 fail case 1: the worst comes down in 1.721 s (4 a side at 15°, ball frame, off mirror) and 2.000 s (4 a side at 17°) | kept |
| Tumble guard | 1.5 s | 1.5, 1, 2, 0.5, 2.5 | all pass: the shortest time up after a get-up is the guard and a tick, 1.517 s at 1.5 | kept |
| Collider size: the radius | 0.25 m | 0.25, 0.23, 0.27, 0.2, 0.3 | only 0.25 passes. Every other radius shuts C-21's window, the dribbles' lowest hop falling under the 42° cone: to 36.1° at 0.23, 40.9° at 0.27, 17.8° at 0.2 and 41.9° at 0.3. 0.23, 0.2 and 0.3 also slip out in 34, 82 and 8 of the 336 dribbles, and 0.3 holds 5 rest cases up and takes 0.542 s for the sitting pair | kept |
| Drive and idle friction: idle friction | 8 m/s² | 8, 6, 10, 4, 12 | 8, 6 and 4 pass; 10 and 12 fail case 2, the sitting pair taking 0.887 and 2.979 s | kept |
| Drive and idle friction: the acceleration | 15 m/s², REQUIREMENTS' | 15, 12, 18 | 15 passes. 12 and 18 miss both push marks (one pusher 1.558 and 1.008 s, four in a train 0.725 and 0.479 s), fail case 1 and shut the window (36.8° and 39.7°); 18 slips out in 20 of the dribbles too | kept, so no proposal |
| Goal netting | 0.3 | 0.3, 0.2, 0.15, 0.1, 0.05, 0.02, 0 | all 18 shots score at each. Not wholly behind the line: 18, 18, 18, 17, 11 and 4 of them, and at 0 none | 0: the largest that passes |
| Bowling speed | 4 m/s, REQUIREMENTS' | 4, 3.5, 4.5, 3, 5 | 4, 3.5, 4.5 and 3 pass. At 5, a pounce from the air, sending the ball off at 4.57 m/s, no longer bowls | kept, so no proposal |
| Side-by-side pushers: the push assist (C-18) | off: a cap of 0 | caps of 9, 12 and 15 m/s | off fails: in ball view, two round the ball and two on a line take 2.033 s and four round the ball 1.313 s, against one pusher's 1.225 s (four on a line beat it, at 0.921 s). Every cap passes, one pusher's time unchanged, though that time can't show the assist acting; the drive-target check M2's review added passes at every cap too (section 2.8) | 9 m/s: the smallest that passes |

So round 1 picks the netting at 0 and the assist at 9 m/s, and proposes nothing.

### 2.2 Round 2: the picks together

From `{"goalNetRestitution":0,"pushAssistCapMetresPerSecond":9}`, every value's checks pass, and the rules pick nothing more and propose nothing. Every candidate passes or fails as it did in round 1, and the bot marks pass (section 2.3). So the combination stands.

What it moves at the base, against round 1, is small:
- case 1's worst over the 864 rest cases, from 1.383 to 1.387 s, still 1 a side at 56° in the ball frame, off mirror: the assist acts in the cases off mirror;
- the wall scrum's contacts a substep, from 11.01 to 11.44, and its most from 18 to 19;
- in the 2-a-side bot matches, tumbles a minute by bowling from 5.37 to 5.17, and by pouncing from 0.367 to 0.300. At 4 a side they're 6.465 and 0.312 in both rounds.

The netting's figures are now those of 0 (section 2.5). The push times, the hits, the touches and the guard's figures don't move.

### 2.3 The bot marks and the end-to-end setups

At the settled values, from the metrics' 'bots' section in round 2, and again from `marks.ts`'s runs at this commit's configuration:
- **the empty goal:** 100 of 100 score within 20 s, the slowest in 11.3 s, never stuck;
- **the fall-back:** 100 of 100 at each of 1 to 4 a side. The brain with no fall-back gets 21, 26, 29 and 31, and the one that charges 0 at each size, so the mark can fail;
- **a goal in regulation:** 100 of 100;
- **never stuck** in the 100 whole matches, 17 of which go to overtime;
- **the three-engine setup:** 25 of 25 end at 0:00 with the bot's pack ahead, the slowest first goal after 11.1 s of play. **Practice:** 25 of 25, the slowest after 5.7 s;
- **at reactions of 0.15 and 0.35 s and aim noise of 5° and 15°,** for M4's play test (Q-9): every mark passes, the empty goal at 99 of 100 with 0.15 s.

Round 1 gives the same counts at the start. The bot keys stay A.4's, and design §8.6's mark values stand.

### 2.4 Adopted

| Setting | Value | Was |
|---|---|---|
| `goalNetRestitution` | 0 | 0.3 |
| `pushAssistCapMetresPerSecond` | 9 m/s | 0, off |

The other eight values keep their starts: the kickoff spots, the rolling slowdown, the terrier bounce, the re-arm gap, the slip hold-off, the tumble guard, the collider's radius and idle friction. All ten are in `src/config.ts`, and in A.4 and A.5, marked provisional by measurement. REQUIREMENTS' acceleration and bowling speed aren't M2's to settle, and stay.

**C-18's marks,** at the 9 m/s cap, in seconds to 95% of run speed:

| Pushers | Pitch frame | Ball view | Ball view, assist off |
|---|---|---|---|
| two round the ball | 0.829 | 1.175 | 2.033 |
| two on a line | 0.833 | 1.175 | 2.033 |
| four round the ball | 0.721 | 0.983 | 1.313 |
| four on a line | 0.758 | 0.854 | 0.921 |

- One pusher takes 1.225 s in both frames, with the assist on or off. The drive's 15 m/s² sets that time whatever the drive's target, so it can't show the assist acting on a lone pusher: one driving at the 9 m/s cap would take 1.225 s too. Its drive's target shows it, and stays its base speed (section 2.8).
- The assist acts only in ball view, so the pitch frame keeps M0's times.
- `push.test.ts` holds each time within ± 10% of its mark, and pins it to the millisecond besides, so any change to the drive or the assist sets the marks again on purpose; in ball view each must also beat one pusher. Section 1.3 said "plus 10%"; the marks take −10% as well, as §16's own push marks do, which only narrows them.
- Caps of 12 and 15 m/s give the same times, but for four round the ball's 0.979 s.

### 2.5 Reported, never checked

At the settled values, unless said:
- **The roll:** a 3 m/s ball rolls 8.981 m (A.5: 9 m).
- **The netting:** at 0, each shot's least |x| is where it scored, 20.801 to 20.837 m, so the ball never comes back toward the line. At 0.3, the worst shot at 5 m/s ends at 16.84 m and the worst at 10 m/s at 11.51 m, 8.5 m out onto the pitch, as the design's scratch run found. Across the rolling slowdown's candidates they move less than 0.6 m from 0.5's: 16.60 to 17.36 m, and 11.37 to 11.85 m.
- **The terrier bounce:** terriers meeting head-on at run speed, closing at 12 m/s, separate at 3.6, the bounce's 0.3 exactly.
- **The wall scrum:** 11.44 contacts a substep, at most 19.
- **The guard:** the still terrier is tumbled for 0.494 of the 30 s at 1.5 s, in 10 tumbles, against 0.742 at 0.5 s and 0.396 at 2.5 s.
- **D-4:** the drawn box overhangs the sphere by 0.05 m, and reaches 0.137 m past it toward a floor push's contact, which is 31.59° up (D-4: 14 cm).
- **The drive:** run speed from rest in 0.4 s (REQUIREMENTS: 0.4 s); a pusher moves an idle terrier at 3.5 m/s² (D-6: 3.5).
- **C-5:** a push at zoomies speed sends the ball off at 3.968 m/s, and a pounce from the air at 4.57 m/s. A ball dribbled at a run bowls the rival it meets, coming at it at 5.995 m/s. A ball rolled at a terrier at 5 m/s bowls it, at 4.679 m/s by then; at 3 m/s it doesn't (2.429 m/s).
- **Tumbles a minute,** in 10 seeded bot matches at each size: by bowling 5.17 and by pouncing 0.300 at 2 a side, and 6.465 and 0.312 at 4.
- **Hits:** the ball's speed 30 ticks after 1 to 4 terriers hit it at once, from the floor in parallel 2.656, 3.571, 3.810 and 3.685 m/s, and at the centre 2.656, 3.690, 4.300 and 4.477; level in parallel 3.000, 4.354, 4.999 and 5.213, and at the centre 3.000, 4.478, 5.469 and 6.157. These are M0's.
- **C-21's window:** no slip-out in the 2,880 dribbles, whose lowest hop is 43.529° (ball frame, 3 steps off, zoomies from 9 m/s, a 0.3012 m run-up), above the 42° cone. The sitting pair gets down in 0.471 s at 42°, 0.483 at 41.5°, 0.508 at 41° and 0.558 at 40°. `slipout.test.ts` pins a dribble off the sweep's grid that hops lower, at 43.23° (a 0.1125 m run-up, the rest the same), so the window runs from about 41.5° to 43.2°, as PLAN's C-21 says. Since M2's review the metrics' window check runs that dribble too (section 2.8).
- **Timings,** which depend on the machine: the step on the wall scrum took medians of 39.9 to 69.4 µs over the three runs, against M0's 27.8 to 31.2 µs, and `think()` 0.57 to 0.69 µs a bot. These single runs aren't the tick-by-tick comparison with the spike that phases 2 and 3 made.

### 2.6 What changes with them

- **The goldens** are re-emitted on purpose, with `TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens`, every run covering its spec. 14 of the 25 runs change, and the canary goes from de2bb0d7a95ae1e7 to eea91a8dd7ba3cf4. The warm-up, the four mirrored kickoffs, the resting and rolling balls, the squeeze, both pinches and the nose frame don't: neither the netting's bounce nor the assist acts in them. In a mirrored state the ball has no horizontal speed for the assist to act on. With the netting at 0, four in a train follow the ball into the goal and keep pushing through the celebration. It rides up on them, so that run's slip-outs go from 1 to 92, all in the celebration, and it isn't wholly behind the line for half the celebration (section 2.7).
- **The bit pins** in `step.test.ts` don't move: they run at M0's values, a cap of 0 and a netting of 0.3 among them.
- **Re-pinned:** the tunnelling fuzz's count of substeps with the ball wholly behind a goal line, inside a goal, from M0's 1,101 to 15,051 on the main pitch, and from 1,449 to 16,214 on D-4's second shape. The netting alone moves them: a scratch run gives M0's counts with the assist on and the netting at 0.3. The ball still never leaves the pitch.
- **New:** `src/core/sim/netting.test.ts` holds the netting in the gate. At the settled value all 18 shots stay wholly behind the line through the celebration, and at 0.3 every one comes back out.
- **Changed:** `push.test.ts`, C-18's marks; `assist.test.ts`, the assist on by default, compared with a cap of 0 explicitly, with M0's times off pinned there; `params.test.ts`; `contacts.test.ts`, which checks the netting at 0.3 as well, so a net that keeps some speed is still tested; `config.test.ts` and `model.test.ts`, for the rows' wording.
- **`results.json`** was the metrics at the adopted `src/config.ts`, run from 05:52 UTC in 508 s. Every figure in it was round 2's: only the time and the timings differed, so `src/config.ts` holds round 2's base. M2's review ran it again, with its two added checks (section 2.8).

### 2.7 For the owner

- **To confirm or change before M5's deploy** (§17, section 1.7): the ten values settled here, with their figures above. That's the netting at 0 (PLAN C-48), the push assist on at 9 m/s with C-18's marks (PLAN C-18), and the eight kept at their starts.
- **REQUIREMENTS.md is unchanged.** Its five TBDs stay, and so do its two lines on the netting, which PLAN §2's waiting row rewords with the owner's sign-off. The Ball bounce row's "The goal's netting keeps less, tuned at M2" becomes "The goal's netting keeps none of its speed into it, and all of its speed along it". And L58 says the ball bounces off the goal's netting, each bounce keeping part of its speed into the surface, which at 0 it doesn't: the proposal takes the netting out of its bounces and says of it what the Ball bounce row says.
- **Pushed in, a goal can come back out.** The 18 shots have nobody near (design §9.6). In M0's push scenes (`scenes.ts`'s `pushScene`, run on to the goal and its celebration by a scratch script at M2's review), the pushers follow the ball into the goal and keep pushing through the celebration. At 0, one pusher and two side by side keep it wholly behind the line, its least |x| 20.811 to 20.819 m. Four don't, for about half the celebration: in a train its least |x| is 20.180 m, round the ball in ball view 19.576 m, and on a line in ball view 18.393 m, its centre in front of the goal line for 9% and 26% of the celebration in those two. At 0 the netting gives nothing back, so it's the pushers that bring the ball out. At 0.3 the same scenes do worse, 18.336, 11.772 and 14.128 m, and two side by side bring it back to 5.8 m, so the pick of 0 stands. Whether that's the bulge "a goal bulges the net" means is the owner's call, with the netting (L101).
- **No proposals:** the acceleration and the bowling speed pass at REQUIREMENTS' values. No value failed every candidate, and no pick was put back.
- **Bowling (Q-8, C-5):** in the bot matches, terriers are bowled over by the ball 5.2 times a minute of play at 2 a side and 6.5 at 4, against 0.3 pounce tumbles a minute. The bowling speed sets that. Measured at the settled values: at 4.5 m/s, 3.3 and 4.2 a minute; at 5, 2.2 and 2.1, but then a pounce from the air no longer bowls, against REQUIREMENTS' note; at 3.5, 9.0 and 10.1; and at 3, 12.2 and 13.3. 4 m/s is REQUIREMENTS' and passes its checks, so it stays. Whether tumbles should come this much more often from the ball than from pounces is the owner's call.
- **The slip hold-off is bounded from below only:** 0.4 m fails case 1. A longer reach keeps a slipped terrier from braking toward the ball for longer (bots-F4), and nothing here measures that.

### 2.8 After M2's review

M2's review found two of the metrics' checks weaker than section 1 reads them. Both are stronger now, and the metrics ran again, at the settled values, from 07:52 UTC on 2026-11-18 in 416 s, into `results.json`. Every value passes at its start, the rules pick nothing and propose nothing, and every candidate passes or fails as it did in round 2, so the settled values stand.

- **A lone pusher, with the assist on:** section 1.3's "one pusher's time in ball view is unchanged" couldn't fail. The drive's 15 m/s² sets a push's time whatever the drive's target, and on an axis dir() is exact, so the assist never acts on the lone pusher it timed. The check now also pushes alone from 7°, 30°, 45°, 61°, 135° and 200° round the ball, off the axes, where dir() rounds (`scenes.ts`'s `onePusherScene`, `cases.ts`'s `lonePush`), and fails a cap if the pusher's drive target exceeds its base speed by 1e-12 or more at any tick of its push. At 9, 12 and 15 m/s the most is 2.2e-16, an ulp, at every angle, and each push takes 1.225 s. The lone pushes never reach a goal, so the netting's value doesn't touch them. `assist.test.ts` holds the same check in the gate.
- **C-21's window:** the check took the lowest hop of the 2,880-dribble sweep, 43.529°, but `slipout.test.ts` pins a dribble off its grid that hops lower, 43.229°, so a cone of 43.4° passed the metrics and failed the gate. The check now runs that test's two dribbles off the grid as well, a 0.1125 m run-up 3 and 29 steps off in ball view at zoomies from 9 m/s. Its lowest hop is 43.229° at the settled values and at every collider, friction and acceleration candidate that passes; the verdicts are unchanged, since every candidate that shut the window shut it under 42°.
- **Corrected here:** section 2.5's window, which read about 43.5° at the top; section 2.6's train of four, which said the ball stays pressed in the net; and section 2.7, which cited design §14's questions bare, and now gives REQUIREMENTS' L58 and the pushed-in goals as well.
- **`round-1.json` and `round-2.json`** stay as the runs at e1a4c99 wrote them. Their notes' "Q-1" and "Q-13" are design §14's, as `results.json`'s now say.
