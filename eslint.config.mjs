// PLAN D-38's lint boundaries, on hermet's shared base (D-37), which also
// keeps research/ out: the M0 spike lints itself (D-36).
//
// One list per file group: in a flat config, a later object's options for a
// rule replace an earlier one's for every file both match, so bans in
// separate objects would silently cancel each other. groupRules() builds
// each rule's options once for each of six disjoint groups: src/core/sim
// and src/core/bot; the rest of src/core, with the simulation's and bots'
// tests; src/render; src/net/trystero.ts; src/storage; the rest of src,
// with dev/, the tuning page (M2). scripts/eslint/config.test.mjs lints
// every ban in each group.
//
// M3 adds two rules of terriest's own, which resolve each specifier against
// its file's path, as a pattern on the specifier as written can't (design
// §1.36): src/core imports nothing outside src/core but src/config.ts, and
// src/net/trystero.ts and src/net/dev-relay.ts are loaded only by import(),
// Trystero's file from src/ui/game.ts alone, and by its own unit test, which
// no build bundles and which mocks Trystero (M3 phase 2's integration).
import { dirname, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { baseConfig } from './vendor/hermet/eslint/base.mjs';
import exactOps from './vendor/hermet/eslint/exact-ops.mjs';

// Every script extension, so a .tsx or .jsx file can't slip past the bans
// (D-38, M0). The groups cover all of src this way, not only the simulation.
const EXT = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const SRC = [`src/**/*.${EXT}`];
// The tuning page and its metrics (design §9): never built, but kept to the
// rest of src's bans, so three stays in src/render and storage in
// src/storage there too (D-26, D-38, M2).
const DEV = [`dev/**/*.${EXT}`];
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
// The bans read a specifier as written, so it's written plainly: a package
// by its name, never through node_modules, and a path without a detour, no
// '.' or '..' after a named folder and no '//' ('../config/../render/scene').
const DETOUR = '(^|/)node_modules(/|$)|(^|/)(?!\\.\\.?(/|$))[^/]+/(.*/)?\\.\\.?(/|$)|//';

const THREE_MESSAGE = 'Only src/render imports three (PLAN D-26, D-38).';
const THREE_SRC_MESSAGE =
  "three is imported from 'three' and 'three/addons/…' only: its unbuilt sources would bundle a second copy (PLAN §15, D-38).";
const TRYSTERO_MESSAGE = 'Only src/net/trystero.ts imports Trystero; types may be imported anywhere (PLAN D-18, D-38).';
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

// --- Module boundaries, by where a specifier leads (M3 design §1.36) ---

// Paths as these rules compare them: repo-relative, from this config's
// folder, with '/'.
const REPO = dirname(fileURLToPath(import.meta.url));
const fromRoot = (file) => relative(REPO, file).split(sep).join('/');
const SCRIPT_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
/** Where a specifier leads from `file`, repo-relative, or null for a
 *  package. A root-absolute one is from the project root, as Vite reads it. */
function target(file, specifier) {
  const path = specifier.replace(/[?#][\s\S]*$/, '');
  if (path.startsWith('/')) return posix.normalize(path.slice(1));
  if (path === '.' || path === '..' || path.startsWith('./') || path.startsWith('../')) {
    return posix.normalize(posix.join(posix.dirname(file), path));
  }
  return null;
}
/** The visitors that hand `check` each module a file names, and how:
 *  'static' (an import or a re-export, a bare import for its side effects
 *  among them), 'type' (import type, export type, an import type), or
 *  'dynamic' (import()). */
function eachModule(check) {
  const from = (node, how) => {
    if (typeof node?.value === 'string') check(node, node.value, how);
  };
  return {
    ImportDeclaration: (n) => from(n.source, n.importKind === 'type' ? 'type' : 'static'),
    ExportNamedDeclaration: (n) => from(n.source, n.exportKind === 'type' ? 'type' : 'static'),
    ExportAllDeclaration: (n) => from(n.source, n.exportKind === 'type' ? 'type' : 'static'),
    TSImportEqualsDeclaration: (n) => from(n.moduleReference.expression, n.importKind === 'type' ? 'type' : 'static'),
    ImportExpression: (n) => from(n.source, 'dynamic'),
    TSImportType: (n) => from(n.source, 'type'),
  };
}

const CORE_IMPORTS_MESSAGE =
  'src/core imports nothing outside src/core but src/config.ts: no drawing, page, network, storage or build module, so the simulation, the timeline and the session stay pure (REQUIREMENTS L252, PLAN D-38, M3 design §1.36).';
const IN_CORE = /^src\/core(\/|$)/;
const CONFIG_MODULE = /^src\/config(\.[cm]?[jt]sx?)?$/;
const coreImports = {
  meta: { type: 'problem', schema: [], messages: { outside: CORE_IMPORTS_MESSAGE } },
  create(context) {
    const file = fromRoot(context.filename);
    return eachModule((node, specifier) => {
      const to = target(file, specifier);
      if (to !== null && !IN_CORE.test(to) && !CONFIG_MODULE.test(to)) context.report({ node, messageId: 'outside' });
    });
  },
};

const GAME_FILE = 'src/ui/game.ts';
// TrysteroRoom's own test, against a mocked Trystero: never bundled.
const TRYSTERO_TEST = 'src/net/trystero.test.ts';
const lazyImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      trystero:
        'src/net/trystero.ts is never imported statically, so a normal page, the determinism page and Practice never load Trystero: src/ui/game.ts loads it with import() when a networked match opens. Its types may be imported anywhere (L238, PLAN D-18, M3 design §1.36).',
      trysteroDynamic: 'Only src/ui/game.ts loads src/net/trystero.ts, with import(), when a networked match opens (L238, PLAN D-18, M3 design §1.36).',
      devRelay:
        "src/net/dev-relay.ts is loaded only with import(), under import.meta.env.DEV, so a production build never bundles npm run dev:local's relay, and a chunk of its own would show if one did (PLAN §15, M3 design §1.29, §1.33).",
    },
  },
  create(context) {
    const file = fromRoot(context.filename);
    return eachModule((node, specifier, how) => {
      const to = target(file, specifier)?.replace(SCRIPT_EXT, '');
      if (to === 'src/net/trystero') {
        if (file === TRYSTERO_TEST) return;
        if (how === 'static') context.report({ node, messageId: 'trystero' });
        else if (how === 'dynamic' && file !== GAME_FILE) context.report({ node, messageId: 'trysteroDynamic' });
      } else if (to === 'src/net/dev-relay' && how === 'static') {
        context.report({ node, messageId: 'devRelay' });
      }
    });
  },
};

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
// Arrays only (PLAN §7.3, M2): a Map or Set iterates in insertion order,
// which can follow arrival order, and a per-object cache carries one call's
// state into the next. A ban on `new Map` alone misses an alias, a cast, a
// comma or Reflect.construct, so, as with Math, the names appear only as
// keys: never constructed, extended, aliased, passed on, named in a type
// (ReadonlySet and MapConstructor too) or read as a property (`g.Map`, for
// a g typed as the global object). A Set passed in as an Iterable is out of
// a syntax rule's reach, and holds by review.
const COLLECTION_MESSAGE =
  'Arrays only in src/core/sim and src/core/bot: a Map or Set iterates in insertion order, which can follow arrival order, so none is named but as a key: never constructed, aliased, passed on or typed (PLAN §7.3, D-38).';
