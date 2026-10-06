import { afterEach, describe, expect, it } from 'vitest';

import { PFPNode } from '../src/sync';

/**
 * End-to-end P2P test: three independent libp2p nodes, each with its own
 * in-memory database, converging through the PFP v2 sync protocol. mDNS is
 * disabled so discovery is deterministic (explicit peer adds).
 */
const nodes: PFPNode[] = [];

async function makeNode(): Promise<PFPNode> {
  const node = await PFPNode.create({
    dbPath: ':memory:',
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableMdns: false,
    autoSync: false,
    bootstrap: [],
  });
  nodes.push(node);
  return node;
}

function dialableAddress(node: PFPNode): string {
  const address = node.multiaddrs.find((addr) => addr.includes('/ip4/127.0.0.1/'));
  if (!address) throw new Error(`no dialable address for ${node.peerId}: ${node.multiaddrs.join(', ')}`);
  return address;
}

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop()));
});

describe('PFP v2 network', () => {
  it('syncs a topic from one peer to another', async () => {
    const alice = await makeNode();
    const bob = await makeNode();

    const root = await alice.forum.post({ content: 'Hello P2P', labels: ['intro'] });
    await alice.forum.post({ content: 'first reply', rootId: root.id, parentId: root.id });

    await bob.addPeer(dialableAddress(alice));
    const report = await bob.syncWithPeer(dialableAddress(alice));

    expect(report.stored).toBe(2);
    expect(bob.forum.getTopic(root.id)?.count).toBe(2);
    expect(bob.forum.getTopic(root.id)?.snapshot).toBe(alice.forum.getTopic(root.id)?.snapshot);
  });

  it('propagates to a third node via peer discovery', async () => {
    const alice = await makeNode();
    const bob = await makeNode();
    const charlie = await makeNode();

    const root = await alice.forum.post({ content: 'gossip topic', labels: ['net'] });

    await bob.addPeer(dialableAddress(alice));
    await bob.syncWithPeer(dialableAddress(alice));
    expect(bob.forum.getTopic(root.id)?.snapshot).toBe(alice.forum.getTopic(root.id)?.snapshot);

    // Charlie only knows Bob; Bob tells him about Alice.
    await charlie.addPeer(dialableAddress(bob));
    const learned = await charlie.discoverFromPeer(dialableAddress(bob));
    expect(learned).toBeGreaterThanOrEqual(1);

    const aliceAsSeenByCharlie = charlie.forum.peers.get(alice.peerId);
    expect(aliceAsSeenByCharlie).toBeDefined();

    const charlieReport = await charlie.syncWithPeer(aliceAsSeenByCharlie!.multiaddrs[0]!);
    expect(charlieReport.stored).toBe(1);
    expect(charlie.forum.getTopic(root.id)?.snapshot).toBe(alice.forum.getTopic(root.id)?.snapshot);
  });

  it('only transfers the delta on incremental sync', async () => {
    const alice = await makeNode();
    const bob = await makeNode();

    const root = await alice.forum.post({ content: 'topic' });
    await bob.addPeer(dialableAddress(alice));
    await bob.syncWithPeer(dialableAddress(alice));

    const reply = await alice.forum.post({ content: 'new reply', rootId: root.id, parentId: root.id });
    const report = await bob.syncWithPeer(dialableAddress(alice));

    expect(report.stored).toBe(1);
    expect(bob.forum.getArticle(reply.id)).toBeDefined();
    expect(bob.forum.getTopic(root.id)?.snapshot).toBe(alice.forum.getTopic(root.id)?.snapshot);
  });

  it('preserves authorship verification across the wire', async () => {
    const alice = await makeNode();
    const bob = await makeNode();

    const root = await alice.forum.post({ content: 'signed' });
    await bob.addPeer(dialableAddress(alice));
    await bob.syncWithPeer(dialableAddress(alice));

    const received = bob.forum.getArticle(root.id);
    expect(received?.author).toBe(alice.forum.identity.publicKey);
  });
});
