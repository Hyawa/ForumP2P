#!/usr/bin/env node
/**
 * PFP v2 daemon entry point.
 *
 * Usage:
 *   tsx packages/node/src/cli.ts --db ./peerforum.db --port 7331
 *     [--listen /ip4/0.0.0.0/tcp/4001] [--bootstrap <multiaddr>]...
 *     [--no-mdns] [--no-sync] [--sync-interval 15000]
 */
import { startDaemon } from './daemon';
import { PFPNode } from './sync';

interface CliArgs {
  db: string;
  host: string;
  port: number;
  listen: string[];
  bootstrap: string[];
  noMdns: boolean;
  noSync: boolean;
  syncIntervalMs?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    db: process.env.PFORUM_DB ?? './peerforum.db',
    host: '127.0.0.1',
    port: 7331,
    listen: [],
    bootstrap: [],
    noMdns: false,
    noSync: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--db':
        args.db = value ?? args.db;
        i += 1;
        break;
      case '--host':
        args.host = value ?? args.host;
        i += 1;
        break;
      case '--port':
        args.port = Number(value ?? args.port);
        i += 1;
        break;
      case '--listen':
        if (value) args.listen.push(value);
        i += 1;
        break;
      case '--bootstrap':
        if (value) args.bootstrap.push(value);
        i += 1;
        break;
      case '--no-mdns':
        args.noMdns = true;
        break;
      case '--no-sync':
        args.noSync = true;
        break;
      case '--sync-interval':
        args.syncIntervalMs = Number(value);
        i += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const node = await PFPNode.create({
    dbPath: args.db,
    listen: args.listen.length > 0 ? args.listen : undefined,
    bootstrap: args.bootstrap,
    enableMdns: !args.noMdns,
    autoSync: !args.noSync,
    syncIntervalMs: args.syncIntervalMs,
  });

  const server = await startDaemon(node, { host: args.host, port: args.port });

  const status = node.status();
  // eslint-disable-next-line no-console
  console.log(`PFP node ${status.peerId} listening on:`);
  for (const addr of status.multiaddrs) console.log(`  ${addr}`);
  console.log(`Local daemon API: http://${args.host}:${args.port}`);
  console.log(`Share a multiaddr above so friends can add you as a peer.`);

  const shutdown = async (): Promise<void> => {
    await server.close();
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
