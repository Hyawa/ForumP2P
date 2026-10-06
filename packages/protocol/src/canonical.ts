/**
 * Canonical JSON serialization.
 *
 * Article identity is derived from the canonical bytes of a payload, so this
 * must be deterministic across languages and runs. Rules:
 *  - object keys are sorted lexicographically by UTF-16 code unit
 *  - arrays preserve order
 *  - `undefined` object properties are omitted; `undefined` array items -> null
 *  - numbers must be finite (integers in practice)
 *
 * We deliberately hand-roll instead of using a library so the exact byte
 * output is auditable and stable.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function sortValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : sortValue(item)));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) continue;
      output[key] = sortValue(item);
    }
    return output;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`Cannot canonicalize non-finite number: ${value}`);
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
  }
  return value;
}

/** Returns the canonical JSON string for a value. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

const encoder = new TextEncoder();

/** Returns the canonical UTF-8 bytes for a value. */
export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}
