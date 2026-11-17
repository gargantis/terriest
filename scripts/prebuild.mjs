#!/usr/bin/env node
// PLAN §15: the gate's tooling is the submodule vendor/hermet (D-37), which
// `npm install` doesn't fetch. In a clone made without --recurse-submodules
// it's an empty folder, and the build would fail later on a missing import,
// so `npm run build` stops here first and says how to fetch it. So does
// `npm run check` (as precheck), whose lint would otherwise crash on the
// missing ESLint base. The folder is an argument only for this script's
// test (prebuild.test.mjs).
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? fileURLToPath(new URL('../vendor/hermet', import.meta.url));

if (!existsSync(dir) || readdirSync(dir).length === 0) {
  console.error(
    'prebuild: vendor/hermet is empty. It holds the gate\'s tooling, a git submodule that npm install ' +
      "doesn't fetch. Fetch it, then run this again:\n\n  git submodule update --init\n",
  );
  process.exit(1);
}
