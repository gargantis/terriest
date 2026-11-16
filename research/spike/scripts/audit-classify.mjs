// Run 5's answer (PLAN §17 M0, C-9): every finding of the no-exceptions
// audit classified as an app option, a hermet option or a tokenizer fix,
// with the evidence for each, from:
// - results/audit.json (scripts/audit.mjs --app-options --json): the
//   findings with no exceptions, and the run with the app options;
// - dist/ (the same deterministic build), for each finding's code context;
// - results/tmp/sizes-three-split and sizes-no-model (scripts/sizes.mjs's
//   measurement builds), for which module a string comes from and which
//   path ships it;
// - results/tokenizer.json, for whether the tokenizer missed or invented
//   any string (a tokenizer fix).
// Writes results/audit-classified.json.
//
//   npm run build && node scripts/audit.mjs --app-options --json results/audit.json
//   npm run build && node scripts/sizes.mjs --json results/sizes.json
//   node scripts/audit-classify.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFile } from './tokenizer-check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const audit = JSON.parse(read('results/audit.json'));
const tokenizer = JSON.parse(read('results/tokenizer.json'));

/** Which chunks of a measurement build hold a root-absolute string, by the parser. */
function holders(build, text) {
  const dir = join(root, 'results', 'tmp', build, 'assets');
  if (!existsSync(dir)) return null;
  return readdirSync(dir).filter((f) => f.endsWith('.js') && checkFile(readFileSync(join(dir, f), 'utf8')).parserFindings.paths.includes(text));
}

/** Up to n places a string literal appears in a file, with the code around it. */
function contexts(file, text, n = 3) {
  const src = read(join('dist', file));
  const out = [];
  for (const q of ['`', "'", '"']) {
    const lit = `${q}${text}${q}`;
    for (let i = src.indexOf(lit); i >= 0 && out.length < n; i = src.indexOf(lit, i + 1)) out.push(src.slice(Math.max(0, i - 100), i + lit.length + 60));
  }
  return out;
}

const classified = audit.findings.map((f) => {
  if (f.file === '_headers' && /extension not allowlisted/.test(f.why)) {
    return {
      finding: f, class: 'app option', option: { textFiles: ['_headers'] },
      evidence: {
        what: "the static host's header rules (D-35), which the host reads from the deployed folder; dist/_headers is public/_headers copied by the build",
        identicalToPublic: read('dist/_headers') === read('public/_headers'),
        plannedBy: 'D-37 (textFiles for _headers)',
      },
    };
  }
  if (/root-absolute URL/.test(f.why) && f.detail === '/') {
    return {
      finding: f, class: 'app option', option: { ignoredPaths: ['/'] },
      alternative: "a hermet option treating a bare '/' as a separator rather than a path",
      evidence: {
        what: "three's LoaderUtils.extractUrlBase: url.lastIndexOf('/'), a separator, not a URL; never requested (run 4's request guard: every request stayed on the page's origin)",
        contexts: contexts(f.file, '/'),
        inTheSplitBuild: holders('sizes-three-split', '/'),
        inTheBuildWithoutTheModelDrawer: holders('sizes-no-model', '/'),
        so: 'it is in three\'s core, kept only because GLTFLoader (the model path) imports LoaderUtils; tree-shaken from a build without the model drawer',
      },
    };
  }
  return { finding: f, class: 'unclassified', evidence: null };
});

const tokenizerFixNeeded = Object.values(tokenizer.files).some((r) => r.missedByTokenizer.length > 0 || r.inventedByTokenizer.length > 0);
const out = {
  utc: new Date().toISOString(),
  about: "M0 run 5: the no-exceptions dist audit's findings, each classified (C-9), with the evidence",
  auditOptions: audit.options,
  findings: audit.findings.length,
  classified,
  appOptionsThatClearThem: Object.fromEntries(Object.entries(audit.appOptions).filter(([k]) => !(k in audit.options))),
  withAppOptions: { findings: audit.withAppOptions?.length ?? null, clean: (audit.withAppOptions ?? [null]).length === 0 },
  hermetOptionsNeeded: [],
  tokenizerFixNeeded,
  tokenizer: Object.fromEntries(Object.entries(tokenizer.files).map(([f, r]) => [f, { parsed: r.parsed, tokenized: r.tokenized, missed: r.missedByTokenizer.length, invented: r.inventedByTokenizer.length, hosts: r.hostsInParsedStrings.length }])),
  licenceNotice: (() => {
    const t = existsSync(join(root, 'dist', 'THIRD-PARTY-LICENSES.txt')) ? read('dist/THIRD-PARTY-LICENSES.txt') : '';
    return { file: 'dist/THIRD-PARTY-LICENSES.txt', present: t.length > 0, packages: [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1]), carriesMitText: /Permission is hereby granted, free of charge/.test(t), lines: t ? t.split('\n').length : 0 };
  })(),
};
writeFileSync(join(root, 'results', 'audit-classified.json'), `${JSON.stringify(out, null, 1)}\n`);
for (const c of classified) console.log(`${c.finding.file}: ${c.finding.why}${c.finding.detail ? ` (${c.finding.detail})` : ''} -> ${c.class}${c.option ? ` ${JSON.stringify(c.option)}` : ''}`);
console.log(`with the app options: ${out.withAppOptions.clean ? 'clean' : `${out.withAppOptions.findings} findings`}; tokenizer fix needed: ${tokenizerFixNeeded}; licence notice: ${out.licenceNotice.packages.join(', ')} (MIT text: ${out.licenceNotice.carriesMitText})`);
