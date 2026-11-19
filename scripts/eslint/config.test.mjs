import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

// PLAN D-38, "Testing the lint": every banned construct, linted through the
// project config in a file of each group, fails or passes as that group's
// rules say. Each `// ==` section of a fixture is one construct; the globals
// and the storage properties are looped over below.
const root = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd: root });
// The first lint loads the config, typescript-eslint and TypeScript: about
// 2 s on the development machine, and past vitest's 5 s default for a test
// when the machine is busy (M1). So these tests get a minute, as
// src/config.test.ts's lint does. The checks are the same.
const LINT_TIMEOUT_MS = 60_000;

// A file in each group, and core's tests, which take the rest of src/core's
// rules and may read the environment; dev/ takes the rest of src's (M2).
const AT = {
  sim: 'src/core/sim/a.ts',
  'sim test': 'src/core/sim/a.test.ts',
  bot: 'src/core/bot/a.ts',
  'bot test': 'src/core/bot/a.test.ts',
  timeline: 'src/core/timeline/a.ts',
  'timeline test': 'src/core/timeline/a.test.ts',
  core: 'src/core/match-id.ts',
  render: 'src/render/a.ts',
  ui: 'src/ui/a.ts',
  net: 'src/net/a.ts',
  trystero: 'src/net/trystero.ts',
  // The one file that may load src/net/trystero.ts, with import() (M3).
  game: 'src/ui/game.ts',
  storage: 'src/storage/a.ts',
  main: 'src/main.ts',
  dev: 'dev/tuning/a.ts',
};
const ALL = Object.keys(AT);
const EXACT = ['sim', 'bot'];
const CORE_TESTS = ['sim test', 'bot test', 'timeline test'];
const SHIPPED_CORE = ['sim', 'bot', 'timeline', 'core'];
const CORE = [...SHIPPED_CORE, ...CORE_TESTS];
const but = (...out) => ALL.filter((g) => !out.includes(g));

const EXACT_OPS = 'hermet/exact-ops';
const SYNTAX = 'no-restricted-syntax';
const GLOBALS = 'no-restricted-globals';
const PROPERTIES = 'no-restricted-properties';
const IMPORTS = '@typescript-eslint/no-restricted-imports';
const UNDEF = 'no-undef';
const TYPE_SIDE_EFFECTS = '@typescript-eslint/no-import-type-side-effects';
const REQUIRE = '@typescript-eslint/no-require-imports';
// terriest's own (M3 design §1.36).
const CORE_IMPORTS = 'terriest/core-imports';
const LAZY = 'terriest/lazy-imports';
// A global the config names for src/core that isn't the language's own:
// no-undef fails it there too.
const DOM = { [GLOBALS]: CORE, [UNDEF]: CORE };

