#!/usr/bin/env node
// The PLAN §15 dist audit. The logic and its planted-failure self-test are
// hermet's, in vendor/hermet/audit-dist.mjs; it allows the hosts in
// third-party.json and expects the notices in scripts/expected-licenses.json.
// terriest's exceptions are here (D-37).
import { runAuditDist } from '../vendor/hermet/audit-dist.mjs';

await runAuditDist({
  // Trystero's built-in STUN list, bundled from M3, is a template literal,
  // `stun:stun${i}.l.google.com:19302`, whose prefix the scan reads as a
  // host named "stun". terriest always passes its own iceServers (D-18), so
  // the defaults are never used.
  ignoredHosts: ['stun'],
  // The host's response headers ship, and are scanned as text (D-35).
  textFiles: ['_headers'],
  // The boot messages say how to serve the folder on localhost (D-30).
  loopbackFiles: ['boot.js'],
  // The bare '/' in three's LoaderUtils.extractUrlBase, bundled with
  // GLTFLoader: a separator that's never requested (C-9, M0).
  ignoredPaths: ['/'],
});
