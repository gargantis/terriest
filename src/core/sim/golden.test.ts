import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CODEC_VERSION } from './codec';
import { canaryHash, CHECKPOINT_EVERY, coverageProblems, type GoldenResult, type Goldens, goldenSuite, replay } from './golden';
import { JOIN, mirrorInput } from './input';
import { CANARY_SCRIPT, GOLDEN_SCRIPTS, scriptId, type ScriptSpec, scriptTickInputs } from './scripts';
import { CELEBRATION, ENDED, genesis, IN_PLAY } from './state';

// PLAN §16 Determinism (design §7.2, §7.4): the golden runs and the canary
// hash the same every 500 ticks until they're re-emitted on purpose, with
//   TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens
// and each run covers what its spec says, so a run that stops covering its
// column fails even after a re-emit. The emit script sets a second
// variable too, and only with both is the file written: a stray exported
// TERRIEST_EMIT_GOLDENS fails here instead of letting the gate rewrite the
// goldens and pass (design §14 Q-15). The determinism page checks the same
// file in each engine (e2e/determinism.spec.ts), and CI on arm64.
vi.setConfig({ testTimeout: 120_000 });

const file = fileURLToPath(new URL('./goldens.json', import.meta.url));
const emit = process.env.TERRIEST_EMIT_GOLDENS === '1';
const byScript = process.env.TERRIEST_EMIT_GOLDENS_BY_SCRIPT === '1';

/** The suite and the canary, replayed once a process and shared. */
let replayed: { runs: GoldenResult[]; canary: GoldenResult } | null = null;
const results = (): { runs: GoldenResult[]; canary: GoldenResult } => (replayed ??= { runs: goldenSuite(), canary: replay(CANARY_SCRIPT) });

/** Every run's coverage problems, each named for its run. */
function problems(): string[] {
  const { runs, canary } = results();
  const named = (spec: ScriptSpec, r: GoldenResult): string[] => coverageProblems(spec, r).map((p) => `${spec.name}: ${p}`);
  return [...GOLDEN_SCRIPTS.flatMap((spec, i) => named(spec, runs[i]!)), ...named(CANARY_SCRIPT, canary)];
}

