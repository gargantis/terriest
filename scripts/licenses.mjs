#!/usr/bin/env node
// PLAN §15, §20: bundled packages keep their licences, so their notices ship
// in dist/THIRD-PARTY-LICENSES.txt, written by hermet's writer at 11283ca
// from Vite's npm licence JSON (D-37, Q-3). audit-dist checks the list
// against scripts/expected-licenses.json. (terriest itself is unlicensed:
// no permission is granted to use it, Q-1.)
import { writeLicenseNotices } from '../vendor/hermet/licenses.mjs';

await writeLicenseNotices({ product: 'terriest' });
