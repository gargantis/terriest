import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// The per-commit check's unit tests: every test but the whole-match replays, which `npm test` and
// the full gate (`npm run check`) run with the rest (PLAN Q-18, the owner's decision of 2026-11-21).
// The replays are the network simulator's scenario files (all of src/net's tests but its unit
// files, NET_UNIT), the bot marks, the UI glue's freeze matches and the timeline's whole-match
// file: most of the unit stage's time (CLAUDE.md's Tests). A new whole-match file goes in one of
// those or is added here; a new unit file in src/net goes in NET_UNIT.
const NET_UNIT = ['local.test.ts', 'loopback.test.ts', 'room-config.test.ts', 'third-party.test.ts', 'trystero.test.ts'];
const net = fileURLToPath(new URL('./src/net/', import.meta.url));

export const REPLAYS: readonly string[] = [
  ...readdirSync(net)
    .filter((f) => f.endsWith('.test.ts') && !NET_UNIT.includes(f))
    .map((f) => `src/net/${f}`),
  'src/core/bot/marks*.test.ts',
  'src/ui/freeze*.test.ts',
  'src/core/timeline/timeline-match.test.ts',
];

export default mergeConfig(base, defineConfig({ test: { exclude: [...configDefaults.exclude, ...REPLAYS] } }));
