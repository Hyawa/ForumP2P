/**
 * Minimal, dependency-free base64url (RFC 4648 §5) so invite codes can be
 * produced and parsed identically in Node and the browser.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REVERSE: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i += 1) {
  REVERSE[ALPHABET[i]!] = i;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    output += ALPHABET[(triplet >> 18) & 63];
    output += ALPHABET[(triplet >> 12) & 63];
    if (i + 1 < bytes.length) output += ALPHABET[(triplet >> 6) & 63];
    if (i + 2 < bytes.length) output += ALPHABET[triplet & 63];
  }
  return output;
}

export function base64urlDecode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9\-_]/g, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const output = new Uint8Array(byteLength);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    value = (value << 6) | (REVERSE[char] ?? 0);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[index] = (value >> bits) & 0xff;
      index += 1;
    }
  }
  return output;
}
