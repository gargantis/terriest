// PLAN D-38's lint boundaries, on hermet's shared base (D-37), which also
// keeps research/ out: the M0 spike lints itself (D-36).
//
// One list per file group: in a flat config, a later object's options for a
// rule replace an earlier one's for every file both match, so bans in
// separate objects would silently cancel each other. groupRules() builds
// each rule's options once for each of six disjoint groups: src/core/sim
// and src/core/bot; the rest of src/core, with the simulation's and bots'
// tests; src/render; src/net/trystero.ts; src/storage; the rest of src.
// scripts/eslint/config.test.mjs lints every ban in each group.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { baseConfig } from './vendor/hermet/eslint/base.mjs';
import exactOps from './vendor/hermet/eslint/exact-ops.mjs';

// Every script extension, so a .tsx or .jsx file can't slip past the bans
// (D-38, M0). The groups cover all of src this way, not only the simulation.
const EXT = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const SRC = [`src/**/*.${EXT}`];
const under = (...dirs) => dirs.map((d) => `src/${d}/**/*.${EXT}`);
const testsOf = (globs) => globs.map((p) => p.replace('/**/*.', '/**/*.test.'));
const SIM = under('core/sim', 'core/bot');
const SIM_TESTS = testsOf(SIM);
const CORE_TESTS = testsOf(under('core'));
const TRYSTERO_FILE = 'src/net/trystero.ts';

// An esquery regex can't hold a '/', so \x2F stands for it.
const esq = (re) => `/${re.replaceAll('/', '\\x2F')}/`;
const readonly = (names) => Object.fromEntries(names.map((n) => [n, 'readonly']));

// --- Imports (D-18, D-26, REQUIREMENTS L252) ---

const THREE = '^three(/|$)';
const THREE_NOT_ADDONS = '^three/(?!addons/)';
const TRYSTERO = '^@trystero-p2p/';
// A specifier that climbs out of its folder and names a drawing or browser
// folder. The paths are part of the contract (PLAN §6): src/core holds no
// folder of those names, so `./input` and `../protocol/input` stay allowed.
const BROWSER_DIRS = '^((\\.{1,2}/)*\\.\\./(\\.{1,2}/)*(src/)?|/src/)(render|ui|input|audio)(/|\\.|$)';
// The bans read a specifier as written, so it's written plainly: a package
// by its name, never through node_modules, and a path without a detour, no
// '.' or '..' after a named folder and no '//' ('../config/../render/scene').
const DETOUR = '(^|/)node_modules(/|$)|(^|/)(?!\\.\\.?(/|$))[^/]+/(.*/)?\\.\\.?(/|$)|//';

const THREE_MESSAGE = 'Only src/render imports three (PLAN D-26, D-38).';
const THREE_SRC_MESSAGE =
  "three is imported from 'three' and 'three/addons/…' only: its unbuilt sources would bundle a second copy (PLAN §15, D-38).";
const TRYSTERO_MESSAGE = 'Only src/net/trystero.ts imports Trystero; types may be imported anywhere (PLAN D-18, D-38).';
const BROWSER_DIRS_MESSAGE = 'src/core never imports src/render, src/ui, src/input or src/audio (REQUIREMENTS L252, PLAN D-38).';
const DETOUR_MESSAGE =
  "Import a package by its name and a module by its plain path, with no node_modules, '.', '..' or '//' detour, so the import bans read where it leads (PLAN D-38).";

