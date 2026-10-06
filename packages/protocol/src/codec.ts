/**
 * Wire codec.
 *
 * Each message is encoded as a CBOR envelope `{ p, t, m }` where `p` is the
 * protocol version, `t` a millisecond timestamp (the modern equivalent of the
 * original `Time` freshness check) and `m` the message body.
 *
 * Framing for raw byte streams is a 4-byte big-endian length prefix. Over
 * libp2p we reuse `it-length-prefixed`; `FrameDecoder` exists so the codec can
 * also be exercised with plain byte streams in tests.
 */
import { decode, encode } from 'cbor-x';

import { PFP_VERSION } from './constants';
import { EnvelopeSchema, type Envelope, type Message } from './schemas';

export function encodeEnvelope(envelope: Envelope): Uint8Array {
  return encode(EnvelopeSchema.parse(envelope));
}

export function decodeEnvelope(bytes: Uint8Array): Envelope {
  return EnvelopeSchema.parse(decode(bytes));
}

/** Encodes a message body into a CBOR envelope. */
export function encodeMessage(message: Message, timestamp: number = Date.now()): Uint8Array {
  const envelope: Envelope = { p: PFP_VERSION, t: timestamp, m: message };
  return encodeEnvelope(envelope);
}

/** Decodes and validates an envelope, returning the inner message. */
export function decodeMessage(bytes: Uint8Array): Message {
  return decodeEnvelope(bytes).m;
}

/** Decodes an envelope, returning the timestamp too (for freshness checks). */
export function decodeMessageWithTime(bytes: Uint8Array): { message: Message; time: number } {
  const envelope = decodeEnvelope(bytes);
  return { message: envelope.m, time: envelope.t };
}

/** Prefixes a payload with its 4-byte big-endian length. */
export function frame(payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(payload.length + 4);
  new DataView(output.buffer, output.byteOffset, 4).setUint32(0, payload.length, false);
  output.set(payload, 4);
  return output;
}

/**
 * Incremental length-prefixed frame decoder for raw byte streams.
 * Feed it chunks; it yields complete payloads as they become available.
 */
export class FrameDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);

    const frames: Uint8Array[] = [];
    let offset = 0;
    while (merged.length - offset >= 4) {
      const view = new DataView(merged.buffer, merged.byteOffset + offset, 4);
      const length = view.getUint32(0, false);
      if (merged.length - offset - 4 < length) break;
      frames.push(merged.subarray(offset + 4, offset + 4 + length));
      offset += 4 + length;
    }
    this.buffer = merged.subarray(offset);
    return frames;
  }
}
