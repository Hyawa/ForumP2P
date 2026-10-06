/**
 * Article construction and verification.
 *
 * The core invariant, inherited from PeerForum: an article is content
 * addressed (its id is the hash of its canonical payload) and signed by its
 * author. Anyone can independently verify authorship and integrity, and any
 * mutation changes the id.
 */
import { canonicalBytes, canonicalize } from './canonical';
import { contentId, sha256Hex } from './hash';
import { sign, verify, isPublicKeyHex } from './crypto';
import { ArticlePayloadSchema, SignedArticleSchema } from './schemas';
import type { z } from 'zod';

export type ArticlePayload = z.infer<typeof ArticlePayloadSchema>;
export type SignedArticle = z.infer<typeof SignedArticleSchema>;

export interface CreateArticleInput {
  type?: number;
  content: string;
  rootId?: string | null;
  parentId?: string | null;
  labels?: string[];
  createTime?: number;
  destroyTime?: number | null;
}

/** Builds and signs an article. The caller's private key defines authorship. */
export async function createArticle(
  input: CreateArticleInput,
  authorPublicKey: string,
  authorPrivateKey: string,
): Promise<SignedArticle> {
  const payload: ArticlePayload = ArticlePayloadSchema.parse({
    v: 2,
    type: input.type ?? 0,
    content: input.content,
    rootId: input.rootId ?? null,
    parentId: input.parentId ?? null,
    labels: input.labels ?? [],
    createTime: input.createTime ?? Date.now(),
    destroyTime: input.destroyTime ?? null,
    author: authorPublicKey,
  });

  const id = contentId(payload);
  const signature = await sign(canonicalBytes(payload), authorPrivateKey);
  return { ...payload, id, signature };
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Verifies shape, content address and author signature of an article.
 * Returns a descriptive error instead of throwing so callers can log/drop.
 */
export async function verifyArticle(candidate: unknown): Promise<VerifyResult> {
  const parsed = SignedArticleSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: `schema: ${parsed.error.message}` };
  }
  const article = parsed.data;

  const { id, signature, ...payload } = article;

  let expectedId: string;
  try {
    expectedId = contentId(payload);
  } catch (error) {
    return { ok: false, error: `canonicalization: ${(error as Error).message}` };
  }
  if (expectedId !== id) {
    return { ok: false, error: 'content address mismatch' };
  }

  if (!isPublicKeyHex(article.author)) {
    return { ok: false, error: 'invalid author key' };
  }
  const valid = await verify(signature, canonicalBytes(payload), article.author);
  if (!valid) {
    return { ok: false, error: 'invalid signature' };
  }
  return { ok: true };
}

/**
 * A topic snapshot: a stable digest of the full set of article ids it
 * contains. Two peers with equal snapshots have identical topic contents,
 * which lets sync skip transfers entirely. This is the modern replacement for
 * the original `sha1(sorted ids)` snapshot.
 */
export function topicSnapshot(articleIds: Iterable<string>): string {
  const joined = [...articleIds].sort().join('\n');
  return sha256Hex(new TextEncoder().encode(joined));
}

/** Canonical string form, handy for logs and tests. */
export function articleToCanonicalString(article: SignedArticle): string {
  const { id, signature, ...payload } = article;
  return canonicalize(payload);
}
