#!/usr/bin/env node
// The PLAN §15 dist audit. The logic and its planted-failure self-test are
// hermet's, in vendor/hermet/audit-dist.mjs; it allows the hosts in
// third-party.json and expects the notices in scripts/expected-licenses.json.
// terriest's exceptions are here (D-37), and so is its own check that no
// dev relay ships (design §1.33).
import { join } from 'node:path';
import { runAuditDist } from '../vendor/hermet/audit-dist.mjs';
import { auditDevRelay } from './dev-relay-audit.mjs';

await runAuditDist({
  // Trystero's built-in STUN list, bundled from M3, is a template literal,
  // `stun:stun${i}.l.google.com:19302`, whose prefix the scan reads as a
  // host named "stun". terriest always passes its own iceServers (D-18), so
  // the defaults are never used. And terriest.com, the site's own canonical
  // address, which index.html's link-preview tags name in absolute URLs for
  // the unfurlers that read them (the owner's request of 2026-11-23). It's
  // no third party, and the page never requests it: e2e/link-preview.spec.ts
  // fails on any request outside the page's own server.
  ignoredHosts: ['stun', 'terriest.com'],
  // The host's response headers ship, and are scanned as text (D-35).
  textFiles: ['_headers'],
  // The boot messages say how to serve the folder on localhost (D-30).
  loopbackFiles: ['boot.js'],
  // The bare '/' in three's LoaderUtils.extractUrlBase, bundled with
  // GLTFLoader: a separator that's never requested (C-9, M0).
  ignoredPaths: ['/'],
});

// npm run dev:local's relay is dev only (PLAN §15): no dev-relay chunk, and
// no file naming one or the dev server's variable.
const devRelay = auditDevRelay(join(process.cwd(), 'dist'));
if (devRelay.length > 0) {
  for (const problem of devRelay) console.error(`audit-dist: ${problem} (design §1.33)`);
  process.exit(1);
}
console.log('audit-dist: no dev relay in dist/');