const COLLECTION = '/^(Readonly|Weak)?(Map|Set)(Constructor)?$/';
const COLLECTION_BANS = [
  `Identifier[name=${COLLECTION}]:not(ObjectExpression > Property > .key, PropertyDefinition > .key, MethodDefinition > .key, TSPropertySignature > .key, TSMethodSignature > .key)`,
  `Literal[value=${COLLECTION}]`,
  `TemplateElement[value.raw=${COLLECTION}]`,
].map((selector) => ({ selector, message: COLLECTION_MESSAGE }));

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
  if (exact) syntax.push(...MATH_BANS, ...LOCALE_BANS, ...COLLECTION_BANS);
  const globals = core ? CORE_GLOBALS : storage ? [] : STORAGE_GLOBALS;
  return {
    ...(exact ? { 'hermet/exact-ops': 'error' } : {}),
    ...(core ? { 'no-undef': 'error', 'terriest/core-imports': 'error' } : {}),
    'terriest/lazy-imports': 'error',
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
    // The TypeScript parser for every script in src and dev, whatever its extension.
    files: [...SRC, ...DEV],
    languageOptions: { parser: tseslint.parser },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      hermet: { rules: { 'exact-ops': exactOps } },
      terriest: { rules: { 'core-imports': coreImports, 'lazy-imports': lazyImports } },
    },
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
  // The six groups. exact-ops and the Math, locale and collection bans guard
  // shipped simulation and bot code; their tests may use ordinary maths and
  // collections (D-38).
  { files: SIM, ignores: SIM_TESTS, languageOptions: coreLanguage, rules: groupRules({ exact: true, core: true }) },
  { files: under('core'), ignores: SIM, languageOptions: coreLanguage, rules: coreRules },
  { files: SIM_TESTS, languageOptions: coreLanguage, rules: coreRules },
  // Globals merge, so core's tests keep the list above and add these.
  { files: CORE_TESTS, languageOptions: { globals: readonly(CORE_TEST_ALLOWED) } },
  { files: under('render'), rules: groupRules({ render: true }) },
  { files: [TRYSTERO_FILE], rules: groupRules({ trystero: true }) },
  { files: under('storage'), rules: groupRules({ storage: true }) },
  { files: [...SRC, ...DEV], ignores: [...under('core', 'render', 'storage'), TRYSTERO_FILE], rules: groupRules({}) },
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
