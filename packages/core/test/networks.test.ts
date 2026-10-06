import { beforeEach, describe, expect, it } from 'vitest';

import { decodeInviteCode } from '@pforum/protocol';

import { Forum } from '../src/forum';

async function makeForum(): Promise<Forum> {
  return Forum.open({ dbPath: ':memory:' });
}

describe('networks', () => {
  let owner: Forum;
  let guest: Forum;

  beforeEach(async () => {
    owner = await makeForum();
    guest = await makeForum();
  });

  it('creates a network with the creator as owner', async () => {
    const network = await owner.createNetwork('Family');
    const summaries = owner.listNetworks();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ networkId: network.networkId, myRole: 'owner', memberCount: 1 });
    expect(owner.isMember(network.networkId, owner.identity.publicKey)).toBe(true);
  });

  it('lets the owner add members and non-members cannot', async () => {
    const network = await owner.createNetwork('Team');
    await owner.addMember(network.networkId, guest.identity.publicKey);
    expect(owner.isMember(network.networkId, guest.identity.publicKey)).toBe(true);

    const stranger = await makeForum();
    stranger.rememberNetwork(network);
    await expect(stranger.addMember(network.networkId, guest.identity.publicKey)).rejects.toThrow(
      /requires owner or admin/,
    );
  });

  it('admits a guest through a one-time invite', async () => {
    const network = await owner.createNetwork('Invite');
    const { code } = await owner.createInvite(network.networkId, {}, ['/ip4/127.0.0.1/tcp/1']);

    const decoded = decodeInviteCode(code);
    expect(decoded.networkId).toBe(network.networkId);

    const { network: joined, ops } = await owner.acceptJoin(decoded, guest.identity.publicKey);
    guest.rememberNetwork(joined);
    await guest.applyRosterOps(network.networkId, ops);

    expect(guest.isMember(network.networkId, guest.identity.publicKey)).toBe(true);
    expect(owner.isMember(network.networkId, guest.identity.publicKey)).toBe(true);

    const other = await makeForum();
    await expect(owner.acceptJoin(decoded, other.identity.publicKey)).rejects.toThrow(
      /already used/,
    );
  });

  it('rejects expired invites', async () => {
    const network = await owner.createNetwork('Expiring');
    const { invite } = await owner.createInvite(network.networkId, { expiresInMs: -1000 }, []);

    await expect(owner.acceptJoin(invite, guest.identity.publicKey)).rejects.toThrow(/expired/);
  });

  it('propagates removal to the removed member', async () => {
    const network = await owner.createNetwork('Moderation');
    await owner.addMember(network.networkId, guest.identity.publicKey);
    guest.rememberNetwork(network);
    await guest.applyRosterOps(network.networkId, owner.rosterOps(network.networkId));
    expect(guest.isMember(network.networkId, guest.identity.publicKey)).toBe(true);

    const removeOp = await owner.removeMember(network.networkId, guest.identity.publicKey);
    await guest.applyRosterOps(network.networkId, [removeOp]);

    expect(owner.isMember(network.networkId, guest.identity.publicKey)).toBe(false);
    expect(guest.isMember(network.networkId, guest.identity.publicKey)).toBe(false);
  });

  it('enforces admin vs owner powers', async () => {
    const network = await owner.createNetwork('Roles');
    const admin = await makeForum();
    await owner.addMember(network.networkId, admin.identity.publicKey, 'admin');
    admin.rememberNetwork(network);
    await admin.applyRosterOps(network.networkId, owner.rosterOps(network.networkId));

    // Admin can add members...
    await admin.addMember(network.networkId, guest.identity.publicKey);
    // ...but cannot change roles (owner only).
    await expect(admin.setRole(network.networkId, guest.identity.publicKey, 'admin')).rejects.toThrow(
      /only the owner/,
    );
  });

  it('scopes posts to a network and rejects non-member authors', async () => {
    const network = await owner.createNetwork('Scoped');
    await owner.post({ content: 'inside the network' }, network.networkId);

    expect(owner.listTopics({ networkId: network.networkId })).toHaveLength(1);
    expect(owner.listTopics({ networkId: null })).toHaveLength(0);

    await expect(guest.post({ content: 'not allowed' }, network.networkId)).rejects.toThrow(
      /not a member/,
    );

    const strangerPost = await guest.post({ content: 'public stranger' });
    const result = await owner.ingest(strangerPost, null, network.networkId);
    expect(result.status).toBe('invalid');
  });
});
