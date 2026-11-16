// public/_headers (PLAN D-35, §16): amorfus's file, its content security
// policy unchanged for M0's measurement; hashed assets immutable.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { headersFor, parseHeadersFile } from '../e2e/serve.mjs';

const text = readFileSync(join(import.meta.dirname, '..', 'public', '_headers'), 'utf8');
const rules = parseHeadersFile(text);
const csp = (path: string): string => headersFor(rules, path).find(([k]) => k === 'Content-Security-Policy')?.[1] ?? '';

describe('public/_headers', () => {
  it("is amorfus's: the hashed assets immutable, its security headers everywhere", () => {
    expect(rules.map((r) => r.pattern)).toEqual(['/assets/*', '/*']);
    expect(headersFor(rules, '/assets/index-abc.js')).toContainEqual(['Cache-Control', 'public, max-age=31536000, immutable']);
    expect(headersFor(rules, '/index.html').map(([k]) => k)).toEqual(['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy']);
    expect(headersFor(rules, '/index.html').find(([k]) => k === 'Cache-Control')).toBeUndefined();
  });

  it("keeps amorfus's policy unchanged, without blob: in connect-src (M0 measures the need)", () => {
    const directives = Object.fromEntries(csp('/').split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    expect(directives).toEqual({
      'script-src': ["'self'"],
      'connect-src': ["'self'", 'wss:'],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
    });
    expect(csp('/assets/x.js')).toBe(csp('/'));
  });

  it('skips comments', () => {
    expect(parseHeadersFile('# a comment\n/*\n  X-A: 1\n')).toEqual([{ pattern: '/*', headers: [['X-A', '1']], detach: [] }]);
  });
});
