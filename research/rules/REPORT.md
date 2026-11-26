# The match rules' choices (C-59)

The owner asked on 2026-11-25 for the settings that most affect play to be set for each match, kept in the browser, with a button that sets them back to their defaults. PLAN's C-59 makes fifteen of them the **match rules**, each chosen from a list that holds its default (A.5). This report says how the lists were picked: which values play, alone and mixed, by the checks the simulation's own tuning used (M2, `research/tuning/REPORT.md`), and which were left off. Every figure is in `results.json`.

## 1. Method

- **The checks** are the tuning metrics' (`dev/tuning.metrics.ts`), run off the gate with the settings under test as `TERRIEST_TUNING_BASE` and every other setting at `src/config.ts`'s:
  `TERRIEST_TUNING_ONLY=slip-out,netting,guard,head-on,touches,roll TERRIEST_TUNING_BASE='{…}' TERRIEST_TUNING_OUT=<a file outside the repo> npx vitest run --config dev/vitest.config.ts`
  - **Play-breaking:** slip-out's case 1 (a ball resting on terriers comes down within 1.5 s, none held up for 8 s, P8 kept), case 2 (two sitting terriers let it down within 0.5 s) and case 4 (each kickoff pinch, 1 to 4 a side, with and without zoomies, comes down, mirrored); the netting (at its settled 0, every shot stays wholly behind the line through its celebration); the guard (nobody tumbled again inside the guard).
  - **Feel:** slip-out's case 3 (no slip-out in its 336 dribbles), the touches (a push counts once, a rebound twice) and the roll of a 3 m/s ball.
  - **The bots:** the metrics' `bots` section, Q-9's marks (the empty goal, the fall-back at each pack size, regulation scoring, the end-to-end setups, and never stuck in 100 whole regulation matches), its brain candidates held at the base: `TERRIEST_TUNING_CANDIDATES='[{"key":"botReactionSeconds","values":[0.25]},{"key":"botAimNoiseDegrees","values":[10]}]'`.
- **A match's configuration,** as `matchConfig` makes it: a zoomies meter's refill keeps its proportion, twice its time, and the push assist's cap is raised to the zoomies speed where that's faster (C-18). The runs applied the same two couplings by hand.
- **The rounds,** on main at 23f0b81, the simulation and the brain as C-59 leaves them:
  1. each candidate value alone, 99 values of 17 settings;
  2. four values between those kept, and 14 mixes: every rule at its lowest, at its highest, and the likeliest troublemakers together;
  3. 12 mixes that isolate round 2's failures, every rule at its lowest and at its highest on the lists as they then stood, a slow and heavy mix, and 40 mixes drawn at random, each rule at its default or at another choice with even odds;
  4. 40 more random mixes on the lists as they then stood, the two marginal ones rechecked, and every rule at its lowest on the final lists;
  5. every rule at its highest on the final lists, and the choices not yet run alone: pounce wait 0.75 s, the kickoff countdown's 1, 2, 4 and 5 s, and a slowdown of 1.5 m/s²;
  then the bots' marks at each rule's lowest and highest choice alone, and at every rule's lowest and every rule's highest together, all on the final lists, and at a few choices between.

## 2. Results

**Each value alone** (rounds 1 and 5). Every value on the final lists passes every check. Left off, each for the check it fails:

