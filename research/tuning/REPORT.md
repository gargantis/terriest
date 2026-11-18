# M2 tuning: report

**Answers:** PLAN.md Q-10, M2's values, and C-18, pushers side by side. The owner chose on 2026-11-17 to have them settled by measurement, so Claude sets them by the method below, provisionally, as §17's rule for attended steps says, and the owner confirms or changes them before M5's deploy (section 1.7).
**Status:** the method alone, committed before any value is measured under it. The results, and the values they settle, come in later sections.
**Sources:** M2's design §9.6, which fixes each value's metric, check and rule; section 1.8 lists what this method makes precise. `dev/tuning.metrics.ts` measures, on the tuning page's scenarios (`dev/tuning/scenarios.ts`), built on `src/core/sim/scenes.ts` and `cases.ts`, which the gate's tests run too.
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
