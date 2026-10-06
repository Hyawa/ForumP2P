import { multiaddr } from '@multiformats/multiaddr';
import { describe, expect, it } from 'vitest';

import { PFPNode } from '../src/sync';
import { isOnionMultiaddr, onionTarget, torDialer } from '../src/transports/tor';

const ONION_HOST = 'a'.repeat(56);

function fakeLogger(): { forComponent: () => object } {
  return { forComponent: () => ({}) };
}

describe('tor transport helpers', () => {
  it('parses an onion3 multiaddr into a .onion host and port', () => {
    const ma = multiaddr(`/onion3/${ONION_HOST}/tcp/80`);
    expect(onionTarget(ma)).toEqual({ host: `${ONION_HOST}.onion`, port: 80 });
  });

  it('rejects non-onion multiaddrs', () => {
    expect(() => onionTarget(multiaddr('/ip4/1.2.3.4/tcp/4001'))).toThrow(/onion/i);
  });

  it('detects onion addrs and filters dialable addresses', () => {
    const onion = multiaddr(`/onion3/${ONION_HOST}/tcp/80`);
    const clearnet = multiaddr('/ip4/1.2.3.4/tcp/4001');
    expect(isOnionMultiaddr(onion)).toBe(true);
    expect(isOnionMultiaddr(clearnet)).toBe(false);

    const transport = torDialer()({ logger: fakeLogger() as never });
    expect(transport.dialFilter([onion, clearnet])).toEqual([onion]);
    expect(transport.listenFilter([onion, clearnet])).toEqual([]);
    expect(() => transport.createListener({} as never)).toThrow(/HiddenService/i);
  });
});

describe('anonymous (Tor) node mode', () => {
  it('announces only onion addrs and refuses clearnet peers', async () => {
    const onion = `/onion3/${ONION_HOST}/tcp/80`;
    const node = await PFPNode.create({
      dbPath: ':memory:',
      listen: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      autoSync: false,
      tor: { socksHost: '127.0.0.1', socksPort: 9050, announce: [onion] },
    });
    try {
      expect(node.anonymous).toBe(true);
      expect(node.multiaddrs.length).toBeGreaterThan(0);
      expect(node.multiaddrs.every((addr) => addr.includes('/onion3/'))).toBe(true);
      await expect(node.addPeer('/ip4/1.2.3.4/tcp/4001')).rejects.toThrow(/onion/i);
    } finally {
      await node.stop();
    }
  });
});
