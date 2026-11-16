// C-9's tokenizer question: hermet's dist audit reads a bundle's strings
// with a small tokenizer, which could miss a string (hiding a host or a
// root-absolute URL) or read code as one. This compares, for each built .js
// file, the tokenizer's strings with those of a real parser (TypeScript's),
// as multisets of raw source text, and runs the audit's own host and path
// tests on what the parser finds, so a finding hidden by the tokenizer
// would show here.
//
//   node scripts/tokenizer-check.mjs [dist]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { jsStringLiterals } from '../../../../hermet/audit-dist.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every string literal's and template part's raw source text, by TypeScript's parser. */
export function parsedStrings(text) {
  const sf = ts.createSourceFile('bundle.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];
  const visit = (node) => {
    const k = node.kind;
    const start = node.getStart(sf);
    if (k === ts.SyntaxKind.StringLiteral || k === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      out.push({ text: text.slice(start + 1, node.end - 1), continued: false });
    } else if (k === ts.SyntaxKind.TemplateHead) {
      out.push({ text: text.slice(start + 1, node.end - 2), continued: false });
    } else if (k === ts.SyntaxKind.TemplateMiddle) {
      out.push({ text: text.slice(start + 1, node.end - 2), continued: true });
    } else if (k === ts.SyntaxKind.TemplateTail) {
      out.push({ text: text.slice(start + 1, node.end - 1), continued: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// The audit's own tests (hermet audit-dist.mjs, at 11283ca), applied to strings.
const URL_RE = /\b(?:https?|wss?|stun|turn):\/?\/?([A-Za-z0-9][A-Za-z0-9.-]*)(?::\d+)?/g;
function auditStrings(strings) {
  const hosts = [];
  const paths = [];
  for (const m of strings.map((s) => s.text).join('\n').matchAll(URL_RE)) {
    const host = m[1].toLowerCase();
    if (host !== 'www.w3.org') hosts.push(host);
  }
  for (const s of strings) if (!s.continued && s.text.startsWith('/') && !s.text.startsWith('//')) paths.push(s.text);
  return { hosts, paths };
}

function counts(xs) {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** Strings in a but not b, as a multiset difference. */
function minus(a, b) {
  const cb = counts(b);
  const out = [];
  for (const x of a) {
    const n = cb.get(x) ?? 0;
    if (n > 0) cb.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

export function checkFile(text) {
  const parsed = parsedStrings(text);
  const tokenized = jsStringLiterals(text);
  const p = parsed.map((s) => s.text);
  return {
    parsed: parsed.length,
    tokenized: tokenized.length,
    missedByTokenizer: minus(p, tokenized),
    inventedByTokenizer: minus(tokenized, p),
    parserFindings: auditStrings(parsed),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] ?? join(root, 'dist'));
  const files = readdirSync(dist, { recursive: true }).filter((f) => String(f).endsWith('.js'));
  let bad = 0;
  for (const f of files) {
    const r = checkFile(readFileSync(join(dist, String(f)), 'utf8'));
    const short = (xs) => xs.slice(0, 5).map((x) => JSON.stringify(x.length > 80 ? `${x.slice(0, 80)}…` : x));
    console.log(`${f}: ${r.parsed} strings parsed, ${r.tokenized} tokenized; missed ${r.missedByTokenizer.length} ${short(r.missedByTokenizer).join(' ')}; invented ${r.inventedByTokenizer.length} ${short(r.inventedByTokenizer).join(' ')}`);
    console.log(`  by the parser's strings: hosts ${JSON.stringify(r.parserFindings.hosts)}, root-absolute ${JSON.stringify(r.parserFindings.paths)}`);
    bad += r.missedByTokenizer.length + r.inventedByTokenizer.length;
  }
  process.exit(bad > 0 ? 1 : 0);
}