if (emit && !byScript) {
  describe('goldens', () => {
    it('are re-emitted only through npm run emit-goldens', () => {
      expect.fail(
        'TERRIEST_EMIT_GOLDENS=1 is set, but not by the emit script. Re-emit the goldens with ' +
          '`TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens`, and unset the variable for every other run.',
      );
    });
  });
} else if (emit) {
  describe('goldens', () => {
    it('emits goldens.json, once every run covers its spec', () => {
      expect(problems(), 'a run that fails its coverage is never emitted').toEqual([]);
      const { runs, canary } = results();
      const out: Goldens = { codec: CODEC_VERSION, checkpointEvery: CHECKPOINT_EVERY, canary: canary.final, runs };
      writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
    });
  });
} else {
  describe('the scripts', () => {
    it("hand each tick's inputs over reversed, pack B's the mirror of pack A's by rank (P4, P8)", () => {
      const spec = GOLDEN_SCRIPTS.find((r) => r.name === 'mirrored kickoff 2')!;
      const s = genesis({ packSize: 2, matchMinutes: 1 });
      const list = scriptTickInputs(spec, 1, s);
      const id = (pack: 0 | 1, rank: number): string => scriptId(spec, pack, rank);
      expect(list.map((x) => x.id)).toEqual([id(1, 1), id(1, 0), id(0, 1), id(0, 0)]);
      for (let rank = 0; rank < 2; rank++) {
        const a = list[3 - rank]!;
        const b = list[1 - rank]!;
        expect(a.events & JOIN).toBe(JOIN);
        expect({ ...b, id: a.id }).toEqual({ ...a, input: mirrorInput(a.input), joinPack: 1 });
      }
      // Each run's IDs are its own, and every input names one of them.
      for (const r of GOLDEN_SCRIPTS) {
        const ids = new Set<string>();
        for (const pack of [0, 1] as const) for (let rank = 0; rank < (r.players ?? r.packSize); rank++) ids.add(scriptId(r, pack, rank));
        expect(ids.size, r.name).toBe(2 * (r.players ?? r.packSize));
      }
    });

    it('name what a run failed to cover', () => {
      const spec: ScriptSpec = {
        ...CANARY_SCRIPT,
        covers: { goals: 1, pounces: 1, tumbles: 1, hits: 1, zooms: 1, bounces: 1, pushes: 1, slipOuts: 1, maxContacts: 1, phases: [CELEBRATION, ENDED], overtime: true, end: 'overtime' },
      };
      const none: GoldenResult = {
        name: spec.name, checkpoints: [], final: '', tick: 0, phase: IN_PLAY, overtime: false, score: [0, 0], terriers: 0,
        goals: 0, pounces: 0, tumbles: 0, hits: 0, zooms: 0, floorBounces: 0, pieceBounces: 0, pushes: 0, contacts: 0, maxContacts: 0, slipOuts: 0,
        phasesSeen: 1 << IN_PLAY, overtimeSeen: false, unmet: ['tick 9: a check'],
      };
      expect(coverageProblems(spec, none)).toEqual([
        'goals: 0, not at least 1', 'pounces: 0, not at least 1', 'tumbles: 0, not at least 1', 'hits: 0, not at least 1',
        'terrier-ticks zooming: 0, not at least 1', 'bounces off the floor or a piece: 0, not at least 1', 'push substeps: 0, not at least 1', 'slip-outs: 0, not at least 1',
        'the most contacts in a substep: 0, not at least 1', 'never in a celebration', 'never in the end', 'never in overtime',
        "didn't end by an overtime goal", 'unmet: tick 9: a check',
      ]);
      expect(coverageProblems({ ...spec, covers: { overtime: false, end: 'lead' } }, { ...none, overtimeSeen: true, phase: ENDED, score: [1, 0], overtime: true, unmet: [] }))
        .toEqual(['went to overtime', "didn't end at 0:00 with a pack ahead"]);
      expect(coverageProblems({ ...spec, covers: { end: 'lead' } }, { ...none, phase: ENDED, score: [1, 1], unmet: [] })).toEqual([
        "didn't end at 0:00 with a pack ahead",
      ]);
      expect(coverageProblems({ ...spec, covers: {} }, { ...none, name: 'another', unmet: [] })).toEqual(["the result is another's, not canary's"]);
    });

    it('count a check past the run as unmet', () => {
      const spec = GOLDEN_SCRIPTS.find((r) => r.name === 'push 1')!;
      const r = replay({ ...spec, ticks: 10, checks: [{ tick: 5, what: 'holds', holds: () => true }, { tick: 11, what: 'past the end', holds: () => true }] });
      expect(r.unmet).toEqual(['tick 11: past the end']);
      expect(r.checkpoints).toEqual([]);
    });
  });

  describe('the goldens', () => {
    it('replay every run to its length, with a checkpoint every 500 ticks', () => {
      const { runs } = results();
      expect(runs.map((r) => r.name)).toEqual(GOLDEN_SCRIPTS.map((s) => s.name));
      expect(new Set(runs.map((r) => r.name)).size, 'names are unique').toBe(runs.length);
      for (let i = 0; i < runs.length; i++) {
        const spec = GOLDEN_SCRIPTS[i]!;
        expect(runs[i]!.tick, spec.name).toBe(spec.ticks);
        expect(runs[i]!.checkpoints.length, spec.name).toBe(Math.floor(spec.ticks / CHECKPOINT_EVERY));
      }
    });

    it('each cover what its spec says, and so does the canary (design §7.2, §7.3)', () => {
      expect(problems()).toEqual([]);
    });

    it('match goldens.json, checkpoint by checkpoint, then run by run, counters included', () => {
      expect(existsSync(file), 'goldens.json is missing: emit it with TERRIEST_EMIT_GOLDENS=1 npm run emit-goldens').toBe(true);
      const want = JSON.parse(readFileSync(file, 'utf8')) as Goldens;
      const { runs, canary } = results();
      expect(want.codec).toBe(CODEC_VERSION);
      expect(want.checkpointEvery).toBe(CHECKPOINT_EVERY);
      expect(runs.map((r) => r.name)).toEqual(want.runs.map((r) => r.name));
      for (let i = 0; i < runs.length; i++) {
        const k = runs[i]!.checkpoints.findIndex((h, j) => h !== want.runs[i]!.checkpoints[j]);
        expect(k, `${runs[i]!.name}: the first differing checkpoint${k < 0 ? '' : `, at tick ${(k + 1) * CHECKPOINT_EVERY}`}`).toBe(-1);
        expect(runs[i], runs[i]!.name).toEqual(want.runs[i]);
      }
      expect(canary.final, 'the canary').toBe(want.canary);
    });

    it('replay the same again in one process: the canary twice, and a run after the suite', () => {
      const { runs, canary } = results();
      expect(canaryHash()).toBe(canary.final);
      expect(canaryHash()).toBe(canary.final);
      const k = GOLDEN_SCRIPTS.findIndex((r) => r.name === 'warm-up');
      expect(replay(GOLDEN_SCRIPTS[k]!)).toEqual(runs[k]);
    });
  });
}
