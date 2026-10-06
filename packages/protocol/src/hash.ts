import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { canonicalBytes } from './canonical';

/** SHA-256 of raw bytes, hex encoded. */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Content address of a canonicalizable payload: sha256(canonical(payload)). */
export function contentId(payload: unknown): string {
  return sha256Hex(canonicalBytes(payload));
}

export { bytesToHex, hexToBytes };
