// The spike's static server: dist/ served as terriest.com's Workers static
// assets would serve it (PLAN D-35, A.7), for the e2e specs and by hand.
//
// - Headers: dist/_headers, which the build copies byte for byte from
//   public/_headers, read with Cloudflare's rules: a URL pattern, then
//   indented `Name: value` lines; `#` lines are comments; a pattern matches
//   the whole path, `*` a splat (any characters, at most one), `:name` a
//   placeholder (anything but '/'); an absolute `https://host/path` pattern
//   matches only that host. Every matching rule's headers apply, a header
//   named twice is joined with ", ", and `! Name` detaches a header.
// - Files: `/` serves index.html, and `/index.html` redirects there (307), as
//   html_handling's default does; a directory serves its index.html; any
//   other missing file, and _headers itself, is a plain 404 with an empty
//   body (not_found_handling "none"). Only GET and HEAD are allowed.
// - Compression: text is sent brotli-compressed (quality 11) when the browser
//   accepts br, else gzip (level 9), so a page's transferred bytes are near
//   scripts/sizes.mjs's build-time figures. Cloudflare's own levels aren't
//   documented here, so its bytes may differ a little.
// - Not imitated: Cloudflare's default headers (ETag, its cache revalidation)
//   and _redirects.
//
// Test-only variants, never written into public/_headers (the dist audit
// scans it, D-37): rewriteCsp edits the Content-Security-Policy value, as
// run 4 compares policies (D-35); extraHeaders adds headers, as run 3's cost
// page adds cross-origin isolation for a 5 µs clock.
//
//   node e2e/serve.mjs [--port 4329] [--host 127.0.0.1] [--dist dist] [--no-compress]
//     [--csp-add "connect-src blob:"]  (appends sources to a directive, by hand only)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const DIST = resolve(HERE, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg\+xml)/;
/** Files a static host reads as configuration, never serves. */
const NOT_ASSETS = new Set(['_headers', '_redirects', '.assetsignore']);

/**
 * The _headers format, as rules in file order:
 * { pattern, headers: [name, value][], detach: name[] }.
 */
export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      if (!current) continue;
      if (line.startsWith('!')) {
        const name = line.slice(1).trim();
        if (name) current.detach.push(name);
        continue;
      }
      const i = line.indexOf(':');
      if (i > 0) current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    } else {
      current = { pattern: line, headers: [], detach: [] };
      rules.push(current);
    }
  }
  return rules;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pattern's matcher: { host: string | null, re: RegExp } for the path. */
function matcher(pattern) {
  let host = null;
  let path = pattern;
  const abs = /^https?:\/\/([^/]+)(\/.*)?$/.exec(pattern);
  if (abs) {
    host = abs[1].toLowerCase();
    path = abs[2] ?? '/';
  }
  let re = '';
  for (const part of path.split(/(\*|:[A-Za-z]\w*)/)) {
    if (part === '*') re += '.*';
    else if (/^:[A-Za-z]\w*$/.test(part)) re += '[^/]+';
    else re += escape(part);
  }
  return { host, re: new RegExp(`^${re}$`) };
}

/**
 * The headers the rules give a request for `path` (and `host`, for absolute
 * patterns), as [name, value][], merged as Cloudflare merges them.
 */
export function headersFor(rules, path, host = '') {
  const merged = [];
  const detached = new Set();
  const h = host.toLowerCase().replace(/:\d+$/, '');
  for (const rule of rules) {
    const m = matcher(rule.pattern);
    if ((m.host !== null && m.host !== h) || !m.re.test(path)) continue;
    for (const [name, value] of rule.headers) {
      const at = merged.findIndex(([k]) => k.toLowerCase() === name.toLowerCase());
      if (at >= 0) merged[at] = [merged[at][0], `${merged[at][1]}, ${value}`];
      else merged.push([name, value]);
    }
    for (const name of rule.detach) detached.add(name.toLowerCase());
  }
  return merged.filter(([k]) => !detached.has(k.toLowerCase()));
}

