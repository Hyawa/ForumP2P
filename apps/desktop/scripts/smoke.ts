/**
 * Desktop smoke test: boots a real PFP node + daemon (serving the web UI) and
 * checks the HTTP surface, all under Electron's bundled Node.
 *
 * Run under Electron's bundled Node to prove the P2P stack (libp2p + built-in
 * `node:sqlite` + Fastify) works in the desktop runtime:
 *
 *   npm -w @pforum/desktop run smoke
 */
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PFPNode, startDaemon } from '@pforum/node';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', '..', '..', 'packages', 'web', 'dist');
const hasWeb = existsSync(join(webDir, 'index.html'));

const node = await PFPNode.create({
  dbPath: ':memory:',
  listen: ['/ip4/127.0.0.1/tcp/0'],
  enableMdns: false,
  autoSync: false,
});
const server = await startDaemon(node, {
  host: '127.0.0.1',
  port: 0,
  staticDir: hasWeb ? webDir : undefined,
});

try {
  const { port } = server.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/health`);
  const healthBody = (await health.json()) as { ok: boolean };
  if (health.status !== 200 || healthBody.ok !== true) {
    throw new Error(`unexpected health response: ${health.status}`);
  }

  const status = await fetch(`${base}/status`);
  if (status.status !== 200) throw new Error(`/status failed: ${status.status}`);

  if (hasWeb) {
    const index = await fetch(`${base}/`);
    const html = await index.text();
    if (index.status !== 200 || !html.includes('PeerForum')) {
      throw new Error(`web UI not served: ${index.status}`);
    }
    const runtime = await fetch(`${base}/pf-runtime.js`);
    if (runtime.status !== 200) throw new Error(`pf-runtime.js not served: ${runtime.status}`);
  }

  const suffix = hasWeb ? ' + web UI' : ' (web UI not built)';
  console.log(`desktop smoke OK — node ${node.peerId.slice(0, 16)}… daemon :${port}${suffix}`);
} finally {
  await server.close();
  await node.stop();
}
