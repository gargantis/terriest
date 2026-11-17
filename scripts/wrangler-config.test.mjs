import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// PLAN §15, D-35, A.7: Workers static assets only, so no Worker script can
// ever run; request logs off; served at terriest.com alone. Ported from
// amorfus and roslambo. The parser strips only whole-line comments, so
// wrangler.jsonc keeps every comment on a line of its own.
const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));

describe('wrangler.jsonc', () => {
  it('is assets-only: no main, no run_worker_first', () => {
    expect(config.main).toBeUndefined();
    expect(config.run_worker_first).toBeUndefined();
    expect(config.assets?.run_worker_first).toBeUndefined();
  });

  it('serves ./dist with not_found_handling none', () => {
    expect(config.assets).toEqual({ directory: './dist', not_found_handling: 'none' });
  });

  it('keeps observability off', () => {
    expect(config.observability).toEqual({ enabled: false });
  });

  it('routes terriest.com as a custom domain (Q-5)', () => {
    expect(config.routes).toEqual([{ pattern: 'terriest.com', custom_domain: true }]);
  });

  it('turns off workers.dev and Preview URLs, which would show the account (C-45)', () => {
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });
});