/** Adds sources to one directive of a policy: addSources(csp, 'connect-src', ['blob:']). */
export function addSources(csp, directive, sources) {
  const parts = csp.split(';').map((d) => d.trim()).filter(Boolean);
  const at = parts.findIndex((d) => d.split(/\s+/)[0] === directive);
  if (at < 0) parts.push([directive, ...sources].join(' '));
  else parts[at] = [parts[at], ...sources.filter((s) => !parts[at].split(/\s+/).includes(s))].join(' ');
  return parts.join('; ');
}

function encodingFor(accept) {
  const offered = (accept ?? '').toLowerCase().split(',').map((e) => e.split(';')[0].trim());
  if (offered.includes('br')) return 'br';
  if (offered.includes('gzip')) return 'gzip';
  return null;
}

function compressed(body, encoding) {
  if (encoding === 'br') {
    return brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
  }
  return gzipSync(body, { level: 9 });
}

/** Serves dist/; resolves once listening. */
export async function startServer({
  distDir = DIST, port = 0, host = '127.0.0.1', rewriteCsp = (v) => v, extraHeaders = [], compress = true,
} = {}) {
  const rules = parseHeadersFile(await readFile(join(distDir, '_headers'), 'utf8'));
  const cache = new Map();
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' }).end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://x');
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (path === '/index.html') {
        res.writeHead(307, { location: `./${url.search}` }).end();
        return;
      }
      let rel = path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);
      rel = normalize(rel);
      const name = rel.split(/[/\\]/).pop() ?? '';
      if (rel.startsWith('..') || rel.includes('\0') || NOT_ASSETS.has(name)) {
        res.writeHead(404).end();
        return;
      }
      const file = join(distDir, rel);
      let info;
      try {
        info = await stat(file);
        if (info.isDirectory()) {
          res.writeHead(307, { location: `${url.pathname}/${url.search}` }).end();
          return;
        }
      } catch {
        res.writeHead(404).end();
        return;
      }
      const ext = rel.slice(rel.lastIndexOf('.'));
      const type = MIME[ext] ?? 'application/octet-stream';
      const headers = { 'content-type': type };
      for (const [k, v] of headersFor(rules, path, req.headers.host ?? '')) {
        headers[k.toLowerCase()] = k.toLowerCase() === 'content-security-policy' ? rewriteCsp(v) : v;
      }
      for (const [k, v] of extraHeaders) headers[k.toLowerCase()] = v;
      const encoding = compress && COMPRESSIBLE.test(type) ? encodingFor(req.headers['accept-encoding']) : null;
      const key = `${file}\n${info.mtimeMs}\n${encoding}`;
      let body = cache.get(key);
      if (!body) {
        const raw = await readFile(file);
        body = encoding ? compressed(raw, encoding) : raw;
        cache.set(key, body);
      }
      if (encoding) headers['content-encoding'] = encoding;
      if (compress && COMPRESSIBLE.test(type)) headers.vary = 'Accept-Encoding';
      headers['content-length'] = String(body.length);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    })().catch((e) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(e));
    });
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => done(undefined));
  });
  const address = server.address();
  const bound = typeof address === 'object' && address ? address.port : port;
  return {
    port: bound,
    url: `http://${host}:${bound}/`,
    close: () => new Promise((done) => server.close(() => done(undefined))),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
  };
  const added = value('--csp-add', '');
  const [directive, ...sources] = added.split(/\s+/).filter(Boolean);
  const s = await startServer({
    distDir: resolve(value('--dist', DIST)),
    port: Number(value('--port', '4329')),
    host: value('--host', '127.0.0.1'),
    compress: !args.includes('--no-compress'),
    rewriteCsp: directive ? (v) => addSources(v, directive, sources) : (v) => v,
  });
  console.log(`serving ${value('--dist', 'dist')} with its _headers at ${s.url}${directive ? ` (CSP: ${directive} + ${sources.join(' ')})` : ''}`);
  const stop = () => void s.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