// no-restricted-imports reads static imports and re-exports only; these
// are the same sources for import('…') and for import('…') types.
const dynamicBans = (re, message, { types = true } = {}) => [
  { selector: `ImportExpression[source.value=${esq(re)}]`, message },
  ...(types ? [{ selector: `TSImportType[source.value=${esq(re)}]`, message }] : []),
];
// And the bans read only a string: an import() of a template or a variable,
// and Vite's import.meta.glob, load modules they never see. Under
// verbatimModuleSyntax, tsc writes `export { type X } from 'm'` as
// `export {} from 'm'`, which loads m, as it does for the import form that
// no-import-type-side-effects catches (below).
const IMPORT_FORM_BANS = [
  {
    selector: "ImportExpression[source.type!='Literal']",
    message: 'import() takes a plain string, so the import bans can read where it leads (PLAN D-38).',
  },
  {
    selector: "MemberExpression[object.type='MetaProperty'][property.name=/^glob/]",
    message: "import.meta.glob's patterns are out of the import bans' reach; import each module by name (PLAN D-38).",
  },
  {
    selector:
      "ExportNamedDeclaration[exportKind='value'][source]:has(ExportSpecifier):not(:has(ExportSpecifier[exportKind='value']))",
    message: "Re-export types with `export type { … } from`: `export { type X } from 'm'` still loads m (PLAN D-18, D-38).",
  },
];

// --- Globals (PLAN §6, D-38) ---

const GLOBAL_OBJECT = ['window', 'self', 'globalThis', 'global', 'frames', 'parent', 'top'];
const CORE_MESSAGE =
  'src/core is pure: no DOM, timers, clocks, storage or network, and no global object; the caller passes them in (PLAN §6, D-38).';
// src/core is linted with no-undef and only these globals beyond the
// language's own, so every DOM, timer, storage and network global fails
// there, listed below or not. Its tests run in Node and may also read the
// environment (roslambo's golden test).
const CORE_ALLOWED = ['console', 'crypto', 'structuredClone', 'TextDecoder', 'TextEncoder', 'URL'];
const CORE_TEST_ALLOWED = ['process'];
// Named too, for the message, and because no-undef can't see the language's
// own: the global object, the clocks and code from strings.
const CORE_GLOBALS = [
  // The global object under each of its names, so no global is reached as a property.
  ...GLOBAL_OBJECT,
  // The DOM.
  'document', 'navigator', 'location', 'history',
  // Timers and clocks: the timeline is handed the time (roslambo's core rule).
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'queueMicrotask',
  'performance', 'Date', 'Temporal',
  // Storage.
  'localStorage', 'sessionStorage', 'indexedDB',
  // The network.
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection',
  // Code from strings, which reaches the global object.
  'eval', 'Function',
].map((name) => ({ name, message: CORE_MESSAGE }));

const STORAGE_MESSAGE = 'Only src/storage touches browser storage (PLAN D-38).';
const STORAGE = ['localStorage', 'sessionStorage', 'indexedDB'];
const STORAGE_GLOBALS = STORAGE.map((name) => ({ name, message: STORAGE_MESSAGE }));
// On every object, not only window, globalThis and self: a cast, a chain or
// another name for the global object (`top?.localStorage`) reaches it too.
const STORAGE_PROPERTIES = STORAGE.map((property) => ({ property, message: STORAGE_MESSAGE }));

// --- Syntax ---

// D-1: hermet's exact-ops rule matches Math.<name> by name, so Math is used
// only that way: never destructured, aliased, passed on, named in a type or
// read as another object's property (`g.Math`, for a g typed as the global
// object), where it would reach Math.sin (M0). Keys may be named Math.
const MATH_MESSAGE =
  'In src/core/sim and src/core/bot, Math appears only as Math.<name>: exact-ops matches names, so an alias, a destructured member, a parameter typed as Math or Math read as a property slips past it (PLAN D-1, D-38).';
const MATH_BANS = [
  'Identifier[name="Math"]:not(MemberExpression > .object, ObjectExpression > Property > .key, PropertyDefinition > .key, MethodDefinition > .key, TSPropertySignature > .key, TSMethodSignature > .key)',
  'Literal[value="Math"]',
  'TemplateElement[value.raw="Math"]',
].map((selector) => ({ selector, message: MATH_MESSAGE }));
// Formatting and comparing by locale vary by machine (D-38, M0).
const LOCALE_MESSAGE = 'Locale-dependent methods differ between machines and are banned in deterministic code (PLAN D-38).';
const LOCALE = '/^(toLocale|localeCompare$)/';
const LOCALE_BANS = [`Identifier[name=${LOCALE}]`, `Literal[value=${LOCALE}]`, `TemplateElement[value.raw=${LOCALE}]`].map(
  (selector) => ({ selector, message: LOCALE_MESSAGE }),
);

