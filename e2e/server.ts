/**
 * E2E daemon: boots a real PFP node and serves the built web UI, so Playwright
 * exercises the exact same HTTP surface the desktop/mobile apps use.
 *
 * Started by Playwright's `webServer` (see playwright.config.ts).
 */
import { fileURLToPath } from 'node:url';

import { PFPNode, startDaemon } from '@pforum/node';

const staticDir = fileURLToPath(new URL('../packages/web/dist', import.meta.url));

const node = await PFPNode.create({
  dbPath: ':memory:',
  listen: ['/ip4/127.0.0.1/tcp/0'],
  enableMdns: false,
  autoSync: false,
});

const app = await startDaemon(node, {
  host: '127.0.0.1',
  port: 7391,
  staticDir,
});

// eslint-disable-next-line no-console
console.log('e2e daemon ready on http://127.0.0.1:7391');

const shutdown = async (): Promise<void> => {
  await app.close();
  await node.stop();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
