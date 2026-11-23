import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { headersFor, parseHeadersFile } from '../e2e/lib/serve.mjs';

// PLAN D-35, §16: public/_headers, read by the rules terriest.com applies
// (e2e/lib/serve.mjs): the hashed assets immutable, D-35's policy and
// amorfus's other security headers on every path.
const rules = parseHeadersFile(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));
const header = (path, name) => headersFor(rules, path).find(([k]) => k === name)?.[1];
const POLICY = "script-src 'self'; connect-src 'self' wss: blob:; object-src 'none'; base-uri 'none'";

describe('public/_headers', () => {
  it('marks the hashed assets immutable, and nothing else', () => {
    expect(rules.map((r) => r.pattern)).toEqual(['/assets/*', '/*']);
    expect(header('/assets/index-abc123.js', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
    // The icons keep their names from build to build, so they're revalidated too (D-35).
    for (const path of ['/', '/index.html', '/boot.js', '/THIRD-PARTY-LICENSES.txt', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']) {
      expect(header(path, 'Cache-Control'), path).toBeUndefined();
    }
  });

  it("sets D-35's policy on every path, wss: and blob: in connect-src included", () => {
    const directives = Object.fromEntries(
      header('/', 'Content-Security-Policy')
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .map(([name, ...sources]) => [name, sources]),
    );
    expect(directives).toEqual({
      'script-src': ["'self'"],
      'connect-src': ["'self'", 'wss:', 'blob:'],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
    });
    for (const path of ['/', '/index.html', '/boot.js', '/assets/index-abc123.js']) {
      expect(header(path, 'Content-Security-Policy'), path).toBe(POLICY);
    }
  });

  it("keeps amorfus's other security headers on every path", () => {
    for (const path of ['/', '/assets/index-abc123.js']) {
      expect(header(path, 'X-Content-Type-Options'), path).toBe('nosniff');
      expect(header(path, 'Referrer-Policy'), path).toBe('no-referrer');
    }
  });
});