// amorfus's subpath bans: the site works from any path (REQUIREMENTS L232).
const HISTORY_MESSAGE = 'The History API breaks subpath hosting; set the fragment with location.replace (PLAN §11, D-38).';
const HASH_MESSAGE =
  'Assigning location.hash adds a history entry, so Back and Forward would re-open old #join= links; set the fragment with location.replace (PLAN §11).';
const ROOT_MESSAGE = 'Root-absolute URLs break subpath hosting; use a relative URL (REQUIREMENTS L232, PLAN D-38).';
const ROOT = esq('^/');
const HISTORY = '/^(pushState|replaceState)$/';
// A member named by `re`, written a.name or a['name'].
const named = (node, re) => `:matches([${node}.property.name=${re}], [${node}.property.value=${re}])`;
const IS_LOCATION = (node) => `:matches([${node}.name='location'], [${node}.property.name='location'])`;
// Calls whose first argument is a URL, and assignments that navigate or
// load one: location, its href and pathname, and any element's href or src.
const URL_TAKERS = [
  "CallExpression:matches([callee.name='fetch'], [callee.property.name='fetch'])",
  "NewExpression[callee.name='URL']",
  `CallExpression${named('callee', '/^(assign|replace)$/')}${IS_LOCATION('callee.object')}`,
  "CallExpression:matches([callee.name='open'], [callee.object.name=/^(window|self|globalThis)$/][callee.property.name='open'])",
];
const NAVIGATIONS = [
  `AssignmentExpression${IS_LOCATION('left')}`,
  `AssignmentExpression${named('left', "'pathname'")}${IS_LOCATION('left.object')}`,
  `AssignmentExpression${named('left', '/^(href|src)$/')}`,
];
// Where a URL starts: a string, a template's first part, or the leftmost
// operand of a '+' chain, three deep ('/' + id is root-absolute too).
const PLUS = "BinaryExpression[operator='+']";
const startsAtRoot = (at) => {
  const leaves = (pos) => [`Literal${pos}[value=${ROOT}]`, `TemplateLiteral${pos} > TemplateElement:first-child[value.raw=${ROOT}]`];
  const starts = leaves(at);
  let chain = `${PLUS}${at}`;
  for (let depth = 0; depth < 3; depth += 1) {
    starts.push(...leaves('.left').map((leaf) => `${chain} > ${leaf}`));
    chain += ` > ${PLUS}.left`;
  }
  return starts;
};
const SUBPATH_BANS = [
  ...[
    `MemberExpression:matches([property.name=${HISTORY}], [property.value=${HISTORY}])`,
    `MemberExpression[computed=true] > TemplateLiteral.property > TemplateElement[value.raw=${HISTORY}]`,
    `ObjectPattern > Property:matches([key.name=${HISTORY}], [key.value=${HISTORY}])`,
  ].map((selector) => ({ selector, message: HISTORY_MESSAGE })),
  { selector: `AssignmentExpression${named('left', "'hash'")}${IS_LOCATION('left.object')}`, message: HASH_MESSAGE },
  ...URL_TAKERS.flatMap((taker) => startsAtRoot(':first-child').map((s) => ({ selector: `${taker} > ${s}`, message: ROOT_MESSAGE }))),
  ...NAVIGATIONS.flatMap((to) => startsAtRoot('.right').map((s) => ({ selector: `${to} > ${s}`, message: ROOT_MESSAGE }))),
];