| Setting | Left off | Fails |
|---|---|---|
| Run speed | 3 m/s; 4 m/s, which passes alone | the worst rest case comes down in 2.1 s; with the ball's bounce at 0.3 or 0.4, the 1-a-side pinch stays up (round 3) |
| Zoomies speed | 6, 7 and 8 m/s | 14 to 24 of the 336 dribbles slip out |
| Pounce speed | 15 and 16 m/s | a ball met on its rebound from the wall counts no touch |
| Ball bounce | 0.3, which passes alone and with run speed 5, but with 4 leaves the 1-a-side pinch up, and isn't on the lists the random mixes sampled; 0.75 to 0.9 | 6 to 32 dribbles slip out |
| Ball mass | 1, 1.5 and 2.5 kg | the ball comes down late from terriers, sitting ones hold it for 2.7 to 7.7 s, and dribbles slip out |
| Terrier–ball bounce | every value but its 0.5, from 0.2 to 0.8 | dribbles slip out, rest cases come down late, sitting terriers hold the ball, and at 0.8 the 3-a-side pinch stays up: no rule |
| Acceleration | 10, 12, 20 and 25 m/s² | rest cases come down late and dribbles slip out (C-21's window): no rule |
| Gravity | 4.9, 7 and 12 m/s²; 15 m/s², which passes alone | rest cases come down late, sitting terriers hold the ball, and at 4.9 978 dribbles slip out. Only 15 of the four passes, and 12 between it and the default fails, so no list holds: no rule |
| Idle friction | 10 and 12 m/s²; 4 m/s², which passes alone | sitting terriers hold the ball 0.9 and 3.0 s; 4 fails two random mixes (round 3) |
| Ball rolling slowdown | 2 m/s², which passes alone | in four of the five random mixes that failed a check (rounds 3 and 4) |
| Tumble guard | 0 s, which passes the checks | rivals taking turns keep a terrier down 98.7% of the time, against 49.4% at the default 1.5 s |
| Tumble | 1 s, which passes | its roll is cut short in the drawing, which takes 0.6 s after the get-up's 0.5 s (`src/render/drawers/pose.ts`) |

**Passing alone, but off the lists,** each list kept to the range its mixes sampled, and to a few steps for the pad: pounce speeds of 6 and 7 m/s and a pounce wait of 0.25 s, below the lists' 8 m/s and 0.5 s; run speeds of 4.5 and 7.5 m/s and a turn rate of 0.75 turns a second, between or past the lists' steps; zoomies of 13 and 14 m/s, at which a zooming terrier's legs cycle past 20 a second; and a slowdown of 0.1 m/s², at which a 3 m/s ball rolls 33 m, most of the pitch's 40.

**Mixes** (rounds 2 to 5). Every rule at its lowest choice together (round 4) and every rule at its highest (round 5), on the final lists, pass every check. Of the 82 random mixes, two of them round 3's marginal ones drawn again with idle friction at 5 m/s², the 68 that fall wholly on the final lists pass every check. The 5 that failed a check each held idle friction at 4 m/s² or a slowdown of 2 m/s², both since taken off, and failed a feel check only: 2 of 336 dribbles slipping out, or the worst rest case down in 1.53 to 1.55 s against 1.5 s.

**The bots.** At each rule's lowest and highest choice alone, at every rule's lowest together and at every rule's highest, on the final lists, and at a pounce wait of 0.75 s, every mark passes: the empty goal scored in 98 to 100 of 100 within 20 s, the fall-back holding in 100 of 100 at each pack size, 98 to 100 of 100 regulation matches scoring before 0:00, 25 of 25 in each end-to-end setup, and no bot stuck in any of the 100 whole matches.

**The rolls.** A 3 m/s ball rolls 22.5 m at a slowdown of 0.2 m/s², 15 m at 0.3, 9 m at the default 0.5, 4.5 m at 1 and 3 m at 1.5.

## 3. What this doesn't measure

- **Every mix.** The lists' product is too large to run whole; the random mixes sample it.
- **The bots' level.** The marks say the bots play and never stick; how well they play at a rule's extremes is their brain's fixed levers', tuned at the defaults (§21's bot skill levels).
- **Networked feel.** The correction measurement (D-16) ran at the defaults; faster terriers move further in a late input's ticks.
- **The pose.** The drawing scales a trot's size, a turn's lean and a jump's tilt by the default run speed, turn rate and jump speed (`src/render/drawers/pose.ts`), so they saturate or shrink a little at other choices; nothing the simulation reads.

The lists and every choice on them are Claude's, from the request, and owner-pending: the owner confirms or changes them by playing, before M5's deploy (§17, `docs/acceptance.md`).
