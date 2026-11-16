// The spike's own ESLint config (PLAN §17 M0). hermet's base ignores
// research/, so the spike lints itself, with D-1 and D-38 as they apply here:
// - src/sim, tests excluded, keeps to exact operations: hermet's exact-ops
//   rule, from the hermet checkout beside this repo (D-37). There, Math is
//   used only as Math.<name>, since the rule matches names and an alias or a
//   destructured member slips past it, and no DOM, timer, storage or
//   network global is reached;
// - nothing in src/sim, tests included, imports three or src/scene.
// In a flat config, a later object's options for a rule replace an earlier
// one's for every file both match (D-38), so each rule's options are set
// once per disjoint file group: src/sim without its tests, and its tests.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import exactOps from '../../../hermet/eslint/exact-ops.mjs';

const TS = ['**/*.{ts,mts,cts}'];
const SIM = ['src/sim/**/*.{ts,mts,cts,js,mjs,cjs}'];
const SIM_TESTS = ['src/sim/**/*.test.*'];

// Node's globals, for configs, scripts and tests (as hermet's base lists them).
const NODE_GLOBALS = Object.fromEntries(
  [
    'process', 'console', 'Buffer', 'URL', 'URLSearchParams', 'TextEncoder',
    'TextDecoder', 'fetch', 'crypto', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone',
    'AbortController', 'performance', 'Blob', 'Response', 'Request',
  ].map((name) => [name, 'readonly']),
);

const MATH_MESSAGE =
  "In src/sim, Math is used only as Math.<name>: hermet's exact-ops rule matches names, so an alias or a destructured member slips past it (PLAN D-1, D-38).";
// Math as a value anywhere but as Math.<name>: const M = Math, const { sin } =
// Math, ({ sin } = Math), f(Math), [Math], { Math }, (x || Math), Math as T.
// Property and member names, and names in types, are not values of Math.
// globalThis.Math and the like are covered by SIM_GLOBALS below.
const MATH_BANS = [
  'Identifier[name="Math"]:not(MemberExpression > .object, MemberExpression > .property, Property > .key, PropertyDefinition > .key, MethodDefinition > .key, TSPropertySignature > .key, TSMethodSignature > .key, TSTypeQuery *, TSTypeReference *, TSQualifiedName *)',
].map((selector) => ({ selector, message: MATH_MESSAGE }));

const IMPORT_MESSAGE =
  'src/sim never imports three or src/scene: the scene reads the simulation through src/contract.ts (PLAN D-26, D-36).';
const SIM_IMPORTS = {
  patterns: [
    { regex: '^three(/|$)', message: IMPORT_MESSAGE },
    { regex: '(^|/)scene(/|\\.|$)', message: IMPORT_MESSAGE },
  ],
};
// no-restricted-imports reads only static imports and re-exports; these are
// the same two patterns for import('…') and import('…') types. A selector's
// regex can't hold a '/', so \x2F stands for it.
const IMPORT_SOURCE = '/^three(\\x2F|$)|(^|\\x2F)scene(\\x2F|\\.|$)/';
const IMPORT_BANS = [
  `ImportExpression[source.value=${IMPORT_SOURCE}]`,
  `TSImportType[source.value=${IMPORT_SOURCE}]`,
].map((selector) => ({ selector, message: IMPORT_MESSAGE }));

const SIM_GLOBALS = [
  'window', 'self', 'globalThis', 'global', 'document', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'indexedDB',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask',
  'fetch', 'WebSocket', 'XMLHttpRequest', 'RTCPeerConnection',
  'eval', 'Function', 'require',
].map((name) => ({
  name,
  message: `src/sim is pure and exact (PLAN D-1, D-38): no ${name}. The caller passes in what the simulation needs.`,
}));

export default defineConfig(
  globalIgnores([
    'node_modules/**',
    'dist/**',
    'test-results/**',
    'playwright-report/**',
    'results/tmp/**',
    // Planted violations: test/eslint-config.test.ts lints them with ignores off.
    'src/sim/lint-fixtures/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended.map((config) => ({ ...config, files: TS })),
  {
    files: TS,
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['*.config.{ts,mjs}', 'scripts/**', 'test/**', 'e2e/**'],
    languageOptions: { globals: NODE_GLOBALS },
  },
  {
    files: SIM,
    ignores: SIM_TESTS,
    plugins: { hermet: { rules: { 'exact-ops': exactOps } } },
    rules: {
      'hermet/exact-ops': 'error',
      'no-restricted-syntax': ['error', ...MATH_BANS, ...IMPORT_BANS],
      'no-restricted-globals': ['error', ...SIM_GLOBALS],
      'no-restricted-imports': ['error', SIM_IMPORTS],
    },
  },
  {
    // The simulation's tests may use any maths, to describe expectations,
    // but still import neither three nor the scene.
    files: SIM_TESTS,
    rules: {
      'no-restricted-syntax': ['error', ...IMPORT_BANS],
      'no-restricted-imports': ['error', SIM_IMPORTS],
    },
  },
);
