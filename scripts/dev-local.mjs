#!/usr/bin/env node
// npm run dev:local (design §1.30, §6.6; PLAN §15, M3-Q4): the dev server
// and hermet's local Nostr relay, so desktop browsers can play each other by
// hand without the public relays. The relay listens on 127.0.0.1 at a free
// port, which Vite hands the page as VITE_TERRIEST_LOCAL_RELAY_PORT, read
// only under import.meta.env.DEV (src/net/dev-relay.ts): the page uses
// ws://<its own host name>:<port> as its only relay. Arguments go to Vite.
// The relay closes when Vite exits. Dev only: production never uses it.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startNostrRelay } from '../vendor/hermet/nostr-relay.mjs';

const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const relay = await startNostrRelay();
console.log(`dev:local: the local relay is on 127.0.0.1:${relay.port}; pages use ws://<their host name>:${relay.port}`);

const child = spawn(process.execPath, [vite, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_TERRIEST_LOCAL_RELAY_PORT: String(relay.port) },
});
// Ctrl-C reaches Vite through the terminal too; a signal sent to this
// process alone is passed on. Either way, this side waits for Vite to exit.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

const done = async (code) => {
  await relay.close();
  process.exit(code);
};
child.on('error', (e) => {
  console.error(`dev:local: Vite didn't start: ${e.message}`);
  void done(1);
});
child.on('exit', (code, signal) => void done(code ?? (signal ? 1 : 0)));
