// Must be first: shims Node 22+ APIs used by libp2p/Fastify on the Node 18 runtime.
import './polyfill';

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PFPNode, startDaemon, type TorConfig } from '@pforum/node';

/**
 * Node.js entry point for the PeerForum mobile app.
 *
 * Runs inside `@capawesome/capacitor-nodejs` (Node.js for Mobile Apps, Node 18).
 * It boots a full PFP node + the local daemon API and tells the WebView which
 * port to talk to. The database uses the portable WASM SQLite driver and is
 * stored in the app's persistent data directory.
 */

interface Bridge {
  app: { datadir(): string };
  channel: { post(eventName: string, ...args: unknown[]): void };
}

function loadBridge(): Bridge | null {
  try {
    // Provided by the plugin at runtime; absent when run standalone (spike/dev).
    const nodeRequire = createRequire(import.meta.url);
    return nodeRequire('bridge') as Bridge;
  } catch {
    return null;
  }
}

function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value?.toLowerCase() === 'true';
}

function torFromEnv(): TorConfig | null {
  if (!envFlag('PFORUM_TOR')) return null;
  const [host, port] = (process.env.PFORUM_TOR_SOCKS ?? '127.0.0.1:9050').split(':');
  const announce: string[] = [];
  if (process.env.PFORUM_ONION) announce.push(process.env.PFORUM_ONION);
  if (process.env.PFORUM_ONION_DIR) {
    // Reading the hostname file is left to the shell/app; here we only accept an
    // explicit onion multiaddr, since the mobile app has no fs access to Orbot.
    throw new Error('PFORUM_ONION_DIR is not supported on mobile; use PFORUM_ONION');
  }
  if (announce.length === 0) {
    throw new Error('PFORUM_TOR is set but PFORUM_ONION was not provided');
  }
  return { socksHost: host || '127.0.0.1', socksPort: Number(port ?? '9050'), announce };
}

async function main(): Promise<void> {
  const bridge = loadBridge();
  const dataDir = bridge?.app.datadir() ?? process.env.PFORUM_DB_DIR ?? tmpdir();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.PFORUM_DB ?? join(dataDir, 'peerforum.db');

  const tor = torFromEnv();
  const node = await PFPNode.create({
    dbPath,
    dbDriver: 'wasm',
    listen: tor ? ['/ip4/127.0.0.1/tcp/4001'] : ['/ip4/127.0.0.1/tcp/0'],
    enableMdns: false,
    tor,
    autoSync: !envFlag('PFORUM_NO_SYNC'),
  });

  const port = Number(process.env.PFORUM_API_PORT ?? '7331');
  await startDaemon(node, { host: '127.0.0.1', port });

  bridge?.channel.post('pf-ready', {
    port,
    peerId: node.peerId,
    user: node.forum.identity.publicKey,
  });

  // eslint-disable-next-line no-console
  console.log(`PFP mobile node ready: peer=${node.peerId} api=http://127.0.0.1:${port} db=${dbPath}`);

  if (envFlag('PFORUM_SELFTEST')) {
    await runSelfTest(port);
  }
}

/** Local self-test used by the Node 18 compatibility spike (not used on device). */
async function runSelfTest(port: number): Promise<void> {
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/health`);
  const status = await fetch(`${base}/status`);
  const created = await fetch(`${base}/topics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'selftest topic\nfrom the mobile node bundle' }),
  });
  const topics = (await (await fetch(`${base}/topics`)).json()) as { topics: unknown[] };
  // eslint-disable-next-line no-console
  console.log(
    `SELFTEST health=${health.status} status=${status.status} create=${created.status} topics=${topics.topics.length}`,
  );
  process.exit(health.status === 200 && created.status === 201 && topics.topics.length >= 1 ? 0 : 1);
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('PFP mobile node failed to start:', error);
});
