// npm run dev:local's relay (design §1.29, §6.6; PLAN §15, M3-Q4):
// scripts/dev-local.mjs starts hermet's Nostr relay on 127.0.0.1 and hands
// Vite its port as VITE_TERRIEST_LOCAL_RELAY_PORT. The page builds the URL
// from its own host name, so a Windows browser reaching WSL2 through
// localhost reaches the relay the same way. Loaded only with import() under
// import.meta.env.DEV, which the lint holds (design §1.36), so a production
// build drops the branch and never emits this chunk, and
// scripts/dev-relay-audit.mjs fails a build that would ship it.

/** A host name as URL.hostname writes it: a DNS name, an IPv4 address, or an IPv6 one in brackets. */
const HOST = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)$/;
const PORT = /^[1-9][0-9]{0,4}$/;

/** The local relay's URL under npm run dev:local, else null. */
export function devRelay(hostname: string): string | null {
  const port = import.meta.env.VITE_TERRIEST_LOCAL_RELAY_PORT;
  if (port === undefined || !PORT.test(port) || Number(port) > 0xffff) return null;
  // An IPv6 address given bare goes in brackets.
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return HOST.test(host) ? `ws://${host}:${port}` : null;
}
