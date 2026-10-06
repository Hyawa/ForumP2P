/**
 * Ed25519 identity primitives built on @noble/ed25519.
 *
 * A user's public key (32 bytes hex) *is* their identity. Articles are signed
 * with the user's private key. Node identity is handled separately by libp2p
 * (also Ed25519), so the same curve backs both layers.
 *
 * All operations are async so @noble/ed25519 can use WebCrypto-backed SHA-512
 * without extra configuration.
 */
import * as ed from '@noble/ed25519';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

export interface KeyPair {
  /** 32-byte Ed25519 public key, hex encoded. */
  publicKey: string;
  /** 32-byte Ed25519 private key seed, hex encoded. */
  privateKey: string;
}

/** Generates a fresh Ed25519 keypair. */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { publicKey: bytesToHex(publicKey), privateKey: bytesToHex(privateKey) };
}

/** Derives the public key for a private key seed (hex). */
export async function derivePublicKey(privateKeyHex: string): Promise<string> {
  const publicKey = await ed.getPublicKeyAsync(hexToBytes(privateKeyHex));
  return bytesToHex(publicKey);
}

/** Signs a message, returning a 64-byte signature hex-encoded. */
export async function sign(message: Uint8Array, privateKeyHex: string): Promise<string> {
  const signature = await ed.signAsync(message, hexToBytes(privateKeyHex));
  return bytesToHex(signature);
}

/** Verifies a signature. Never throws: malformed input returns false. */
export async function verify(
  signatureHex: string,
  message: Uint8Array,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/** Validation helpers for untrusted hex fields. */
export function isPublicKeyHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function isSignatureHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{128}$/.test(value);
}
