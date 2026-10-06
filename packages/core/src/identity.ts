/**
 * Persistent Ed25519 identities.
 *
 * Two kinds exist, mirroring the original two-keypair split:
 *  - `user`: the human author. Signs articles.
 *  - `node`: the machine/libp2p peer. libp2p also uses it as the PeerID.
 *
 * NOTE: private keys are stored in plaintext for the MVP. Encrypting the
 * keystore (as the original did with a password) is a follow-up, and the
 * schema already isolates the secret in its own column.
 */
import { generateKeyPair } from '@pforum/protocol';

import type { SqlDatabase } from './db';

export type IdentityKind = 'user' | 'node';

export interface Identity {
  kind: IdentityKind;
  publicKey: string;
  privateKey: string;
  createdAt: number;
}

export class IdentityManager {
  constructor(
    private readonly db: SqlDatabase,
    private readonly kind: IdentityKind,
  ) {}

  get(): Identity | undefined {
    const row = this.db
      .prepare('SELECT kind, public_key, private_key, created_at FROM identity WHERE kind = ?')
      .get(this.kind);
    if (!row) return undefined;
    return {
      kind: row.kind as IdentityKind,
      publicKey: row.public_key as string,
      privateKey: row.private_key as string,
      createdAt: row.created_at as number,
    };
  }

  /** Returns the stored identity, generating and persisting one if needed. */
  async ensure(): Promise<Identity> {
    const existing = this.get();
    if (existing) return existing;
    return this.create();
  }

  async create(): Promise<Identity> {
    const keys = await generateKeyPair();
    const identity: Identity = {
      kind: this.kind,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO identity (kind, public_key, private_key, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET public_key = excluded.public_key,
           private_key = excluded.private_key, created_at = excluded.created_at`,
      )
      .run(identity.kind, identity.publicKey, identity.privateKey, identity.createdAt);
    return identity;
  }

  /** Replaces the stored identity (used to import a key). */
  save(identity: Identity): void {
    this.db
      .prepare(
        `INSERT INTO identity (kind, public_key, private_key, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET public_key = excluded.public_key,
           private_key = excluded.private_key, created_at = excluded.created_at`,
      )
      .run(identity.kind, identity.publicKey, identity.privateKey, identity.createdAt);
  }
}