/** Each rule's options for one file group, built once (D-38). */
function groupRules({ exact = false, core = false, render = false, trystero = false, storage = false }) {
  const imports = [{ regex: DETOUR, message: DETOUR_MESSAGE }];
  const syntax = [...IMPORT_FORM_BANS, ...dynamicBans(DETOUR, DETOUR_MESSAGE), ...SUBPATH_BANS];
  if (render) {
    imports.push({ regex: THREE_NOT_ADDONS, message: THREE_SRC_MESSAGE });
    syntax.push(...dynamicBans(THREE_NOT_ADDONS, THREE_SRC_MESSAGE));
  } else {
    imports.push({ regex: THREE, message: THREE_MESSAGE });
    syntax.push(...dynamicBans(THREE, THREE_MESSAGE));
  }
  if (!trystero) {
    imports.push({ regex: TRYSTERO, allowTypeImports: true, message: TRYSTERO_MESSAGE });
    syntax.push(...dynamicBans(TRYSTERO, TRYSTERO_MESSAGE, { types: false }));
  }
  if (core) {
    imports.push({ regex: BROWSER_DIRS, message: BROWSER_DIRS_MESSAGE });
    syntax.push(...dynamicBans(BROWSER_DIRS, BROWSER_DIRS_MESSAGE));
  }
  if (exact) syntax.push(...MATH_BANS, ...LOCALE_BANS);
  const globals = core ? CORE_GLOBALS : storage ? [] : STORAGE_GLOBALS;
  return {
    ...(exact ? { 'hermet/exact-ops': 'error' } : {}),
    ...(core ? { 'no-undef': 'error' } : {}),
    '@typescript-eslint/no-restricted-imports': ['error', { patterns: imports }],
    'no-restricted-syntax': ['error', ...syntax],
    'no-restricted-globals': globals.length > 0 ? ['error', ...globals] : 'off',
    'no-restricted-properties': storage ? 'off' : ['error', ...STORAGE_PROPERTIES],
  };
}

const coreRules = groupRules({ core: true });
const coreLanguage = { globals: readonly(CORE_ALLOWED) };
// The base gives .ts files typescript-eslint's rules; these are the rest.
const SRC_NOT_TS = ['src/**/*.{tsx,mts,cts,js,jsx,mjs,cjs}'];

export default defineConfig(
  ...baseConfig(),
  {
    // The TypeScript parser for every script in src, whatever its extension.
    files: SRC,
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin, hermet: { rules: { 'exact-ops': exactOps } } },
    rules: {
      // Under verbatimModuleSyntax, `import { type X } from 'm'` is written
      // `import {} from 'm'`, which loads m: an inline type import of
      // Trystero would bundle it (D-18, D-38). `import type` is erased.
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  // typescript-eslint's rules for every other extension too: no-undef off,
  // as for .ts, and no require(), which the import bans can't read.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: SRC_NOT_TS })),
  {
    files: SRC_NOT_TS,
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  // The six groups. exact-ops and the Math and locale bans guard shipped
  // simulation and bot code; their tests may use ordinary maths (D-38).
  { files: SIM, ignores: SIM_TESTS, languageOptions: coreLanguage, rules: groupRules({ exact: true, core: true }) },
  { files: under('core'), ignores: SIM, languageOptions: coreLanguage, rules: coreRules },
  { files: SIM_TESTS, languageOptions: coreLanguage, rules: coreRules },
  // Globals merge, so core's tests keep the list above and add these.
  { files: CORE_TESTS, languageOptions: { globals: readonly(CORE_TEST_ALLOWED) } },
  { files: under('render'), rules: groupRules({ render: true }) },
  { files: [TRYSTERO_FILE], rules: groupRules({ trystero: true }) },
  { files: under('storage'), rules: groupRules({ storage: true }) },
  { files: SRC, ignores: [...under('core', 'render', 'storage'), TRYSTERO_FILE], rules: groupRules({}) },
  {
    // boot.js is a classic script that runs before the module, browser only
    // (D-30, as amorfus's), and is served from the same subpath.
    files: ['public/boot.js'],
    languageOptions: {
      sourceType: 'script',
      globals: readonly(['window', 'document', 'location', 'navigator', 'setTimeout', 'clearTimeout']),
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-restricted-syntax': ['error', ...SUBPATH_BANS],
    },
  },
);
