#!/usr/bin/env node
// PLAN §15, Q-1. The repo is public: hermet's public-scan (vendor/hermet)
// looks for absolute home paths and key material in tracked text files,
// and (locally) for terms from a denylist kept OUTSIDE the repo via
// $TERRIEST_PRIVATE_TERMS (D-37). CI has no denylist and runs the built-in
// patterns only.
import { runPublicScan } from '../vendor/hermet/public-scan.mjs';

runPublicScan({ termsEnv: 'TERRIEST_PRIVATE_TERMS' });