// Each construct: the rules that fail it, each in the groups listed. In
// every other group it lints clean.
const EXPECT = {
  // determinism.ts.fixture
  'Math.sin': { [EXACT_OPS]: EXACT },
  'Math by a computed name': { [EXACT_OPS]: EXACT },
  'the ** operator': { [EXACT_OPS]: EXACT },
  'Math.random': { [EXACT_OPS]: EXACT },
  'Date.now': { [EXACT_OPS]: EXACT, [GLOBALS]: CORE },
  'performance.now': { [EXACT_OPS]: EXACT, ...DOM },
  crypto: { [EXACT_OPS]: EXACT },
  Intl: { [EXACT_OPS]: EXACT },
  'Math destructured': { [SYNTAX]: EXACT },
  'Math aliased': { [SYNTAX]: EXACT },
  'Math passed on': { [SYNTAX]: EXACT },
  'a parameter typed typeof Math': { [SYNTAX]: EXACT },
  'a parameter typed Math': { [SYNTAX]: EXACT },
  'a parameter typed typeof Math.sin': { [SYNTAX]: EXACT },
  "a parameter typed as the global object's Math": { [SYNTAX]: EXACT },
  'a parameter typed by an indexed type of the global object': { [SYNTAX]: EXACT },
  'Math read from a parameter typed as the global object': { [SYNTAX]: EXACT },
  "Math picked from the global object's type": { [SYNTAX]: EXACT },
  "Math read as another object's property": { [SYNTAX]: EXACT },
  'Math destructured from another object': { [SYNTAX]: EXACT },
  'Math by a template key': { [SYNTAX]: EXACT },
  toLocaleString: { [SYNTAX]: EXACT },
  'toLocaleString by a string key': { [SYNTAX]: EXACT },
  'toLocaleString by a template key': { [SYNTAX]: EXACT },
  localeCompare: { [SYNTAX]: EXACT },
  Temporal: { [GLOBALS]: CORE },
  // Arrays only (PLAN §7.3, M2).
  'new Map': { [SYNTAX]: EXACT },
  'new Set': { [SYNTAX]: EXACT },
  'new WeakMap': { [SYNTAX]: EXACT },
  'new WeakSet': { [SYNTAX]: EXACT },
  'a class extending Map': { [SYNTAX]: EXACT },
  'a class expression extending Set': { [SYNTAX]: EXACT },
  'a Map constructor aliased': { [SYNTAX]: EXACT },
  'a Map constructor through a cast': { [SYNTAX]: EXACT },
  'a Set constructor by a comma': { [SYNTAX]: EXACT },
  'a Map built by Reflect.construct': { [SYNTAX]: EXACT },
  'a Map constructor passed on': { [SYNTAX]: EXACT },
  'a parameter typed MapConstructor': { [SYNTAX]: EXACT },
  'a Set iterated through a parameter typed ReadonlySet': { [SYNTAX]: EXACT },
  'a Map read from a parameter typed as the global object': { [SYNTAX]: EXACT },
  'a WeakMap by a string key': { [SYNTAX]: EXACT },
  'a WeakSet by a template key': { [SYNTAX]: EXACT },
  'keys named Map and Set': {},
  'exact operations, and keys named Math': {},
  // globals.ts.fixture
  'a DOM event listener': { [UNDEF]: CORE },
  'a media query': { [UNDEF]: CORE },
  'the pixel ratio': { [UNDEF]: CORE },
  'the Cache API': { [UNDEF]: CORE },
  'the cookie store': { [UNDEF]: CORE },
  'a broadcast channel': { [UNDEF]: CORE },
  'a WebTransport session': { [UNDEF]: CORE },
  'a worker': { [UNDEF]: CORE },
  "Node's setImmediate": { [UNDEF]: CORE },
  'the environment': { [UNDEF]: SHIPPED_CORE },
  'the globals src/core may use': {},
  // imports.ts.fixture
  three: { [IMPORTS]: but('render') },
  "three's addons": { [IMPORTS]: but('render') },
  "three's types": { [IMPORTS]: but('render') },
  'three re-exported': { [IMPORTS]: but('render') },
  'three imported dynamically': { [SYNTAX]: but('render') },
  'three in an import type': { [SYNTAX]: but('render') },
  'three imported by a template': { [SYNTAX]: ALL },
  'a module imported by a variable': { [SYNTAX]: ALL },
  "three's sources": { [IMPORTS]: ALL },
  "three's sources imported dynamically": { [SYNTAX]: ALL },
  "three's sources in an import type": { [SYNTAX]: ALL },
  "three's sources through node_modules": { [IMPORTS]: ALL, [CORE_IMPORTS]: CORE },
  "three's examples folder": { [IMPORTS]: ALL },
  Trystero: { [IMPORTS]: but('trystero') },
  'Trystero imported dynamically': { [SYNTAX]: but('trystero') },
  "Trystero's types": {},
  'Trystero in an import type': {},
  "Trystero's types re-exported": {},
  "Trystero's types by an inline type specifier": { [TYPE_SIDE_EFFECTS]: ALL },
  "Trystero's types re-exported by an inline type specifier": { [SYNTAX]: ALL },
  // src/core imports nothing outside src/core but src/config.ts: each
  // specifier is resolved against its file's own path (M3).
  'src/render': { [CORE_IMPORTS]: CORE },
  'src/ui': { [CORE_IMPORTS]: CORE },
  'src/input': { [CORE_IMPORTS]: CORE },
  'src/audio': { [CORE_IMPORTS]: CORE },
  'src/render by a path that starts with ./': { [CORE_IMPORTS]: CORE },
  "src/render's types": { [CORE_IMPORTS]: CORE },
  'src/ui imported dynamically': { [CORE_IMPORTS]: CORE },
  'src/render in an import type': { [CORE_IMPORTS]: CORE },
  // From dev/, {{src}} is ../../src, so its path detours through '..' as well.
  'src/render by a path through src/': { [CORE_IMPORTS]: CORE, [IMPORTS]: ['dev'] },
  'src/ui from the root': { [CORE_IMPORTS]: CORE },
  "a module by a detour through '..'": { [IMPORTS]: ALL, [CORE_IMPORTS]: CORE },
  "a module by a detour through '.'": { [IMPORTS]: ALL },
  "a module by a detour through '//'": { [IMPORTS]: ALL, [CORE_IMPORTS]: CORE },
  'a detour imported dynamically': { [SYNTAX]: ALL, [CORE_IMPORTS]: CORE },
  'a detour in an import type': { [SYNTAX]: ALL, [CORE_IMPORTS]: CORE },
  'import.meta.glob': { [SYNTAX]: ALL },
  "src/config and the core's own modules": {},
  'src/net': { [CORE_IMPORTS]: CORE },
  'src/net re-exported': { [CORE_IMPORTS]: CORE },
  'src/net re-exported whole': { [CORE_IMPORTS]: CORE },
  'src/net re-exported as a namespace': { [CORE_IMPORTS]: CORE },
  "src/net's types": { [CORE_IMPORTS]: CORE },
  'src/net in an import type': { [CORE_IMPORTS]: CORE },
  'src/storage': { [CORE_IMPORTS]: CORE },
  'src/main, for its side effects': { [CORE_IMPORTS]: CORE },
  'the net page': { [CORE_IMPORTS]: CORE },
  "the net page's parameters": { [CORE_IMPORTS]: CORE },
  'the determinism page imported dynamically': { [CORE_IMPORTS]: CORE },
  'the build info': { [CORE_IMPORTS]: CORE },
  'a module outside src': { [CORE_IMPORTS]: CORE, [IMPORTS]: ['dev'] },
  'a file outside src': { [CORE_IMPORTS]: CORE, [IMPORTS]: ['dev'] },
  'src/net from the root': { [CORE_IMPORTS]: CORE },
  // src/net/trystero.ts by import() from src/ui/game.ts alone, its types
  // anywhere, and src/net/dev-relay.ts by import() only (M3).
  'src/net/trystero': { [LAZY]: ALL, [CORE_IMPORTS]: CORE },
  'src/net/trystero re-exported': { [LAZY]: ALL, [CORE_IMPORTS]: CORE },
  'src/net/trystero re-exported whole': { [LAZY]: ALL, [CORE_IMPORTS]: CORE },
  'src/net/trystero re-exported as a namespace': { [LAZY]: ALL, [CORE_IMPORTS]: CORE },
  "src/net/trystero's types re-exported whole": { [CORE_IMPORTS]: CORE },
  'src/net/trystero for its side effects': { [LAZY]: ALL, [CORE_IMPORTS]: CORE },
  'src/net/trystero by its extension': { [LAZY]: ALL, [CORE_IMPORTS]: CORE },
  // './trystero' leads to it only from src/net.
  'src/net/trystero from its own folder': { [LAZY]: ['net', 'trystero'] },
  'src/net/trystero imported dynamically': { [LAZY]: but('game'), [CORE_IMPORTS]: CORE },
  "src/net/trystero's types": { [CORE_IMPORTS]: CORE },
  'src/net/trystero in an import type': { [CORE_IMPORTS]: CORE },
  "src/net/trystero's types re-exported": { [CORE_IMPORTS]: CORE },
  // Under verbatimModuleSyntax this loads the module: it's a static import.
  "src/net/trystero's types by an inline type specifier": { [TYPE_SIDE_EFFECTS]: ALL, [LAZY]: ALL, [CORE_IMPORTS]: CORE },
  'src/net/dev-relay': { [LAZY]: ALL, [CORE_IMPORTS]: CORE },
  'src/net/dev-relay imported dynamically': { [CORE_IMPORTS]: CORE },
  "src/net/dev-relay's types": { [CORE_IMPORTS]: CORE },
  // storage.ts.fixture
  'localStorage destructured from window': { [PROPERTIES]: but('storage'), ...DOM },
  'storage on globalThis, by optional chaining': { [PROPERTIES]: but('storage'), [GLOBALS]: CORE },
  'localStorage through a cast': { [PROPERTIES]: but('storage'), ...DOM },
  'localStorage through an alias': { [PROPERTIES]: but('storage'), ...DOM },
  'localStorage destructured from a parameter': { [PROPERTIES]: but('storage') },
  'a key named localStorage': {},
  // subpath.ts.fixture
  'history.pushState': { [SYNTAX]: ALL, ...DOM },
  'history.replaceState': { [SYNTAX]: ALL, ...DOM },
  'history.pushState by a computed name': { [SYNTAX]: ALL, ...DOM },
  'history.replaceState by a template key': { [SYNTAX]: ALL, ...DOM },
  'history.pushState destructured': { [SYNTAX]: ALL, ...DOM },
  'location.hash set': { [SYNTAX]: ALL, ...DOM },
  'fetch from the root': { [SYNTAX]: ALL, ...DOM },
  'fetch from the root, in a template': { [SYNTAX]: ALL, ...DOM },
  'fetch from the root, joined three deep': { [SYNTAX]: ALL, ...DOM },
  'window.fetch from the root': { [SYNTAX]: ALL, ...DOM },
  'a URL from the root': { [SYNTAX]: ALL },
  'a URL from the root, joined': { [SYNTAX]: ALL },
  'location.replace to the root': { [SYNTAX]: ALL, ...DOM },
  'location.replace by a computed name': { [SYNTAX]: ALL, ...DOM },
  'window.location.assign to the root': { [SYNTAX]: ALL, ...DOM },
  'location.assign to the root, joined': { [SYNTAX]: ALL, ...DOM },
  'window.open to the root': { [SYNTAX]: ALL, ...DOM },
  'open to the root': { [SYNTAX]: ALL, [UNDEF]: CORE },
  'location to the root': { [SYNTAX]: ALL, ...DOM },
  'window.location to the root': { [SYNTAX]: ALL, ...DOM },
  'location.href to the root': { [SYNTAX]: ALL, ...DOM },
  'location.href to the root, in a template': { [SYNTAX]: ALL, ...DOM },
  'location.href to the root, joined twice': { [SYNTAX]: ALL, ...DOM },
  'location.pathname to the root': { [SYNTAX]: ALL, ...DOM },
  'location to the root, in a template': { [SYNTAX]: ALL, ...DOM },
  'a link to the root': { [SYNTAX]: ALL },
  "an image from another host's root": { [SYNTAX]: ALL },
  'relative URLs, and the fragment set by location.replace': DOM,
};

