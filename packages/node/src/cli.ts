#!/usr/bin/env node
/**
 * PFP v2 daemon entry point.
 *
 * Usage:
 *   tsx packages/node/src/cli.ts --db ./peerforum.db --port 7331
 *     [--listen /ip4/0.0.0.0/tcp/4001] [--bootstrap <multiaddr>]...
 *     [--no-mdns] [--no-sync] [--sync-interval 15000]
 *
 * Anonymous (Tor) mode:
 *   tsx packages/node/src/cli.ts --tor --onion-dir ./hs --onion-port 80
 *     [--tor-socks 127.0.0.1:9050] [--listen /ip4/127.0.0.1/tcp/4001]
 *     [--token <bearer>]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type TorConfig } from './config';
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
  tor: boolean;
  torSocks: string;
  onion: string[];
  onionDir?: string;
  onionPort: number;
  token?: string;
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
    tor: false,
    torSocks: '127.0.0.1:9050',
    onion: [],
    onionPort: 80,
    token: process.env.PFORUM_TOKEN,
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
      case '--tor':
        args.tor = true;
        break;
      case '--tor-socks':
        if (value) args.torSocks = value;
        i += 1;
        break;
      case '--onion':
        if (value) args.onion.push(value);
        i += 1;
        break;
      case '--onion-dir':
        args.onionDir = value;
        i += 1;
        break;
      case '--onion-port':
        args.onionPort = Number(value ?? args.onionPort);
        i += 1;
        break;
      case '--token':
        args.token = value;
        i += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

/** Resolves the onion multiaddrs to announce from flags / HiddenService dir. */
function resolveOnionAddrs(args: CliArgs): string[] {
  const addrs = [...args.onion];
  if (args.onionDir) {
    const hostnamePath = join(args.onionDir, 'hostname');
    const host = readFileSync(hostnamePath, 'utf8').trim();
    if (host.length > 0) addrs.push(`/onion3/${host}/tcp/${args.onionPort}`);
  }
  return [...new Set(addrs)];
}

function buildTorConfig(args: CliArgs): TorConfig | null {
  if (!args.tor) return null;
  const [host, portRaw] = args.torSocks.split(':');
  const announce = resolveOnionAddrs(args);
  if (announce.length === 0) {
    throw new Error('Tor mode requires --onion <multiaddr> or --onion-dir <path>');
  }
  return {
    socksHost: host || '127.0.0.1',
    socksPort: Number(portRaw ?? 9050),
    announce,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tor = buildTorConfig(args);

  // Tor mode must never announce a public IP: listen on loopback only.
  const listen =
    args.listen.length > 0
      ? args.listen
      : tor
        ? ['/ip4/127.0.0.1/tcp/4001']
        : undefined;

  const node = await PFPNode.create({
    dbPath: args.db,
    listen,
    bootstrap: args.bootstrap,
    enableMdns: tor ? false : !args.noMdns,
    tor,
    autoSync: !args.noSync,
    syncIntervalMs: args.syncIntervalMs,
  });

  const server = await startDaemon(node, {
    host: args.host,
    port: args.port,
    token: args.token,
  });

  const status = node.status();
  // eslint-disable-next-line no-console
  console.log(`PFP node ${status.peerId} started.`);
  console.log(`Local daemon API: http://${args.host}:${args.port}`);
  if (tor) {
    // Only onion addresses are ever printed; clearnet IPs are never exposed.
    const onionAddrs = node.multiaddrs.filter((addr) => addr.includes('/onion'));
    for (const addr of onionAddrs) console.log(`  ${addr}`);
    console.log('Anonymous mode: dialing and announcing via Tor (.onion) only.');
    console.log(
      `Ensure a Tor HiddenService forwards a port to the libp2p listener (${listen?.join(', ')}).`,
    );
  } else {
    console.log(
      'Addresses are hidden for privacy. Create a Network and share an invite code (or run with --tor for an .onion address).',
    );
  }

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
