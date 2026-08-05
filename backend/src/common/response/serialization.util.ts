import { Types } from 'mongoose';

/**
 * Small, focused helpers for converting Mongoose in-memory values (ObjectIds,
 * Dates, populated-or-not refs) into the plain values that actually cross the
 * HTTP boundary. These exist so response mappers never need `as any`/`as
 * unknown as {...}` to read a field that may or may not have been populated
 * — every mapper under a module's `contracts/` folder should go through
 * these instead of re-implementing the same duck-typing per module.
 */

/** True for an un-populated ref (still a raw ObjectId, not a hydrated document). */
export function isObjectIdRef(value: unknown): value is Types.ObjectId {
  return value instanceof Types.ObjectId;
}

/**
 * Serializes an ObjectId (or an already-stringified id) to its string form.
 * Returns `undefined` for `null`/`undefined` so optional response fields stay
 * omitted rather than becoming the literal string `"null"`.
 */
export function serializeObjectId(
  value: Types.ObjectId | string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value.toString();
}

/**
 * Serializes a Date (or an already-ISO-string value) to the exact ISO string
 * `JSON.stringify`/Mongoose's default `Date#toJSON` would have produced, so
 * introducing an explicit mapper never changes the wire format for date
 * fields.
 */
export function serializeDate(
  value: Date | string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Maps a field that may be a populated Mongoose sub-document, a raw
 * ObjectId, or an already-serialized id string — the exact ambiguity every
 * `.populate(...)` call site in this codebase can produce depending on
 * whether the populate succeeded. Returns `undefined` for `null`/`undefined`
 * so optional populated refs stay omitted, matching current behavior.
 */
export function mapPopulatedRef<TDoc, TResponse>(
  value: TDoc | Types.ObjectId | string | null | undefined,
  mapDoc: (doc: TDoc) => TResponse,
): string | TResponse | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (isObjectIdRef(value) || typeof value === 'string') {
    return value.toString();
  }
  return mapDoc(value);
}

export interface MongooseTimestamps {
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Mongoose adds `createdAt`/`updatedAt` to any schema declared with
 * `{ timestamps: true }`, but schema classes rarely declare the fields
 * themselves, so TypeScript has no static knowledge of them. Use this single
 * named cast instead of an inline `as unknown as { createdAt?: Date }` at
 * each read site.
 */
export function readTimestamps(doc: unknown): MongooseTimestamps {
  return (doc as MongooseTimestamps | null | undefined) ?? {};
}

/**
 * Reads a field that may have been populated into a Mongoose sub-document —
 * or may still be the raw (unpopulated) ref value the schema declares — when
 * the caller only needs to peek at a populated field in place, rather than
 * build a full response contract via `mapPopulatedRef`. Use this single
 * named cast instead of an inline `as unknown as {...}` at each read site.
 */
export function readPopulatedField<T>(ref: unknown): T | undefined {
  return ref as T | undefined;
}
