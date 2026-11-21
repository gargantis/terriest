// The build inputs (design §1.31, M3-Q3; PLAN D-21, C-13): a hash of every
// src/core source whose code decides what peers agree on, and of the
// simulation's goldens. The build hash (src/core/session/build.ts) folds it
// in with the configuration, so two builds that differ there never share a
// match. Left out are the tests and the three files peers may run in
// different versions without disagreeing, since a bot's or a script's
// inputs are inputs like a person's: src/core/bot/brain.ts, marks.ts and
// setups.ts. vite.config.ts and vitest.config.ts define it for
// src/build-info.ts at build time, so goldens.json never enters the page's
// bundle. Only repo-relative paths and bytes go in, each CRLF read as LF,
// so it's the same on every machine that checks out the same commit,
// whatever its line endings (core.autocrlf; design R-9). And from M4,
// canaryOf: goldens.json's canary hash, which the configs define for
// src/canary-expected.ts beside the build inputs, so the page's module
// holds that one hash and nothing else of the goldens (M4's design §1.54,
// M4-Q5).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Every script extension, as the lint reaches every one (D-38).
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST = /\.test\.[^/]+$/;
const OWN_VERSIONS = new Set(['src/core/bot/brain.ts', 'src/core/bot/marks.ts', 'src/core/bot/setups.ts']);
const GOLDENS = 'src/core/sim/goldens.json';

/** The repo-relative paths buildInputs hashes, in path order. */
export function buildInputFiles(root) {
  const core = join(root, 'src', 'core');
  const files = readdirSync(core, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)).split(sep).join('/'))
    .filter((p) => (SCRIPT.test(p) && !TEST.test(p) && !OWN_VERSIONS.has(p)) || p === GOLDENS);
  // Sorted by code unit, never by locale.
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const CR = 0x0d;
const LF = 0x0a;

/** The bytes with each CRLF as LF: every file hashed is text, and a checkout may write either. */
function lf(bytes) {
  const out = Buffer.allocUnsafe(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (!(bytes[i] === CR && bytes[i + 1] === LF)) out[n++] = bytes[i];
  return out.subarray(0, n);
}

/** The first 16 hex digits of SHA-256 over each file's path, length and bytes, in path order. */
export function buildInputs(root) {
  const hash = createHash('sha256');
  for (const path of buildInputFiles(root)) {
    const bytes = lf(readFileSync(join(root, path)));
    hash.update(`${path}\n${bytes.length}\n`);
    hash.update(bytes);
  }
  return hash.digest('hex').slice(0, 16);
}

/** goldens.json's canary hash, 16 lowercase hex digits, for src/canary-expected.ts's define (M4's design
 *  §1.54, M4-Q5). Throws when the file holds none, so a build never ships an empty expectation. */
export function canaryOf(root) {
  const goldens = JSON.parse(readFileSync(join(root, GOLDENS), 'utf8'));
  const canary = goldens !== null && typeof goldens === 'object' ? goldens.canary : undefined;
  if (typeof canary !== 'string' || !/^[0-9a-f]{16}$/.test(canary)) throw new Error(`${GOLDENS} holds no canary hash`);
  return canary;
}
