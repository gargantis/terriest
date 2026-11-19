// The dev relay never ships (design §1.33, §6.6; PLAN §15). npm run
// dev:local's relay is reached only through src/net/dev-relay.ts, which only
// import() loads (the lint, design §1.36), under import.meta.env.DEV, so a
// production build drops it. Vite folds import.meta.env.VITE_* in at build
// time, and the URL is built at run time, so neither an address nor the
// variable's value would show a shipped dev relay; its chunk would, and so
// would an importer naming it, or the variable's name where Vite left it.
// auditDevRelay is pure folder-in, problems-out, so its test plants each
// without a build; scripts/audit-dist.mjs runs it on dist/ after hermet's
// audit.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const MARKS = ['dev-relay', 'VITE_TERRIEST'];

/** A problem for each file under dist whose name starts with dev-relay,
 *  and for each shipped file that mentions dev-relay or VITE_TERRIEST. */
export function auditDevRelay(dist) {
  const problems = [];
  const files = readdirSync(dist, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  for (const e of files) {
    const abs = join(e.parentPath, e.name);
    const rel = relative(dist, abs).split(sep).join('/');
    if (e.name.startsWith('dev-relay')) problems.push(`${rel}: a dev relay chunk ships`);
    // Bytes as Latin-1: the marks are ASCII, in text and binary files alike.
    const text = readFileSync(abs, 'latin1');
    for (const mark of MARKS) if (text.includes(mark)) problems.push(`${rel}: names ${mark}`);
  }
  return problems.sort();
}
