import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSources, headersFor, parseHeadersFile, startServer } from './serve.mjs';

// e2e/lib/serve.mjs: dist/ served with its _headers read by Cloudflare's
// rules (PLAN D-35, A.7, §16), on a throwaway dist/. Ported from the M0
// spike's test/serve.test.ts.
const HEADERS = [
  '# a comment',
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/*',
  "  Content-Security-Policy: script-src 'self'; connect-src 'self' wss:",
  '  X-Content-Type-Options: nosniff',
  '',
  '/assets/plain.txt',
  '  ! X-Content-Type-Options',
  '  X-Extra: two',
  '',
  '/assets/:file.txt',
  '  X-Extra: three',
  '',
  'https://elsewhere.example/*',
  '  X-Elsewhere: yes',
].join('\n');

let dir;
let server;
const JS = 'export const x = "' + 'terrier '.repeat(500) + '";\n';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'terriest-serve-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>t</title>');
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'assets', 'a.js'), JS);
  await writeFile(join(dir, 'assets', 'plain.txt'), 'plain');
  await writeFile(join(dir, '_headers'), HEADERS);
  server = await startServer({ distDir: dir, extraHeaders: [['Cross-Origin-Opener-Policy', 'same-origin']] });
});

afterAll(async () => {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

const get = (path, init = {}) => fetch(`${server.url}${path.replace(/^\//, '')}`, { redirect: 'manual', ...init });

describe('the _headers rules', () => {
  const rules = parseHeadersFile(HEADERS);

  it('reads patterns, headers and detached names, skipping comments', () => {
    expect(rules.map((r) => r.pattern)).toEqual(['/assets/*', '/*', '/assets/plain.txt', '/assets/:file.txt', 'https://elsewhere.example/*']);
    expect(rules[2]).toEqual({ pattern: '/assets/plain.txt', headers: [['X-Extra', 'two']], detach: ['X-Content-Type-Options'] });
  });

  it('applies every matching rule, joins a header named twice, and detaches', () => {
    expect(headersFor(rules, '/')).toEqual([
      ['Content-Security-Policy', "script-src 'self'; connect-src 'self' wss:"],
      ['X-Content-Type-Options', 'nosniff'],
    ]);
    expect(headersFor(rules, '/assets/a.js').map(([k]) => k)).toEqual(['Cache-Control', 'Content-Security-Policy', 'X-Content-Type-Options']);
    expect(headersFor(rules, '/assets/plain.txt')).toEqual([
      ['Cache-Control', 'public, max-age=31536000, immutable'],
      ['Content-Security-Policy', "script-src 'self'; connect-src 'self' wss:"],
      ['X-Extra', 'two, three'],
    ]);
  });

  it('matches a placeholder within one path segment, and an absolute pattern only on its host', () => {
    expect(headersFor(rules, '/assets/sub/x.txt').map(([k]) => k)).not.toContain('X-Extra');
    expect(headersFor(rules, '/', 'elsewhere.example:443').map(([k]) => k)).toContain('X-Elsewhere');
    expect(headersFor(rules, '/', '127.0.0.1:4339').map(([k]) => k)).not.toContain('X-Elsewhere');
  });

  it('adds sources to one directive of a policy', () => {
    expect(addSources("script-src 'self'; connect-src 'self' wss:", 'connect-src', ['blob:'])).toBe("script-src 'self'; connect-src 'self' wss: blob:");
    expect(addSources("script-src 'self'", 'connect-src', ['blob:'])).toBe("script-src 'self'; connect-src blob:");
    expect(addSources("connect-src 'self' blob:", 'connect-src', ['blob:'])).toBe("connect-src 'self' blob:");
  });
});

describe('the server', () => {
  it('serves / as index.html with the policy, and redirects /index.html there', async () => {
    const r = await get('/?quality=low');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('content-security-policy')).toBe("script-src 'self'; connect-src 'self' wss:");
    expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(r.headers.get('cache-control')).toBeNull();
    const back = await get('/index.html?a=1');
    expect(back.status).toBe(307);
    expect(back.headers.get('location')).toBe('./?a=1');
  });

  it('marks hashed assets immutable, and compresses text as the browser accepts', async () => {
    const br = await get('/assets/a.js', { headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(br.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('vary')).toBe('Accept-Encoding');
    // fetch decodes the body; the length on the wire is the header's.
    expect(Number(br.headers.get('content-length'))).toBeLessThan(JS.length / 10);
    expect(await br.text()).toBe(JS);
    const gz = await get('/assets/a.js', { headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    const none = await get('/assets/a.js', { headers: { 'accept-encoding': 'identity' } });
    expect(none.headers.get('content-encoding')).toBeNull();
    expect(Number(none.headers.get('content-length'))).toBe(JS.length);
    expect(await gz.text()).toBe(JS);
  });

  it('answers a plain 404 for a missing file and for _headers, and refuses other methods', async () => {
    for (const path of ['/missing.js', '/_headers', '/assets/../_headers', '/favicon.ico']) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(r.headers.get('content-security-policy'), path).toBeNull();
      expect(await r.text(), path).toBe('');
    }
    expect((await get('/', { method: 'POST' })).status).toBe(405);
    const head = await get('/assets/plain.txt', { method: 'HEAD', headers: { 'accept-encoding': 'identity' } });
    expect(head.status).toBe(200);
    expect(head.headers.get('x-extra')).toBe('two, three');
    expect(head.headers.get('x-content-type-options')).toBeNull();
  });
});
