import { Types } from 'mongoose';
import {
  isObjectIdRef,
  mapPopulatedRef,
  readPopulatedField,
  readTimestamps,
  serializeDate,
  serializeObjectId,
} from './serialization.util';

describe('serializeObjectId', () => {
  it('serializes an ObjectId to its hex string', () => {
    const id = new Types.ObjectId();
    expect(serializeObjectId(id)).toBe(id.toString());
  });

  it('passes an already-serialized string through unchanged', () => {
    expect(serializeObjectId('already-a-string')).toBe('already-a-string');
  });

  it('returns undefined for null/undefined rather than the literal string "null"', () => {
    expect(serializeObjectId(null)).toBeUndefined();
    expect(serializeObjectId(undefined)).toBeUndefined();
  });
});

describe('serializeDate', () => {
  it('serializes a Date to the same ISO string JSON.stringify would produce', () => {
    const date = new Date('2026-03-01T12:00:00.000Z');
    expect(serializeDate(date)).toBe(JSON.parse(JSON.stringify({ d: date })).d);
  });

  it('passes an already-serialized ISO string through unchanged', () => {
    expect(serializeDate('2026-03-01T12:00:00.000Z')).toBe(
      '2026-03-01T12:00:00.000Z',
    );
  });

  it('returns undefined for null/undefined', () => {
    expect(serializeDate(null)).toBeUndefined();
    expect(serializeDate(undefined)).toBeUndefined();
  });
});

describe('isObjectIdRef', () => {
  it('is true only for a real ObjectId instance', () => {
    expect(isObjectIdRef(new Types.ObjectId())).toBe(true);
    expect(isObjectIdRef('a-string-id')).toBe(false);
    expect(isObjectIdRef({ _id: 'x' })).toBe(false);
    expect(isObjectIdRef(undefined)).toBe(false);
  });
});

describe('mapPopulatedRef', () => {
  const mapDoc = (doc: { name: string }) => ({ label: doc.name });

  it('serializes an unpopulated ObjectId ref to a plain id string', () => {
    const id = new Types.ObjectId();
    expect(mapPopulatedRef(id, mapDoc)).toBe(id.toString());
  });

  it('passes an already-serialized id string through unchanged', () => {
    expect(mapPopulatedRef('some-id', mapDoc)).toBe('some-id');
  });

  it('maps a populated document through the provided mapper', () => {
    expect(mapPopulatedRef({ name: 'Widget' }, mapDoc)).toEqual({
      label: 'Widget',
    });
  });

  it('returns undefined for a null/undefined ref, never invoking the mapper', () => {
    const spy = jest.fn(mapDoc);
    expect(mapPopulatedRef(null, spy)).toBeUndefined();
    expect(mapPopulatedRef(undefined, spy)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('readTimestamps / readPopulatedField', () => {
  it('reads Mongoose-added createdAt/updatedAt off an untyped document', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    expect(readTimestamps({ createdAt }).createdAt).toBe(createdAt);
  });

  it('defaults to an empty object for a null/undefined document', () => {
    expect(readTimestamps(null)).toEqual({});
    expect(readTimestamps(undefined)).toEqual({});
  });

  it('reads a populated field in place without validating its shape', () => {
    expect(readPopulatedField<{ name: string }>({ name: 'x' })?.name).toBe(
      'x',
    );
    expect(readPopulatedField(undefined)).toBeUndefined();
  });
});
