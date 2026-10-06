import { describe, expect, it } from 'vitest';

import {
  decodeInviteCode,
  encodeInviteCode,
  foldRoster,
  generateKeyPair,
  isActiveMember,
  roleOf,
  rosterOpId,
  signHello,
  signInvite,
  signRosterOp,
  verifyHello,
  verifyInvite,
  verifyRosterOp,
  type RosterOp,
  type RosterOpInput,
} from '../src/index';

async function rosterInput(
  partial: Partial<RosterOpInput> & Pick<RosterOpInput, 'networkId' | 'opType' | 'subject' | 'author' | 'epoch'>,
): Promise<RosterOpInput> {
  return {
    role: null,
    prevHash: null,
    createdAt: 1000 + partial.epoch,
    ...partial,
  };
}

describe('hello binding', () => {
  it('verifies a genuine binding and rejects tampering', async () => {
    const user = await generateKeyPair();
    const signature = await signHello({ user: user.publicKey, peerId: '12D3KooWtest' }, user.privateKey);

    expect(await verifyHello({ user: user.publicKey, peerId: '12D3KooWtest' }, signature)).toBe(true);
    expect(await verifyHello({ user: user.publicKey, peerId: '12D3KooWevil' }, signature)).toBe(false);
  });
});

describe('roster ops', () => {
  it('signs and verifies, and the id is deterministic', async () => {
    const owner = await generateKeyPair();
    const input = await rosterInput({
      networkId: 'a'.repeat(64),
      opType: 'create',
      subject: owner.publicKey,
      author: owner.publicKey,
      epoch: 0,
    });
    const op = await signRosterOp(input, owner.privateKey);

    expect(rosterOpId(input)).toBe(op.opId);
    expect(await verifyRosterOp(op)).toBe(true);
    expect(await verifyRosterOp({ ...op, epoch: 5 })).toBe(false);
  });
});

describe('roster fold (authority)', () => {
  it('applies owner-centric rules and rejects invalid ops', async () => {
    const owner = await generateKeyPair();
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const net = 'b'.repeat(64);

    const ops: RosterOp[] = [];
    ops.push(await signRosterOp(await rosterInput({ networkId: net, opType: 'create', subject: owner.publicKey, author: owner.publicKey, epoch: 0 }), owner.privateKey));
    ops.push(await signRosterOp(await rosterInput({ networkId: net, opType: 'add', subject: alice.publicKey, author: owner.publicKey, epoch: 1, role: 'member' }), owner.privateKey));
    // alice (a plain member) tries to add bob -> rejected
    ops.push(await signRosterOp(await rosterInput({ networkId: net, opType: 'add', subject: bob.publicKey, author: alice.publicKey, epoch: 2, role: 'member' }), alice.privateKey));
    // owner promotes alice to admin
    ops.push(await signRosterOp(await rosterInput({ networkId: net, opType: 'setRole', subject: alice.publicKey, author: owner.publicKey, epoch: 3, role: 'admin' }), owner.privateKey));
    // admin alice adds bob -> accepted
    ops.push(await signRosterOp(await rosterInput({ networkId: net, opType: 'add', subject: bob.publicKey, author: alice.publicKey, epoch: 4, role: 'member' }), alice.privateKey));
    // admin alice cannot remove the owner
    ops.push(await signRosterOp(await rosterInput({ networkId: net, opType: 'remove', subject: owner.publicKey, author: alice.publicKey, epoch: 5 }), alice.privateKey));
    // admin alice removes bob
    ops.push(await signRosterOp(await rosterInput({ networkId: net, opType: 'remove', subject: bob.publicKey, author: alice.publicKey, epoch: 6 }), alice.privateKey));

    const state = foldRoster(ops);

    expect(state.owner).toBe(owner.publicKey);
    expect(roleOf(state, owner.publicKey)).toBe('owner');
    expect(roleOf(state, alice.publicKey)).toBe('admin');
    expect(isActiveMember(state, bob.publicKey)).toBe(false);
    expect(state.rejected).toBe(2); // member-added-bob + admin-removed-owner
  });
});

describe('invite codes', () => {
  it('round-trips through the text code and verifies', async () => {
    const owner = await generateKeyPair();
    const invite = await signInvite(
      {
        networkId: 'c'.repeat(64),
        secret: 'd'.repeat(64),
        inviter: owner.publicKey,
        addrs: ['/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWx'],
        expiresAt: Date.now() + 60_000,
        maxUses: 1,
      },
      owner.privateKey,
    );

    const code = encodeInviteCode(invite);
    expect(code.startsWith('PFPJOIN1.')).toBe(true);

    const decoded = decodeInviteCode(code);
    expect(decoded).toEqual(invite);
    expect(await verifyInvite(decoded)).toBe(true);
    expect(await verifyInvite({ ...decoded, secret: 'e'.repeat(64) })).toBe(false);
  });
});
