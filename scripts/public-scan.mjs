#!/usr/bin/env node
// PLAN §15, Q-1. The repo is public: hermet's public-scan (vendor/hermet)
// looks for absolute home paths and key material in the text files git
// tracks or would add, and for the terms of a denylist kept OUTSIDE the
// repo, when $TERRIEST_PRIVATE_TERMS names it (D-37). hermet skips a
// denylist that's unset or missing without a word, and prints the same
// line either way, so this says first which scan runs, and fails when the
// variable names no file, which would otherwise turn the denylist off
// unseen. CI has no denylist and runs the built-in patterns only.
import { existsSync } from 'node:fs';
import { runPublicScan } from '../vendor/hermet/public-scan.mjs';

const VARIABLE = 'TERRIEST_PRIVATE_TERMS';
const terms = process.env[VARIABLE];
if (!terms) {
  console.log(`public-scan: ${VARIABLE} is unset, so the built-in patterns only, without the private denylist`);
} else if (!existsSync(terms)) {
  console.error(`public-scan: ${VARIABLE} names no file, so the private denylist can't be read. Correct the path, or unset it.`);
  process.exit(1);
} else {
  console.log('public-scan: the built-in patterns and the private denylist');
}
runPublicScan({ termsEnv: VARIABLE });
