// Practice's transport (design §1.21, §6.4; D-22, P10): nothing leaves the
// page. It refuses no one and holds no peers; every message offered is
// counted and dropped; and nothing it imports, however deep, reaches
// src/net/trystero.ts or Trystero.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeAgain, encodePeers, ROLE } from '../core/protocol/messages';
import type { Link } from '../core/session/room-peer';
import { LocalTransport } from './local';

const root = fileURLToPath(new URL('../..', import.meta.url));
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const SPECIFIER = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** The file a relative specifier names, as the bundler finds it. */
function resolveFile(from: string, spec: string): string {
  const base = join(dirname(from), spec);
  for (const p of [base, `${base}.ts`, join(base, 'index.ts'), base.replace(/\.js$/, '.ts')]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  throw new Error(`${spec}, from ${from}, names no file`);
}

/** Every module a source reaches through its value imports, static or
 *  import(): repo paths, and package names, which it doesn't follow. */
function reached(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    const path = relative(root, file).split('\\').join('/');
    if (seen.has(path)) return;
    seen.add(path);
    if (!/\.[cm]?[jt]sx?$/.test(file)) return; // data, such as third-party.json
    for (const m of readFileSync(file, 'utf8').replace(COMMENT, '').matchAll(SPECIFIER)) {
      if (m[1] !== undefined) continue; // import type and export type are erased
      const spec = m[2] ?? m[3]!;
      if (spec.startsWith('.')) visit(resolveFile(file, spec));
      else seen.add(spec);
    }
  };
  visit(join(root, entry));
  return seen;
}

describe('the local transport (D-22, P10)', () => {
  it('refuses no one, holds no peers, and leaves at once', async () => {
    const t = new LocalTransport();
    expect(t.refusedBy).toBeNull();
    expect(t.peerCount()).toBe(0);
    await expect(t.leave()).resolves.toBeUndefined();
  });

  it('counts each message offered, and drops it', () => {
    const t = new LocalTransport();
    const link: Link = t;
    link.broadcast(encodePeers([], ROLE.KEEPER));
    link.send('anyone', encodeAgain());
    link.broadcast(new Uint8Array(0));
    expect(t.offered).toBe(3);
    expect(t.peerCount()).toBe(0);
  });

  it('reaches neither src/net/trystero.ts nor Trystero through its imports', () => {
    const graph = reached('src/net/local.ts');
    expect(graph.has('src/net/local.ts')).toBe(true);
    expect([...graph].filter((m) => m === 'src/net/trystero.ts' || m.startsWith('@trystero-p2p/'))).toEqual([]);
    // The walk follows value imports: trystero.ts's own graph reaches the package.
    expect(reached('src/net/trystero.ts').has('@trystero-p2p/nostr')).toBe(true);
  });
});
