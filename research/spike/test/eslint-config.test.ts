// The spike's lint contracts (eslint.config.mjs; PLAN D-1, D-38), checked
// through the real config: the planted fixture under src/sim fails as
// marked, each banned construct fails where it's banned, and the same code
// passes where it isn't.
import { ESLint } from 'eslint';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = 'src/sim/lint-fixtures/planted.ts';

const eslint = new ESLint({ cwd: root });
const lint = async (code: string, filePath: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => `${m.line} ${m.ruleId ?? `fatal: ${m.message}`}`);
};
const ruleIds = async (code: string, filePath: string): Promise<string[]> =>
  (await lint(code, filePath)).map((m) => m.split(' ')[1] ?? '');

describe('the planted fixture under src/sim', () => {
  it('fails on Math.sin, a destructured Math and an aliased Math, and nothing else', async () => {
    const text = await readFile(new URL(`../${FIXTURE}`, import.meta.url), 'utf8');
    const lineOf = (needle: string): number => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
    const [result] = await new ESLint({ cwd: root, ignore: false }).lintFiles([FIXTURE]);
    const got = (result?.messages ?? []).map((m) => `${m.line} ${m.ruleId}`);
    expect(got).toEqual([
      `${lineOf('=> Math.sin(x)')} hermet/exact-ops`,
      `${lineOf('const { cos } = Math;')} no-restricted-syntax`,
      `${lineOf('const M = Math;')} no-restricted-syntax`,
    ]);
  });

  it('is skipped by `eslint .`, and nothing else in src/sim is', async () => {
    expect(await eslint.isPathIgnored(FIXTURE)).toBe(true);
    expect(await eslint.isPathIgnored('src/sim/physics.ts')).toBe(false);
    expect(await eslint.isPathIgnored('src/sim/physics.test.ts')).toBe(false);
  });
});

describe('src/sim, tests excluded', () => {
  it('allows only exact operations (hermet/exact-ops)', async () => {
    for (const code of [
      'export const a = (x: number): number => Math.cos(x);',
      'export const a = (y: number, x: number): number => Math.atan2(y, x);',
      'export const a = (x: number): number => Math["exp"](x);',
      'export const a = (x: number): number => x ** 2;',
      'export const a = Math.random();',
      'export const a = Date.now();',
      'export const a = performance.now();',
    ]) {
      expect(await ruleIds(code, 'src/sim/a.ts'), code).toContain('hermet/exact-ops');
    }
  });

  it('uses Math only as Math.<name>: never destructured, aliased or passed on', async () => {
    for (const code of [
      'const { sqrt } = Math;\nexport const a = sqrt;',
      'const M = Math;\nexport const a = M.sqrt(2);',
      'export let M: unknown;\nM = Math;',
      'export let sin: unknown;\n({ sin } = Math);',
      'export function f({ sin }: { sin(x: number): number } = Math): number { return sin(1); }',
      'export const a = Reflect.get(Math, "sin");',
      'export const a = [Math];',
      'export const a = { Math };',
      'export const a = (Math as { sin(x: number): number }).sin(1);',
    ]) {
      expect(await ruleIds(code, 'src/sim/a.ts'), code).toContain('no-restricted-syntax');
    }
  });

  it('reaches no DOM, timer, storage or network global, nor the global object', async () => {
    for (const code of [
      'export const a = globalThis.Math.sin(1);',
      'export const a = self.Math;',
      'export const a = window.innerWidth;',
      'export const a = document.title;',
      'setTimeout(() => 0, 1);\nexport {};',
      'export const a = localStorage.length;',
      'export const a = fetch("x");',
      'export const a = eval("1");',
    ]) {
      expect(await ruleIds(code, 'src/sim/a.ts'), code).toContain('no-restricted-globals');
    }
  });

  it('allows exact operations, the contract, and Math in types and property names', async () => {
    const code = [
      'import { TICK_RATE } from "../contract";',
      'import type { MatchView } from "../contract.ts";',
      'export const f = (x: number): number => Math.fround(Math.sqrt(x)) + Math.min(Math.abs(x), Math.PI) + Math.imul(3, 4) + TICK_RATE;',
      'export type View = MatchView;',
      'export type Sine = typeof Math.sin;',
      'export const o = { Math: 1 };',
      'export const q = o.Math;',
    ].join('\n');
    expect(await lint(code, 'src/sim/ok.ts')).toEqual([]);
  });
});

describe('src/sim, tests included', () => {
  it('imports neither three nor src/scene, statically or dynamically', async () => {
    for (const file of ['src/sim/a.ts', 'src/sim/a.test.ts']) {
      for (const code of [
        'import * as THREE from "three";\nexport const v = new THREE.Vector3();',
        'import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";\nexport const l = GLTFLoader;',
        'import type { Vector3 } from "three";\nexport type V = Vector3;',
        'export { REVISION } from "three";',
        'import { draw } from "../scene";\nexport const d = draw;',
        'import { draw } from "../scene/terriers.ts";\nexport const d = draw;',
        'export * from "../scene/pitch";',
      ]) {
        expect(await ruleIds(code, file), `${file}: ${code}`).toContain('no-restricted-imports');
      }
      for (const code of ['export const m = import("three");', 'export const m = import("../scene/pitch");', 'export type V = import("three").Vector3;']) {
        expect(await ruleIds(code, file), `${file}: ${code}`).toContain('no-restricted-syntax');
      }
    }
    expect(await ruleIds('import { draw } from "../../scene";\nexport const d = draw;', 'src/sim/deep/a.ts')).toContain('no-restricted-imports');
  });

  it('may import its own modules whose names only start with "scene"', async () => {
    expect(await lint('import { a } from "./scenery";\nimport { b } from "./scenes/x";\nexport const c = a + b;', 'src/sim/ok.ts')).toEqual([]);
  });
});

describe('outside the simulation', () => {
  it('leaves the simulation tests, the scene and the page free to use any maths and three', async () => {
    const maths = 'export const s = Math.sin(1);\nconst { cos } = Math;\nexport const c = cos(1) + performance.now();';
    expect(await lint(maths, 'src/sim/a.test.ts')).toEqual([]);
    expect(await lint(`import * as THREE from "three";\nexport const v = new THREE.Vector3();\n${maths}`, 'src/scene/a.ts')).toEqual([]);
    expect(await lint(`import { draw } from "./scene/a";\nexport const d = draw;\n${maths}`, 'src/main.ts')).toEqual([]);
  });
});
