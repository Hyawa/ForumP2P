/**
 * Framed request/response over a libp2p Stream.
 *
 * libp2p v3 streams are message streams: you write with `.send()` and read by
 * async-iterating. We add our own 4-byte length framing (from the protocol
 * package) so a single stream carries exactly one request and one response.
 */
import type { Stream } from '@libp2p/interface';
import {
  FrameDecoder,
  decodeMessage,
  encodeMessage,
  frame,
  type Message,
} from '@pforum/protocol';

/** Normalizes a libp2p chunk (Uint8Array or Uint8ArrayList) to bytes. */
export function toBytes(chunk: Uint8Array | { subarray(): Uint8Array }): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : chunk.subarray();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Sends one message and resolves with the remote's single reply.
 *
 * The read loop is drained fully (rather than breaking on the first frame) so
 * the stream iterator completes naturally; breaking early aborts the stream and
 * can reset the underlying connection, which breaks subsequent dials.
 */
export async function requestResponse(
  stream: Stream,
  message: Message,
  timeoutMs: number,
): Promise<Message> {
  const readReply = async (): Promise<Message> => {
    const decoder = new FrameDecoder();
    let result: Message | undefined;
    for await (const chunk of stream) {
      for (const payload of decoder.push(toBytes(chunk))) {
        if (result === undefined) result = decodeMessage(payload);
      }
    }
    if (result === undefined) throw new Error('connection closed before a response arrived');
    return result;
  };

  stream.send(frame(encodeMessage(message)));
  await stream.close();

  return withTimeout(readReply(), timeoutMs, 'PFP RPC');
}

/**
 * Serves exactly one request per stream, then closes the write end. The read
 * loop is drained to completion so the stream closes gracefully.
 */
export async function serveSingle(
  stream: Stream,
  handler: (message: Message) => Promise<Message> | Message,
): Promise<void> {
  const decoder = new FrameDecoder();
  let handled = false;
  try {
    for await (const chunk of stream) {
      for (const payload of decoder.push(toBytes(chunk))) {
        if (handled) continue;
        handled = true;
        const reply = await handler(decodeMessage(payload));
        stream.send(frame(encodeMessage(reply)));
        await stream.close();
      }
    }
  } catch (error) {
    if (!handled) stream.abort(error as Error);
  }
}
