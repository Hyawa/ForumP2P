import { afterEach, describe, expect, it } from 'vitest';

import { PFPNode } from '../src/sync';

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
  if (!address) throw new Error(`no dialable address for ${node.peerId}`);
  return address;
}

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop()));
});

describe('PFP v2 networks', () => {
  it('joins by invite and syncs network-scoped content both ways', async () => {
    const owner = await makeNode();
    const guest = await makeNode();

    const network = await owner.createNetwork('Friends');
    const { code } = await owner.createInvite(network.networkId, { maxUses: 1 });

    const joined = await guest.joinNetwork(code);
    expect(joined.networkId).toBe(network.networkId);
    expect(guest.forum.isMember(network.networkId, guest.forum.identity.publicKey)).toBe(true);
    expect(owner.forum.isMember(network.networkId, guest.forum.identity.publicKey)).toBe(true);

    // owner -> guest
    const ownerTopic = await owner.forum.post({ content: 'hello from owner' }, network.networkId);
    await guest.syncWithPeer(dialableAddress(owner), network.networkId);
    expect(guest.forum.getTopic(ownerTopic.id)?.snapshot).toBe(owner.forum.getTopic(ownerTopic.id)?.snapshot);

    // guest -> owner
    const guestTopic = await guest.forum.post({ content: 'hello from guest' }, network.networkId);
    await owner.syncWithPeer(dialableAddress(guest), network.networkId);
    expect(owner.forum.getTopic(guestTopic.id)?.snapshot).toBe(guest.forum.getTopic(guestTopic.id)?.snapshot);
  });

  it('stops a removed member from receiving new content', async () => {
    const owner = await makeNode();
    const guest = await makeNode();

    const network = await owner.createNetwork('Moderation');
    const { code } = await owner.createInvite(network.networkId, { maxUses: 1 });
    await guest.joinNetwork(code);

    await owner.removeMember(network.networkId, guest.forum.identity.publicKey);
    expect(owner.forum.isMember(network.networkId, guest.forum.identity.publicKey)).toBe(false);
    expect(guest.forum.isMember(network.networkId, guest.forum.identity.publicKey)).toBe(false);

    const secretTopic = await owner.forum.post({ content: 'members only' }, network.networkId);
    await expect(guest.syncWithPeer(dialableAddress(owner), network.networkId)).rejects.toThrow();
    expect(guest.forum.getTopic(secretTopic.id)).toBeUndefined();
  });

  it('rejects invite reuse', async () => {
    const owner = await makeNode();
    const guest = await makeNode();
    const other = await makeNode();

    const network = await owner.createNetwork('OneShot');
    const { code } = await owner.createInvite(network.networkId, { maxUses: 1 });

    await guest.joinNetwork(code);
    await expect(other.joinNetwork(code)).rejects.toThrow(/already used/);
  });
});