// The global object under each name, the DOM, timers and clocks, the
// network and code from strings, as the config names them: banned in
// src/core only. no-undef can't see the language's own.
const CORE_GLOBALS = [
  'window', 'self', 'globalThis', 'global', 'frames', 'parent', 'top',
  'document', 'navigator', 'location', 'history',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'queueMicrotask',
  'performance', 'Date', 'Temporal',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection',
  'eval', 'Function',
];
const LANGUAGE_OWN = new Set(['globalThis', 'Date', 'Temporal', 'eval', 'Function']);
const STORAGE = ['localStorage', 'sessionStorage', 'indexedDB'];
// Ways to the global object outside src/core: its names, an alias and a cast.
const STORAGE_HOLDERS = ['window', 'globalThis', 'self', 'top', 'parent', 'frames', 'document.defaultView', '(window as Window)'];

const srcFrom = (file) => posix.relative(posix.dirname(file), 'src') || '.';
const ruleIds = async (code, file) => {
  const [result] = await eslint.lintText(code, { filePath: file });
  return [...new Set(result.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`))].sort();
};
/** The rule IDs each group reports for `code`, against those `want` expects. */
async function compare(code, want) {
  const got = {};
  const expected = {};
  for (const [group, file] of Object.entries(AT)) {
    got[group] = await ruleIds(code.replaceAll('{{src}}', srcFrom(file)), file);
    expected[group] = Object.entries(want)
      .filter(([, groups]) => groups.includes(group))
      .map(([rule]) => rule)
      .sort();
  }
  return { got, expected };
}

const FIXTURES = new URL('./fixtures/', import.meta.url);
const sections = (file) =>
  readFileSync(new URL(file, FIXTURES), 'utf8')
    .split(/^\/\/ == /m)
    .slice(1)
    .map((s) => [s.slice(0, s.indexOf('\n')).trim(), s.slice(s.indexOf('\n') + 1)]);
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.fixture')).sort();

describe('the project lint, group by group (D-38)', { timeout: LINT_TIMEOUT_MS }, () => {
  it('has an expectation for every construct in the fixtures, and a construct for every expectation', () => {
    const names = fixtures.flatMap((f) => sections(f).map(([name]) => name));
    expect([...names].sort()).toEqual(Object.keys(EXPECT).sort());
  });

  for (const file of fixtures) {
    describe(file, () => {
      for (const [name, code] of sections(file)) {
        it(name, async () => {
          const { got, expected } = await compare(code, EXPECT[name] ?? {});
          expect(got).toEqual(expected);
        });
      }
    });
  }

  it('bans the DOM, timers, clocks, the network and the global object in src/core only', async () => {
    for (const name of CORE_GLOBALS) {
      const exactToo = name === 'Date' || name === 'performance';
      const { got, expected } = await compare(`export const a = ${name};\n`, {
        [GLOBALS]: CORE,
        ...(LANGUAGE_OWN.has(name) ? {} : { [UNDEF]: CORE }),
        ...(exactToo ? { [EXACT_OPS]: EXACT } : {}),
      });
      expect(got, name).toEqual(expected);
    }
  });

  it("bans browser storage outside src/storage, on any object, the global object's names included", async () => {
    for (const name of STORAGE) {
      const bare = await compare(`export const a = ${name};\n`, { [GLOBALS]: but('storage'), [UNDEF]: CORE });
      expect(bare.got, name).toEqual(bare.expected);
      for (const holder of STORAGE_HOLDERS) {
        const { got, expected } = await compare(`export const a = ${holder}.${name};\n`, {
          [PROPERTIES]: but('storage'),
          ...(holder === 'globalThis' ? { [GLOBALS]: CORE } : DOM),
        });
        expect(got, `${holder}.${name}`).toEqual(expected);
      }
    }
  });
});

describe('the files the lint reaches', { timeout: LINT_TIMEOUT_MS }, () => {
  const EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];

  it('lints every script extension in src/core/sim and src/core/bot (D-38, M0)', async () => {
    for (const ext of EXTS) {
      for (const dir of ['src/core/sim', 'src/core/bot']) {
        expect(await ruleIds('Math.sin(1);\n', `${dir}/a.${ext}`), `${dir}/a.${ext}`).toEqual([EXACT_OPS]);
      }
      expect(await ruleIds('Math.sin(1);\n', `src/core/sim/a.test.${ext}`), `a.test.${ext}`).toEqual([]);
      expect(await ruleIds('Math.sin(1);\n', `src/render/a.${ext}`), `src/render/a.${ext}`).toEqual([]);
    }
  });

  it('holds the boundaries in every script extension across src, with the same rules as .ts', async () => {
    for (const ext of EXTS) {
      expect(await ruleIds("import 'three';\n", `src/ui/a.${ext}`), `src/ui/a.${ext}`).toEqual([IMPORTS]);
      expect(await ruleIds("import 'three';\n", `src/render/a.${ext}`), `src/render/a.${ext}`).toEqual([]);
      // require() would load three past the import bans, so it's banned outright.
      expect(await ruleIds("export const t = require('three');\n", `src/ui/a.${ext}`), `require in src/ui/a.${ext}`).toEqual([REQUIRE]);
      expect(await ruleIds("export const t = require('three');\n", `src/core/sim/a.${ext}`), `require in src/core/sim/a.${ext}`).toEqual([
        REQUIRE,
        UNDEF,
      ]);
      // The browser's globals outside src/core, as in .ts; none inside it.
      expect(await ruleIds("document.title = 'x';\n", `src/render/a.${ext}`), `document in src/render/a.${ext}`).toEqual([]);
      expect(await ruleIds("document.title = 'x';\n", `src/core/timeline/a.${ext}`), `document in src/core/timeline/a.${ext}`).toEqual([
        GLOBALS,
        UNDEF,
      ]);
    }
    expect(await ruleIds('export const a = localStorage;\n', 'src/ui/a.tsx')).toEqual([GLOBALS]);
  });

  it("holds M3's module rules in every script extension: src/core's imports, and src/net/trystero.ts by import() alone", async () => {
    for (const ext of EXTS) {
      expect(await ruleIds("import '../../net/local';\n", `src/core/timeline/a.${ext}`), `src/core/timeline/a.${ext}`).toEqual([CORE_IMPORTS]);
      expect(await ruleIds("import '../../config';\n", `src/core/timeline/a.${ext}`), `config from a.${ext}`).toEqual([]);
      expect(await ruleIds("import './trystero';\n", `src/net/a.${ext}`), `src/net/a.${ext}`).toEqual([LAZY]);
      expect(await ruleIds("export const m = import('./dev-relay');\n", `src/net/a.${ext}`), `dev-relay from a.${ext}`).toEqual([]);
    }
    expect(await ruleIds("export const m = import('../net/trystero');\n", 'src/ui/game.ts')).toEqual([]);
    expect(await ruleIds("export const m = import('../net/trystero');\n", 'src/ui/game.test.ts')).toEqual([LAZY]);
    expect(await ruleIds("export const m = import('../net/trystero');\n", 'src/ui/practice.ts')).toEqual([LAZY]);
    // TrysteroRoom's own test, which no build bundles, loads it either way; no other test may.
    expect(await ruleIds("import { openRoom } from './trystero';\nexport const o = openRoom;\n", 'src/net/trystero.test.ts')).toEqual([]);
    expect(await ruleIds("export const m = import('./trystero');\n", 'src/net/trystero.test.ts')).toEqual([]);
    expect(await ruleIds("import './trystero';\n", 'src/net/loopback.test.ts')).toEqual([LAZY]);
    expect(await ruleIds("export const m = import('./trystero');\n", 'src/net/trystero.test.tsx')).toEqual([LAZY]);
  });

  it("gives every test in src/core the environment, and src/core's own code none", async () => {
    for (const ext of EXTS) {
      expect(await ruleIds('export const a = process.env.X;\n', `src/core/timeline/a.test.${ext}`), `a.test.${ext}`).toEqual([]);
      expect(await ruleIds('export const a = process.env.X;\n', `src/core/timeline/a.${ext}`), `a.${ext}`).toEqual([UNDEF]);
    }
  });

  it('holds public/boot.js, a classic browser script, to the subpath bans', async () => {
    expect(await ruleIds("document.title = 'x';\nsetTimeout(() => location.replace('#x'), 1);\n", 'public/boot.js')).toEqual([]);
    expect(await ruleIds("window.history.pushState(null, '', '#x');\n", 'public/boot.js')).toEqual([SYNTAX]);
    expect(await ruleIds("location.href = '/';\n", 'public/boot.js')).toEqual([SYNTAX]);
    expect(await ruleIds("location.hash = '#x';\n", 'public/boot.js')).toEqual([SYNTAX]);
  });

  it('leaves research/ to its own toolchain (D-36), and the fixtures out of `eslint .`', async () => {
    await expect(eslint.lintFiles(['research'])).rejects.toThrow('are ignored');
    expect(await eslint.isPathIgnored('scripts/eslint/fixtures/imports.ts.fixture')).toBe(true);
  });
});
